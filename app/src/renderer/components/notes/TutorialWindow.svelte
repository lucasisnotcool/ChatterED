<script lang="ts">
  /**
   * **The tutorial, popped out** (`docs/research/tutorials.md` §2): a window over the app, moved by
   * its header and resized from any edge or corner, as the slide windows are (`pm/slidewindow.ts`), and
   * kept where the learner left it (`TutorialStore.frame`, per install). **Dock** in its header puts
   * it back beside the notes. It sits under the slide windows (z 60+), so a slide opened from a
   * part comes up in front of the sheet it was opened from.
   *
   * It never goes above the bottom of the app's title bar (`floatArea`, `lib/floatframe.ts`): the
   * bar is the OS drag region, and a header laid over it neither moved the window nor let its
   * Dock or close be clicked (Lucas, 2026-10-04). Escape (outside the text) docks it, whatever
   * the mouse can reach.
   */
  import { attachEdgeHandles, floatArea, resizeFrame } from '../../lib/floatframe.js';
  import { TUTORIAL_WINDOW_MIN, floatFrame, type FloatFrame, type FloatView } from '../../lib/layout.js';
  import { store } from '../../lib/store.svelte.js';
  import TutorialPane from './TutorialPane.svelte';
  import './floatframe.css';

  const tut = store.tutorial;

  /** The app's size, and the title bar's bottom, which the window never goes above (`floatArea`). */
  const viewport = (): FloatView => {
    const area = floatArea();
    return { width: area.right, height: area.bottom, top: area.top };
  };

  // A frame remembered under the title bar (or larger than the app) is clamped as it is read.
  let frame = $state<FloatFrame>(tut.frameFor(viewport()));
  let moving = $state(false);
  let root = $state<HTMLElement | null>(null);

  /** The app was resized: the window stays inside it, below its title bar, at its size where it can. */
  function onresize(): void {
    frame = floatFrame(frame, viewport());
  }

  /** Move by the header: pointer capture on the element pressed, so a fast drag never loses the window. */
  function startMove(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    const el = event.currentTarget as HTMLElement;
    el.setPointerCapture(event.pointerId);
    // The press is prevented (no text selection), so focus is given here: Escape then docks.
    if (root && !root.contains(document.activeElement)) root.focus({ preventScroll: true });
    const start = { ...frame };
    const x0 = event.clientX;
    const y0 = event.clientY;
    moving = true;
    document.documentElement.classList.add('ff-resizing');
    document.documentElement.style.setProperty('--ff-cursor', 'grabbing');
    const move = (e: PointerEvent): void => {
      // Clamped as it goes, by the rule a remembered frame is read with (`floatFrame`).
      frame = floatFrame({ ...start, left: start.left + e.clientX - x0, top: start.top + e.clientY - y0 }, viewport());
    };
    const up = (): void => {
      moving = false;
      document.documentElement.classList.remove('ff-resizing');
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      tut.setFrame(frame);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  // Resize from any edge or corner (`attachEdgeHandles`, the slide windows' too).
  // Popped out, the button pressed went with the docked pane and focus fell to the page: the keys
  // come here instead, so Escape docks. Focus held anywhere else (the notes at launch) is left alone.
  $effect(() => {
    const active = document.activeElement;
    if (root && (active === null || active === document.body)) root.focus({ preventScroll: true });
  });

  // Reads `root` only (never `frame`), so it runs once per mount, not once per pointer move.
  $effect(() => {
    if (!root) return;
    let start: FloatFrame | null = null;
    return attachEdgeHandles(root, {
      start: () => {
        start = { ...frame };
        moving = true;
      },
      move: (edge, dx, dy) => {
        if (start) frame = resizeFrame(start, edge, dx, dy, floatArea(), TUTORIAL_WINDOW_MIN);
      },
      end: () => {
        moving = false;
        tut.setFrame(frame);
      },
    });
  });

  function onkeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && !(e.target as Element).closest('.ProseMirror')) {
      e.preventDefault();
      tut.dock();
    }
  }
</script>

<svelte:window {onresize} />

<div
  bind:this={root}
  class="tw ff-window"
  class:moving
  role="dialog"
  aria-label="Tutorial"
  tabindex="-1"
  style:left={`${frame.left}px`}
  style:top={`${frame.top}px`}
  style:width={`${frame.width}px`}
  style:height={`${frame.height}px`}
  {onkeydown}
>
  <TutorialPane floating onbardown={startMove} />
</div>

<style>
  .tw {
    position: fixed;
    z-index: 50;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--hairline);
    border-radius: 12px;
    background: var(--pane);
    box-shadow: 0 18px 48px rgb(20 20 40 / 20%), 0 2px 8px rgb(20 20 40 / 8%);
    overflow: hidden;
    outline: none;
  }
  .tw:focus-within { box-shadow: 0 20px 52px rgb(20 20 40 / 24%), 0 0 0 3px var(--indigo-tint); }
  .tw.moving { box-shadow: 0 24px 60px rgb(20 20 40 / 28%); }
  .tw > :global(.tp-nd) { flex: 1 1 auto; min-height: 0; }
</style>
