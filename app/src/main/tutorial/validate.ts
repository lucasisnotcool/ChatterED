/**
 * **The model's reading of a sheet, checked in code** (`TUTORIAL-CONTRACT.md` S3), the overview's
 * pattern: nothing the model says reaches the document or the key without passing here.
 *
 *  - **The sheet**: every block's page is a page of the tutorial (an out-of-range page takes the
 *    page before it, so no words are lost); text is non-empty; a heading is level 2 or 3; a
 *    figure's rectangle is inside the page, and snapped to the geometry's box for it when they
 *    overlap; a part's id is the sheet's address shape and unique (a repeat gets a suffix), its
 *    prompt holds no nested part, a `blanks` part's ids are exactly the `{{blank:ID}}` tokens in
 *    its prompt (a part with none becomes `text`), a `choice` part has at least two options with
 *    unique ids; a blank token anywhere else is turned back into the sheet's rule, `____`.
 *  - **The key**: blank answers only for the part's own blanks, correct options only among its
 *    options; a formal check only when `core/planning` `validateCheck` accepts it, and then
 *    `solveCheck`'s answer replaces the model's (`confidence: 'high'`).
 *  - **The links**: notes block ids that exist in the notebook's doc, in document order; lecture
 *    pages only; objective ids of the notebook's tree.
 *
 * Pure: the caller hands in what exists.
 */
import { solveCheck, validateCheck } from '../../core/planning.js';
import {
  BLANK_TOKEN,
  isAnswerKind,
  type FormalCheck,
  type PartKey,
  type PartLinks,
  type SheetAnswer,
  type SheetBlock,
  type SheetPart,
  type SheetRect,
  type TutorialOption,
  type TutorialSheet,
} from '../../shared/tutorial.js';
import type { LandedPart } from './repo.js';

export interface TutorialValidationContext {
  /** The tutorial file's pages: a block's page is 1..pageCount. */
  pageCount: number;
  fallbackTitle: string;
  /** Figure boxes found on each tutorial page by the geometry pass (`notes/extract.ts`). */
  figureCandidates?: ReadonlyMap<number, readonly SheetRect[]>;
  /** Block ids of the notebook's notes doc, in document order. */
  notesBlockIds: readonly string[];
  /** Whether a notebook page belongs to a lecture source. */
  isLecturePage(page: number): boolean;
  objectiveIds: ReadonlySet<string>;
}

export interface TutorialRepairs {
  pagesFixed: number;
  blocksDropped: number;
  nestedPartsDropped: number;
  partIdsRenamed: number;
  blanksFixed: number;
  choiceDemoted: number;
  figuresSnapped: number;
  keysMissing: number;
  checksDropped: number;
  checksSolved: number;
  linksDropped: number;
}

export interface ValidatedTutorial {
  sheet: TutorialSheet;
  parts: LandedPart[];
  repairs: TutorialRepairs;
}

const PART_ID = /^[A-Za-z0-9_.-]{1,40}$/;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter((s) => s.length > 0) : []);
const rec = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

function stripBlanks(text: string): string {
  return text.replace(BLANK_TOKEN, '____');
}

function rectOf(raw: unknown): SheetRect | null {
  const r = rec(raw);
  if (!r) return null;
  const n = (k: string): number => (typeof r[k] === 'number' && Number.isFinite(r[k]) ? (r[k] as number) : NaN);
  const rect = { x0: n('x0'), y0: n('y0'), x1: n('x1'), y1: n('y1') };
  const inUnit = Object.values(rect).every((v) => v >= 0 && v <= 1);
  if (!inUnit || rect.x1 - rect.x0 < 0.02 || rect.y1 - rect.y0 < 0.02) return null;
  return rect;
}

/** Intersection over union of two rectangles. */
export function iou(a: SheetRect, b: SheetRect): number {
  const w = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const h = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const inter = w * h;
  const area = (r: SheetRect): number => (r.x1 - r.x0) * (r.y1 - r.y0);
  const union = area(a) + area(b) - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Validate the sheet half of the model's answer. `null` when there is no part at all: a sheet
 * with nothing to answer is not a tutorial the learner can work through.
 */
export function validateTutorial(raw: unknown, ctx: TutorialValidationContext): ValidatedTutorial | null {
  const repairs: TutorialRepairs = {
    pagesFixed: 0,
    blocksDropped: 0,
    nestedPartsDropped: 0,
    partIdsRenamed: 0,
    blanksFixed: 0,
    choiceDemoted: 0,
    figuresSnapped: 0,
    keysMissing: 0,
    checksDropped: 0,
    checksSolved: 0,
    linksDropped: 0,
  };
  const root = rec(raw);
  if (!root) return null;
  const pageCount = Math.max(1, Math.floor(ctx.pageCount));
  let lastPage = 1;
  const pageOf = (v: unknown): number => {
    if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= pageCount) {
      lastPage = v;
      return v;
    }
    repairs.pagesFixed += 1;
    return lastPage;
  };

  /** One non-part block, with blank tokens kept only where `blanks` says. */
  const block = (raw: unknown, blanks: boolean): SheetBlock | null => {
    const b = rec(raw);
    if (!b) return null;
    const type = str(b.type);
    const page = pageOf(b.page);
    const admin = b.admin === true ? { admin: true as const } : {};
    const text = (t: string): string => (blanks ? t : stripBlanks(t));
    switch (type) {
      case 'heading': {
        const t = str(b.text);
        if (!t) return null;
        return { type: 'heading', level: b.level === 2 || b.level === 1 ? 2 : 3, text: stripBlanks(t), page, ...admin };
      }
      case 'paragraph': {
        const t = str(b.text);
        if (!t) return null;
        return { type: 'paragraph', text: text(t), page, ...admin };
      }
      case 'list': {
        const items = strings(b.items).map(text);
        if (items.length === 0) return null;
        return { type: 'list', ordered: b.ordered === true, items, page, ...admin };
      }
      case 'math': {
        const tex = str(b.tex) || str(b.text);
        if (!tex) return null;
        return { type: 'math', tex, page };
      }
      case 'code': {
        const t = typeof b.text === 'string' ? b.text.replace(/\s+$/, '') : '';
        if (!t.trim()) return null;
        return { type: 'code', text: t, page };
      }
      case 'figure': {
        let rect = rectOf(b.rect);
        const candidates = ctx.figureCandidates?.get(page) ?? [];
        if (rect) {
          const best = candidates.reduce<{ r: SheetRect; s: number } | null>((acc, c) => {
            const s = iou(rect!, c);
            return s > (acc?.s ?? 0) ? { r: c, s } : acc;
          }, null);
          if (best && best.s >= 0.5) {
            rect = { ...best.r };
            repairs.figuresSnapped += 1;
          }
        } else if (candidates.length === 1) {
          rect = { ...candidates[0]! };
          repairs.figuresSnapped += 1;
        }
        return { type: 'figure', page, rect, caption: str(b.caption) };
      }
      default:
        return null;
    }
  };

  const usedIds = new Set<string>();
  /** Model id → the id it was given here, the first time it was seen. */
  const idMap = new Map<string, string>();

  const part = (b: Record<string, unknown>): SheetPart | null => {
    const page = pageOf(b.page);
    let id = str(b.id).replace(/\s+/g, '');
    if (!PART_ID.test(id)) {
      id = `P${usedIds.size + 1}`;
      repairs.partIdsRenamed += 1;
    }
    const modelId = str(b.id);
    if (usedIds.has(id)) {
      let n = 2;
      while (usedIds.has(`${id}-${n}`)) n += 1;
      id = `${id}-${n}`;
      repairs.partIdsRenamed += 1;
    }
    usedIds.add(id);
    if (modelId && !idMap.has(modelId)) idMap.set(modelId, id);

    const answerRaw = rec(b.answer);
    let kind = isAnswerKind(answerRaw?.kind) ? answerRaw.kind : 'text';
    const promptRaw = Array.isArray(b.prompt) ? b.prompt : [];
    // Blanks are known only once the prompt is read with them kept.
    let prompt: SheetBlock[] = [];
    for (const p of promptRaw) {
      if (rec(p)?.type === 'part') {
        repairs.nestedPartsDropped += 1;
        continue;
      }
      const got = block(p, kind === 'blanks');
      if (got && got.type !== 'part') prompt.push(got);
      else repairs.blocksDropped += 1;
    }

    let answer: SheetAnswer;
    if (kind === 'blanks') {
      const seen = new Set<string>();
      // A repeated blank id keeps its first field; the repeat goes back to the sheet's rule.
      prompt = prompt.map((p) => dedupeBlanks(p, seen, () => (repairs.blanksFixed += 1)));
      if (seen.size === 0) {
        kind = 'text';
        answer = { kind: 'text' };
        repairs.blanksFixed += 1;
      } else {
        answer = { kind: 'blanks', blanks: [...seen] };
      }
    } else if (kind === 'choice') {
      const options: TutorialOption[] = [];
      const ids = new Set<string>();
      for (const o of Array.isArray(answerRaw?.options) ? answerRaw.options : []) {
        const r = rec(o);
        const oid = str(r?.id);
        const text = stripBlanks(str(r?.text));
        if (!oid || !text || ids.has(oid)) continue;
        ids.add(oid);
        options.push({ id: oid, text });
      }
      if (options.length < 2) {
        repairs.choiceDemoted += 1;
        answer = { kind: 'text' };
      } else {
        answer = { kind: 'choice', multi: answerRaw?.multi !== false, options };
      }
    } else {
      answer = { kind } as SheetAnswer;
    }
    return { type: 'part', id, label: str(b.label) || id, page, prompt, answer };
  };

  const blocks: SheetBlock[] = [];
  for (const item of Array.isArray(root.blocks) ? root.blocks : []) {
    const b = rec(item);
    if (b?.type === 'part') {
      const p = part(b);
      if (p) blocks.push(p);
      continue;
    }
    const got = block(item, false);
    if (got) blocks.push(got);
    else repairs.blocksDropped += 1;
  }
  const sheetParts = blocks.filter((b): b is SheetPart => b.type === 'part');
  if (sheetParts.length === 0) return null;
  const title = str(root.title) || ctx.fallbackTitle;
  // The document opens with the title as its own heading; the sheet's printed title, copied as a
  // heading too, would read twice (live run, 3 Oct 2026). Only a leading heading that says the
  // same words goes.
  const same = (a: string): boolean => a.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase() === title.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();
  const lead = blocks.findIndex((b) => !('admin' in b && b.admin === true));
  if (lead >= 0) {
    const first = blocks[lead]!;
    if (first.type === 'heading' && same(first.text)) blocks.splice(lead, 1);
  }
  const sheet: TutorialSheet = { title, blocks };

  // ── keys and links ──
  const rawKeys = new Map<string, Record<string, unknown>>();
  for (const k of Array.isArray(root.parts) ? root.parts : []) {
    const r = rec(k);
    const modelId = str(r?.partId);
    const id = idMap.get(modelId) ?? modelId;
    if (r && id && !rawKeys.has(id)) rawKeys.set(id, r);
  }
  const order = new Map(ctx.notesBlockIds.map((id, i) => [id, i]));
  const parts: LandedPart[] = sheetParts.map((p) => {
    const r = rawKeys.get(p.id) ?? null;
    if (!r) repairs.keysMissing += 1;
    const key = keyFrom(p, r);
    const check = r ? checkFrom(r.formalCheck) : null;
    if (r && r.formalCheck !== null && r.formalCheck !== undefined && r.formalCheck !== '' && !check) repairs.checksDropped += 1;
    if (check) {
      key.check = check;
      if (applySolved(key, p, check)) repairs.checksSolved += 1;
    }
    const proposedBlocks = strings(r?.notesBlockIds);
    const notesBlockIds = [...new Set(proposedBlocks.filter((id) => order.has(id)))].sort((a, b) => order.get(a)! - order.get(b)!);
    const proposedPages = Array.isArray(r?.pages) ? (r.pages as unknown[]) : [];
    const pages = [
      ...new Set(proposedPages.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && ctx.isLecturePage(n))),
    ].sort((a, b) => a - b);
    const proposedObjectives = strings(r?.objectiveIds);
    const objectiveIds = [...new Set(proposedObjectives.filter((id) => ctx.objectiveIds.has(id)))];
    repairs.linksDropped +=
      proposedBlocks.length - notesBlockIds.length + (proposedPages.length - pages.length) + (proposedObjectives.length - objectiveIds.length);
    const links: PartLinks = { notesBlockIds, pages };
    return { partId: p.id, key, links, objectiveIds };
  });
  return { sheet, parts, repairs };
}

function dedupeBlanks(b: SheetBlock, seen: Set<string>, fixed: () => void): SheetBlock {
  const fix = (text: string): string =>
    text.replace(BLANK_TOKEN, (token, id: string) => {
      if (seen.has(id)) {
        fixed();
        return '____';
      }
      seen.add(id);
      return token;
    });
  if (b.type === 'paragraph') return { ...b, text: fix(b.text) };
  if (b.type === 'list') return { ...b, items: b.items.map(fix) };
  return b;
}

/**
 * A part's key from the model's answer, kept to what the part can use: blank answers for its own
 * blanks, correct options among its own options. A part with no key gets an empty one, marked
 * low-confidence, so Max judges it on the problem itself.
 */
export function keyFrom(part: SheetPart, raw: Record<string, unknown> | null): PartKey {
  const key: PartKey = {
    partId: part.id,
    answer: str(raw?.answer),
    steps: strings(raw?.steps).slice(0, 6),
    mistakes: strings(raw?.mistakes).slice(0, 6),
    prerequisites: strings(raw?.prerequisites).slice(0, 6),
    confidence: raw && str(raw.answer) ? 'high' : 'low',
    from: 'model',
  };
  if (part.answer.kind === 'blanks') {
    const own = new Set(part.answer.blanks);
    const blanks: Record<string, string[]> = {};
    const list = Array.isArray(raw?.blanks) ? (raw.blanks as unknown[]) : [];
    for (const entry of list) {
      const r = rec(entry);
      const id = str(r?.id);
      const accepted = strings(r?.accepted);
      if (own.has(id) && accepted.length > 0 && !blanks[id]) blanks[id] = accepted;
    }
    // The older shape, a record of id → answers, is read too.
    const asRecord = rec(raw?.blanks);
    if (asRecord) {
      for (const [id, v] of Object.entries(asRecord)) {
        const accepted = typeof v === 'string' ? [v.trim()].filter(Boolean) : strings(v);
        if (own.has(id) && accepted.length > 0 && !blanks[id]) blanks[id] = accepted;
      }
    }
    if (Object.keys(blanks).length > 0) key.blanks = blanks;
  }
  if (part.answer.kind === 'choice') {
    const ids = new Set(part.answer.options.map((o) => o.id));
    const correct = [...new Set(strings(raw?.correct).filter((id) => ids.has(id)))];
    if (correct.length > 0) key.correct = correct;
  }
  return key;
}

/** A `formalCheck` string (or object) through `core/planning` `validateCheck`; null when refused. */
export function checkFrom(raw: unknown): FormalCheck | null {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return null;
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (value === null || value === undefined) return null;
  try {
    return validateCheck(value).check;
  } catch {
    return null;
  }
}

/**
 * **Code's answer replaces the model's** where the problem is formal (`tutorials.md` §5): the
 * plan the simulation found, the options that reach the goal, the derived precondition or
 * effect. True when anything was replaced; the key is then `high` confidence.
 */
export function applySolved(key: PartKey, part: SheetPart, check: FormalCheck): boolean {
  let solved: ReturnType<typeof solveCheck>;
  try {
    solved = solveCheck(check);
  } catch {
    return false;
  }
  let changed = false;
  if (solved.plan && solved.plan.length > 0) {
    key.answer = solved.plan.map((step, i) => `${i + 1}. ${step}`).join('\n');
    changed = true;
  }
  if (solved.correct && part.answer.kind === 'choice') {
    const ids = new Set(part.answer.options.map((o) => o.id));
    key.correct = solved.correct.filter((id) => ids.has(id));
    const byId = new Map(part.answer.options.map((o) => [o.id, o.text]));
    key.answer = key.correct.length > 0 ? key.correct.map((id) => `${id}. ${byId.get(id) ?? ''}`.trim()).join('; ') : 'None of the options.';
    changed = true;
  }
  if (solved.blanks && part.answer.kind === 'blanks') {
    const blanks: Record<string, string[]> = { ...(key.blanks ?? {}) };
    for (const [id, value] of Object.entries(solved.blanks)) {
      if (!part.answer.blanks.includes(id) || !value) continue;
      blanks[id] = [value, ...(blanks[id] ?? []).filter((v) => v !== value)];
    }
    key.blanks = blanks;
    key.answer = Object.entries(blanks)
      .map(([id, v]) => `${id}: ${v[0] ?? ''}`)
      .join('\n');
    changed = true;
  }
  if (changed) key.confidence = 'high';
  return changed;
}
