/**
 * **The search chunker** (`docs/research/search.md` §2–§3, rules 1–7; why each rule exists: §7).
 *
 * Turns a notebook's notes doc (ProseMirror JSON, as `notes_docs.doc_json` holds it) and its
 * source page texts into the chunks the semantic index embeds. Pure: no I/O, no clock, no Node or
 * DOM API, so it runs in main, in a utility process, or in a test.
 *
 * **It walks the JSON, not a checked `Node`.** A doc saved by a newer build can hold a node type
 * this build's schema does not know (an inline slide image, say); `docFromJson` would throw and
 * the whole notebook would drop out of search. Here an unknown node contributes its text and its
 * pages, and nothing else is lost. Only `quiz` and `infographic` are parsed into a `Node`, one
 * block at a time, to reuse the schema's one-line text helpers, with a plain-text fallback.
 */

import { infographicText, notesSchema, quizText } from '../doc/schema.js';
import { OBJECTIVES_REASON } from '../doc/types.js';
import type { BlockUnit, SearchChunk } from './types.js';

// ── tunables (rule 3, rule 1) ────────────────────────────────────────────────────────────────

/** A group is flushed once it reaches this many words (rule 3). */
export const GROUP_MIN_WORDS = 40;
/** A block that would take a group past this starts a new group instead (rule 3). */
export const GROUP_MAX_WORDS = 220;
/** A paragraph of at most this many words, with no closing . ? !, is a label (rule 4). */
export const LABEL_MAX_WORDS = 5;
/** A line on at least this share of a source's pages, digits masked, is page chrome (rule 1). */
export const CHROME_SHARE = 0.4;
/** …but only when the source has at least this many pages. */
export const CHROME_MIN_PAGES = 4;

/** Between the parts of a header (rule 2). */
const HEADER_SEP = ' › ';

// ── normalising (rule 1) ─────────────────────────────────────────────────────────────────────

// An alternation, not a class: a joiner inside a class trips no-misleading-character-class.
const ZERO_WIDTH = /\u200B|\u200C|\u200D|\u2060|\uFEFF|\u00AD/g;
const NBSP = /[\u00A0\u2007\u202F]/g;
/**
 * KaTeX's copy-paste doubling: `h(s)≤h∗(s)h(s)≤h∗(s)`. A run of at least four non-space
 * characters immediately repeated. The upper bound keeps a long unbroken token (a URL) from making
 * the backtracking quadratic in its length.
 */
const DOUBLED = /(\S{4,160})\1/g;

/**
 * NFKC (PDF math italics `𝐹𝑙𝑦` → `Fly`, ligatures `ﬁ` → `fi`), KaTeX doubling collapsed, nbsp to
 * space, zero-width characters dropped, runs of spaces and tabs collapsed, each line trimmed.
 * **Newlines are kept**: page text is read line by line (chrome, and the slide column's matching
 * lines), and a list's items are one per line.
 */
export function normalise(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(ZERO_WIDTH, '')
    .replace(NBSP, ' ')
    .replace(DOUBLED, '$1')
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .join('\n')
    .trim();
}

function words(text: string): number {
  let n = 0;
  for (const w of text.split(/\s+/)) if (w.length > 0) n++;
  return n;
}

// ── hashing ──────────────────────────────────────────────────────────────────────────────────

/**
 * FNV-1a, 64-bit, over the UTF-8 bytes, as 16 hex digits. Done in four 16-bit limbs so it needs
 * neither `BigInt` nor a crypto API. Not cryptographic: it only has to tell "same text" from
 * "changed text" for re-embed reuse.
 */
export function hashText(s: string): string {
  // Offset basis 0xcbf29ce484222325, low limb first.
  let v0 = 0x2325;
  let v1 = 0x8422;
  let v2 = 0x9ce4;
  let v3 = 0xcbf2;
  const step = (byte: number): void => {
    v0 ^= byte;
    // × the FNV prime 0x100000001b3 = 2^40 + 0x1b3.
    const t0 = v0 * 0x1b3;
    const t1 = v1 * 0x1b3 + (t0 >>> 16);
    const t2 = v2 * 0x1b3 + v0 * 0x100 + (t1 >>> 16);
    const t3 = v3 * 0x1b3 + v1 * 0x100 + (t2 >>> 16);
    v0 = t0 & 0xffff;
    v1 = t1 & 0xffff;
    v2 = t2 & 0xffff;
    v3 = t3 & 0xffff;
  };
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x80) {
      step(cp);
    } else if (cp < 0x800) {
      step(0xc0 | (cp >> 6));
      step(0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      step(0xe0 | (cp >> 12));
      step(0x80 | ((cp >> 6) & 0x3f));
      step(0x80 | (cp & 0x3f));
    } else {
      step(0xf0 | (cp >> 18));
      step(0x80 | ((cp >> 12) & 0x3f));
      step(0x80 | ((cp >> 6) & 0x3f));
      step(0x80 | (cp & 0x3f));
    }
  }
  const hex = (v: number): string => v.toString(16).padStart(4, '0');
  return `${hex(v3)}${hex(v2)}${hex(v1)}${hex(v0)}`;
}

// ── reading ProseMirror JSON ─────────────────────────────────────────────────────────────────

interface PMJson {
  type?: unknown;
  attrs?: Record<string, unknown>;
  content?: unknown;
  text?: unknown;
}

function asNode(value: unknown): PMJson | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as PMJson) : null;
}

function typeOf(node: PMJson): string {
  return typeof node.type === 'string' ? node.type : '';
}

function childrenOf(node: PMJson): PMJson[] {
  if (!Array.isArray(node.content)) return [];
  const out: PMJson[] = [];
  for (const raw of node.content as unknown[]) {
    const child = asNode(raw);
    if (child) out.push(child);
  }
  return out;
}

function attr(node: PMJson, name: string): unknown {
  return node.attrs ? node.attrs[name] : undefined;
}

function stringAttr(node: PMJson, name: string): string {
  const value = attr(node, name);
  return typeof value === 'string' ? value : '';
}

function numbersAttr(node: PMJson, name: string): number[] {
  const value = attr(node, name);
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).filter((n): n is number => typeof n === 'number' && Number.isInteger(n));
}

/** Inline atoms that stand for a picture of a page: their caption is their text. */
const PICTURE_TYPES = new Set(['slide_figure', 'slide_image']);

/** The inline text of a node: its text runs, and an inline picture's caption, in order. */
function inlineText(node: PMJson): string {
  let out = '';
  for (const child of childrenOf(node)) {
    if (typeof child.text === 'string') {
      out += child.text;
    } else if (PICTURE_TYPES.has(typeOf(child))) {
      const caption = stringAttr(child, 'caption');
      if (caption) out += ` ${caption} `;
    } else {
      out += inlineText(child);
    }
  }
  return out;
}

/** Every text in a subtree, a newline between block-level children. The fallback reader. */
function plainText(node: PMJson): string {
  if (typeof node.text === 'string') return node.text;
  const kids = childrenOf(node);
  if (kids.length === 0) return PICTURE_TYPES.has(typeOf(node)) ? stringAttr(node, 'caption') : '';
  if (kids.every((k) => typeof k.text === 'string' || PICTURE_TYPES.has(typeOf(k)))) return inlineText(node);
  return kids.map(plainText).filter((t) => t.trim().length > 0).join('\n');
}

/** Every page a block cites: its own, its rows', cards', nodes', and any figure's page. */
function pagesIn(node: PMJson, into: Set<number> = new Set()): Set<number> {
  for (const page of numbersAttr(node, 'pages')) into.add(page);
  if (PICTURE_TYPES.has(typeOf(node))) {
    const page = attr(node, 'page');
    if (typeof page === 'number' && Number.isInteger(page)) into.add(page);
  }
  for (const child of childrenOf(node)) pagesIn(child, into);
  return into;
}

// ── a block's text ───────────────────────────────────────────────────────────────────────────

/**
 * Max's opening sentence, which every Q block carries and which makes them all look alike
 * (rule 5): "Here's a question on the p. 17 example, so it's the statement I'm testing, not you."
 * The first sentence is taken to run from the start of the question line to the end of the
 * sentence holding its first "not you", within the opening 240 characters and with no question
 * mark before it, so the "p. 17" inside it does not end it early and a real question ("…and not
 * you that picks it?") is never eaten. Only the question line is looked at, never the answer.
 */
const Q_PREAMBLE = /^[^?\n]{0,240}?\bnot you\b[^.?!\n]{0,120}(?:[.!]+|(?=\n)|$)\s*/i;

export function stripQPreamble(text: string): string {
  const stripped = text.replace(Q_PREAMBLE, '');
  return stripped.length > 0 ? stripped : text;
}

function listText(node: PMJson): string {
  const lines: string[] = [];
  for (const item of childrenOf(node)) {
    const kids = childrenOf(item);
    const [first, ...rest] = kids;
    const head = first ? (typeOf(first) === 'paragraph' ? inlineText(first) : blockText(first)) : '';
    if (head.trim().length > 0) lines.push(`• ${head.trim()}`);
    for (const child of rest) {
      const text = blockText(child);
      if (text.trim().length > 0) lines.push(text);
    }
  }
  return lines.join('\n');
}

function diagramText(node: PMJson): string {
  const title = stringAttr(node, 'title').trim();
  const labels = childrenOf(node)
    .map((n) => inlineText(n).trim())
    .filter((l) => l.length > 0);
  if (labels.length === 0) return title;
  return `${title ? `${title}: ` : ''}${labels.join(', ')}`;
}

/** `quiz` and `infographic` through the schema's own one-line readers, else plain text. */
function viaSchema(node: PMJson, read: (n: ReturnType<typeof notesSchema.nodeFromJSON>) => string): string {
  try {
    return read(notesSchema.nodeFromJSON(node));
  } catch {
    return plainText(node);
  }
}

/** The raw (un-normalised) text of one block, by type. */
function blockText(node: PMJson): string {
  switch (typeOf(node)) {
    case 'paragraph':
    case 'heading':
    case 'code_block':
      return inlineText(node);
    case 'bullet_list':
    case 'ordered_list':
      return listText(node);
    case 'math_block':
      return stringAttr(node, 'tex');
    case 'slide_figure':
      return stringAttr(node, 'caption');
    case 'q_block':
      return stripQPreamble(
        normalise(
          childrenOf(node)
            .map(blockText)
            .filter((t) => t.trim().length > 0)
            .join('\n'),
        ),
      );
    case 'diagram':
      return diagramText(node);
    case 'quiz':
      // quizText stars the correct option ("[*h_max / h_add]") and appends the explanation
      // ("-> …"). The learner sees neither until they answer, so the index and its snippets must
      // not either: the prompt and the options only.
      return viaSchema(node, (n) =>
        quizText(n)
          .replace(/(\[| \/ )\*/g, '$1')
          .replace(/ -> .*?(?= \|\| |$)/g, ''),
      );
    case 'infographic':
      return viaSchema(node, infographicText);
    case 'table':
      return tableUnits(node).map((u) => u.text).join('\n');
    case 'flashcards':
      return flashcardUnits(node).map((u) => u.text).join('\n');
    default:
      return plainText(node);
  }
}

// ── composite blocks (rule 6) ────────────────────────────────────────────────────────────────

interface CompositeUnit {
  text: string;
  pages: number[];
}

function cellLine(row: PMJson): string {
  return childrenOf(row)
    .map((cell) => normalise(inlineText(cell)).replace(/\n/g, ' '))
    .join(' | ');
}

/** One unit per body row: caption, the heading row, the row (rule 6). */
function tableUnits(node: PMJson): CompositeUnit[] {
  const rows = childrenOf(node);
  const first = rows[0];
  const headed =
    first !== undefined &&
    childrenOf(first).length > 0 &&
    childrenOf(first).every((cell) => attr(cell, 'header') === true);
  const caption = normalise(stringAttr(node, 'caption'));
  const header = headed && first ? cellLine(first) : '';
  const body = headed ? rows.slice(1) : rows;
  const prefix = [caption, header].filter((s) => s.length > 0);
  const units = body
    .map((row) => ({ line: cellLine(row), pages: numbersAttr(row, 'pages') }))
    .filter((r) => r.line.replace(/[|\s]/g, '').length > 0)
    .map((r) => ({ text: [...prefix, r.line].join('\n'), pages: r.pages }));
  // A table that is only a heading row is still something the learner can read.
  if (units.length === 0 && prefix.length > 0 && header.replace(/[|\s]/g, '').length > 0) {
    return [{ text: prefix.join('\n'), pages: [] }];
  }
  return units;
}

/** One unit per card: `title: front — back` (rule 6). */
function flashcardUnits(node: PMJson): CompositeUnit[] {
  const title = normalise(stringAttr(node, 'title'));
  const units: CompositeUnit[] = [];
  for (const card of childrenOf(node)) {
    const sides = childrenOf(card);
    const front = normalise(sides[0] ? inlineText(sides[0]) : '');
    const back = normalise(sides.length > 1 ? inlineText(sides[sides.length - 1]!) : '');
    const body = [front, back].filter((s) => s.length > 0).join(' — ');
    if (body.length === 0) continue;
    units.push({ text: `${title ? `${title}: ` : ''}${body}`, pages: numbersAttr(card, 'pages') });
  }
  return units;
}

const COMPOSITES: Record<string, (node: PMJson) => CompositeUnit[]> = {
  table: tableUnits,
  flashcards: flashcardUnits,
};

// ── the notes doc ────────────────────────────────────────────────────────────────────────────

interface HeadingEntry {
  level: number;
  text: string;
  pages: number[];
}

interface Member {
  blockId: string;
  text: string;
  words: number;
  pages: number[];
}

function sortedUnique(pages: Iterable<number>): number[] {
  return [...new Set(pages)].sort((a, b) => a - b);
}

/** A label (rule 4): a short paragraph with no closing punctuation. */
function isLabel(text: string): boolean {
  if (text.includes('\n')) return false;
  const n = words(text);
  return n > 0 && n <= LABEL_MAX_WORDS && !/[.?!…]["'”’)\]]*$/.test(text);
}

/**
 * The notes doc → note chunks (rules 1–7) and one `BlockUnit` per group member (rule 7).
 *
 * Walks the top-level blocks in order, keeping the heading path and the current label:
 * - The doc's first H1 is the title context and is not part of any path; `o.title` is what the
 *   header says. A later H1 is an ordinary section heading.
 * - A heading, a blank paragraph, a new label and a composite block each end the open group.
 * - A label paragraph starts a group of its own and is a member of it, so a group never mixes
 *   blocks under two labels.
 * - The objectives list and its heading (`reason: 'objectives'`) are skipped: the schema treats
 *   them as the overview's table of contents, cited to every page (`blocksForPages`).
 * - A block whose normalised text repeats an earlier block's is skipped (but a repeated label
 *   still sets the label).
 *
 * `doc` may be the parsed JSON or the `doc_json` string. Anything unreadable yields no chunks.
 */
export function noteChunks(
  doc: unknown,
  o: { notebookId: string; title: string },
): { chunks: SearchChunk[]; units: BlockUnit[] } {
  let root: PMJson | null = null;
  if (typeof doc === 'string') {
    try {
      root = asNode(JSON.parse(doc) as unknown);
    } catch {
      root = null;
    }
  } else {
    root = asNode(doc);
  }
  const chunks: SearchChunk[] = [];
  const units: BlockUnit[] = [];
  if (!root) return { chunks, units };

  const title = normalise(o.title).replace(/\n/g, ' ');
  const keys = new Set<string>();
  const seenText = new Set<string>();
  const stack: HeadingEntry[] = [];
  let titleSeen = false;
  let label: string | null = null;
  let group: Member[] = [];
  let groupWords = 0;

  const section = (): string[] => [...stack.map((h) => h.text), ...(label ? [label] : [])];
  const headerOf = (path: string[]): string => [title, ...path].filter((s) => s.length > 0).join(HEADER_SEP);
  const headingPages = (): number[] => {
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i]!.pages.length > 0) return stack[i]!.pages;
    return [];
  };
  const uniqueKey = (key: string): string => {
    let out = key;
    for (let n = 2; keys.has(out); n++) out = `${key}~${String(n)}`;
    keys.add(out);
    return out;
  };

  const flush = (): void => {
    if (group.length === 0) return;
    const path = section();
    const header = headerOf(path);
    const text = group.map((m) => m.text).join('\n');
    const embedText = `${header}\n${text}`;
    chunks.push({
      key: uniqueKey(`note:${o.notebookId}:${group[0]!.blockId}`),
      kind: 'note',
      notebookId: o.notebookId,
      blockIds: group.map((m) => m.blockId),
      page: null,
      pages: sortedUnique(group.flatMap((m) => m.pages)),
      section: path,
      text,
      embedText,
      hash: hashText(embedText),
    });
    for (const m of group) {
      const unitText = `${header}\n${m.text}`;
      units.push({ notebookId: o.notebookId, blockId: m.blockId, embedText: unitText, hash: hashText(unitText) });
    }
    group = [];
    groupWords = 0;
  };

  childrenOf(root).forEach((node, index) => {
    const type = typeOf(node);
    const reason = attr(node, 'reason');
    const blockId = stringAttr(node, 'blockId') || `pos${String(index)}`;

    if (reason === OBJECTIVES_REASON) return;

    if (type === 'heading') {
      flush();
      label = null;
      const level = typeof attr(node, 'level') === 'number' ? (attr(node, 'level') as number) : 1;
      if (level === 1 && !titleSeen) {
        titleSeen = true;
        stack.length = 0;
        return;
      }
      while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop();
      const text = normalise(inlineText(node)).replace(/\n/g, ' ');
      if (text.length > 0) stack.push({ level, text, pages: sortedUnique(numbersAttr(node, 'pages')) });
      return;
    }

    if (type === 'paragraph' && inlineText(node).trim().length === 0) {
      // A blank paragraph, the learner's empty note slot included, ends the group and the label.
      // One holding only an uncaptioned picture is not blank: it is skipped and changes nothing.
      if (childrenOf(node).every((child) => typeof child.text === 'string')) {
        flush();
        label = null;
      }
      return;
    }

    const composite = COMPOSITES[type];
    if (composite) {
      const parts = composite(node);
      const whole = parts.map((p) => p.text).join('\n');
      if (parts.length === 0 || seenText.has(whole)) return;
      seenText.add(whole);
      flush();
      const path = section();
      const header = headerOf(path);
      // A row or card cites its own pages; one that cites none takes the block's, then the section's.
      const blockOwn = sortedUnique(numbersAttr(node, 'pages'));
      const fallback = blockOwn.length > 0 ? blockOwn : headingPages();
      parts.forEach((part, unitIndex) => {
        const embedText = `${header}\n${part.text}`;
        chunks.push({
          key: uniqueKey(`note:${o.notebookId}:${blockId}#${String(unitIndex)}`),
          kind: 'note',
          notebookId: o.notebookId,
          blockIds: [blockId],
          page: null,
          pages: part.pages.length > 0 ? sortedUnique(part.pages) : fallback,
          section: path,
          text: part.text,
          embedText,
          hash: hashText(embedText),
        });
      });
      return;
    }

    const text = normalise(blockText(node));
    if (text.length === 0) return;

    if (type === 'paragraph' && isLabel(text)) {
      flush();
      label = text;
    }
    if (seenText.has(text)) return;
    seenText.add(text);

    const own = sortedUnique(pagesIn(node));
    const pages = own.length > 0 ? own : headingPages();
    const n = words(text);
    if (group.length > 0 && groupWords + n > GROUP_MAX_WORDS) flush();
    group.push({ blockId, text, words: n, pages });
    groupWords += n;
    if (groupWords >= GROUP_MIN_WORDS) flush();
  });
  flush();
  return { chunks, units };
}

// ── pages ────────────────────────────────────────────────────────────────────────────────────

/** A line that is only a page number: `30`, `30 / 66`, `30 of 66`. */
const PAGE_NUMBER = /^\d+(?:\s*(?:\/|of)\s*\d+)?$/i;

/**
 * One source's pages → one chunk per page (rules 1–2). **Call it once per source**: chrome is a
 * line (digits masked to `#`) on at least 40 % of *that source's* pages, when it has at least four,
 * and a footer of one deck says nothing about another's. `page` is the notebook page number, and
 * the header reads `<title> — slide <page>`. A page with no text left is not indexed.
 */
export function pageChunks(
  pages: { page: number; text: string }[],
  o: { notebookId: string; title: string },
): SearchChunk[] {
  const title = normalise(o.title).replace(/\n/g, ' ');
  const lined = pages.map((p) => ({
    page: p.page,
    lines: normalise(p.text)
      .split('\n')
      .filter((line) => line.length > 0),
  }));

  const chrome = new Set<string>();
  if (lined.length >= CHROME_MIN_PAGES) {
    const onPages = new Map<string, number>();
    for (const p of lined) {
      for (const masked of new Set(p.lines.map((line) => line.replace(/\d/g, '#')))) {
        onPages.set(masked, (onPages.get(masked) ?? 0) + 1);
      }
    }
    const floor = Math.max(2, CHROME_SHARE * lined.length);
    for (const [masked, count] of onPages) if (count >= floor) chrome.add(masked);
  }

  const chunks: SearchChunk[] = [];
  const keys = new Set<string>();
  for (const p of lined) {
    const kept = p.lines.filter((line) => !PAGE_NUMBER.test(line) && !chrome.has(line.replace(/\d/g, '#')));
    const text = kept.join('\n');
    if (text.length === 0) continue;
    let key = `page:${o.notebookId}:${String(p.page)}`;
    for (let n = 2; keys.has(key); n++) key = `page:${o.notebookId}:${String(p.page)}~${String(n)}`;
    keys.add(key);
    const embedText = `${title} — slide ${String(p.page)}\n${text}`;
    chunks.push({
      key,
      kind: 'page',
      notebookId: o.notebookId,
      blockIds: [],
      page: p.page,
      pages: [p.page],
      section: [],
      text,
      embedText,
      hash: hashText(embedText),
    });
  }
  return chunks;
}
