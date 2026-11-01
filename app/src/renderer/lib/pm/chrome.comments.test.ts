/** The explain badges (migration 033) as decorations: where they go, and the chip beside them. */
import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { notesSchema } from '../../../shared/doc/schema.js';
import { chromeKey, chromePlugin, commentOnTopLine, type ChromeContext } from './chrome.js';
import { placeBelow } from './commentpop.js';

const A = { pages: [3], reason: null, objectiveIds: [] };
const para = (id: string, text: string) => notesSchema.node('paragraph', { blockId: id, ...A }, [notesSchema.text(text)]);
const doc = notesSchema.node('doc', null, [
  para('p1', 'Admissible heuristics.'),
  notesSchema.node('bullet_list', { blockId: 'l1', ...A }, [
    notesSchema.node('list_item', { blockId: 'li1' }, [para('', 'Consistent')]),
    notesSchema.node('list_item', { blockId: 'li2' }, [para('', 'Informative')]),
  ]),
  notesSchema.node('math_block', { blockId: 'm1', tex: 'h(s) \\le h^*(s)', ...A }),
  para('p2', 'No comment here.'),
]);

function context(comments: ChromeContext['comments']): ChromeContext {
  const noop = (): void => undefined;
  return {
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
    ...(comments ? { comments } : {}),
  };
}

const keys = (comments: ChromeContext['comments']): string[] => {
  const state = EditorState.create({ doc, plugins: [chromePlugin(() => context(comments))] });
  return (chromeKey.getState(state)?.find() ?? []).map((d) => String((d.spec as { key?: string }).key ?? ''));
};

describe('explain badges', () => {
  const comments = { p1: { body: 'a' }, li2: { body: 'b' }, m1: { body: 'c', updatedAt: 't1' } };

  it('puts one on each commented block at any depth, a formula’s before it, and none elsewhere', () => {
    const badges = keys(comments).filter((k) => k.startsWith('cmt:'));
    expect(badges.sort()).toEqual(['cmt:li2:in:1', 'cmt:m1:edge:t1', 'cmt:p1:in:1']);
    expect(keys(undefined).some((k) => k.startsWith('cmt:'))).toBe(false);
  });

  it('moves the chip of a line that carries a badge, and only that line’s', () => {
    const chips = keys(comments).filter((k) => k.startsWith('prov:'));
    expect(chips.find((k) => k.startsWith('prov:p1:'))!.endsWith(':c')).toBe(true);
    expect(chips.find((k) => k.startsWith('prov:p2:'))!.endsWith(':')).toBe(true);
    // The list's first item has none, so the list's chip stays put.
    expect(chips.find((k) => k.startsWith('prov:l1:'))!.endsWith(':')).toBe(true);
  });

  it('counts a list’s first item as its top line', () => {
    const list = doc.child(1);
    expect(commentOnTopLine(list, { li1: { body: 'x' } })).toBe(true);
    expect(commentOnTopLine(list, { li2: { body: 'x' } })).toBe(false);
    expect(commentOnTopLine(doc.child(0), undefined)).toBe(false);
  });
});

describe('the explain popover’s place', () => {
  it('hangs below the badge, right edges aligned, inside the window, or above when below has no room', () => {
    expect(placeBelow({ left: 900, right: 960, top: 100, bottom: 118 }, { width: 380, height: 200 }, { width: 1000, height: 800 })).toEqual({ left: 580, top: 124 });
    expect(placeBelow({ left: 10, right: 60, top: 100, bottom: 118 }, { width: 380, height: 200 }, { width: 1000, height: 800 }).left).toBe(8);
    expect(placeBelow({ left: 900, right: 960, top: 700, bottom: 718 }, { width: 380, height: 200 }, { width: 1000, height: 800 }).top).toBe(494);
  });
});
