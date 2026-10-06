import { describe, expect, it } from 'vitest';
import type { Node } from 'prosemirror-model';
import { EditorState, NodeSelection, TextSelection, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { blockPos, notesSchema } from '../../../shared/doc/schema.js';
import { CONCEPT_ROLES, type ConceptRole } from '../../../shared/doc/types.js';
import {
  CONCEPT_ROLE_LABEL,
  CardFolds,
  cardRowAt,
  cardRows,
  cardsRevealedByBlocks,
  cardsRevealedBySelection,
  cardsToOpen,
  coreLineAt,
  foldedHint,
  isAddedItem,
  isCardRow,
  roleLabel,
} from './conceptmodel.js';
import { conceptKey, conceptPlugin, openCards, revealBlocks, toggleCardTr } from './concept.js';
import { setSearchHit } from './searchhit.js';
import { setReading } from './readaloud.js';
import { eachBlock } from '../../../shared/doc/schema.js';

function para(blockId: string, text: string, reason: string | null = null): Node {
  return notesSchema.node('paragraph', { blockId, pages: [3], reason, objectiveIds: [] }, text ? [notesSchema.text(text)] : []);
}

function item(blockId: string, role: ConceptRole, children: Node[], reason: string | null = null): Node {
  return notesSchema.node('concept_item', { blockId, role, pages: [3], reason, objectiveIds: [] }, children);
}

function card(blockId: string, core: Node, items: Node[] = [], term = 'Gradient'): Node {
  return notesSchema.node('concept', { blockId, term, pages: [3], reason: null, objectiveIds: [] }, [core, ...items]);
}

/**
 * title paragraph · card c1 (core c1p; example i1 [i1a, i1b]; pitfall i2 [i2a]) · paragraph after
 * · card c2 with no depth (core c2p).
 */
function sample(): Node {
  return notesSchema.node('doc', null, [
    para('p0', 'Before the cards'),
    card('c1', para('c1p', 'Gradient: the direction of steepest ascent.'), [
      item('i1', 'example', [para('i1a', 'For f = x^2 it is 2x.'), para('i1b', 'At x = 3 that is 6.')]),
      item('i2', 'pitfall', [para('i2a', 'It is not the step size.')], 'a common slip'),
    ]),
    para('p1', 'After the cards'),
    card('c2', para('c2p', 'Step size: how far one update moves.'), [], 'Step size'),
  ]);
}

function posOf(doc: Node, blockId: string): number {
  const hit = blockPos(doc, blockId);
  if (!hit) throw new Error(`no ${blockId}`);
  return hit.pos;
}

/** A caret inside a block's text, one character in. */
function inside(doc: Node, blockId: string): number {
  return posOf(doc, blockId) + 2;
}

describe('what the learner reads on a card', () => {
  it('labels every role, and reads an unknown role as a note', () => {
    for (const role of CONCEPT_ROLES) expect(CONCEPT_ROLE_LABEL[role]).toMatch(/^[A-Z][a-z]+$/);
    expect(roleLabel('pitfall')).toBe('Pitfall');
    expect(roleLabel('intuition')).toBe('Intuition');
    expect(roleLabel('mystery')).toBe('Note');
    expect(roleLabel(undefined)).toBe('Note');
  });

  it('marks an item "added" by its reason, and intuition and pitfall always', () => {
    expect(isAddedItem(item('a', 'example', [para('x', 'x')]))).toBe(false);
    expect(isAddedItem(item('a', 'example', [para('x', 'x')], 'bridges p. 3 and p. 4'))).toBe(true);
    expect(isAddedItem(item('a', 'intuition', [para('x', 'x')]))).toBe(true);
    expect(isAddedItem(item('a', 'pitfall', [para('x', 'x')]))).toBe(true);
  });

  it('names what is folded in reading order, each role once', () => {
    const c = card('c', para('cp', 'Core.'), [
      item('a', 'pitfall', [para('x', 'x')]),
      item('b', 'equation', [para('y', 'y')]),
      item('d', 'example', [para('z', 'z')]),
      item('e', 'example', [para('w', 'w')]),
    ]);
    expect(foldedHint(c)).toBe('equation · example · pitfall');
    expect(foldedHint(card('f', para('fp', 'Core.')))).toBe('');
  });
});

describe('CardFolds: view state, per document', () => {
  it('starts folded, opens and closes per card, and keeps documents apart', () => {
    const folds = new CardFolds();
    expect(folds.isOpen('d1', 'c1')).toBe(false);
    folds.set('d1', 'c1', true);
    expect(folds.isOpen('d1', 'c1')).toBe(true);
    expect(folds.isOpen('d2', 'c1')).toBe(false);
    folds.set('d1', 'c1', false);
    expect(folds.isOpen('d1', 'c1')).toBe(false);
    folds.replace('d1', ['a', 'b']);
    expect([...folds.openIn('d1')].sort()).toEqual(['a', 'b']);
  });

  it('hands out a copy, never its own set', () => {
    const folds = new CardFolds();
    folds.set('d', 'c', true);
    folds.openIn('d').add('x');
    expect(folds.isOpen('d', 'x')).toBe(false);
  });
});

describe('when a card opens by itself', () => {
  const doc = sample();

  it('opens for a caret in the depth, not in the core line or outside the card', () => {
    expect(cardsRevealedBySelection(doc, inside(doc, 'i1a'), inside(doc, 'i1a'))).toEqual(['c1']);
    expect(cardsRevealedBySelection(doc, inside(doc, 'c1p'), inside(doc, 'c1p'))).toEqual([]);
    expect(cardsRevealedBySelection(doc, inside(doc, 'p1'), inside(doc, 'p1'))).toEqual([]);
    // A selected depth item (its position is inside the card, after the core line).
    expect(cardsRevealedBySelection(doc, posOf(doc, 'i2'), posOf(doc, 'i2'))).toEqual(['c1']);
  });

  it('opens for a selection that ends in the depth, and not for one that only spans the card', () => {
    expect(cardsRevealedBySelection(doc, inside(doc, 'c1p'), inside(doc, 'i2a'))).toEqual(['c1']);
    expect(cardsRevealedBySelection(doc, 0, doc.content.size)).toEqual([]);
  });

  it('opens for a block in the depth, never for the card or its core line', () => {
    expect(cardsRevealedByBlocks(doc, ['i1b'])).toEqual(['c1']);
    expect(cardsRevealedByBlocks(doc, ['i2'])).toEqual(['c1']);
    expect(cardsRevealedByBlocks(doc, ['c1'])).toEqual([]);
    expect(cardsRevealedByBlocks(doc, ['c1p'])).toEqual([]);
    expect(cardsRevealedByBlocks(doc, ['p1', 'nope', ''])).toEqual([]);
  });

  it('leaves a whole new card folded: it arrived core line first, like the ingest’s', () => {
    expect(cardsRevealedByBlocks(doc, ['c1', 'c1p', 'i1', 'i1a'])).toEqual([]);
  });

  it('opens only what is not open yet, once', () => {
    expect(cardsToOpen(['c1', 'c2', 'c1'], new Set(['c2']))).toEqual(['c1']);
  });
});

describe('the rows of a card', () => {
  const doc = sample();

  it('are the core line and each block in the depth, at their positions', () => {
    const c1 = doc.child(1);
    const rows = cardRows(c1, posOf(doc, 'c1'));
    expect(rows.map((r) => [r.node.attrs.blockId, r.kind])).toEqual([
      ['c1p', 'core'],
      ['i1a', 'item'],
      ['i1b', 'item'],
      ['i2a', 'item'],
    ]);
    for (const row of rows) expect(row.pos).toBe(posOf(doc, row.node.attrs.blockId as string));
  });

  it('are what isCardRow says, of every block a walk visits', () => {
    const rows: string[] = [];
    eachBlock(doc, (node, pos) => {
      if (isCardRow(doc, pos)) rows.push(node.attrs.blockId as string);
    });
    expect(rows).toEqual(['c1p', 'i1a', 'i1b', 'i2a', 'c2p']);
  });

  it('finds the row holding a position, and the core line a click is on', () => {
    expect(cardRowAt(doc, inside(doc, 'i1b'))?.node.attrs.blockId).toBe('i1b');
    expect(cardRowAt(doc, inside(doc, 'c1p'))?.kind).toBe('core');
    expect(cardRowAt(doc, inside(doc, 'p1'))).toBeNull();
    expect(coreLineAt(doc, inside(doc, 'c1p'))?.cardId).toBe('c1');
    expect(coreLineAt(doc, inside(doc, 'i1a'))).toBeNull();
  });
});

describe('conceptPlugin: folding is view state', () => {
  function stateWith(folds = new CardFolds(), docKey: string | null = 'doc1', selection?: number): EditorState {
    const doc = sample();
    return EditorState.create({
      doc,
      plugins: [conceptPlugin({ docKey: () => docKey, folds })],
      ...(selection !== undefined ? { selection: TextSelection.create(doc, selection) } : {}),
    });
  }

  function openClasses(state: EditorState): number {
    const set = conceptKey.getState(state)!.decorations;
    return set.find().filter((d) => (d.spec as { conceptOpen?: boolean }).conceptOpen === true).length;
  }

  it('starts every card folded', () => {
    const state = stateWith();
    expect([...openCards(state)]).toEqual([]);
    expect(openClasses(state)).toBe(0);
  });

  it('starts with the cards this document had open in the session', () => {
    const folds = new CardFolds();
    folds.set('doc1', 'c1', true);
    expect([...openCards(stateWith(folds))]).toEqual(['c1']);
    expect([...openCards(stateWith(folds, 'doc2'))]).toEqual([]);
  });

  it('opens and closes a card without a document change', () => {
    const state = stateWith();
    const tr = toggleCardTr(state, posOf(state.doc, 'c1'))!;
    expect(tr.docChanged).toBe(false);
    expect(tr.getMeta('addToHistory')).toBe(false);
    const open = state.apply(tr);
    expect([...openCards(open)]).toEqual(['c1']);
    expect(openClasses(open)).toBe(1);
    const closed = open.apply(toggleCardTr(open, posOf(open.doc, 'c1'))!);
    expect([...openCards(closed)]).toEqual([]);
    expect(closed.doc.eq(state.doc)).toBe(true);
  });

  it('closing with the caret in the depth moves the caret to the end of the core line', () => {
    let state = stateWith();
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, inside(state.doc, 'i1b'))));
    expect([...openCards(state)]).toEqual(['c1']);
    state = state.apply(toggleCardTr(state, posOf(state.doc, 'c1'))!);
    expect([...openCards(state)]).toEqual([]);
    const core = blockPos(state.doc, 'c1p')!;
    expect(state.selection.from).toBe(core.pos + core.node.nodeSize - 1);
  });

  it('opens a card the caret arrives in, and a node-selected depth item', () => {
    let state = stateWith();
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, inside(state.doc, 'c1p'))));
    expect([...openCards(state)]).toEqual([]);
    state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, posOf(state.doc, 'i2'))));
    expect([...openCards(state)]).toEqual(['c1']);
  });

  it('opens a card for a reveal, a search hit and the read-aloud highlight in its depth', () => {
    const base = stateWith();
    expect([...openCards(base.apply(revealBlocks(base.tr, ['i2a'])))]).toEqual(['c1']);
    expect([...openCards(base.apply(revealBlocks(base.tr, ['c1p', 'p1'])))]).toEqual([]);
    expect([...openCards(base.apply(setSearchHit(base.tr, 'i1a')))]).toEqual(['c1']);
    expect([...openCards(base.apply(setReading(base.tr, 'i1b')))]).toEqual(['c1']);
  });

  it('opens a card when an agent edit lands in its depth', () => {
    let state = stateWith();
    const end = blockPos(state.doc, 'i2')!;
    // Ellie extends the pitfall: one more paragraph at the end of the item, as `card_attach` does.
    const tr = state.tr.insert(end.pos + end.node.nodeSize - 1, para('i2b', 'Nor is it the loss.'));
    state = state.apply(tr);
    expect([...openCards(state)]).toEqual([]);
    state = state.apply(revealBlocks(state.tr, ['i2b']));
    expect([...openCards(state)]).toEqual(['c1']);
  });

  /** 2026-10-06 (D2): opening a card's depth is a readiness signal, reported once per opening. */
  it('reports each card as it opens, not as it closes or as a view starts', () => {
    const opened: string[][] = [];
    const folds = new CardFolds();
    folds.set('doc1', 'c0', true);
    const plugin = conceptPlugin({ docKey: () => 'doc1', folds, onOpened: (ids) => opened.push(ids) });
    let state = EditorState.create({ doc: sample(), plugins: [plugin] });
    // The plugin's view half reads only `state`, so a stand-in view drives it without a DOM.
    const view = { state } as unknown as EditorView;
    const hooks = plugin.spec.view!(view);
    const step = (tr: Transaction): void => {
      state = state.apply(tr);
      (view as { state: EditorState }).state = state;
      hooks.update!(view, state);
    };
    step(toggleCardTr(state, posOf(state.doc, 'c1'))!);
    step(toggleCardTr(state, posOf(state.doc, 'c1'))!);
    step(toggleCardTr(state, posOf(state.doc, 'c1'))!);
    expect(opened).toEqual([['c1'], ['c1']]);
  });

  it('a caret starting in the depth opens its card at once', () => {
    const doc = sample();
    expect([...openCards(stateWith(new CardFolds(), 'doc1', inside(doc, 'i1a')))]).toEqual(['c1']);
  });
});
