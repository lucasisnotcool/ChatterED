/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THE CHROME AROUND THE WORDS (`collab-doc.md` §3, §5)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Everything the document shows that is *not* the document: the provenance chip on every block,
 * the agents' cursors, the Remove · Keep control on an applied edit, the Accept · Reject control
 * on a suggestion, and the persistent highlight on a span that has a thread. On a learning
 * overview (`notebooks.md`, 2026-10-01) also: the action toolbar on each line (Explain · Example ·
 * Quiz me · Ask…) with its "Ellie is writing…" or refusal under the block, the fills beside the
 * objectives, a section's recommended block, and the note slot's placeholder.
 *
 * All of it is **decorations**, not nodes. That is the load-bearing decision of this file: a
 * control drawn as a decoration cannot be typed into, copied, saved, sent to a model or undone,
 * because it is not in the document at all. The alternative — chrome as real nodes — is how a
 * learner ends up with `Remove · Keep` in the middle of a paragraph after a copy-paste, and how
 * an agent ends up being shown its own buttons in the outline.
 *
 * ## The colour-blind rule (§10 of the build note, and plain decency)
 *
 * Ellie is green and Max is red, which is the worst possible pair for the ~8 % of men with a
 * red-green deficiency — and this app is for one lecture cohort, so that is a real person in the
 * room. **Colour is never the only signal.** Every agent thing here carries, in addition:
 *   - the agent's **name in words** on the flag and on the control,
 *   - a **left rail** whose shape differs (Ellie solid, Max dashed),
 *   - a different **glyph** on the cursor flag.
 * The CSS in `notes.css` holds the other half of this (`--nd-ellie`, `--nd-max`).
 *
 * ## Cost
 *
 * The decoration set is rebuilt when the document's block structure changes or when the store
 * says the context moved (`bumpChrome`); an ordinary keystroke inside a block *maps* the existing
 * set instead, which is what keeps a 600-block deck typing at speed.
 */

import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import { AttrStep, ReplaceAroundStep } from 'prosemirror-transform';
import type { Node } from 'prosemirror-model';
import { blockAttrs, blockPos, eachBlock } from '../../../shared/doc/schema.js';
import type {
  AgentAuthor,
  BlockActionKind,
  DocEditRecord,
  OverviewMeta,
  QResolution,
  Rect,
  Suggestion,
} from '../../../shared/doc/types.js';
import type { NotebookSourceView } from '../../../shared/notebook.js';
import {
  BLOCK_KIND_NAME,
  chipLabel,
  chipSourceNames,
  citationParts,
  fillMark,
  fillsForItems,
  hasToolbar,
  isEmptyNoteSlot,
  isNoteSlot,
  isObjectivesList,
  placeRecommendations,
  showsChip,
  type ObjectiveFillView,
} from './overview.js';
import { selfCheckLabel } from './qblock.js';
import { frontierOf, revealKey } from './reveal.js';
import { cardRowAt, cardRows, isCardRow } from './conceptmodel.js';
import { attachCitePreview, closeSourcePopover, type SlideReader } from './sourcepop.js';
import { closeCommentPopover, openCommentPopover } from './commentpop.js';

export const chromeKey = new PluginKey<DecorationSet>('chattered:chrome');

/** Bump the chrome without touching the document: the store's cursors or edits moved. */
export function bumpChrome(tr: Transaction): Transaction {
  return tr.setMeta(chromeKey, true);
}

export interface AgentCursorView {
  author: AgentAuthor;
  blockId: string | null;
  state: 'idle' | 'thinking' | 'typing';
}

/** A span thread, as `store.chat.spanThreads` publishes it (agreed with T5). */
export interface SpanThreadView {
  threadId: string;
  blockId: string;
  quote: string;
}

/** An action on one block (`notebooks.md` §4.1): running, or refused with a line saying why. */
export interface BlockActionView {
  kind: BlockActionKind;
  author: AgentAuthor;
  state: 'running' | 'refused';
  line: string;
}

/** A recommended block's card while it is being added, or after it could not be. */
export interface RecommendationView {
  state: 'adding' | 'refused';
  line: string;
}

export interface ChromeContext {
  frozen: boolean;
  /** Hidden entirely while frozen (§3: "While frozen, no agent edits the doc"). */
  cursors: readonly AgentCursorView[];
  /** Status `applied` only — the edits that still wear their colour. */
  edits: readonly DocEditRecord[];
  /** Kept edits whose chat response links remain beside their text. */
  keptEdits?: readonly DocEditRecord[];
  /** Status `open` only. */
  suggestions: readonly Suggestion[];
  spanThreads: readonly SpanThreadView[];
  onRemoveEdit: (editId: string) => void;
  onKeepEdit: (editId: string) => void;
  onAcceptSuggestion: (suggestionId: string) => void;
  onRejectSuggestion: (suggestionId: string) => void;
  /** The provenance chip's click: a slide window beside the chip (2026-10-03: it was the modal). */
  onOpenSlide: (page: number, rect: Rect | null, anchor?: HTMLElement, afterBlockId?: string | null) => void;
  /**
   * **Insert into notes**, from a slide window (2026-10-03): the whole slide or a crop of it, as a
   * figure after `afterBlockId` (the block the slide was opened from), or the caret's block.
   */
  onInsertSlide?: (target: { page: number; rect: Rect | null }, afterBlockId: string | null) => void;
  onFocusThread: (threadId: string) => void;
  onFocusEdit: (messageId: string | null, blockIds: string[]) => void;
  /**
   * The chip's hover preview reads the slide through this (`sourcepop.ts`). Optional: without it
   * the chip is what it was before, a click that opens the whole slide.
   */
  reader?: SlideReader;

  // ── the learning overview (`notebooks.md`). All optional: a doc without them is plain notes.

  /** The open notebook's sources: chips read `Lecture p. 17 · Notes §3` (contract C1). */
  sources?: readonly Pick<NotebookSourceView, 'name' | 'kind' | 'pageBase' | 'pageCount'>[];
  /** The taught objectives in tree order, for the "By the end you can" fills (C5). */
  objectives?: readonly ObjectiveFillView[];
  /** For the recommended blocks (§5.3). */
  overview?: OverviewMeta | null;
  blockActions?: Readonly<Record<string, BlockActionView>>;
  recommendationStates?: Readonly<Record<string, RecommendationView>>;
  /** The toolbar. Without it, no toolbar is drawn. */
  onBlockAction?: (blockId: string, kind: BlockActionKind) => void;
  onRecommendation?: (id: string, action: 'add' | 'dismiss') => void;
  /**
   * **"Ready to check this?"** (D2, 2026-10-06): the section headings that offer a check now
   * (`readinessview.ts`), and the press, which is Quiz me on the section's first line.
   */
  readyHeadings?: readonly string[];
  onReadyCheck?: (headingBlockId: string) => void;
  /**
   * **The blocks' stored explain comments** (migration 033), by block id. Each draws a badge in
   * the right gutter, before the provenance chip, that opens the explain (`commentpop.ts`).
   */
  comments?: Readonly<Record<string, { body: string; updatedAt?: string }>>;
}

// ── labels (pure — these are the tested part) ───────────────────────────────────────────────

/** `[1,2,3,7,9]` → `[[1,3],[7,7],[9,9]]`. */
function runs(pages: readonly number[]): [number, number][] {
  const sorted = [...new Set(pages.filter((p) => Number.isInteger(p) && p > 0))].sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (const page of sorted) {
    const last = out[out.length - 1];
    if (last && page === last[1] + 1) last[1] = page;
    else out.push([page, page]);
  }
  return out;
}

/**
 * The chip's text (§3: "`p. 12` or `added: bridges p. 12 and p. 13`").
 *
 * Pages win when a block has both, because a page is checkable in one click and a reason is not;
 * the reason is still carried, as the chip's tooltip. A block with neither is a bug the ingest's
 * validator is supposed to have caught — the chip says so rather than rendering an empty pill,
 * so the failure is visible on the page instead of only in a log.
 */
export function provenanceLabel(pages: readonly number[], reason: string | null): string {
  const grouped = runs(pages);
  if (grouped.length > 0) {
    const parts = grouped.map(([from, to]) => (from === to ? String(from) : `${String(from)}–${String(to)}`));
    return `p. ${parts.join(', ')}`;
  }
  if (reason && reason.trim().length > 0) return `added: ${reason.trim()}`;
  return 'no source';
}

/**
 * The tag on a Q block: *open* while it waits, then *your answer* or *revisit* (§5.3, amended
 * 2026-10-06, D4). It used to grade the page ("you got this", "partly yours", "released"); the
 * grade is the chat's and the bar's now, and a closed question says only what it holds for the
 * learner (`selfCheckLabel`).
 */
export function qStatusLabel(status: string, resolution: QResolution | null): string {
  if (status !== 'resolved') return 'open';
  return selfCheckLabel(resolution);
}

export const AGENT_NAME: Record<AgentAuthor, string> = { ellie: 'Ellie', max: 'Max' };

// ── DOM helpers ─────────────────────────────────────────────────────────────────────────────

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className: string, text: string, title: string, onClick: () => void): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  node.textContent = text;
  node.title = title;
  node.addEventListener('mousedown', (event) => {
    // The editor must not take the selection away from under the click, and PM must not treat
    // the press as a click in the document.
    event.preventDefault();
    event.stopPropagation();
  });
  node.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return node;
}

/** A widget that is chrome: never selected, never a drop target, and it eats its own events. */
function widget(pos: number, key: string, side: number, build: (view: EditorView) => HTMLElement): Decoration {
  return Decoration.widget(pos, build, { key, side, ignoreSelection: true, stopEvent: () => true });
}

// ── building the set ────────────────────────────────────────────────────────────────────────

function provenanceChips(doc: Node, ctx: ChromeContext): Decoration[] {
  const out: Decoration[] = [];
  // Several sources: each named by what tells it from the others (`chipSourceNames`).
  const names = ctx.sources && ctx.sources.length > 1 ? chipSourceNames(ctx.sources) : null;
  eachBlock(doc, (node, pos, depth) => {
    // A q_block's children hang off the Q block's own chrome. A concept card is the other way
    // round (`notebooks.md` §11.2, amended 2026-10-06): its core line and each block in its depth
    // carry their own chip, and the card and its items, whose provenance those rows repeat, none.
    if (node.type.name === 'concept') return;
    if (depth > 0 && !isCardRow(doc, pos)) return;
    const { blockId, pages, reason } = blockAttrs(node);
    // The overview's title, objectives and note slots carry no chip (C6): they are scaffolding.
    if (!blockId || !showsChip(node)) return;
    const label = chipLabel(pages, ctx.sources, () => provenanceLabel(pages, reason));
    const page = pages[0] ?? (node.type.name === 'slide_figure' ? (node.attrs.page as number) : null);
    const rect = node.type.name === 'slide_figure' ? ((node.attrs.rect as Rect | null) ?? null) : null;
    const commented = commentOnTopLine(node, ctx.comments);
    out.push(
      widget(pos + 1, `prov:${blockId}:${label}:${commented ? 'c' : ''}`, -1, (view) => {
        const holder = el('span', 'nd-chip-holder');
        // Assigned below, once the chip exists: with a preview, the click opens the slide on the
        // region the block was drawn from rather than on the whole page.
        let openRegion: (() => void) | null = null;
        const chip = button('nd-chip', label, reason ? reason : `Open the source slide (${label})`, () => {
          if (openRegion) openRegion();
          else if (page !== null) ctx.onOpenSlide(page, rect, chip, blockId);
        });
        if (page !== null && ctx.reader) {
          const figure = node.type.name === 'slide_figure' ? { page: node.attrs.page as number, rect } : null;
          openRegion = attachCitePreview(chip, {
            pages: pages.length > 0 ? pages : [page],
            reason,
            // Read when the pointer arrives, not when the chip was built: a keystroke maps this
            // widget rather than rebuilding it, so `node` may be an old copy of the block.
            text: () => {
              const now = blockPos(view.state.doc, blockId)?.node ?? node;
              return now.textBetween(0, now.content.size, '\n', ' ');
            },
            figure,
            reader: ctx.reader,
            onOpenSlide: ctx.onOpenSlide,
            onInsert: ctx.onInsertSlide ? (target) => ctx.onInsertSlide?.(target, blockId) : undefined,
          });
          // The preview says what the tooltip said, and the two would sit on top of each other.
          chip.title = '';
          chip.setAttribute('aria-label', `Open the source slide (${label})`);
        }
        // A block with a reason and no page is ordinary (§2 allows either); a block with
        // neither is an ingest bug and says so in the one place a reader will see it.
        // Several sources: the name may shorten, the page may not (`citationParts`).
        if (pages.length > 0 && ctx.sources && ctx.sources.length > 1) {
          chip.replaceChildren();
          // One line per source (a chip citing two files stacks them, notes.css), each its
          // name then its pages; the spacing is CSS, because a space between flex items is
          // dropped ("Notesp. 3", live run 1 Oct 2026).
          for (const part of citationParts(ctx.sources, pages)) {
            const line = el('span', 'nd-chip-part');
            if (part.source) line.append(el('span', 'nd-chip-src', names?.get(part.source) ?? part.source));
            if (part.where) line.append(el('span', 'nd-chip-where', part.where));
            chip.append(line);
          }
          chip.setAttribute('aria-label', `Open the source (${label})`);
          if (!ctx.reader) chip.title = reason ? `${label} — ${reason}` : label;
        }
        if (label === 'no source') chip.classList.add('nd-chip-bad');
        else if (page === null) chip.classList.add('nd-chip-flat');
        // The explain badge sits where the chip starts: the chip moves over by its width.
        if (commented) holder.classList.add('nd-chip-holder-cmt');
        holder.append(chip);
        return holder;
      }),
    );
  });
  return out;
}

/**
 * Does a comment badge sit on this block's first line? Its own, or (a list) its first item's,
 * which is drawn at the same height.
 */
export function commentOnTopLine(node: Node, comments: ChromeContext['comments']): boolean {
  if (!comments) return false;
  const { blockId } = blockAttrs(node);
  if (blockId && comments[blockId]) return true;
  if (node.type.name === 'bullet_list' || node.type.name === 'ordered_list') {
    const first = node.firstChild;
    const id = first ? blockAttrs(first).blockId : '';
    return Boolean(id && comments[id]);
  }
  return false;
}

/**
 * **The explain badges** (migration 033): one on every block that has a stored explain, at any
 * depth (a list's item, a concept card's row). A widget like the chip, at the block's start, drawn
 * in the right gutter (notes.css `.nd-cmt-holder`): zero-width and absolutely placed, so it shifts
 * no line and takes no caret. Its click opens the explain (`commentpop.ts`).
 */
function commentBadges(doc: Node, ctx: ChromeContext): Decoration[] {
  const comments = ctx.comments;
  if (!comments || Object.keys(comments).length === 0) return [];
  const out: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isBlock) return false;
    const { blockId } = blockAttrs(node);
    const comment = blockId ? comments[blockId] : undefined;
    if (comment) {
      // A leaf block (a display formula) has no inside to hang it in: the badge goes in a
      // zero-height line just before it (`.nd-cmt-edge`), which collapses into the margin.
      const leaf = node.isLeaf;
      const key = `cmt:${blockId}:${leaf ? 'edge' : 'in'}:${comment.updatedAt ?? String(comment.body.length)}`;
      out.push(
        widget(leaf ? pos : pos + 1, key, leaf ? 1 : -2, () => {
          const holder = commentBadge(blockId, comment.body, ctx);
          if (!leaf) return holder;
          const edge = el('div', 'nd-cmt-edge');
          edge.contentEditable = 'false';
          edge.append(holder);
          return edge;
        }),
      );
    }
    // Into containers and lists; never into a textblock's inline content.
    return !node.isTextblock;
  });
  return out;
}

/** The badge itself: Ellie's dot and "Explain", a button that opens the stored explain. */
function commentBadge(blockId: string, body: string, ctx: ChromeContext): HTMLElement {
  const holder = el('span', 'nd-cmt-holder');
  holder.contentEditable = 'false';
  const badge = button('nd-cmt', '', 'Ellie explains this line (saved, works offline)', () => {
    openCommentPopover(badge, ctx.comments?.[blockId]?.body ?? body);
  });
  badge.append(agentDot('ellie'), el('span', 'nd-cmt-label', 'Explain'));
  badge.setAttribute('aria-label', 'Ellie explains this line');
  badge.setAttribute('aria-haspopup', 'dialog');
  badge.setAttribute('aria-expanded', 'false');
  holder.append(badge);
  return holder;
}

// ── the learning overview ───────────────────────────────────────────────────────────────────

/** The four actions, in the toolbar's order (§4.1). `who` is the agent the dot names. */
const ACTIONS: { kind: BlockActionKind; label: string; who: AgentAuthor | null; title: string }[] = [
  { kind: 'explain', label: 'Explain', who: 'ellie', title: 'Ellie explains this in the chat, and adds one line under it' },
  { kind: 'example', label: 'Example', who: 'ellie', title: 'Ellie gives a worked example in the chat, and adds one line under it' },
  { kind: 'quiz', label: 'Quiz me', who: 'max', title: 'Max asks you a question on this, here and in the chat' },
  { kind: 'ask', label: 'Ask…', who: null, title: 'Ask your own question about this, in the chat' },
];

/**
 * The agent's dot. **Not colour alone**: Ellie's is a solid dot, Max's a dashed ring, and the
 * name is in the button's title and its accessible name.
 */
function agentDot(who: AgentAuthor): HTMLElement {
  const dot = el('span', `nd-tool-dot nd-tool-dot-${who}`);
  dot.setAttribute('aria-hidden', 'true');
  return dot;
}

/**
 * **The action toolbar** (§4.1), on every line it applies to (`hasToolbar`). Drawn like the chip:
 * a widget inside the block, hidden until the block is hovered or holds the caret (notes.css),
 * so it costs nothing until it is wanted and a tap or the keyboard reaches it without a hover.
 */
function blockToolbars(doc: Node, ctx: ChromeContext): Decoration[] {
  const act = ctx.onBlockAction;
  if (!act) return [];
  const out: Decoration[] = [];
  // A concept card's rows each get their own: its core line and every block in its depth (§11.2).
  const rows: { node: Node; offset: number }[] = [];
  doc.forEach((node, offset) => {
    if (node.type.name === 'concept') for (const row of cardRows(node, offset)) rows.push({ node: row.node, offset: row.pos });
    else rows.push({ node, offset });
  });
  rows.forEach(({ node, offset }) => {
    if (!hasToolbar(node)) return;
    const { blockId } = blockAttrs(node);
    const busy = ctx.blockActions?.[blockId]?.state === 'running';
    out.push(
      widget(offset + 1, `tools:${blockId}:${busy ? 'busy' : 'idle'}`, -1, () => {
        const holder = el('span', 'nd-tools-holder');
        const bar = el('span', 'nd-tools');
        bar.setAttribute('role', 'toolbar');
        bar.setAttribute('aria-label', 'Work on this line');
        // A compact sheet (notes.css `.nd-compact`) has no gutter to stack the four in: they fold
        // behind this handle on the block's corner, and open on hover, focus or a click. A wide
        // sheet hides the handle, and the list lays out exactly as the toolbar always did.
        const more = button('nd-tools-more', '⋯', 'Explain, Example, Quiz me, Ask…', () => {
          more.setAttribute('aria-expanded', String(bar.classList.toggle('nd-tools-open')));
        });
        more.setAttribute('aria-label', 'Work on this line');
        more.setAttribute('aria-haspopup', 'true');
        more.setAttribute('aria-expanded', 'false');
        bar.addEventListener('mouseleave', () => {
          bar.classList.remove('nd-tools-open');
          more.setAttribute('aria-expanded', 'false');
        });
        const list = el('span', 'nd-tools-list');
        for (const action of ACTIONS) {
          const control = button(`nd-tool nd-tool-${action.kind}`, '', action.title, () => act(blockId, action.kind));
          if (action.who) control.append(agentDot(action.who));
          control.append(document.createTextNode(action.label));
          control.setAttribute('aria-label', action.who ? `${action.label} (${AGENT_NAME[action.who]})` : action.label);
          if (busy && action.kind !== 'ask') control.disabled = true;
          list.append(control);
        }
        bar.append(more, list);
        holder.append(bar);
        return holder;
      }),
    );
  });
  return out;
}

/** A widget **between** blocks: not editable, not selectable, and it eats its own events. */
function between(pos: number, key: string, side: number, build: () => HTMLElement): Decoration {
  return widget(pos, key, side, () => {
    const node = build();
    node.contentEditable = 'false';
    return node;
  });
}

/** "Ellie is writing…" under a block while its action runs, or the line saying why it was refused. */
function blockActionLines(doc: Node, ctx: ChromeContext): Decoration[] {
  const out: Decoration[] = [];
  for (const [blockId, action] of Object.entries(ctx.blockActions ?? {})) {
    const target = blockPos(doc, blockId);
    if (!target) continue;
    const end = target.pos + target.node.nodeSize;
    if (end > doc.content.size) continue;
    // Between top-level blocks, or between a concept card's rows (under its core line, or under a
    // block in its depth), where Ellie's addition to the card will land.
    const $end = doc.resolve(end);
    if ($end.depth !== 0 && $end.parent.type.name !== 'concept' && $end.parent.type.name !== 'concept_item') continue;
    out.push(
      between(end, `act:${blockId}:${action.state}:${action.line}`, -2, () => {
        const line = el('div', `nd-actline nd-${action.author} nd-actline-${action.state}`);
        line.setAttribute('role', 'status');
        if (action.state === 'running') line.append(el('span', 'nd-writing-dot'));
        line.append(document.createTextNode(action.line));
        return line;
      }),
    );
  }
  return out;
}

/**
 * **The objectives' fills** (C5): a small bar beside each item of "By the end you can", from the
 * progress view. The bar's *length* is the signal and the word beside it ("half", "✓ done") says
 * it again, so it is never colour alone.
 *
 * **Attributes, not widgets.** Each item gets a node decoration whose `--fill` and `data-fill-word`
 * notes.css draws as the item's `::before` (the bar) and `::after` (the word). A widget inside a
 * list item was tried first: ProseMirror reused it by key across a rebuild of the chrome and lost
 * its DOM on the way (the fills vanished when a source was added and came back on the next fill
 * change). An attribute cannot be lost that way, and it puts nothing where the caret can go.
 */
function objectiveDecorations(doc: Node, ctx: ChromeContext): Decoration[] {
  const out: Decoration[] = [];
  const objectives = ctx.objectives ?? [];
  doc.forEach((node, offset) => {
    if (!isObjectivesList(node)) return;
    out.push(Decoration.node(offset, offset + node.nodeSize, { class: 'nd-objectives' }));
    const items: string[] = [];
    node.forEach((item) => items.push(item.textContent));
    const fills = fillsForItems(items, objectives);
    let index = 0;
    node.forEach((item, itemOffset) => {
      const which = fills[index++] ?? null;
      if (!which) return; // a line the learner added has nothing to fill
      const from = offset + 1 + itemOffset;
      const word = fillMark(which.fill);
      out.push(
        Decoration.node(from, from + item.nodeSize, {
          class: 'nd-objitem',
          style: `--fill: ${String(which.fill * 100)}%`,
          'data-fill-word': word === 'done' ? '✓ done' : word,
          title: `Your own words on this objective: ${word || 'not started'}`,
        }),
      );
    });
  });
  return out;
}

/**
 * **A section's recommended block** (§5.3): a card at the end of its section naming the type, a
 * title and one line, with **Add** and a dismiss. Not in the document: it is `OverviewMeta`'s,
 * and it costs a line until the learner adds it.
 */
function recommendationCards(doc: Node, ctx: ChromeContext): Decoration[] {
  const choose = ctx.onRecommendation;
  if (!choose) return [];
  return placeRecommendations(doc, ctx.overview ?? null).map(({ recommendation: rec, section }) => {
    const state = ctx.recommendationStates?.[rec.id] ?? null;
    return between(section.end, `rec:${rec.id}:${state?.state ?? 'offered'}:${state?.line ?? ''}`, -1, () => {
      const card = el('div', 'nd-rec');
      card.setAttribute('role', 'group');
      card.setAttribute('aria-label', `Recommended: ${BLOCK_KIND_NAME[rec.kind]}`);
      const head = el('div', 'nd-rec-head');
      head.append(el('span', 'nd-rec-kind', `Recommended · ${BLOCK_KIND_NAME[rec.kind]}`));
      const dismiss = button('nd-rec-dismiss', '✕', 'Not this one', () => choose(rec.id, 'dismiss'));
      dismiss.setAttribute('aria-label', `Dismiss the recommended ${BLOCK_KIND_NAME[rec.kind].toLowerCase()}`);
      head.append(dismiss);
      const body = el('div', 'nd-rec-body');
      const words = el('div', 'nd-rec-words');
      words.append(el('div', 'nd-rec-title', rec.title), el('div', 'nd-rec-line', rec.description));
      const add = button('nd-rec-add', state?.state === 'adding' ? 'Adding…' : 'Add', `Ellie makes this ${BLOCK_KIND_NAME[rec.kind].toLowerCase()} here`, () =>
        choose(rec.id, 'add'),
      );
      if (state?.state === 'adding') {
        add.disabled = true;
        dismiss.disabled = true;
      }
      body.append(words, add);
      card.append(head, body);
      if (state) {
        const line = el('div', `nd-rec-state nd-rec-state-${state.state}`);
        line.setAttribute('role', 'status');
        if (state.state === 'adding') line.append(el('span', 'nd-writing-dot'));
        line.append(document.createTextNode(state.line));
        card.append(line);
      }
      return card;
    });
  });
}

/**
 * **"Ready to check this?"** on a section's heading (D2, 2026-10-06; `collab-doc.md` §6 and
 * `notebooks.md` §5.2, amended 2026-10-06). Max never asks unprompted any more: code decides the
 * learner has done enough on the section to be checked (`core/readiness`, measured in
 * `readinessview.ts`) and the heading *offers* it; the press goes through Quiz me, the one path a
 * question takes. A widget at the end of the heading's text, like the chip: not in the document,
 * so it is never typed into, copied or saved.
 */
function readyChecks(doc: Node, ctx: ChromeContext): Decoration[] {
  const press = ctx.onReadyCheck;
  if (!press || !ctx.readyHeadings || ctx.readyHeadings.length === 0) return [];
  const out: Decoration[] = [];
  for (const headingBlockId of new Set(ctx.readyHeadings)) {
    const target = blockPos(doc, headingBlockId);
    if (!target || target.node.type.name !== 'heading') continue;
    out.push(
      widget(target.pos + target.node.nodeSize - 1, `ready:${headingBlockId}`, 1, () => {
        const holder = el('span', 'nd-ready');
        holder.contentEditable = 'false';
        const offer = button('nd-ready-btn', '', 'Max asks you one question on this section. Only when you press this.', () =>
          press(headingBlockId),
        );
        offer.append(agentDot('max'), document.createTextNode('Ready to check this?'));
        offer.setAttribute('aria-label', 'Ready to check this? Max asks you one question on this section');
        holder.append(offer);
        return holder;
      }),
    );
  }
  return out;
}

/**
 * Remove · Keep, one control per block that carries pending edits.
 *
 * **Grouped by block, not one per edit.** Two edits on the same block — Max asking a question and
 * then resolving it, which is the commonest pair there is — put two widgets at the same position,
 * and two absolutely-positioned widgets at the same position overlap into unreadable soup. It was
 * built the naive way first and that is exactly what it did.
 */
function editControls(doc: Node, ctx: ChromeContext): Decoration[] {
  const byPos = new Map<number, DocEditRecord[]>();
  for (const edit of [...ctx.edits, ...(ctx.keptEdits ?? [])]) {
    // The edit's own block before the tutorial part it also names: a hint line Max writes into a
    // part names the part too, and its Remove · Keep belongs beside the line, not on the
    // part card's top edge (live run, 4 Oct 2026).
    const hits = edit.blockIds.map((id) => blockPos(doc, id)).filter((hit) => hit !== null);
    // Older stale Keep buttons could resolve an edit after it had left the live list. Those
    // records were saved with no block ids, while the kept text still has its author timestamp.
    const target = hits.find((hit) => hit.node.type.name !== 'tut_part') ?? hits[0] ??
      (edit.status === 'kept' ? keptTextTarget(doc, edit) : null);
    if (!target) continue;
    const at = byPos.get(target.pos) ?? [];
    at.push(edit);
    byPos.set(target.pos, at);
  }

  const out: Decoration[] = [];
  for (const [pos, edits] of byPos) {
    // A kept edit remains here as a chat link. Its widget must get a new DOM node when the
    // actions disappear; ProseMirror reuses a widget whose key is unchanged.
    const key = `edits:${edits.map((e) => `${e.editId}:${e.status}`).join(',')}`;
    out.push(
      widget(pos + 1, key, -1, () => {
        const holder = el('div', 'nd-editctl');
        for (const edit of edits) {
          const name = AGENT_NAME[edit.author];
          const row = el('div', `nd-editctl-one nd-${edit.author}`);
          row.append(button('nd-editctl-who nd-editctl-link', `${name} wrote this ↗`, `View ${name}'s response in Doc chat`, () =>
            ctx.onFocusEdit(edit.messageId, edit.blockIds),
          ));
          if (edit.status === 'kept') {
            row.classList.add('nd-editctl-kept');
            holder.append(row);
            continue;
          }
          if (edit.why) {
            const why = el('span', 'nd-editctl-why', edit.why);
            why.title = edit.why;
            row.append(why);
          }
          const actions = el('div', 'nd-editctl-row');
          actions.append(
            button('nd-editctl-btn', 'Remove', `Take ${name}'s edit out again`, () =>
              ctx.onRemoveEdit(edit.editId),
            ),
            el('span', 'nd-editctl-dot', '·'),
            button('nd-editctl-btn', 'Keep', 'Keep the text and drop the colour', () =>
              ctx.onKeepEdit(edit.editId),
            ),
          );
          row.append(actions);
          holder.append(row);
        }
        return holder;
      }),
    );
  }
  return out;
}

function keptTextTarget(doc: Node, edit: DocEditRecord): { pos: number; node: Node } | null {
  const created = Date.parse(edit.createdAt);
  if (!Number.isFinite(created)) return null;
  let closest: { pos: number; node: Node; gap: number } | null = null;
  doc.descendants((node, pos) => {
    if (!node.isTextblock || !blockAttrs(node).blockId) return true;
    node.descendants((child) => {
      if (!child.isText) return true;
      for (const mark of child.marks) {
        if (mark.type.name !== 'author' || mark.attrs.by !== edit.author || mark.attrs.editId !== null) continue;
        const gap = Math.abs(Number(mark.attrs.at) - created);
        if (gap <= 5000 && (!closest || gap < closest.gap)) closest = { pos, node, gap };
      }
      return false;
    });
    return false;
  });
  return closest;
}

function suggestionControls(doc: Node, ctx: ChromeContext): Decoration[] {
  const out: Decoration[] = [];
  for (const suggestion of ctx.suggestions) {
    const target = blockPos(doc, suggestion.blockId);
    if (!target) continue;
    const name = AGENT_NAME[suggestion.author];
    out.push(
      widget(target.pos + 1, `sg:${suggestion.suggestionId}`, -1, () => {
        const card = el('div', `nd-suggest nd-${suggestion.author}`);
        card.append(el('div', 'nd-suggest-who', `${name} suggests a change`));
        if (suggestion.note) card.append(el('div', 'nd-suggest-note', suggestion.note));
        const row = el('div', 'nd-suggest-row');
        row.append(
          button('nd-suggest-accept', 'Accept', 'Take the change', () =>
            ctx.onAcceptSuggestion(suggestion.suggestionId),
          ),
          button('nd-suggest-reject', 'Reject', 'Leave your words exactly as they are', () =>
            ctx.onRejectSuggestion(suggestion.suggestionId),
          ),
        );
        card.append(row);
        return card;
      }),
    );
  }
  return out;
}

/**
 * The agents' cursors.
 *
 * A cursor that is mid-edit is drawn at the **reveal frontier** — the character the animation has
 * just written — rather than at the end of its target block, which is the difference between a
 * flag hovering near a paragraph and a cursor that is visibly doing the typing.
 */
function agentCursors(state: EditorState, ctx: ChromeContext): Decoration[] {
  if (ctx.frozen) return [];
  const out: Decoration[] = [];
  const running = revealKey.getState(state)?.runs ?? [];
  for (const cursor of ctx.cursors) {
    if (cursor.state === 'idle') continue;
    const run = running.find((r) => r.author === cursor.author);
    let pos: number | null = run ? frontierOf(state.doc, run) : null;
    if (pos === null && cursor.blockId) {
      const target = blockPos(state.doc, cursor.blockId);
      // Just inside the block's closing token, so the flag sits at the end of its last line.
      if (target) pos = target.pos + target.node.nodeSize - 1;
    }
    if (pos === null) continue;
    const at = Math.max(0, Math.min(pos, state.doc.content.size));
    const typing = run !== undefined || cursor.state === 'typing';
    out.push(
      widget(at, `cursor:${cursor.author}:${typing ? 'typing' : 'thinking'}`, 1, () => {
        const holder = el('span', `nd-cursor nd-${cursor.author}${typing ? ' nd-cursor-typing' : ''}`);
        holder.append(el('span', 'nd-cursor-caret'));
        const flag = el('span', 'nd-cursor-flag');
        flag.append(el('span', 'nd-cursor-glyph', cursor.author === 'ellie' ? '✎' : '?'));
        flag.append(el('span', 'nd-cursor-name', AGENT_NAME[cursor.author]));
        if (!typing) flag.append(el('span', 'nd-cursor-think', '···'));
        holder.append(flag);
        return holder;
      }),
    );
  }
  return out;
}

/**
 * The persistent highlight on a span that has a thread (§3: "The span keeps a highlight that
 * jumps to its thread").
 *
 * The quote is located by **verbatim match** inside its block, and a quote that no longer matches
 * highlights nothing: the learner has edited the text the question was about, and painting a
 * highlight over whichever characters happen to be at those offsets now would attach their
 * question to words nobody asked about.
 */
function spanHighlights(doc: Node, ctx: ChromeContext): Decoration[] {
  const out: Decoration[] = [];
  for (const thread of ctx.spanThreads) {
    const target = blockPos(doc, thread.blockId);
    if (!target || !thread.quote) continue;
    const base = target.pos + 1;
    const text = target.node.textBetween(0, target.node.content.size, '\n', ' ');
    const index = text.indexOf(thread.quote);
    if (index < 0) continue;
    const from = base + index;
    const to = from + thread.quote.length;
    if (to > base + target.node.content.size) continue;
    out.push(
      Decoration.inline(from, to, {
        class: 'nd-threadspan',
        'data-thread-id': thread.threadId,
        title: 'Open the thread about this',
      }),
    );
  }
  return out;
}

function build(state: EditorState, ctx: ChromeContext): DecorationSet {
  return DecorationSet.create(state.doc, [
    ...provenanceChips(state.doc, ctx),
    ...commentBadges(state.doc, ctx),
    ...blockToolbars(state.doc, ctx),
    ...blockActionLines(state.doc, ctx),
    ...objectiveDecorations(state.doc, ctx),
    ...recommendationCards(state.doc, ctx),
    ...readyChecks(state.doc, ctx),
    ...editControls(state.doc, ctx),
    ...suggestionControls(state.doc, ctx),
    ...spanHighlights(state.doc, ctx),
    ...agentCursors(state, ctx),
  ]);
}

/**
 * **A chip's words, for chrome this plugin does not draw** (a table row's chip, `tableview.ts`):
 * through the open notebook's sources when there is one (C1), else `provenanceLabel` as before.
 * Read from the chrome plugin's own context, so those plugins need no wiring of their own.
 */
export function citationFor(state: EditorState, pages: readonly number[]): string {
  const plugin = chromeKey.get(state);
  const context = plugin?.spec.chromeContext as (() => ChromeContext) | undefined;
  return chipLabel(pages, context?.().sources, () => provenanceLabel(pages, null));
}

/**
 * `context()` is read on every rebuild rather than captured, so the store can hand the plugin a
 * plain object rebuilt from `$state` on each call — a Svelte proxy must never be retained here
 * (this app has been bitten by a `$state` proxy reaching code that clones, STATUS bug 2).
 */
export function chromePlugin(context: () => ChromeContext): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: chromeKey,
    // Read by `citationFor`: chips drawn outside this plugin (a table row's) label through it too.
    chromeContext: context,
    state: {
      init(_config, state): DecorationSet {
        return build(state, context());
      },
      apply(tr, value, _old, newState): DecorationSet {
        // A structural change (a split, a paste, an agent's new blocks, an ingest window) can
        // add or remove chips and controls; anything else only moves them.
        const structural = tr.docChanged && tr.doc.childCount !== _old.doc.childCount;
        /**
         * A node's markup changed (its attrs, or its type): `assignMissingBlockIds` minting ids,
         * a lift or a wrap. Mapping drops a decoration on a node that was replaced, and the
         * objectives' fills are exactly that (found when a list item's first id was minted and
         * every fill vanished). Never a keystroke: typing is plain `ReplaceStep`s and marks.
         */
        const remarked = tr.steps.some((step) => step instanceof ReplaceAroundStep || step instanceof AttrStep);
        if (remarked) return build(newState, context());
        if (tr.getMeta(chromeKey) || structural) return build(newState, context());
        if (tr.docChanged) return value.map(tr.mapping, tr.doc);
        return value;
      },
    },
    view() {
      // A preview left open would outlive the editor it points into (a different deck opened).
      return {
        destroy: () => {
          closeSourcePopover();
          closeCommentPopover();
        },
      };
    },
    props: {
      decorations(state): DecorationSet | undefined {
        return chromeKey.getState(state);
      },
      handleClick(view, _pos, event): boolean {
        const target = event.target as HTMLElement | null;
        const span = target?.closest?.('[data-thread-id]') as HTMLElement | null;
        const threadId = span?.getAttribute('data-thread-id');
        if (!threadId || !view.dom.contains(span)) return false;
        context().onFocusThread(threadId);
        return false; // the caret still lands where they clicked
      },
    },
  });
}

// ── what follows the caret and the typing: the caret's block, and the note slots ────────────

export const focusKey = new PluginKey<DecorationSet>('chattered:focus');

/** The note slot's placeholder (C6). Shown by CSS from `data-placeholder` while the slot is empty. */
export const NOTE_SLOT_PLACEHOLDER = 'Add your own note…';

/**
 * Two classes the chrome set cannot carry, because it is only rebuilt on structural changes and
 * these change on every keystroke and every caret move:
 *
 *  - `nd-caret-block` on the top-level block holding the caret, so its toolbar shows without a
 *    hover (§4.1: "a tap or the keyboard reaches it"). notes.css shows it only while the editor
 *    has focus, so a learner reading with the pointer elsewhere sees one toolbar, not two.
 *  - `nd-noteslot` on each note slot, plus `nd-noteslot-empty` and its placeholder while the
 *    learner has not written in it. A class, not a widget: a widget in an empty paragraph would
 *    sit where the caret goes. Once they type, the slot is their text like any other (the
 *    authorship plugin marks it), and the placeholder is gone on the same keystroke.
 *
 * Cheap: one pass over the top-level blocks (an overview has a few dozen) per change.
 */
function focusDecorations(state: EditorState): DecorationSet {
  const decorations: Decoration[] = [];
  const caret = state.selection.$from.index(0);
  // In a concept card the caret's block is the card's row it is in (§11.2): the core line, or a
  // block in the depth.
  const row = cardRowAt(state.doc, state.selection.from);
  if (row && hasToolbar(row.node)) {
    decorations.push(Decoration.node(row.pos, row.pos + row.node.nodeSize, { class: 'nd-caret-block' }));
  }
  state.doc.forEach((node, offset, index) => {
    const classes: string[] = [];
    const empty = isEmptyNoteSlot(node);
    if (isNoteSlot(node)) classes.push(empty ? 'nd-noteslot nd-noteslot-empty' : 'nd-noteslot');
    if (index === caret && hasToolbar(node)) classes.push('nd-caret-block');
    if (classes.length === 0) return;
    decorations.push(
      Decoration.node(offset, offset + node.nodeSize, {
        class: classes.join(' '),
        ...(empty ? { 'data-placeholder': NOTE_SLOT_PLACEHOLDER } : {}),
      }),
    );
  });
  return DecorationSet.create(state.doc, decorations);
}

export function focusPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: focusKey,
    state: {
      init: (_config, state) => focusDecorations(state),
      apply: (tr, value, _old, next) => (tr.docChanged || tr.selectionSet ? focusDecorations(next) : value),
    },
    props: {
      decorations(state): DecorationSet | undefined {
        return focusKey.getState(state);
      },
    },
  });
}
