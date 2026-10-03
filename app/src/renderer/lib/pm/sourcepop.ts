/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THE SLIDE, WITHIN REACH OF THE NOTES: THE CITATION CHIP AND THE FIGURE'S HOTSPOTS (§3)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Two pieces of chrome, both outside the document:
 *
 *  - **the citation chip's slide**: `attachCitePreview` gives a provenance chip a **peek** on
 *    hover — a small thumbnail of the cited slide beside the chip, the region the block was drawn
 *    from outlined, its words quoted under it, nothing to click — and its click opens the slide in
 *    a window of its own (`slidewindow.ts`, 3 Oct 2026), which stays until it is closed. The name
 *    and the options are kept so the three chip builders (`chrome.ts`, `blockkit.ts`,
 *    `diagram.ts`) did not have to change with it.
 *  - **a figure's hotspots**: the slide's own text labels inside an inline crop, each a button
 *    over the pixels. A click offers "Ask Ellie about this", which opens a span thread on the
 *    figure's block.
 *
 * **Neither asks a model where anything is.** The region comes from `bestRegion` and the labels
 * from `hotspotsIn` (`shared/doc/cite.ts`), both over the PDF's own text geometry. When no region
 * matches, the slide is shown whole with no outline and no quote.
 *
 * The popover elements are appended to the notes pane (`.nd`), not inside ProseMirror's DOM and
 * not inside the zoomed sheet: they are `position: fixed` at the anchor's viewport box, so they
 * are never clipped by the scroller, never scaled by the notes zoom, and never seen by the
 * editor. Only one is up at a time, across both files: each closes the other.
 */
import type { Hotspot, LineRect, PageLinesView } from '../../../shared/doc/cite.js';
import type { Rect } from '../../../shared/doc/types.js';
import type { SlideSource } from '../rasterise.js';
import { bestRegion } from '../../../shared/doc/cite.js';
import { MARGIN, placeBeside, rectPercent } from './slidegeom.js';
import { openSlideWindow } from './slidewindow.js';

/** What the slide popover and the figure's hotspots read the slide through. Supplied by `NotesEditor.svelte`. */
export interface SlideReader {
  slides: () => SlideSource | null;
  pageLines: (page: number) => Promise<PageLinesView | null>;
}

const EDGE = 8;

export function toRect(r: LineRect): Rect {
  return { x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h };
}

export function toLineRect(r: Rect): LineRect {
  return { x: r.x0, y: r.y0, w: r.x1 - r.x0, h: r.y1 - r.y0 };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className: string, text: string, title: string, onClick: () => void): HTMLButtonElement {
  const node = el('button', className, text);
  node.type = 'button';
  if (title) node.title = title;
  // Neither the editor's selection nor its focus moves for a press on chrome.
  node.addEventListener('mousedown', (event) => {
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

// ── one floating popover at a time ──────────────────────────────────────────────────────────

interface Floating {
  node: HTMLElement;
  anchor: HTMLElement;
  dispose: () => void;
}

let current: Floating | null = null;

/**
 * Close whichever small popover is up, the hotspot's or a chip's peek. Safe to call when none is.
 * `chrome.ts` calls it as the editor goes. The slide **windows** are not closed by it: they stay
 * until the learner closes them (`slidewindow.ts`).
 */
export function closeSourcePopover(): void {
  const was = current;
  current = null;
  was?.dispose();
  closePeek();
}

/**
 * `start` hangs the popover from the anchor's left edge; `end` from its right. Only the hotspots
 * use this now, from `start`.
 */
type Align = 'start' | 'end';

function place(node: HTMLElement, anchor: HTMLElement, align: Align): void {
  const at = anchor.getBoundingClientRect();
  const width = node.offsetWidth;
  const height = node.offsetHeight;
  const maxLeft = Math.max(EDGE, globalThis.innerWidth - width - EDGE);
  const left = Math.min(maxLeft, Math.max(EDGE, align === 'end' ? at.right - width : at.left));
  // Below the anchor, or above it when below would run off the window.
  const below = at.bottom + 6;
  const top = below + height + EDGE <= globalThis.innerHeight ? below : Math.max(EDGE, at.top - height - 6);
  node.style.left = `${String(Math.round(left))}px`;
  node.style.top = `${String(Math.round(top))}px`;
}

function show(anchor: HTMLElement, node: HTMLElement, align: Align, onClosed?: () => void): void {
  closeSourcePopover();
  (anchor.closest('.nd') ?? document.body).append(node);
  place(node, anchor, align);

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') closeSourcePopover();
  };
  const onDown = (event: MouseEvent): void => {
    const target = event.target as globalThis.Node | null;
    if (target && (node.contains(target) || anchor.contains(target))) return;
    closeSourcePopover();
  };
  // The anchor moves with the document and the popover does not, so a scroll closes it.
  const onScroll = (event: Event): void => {
    if (event.target instanceof globalThis.Node && node.contains(event.target)) return;
    closeSourcePopover();
  };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('mousedown', onDown, true);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', closeSourcePopover);
  current = {
    node,
    anchor,
    dispose: () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', closeSourcePopover);
      node.remove();
      onClosed?.();
    },
  };
}

// ── the citation chip ───────────────────────────────────────────────────────────────────────

export interface CitePreviewOptions {
  /** The pages the block cites, in order. Never empty: a chip with no page has no preview. */
  pages: readonly number[];
  /** `added: …`, when the block carries one. Shown under the slide. */
  reason: string | null;
  /** The block's text *now*, read per page shown: the learner may have edited it since the chip was built. */
  text: () => string;
  /** A `slide_figure`'s own page and crop: its region is that crop, and nothing is matched. */
  figure: { page: number; rect: Rect | null } | null;
  reader: SlideReader;
  /**
   * **No longer called.** The chip's click used to open the slide modal here; it now opens a slide
   * window. Optional and ignored, so the callers that still pass it compile until they stop.
   */
  onOpenSlide?: (page: number, rect: Rect | null) => void;
  /**
   * The window's "Insert into notes": put `page` (cropped to `rect`, or whole when null) into
   * the document as a `slide_figure` at this block. Absent: no Insert action is offered.
   */
  onInsert?: (target: { page: number; rect: Rect | null }) => void;
}

// ── the peek ────────────────────────────────────────────────────────────────────────────────

/** The peek's width in CSS px: a thumbnail, not a reading surface (the window is that). */
const PEEK_WIDTH = 280;
/** Hover intent: long enough that a pointer crossing the gutter does not open one. */
const PEEK_DELAY_MS = 260;

let peek: { anchor: HTMLElement; node: HTMLElement; dispose: () => void } | null = null;

function closePeek(): void {
  const was = peek;
  peek = null;
  was?.dispose();
}

/**
 * **The peek** (3 Oct 2026): the cited slide, small, beside the chip, with the region the block was
 * drawn from outlined and its words quoted. It takes no pointer events, so it never gets in the
 * way of the line being read, and it goes as soon as the pointer leaves the chip, the notes
 * scroll, or anything is pressed.
 */
function showPeek(chip: HTMLElement, options: CitePreviewOptions): void {
  closePeek();
  if (!chip.isConnected) return;
  const page = options.pages[0];
  if (page === undefined) return;
  const source = options.reader.slides();
  const node = el('div', 'nd-peek');
  node.setAttribute('role', 'tooltip');
  const where = el('div', 'nd-peek-where', source ? source.title(page) : `Slide ${String(page)}`);
  if (options.pages.length > 1) where.append(el('span', 'nd-peek-more', ` · and ${String(options.pages.length - 1)} more`));
  const frame = el('div', 'nd-peek-frame');
  const quote = el('div', 'nd-peek-quote');
  quote.hidden = true;
  node.append(where, frame, quote, el('div', 'nd-peek-hint', 'Click to open'));

  const place = (): void => {
    const view = { left: 0, top: 0, right: globalThis.innerWidth, bottom: globalThis.innerHeight };
    const at = chip.getBoundingClientRect();
    const spot = placeBeside(at, { width: PEEK_WIDTH, height: node.offsetHeight }, view, MARGIN);
    node.style.left = `${String(spot.left)}px`;
    node.style.top = `${String(spot.top)}px`;
  };

  let alive = true;
  if (source?.kindOf(page) === 'text') {
    void source.text(page).then((text) => {
      if (!alive) return;
      frame.append(el('div', 'nd-peek-text', (text ?? '').slice(0, 600)));
      place();
    });
  } else if (source) {
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    void source.canvas(page, Math.round(PEEK_WIDTH * dpr)).then((rendered) => {
      if (!alive || !rendered) return;
      // The cache owns its canvas and a window may be showing it: copy, never adopt.
      const copy = document.createElement('canvas');
      copy.width = Math.round(PEEK_WIDTH * dpr);
      copy.height = Math.round((copy.width * rendered.height) / Math.max(1, rendered.width));
      copy.getContext('2d')?.drawImage(rendered, 0, 0, copy.width, copy.height);
      frame.prepend(copy);
      place();
    });
    const region = options.figure && options.figure.page === page ? Promise.resolve({ rect: options.figure.rect, quote: '' }) : findRegion(options, page);
    void region.then((found) => {
      if (!alive) return;
      if (found.rect) {
        const mark = el('span', 'nd-peek-rect');
        Object.assign(mark.style, rectPercent(found.rect));
        frame.append(mark);
      }
      if (found.quote) {
        quote.textContent = found.quote;
        quote.hidden = false;
        place();
      }
    });
  }

  const off = (): void => closePeek();
  document.body.append(node);
  place();
  window.addEventListener('scroll', off, true);
  window.addEventListener('mousedown', off, true);
  window.addEventListener('keydown', off, true);
  peek = {
    anchor: chip,
    node,
    dispose: () => {
      alive = false;
      window.removeEventListener('scroll', off, true);
      window.removeEventListener('mousedown', off, true);
      window.removeEventListener('keydown', off, true);
      node.remove();
    },
  };
}

async function findRegion(options: CitePreviewOptions, page: number): Promise<{ rect: Rect | null; quote: string }> {
  const view = await options.reader.pageLines(page).catch(() => null);
  const region = view ? bestRegion(options.text(), view.lines) : null;
  return region ? { rect: toRect(region.rect), quote: region.quote } : { rect: null, quote: '' };
}

/**
 * Give a provenance chip its peek on hover, and return its click: the slide in a window of its
 * own (`slidewindow.ts`), paging through the pages the block cites. The caller keeps owning the
 * chip's click listener and calls this from it.
 */
export function attachCitePreview(chip: HTMLElement, options: CitePreviewOptions): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  chip.addEventListener('mouseenter', () => {
    cancel();
    timer = setTimeout(() => showPeek(chip, options), PEEK_DELAY_MS);
  });
  chip.addEventListener('mouseleave', () => {
    cancel();
    if (peek?.anchor === chip) closePeek();
  });
  chip.setAttribute('aria-haspopup', 'dialog');
  return () => {
    cancel();
    closePeek();
    openSlideWindow({
      anchor: chip,
      pages: options.pages,
      reader: options.reader,
      text: options.text,
      rect: options.figure?.rect ?? null,
      ...(options.figure ? { rectPage: options.figure.page } : {}),
      reason: options.reason,
      ...(options.onInsert ? { onInsert: options.onInsert } : {}),
    });
  };
}

// ── a figure's hotspots ─────────────────────────────────────────────────────────────────────

export interface HotspotOptions {
  page: number;
  hotspots: readonly Hotspot[];
  /** Null when the figure's block has no id yet, or nothing is listening: the label still shows. */
  onAsk: ((label: string) => void) | null;
}

/**
 * Fill a figure's hotspot layer. The layer itself takes no pointer events (notes.css), so a click
 * anywhere that is not a label still reaches the figure's own button and opens the slide.
 */
export function drawHotspots(layer: HTMLElement, options: HotspotOptions): void {
  layer.replaceChildren();
  if (options.hotspots.length === 0) return;
  for (const spot of options.hotspots) {
    const hot = button('nd-hot', '', '', () => {
      if (current?.anchor === hot) {
        closeSourcePopover();
        return;
      }
      const pop = el('div', 'nd-pop nd-hotpop');
      pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-label', `The label ${spot.label}`);
      pop.append(
        el('div', 'nd-hotpop-label', `“${spot.label}”`),
        el('div', 'nd-hotpop-where', `a label on slide ${String(options.page)}`),
      );
      const ask = options.onAsk;
      if (ask) {
        pop.append(
          button('nd-hotpop-ask', 'Ask Ellie about this', 'Ellie answers in the chat, in a thread on this figure', () => {
            closeSourcePopover();
            ask(spot.label);
          }),
        );
      }
      hot.classList.add('nd-hot-open');
      closePeek();
      show(hot, pop, 'start', () => hot.classList.remove('nd-hot-open'));
    });
    hot.setAttribute('aria-label', `${spot.label}: a label in this figure`);
    hot.style.left = `${String(spot.rect.x * 100)}%`;
    hot.style.top = `${String(spot.rect.y * 100)}%`;
    hot.style.width = `${String(spot.rect.w * 100)}%`;
    hot.style.height = `${String(spot.rect.h * 100)}%`;
    layer.append(hot);
  }
  layer.append(el('span', 'nd-hot-hint', 'Click a label to ask Ellie'));
}
