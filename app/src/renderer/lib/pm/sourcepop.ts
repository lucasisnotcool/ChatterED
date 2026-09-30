/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THE SLIDE, WITHIN REACH OF THE NOTES: THE CITATION PREVIEW AND THE FIGURE'S HOTSPOTS (§3)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Two small popovers, both chrome and both outside the document:
 *
 *  - **the citation preview**, on a provenance chip's hover: a thumbnail of the slide with the
 *    region the block was drawn from outlined, and the slide's own words for it. The chip's
 *    click still opens the modal (`chrome.ts`), now with that region outlined there too.
 *  - **a figure's hotspots**: the slide's own text labels inside an inline crop, each a button
 *    over the pixels. A click offers "Ask Ellie about this", which opens a span thread on the
 *    figure's block.
 *
 * **Neither asks a model where anything is.** The region comes from `bestRegion` and the labels
 * from `hotspotsIn` (`shared/doc/cite.ts`), both over the PDF's own text geometry. When no region
 * matches, the preview is the whole slide with no outline and no quote.
 *
 * The popover element is appended to the notes pane (`.nd`), not inside ProseMirror's DOM and not
 * inside the zoomed sheet: it is `position: fixed` at the anchor's viewport box, so it is never
 * clipped by the scroller, never scaled by the notes zoom, and never seen by the editor.
 */
import { bestRegion, type Hotspot, type LineRect, type PageLinesView } from '../../../shared/doc/cite.js';
import type { Rect } from '../../../shared/doc/types.js';
import type { SlideSource } from '../rasterise.js';

/** What both popovers read the slide through. Supplied by `NotesEditor.svelte`. */
export interface SlideReader {
  slides: () => SlideSource | null;
  pageLines: (page: number) => Promise<PageLinesView | null>;
}

/** The thumbnail's width in CSS px. The popover is this plus its padding (notes.css). */
const THUMB_WIDTH = 264;
/** Hover intent: long enough that a pointer crossing the gutter does not open one. */
const OPEN_DELAY_MS = 260;
/** Long enough to travel from the chip into the popover. */
const CLOSE_DELAY_MS = 180;
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

/** Close whichever popover is up. Safe to call when none is. */
export function closeSourcePopover(): void {
  const was = current;
  current = null;
  was?.dispose();
}

/**
 * `start` hangs the popover from the anchor's left edge; `end` from its right, which is what a
 * chip wants: it sits in the right gutter, and a preview hung from its left would lie over the
 * chat column instead of over the notes it is about.
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

// ── the citation preview ────────────────────────────────────────────────────────────────────

export interface CitePreviewOptions {
  /** The pages the block cites, in order. Never empty: a chip with no page has no preview. */
  pages: readonly number[];
  /** `added: …`, when the block carries one. Shown under the slide. */
  reason: string | null;
  /** The block's text *now*, read on each hover: the learner may have edited it since the chip was built. */
  text: () => string;
  /** A `slide_figure`'s own page and crop: its region is that crop, and nothing is matched. */
  figure: { page: number; rect: Rect | null } | null;
  reader: SlideReader;
  onOpenSlide: (page: number, rect: Rect | null) => void;
}

interface Found {
  rect: Rect | null;
  quote: string;
}

/**
 * Give a provenance chip its preview. Returns the chip's click: open the modal at the first page,
 * with the matched region outlined.
 */
export function attachCitePreview(chip: HTMLElement, options: CitePreviewOptions): () => void {
  const { pages, reader } = options;
  let openTimer: ReturnType<typeof setTimeout> | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let token = 0;

  /** The region for one page. Recomputed per call; the lines behind it are cached. */
  const find = async (page: number): Promise<Found> => {
    if (options.figure && options.figure.page === page) return { rect: options.figure.rect, quote: '' };
    const view = await reader.pageLines(page).catch(() => null);
    const region = view ? bestRegion(options.text(), view.lines) : null;
    return region ? { rect: toRect(region.rect), quote: region.quote } : { rect: null, quote: '' };
  };

  const cancel = (): void => {
    if (openTimer) clearTimeout(openTimer);
    if (closeTimer) clearTimeout(closeTimer);
    openTimer = closeTimer = null;
  };
  const isUp = (): boolean => current !== null && current.anchor === chip;
  const closeSoon = (): void => {
    cancel();
    closeTimer = setTimeout(() => {
      if (isUp()) closeSourcePopover();
    }, CLOSE_DELAY_MS);
  };

  const build = (): void => {
    if (!chip.isConnected) return;
    const pop = el('div', 'nd-pop nd-cite');
    pop.setAttribute('role', 'tooltip');
    const head = el('div', 'nd-cite-head');
    const where = el('span', 'nd-cite-where');
    const count = el('span', 'nd-cite-count');
    head.append(where, count);
    let index = 0;
    let found: Found = { rect: null, quote: '' };
    const thumb = button('nd-cite-thumb', '', 'Open this slide', () => {
      const page = pages[index]!;
      const rect = found.rect;
      closeSourcePopover();
      options.onOpenSlide(page, rect);
    });
    const quote = el('blockquote', 'nd-cite-quote');
    pop.append(head, thumb, quote);
    if (options.reason) pop.append(el('div', 'nd-cite-reason', `added: ${options.reason}`));

    const draw = (): void => {
      const page = pages[index]!;
      const mine = ++token;
      where.textContent = `Slide ${String(page)}`;
      count.textContent = pages.length > 1 ? `${String(index + 1)} of ${String(pages.length)}` : '';
      thumb.replaceChildren();
      thumb.classList.remove('nd-cite-ready');
      quote.textContent = '';
      quote.hidden = true;
      found = { rect: null, quote: '' };

      const source = reader.slides();
      const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
      const canvas = source ? source.canvas(page, Math.round(THUMB_WIDTH * dpr)).catch(() => null) : Promise.resolve(null);
      void Promise.all([canvas, find(page)]).then(([rendered, region]) => {
        if (mine !== token || !pop.isConnected) return;
        found = region;
        if (rendered) {
          // The cache owns its canvas and the carousel may be showing it: copy, never adopt.
          const copy = document.createElement('canvas');
          copy.width = Math.round(THUMB_WIDTH * dpr);
          copy.height = Math.round((copy.width * rendered.height) / Math.max(1, rendered.width));
          copy.getContext('2d')?.drawImage(rendered, 0, 0, copy.width, copy.height);
          thumb.append(copy);
          thumb.classList.add('nd-cite-ready');
          if (region.rect) {
            const mark = el('span', 'nd-cite-rect');
            mark.style.left = `${String(region.rect.x0 * 100)}%`;
            mark.style.top = `${String(region.rect.y0 * 100)}%`;
            mark.style.width = `${String((region.rect.x1 - region.rect.x0) * 100)}%`;
            mark.style.height = `${String((region.rect.y1 - region.rect.y0) * 100)}%`;
            thumb.append(mark);
          }
        }
        if (region.quote) {
          quote.textContent = region.quote;
          quote.hidden = false;
        }
        // The box grew once the slide arrived; it may need to flip above the chip.
        place(pop, chip, 'end');
      });
    };

    if (pages.length > 1) {
      const turn = (delta: number): void => {
        index = (index + delta + pages.length) % pages.length;
        draw();
      };
      head.append(
        button('nd-cite-turn', '‹', 'The previous slide this block cites', () => turn(-1)),
        button('nd-cite-turn', '›', 'The next slide this block cites', () => turn(1)),
      );
    }
    pop.addEventListener('mouseenter', cancel);
    pop.addEventListener('mouseleave', closeSoon);

    show(chip, pop, 'end', () => {
      token++;
    });
    draw();
  };

  chip.addEventListener('mouseenter', () => {
    cancel();
    if (isUp()) return;
    openTimer = setTimeout(build, OPEN_DELAY_MS);
  });
  chip.addEventListener('mouseleave', closeSoon);
  chip.addEventListener('focus', () => {
    cancel();
    if (!isUp()) build();
  });
  chip.addEventListener('blur', closeSoon);

  return () => {
    cancel();
    if (isUp()) closeSourcePopover();
    const page = pages[0]!;
    // The modal opens on the region, so it waits for the match: one cached lookup after a hover,
    // and a hover nearly always came first. A failure opens the whole slide, as it always did.
    void find(page).then(
      (region) => options.onOpenSlide(page, region.rect),
      () => options.onOpenSlide(page, null),
    );
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
