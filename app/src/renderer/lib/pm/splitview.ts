/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * A SECOND VIEW OF THE SAME DOCUMENT (the tutorial's Split, Word's Window ▸ Split, 4 Oct 2026)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The tutorial pane can show the sheet twice, one view above the other, each scrolling on its own:
 * the figure and the stem parked in the top one while the learner answers in the bottom one.
 *
 * **The primary view stays the only source of truth.** It is the `EditorView` the `DocStore`
 * holds: saving, the agents' edits, authorship stamps, block ids and the undo history all happen
 * there and nowhere else. The second view is *not* a second `EditorView` on the same
 * `EditorState`, which would be the obvious way and is wrong: the state carries the selection
 * and the scroll request, so a keystroke in the bottom view would drag the top one to the caret.
 *
 * Instead the secondary has its **own** `EditorState` over the same document, kept in lockstep by
 * replaying steps:
 *
 *  - **primary → secondary.** Every transaction the primary applied (the dispatched one and every
 *    one its plugins appended: an agent edit, a reveal tick, the learner's own typing, an undo) is
 *    replayed onto the secondary as plain steps, never scrolled, never in a history, carrying only
 *    the metas the caller relays (the chrome redraws, a reveal's progress). The secondary's
 *    selection is mapped through them, so the top view stays exactly where it was.
 *  - **secondary → primary.** A transaction the learner makes in the secondary is applied there
 *    (so its own plugins, input rules and IME see it as usual) and its steps are dispatched on the
 *    primary as learner input, with the caret moved to the same place first, so the history
 *    bookmarks the right spot. What the primary's plugins append in reply (the author mark, a
 *    minted block id) comes back to the secondary in the same view update.
 *  - **undo and redo** pressed in the secondary run on the primary's history, without scrolling
 *    it; the secondary takes the caret the undo restored and scrolls to it.
 *
 * Both documents are compared after every exchange; a mismatch (which only an ordering accident
 * could cause) puts the primary's document into the secondary whole, so the two can never drift.
 *
 * Nothing here touches the DOM: `SplitLink` drives two objects with `state`/`dispatch` and
 * `state`/`updateState`, which an `EditorView` is and which the tests fake.
 */

import { Plugin, Selection, TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import type { Node } from 'prosemirror-model';
import { Mapping } from 'prosemirror-transform';
import { redoNoScroll, undoNoScroll } from 'prosemirror-history';

/** Set on every transaction the link replays into the other view. */
export const MIRROR_TR = 'chattered:mirror';

/** Copies the metas one view's transaction should carry into the other's. True when it set any. */
export type Relay = (from: Transaction, to: Transaction) => boolean;

/** The view that owns the document: an `EditorView` (or a test's stand-in). */
export interface PrimarySide {
  readonly state: EditorState;
  dispatch(tr: Transaction): void;
}

/** The second view: the link updates it directly, never through its own dispatch. */
export interface SecondarySide {
  readonly state: EditorState;
  updateState(state: EditorState): void;
}

/** Transaction metas are private in the typings, but the field is plain and stable (1.x). */
function metasOf(tr: Transaction): Record<string, unknown> {
  return (tr as unknown as { meta: Record<string, unknown> }).meta;
}

/**
 * The metas worth carrying from the secondary's transaction to the primary's: the plain string
 * ones (`uiEvent`, `paste`, `composition`, `addToHistory`, a tutorial blank's input tag), never a
 * plugin's own (its key ends in `$`): those belong to the secondary's plugin instances.
 */
export function plainMetas(tr: Transaction): [string, unknown][] {
  return Object.entries(metasOf(tr)).filter(
    ([key]) => !key.includes('$') && key !== 'appendedTransaction' && key !== MIRROR_TR,
  );
}

/** The same selection in an equal document (a `Mapping` with no steps re-resolves it there). */
export function sameSelection(selection: Selection, doc: Node): Selection {
  return selection.map(doc, new Mapping());
}

/** `source`'s steps onto `tr`. False when one does not fit (a failed step, or a position past the end). */
function replay(tr: Transaction, source: Transaction): boolean {
  try {
    for (const step of source.steps) {
      if (tr.maybeStep(step).failed) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * **Primary → secondary**: `target` with every document step of `applied` replayed onto it, one
 * transaction per applied one (so each relayed meta lands where it was set). Null when nothing
 * changed (a selection move in the primary is the primary's business); `'desync'` when a step
 * does not fit, which only a document that already drifted can cause.
 */
export function mirrorState(
  target: EditorState,
  applied: readonly Transaction[],
  relay?: Relay,
): EditorState | null | 'desync' {
  let state = target;
  let changed = false;
  for (const source of applied) {
    const tr = state.tr;
    if (!replay(tr, source)) return 'desync';
    const relayed = relay ? relay(source, tr) : false;
    if (!tr.docChanged && !relayed) continue;
    tr.setMeta(MIRROR_TR, true).setMeta('addToHistory', false);
    state = state.apply(tr);
    changed = true;
  }
  return changed ? state : null;
}

/**
 * **Secondary → primary**: one transaction on `primary` replaying the steps of everything the
 * secondary applied for one dispatch (its own transaction and anything its plugins appended),
 * as learner input, ending with the caret where the secondary's is. `'desync'` when a step does
 * not fit.
 */
export function forwardTransaction(
  primary: EditorState,
  applied: readonly Transaction[],
  selection: Selection,
): Transaction | 'desync' {
  const tr = primary.tr;
  for (const source of applied) {
    if (!replay(tr, source)) return 'desync';
  }
  const root = applied[0];
  if (root) for (const [key, value] of plainMetas(root)) tr.setMeta(key, value);
  try {
    tr.setSelection(sameSelection(selection, tr.doc));
  } catch {
    // A caret that does not resolve in the result is left where the steps mapped it.
  }
  return tr;
}

/**
 * Where the primary's caret goes before the secondary's edit is replayed there: the secondary's
 * caret, when the edit touches it (typing, Backspace), else the start of the change. The history
 * bookmarks this, and an undo restores it. A view's selection can lag a click by a frame (the
 * DOM's `selectionchange` is asynchronous), and a stale caret far from the edit would send the
 * undo there.
 */
export function caretBefore(state: EditorState, applied: readonly Transaction[]): Selection {
  const selection = state.selection;
  let range: { from: number; to: number } | null = null;
  const first = applied.find((tr) => tr.steps.length > 0);
  first?.steps[0]?.getMap().forEach((from, to) => {
    range ??= { from, to };
  });
  if (!range) return selection;
  const { from, to } = range;
  if (selection.to >= from && selection.from <= to) return selection;
  try {
    return TextSelection.near(state.doc.resolve(Math.min(from, state.doc.content.size)));
  } catch {
    return selection;
  }
}

/** The secondary made to hold the primary's document again, its caret kept near where it was. */
export function resyncTransaction(target: EditorState, source: Node): Transaction {
  const tr = target.tr.replaceWith(0, target.doc.content.size, source.content);
  const at = Math.min(target.selection.from, tr.doc.content.size);
  tr.setSelection(Selection.near(tr.doc.resolve(at)));
  return tr.setMeta(MIRROR_TR, true).setMeta('addToHistory', false);
}

/** `prosemirror-history`'s plugin: its key (internal in the typings) is `history$`. */
export function isHistory(plugin: Plugin): boolean {
  return (plugin as unknown as { key: string }).key.startsWith('history$');
}

/**
 * The secondary's plugin list, from the primary's kind of list:
 *
 *  - **no history** (`prosemirror-history`'s plugin, key `history$`): undo lives on the primary;
 *  - a plugin that appends transactions (the table guard, the diagram's id repair) **does not
 *    append to a mirrored one**: the primary's copy already did, and its result is in the steps.
 *    It still appends to the learner's own edits in the secondary, which are then forwarded.
 *
 * Authorship and the block-id minter are simply not given to the secondary (the caller builds
 * its list without them): the primary's stamp comes back as steps.
 */
export function mirrorPlugins(plugins: readonly Plugin[]): Plugin[] {
  return plugins
    .filter((plugin) => !isHistory(plugin))
    .map((plugin) => {
      const append = plugin.spec.appendTransaction;
      if (!append) return plugin;
      return new Plugin({
        ...plugin.spec,
        appendTransaction(transactions, old, next) {
          if (transactions.some((tr) => tr.getMeta(MIRROR_TR))) return null;
          return append.call(this, transactions, old, next);
        },
      });
    });
}

/**
 * Two views of one document, kept in lockstep. The primary's host calls `queue` with the
 * transactions it applied *before* its `updateState`, and `drain` after, so a transaction a
 * plugin view dispatches during that update is replayed after the one that caused it. The
 * secondary's `dispatchTransaction` is `dispatchSecondary`.
 */
export class SplitLink {
  readonly #primary: PrimarySide;
  readonly #secondary: SecondarySide;
  readonly #relay: Relay | undefined;
  #pending: Transaction[][] = [];
  #draining = false;
  /** While the secondary's edit is on its way into the primary: what the primary applied. */
  #echo: Transaction[] | null = null;
  #closed = false;

  constructor(primary: PrimarySide, secondary: SecondarySide, relay?: Relay) {
    this.#primary = primary;
    this.#secondary = secondary;
    this.#relay = relay;
  }

  /** The secondary is going away: nothing more is replayed into it. */
  close(): void {
    this.#closed = true;
    this.#pending = [];
  }

  /** The primary applied these (the dispatched one first, then what its plugins appended). */
  queue(transactions: readonly Transaction[]): void {
    if (this.#closed) return;
    if (this.#echo) {
      this.#echo.push(...transactions);
      return;
    }
    if (transactions.length > 0) this.#pending.push([...transactions]);
  }

  /** Replay everything queued into the secondary, in order. */
  drain(): void {
    if (this.#draining || this.#closed) return;
    this.#draining = true;
    try {
      while (this.#pending.length > 0) {
        const batch = this.#pending.shift()!;
        const secondary = this.#secondary;
        const next = mirrorState(secondary.state, batch, this.#relay);
        if (next === 'desync') this.#resync();
        else if (next) secondary.updateState(next);
      }
      this.#check();
    } finally {
      this.#draining = false;
    }
  }

  /** `queue` and `drain` together, for a primary that is already up to date. */
  primaryApplied(transactions: readonly Transaction[]): void {
    this.queue(transactions);
    this.drain();
  }

  /** The secondary view's `dispatchTransaction`. */
  dispatchSecondary(tr: Transaction): void {
    const secondary = this.#secondary;
    const before = secondary.state;
    const { state: mine, transactions } = before.applyTransaction(tr);
    if (this.#closed || !transactions.some((t) => t.docChanged)) {
      secondary.updateState(mine);
      // The primary's caret follows the learner's, so the store's "where is the caret" (Ask about
      // a selection, ⌘↩ on an answer) means the place they are working in.
      if (!this.#closed && tr.selectionSet) this.#placePrimary(mine.selection);
      return;
    }
    // The caret first, in a transaction of its own: the history bookmarks the selection *before*
    // an edit, and an undo restores that.
    this.#placePrimary(caretBefore(before, transactions));
    const primary = this.#primary;
    const forward = forwardTransaction(primary.state, transactions, mine.selection);
    if (forward === 'desync') {
      this.#resync();
      return;
    }
    const echo: Transaction[] = [];
    this.#echo = echo;
    try {
      primary.dispatch(forward);
    } finally {
      this.#echo = null;
    }
    if (echo[0] !== forward) {
      // The primary did not take it (a filter): the secondary shows the primary's document.
      secondary.updateState(before);
      this.#check();
      return;
    }
    const answered = mirrorState(mine, echo.slice(1), this.#relay);
    if (answered === 'desync') {
      secondary.updateState(mine);
      this.#resync();
      return;
    }
    secondary.updateState(answered ?? mine);
    this.#check();
  }

  /** ⌘Z / ⌘⇧Z in the secondary: the primary's history, the caret and the scroll the secondary's. */
  history(kind: 'undo' | 'redo'): boolean {
    if (this.#closed) return false;
    const primary = this.#primary;
    const command = kind === 'undo' ? undoNoScroll : redoNoScroll;
    const done = command(primary.state, (tr) => primary.dispatch(tr));
    if (!done) return false;
    this.drain();
    const secondary = this.#secondary;
    try {
      const caret = sameSelection(primary.state.selection, secondary.state.doc);
      secondary.updateState(
        secondary.state.apply(secondary.state.tr.setSelection(caret).scrollIntoView().setMeta(MIRROR_TR, true)),
      );
    } catch {
      // The caret stays where the replay mapped it.
    }
    return true;
  }

  #placePrimary(selection: Selection): void {
    const primary = this.#primary;
    let target: Selection;
    try {
      target = sameSelection(selection, primary.state.doc);
    } catch {
      return;
    }
    if (target.eq(primary.state.selection)) return;
    const echo: Transaction[] = [];
    const outer = this.#echo;
    this.#echo = echo;
    try {
      primary.dispatch(primary.state.tr.setSelection(target));
    } finally {
      this.#echo = outer;
    }
    // A selection move changes no document; anything a plugin appended to it (stored marks) is
    // the primary's own. A document change in reply would be news: replay it.
    if (echo.some((t) => t.docChanged)) {
      const next = mirrorState(this.#secondary.state, echo, this.#relay);
      if (next === 'desync') this.#resync();
      else if (next) this.#secondary.updateState(next);
    }
  }

  /** The two documents must be equal after every exchange; if not, the primary's wins. */
  #check(): void {
    if (!this.#secondary.state.doc.eq(this.#primary.state.doc)) this.#resync();
  }

  #resync(): void {
    const secondary = this.#secondary;
    secondary.updateState(secondary.state.apply(resyncTransaction(secondary.state, this.#primary.state.doc)));
  }
}

