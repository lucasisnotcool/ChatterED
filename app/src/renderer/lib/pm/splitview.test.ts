import { describe, expect, it } from 'vitest';
import { EditorState, Plugin, PluginKey, TextSelection, type Transaction } from 'prosemirror-state';
import { history, redo, undo, undoDepth } from 'prosemirror-history';
import { splitBlock } from 'prosemirror-commands';
import type { Node } from 'prosemirror-model';
import { authorMark, notesSchema } from '../../../shared/doc/schema.js';
import { AGENT_TR, authorship } from './authorship.js';
import { MIRROR_TR, SplitLink, caretBefore, isHistory, mirrorPlugins, mirrorState, plainMetas, type Relay } from './splitview.js';

const NOW = 1_700_000_000_000;
const bumpKey = new PluginKey('test:bump');

function para(blockId: string, text: string, by: 'ingest' | 'ellie' | 'user' = 'ingest'): Node {
  return notesSchema.node(
    'paragraph',
    { blockId, pages: [1], reason: null, objectiveIds: [] },
    text ? [notesSchema.text(text, [authorMark(by, null, 1)])] : [],
  );
}

function docOf(...blocks: Node[]): Node {
  return notesSchema.node('doc', null, blocks);
}

/** Counts the bumps it sees: stands in for the chrome's redraw meta. */
function bumpCounter(): Plugin<number> {
  return new Plugin<number>({
    key: bumpKey,
    state: { init: () => 0, apply: (tr, n) => (tr.getMeta(bumpKey) ? n + 1 : n) },
  });
}

const relay: Relay = (from, to) => {
  if (!from.getMeta(bumpKey)) return false;
  to.setMeta(bumpKey, true);
  return true;
};

/** A primary with authorship + history and a secondary built the way `NotesEditor` builds it. */
function pair(doc: Node, guard?: Plugin) {
  let primaryState = EditorState.create({ doc, plugins: [authorship({ now: () => NOW }), history(), bumpCounter()] });
  let secondaryState = EditorState.create({
    doc,
    plugins: mirrorPlugins([history(), bumpCounter(), ...(guard ? [guard] : [])]),
  });
  const primary = {
    get state() {
      return primaryState;
    },
    dispatch(tr: Transaction) {
      const { state, transactions } = primaryState.applyTransaction(tr);
      link.queue(transactions);
      primaryState = state;
      link.drain();
    },
  };
  const secondary = {
    get state() {
      return secondaryState;
    },
    updateState(next: EditorState) {
      secondaryState = next;
    },
    dispatch(tr: Transaction) {
      link.dispatchSecondary(tr);
    },
  };
  const link: SplitLink = new SplitLink(primary, secondary, relay);
  return { primary, secondary, link };
}

function caret(state: EditorState, pos: number): Transaction {
  return state.tr.setSelection(TextSelection.create(state.doc, pos));
}

/** The `author.by` of the character just after `pos`. */
function authorAt(state: EditorState, pos: number): string | null {
  const $pos = state.doc.resolve(pos);
  const node = $pos.parent.childAfter($pos.parentOffset).node;
  return (node?.marks.find((m) => m.type.name === 'author')?.attrs.by as string | undefined) ?? null;
}

function scrolls(state: EditorState): number {
  return (state as unknown as { scrollToSelection: number }).scrollToSelection;
}

describe('splitview: two views of one document in lockstep', () => {
  const base = () => docOf(para('a', 'Figure 1 shows the circuit.'), para('b', 'Part (a): find the current.'), para('c', ''));

  it('replays the primary’s typing into the secondary without moving its caret or scrolling it', () => {
    const { primary, secondary } = pair(base());
    secondary.dispatch(caret(secondary.state, 3));
    const scrolled = scrolls(secondary.state);
    const end = primary.state.doc.content.size - 1;
    primary.dispatch(caret(primary.state, end));
    primary.dispatch(primary.state.tr.insertText('I = 2 A').scrollIntoView());

    expect(secondary.state.doc.eq(primary.state.doc)).toBe(true);
    expect(secondary.state.selection.from).toBe(3);
    expect(scrolls(secondary.state)).toBe(scrolled);
    // The secondary never holds a history: undo lives on the primary.
    expect(undoDepth(secondary.state)).toBe(0);
    expect(undoDepth(primary.state)).toBe(1);
  });

  it('forwards the secondary’s typing to the primary as the learner’s, stamped there, echoed back', () => {
    const { primary, secondary } = pair(base());
    const end = secondary.state.doc.content.size - 1;
    secondary.dispatch(caret(secondary.state, end));
    secondary.dispatch(secondary.state.tr.insertText('V = IR').scrollIntoView());

    expect(primary.state.doc.lastChild!.textContent).toBe('V = IR');
    expect(authorAt(primary.state, end)).toBe('user');
    // The stamp the primary appended came back: the secondary's copy is the learner's too.
    expect(authorAt(secondary.state, end)).toBe('user');
    expect(secondary.state.doc.eq(primary.state.doc)).toBe(true);
    // The secondary's own request to scroll to its caret survived the round trip.
    expect(secondary.state.selection.from).toBe(end + 6);
    expect(scrolls(secondary.state)).toBeGreaterThan(0);
    // The primary's caret followed the learner, and the edit is in its history.
    expect(primary.state.selection.from).toBe(end + 6);
    expect(undoDepth(primary.state)).toBe(1);
  });

  it('maps the secondary’s caret through an agent’s edit above it (no jump)', () => {
    const { primary, secondary } = pair(base());
    const at = 3 + 'Figure 1 shows the circuit.'.length + 2 + 4; // inside "Part (a)…"
    secondary.dispatch(caret(secondary.state, at));
    const before = secondary.state.doc.textBetween(at, at + 3);
    primary.dispatch(
      primary.state.tr.insert(0, para('h', 'Hint: use Ohm’s law.', 'ellie')).setMeta(AGENT_TR, true).setMeta('addToHistory', false),
    );
    expect(secondary.state.doc.eq(primary.state.doc)).toBe(true);
    const moved = secondary.state.selection.from;
    expect(secondary.state.doc.textBetween(moved, moved + 3)).toBe(before);
    expect(authorAt(secondary.state, 1)).toBe('ellie');
  });

  it('replays appended transactions, in order: a split mints its block id once, in the primary', () => {
    const { primary, secondary } = pair(base());
    secondary.dispatch(caret(secondary.state, 5));
    splitBlock(secondary.state, (tr) => secondary.dispatch(tr));
    expect(primary.state.doc.childCount).toBe(4);
    const ids = new Set<string>();
    primary.state.doc.forEach((node) => ids.add(node.attrs.blockId as string));
    expect(ids.size).toBe(4);
    expect(secondary.state.doc.eq(primary.state.doc)).toBe(true);
  });

  it('runs undo and redo pressed in the secondary on the primary’s history, and puts the secondary’s caret there', () => {
    const { primary, secondary, link } = pair(base());
    const original = primary.state.doc;
    const end = secondary.state.doc.content.size - 1;
    secondary.dispatch(caret(secondary.state, end));
    secondary.dispatch(secondary.state.tr.insertText('R = 5'));
    // The learner scrolls the primary elsewhere meanwhile; its caret stays where they put it.
    primary.dispatch(caret(primary.state, 2));

    expect(link.history('undo')).toBe(true);
    expect(primary.state.doc.eq(original)).toBe(true);
    expect(secondary.state.doc.eq(original)).toBe(true);
    // The bookmark was the secondary's caret before the edit, not the primary's.
    expect(secondary.state.selection.from).toBe(end);
    expect(link.history('redo')).toBe(true);
    expect(secondary.state.doc.lastChild!.textContent).toBe('R = 5');
    expect(secondary.state.doc.eq(primary.state.doc)).toBe(true);
    // Nothing left to redo: reported, nothing changes.
    expect(link.history('redo')).toBe(false);
  });

  it('bookmarks the edit, not a caret that lagged behind it, so undo does not jump away', () => {
    const { primary, secondary, link } = pair(base());
    const end = secondary.state.doc.content.size - 1;
    // The secondary's state still has its caret at the top (a click not read yet) when the
    // keystroke lands at the end.
    secondary.dispatch(caret(secondary.state, 1));
    secondary.dispatch(secondary.state.tr.insertText('Z', end));
    expect(link.history('undo')).toBe(true);
    expect(secondary.state.selection.from).toBe(end);
    expect(primary.state.selection.from).toBe(end);
  });

  it('lets the primary undo an edit made in the secondary', () => {
    const { primary, secondary } = pair(base());
    const original = primary.state.doc;
    secondary.dispatch(caret(secondary.state, 1));
    secondary.dispatch(secondary.state.tr.insertText('Look: '));
    undo(primary.state, (tr) => primary.dispatch(tr));
    expect(secondary.state.doc.eq(original)).toBe(true);
    redo(primary.state, (tr) => primary.dispatch(tr));
    expect(secondary.state.doc.textContent).toContain('Look: Figure 1');
  });

  it('relays only the metas it is told to: a chrome redraw reaches the secondary, a selection move does not', () => {
    const { primary, secondary } = pair(base());
    const doc = secondary.state;
    primary.dispatch(caret(primary.state, 4));
    expect(secondary.state).toBe(doc);
    primary.dispatch(primary.state.tr.setMeta(bumpKey, true));
    expect(bumpKey.getState(secondary.state)).toBe(1);
  });

  it('keeps appending plugins in the secondary off mirrored transactions, but on its own', () => {
    let appended = 0;
    const guard = new Plugin({
      key: new PluginKey('test:guard'),
      appendTransaction(trs, _old, state) {
        if (!trs.some((tr) => tr.docChanged)) return null;
        appended++;
        return state.tr.setMeta('guarded', true);
      },
    });
    const { primary, secondary } = pair(base(), guard);
    primary.dispatch(primary.state.tr.insertText('x', 2));
    expect(appended).toBe(0);
    secondary.dispatch(secondary.state.tr.insertText('y', 2));
    expect(appended).toBe(1);
    expect(secondary.state.doc.eq(primary.state.doc)).toBe(true);
  });

  it('repairs a secondary that drifted: the primary’s document wins', () => {
    const { primary, secondary } = pair(base());
    secondary.updateState(secondary.state.apply(secondary.state.tr.insertText('DRIFT', 2).setMeta(MIRROR_TR, true)));
    primary.dispatch(primary.state.tr.insertText('ok ', 2));
    expect(secondary.state.doc.eq(primary.state.doc)).toBe(true);
    expect(secondary.state.doc.textContent).not.toContain('DRIFT');
  });

  it('stops replaying once closed', () => {
    const { primary, secondary, link } = pair(base());
    const doc = secondary.state.doc;
    link.close();
    primary.dispatch(primary.state.tr.insertText('later', 2));
    expect(secondary.state.doc).toBe(doc);
  });
});

describe('splitview helpers', () => {
  it('keeps a caret the edit touches, and falls back to the change for one it does not', () => {
    const state = EditorState.create({ doc: docOf(para('a', 'abcdef')) }).apply(caret(EditorState.create({ doc: docOf(para('a', 'abcdef')) }), 4));
    expect(caretBefore(state, [state.tr.insertText('x', 4)]).from).toBe(4);
    expect(caretBefore(state, [state.tr.delete(3, 4)]).from).toBe(4);
    expect(caretBefore(state, [state.tr.insertText('x', 1)]).from).toBe(1);
    expect(caretBefore(state, [state.tr]).from).toBe(4);
  });

  it('carries plain metas, never a plugin’s own', () => {
    const state = EditorState.create({ doc: docOf(para('a', 'x')) });
    const tr = state.tr.setMeta('uiEvent', 'paste').setMeta(bumpKey, true).setMeta('chattered:tutorial-input', 'blank');
    expect(Object.fromEntries(plainMetas(tr))).toEqual({ uiEvent: 'paste', 'chattered:tutorial-input': 'blank' });
  });

  it('mirrors nothing for a pure selection move, and reports a step that does not fit', () => {
    const one = EditorState.create({ doc: docOf(para('a', 'abc')) });
    expect(mirrorState(one, [caret(one, 2)])).toBeNull();
    const longer = EditorState.create({ doc: docOf(para('a', 'abcdefghij')) });
    const far = longer.tr.insertText('!', 11);
    expect(mirrorState(one, [far])).toBe('desync');
  });

  it('drops the history plugin from the secondary’s list', () => {
    const plugins = mirrorPlugins([history(), bumpCounter()]);
    expect(plugins).toHaveLength(1);
    expect(isHistory(plugins[0]!)).toBe(false);
    expect(isHistory(history())).toBe(true);
  });
});
