/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * SLIDE WINDOWS: THE SOURCE, READABLE, WHEREVER THE LEARNER WANTS IT (§3, 2026-10-03)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * What a provenance chip, a slide thumbnail or an inline figure opens. The first cut of the day
 * was a popover tied to its chip, which closed as soon as the chip scrolled out of view; Lucas
 * asked instead for a window that stays: **moveable, resizeable, open until it is closed, and
 * floating anywhere over the app.** So a slide can sit beside the chat while the notes scroll, two
 * slides can be compared side by side, and a definition can be read off one while it is written
 * up in the other column.
 *
 *  - **One window per click.** A second reference opens a second window, cascaded down and right
 *    so it does not hide the first. Clicking a reference whose slide is already open brings that
 *    window to the front rather than opening it twice.
 *  - **Moved by its title bar, resized from any edge or corner** (`lib/floatframe.ts`). It may go
 *    anywhere, as long as enough of its title bar stays in the app to drag it back and its top
 *    stays below the app's title bar, the OS drag region (`clampFrame`). The last size the learner
 *    chose is what the next window opens at, and is kept across launches; positions are not, as a
 *    window belongs beside the line that opened it.
 *  - **Keys, while it has focus** (it takes focus when it opens, and on any press in it): ← → step
 *    through the deck, ↑ ↓ through the slides the block cites (or the section's strip), Esc closes
 *    it, or leaves crop mode first (`windowKey`).
 *  - **Read and copied**: the slide fills the window in its own shape, with pdf.js's text layer
 *    over the pixels so a definition can be selected and copied. A text source's page is its words.
 *  - **Brought into the notes**: "Insert into notes" turns the slide into a crop tool (pre-filled
 *    with the region the block was matched to, when there is one); the window says *what*
 *    (`onInsert({ page, rect })`) and the editor decides how a `slide_figure` goes in. The window
 *    stays open afterwards, as everything about it does until it is closed.
 *  - **An image's crop, edited in place** (third cut): opened from a slide figure in the notes
 *    (`crop`), the figure's region is not just outlined but a box with eight handles, as an image
 *    is cropped in Word. Drag inside to move it, a corner to resize freely, an edge along one axis;
 *    Shift+arrows nudge it; "Whole slide" takes the crop off. Each finished gesture tells the
 *    editor once (`crop.onChange`), and the box stays where it was put, because it *is* the
 *    image's crop now. Only on the figure's own page: step away and the slide is read as any
 *    other; step back and the box is there again. "Insert into notes" still works beside it: its
 *    crop tool hides the box while it is open, and starts from the box's region.
 *
 * The windows are appended to `document.body` and are `position: fixed`, outside ProseMirror's DOM
 * and outside the zoomed sheet: never clipped by a scroller, never scaled by the notes zoom, never
 * seen by the editor. Their geometry is `slidegeom.ts`'s, pure and tested.
 */
import { bestRegion } from '../../../shared/doc/cite.js';
import type { Rect } from '../../../shared/doc/types.js';
import { attachEdgeHandles, clampFrame, floatArea, resizeFrame, type ClampOptions } from '../floatframe.js';
import type { SlideSource } from '../rasterise.js';
import {
  BAR_HEIGHT,
  HANDLES,
  KEEP_VISIBLE,
  MARGIN,
  NUDGE,
  WHOLE_SLIDE,
  WINDOW_MIN,
  WINDOW_SIZE,
  cascade,
  citedStep,
  dragRect,
  fitSlide,
  handleAt,
  moveRect,
  placeBeside,
  rectPercent,
  resizeRect,
  sameRect,
  settleCrop,
  usableCrop,
  wholeSlide,
  windowKey,
  type Box,
  type Handle,
  type Point,
} from './slidegeom.js';
import type { SlideReader } from './sourcepop.js';
import '../../components/notes/floatframe.css';
import '../../components/notes/slidewindow.css';

export interface SlideWindowOptions {
  /** What was clicked: the new window opens beside it. */
  anchor: HTMLElement;
  /** The pages ↑ ↓ and the "2 of 3" pill step through: a chip's cited pages, or a strip's. */
  pages: readonly number[];
  /** Which of them first. Default 0. */
  index?: number;
  /** A known region to outline (a figure's crop). Without one, the region is matched from `text()`. */
  rect?: Rect | null;
  /** The page `rect` belongs to. Default: the page the window opens on. */
  rectPage?: number;
  /** The block's text *now*, for `bestRegion` matching. Read on each page shown. */
  text?: () => string;
  reader: SlideReader;
  /** `added: …`, when the block carries one: shown under the slide. */
  reason?: string | null;
  /** Absent: no Insert action. `rect` null = the whole slide. */
  onInsert?: (target: { page: number; rect: Rect | null }) => void;
  /**
   * The window was opened from an image in the notes: its crop is shown as an editable box on
   * `rectPage` (move it by dragging inside, resize by its 8 handles — corners free, edges one axis),
   * and `onChange` is called once per completed gesture (pointerup) with the new normalised rect, or
   * null when the box covers the whole slide (within ~0.5%). Not offered on other pages.
   */
  crop?: { onChange: (rect: Rect | null) => void };
}

/** Re-render the slide once a resize holds still, not on every frame of it. */
const RERENDER_DELAY_MS = 140;
const SIZE_KEY = 'chattered.slideWindowSize';
/** Room round the slide for an editable crop's handles, which stand 5.5 px out (`slidewindow.css`). */
const HANDLE_ROOM = 7;

// ── the open windows ────────────────────────────────────────────────────────────────────────

interface Live {
  anchor: HTMLElement;
  pages: readonly number[];
  page: () => number;
  node: HTMLElement;
  front: () => void;
  close: () => void;
}

const open = new Set<Live>();
/** Over the app's own panes and floating cards (≤ 40); each window pressed comes to the front. */
let zTop = 60;

/**
 * The area a window lives in: the app below its title bar (`floatArea`). Never under the bar: it
 * is the OS drag region, which wins over any DOM laid on it, so a window's header there could
 * neither be dragged nor have its × clicked (Lucas, 2026-10-04).
 */
function viewportBox(): Box {
  return floatArea();
}

/** How a window is kept in the app (`clampFrame`): its header grabbable, never under the title bar. */
const CLAMP: ClampOptions = { min: WINDOW_MIN, keep: KEEP_VISIBLE, bar: BAR_HEIGHT, margin: MARGIN };

/** The size the learner last left a window at. Best effort: storage may be refused. */
function savedSize(): { width: number; height: number } {
  try {
    const raw = globalThis.localStorage?.getItem(SIZE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { width?: unknown; height?: unknown };
      if (typeof parsed.width === 'number' && typeof parsed.height === 'number') return { width: parsed.width, height: parsed.height };
    }
  } catch {
    // A private window, or storage switched off: the default size.
  }
  return { ...WINDOW_SIZE };
}

function saveSize(size: { width: number; height: number }): void {
  try {
    globalThis.localStorage?.setItem(SIZE_KEY, JSON.stringify(size));
  } catch {
    // Not kept, and nothing else depends on it.
  }
}

/** How many slide windows are open. */
export function slideWindowCount(): number {
  return open.size;
}

/** Close every slide window: a different notebook opened, and they read the old one's deck. */
export function closeAllSlideWindows(): void {
  for (const live of [...open]) live.close();
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className: string, text: string, title: string, onClick: () => void): HTMLButtonElement {
  const node = el('button', `nd-sp-btn ${className}`.trim(), text);
  node.type = 'button';
  if (title) node.title = title;
  node.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return node;
}

interface Found {
  rect: Rect | null;
  quote: string;
}

/**
 * **Open a slide window beside `anchor`.** If that page is already open from the same reference
 * (or slide set), bring it to the front. A shared fallback anchor must not swallow a different
 * page request from Doc chat.
 */
export function openSlideWindow(options: SlideWindowOptions): void {
  const { anchor, pages, reader } = options;
  if (pages.length === 0) return;
  const startIndex = Math.min(Math.max(0, options.index ?? 0), pages.length - 1);
  const startPage = pages[startIndex]!;
  const same = [...open].find(
    (live) => live.page() === startPage && (live.anchor === anchor || live.pages.join(',') === pages.join(',')),
  );
  if (same) {
    same.front();
    return;
  }

  let page = startPage;
  let lastCited = page;
  const rectPage = options.rectPage ?? page;

  // ── the frame ──
  const node = el('div', 'nd-sw ff-window');
  node.setAttribute('role', 'dialog');
  node.tabIndex = -1;
  const bar = el('div', 'nd-sw-bar');
  const where = el('span', 'nd-sp-where');
  const cited = el('span', 'nd-sp-cited');
  const count = el('span', 'nd-sp-count');
  const citedPrev = button('nd-sp-icon', '‹', 'The previous slide this cites (↑)', () => go(citedStep(pages, page, -1)));
  const citedNext = button('nd-sp-icon', '›', 'The next slide this cites (↓)', () => go(citedStep(pages, page, 1)));
  if (pages.length > 1) cited.append(citedPrev, count, citedNext);
  const back = button('nd-sp-back', '', 'Back to the slide this cites', () => go(lastCited));
  const close = button('nd-sp-icon nd-sw-close', '×', 'Close (Esc)', () => live.close());
  bar.append(where, cited, back, el('span', 'nd-sp-spacer'), close);

  const body = el('div', 'nd-sw-body');
  const stage = el('div', 'nd-sp-stage');
  const quote = el('blockquote', 'nd-sp-quote');
  quote.hidden = true;
  body.append(stage, quote);
  if (options.reason) body.append(el('div', 'nd-sp-reason', `added: ${options.reason}`));

  const foot = el('div', 'nd-sp-foot');
  const deckPrev = button('', '‹ Previous', 'The slide before this one in the deck (←)', () => step(-1));
  const deckNext = button('', 'Next ›', 'The slide after this one in the deck (→)', () => step(1));
  const insert = options.onInsert
    ? button('nd-sp-primary', 'Insert into notes', 'Put this slide, or a part of it, into the notes', () => startCrop())
    : null;
  const wholeBtn = options.crop
    ? button('nd-sp-whole', 'Whole slide', 'Show the whole slide in the notes, uncropped', () => {
        editRect = { ...WHOLE_SLIDE };
        commit();
      })
    : null;
  if (wholeBtn) wholeBtn.hidden = true;
  foot.append(deckPrev, deckNext, el('span', 'nd-sp-spacer'));
  if (wholeBtn) foot.append(wholeBtn);
  if (insert) foot.append(insert);

  const cropBar = el('div', 'nd-sp-foot nd-sp-cropbar');
  cropBar.hidden = true;
  const insertSel = button('nd-sp-primary', 'Insert selection', 'Insert the part you dragged across', () => {
    if (usableCrop(selection)) finishInsert(selection);
  });
  const insertWhole = button('', 'Insert whole slide', 'Insert the whole slide', () => finishInsert(null));
  const cancelCrop = button('', 'Cancel', 'Back to the slide (Esc)', () => stopCrop());
  cropBar.append(el('span', 'nd-sp-hint', 'Drag across the part to insert'), el('span', 'nd-sp-spacer'), cancelCrop, insertWhole, insertSel);

  node.append(bar, body, foot, cropBar);

  // ── the slide ──
  /** Bumped per page shown and per render, so a late canvas never lands on the wrong page. */
  let token = 0;
  let aspect: number | null = null;
  let isText = false;
  let found: Found = { rect: null, quote: '' };
  let renderedWidth = 0;
  let rerenderTimer: ReturnType<typeof setTimeout> | null = null;

  const slide = el('div', 'nd-sp-slide');
  const mark = el('span', 'nd-sp-rect');
  const crop = el('div', 'nd-sp-crop');
  const sel = el('span', 'nd-sp-sel');
  crop.append(sel);

  // The image's crop, when the window was opened from one (`options.crop`). `cropRect` is what the
  // editor was last told (or was given), and what the box shows on a return to `rectPage`;
  // `editRect` is the box as it stands mid-gesture. The whole slide is held as a rect here, so the
  // box has something to draw, and is told to the editor as null (`settleCrop`).
  let cropRect: Rect = options.rect ? { ...options.rect } : { ...WHOLE_SLIDE };
  let editRect: Rect = cropRect;
  const edit = el('div', 'nd-sp-edit');
  edit.title = 'Drag to move the crop; drag a handle to resize it';
  for (const handle of HANDLES) {
    const knob = el('span', `nd-sp-h nd-sp-h-${handle}`);
    knob.dataset.handle = handle;
    edit.append(knob);
  }

  /** Size the slide to the stage, in its own shape. Returns its width. */
  const fit = (): number => {
    if (aspect === null) return 0;
    // An editable crop's handles straddle its edges, so a whole-slide crop's would be half cut
    // off by the stage: leave them room.
    const inset = options.crop ? 2 * HANDLE_ROOM : 0;
    const box = fitSlide({ width: stage.clientWidth - inset, height: stage.clientHeight - inset }, aspect);
    slide.style.width = `${String(box.width)}px`;
    slide.style.height = `${String(box.height)}px`;
    return box.width;
  };

  const paintNav = (source: SlideSource | null): void => {
    where.textContent = source ? source.title(page) : `Slide ${String(page)}`;
    node.setAttribute('aria-label', where.textContent);
    const at = pages.indexOf(page);
    if (at >= 0) lastCited = page;
    count.textContent = at >= 0 ? `${String(at + 1)} of ${String(pages.length)}` : `– of ${String(pages.length)}`;
    back.hidden = at >= 0;
    back.textContent = `↩ ${source ? source.title(lastCited) : `Slide ${String(lastCited)}`}`;
    deckPrev.disabled = !source || source.step(page, -1) === null;
    deckNext.disabled = !source || source.step(page, 1) === null;
  };

  /** The region on this page: a figure's own crop, else the block's text matched to the slide's lines. */
  const findRegion = async (at: number): Promise<Found> => {
    if (options.crop && at === rectPage) return { rect: cropRect, quote: '' };
    if (options.rect && at === rectPage) return { rect: options.rect, quote: '' };
    if (!options.text) return { rect: null, quote: '' };
    const view = await reader.pageLines(at).catch(() => null);
    const region = view ? bestRegion(options.text(), view.lines) : null;
    if (!region) return { rect: null, quote: '' };
    const r = region.rect;
    return { rect: { x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h }, quote: region.quote };
  };

  /** Is the image's crop editable here: opened from an image, on its page, with the slide drawn? */
  const canEdit = (): boolean => !!options.crop && page === rectPage && !isText && aspect !== null;

  const paintEdit = (): void => {
    Object.assign(edit.style, rectPercent(editRect));
    if (wholeBtn) wholeBtn.hidden = !canEdit() || wholeSlide(editRect);
  };

  const paintRect = (): void => {
    mark.remove();
    edit.remove();
    if (canEdit()) {
      // The editable box replaces the outline: the same yellow, with handles.
      paintEdit();
      slide.append(edit);
      return;
    }
    if (wholeBtn) wholeBtn.hidden = true;
    if (!found.rect || isText) return;
    Object.assign(mark.style, rectPercent(found.rect));
    slide.append(mark);
  };

  /** Draw the page's pixels and text layer at the slide's current width. */
  const render = (): void => {
    const source = reader.slides();
    if (!source || isText || aspect === null) return;
    const width = fit();
    if (width <= 0) return;
    const mine = ++token;
    renderedWidth = width;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const at = page;
    void source.crop(at, null, width, dpr).then((canvas) => {
      if (mine !== token || !node.isConnected) return;
      if (!canvas) {
        if (!slide.querySelector('.nd-sp-empty')) slide.prepend(el('div', 'nd-sp-empty', 'This slide could not be drawn.'));
        return;
      }
      canvas.className = 'nd-sp-canvas';
      canvas.style.width = '';
      canvas.style.height = '';
      slide.querySelector('.nd-sp-canvas')?.remove();
      slide.prepend(canvas);
    });
    const layer = el('div', 'textLayer');
    void source.textLayer(at, layer, width).then((ok) => {
      if (mine !== token || !node.isConnected || !ok) return;
      // pdf_viewer's trick: a block at the end that a drag past the last word lands on, moved
      // to the top while selecting so the selection does not jump to the start of the page.
      layer.append(el('div', 'endOfContent'));
      layer.addEventListener('mousedown', () => layer.classList.add('selecting'));
      slide.querySelector('.textLayer')?.remove();
      slide.insertBefore(layer, crop);
    });
  };

  const scheduleRerender = (): void => {
    if (rerenderTimer) clearTimeout(rerenderTimer);
    // The box follows the window at once; the pixels catch up once it holds still.
    fit();
    rerenderTimer = setTimeout(() => {
      rerenderTimer = null;
      const width = fit();
      if (Math.abs(width - renderedWidth) > 1) render();
    }, RERENDER_DELAY_MS);
  };

  /** Show `page`: its title and navigation, its slide (or its words), its matched region. */
  const draw = (): void => {
    const mine = ++token;
    const source = reader.slides();
    // A gesture or nudge cut short by a page change still counts: the box is where it was left.
    endEdit();
    paintNav(source);
    stopCrop();
    if (wholeBtn) wholeBtn.hidden = true;
    found = { rect: null, quote: '' };
    quote.hidden = true;
    quote.textContent = '';
    slide.replaceChildren(crop);
    stage.replaceChildren(slide);
    renderedWidth = 0;
    isText = source?.kindOf(page) === 'text';
    node.classList.toggle('nd-sp-textmode', isText);
    if (insert) insert.textContent = isText ? 'Insert this page' : 'Insert into notes';

    if (!source || !source.locate(page)) {
      aspect = null;
      const why = source ? 'This source is no longer in the notebook.' : 'The slides are still opening.';
      stage.replaceChildren(el('div', 'nd-sp-empty', why));
      return;
    }
    if (isText) {
      aspect = null;
      const words = el('div', 'nd-sp-textpage', '');
      stage.replaceChildren(words);
      void source.text(page).then((text) => {
        if (mine !== token || !node.isConnected) return;
        words.textContent = text ?? 'This part of the source could not be read.';
      });
      return;
    }
    const known = source.size(page);
    aspect = known && known.width > 0 ? known.height / known.width : 9 / 16;
    fit();
    const at = page;
    void source.measure(at).then(
      (measured) => {
        if (mine !== token || !node.isConnected) return;
        if (measured.width > 0) aspect = measured.height / measured.width;
        render();
      },
      () => {
        if (mine === token) render();
      },
    );
    void findRegion(at).then((region) => {
      if (at !== page || !node.isConnected) return;
      found = region;
      paintRect();
      if (region.quote) {
        quote.textContent = region.quote;
        quote.hidden = false;
      }
    });
  };

  const go = (to: number | null): void => {
    if (to === null || to === page) return;
    page = to;
    draw();
  };
  const step = (delta: number): void => {
    go(reader.slides()?.step(page, delta) ?? null);
  };

  // ── crop mode ──
  let cropping = false;
  let selection: Rect | null = null;
  let dragFrom: Point | null = null;

  const paintSelection = (): void => {
    sel.hidden = selection === null;
    if (selection) Object.assign(sel.style, rectPercent(selection));
    insertSel.disabled = !usableCrop(selection);
  };

  function startCrop(): void {
    if (isText || !reader.slides()) {
      finishInsert(null);
      return;
    }
    cropping = true;
    selection = found.rect;
    node.classList.add('nd-sp-cropping');
    foot.hidden = true;
    cropBar.hidden = false;
    paintSelection();
  }

  function stopCrop(): void {
    if (!cropping) return;
    cropping = false;
    dragFrom = null;
    node.classList.remove('nd-sp-cropping');
    foot.hidden = false;
    cropBar.hidden = true;
  }

  function finishInsert(rect: Rect | null): void {
    const target = { page, rect };
    stopCrop();
    options.onInsert?.(target);
    node.classList.add('nd-sw-inserted');
    setTimeout(() => node.classList.remove('nd-sw-inserted'), 900);
  }

  const toPoint = (event: PointerEvent): Point => {
    const r = slide.getBoundingClientRect();
    return { x: (event.clientX - r.left) / Math.max(1, r.width), y: (event.clientY - r.top) / Math.max(1, r.height) };
  };
  crop.addEventListener('pointerdown', (event) => {
    if (!cropping || event.button !== 0) return;
    event.preventDefault();
    crop.setPointerCapture(event.pointerId);
    dragFrom = toPoint(event);
    selection = dragRect(dragFrom, dragFrom);
    paintSelection();
  });
  crop.addEventListener('pointermove', (event) => {
    if (!dragFrom) return;
    selection = dragRect(dragFrom, toPoint(event));
    paintSelection();
  });
  const endDrag = (): void => {
    if (!dragFrom) return;
    dragFrom = null;
    if (!usableCrop(selection)) selection = null;
    paintSelection();
  };
  crop.addEventListener('pointerup', endDrag);
  crop.addEventListener('pointercancel', endDrag);

  // ── the image's crop, edited ──
  /** A drag on the box: by which handle (or the body, to move it), from where, from what box. */
  let gesture: { handle: Handle | 'move'; from: Point; start: Rect } | null = null;
  /** Shift+arrow nudges not yet told to the editor: they are, once the key is let go. */
  let nudging = false;

  /** Tell the editor the box's new crop, once, if it changed; the box settles on what was stored. */
  function commit(): void {
    if (!options.crop) return;
    const stored = settleCrop(editRect);
    const next = stored ?? { ...WHOLE_SLIDE };
    editRect = next;
    if (page === rectPage) found = { rect: next, quote: '' };
    if (sameRect(next, cropRect)) {
      if (edit.isConnected) paintEdit();
      return;
    }
    cropRect = next;
    if (edit.isConnected) paintEdit();
    options.crop.onChange(stored);
  }

  /** Finish whatever gesture or nudge is under way, keeping where it got to. */
  function endEdit(): void {
    if (!gesture && !nudging) return;
    gesture = null;
    nudging = false;
    node.classList.remove('nd-sp-editing');
    commit();
  }

  edit.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || cropping || !canEdit()) return;
    // No text selection starts under the box, and the press is not the title bar's, so the
    // window stays where it is.
    event.preventDefault();
    // Captured by the handle itself (or the box), so the pointer keeps that one's cursor for the
    // whole drag; its events still bubble here.
    const target = event.target as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const handle = target.dataset.handle as Handle | undefined;
    gesture = { handle: handle ?? 'move', from: toPoint(event), start: editRect };
    node.classList.add('nd-sp-editing');
  });
  edit.addEventListener('pointermove', (event) => {
    if (!gesture) return;
    const at = toPoint(event);
    const dx = at.x - gesture.from.x;
    const dy = at.y - gesture.from.y;
    if (gesture.handle === 'move') editRect = moveRect(gesture.start, dx, dy);
    else {
      // The handle follows the pointer by the distance moved, not to the pointer itself, so a
      // handle grabbed off-centre does not jump.
      const from = handleAt(gesture.start, gesture.handle);
      editRect = resizeRect(gesture.start, gesture.handle, { x: from.x + dx, y: from.y + dy });
    }
    paintEdit();
  });
  edit.addEventListener('pointerup', endEdit);
  edit.addEventListener('pointercancel', endEdit);
  edit.addEventListener('lostpointercapture', endEdit);

  /** Shift+arrow: the box moves by `NUDGE`, told to the editor when the key comes up. */
  const nudge = (dx: number, dy: number): void => {
    editRect = moveRect(editRect, dx, dy);
    nudging = true;
    paintEdit();
  };
  node.addEventListener('keyup', (event) => {
    if (nudging && (event.key === 'Shift' || event.key.startsWith('Arrow'))) endEdit();
  });
  node.addEventListener('focusout', (event) => {
    if (!node.contains(event.relatedTarget as Node | null)) endEdit();
  });

  // ── the frame on screen: place, move, resize ──
  const area0 = viewportBox();
  let frame = clampFrame({ left: area0.left, top: area0.top, ...savedSize() }, area0, CLAMP);

  const apply = (): void => {
    node.style.left = `${String(frame.left)}px`;
    node.style.top = `${String(frame.top)}px`;
    node.style.width = `${String(frame.width)}px`;
    node.style.height = `${String(frame.height)}px`;
  };

  /** Beside the anchor, as the popover was, then down and right of any window already there. */
  const place = (): void => {
    const view = viewportBox();
    const at = anchor.isConnected ? anchor.getBoundingClientRect() : { left: view.right / 2, right: view.right / 2, top: 80, bottom: 80 };
    const beside = placeBeside(at, frame, view, MARGIN, { minWidth: WINDOW_MIN.width });
    const width = Math.max(WINDOW_MIN.width, Math.min(frame.width, beside.width));
    const spot = cascade(
      { left: beside.left, top: beside.top },
      [...open].map((live) => ({ left: live.node.offsetLeft, top: live.node.offsetTop })),
      view,
    );
    frame = clampFrame({ ...frame, width, ...spot }, view, CLAMP);
    apply();
  };

  // Move by the title bar (not its buttons).
  bar.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || (event.target as Element).closest('button')) return;
    event.preventDefault();
    bar.setPointerCapture(event.pointerId);
    const start = { x: event.clientX, y: event.clientY, left: frame.left, top: frame.top };
    node.classList.add('nd-sw-moving');
    const move = (e: PointerEvent): void => {
      frame = clampFrame({ ...frame, left: start.left + e.clientX - start.x, top: start.top + e.clientY - start.y }, viewportBox(), CLAMP);
      apply();
    };
    const up = (): void => {
      node.classList.remove('nd-sw-moving');
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      bar.removeEventListener('pointercancel', up);
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', up);
  });

  // Resize from any edge or corner (`attachEdgeHandles`, shared with the tutorial window). The
  // slide refits to the stage in its own shape as it goes (`fit`, via the stage's ResizeObserver
  // and `scheduleRerender`). The size is remembered for the next window.
  let resizeStart = frame;
  attachEdgeHandles(node, {
    start: () => {
      resizeStart = { ...frame };
      node.classList.add('nd-sw-resizing');
      front();
    },
    move: (edge, dx, dy) => {
      frame = resizeFrame(resizeStart, edge, dx, dy, viewportBox(), WINDOW_MIN, MARGIN);
      apply();
      scheduleRerender();
    },
    end: () => {
      node.classList.remove('nd-sw-resizing');
      saveSize({ width: frame.width, height: frame.height });
    },
  });

  // ── focus and keys ──
  const front = (): void => {
    zTop += 1;
    node.style.zIndex = String(zTop);
    for (const other of open) other.node.classList.toggle('nd-sw-front', other.node === node);
    if (!node.contains(document.activeElement)) node.focus({ preventScroll: true });
  };

  // A press anywhere in the window brings it forward. It stops here, so the notes pane's own press
  // handlers (focusing the editor, closing its menus) never see it.
  node.addEventListener('pointerdown', () => {
    front();
  });
  node.addEventListener('mousedown', (event) => event.stopPropagation());
  node.addEventListener('mouseup', () => {
    for (const layer of node.querySelectorAll('.textLayer.selecting')) layer.classList.remove('selecting');
  });

  node.addEventListener('keydown', (event) => {
    const action = windowKey(event, { nudge: canEdit() && !cropping && edit.isConnected });
    if (action === null) return;
    // Not the editor's: these keys belong to the window that has focus.
    event.preventDefault();
    event.stopPropagation();
    if (action === 'close') {
      if (cropping) stopCrop();
      else live.close();
    } else if (action === 'nudge-left') nudge(-NUDGE, 0);
    else if (action === 'nudge-right') nudge(NUDGE, 0);
    else if (action === 'nudge-up') nudge(0, -NUDGE);
    else if (action === 'nudge-down') nudge(0, NUDGE);
    else if (!cropping) {
      if (action === 'deck-prev') step(-1);
      else if (action === 'deck-next') step(1);
      else if (action === 'cited-prev') go(citedStep(pages, page, -1));
      else go(citedStep(pages, page, 1));
    }
  });

  const resizeObserver = new ResizeObserver(() => scheduleRerender());
  const onWindowResize = (): void => {
    frame = clampFrame(frame, viewportBox(), CLAMP);
    apply();
  };

  const live: Live = {
    anchor,
    pages,
    page: () => page,
    node,
    front,
    close: () => {
      if (!open.delete(live)) return;
      endEdit();
      token++;
      if (rerenderTimer) clearTimeout(rerenderTimer);
      resizeObserver.disconnect();
      window.removeEventListener('resize', onWindowResize);
      const hadFocus = node.contains(document.activeElement);
      node.remove();
      // Focus goes back to the front-most window left, or to whatever had it before.
      const next = [...open].sort((a, b) => Number(b.node.style.zIndex) - Number(a.node.style.zIndex))[0];
      if (hadFocus && next) next.front();
    },
  };

  document.body.append(node);
  place();
  open.add(live);
  resizeObserver.observe(stage);
  window.addEventListener('resize', onWindowResize);
  draw();
  front();
}
