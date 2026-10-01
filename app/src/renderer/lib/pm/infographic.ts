/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THE INFOGRAPHIC (notebooks §5.3, answer E; contract C9, 2026-10-01)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * An `infographic` block is **data drawn in code, never an image**. Each panel is an `info_panel`
 * of three real, editable text fields (a big `info_value`, a `info_heading`, an `info_body`) in the
 * per-span author mark, so every word of it is editable, protected by the guard, and readable as
 * text by the agents and by read-aloud. The block's `layout` says how the panels are drawn, and
 * the stylesheet (`components/notes/blocks.css`) does the drawing:
 *
 *  - `timeline`: a vertical rail, a dot and the date (the value) per stop;
 *  - `steps`: numbered cards, joined by an arrow;
 *  - `stats`: large values over their label;
 *  - `compare`: columns, the heading over its body.
 *
 * Colour is never the only signal: a step wears its number, a stat its value, and a timeline stop
 * its date, all as text. The only SVG-free connector is the CSS rail and arrow. The layout buttons
 * on the toolbar are `setInfographicLayout` (`../blockfields.ts`).
 */

import type { Node } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import { INFOGRAPHIC_LAYOUTS, isInfographicLayout } from '../../../shared/doc/schema.js';
import type { InfographicLayout } from '../../../shared/doc/types.js';
import { setInfographicLayout } from '../blockfields.js';
import { BlockView, ItemView, tool, type ToolSpec } from './blockkit.js';
import type { NodeViewContext } from './nodeviews.js';

/** The layouts' names on the toolbar. */
export const LAYOUT_NAME: Record<InfographicLayout, string> = {
  timeline: 'Timeline',
  steps: 'Steps',
  stats: 'Stats',
  compare: 'Compare',
};

export function infographicNodeViews(ctx: NodeViewContext): Record<
  string,
  (node: Node, view: EditorView, getPos: () => number | undefined) => NodeView
> {
  return {
    infographic: (node, view, getPos) =>
      new BlockView(node, view, getPos, {
        name: 'infographic',
        className: 'nd-ig',
        label: 'Infographic',
        itemName: 'Panel',
        tools: (run) => {
          const group = document.createElement('span');
          group.className = 'nd-blk-layouts';
          const buttons = new Map<InfographicLayout, HTMLButtonElement>();
          for (const layout of INFOGRAPHIC_LAYOUTS) {
            const button = tool('nd-blk-tool nd-blk-layout', LAYOUT_NAME[layout], `Lay this out as ${LAYOUT_NAME[layout].toLowerCase()}`, () =>
              run((state, pos) => setInfographicLayout(state, pos, layout)),
            );
            buttons.set(layout, button);
            group.append(button);
          }
          const spec: ToolSpec = {
            el: group,
            sync(node) {
              for (const [name, button] of buttons) {
                const pressed = String(name === node.attrs.layout);
                if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
              }
            },
          };
          return [spec];
        },
        paint(node, dom) {
          const layout = isInfographicLayout(node.attrs.layout) ? node.attrs.layout : 'steps';
          if (dom.dataset.layout !== layout) dom.dataset.layout = layout;
        },
      }),
    info_panel: (node) => new ItemView(node, { type: 'info_panel', className: 'nd-ig-panel' }, ctx),
  };
}
