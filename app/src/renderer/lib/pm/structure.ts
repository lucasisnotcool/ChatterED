/**
 * **Getting out of a component** (2026-10-04): a Q block, a tutorial part, a table, a diagram,
 * a card set. They are `isolating`, which is right (Enter and Backspace never break one open), and
 * it left the learner with no way to put a line before or after one, or to paste beside one rather
 * than into it. The arrow keys could reach the gap between two components (`prosemirror-gapcursor`),
 * but nothing drew it: its stylesheet was never loaded (notes.css now draws it).
 *
 * Three ways out, for the keyboard, the mouse and the paste:
 *  - **⌥↩** puts an empty line after the top-level block the caret is in, outside it, with the
 *    caret on it; **⇧⌥↩** puts one before. From a component, that is the way out; from a list
 *    inside an answer slot, it is out past the whole part.
 *  - Each gap beside a component has a **＋ line** control, shown while either neighbour is
 *    hovered (notes.css), that puts a line in the gap.
 *  - What is pasted on that new line lands beside the component, not inside it. A tutorial part
 *    pasted anywhere is a reference to it, not a second live part (`shared/doc/partref.ts`).
 */
import type { Node } from 'prosemirror-model';
import { NodeSelection, Plugin, PluginKey, TextSelection, type Command, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { GapCursor } from 'prosemirror-gapcursor';
import { notesSchema } from '../../../shared/doc/schema.js';
import { liveTutorialIds, referencePastedParts } from '../../../shared/doc/partref.js';

export type Side = 'before' | 'after';

/** A top-level block with edges to step out of: a container or an atom, not a line of text. */
export function isComponent(node: Node): boolean {
  if (node.isTextblock) return false;
  if (node.type.name === 'bullet_list' || node.type.name === 'ordered_list') return false;
  return Boolean(node.type.spec.isolating) || node.isAtom;
}

/** The document position just before or after the top-level block that holds the selection. */
export function edgeOfTopBlock(state: EditorState, side: Side): number | null {
  const sel = state.selection;
  if (sel instanceof GapCursor) return sel.head;
  if (sel instanceof NodeSelection && sel.$from.depth === 0) return side === 'before' ? sel.from : sel.to;
  const $at = side === 'before' ? sel.$from : sel.$to;
  if ($at.depth === 0) return null;
  return side === 'before' ? $at.before(1) : $at.after(1);
}

/** Insert an empty paragraph at a top-level position and put the caret in it. */
export function lineAt(state: EditorState, pos: number, dispatch?: EditorView['dispatch']): boolean {
  const paragraph = notesSchema.nodes.paragraph!.create();
  const $pos = state.doc.resolve(pos);
  if (!$pos.parent.canReplaceWith($pos.index(), $pos.index(), paragraph.type)) return false;
  if (dispatch) {
    const tr = state.tr.insert(pos, paragraph);
    tr.setSelection(TextSelection.create(tr.doc, pos + 1)).scrollIntoView();
    dispatch(tr);
  }
  return true;
}

/** ⌥↩ / ⇧⌥↩: a line after / before the top-level block the caret is in. */
export function lineAround(side: Side): Command {
  return (state, dispatch) => {
    const pos = edgeOfTopBlock(state, side);
    return pos === null ? false : lineAt(state, pos, dispatch);
  };
}

const structureKey = new PluginKey<DecorationSet>('chattered:structure');

/** The ＋ line control in one gap: a new line at this position, between the blocks on either side. */
function edgeControl(view: EditorView, getPos: () => number | undefined): HTMLElement {
  const holder = document.createElement('div');
  holder.className = 'nd-edge';
  holder.contentEditable = 'false';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'nd-edge-btn';
  button.textContent = '＋ line';
  button.title = 'Add a line here, outside the block (⌥↩ adds one below the block you are in, ⇧⌥↩ above)';
  // Pressed, not clicked: the editor must not take the press as a caret placement first.
  button.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const pos = getPos();
    if (pos === undefined) return;
    if (lineAt(view.state, pos, view.dispatch)) view.focus();
  });
  holder.append(button);
  return holder;
}

/**
 * One control per gap that touches a component: the line below one block and the line above the
 * next are the same position, so one control serves both. It sits first in the gap, against the
 * block above (`side`), and notes.css shows it while either neighbour is hovered.
 */
function edgeDecorations(doc: Node): DecorationSet {
  const out: Decoration[] = [];
  const children: { node: Node; offset: number }[] = [];
  doc.forEach((node, offset) => children.push({ node, offset }));
  for (let i = 0; i <= children.length; i++) {
    const before = children[i - 1];
    const after = children[i];
    if (!(before && isComponent(before.node)) && !(after && isComponent(after.node))) continue;
    const pos = after ? after.offset : doc.content.size;
    const id = (after?.node.attrs.blockId as string | undefined) || (before?.node.attrs.blockId as string | undefined) || `@${pos}`;
    out.push(Decoration.widget(pos, (view, getPos) => edgeControl(view, getPos), { side: -1000, key: `edge:${id}:${i}`, ignoreSelection: true }));
  }
  return DecorationSet.create(doc, out);
}

/** The keys, the edge controls and the paste rule, as one plugin. */
export function structurePlugin(): Plugin {
  return new Plugin<DecorationSet>({
    key: structureKey,
    state: {
      init: (_config, state) => edgeDecorations(state.doc),
      apply: (tr, set) => (tr.docChanged ? edgeDecorations(tr.doc) : set),
    },
    props: {
      decorations: (state) => structureKey.getState(state) ?? null,
      handleKeyDown(view, event) {
        if (event.key !== 'Enter' || !event.altKey || event.metaKey || event.ctrlKey) return false;
        return lineAround(event.shiftKey ? 'before' : 'after')(view.state, view.dispatch, view);
      },
      transformPasted: (slice, view) => referencePastedParts(slice, liveTutorialIds(view.state.doc)),
    },
  });
}
