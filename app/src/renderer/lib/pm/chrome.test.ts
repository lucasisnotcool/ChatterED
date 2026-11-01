import { describe, expect, it } from 'vitest';
import type { Node } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { blockPos, notesSchema } from '../../../shared/doc/schema.js';
import {
  AGENT_NAME,
  bumpChrome,
  chromeKey,
  chromePlugin,
  focusKey,
  focusPlugin,
  provenanceLabel,
  qStatusLabel,
  type ChromeContext,
} from './chrome.js';

describe('provenanceLabel', () => {
  it('names one page', () => {
    expect(provenanceLabel([12], null)).toBe('p. 12');
  });

  it('collapses a run into a range, as the brief writes it', () => {
    expect(provenanceLabel([12, 13], null)).toBe('p. 12–13');
    expect(provenanceLabel([1, 2, 3], null)).toBe('p. 1–3');
  });

  it('keeps disjoint pages apart', () => {
    expect(provenanceLabel([12, 14], null)).toBe('p. 12, 14');
    expect(provenanceLabel([1, 2, 3, 7, 9, 10], null)).toBe('p. 1–3, 7, 9–10');
  });

  it('sorts and de-duplicates whatever the ingest wrote', () => {
    expect(provenanceLabel([13, 12, 12], null)).toBe('p. 12–13');
  });

  it('falls back to the reason when there is no page', () => {
    expect(provenanceLabel([], 'bridges p. 12 and p. 13')).toBe('added: bridges p. 12 and p. 13');
  });

  it('prefers the pages when a block has both — a page is checkable, a reason is not', () => {
    expect(provenanceLabel([12], 'bridges two slides')).toBe('p. 12');
  });

  it('says so, on the page, when a block has neither', () => {
    expect(provenanceLabel([], null)).toBe('no source');
    expect(provenanceLabel([], '   ')).toBe('no source');
  });

  it('ignores a page number that is not a page', () => {
    expect(provenanceLabel([0, -3, 1.5, 4], null)).toBe('p. 4');
  });
});

describe('edit control widgets', () => {
  it('replaces the widget when Keep turns its actions into a chat link', () => {
    const doc = notesSchema.node('doc', null, [
      notesSchema.node('paragraph', { blockId: 'agent-line', pages: [], reason: null, objectiveIds: [] }, [notesSchema.text('Max feedback')]),
    ]);
    const noop = (): void => undefined;
    const edit = {
      editId: 'edit-one', blockIds: ['agent-line'], author: 'max', status: 'applied',
      messageId: 'message-one', why: 'Check on Question 1',
    } as ChromeContext['edits'][number];
    const ctx: ChromeContext = {
      frozen: false, cursors: [], edits: [edit], keptEdits: [], suggestions: [], spanThreads: [],
      onRemoveEdit: noop, onKeepEdit: noop, onAcceptSuggestion: noop, onRejectSuggestion: noop,
      onOpenSlide: noop, onFocusThread: noop, onFocusEdit: noop,
    };
    const key = (state: EditorState): string => String(chromeKey.getState(state)!.find()
      .find((decoration) => String((decoration.spec as { key?: string }).key).startsWith('edits:'))!.spec.key);
    let state = EditorState.create({ doc, plugins: [chromePlugin(() => ctx)] });
    const before = key(state);
    ctx.edits = [];
    ctx.keptEdits = [{ ...edit, status: 'kept' }];
    state = state.apply(bumpChrome(state.tr));
    expect(key(state)).not.toBe(before);
    expect(key(state)).toContain('edit-one:kept');
  });
});

describe('qStatusLabel', () => {
  it('is open while the question waits', () => {
    expect(qStatusLabel('open', null)).toBe('open');
  });

  it('says "your answer" when the learner earned it, "revisit" otherwise (D4, 2026-10-06)', () => {
    expect(qStatusLabel('resolved', 'you_got_this')).toBe('your answer');
    expect(qStatusLabel('resolved', 'partly_yours')).toBe('revisit');
    expect(qStatusLabel('resolved', 'released')).toBe('revisit');
    expect(qStatusLabel('resolved', 'revisit')).toBe('revisit');
  });

  it('reads a legacy block with no resolution as one to revisit, never an empty tag', () => {
    expect(qStatusLabel('resolved', null)).toBe('revisit');
  });
});

describe('AGENT_NAME', () => {
  it('pairs every colour with a name, which is the colour-blind rule', () => {
    expect(AGENT_NAME.ellie).toBe('Ellie');
    expect(AGENT_NAME.max).toBe('Max');
  });
});

// ── a concept card's rows carry the chips and the toolbar (notebooks.md §11.2, amended 2026-10-06)

describe('chrome on a concept card', () => {
  const para = (blockId: string, text: string): Node =>
    notesSchema.node('paragraph', { blockId, pages: [3], reason: null, objectiveIds: [] }, [notesSchema.text(text)]);
  const doc = notesSchema.node('doc', null, [
    para('p0', 'Before the card.'),
    notesSchema.node('concept', { blockId: 'c1', term: 'Gradient', pages: [3], reason: null, objectiveIds: [] }, [
      para('c1p', 'Gradient: the direction of steepest ascent.'),
      notesSchema.node('concept_item', { blockId: 'i1', role: 'example', pages: [3], reason: null, objectiveIds: [] }, [
        para('i1a', 'For x squared it is 2x.'),
      ]),
    ]),
  ]);
  const noop = (): void => undefined;
  const ctx: ChromeContext = {
    frozen: false,
    cursors: [],
    edits: [],
    suggestions: [],
    spanThreads: [],
    onRemoveEdit: noop,
    onKeepEdit: noop,
    onAcceptSuggestion: noop,
    onRejectSuggestion: noop,
    onOpenSlide: noop,
    onFocusThread: noop,
    onFocusEdit: noop,
    blockActions: { i1a: { kind: 'explain', author: 'ellie', state: 'running', line: 'Ellie is writing…' } },
    onBlockAction: noop,
  };
  const keys = (state: EditorState): string[] =>
    chromeKey
      .getState(state)!
      .find()
      .map((d) => String((d.spec as { key?: string }).key ?? ''));

  it('puts a chip and a toolbar on the core line and on each block in the depth, none on the frames', () => {
    const state = EditorState.create({ doc, plugins: [chromePlugin(() => ctx)] });
    const all = keys(state);
    const chips = all.filter((k) => k.startsWith('prov:')).map((k) => k.split(':')[1]);
    const tools = all.filter((k) => k.startsWith('tools:')).map((k) => k.split(':')[1]);
    expect(chips).toEqual(['p0', 'c1p', 'i1a']);
    expect(tools).toEqual(['p0', 'c1p', 'i1a']);
  });

  it('draws an action’s running line under a block in the depth', () => {
    const state = EditorState.create({ doc, plugins: [chromePlugin(() => ctx)] });
    expect(keys(state).some((k) => k.startsWith('act:i1a:'))).toBe(true);
  });

  it('marks the caret’s row in a card as the caret block', () => {
    const row = blockPos(doc, 'i1a')!;
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, row.pos + 2), plugins: [focusPlugin()] });
    const marked = focusKey
      .getState(state)!
      .find()
      .filter((d) => d.from === row.pos && d.to === row.pos + row.node.nodeSize);
    expect(marked).toHaveLength(1);
  });
});

describe('"Ready to check this?" (D2, 2026-10-06)', () => {
  const doc = notesSchema.node('doc', null, [
    notesSchema.node('heading', { blockId: 'h_a', level: 2, pages: [1], reason: null, objectiveIds: [] }, [notesSchema.text('A')]),
    notesSchema.node('paragraph', { blockId: 'p_a', pages: [1], reason: null, objectiveIds: [] }, [notesSchema.text('Prose.')]),
  ]);

  function offers(extra: Partial<ChromeContext>): string[] {
    const context: ChromeContext = {
      frozen: false,
      cursors: [],
      edits: [],
      suggestions: [],
      spanThreads: [],
      onRemoveEdit: () => undefined,
      onKeepEdit: () => undefined,
      onAcceptSuggestion: () => undefined,
      onRejectSuggestion: () => undefined,
      onOpenSlide: () => undefined,
      onFocusThread: () => undefined,
      onFocusEdit: () => undefined,
      ...extra,
    };
    const state = EditorState.create({ doc, plugins: [chromePlugin(() => context)] });
    return (chromeKey.getState(state)?.find() ?? [])
      .map((d) => (d.spec as { key?: string }).key ?? '')
      .filter((key) => key.startsWith('ready:'));
  }

  it('draws the offer on the heading it was earned on, and only on a heading', () => {
    expect(offers({ readyHeadings: ['h_a', 'p_a', 'gone'], onReadyCheck: () => undefined })).toEqual(['ready:h_a']);
  });

  it('draws nothing without the press to call, or with nothing ready', () => {
    expect(offers({ readyHeadings: ['h_a'] })).toEqual([]);
    expect(offers({ readyHeadings: [], onReadyCheck: () => undefined })).toEqual([]);
  });
});
