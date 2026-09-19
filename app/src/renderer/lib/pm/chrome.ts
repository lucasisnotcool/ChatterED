/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THE CHROME AROUND THE WORDS (`collab-doc.md` §3, §5)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Everything the document shows that is *not* the document: the provenance chip on every block,
 * the agents' cursors, the Remove · Keep control on an applied edit, the Accept · Reject control
 * on a suggestion, and the persistent highlight on a span that has a thread.
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

import { Decoration, DecorationSet } from 'prosemirror-view';
import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import type { Node } from 'prosemirror-model';
import { blockAttrs, blockPos, eachBlock } from '../../../shared/doc/schema.js';
import type { AgentAuthor, DocEditRecord, QResolution, Rect, Suggestion } from '../../../shared/doc/types.js';
import { frontierOf, revealKey } from './reveal.js';

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

export interface ChromeContext {
  frozen: boolean;
  /** Hidden entirely while frozen (§3: "While frozen, no agent edits the doc"). */
  cursors: readonly AgentCursorView[];
  /** Status `applied` only — the edits that still wear their colour. */
  edits: readonly DocEditRecord[];
  /** Status `open` only. */
  suggestions: readonly Suggestion[];
  spanThreads: readonly SpanThreadView[];
  onRemoveEdit: (editId: string) => void;
  onKeepEdit: (editId: string) => void;
  onAcceptSuggestion: (suggestionId: string) => void;
  onRejectSuggestion: (suggestionId: string) => void;
  /** The provenance chip's click: open the slide modal at that page. */
  onOpenSlide: (page: number, rect: Rect | null) => void;
  onFocusThread: (threadId: string) => void;
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

/** The tag on a Q block: *open* while it waits, then how it ended (§5.3). */
export function qStatusLabel(status: string, resolution: QResolution | null): string {
  if (status !== 'resolved') return 'open';
  switch (resolution) {
    case 'you_got_this':
      return 'you got this';
    case 'partly_yours':
      return 'partly yours';
    case 'released':
      return 'released';
    default:
      return 'resolved';
  }
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
function widget(pos: number, key: string, side: number, build: () => HTMLElement): Decoration {
  return Decoration.widget(pos, build, { key, side, ignoreSelection: true, stopEvent: () => true });
}

// ── building the set ────────────────────────────────────────────────────────────────────────

function provenanceChips(doc: Node, ctx: ChromeContext): Decoration[] {
  const out: Decoration[] = [];
  eachBlock(doc, (node, pos, depth) => {
    if (depth > 0) return; // a q_block's children hang off the Q block's own chrome
    const { blockId, pages, reason } = blockAttrs(node);
    if (!blockId) return;
    const label = provenanceLabel(pages, reason);
    const page = pages[0] ?? (node.type.name === 'slide_figure' ? (node.attrs.page as number) : null);
    const rect = node.type.name === 'slide_figure' ? ((node.attrs.rect as Rect | null) ?? null) : null;
    out.push(
      widget(pos + 1, `prov:${blockId}:${label}`, -1, () => {
        const holder = el('span', 'nd-chip-holder');
        const chip = button('nd-chip', label, reason ? reason : `Open the source slide (${label})`, () => {
          if (page !== null) ctx.onOpenSlide(page, rect);
        });
        // A block with a reason and no page is ordinary (§2 allows either); a block with
        // neither is an ingest bug and says so in the one place a reader will see it.
        if (label === 'no source') chip.classList.add('nd-chip-bad');
        else if (page === null) chip.classList.add('nd-chip-flat');
        holder.append(chip);
        return holder;
      }),
    );
  });
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
  for (const edit of ctx.edits) {
    const target = edit.blockIds.map((id) => blockPos(doc, id)).find((hit) => hit !== null);
    if (!target) continue;
    const at = byPos.get(target.pos) ?? [];
    at.push(edit);
    byPos.set(target.pos, at);
  }

  const out: Decoration[] = [];
  for (const [pos, edits] of byPos) {
    const key = `edits:${edits.map((e) => e.editId).join(',')}`;
    out.push(
      widget(pos + 1, key, -1, () => {
        const holder = el('div', 'nd-editctl');
        for (const edit of edits) {
          const name = AGENT_NAME[edit.author];
          const row = el('div', `nd-editctl-one nd-${edit.author}`);
          row.append(el('span', 'nd-editctl-who', `${name} wrote this`));
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
    ...editControls(state.doc, ctx),
    ...suggestionControls(state.doc, ctx),
    ...spanHighlights(state.doc, ctx),
    ...agentCursors(state, ctx),
  ]);
}

/**
 * `context()` is read on every rebuild rather than captured, so the store can hand the plugin a
 * plain object rebuilt from `$state` on each call — a Svelte proxy must never be retained here
 * (this app has been bitten by a `$state` proxy reaching code that clones, STATUS bug 2).
 */
export function chromePlugin(context: () => ChromeContext): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: chromeKey,
    state: {
      init(_config, state): DecorationSet {
        return build(state, context());
      },
      apply(tr, value, _old, newState): DecorationSet {
        // A structural change (a split, a paste, an agent's new blocks, an ingest window) can
        // add or remove chips and controls; anything else only moves them.
        const structural = tr.docChanged && tr.doc.childCount !== _old.doc.childCount;
        if (tr.getMeta(chromeKey) || structural) return build(newState, context());
        if (tr.docChanged) return value.map(tr.mapping, tr.doc);
        return value;
      },
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
