/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * EACH SECTION'S SLIDES, UNDER THE SECTION (2026-10-03)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The carousel used to sit at the bottom of the notes, every slide grouped by the section it fed,
 * collapsed into one strip nobody scrolled down to. Now that a slide opens in a window you can
 * read and copy from (`slidewindow.ts`), the slides are where they are useful: **each section ends
 * with its own collapsed "Slides" strip**, and the opening slides sit under the overview's
 * objectives. Which slide belongs where is `shared/doc/slidegroups.ts`'s call, and the learner's
 * to correct by dragging a thumbnail onto another section (`SlideRegroup.svelte`).
 *
 * The strips are **widget decorations**, like the rest of the chrome (`chrome.ts`): they are not
 * in the document, so they are never saved, typed into, sent to a model or undone. Each strip is
 * collapsed until the learner opens it, and its thumbnails are only rendered then — a 58-page
 * deck is 58 pdf.js renders, which nobody should pay for on opening the notes.
 */

import type { Node } from 'prosemirror-model';
import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import { AttrStep, ReplaceAroundStep } from 'prosemirror-transform';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { SlideGroup } from '../../../shared/doc/slidegroups.js';
import type { SlideSource } from '../rasterise.js';

/** The MIME type a dragged thumbnail carries: its page, and nothing a text field would accept. */
export const SLIDE_DRAG_TYPE = 'application/x-chattered-slide';

export interface StripContext {
  /** The groups for this document, in reading order. The store memoises them per document. */
  groups: (doc: Node) => SlideGroup[];
  slides: () => SlideSource | null;
  /** Whether a group's strip is open. Remembered by the store, so a rebuild keeps it. */
  isOpen: (key: string) => boolean;
  onToggle: (key: string) => void;
  /** A thumbnail’s click: a slide window beside it, paging through the group's slides. */
  onOpen: (group: SlideGroup, page: number, anchor: HTMLElement) => void;
  /** A thumbnail picked up: the store shows the sections to drop it on. */
  onDragStart: (group: SlideGroup, page: number) => void;
  onDragEnd: () => void;
}

export const stripKey = new PluginKey<DecorationSet>('chattered:slidestrip');

/** Redraw the strips without touching the document. */
export function bumpStrips(tr: Transaction): Transaction {
  return tr.setMeta(stripKey, true);
}

/** `pp. 3–7, 12` for a strip's header: the pages it holds, in runs. */
export function pageRuns(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const runs: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    runs.push(j > i ? `${String(sorted[i])}–${String(sorted[j])}` : String(sorted[i]));
    i = j + 1;
  }
  if (runs.length === 0) return '';
  return `${sorted.length === 1 ? 'p.' : 'pp.'} ${runs.join(', ')}`;
}

/**
 * Where each group's strip goes, as a document position between two top-level blocks: a section's
 * just before the next H2 (or at the end), so it closes the section whatever was added to it; the
 * opening group's before the first H2 (under the objectives); the other slides' at the end.
 *
 * Found from the section's **heading**, not from its last block: a block added at a section's end
 * has no id until the authorship stamp mints one, and a strip placed after "the last block" went to
 * the end of the notes in the meantime (live run, 3 Oct 2026). Pure, so it is tested without a view.
 */
export function stripPositions(doc: Node, groups: readonly SlideGroup[]): { group: SlideGroup; pos: number }[] {
  const headings: { id: string; offset: number }[] = [];
  doc.forEach((node, offset) => {
    if (node.type.name === 'heading' && node.attrs.level === 2) headings.push({ id: (node.attrs.blockId as string) || '', offset });
  });
  const end = doc.content.size;
  const out: { group: SlideGroup; pos: number }[] = [];
  for (const group of groups) {
    if (group.pages.length === 0) continue;
    let pos = end;
    if (group.key === 'opening') pos = headings[0]?.offset ?? end;
    else if (group.headingBlockId) {
      const at = headings.findIndex((h) => h.id === group.headingBlockId);
      pos = at >= 0 ? (headings[at + 1]?.offset ?? end) : end;
    }
    out.push({ group, pos });
  }
  return out;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const THUMB_WIDTH = 168;

function thumbnail(group: SlideGroup, page: number, ctx: StripContext): HTMLElement {
  const source = ctx.slides();
  const label = source?.citation([page]) ?? `p. ${String(page)}`;
  const thumb = el('button', 'nd-strip-thumb');
  thumb.type = 'button';
  thumb.draggable = true;
  thumb.title = `${source?.title(page) ?? label}: click to read it, drag it to another section`;
  if (group.moved.includes(page)) thumb.classList.add('nd-strip-moved');
  const frame = el('span', 'nd-strip-frame');
  thumb.append(frame, el('span', 'nd-strip-label', label));

  if (source?.kindOf(page) === 'text') {
    void source.text(page).then((text) => {
      frame.append(el('span', 'nd-strip-text', (text ?? '').slice(0, 220)));
    });
  } else if (source) {
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    void source.canvas(page, Math.round(THUMB_WIDTH * dpr)).then((rendered) => {
      if (!rendered || !thumb.isConnected) return;
      // The cache owns its canvas and a window may be showing it: copy, never adopt.
      const copy = document.createElement('canvas');
      copy.width = Math.round(THUMB_WIDTH * dpr);
      copy.height = Math.round((copy.width * rendered.height) / Math.max(1, rendered.width));
      copy.getContext('2d')?.drawImage(rendered, 0, 0, copy.width, copy.height);
      frame.append(copy);
      frame.classList.add('nd-strip-ready');
    });
  }

  thumb.addEventListener('mousedown', (event) => event.stopPropagation());
  thumb.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    ctx.onOpen(group, page, thumb);
  });
  thumb.addEventListener('dragstart', (event) => {
    event.stopPropagation();
    event.dataTransfer?.setData(SLIDE_DRAG_TYPE, String(page));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    // After the drag has begun: a DOM change during `dragstart` itself can cancel it.
    setTimeout(() => ctx.onDragStart(group, page), 0);
  });
  thumb.addEventListener('dragend', () => ctx.onDragEnd());
  return thumb;
}

function strip(group: SlideGroup, ctx: StripContext): HTMLElement {
  const open = ctx.isOpen(group.key);
  const root = el('div', `nd-strip${open ? ' nd-strip-open' : ''}`);
  root.contentEditable = 'false';
  root.dataset.group = group.key;
  const toggle = el('button', 'nd-strip-toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', String(open));
  toggle.append(
    el('span', 'nd-strip-caret', open ? '▾' : '▸'),
    el('span', 'nd-strip-name', group.key === 'other' ? 'Other slides' : 'Slides'),
    el('span', 'nd-strip-pages', pageRuns(group.pages)),
  );
  toggle.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  toggle.addEventListener('click', (event) => {
    event.preventDefault();
    ctx.onToggle(group.key);
  });
  root.append(toggle);
  if (open) {
    const grid = el('div', 'nd-strip-thumbs');
    for (const page of group.pages) grid.append(thumbnail(group, page, ctx));
    root.append(grid);
  }
  return root;
}

function build(state: EditorState, ctx: StripContext): DecorationSet {
  const placed = stripPositions(state.doc, ctx.groups(state.doc));
  const decorations = placed.map(({ group, pos }) =>
    Decoration.widget(pos, () => strip(group, ctx), {
      side: -1,
      // Same key, same DOM: an unrelated rebuild keeps the rendered thumbnails.
      key: `strip:${group.key}:${ctx.isOpen(group.key) ? 'o' : 'c'}:${group.pages.join(',')}:${group.moved.join(',')}`,
      ignoreSelection: true,
      stopEvent: () => true,
    }),
  );
  return DecorationSet.create(state.doc, decorations);
}

export function slideStripPlugin(context: () => StripContext): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: stripKey,
    state: {
      init: (_config, state) => build(state, context()),
      apply(tr, value, old, next) {
        // As the chrome does (`chrome.ts`): blocks added, removed or re-marked can move a section's
        // end or its pages; a keystroke only moves the strips along.
        const structural = tr.docChanged && tr.doc.childCount !== old.doc.childCount;
        const remarked = tr.steps.some((step) => step instanceof ReplaceAroundStep || step instanceof AttrStep);
        if (tr.getMeta(stripKey) || structural || remarked) return build(next, context());
        return tr.docChanged ? value.map(tr.mapping, tr.doc) : value;
      },
    },
    props: {
      decorations: (state) => stripKey.getState(state),
    },
  });
}
