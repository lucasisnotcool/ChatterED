import { describe, expect, it } from 'vitest';
import type { Node } from 'prosemirror-model';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { baseKeymap } from 'prosemirror-commands';
import { defaultImageWidth, imageParagraph, inlineFigures, notesSchema } from '../../../shared/doc/schema.js';
import { FIT_WIDTH, LINE_ROOM, MIN_IMAGE_WIDTH, cornerWidth, cropAspect, imageKeysPlugin, shownWidth } from './image.js';

const s = notesSchema;
const img = (page = 41) => s.nodes.slide_image!.create({ page, rect: null, width: 300 });
const para = (id: string, ...content: (Node | string)[]) =>
  s.nodes.paragraph!.create({ blockId: id }, content.map((c) => (typeof c === 'string' ? s.text(c) : c)));
const docOf = (...blocks: Node[]) => s.nodes.doc!.create(null, blocks);

describe('cornerWidth: a corner drag, in proportion', () => {
  it('grows with an east corner dragged right and a west corner dragged left', () => {
    expect(cornerWidth(300, 'se', 50, 1, 700)).toBe(350);
    expect(cornerWidth(300, 'ne', 50, 1, 700)).toBe(350);
    expect(cornerWidth(300, 'sw', -50, 1, 700)).toBe(350);
    expect(cornerWidth(300, 'nw', 50, 1, 700)).toBe(250);
  });
  it('reads the drag through the notes zoom', () => {
    expect(cornerWidth(300, 'se', 100, 2, 700)).toBe(350);
  });
  it('stays between the smallest useful width and the column', () => {
    expect(cornerWidth(300, 'se', 5000, 1, 700)).toBe(700);
    expect(cornerWidth(300, 'nw', 5000, 1, 700)).toBe(MIN_IMAGE_WIDTH);
  });
});

describe('shownWidth and cropAspect', () => {
  it('fits an image with no width of its own to the column, and never wider than it', () => {
    expect(shownWidth(null, 720)).toBe(FIT_WIDTH);
    // Never the whole column: there is always room on the line to click beside it.
    expect(shownWidth(null, 400)).toBe(400 - LINE_ROOM);
    expect(shownWidth(900, 720)).toBe(720 - LINE_ROOM);
    expect(shownWidth(300, 720)).toBe(300);
  });
  it('gives a crop its own shape on the page', () => {
    expect(cropAspect(null, { width: 720, height: 540 })).toBeCloseTo(0.75);
    expect(cropAspect({ x0: 0, y0: 0, x1: 0.5, y1: 0.25 }, { width: 720, height: 540 })).toBeCloseTo(0.375);
  });
  it('brings a small crop in small and a whole slide at a readable size', () => {
    expect(defaultImageWidth(null)).toBe(560);
    expect(defaultImageWidth({ x0: 0.1, y0: 0.5, x1: 0.6, y1: 0.7 })).toBe(280);
    expect(defaultImageWidth({ x0: 0.1, y0: 0.5, x1: 0.15, y1: 0.7 })).toBe(160);
  });
});

describe('inlineFigures: a block figure becomes an image in a line', () => {
  const figure = s.nodes.slide_figure!.create({
    blockId: 'b_fig',
    page: 41,
    rect: { x0: 0, y0: 0.5, x1: 1, y1: 1 },
    caption: 'Approximate reachable sets',
    pages: [41],
  });

  it('keeps the block id and the citation on the paragraph, and the crop and caption on the image', () => {
    const out = inlineFigures(docOf(para('b_1', 'Before.'), figure));
    const block = out.child(1);
    expect(block.type.name).toBe('paragraph');
    expect(block.attrs).toMatchObject({ blockId: 'b_fig', pages: [41] });
    expect(block.firstChild?.type.name).toBe('slide_image');
    expect(block.firstChild?.attrs).toMatchObject({ page: 41, rect: { x0: 0, y0: 0.5, x1: 1, y1: 1 }, caption: 'Approximate reachable sets', width: null });
    out.check();
  });

  it('reaches into a Q block, and leaves a document with no figure as it is', () => {
    const q = s.nodes.q_block!.create({ blockId: 'q_1', questionId: 'q1', askedBy: 'max', status: 'open' }, [para('b_q', 'Why?'), figure]);
    const out = inlineFigures(docOf(q));
    expect(out.child(0).child(1).firstChild?.type.name).toBe('slide_image');
    const plain = docOf(para('b_1', 'Nothing to do.'));
    expect(inlineFigures(plain)).toBe(plain);
  });

  it('inserts as a paragraph cited to its page', () => {
    const block = imageParagraph(17, null, 'b_new');
    expect(block.attrs).toMatchObject({ blockId: 'b_new', pages: [17] });
    expect(block.firstChild?.attrs).toMatchObject({ page: 17, width: 560 });
  });
});

/** Press a key the way the plugin sees it, then the base keymap if the plugin left it. */
function press(doc: Node, caret: number, key: string): EditorState {
  let state = EditorState.create({ doc, selection: TextSelection.create(doc, caret), plugins: [imageKeysPlugin()] });
  const view = {
    get state() {
      return state;
    },
    dispatch: (tr: Transaction) => {
      state = state.apply(tr);
    },
  } as unknown as EditorView;
  const plugin = state.plugins[0]!;
  // No DOM here: the plugin reads only the key and its modifiers.
  const event = { key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false } as KeyboardEvent;
  const handled = plugin.props.handleKeyDown?.call(plugin, view, event);
  // No view for the base command: it would measure the DOM to find a line's start.
  if (!handled && key === 'Backspace') baseKeymap.Backspace!(state, view.dispatch);
  return state;
}

describe('the keys by an image', () => {
  // "ab[image]cd": positions 1 a 2 b 3 [image] 4 c 5 d 6
  const line = () => docOf(para('b_1', 'ab', img(), 'cd'));

  it('Backspace after an image deletes it; Delete before one deletes it', () => {
    expect(press(line(), 4, 'Backspace').doc.textContent).toBe('abcd');
    expect(press(line(), 4, 'Backspace').doc.child(0).childCount).toBe(1);
    expect(press(line(), 3, 'Delete').doc.child(0).childCount).toBe(1);
  });

  it('← and → step over an image in one press', () => {
    expect(press(line(), 4, 'ArrowLeft').selection.head).toBe(3);
    expect(press(line(), 3, 'ArrowRight').selection.head).toBe(4);
  });

  it('Backspace before an image at the start of a line moves the line, image and all, onto the one above', () => {
    const doc = docOf(para('b_1', 'Above'), para('b_2', img(), 'after'));
    const out = press(doc, 8, 'Backspace');
    expect(out.doc.childCount).toBe(1);
    expect(out.doc.child(0).childCount).toBe(3);
    expect(out.doc.child(0).child(1).type.name).toBe('slide_image');
  });
});
