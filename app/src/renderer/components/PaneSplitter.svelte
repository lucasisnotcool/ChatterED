<script lang="ts">
  /**
   * **A draggable panel edge** — the `PaneSplitter` ui-review-code.md §"Pane widths" asked for,
   * now that there are two panels to resize rather than one.
   *
   * It owns the gesture and nothing else: the size is the caller's (persisted by
   * `layoutstore.svelte.ts`), and `onsize` is called with every new width. What it does:
   *
   *  - **drag** with the pointer — mouse, pen, or a finger on a touch screen (`touch-action:
   *    none`), with pointer capture, so the drag survives the pointer leaving the 7 px strip;
   *  - **the keyboard** (WAI-ARIA window splitter): ←/→ by 16 px, Shift by 48, Home/End to the
   *    ends, and Enter to close a closable panel;
   *  - **double-click** back to the panel's initial width;
   *  - **drag past the minimum** to close a closable panel, the way a Mac sidebar goes.
   *
   * While a drag is live the root element carries `.resizing`, which the global stylesheet uses
   * to hold the cursor and stop the drag from selecting the document under it.
   */
  import { dragSize, keySize, type GrowSign, type PanelBounds } from '../lib/layout.js';

  let {
    size,
    bounds,
    sign,
    label,
    controls,
    onsize,
    oncollapse,
  }: {
    size: number;
    bounds: PanelBounds;
    /** +1 for a panel on the splitter's left, −1 for one on its right. */
    sign: GrowSign;
    /** What is being resized, for a screen reader: "Resize the file panel". */
    label: string;
    /** The id of the panel element, for `aria-controls`. */
    controls?: string;
    onsize: (size: number) => void;
    /** Given only for a panel that may be closed from its edge. */
    oncollapse?: () => void;
  } = $props();

  let dragging = $state(false);

  function setResizing(on: boolean): void {
    document.documentElement.classList.toggle('resizing', on);
  }

  function onpointerdown(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    (el as HTMLElement).focus({ preventScroll: true });
    const start = size;
    const startX = e.clientX;
    let collapsed = false;
    dragging = true;
    setResizing(true);

    const move = (ev: PointerEvent): void => {
      const next = dragSize(start, startX, ev.clientX, sign, bounds, Boolean(oncollapse));
      if (next.collapse) {
        if (!collapsed) {
          collapsed = true;
          end();
          // It reopens at the width it had before this drag, not the minimum it was squeezed to.
          onsize(start);
          oncollapse?.();
        }
        return;
      }
      if (next.size !== size) onsize(next.size);
    };
    const end = (): void => {
      dragging = false;
      setResizing(false);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      el.removeEventListener('lostpointercapture', end);
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
  }

  function onkeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && oncollapse) {
      e.preventDefault();
      oncollapse();
      return;
    }
    const next = keySize(size, e.key, e.shiftKey, sign, bounds);
    if (next === null) return;
    e.preventDefault();
    onsize(next);
  }
</script>

<!-- A focusable `separator` is the WAI-ARIA window-splitter widget, which svelte's lint does not
     know is interactive. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="splitter"
  class:dragging
  role="separator"
  tabindex="0"
  aria-label={label}
  aria-controls={controls}
  aria-orientation="vertical"
  aria-valuenow={size}
  aria-valuemin={bounds.min}
  aria-valuemax={bounds.max}
  aria-valuetext={`${size} pixels wide`}
  title={oncollapse
    ? 'Drag to resize · double-click to reset · drag all the way in to hide'
    : 'Drag to resize · double-click to reset'}
  {onpointerdown}
  {onkeydown}
  ondblclick={() => onsize(bounds.initial)}
></div>

<style>
  /* A 7 px hit area over a 1 px line: easy to grab, and it draws nothing until it is found. */
  .splitter {
    flex: none;
    position: relative;
    width: 7px;
    margin: 0 -3px;
    z-index: 3;
    cursor: col-resize;
    touch-action: none;
    background: transparent;
    outline: none;
  }
  .splitter::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 2px;
    width: 3px;
    border-radius: 2px;
    background: transparent;
    transition: background 0.12s ease 0.08s;
  }
  .splitter:hover::after,
  .splitter.dragging::after { background: var(--indigo-tint); }
  .splitter:focus-visible::after { background: var(--indigo); }
</style>
