/**
 * **A floating window's frame: moved, resized from any edge, kept below the title bar**
 * (2026-10-04). Shared by the two kinds of window that float over the app: the slide windows
 * (`pm/slidewindow.ts`) and the popped-out tutorial (`components/notes/TutorialWindow.svelte`).
 *
 * Two rules, both from Lucas's screenshots of the live app:
 *
 *  1. **Resized from any edge or corner** (`resizeFrame`): eight invisible handles on the border,
 *     the edges a handle names follow the pointer and the opposite ones stay put, as an OS window.
 *  2. **Never under the app's title bar** (`clampFrame`, `moveFrame`). The title bar is the
 *     window's drag region (`-webkit-app-region: drag`, `TitleBar.svelte`), and Electron's drag
 *     region wins hit-testing over any DOM laid over it: a floating window whose header sat there
 *     moved the whole app when dragged, and none of its header buttons (Dock, close) could be
 *     clicked. So the area a floating window lives in starts at the title bar's bottom
 *     (`floatArea`), and every window also carries `app-region: no-drag` (belt and braces).
 *
 * The maths is pure (boxes and numbers, tested in node, `floatframe.test.ts`); `floatArea` and
 * `attachEdgeHandles` are the only DOM halves.
 */

/** A window's place and size in viewport px. */
export interface Frame {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The area a window lives in, in viewport px: the app below its title bar. */
export interface Area {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A resize handle, by compass point: the edges it moves. North is the top (y down). */
export type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** All eight, clockwise from the top-left corner. */
export const EDGES: readonly Edge[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/**
 * The title bar's height (`TitleBar.svelte`, `.titlebar { height: 38px }`), used when the bar
 * cannot be measured. A window that loses 38 px of reach costs nothing; one under the bar is lost.
 */
export const TITLE_BAR_FALLBACK = 38;

/** Kept between a window's moving edge and the app's edge while resizing. */
export const FLOAT_MARGIN = 8;

export interface ClampOptions {
  /** The smallest the window may be. */
  min: { width: number; height: number };
  /** How much of the window must stay inside the area left to right, to grab it back by. */
  keep: number;
  /** The window's own header height: the part that must stay inside the area top to bottom. */
  bar: number;
  /** The size is capped at the area less this on each side. */
  margin?: number;
}

/** The CSS cursor each handle shows. */
export function edgeCursor(edge: Edge): string {
  switch (edge) {
    case 'n':
    case 's':
      return 'ns-resize';
    case 'e':
    case 'w':
      return 'ew-resize';
    case 'nw':
    case 'se':
      return 'nwse-resize';
    default:
      return 'nesw-resize';
  }
}

/** The largest a window may be in `area`: the area less `margin` a side, never below `min`. */
export function maxSize(area: Area, min: { width: number; height: number }, margin = FLOAT_MARGIN): { width: number; height: number } {
  return {
    width: Math.max(min.width, area.right - area.left - 2 * margin),
    height: Math.max(min.height, area.bottom - area.top - 2 * margin),
  };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * **A frame made legal in `area`**: its size between `min` and `maxSize`, its top never above the
 * area's top (the title bar's bottom) and never so low its header leaves the app, and at least
 * `keep` px of it inside left to right. Used for a remembered frame on restore, on every move,
 * and when the app is resized.
 */
export function clampFrame(frame: Frame, area: Area, options: ClampOptions): Frame {
  const max = maxSize(area, options.min, options.margin);
  const width = Math.round(clamp(frame.width, options.min.width, max.width));
  const height = Math.round(clamp(frame.height, options.min.height, max.height));
  const left = Math.round(clamp(frame.left, area.left + options.keep - width, area.right - options.keep));
  const top = Math.round(clamp(frame.top, area.top, Math.max(area.top, area.bottom - options.bar)));
  return { left, top, width, height };
}

/** `start` dragged by `dx`, `dy` by its header, its size kept, then clamped (`clampFrame`). */
export function moveFrame(start: Frame, dx: number, dy: number, area: Area, options: ClampOptions): Frame {
  return clampFrame({ ...start, left: start.left + dx, top: start.top + dy }, area, options);
}

/**
 * **`start` resized by dragging `edge` by `dx`, `dy`.** The edges the handle names follow the
 * pointer and the opposite ones stay put; an edge handle moves one axis only. A moving edge stops:
 *
 *  - `min` short of the opposite edge, rather than flipping the window over;
 *  - at the area's edge less `margin` (left, right, bottom), or exactly at the area's top (the
 *    title bar's bottom), unless the window already reached further out than that, in which case
 *    it may not go further but does not jump in either;
 *  - at `maxSize`, so a window resized never exceeds what `clampFrame` would allow.
 */
export function resizeFrame(
  start: Frame,
  edge: Edge,
  dx: number,
  dy: number,
  area: Area,
  min: { width: number; height: number },
  margin = FLOAT_MARGIN,
): Frame {
  const max = maxSize(area, min, margin);
  let x0 = start.left;
  let y0 = start.top;
  let x1 = start.left + start.width;
  let y1 = start.top + start.height;
  if (edge.includes('w')) {
    const lo = Math.max(Math.min(start.left, area.left + margin), x1 - max.width);
    x0 = clamp(start.left + dx, lo, x1 - min.width);
  }
  if (edge.includes('e')) {
    const hi = Math.min(Math.max(x1, area.right - margin), x0 + max.width);
    x1 = clamp(x1 + dx, x0 + min.width, hi);
  }
  if (edge.includes('n')) {
    const lo = Math.max(area.top, y1 - max.height);
    y0 = clamp(start.top + dy, lo, y1 - min.height);
  }
  if (edge.includes('s')) {
    const hi = Math.min(Math.max(y1, area.bottom - margin), y0 + max.height);
    y1 = clamp(y1 + dy, y0 + min.height, hi);
  }
  return { left: Math.round(x0), top: Math.round(y0), width: Math.round(x1 - x0), height: Math.round(y1 - y0) };
}

// ── the DOM halves ──────────────────────────────────────────────────────────────────────────

/**
 * The area floating windows live in now: the app's viewport below the title bar. The bar is
 * measured (`.titlebar`, `TitleBar.svelte`), so a taller bar or a missing one is followed; if it
 * cannot be found, `TITLE_BAR_FALLBACK`.
 */
export function floatArea(): Area {
  const bar = globalThis.document?.querySelector('.titlebar');
  const top = bar ? Math.max(0, Math.round(bar.getBoundingClientRect().bottom)) : TITLE_BAR_FALLBACK;
  return { left: 0, top, right: globalThis.innerWidth, bottom: globalThis.innerHeight };
}

export interface EdgeHandlers {
  /** A resize begins. */
  start?: (edge: Edge) => void;
  /** The pointer moved `dx`, `dy` from where `edge` was pressed. */
  move: (edge: Edge, dx: number, dy: number) => void;
  /** The gesture ended (released or cancelled). */
  end?: (edge: Edge) => void;
}

/**
 * Eight invisible resize handles on `root`'s border, one per `EDGES`, each with its own cursor
 * (`.ff-h`, `.ff-h-<edge>` in `floatframe.css`). Pointer capture on the handle pressed, so a fast
 * drag never loses the window. Returns a function that removes them.
 */
export function attachEdgeHandles(root: HTMLElement, handlers: EdgeHandlers): () => void {
  const made: HTMLElement[] = [];
  for (const edge of EDGES) {
    const handle = document.createElement('span');
    handle.className = `ff-h ff-h-${edge}`;
    handle.dataset.edge = edge;
    handle.setAttribute('aria-hidden', 'true');
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      handle.setPointerCapture(event.pointerId);
      const x0 = event.clientX;
      const y0 = event.clientY;
      document.documentElement.classList.add('ff-resizing');
      document.documentElement.style.setProperty('--ff-cursor', edgeCursor(edge));
      handlers.start?.(edge);
      const move = (e: PointerEvent): void => handlers.move(edge, e.clientX - x0, e.clientY - y0);
      const up = (): void => {
        document.documentElement.classList.remove('ff-resizing');
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        handlers.end?.(edge);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
    root.append(handle);
    made.push(handle);
  }
  return () => {
    for (const handle of made) handle.remove();
  };
}
