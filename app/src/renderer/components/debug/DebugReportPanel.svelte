<script lang="ts">
  /**
   * **Copy Debug Info for the Team** (⇧⌘D): the panel main asks for once the report is on the
   * clipboard (`src/main/debug/index.ts`).
   *
   * It only shows what main sent. The box is read-only and fully selected, so ⌘C copies the
   * whole report either way, and the Copy button, ⌘C and Ctrl+C all ask main to copy its own copy
   * again: nothing typed or selected here reaches the clipboard. It tells main it is on screen;
   * if it never does (no bridge, a hung page), main shows a native dialog instead. Mounted outside
   * the consent gate in `App.svelte`, so it works on every screen.
   */
  import { onMount, tick } from 'svelte';
  import { bridge } from '../../lib/bridge.js';
  import { DEBUG_COPIED_LINE, DEBUG_SHORTCUT_LABEL, type DebugShow } from '../../../shared/debug.js';

  let open = $state(false);
  let text = $state('');
  let status = $state(DEBUG_COPIED_LINE);
  let box: HTMLTextAreaElement | undefined = $state();
  let returnFocus: HTMLElement | null = null;

  onMount(() => {
    try {
      return bridge().debug.onShow((show) => void present(show));
    } catch {
      // No bridge: main's dialog takes over when this never says it is showing.
      return undefined;
    }
  });

  async function present(show: DebugShow): Promise<void> {
    if (!open) returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    text = show.text;
    status = DEBUG_COPIED_LINE;
    open = true;
    await tick();
    selectAll();
    try {
      await bridge().debug.shown(show.token);
    } catch {
      /* main falls back to its dialog */
    }
  }

  function selectAll(): void {
    if (!box) return;
    box.focus();
    box.setSelectionRange(0, box.value.length);
    box.scrollTop = 0;
  }

  async function copy(): Promise<void> {
    try {
      const r = await bridge().debug.copy();
      status = r.ok ? `Copied again. ${DEBUG_COPIED_LINE.replace(/^Copied\. /, '')}` : 'Could not copy. Select the text and press ⌘C.';
    } catch {
      status = 'Could not copy. Select the text and press ⌘C.';
    }
    selectAll();
  }

  function close(): void {
    open = false;
    returnFocus?.focus?.();
    returnFocus = null;
  }

  /** Captured on the window while open, so no other shortcut handler sees these keys. */
  function onkeydown(e: KeyboardEvent): void {
    if (!open) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (mod && !e.altKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      e.stopPropagation();
      void copy();
    } else if (mod && !e.altKey && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      e.stopPropagation();
      selectAll();
    }
  }
</script>

<svelte:window onkeydowncapture={onkeydown} />

{#if open}
  <div class="scrim" role="presentation" onclick={(e) => e.target === e.currentTarget && close()}>
    <div class="panel" role="dialog" aria-modal="true" aria-labelledby="debug-title" aria-describedby="debug-status">
      <h2 id="debug-title">Debug info for the research team</h2>
      <p class="status" id="debug-status" role="status">{status}</p>
      <textarea
        bind:this={box}
        class="report"
        readonly
        spellcheck="false"
        aria-label="Debug report"
        value={text}
        onfocus={selectAll}
      ></textarea>
      <p class="quiet">
        No API key, study code, names, file names or anything you wrote is in it. {DEBUG_SHORTCUT_LABEL} shows
        it again at any time (Help ▸ Copy Debug Info for the Team).
      </p>
      <div class="actions">
        <button type="button" class="btn" onclick={close}>Close</button>
        <button type="button" class="btn-primary" onclick={() => void copy()}>Copy</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(27, 27, 34, 0.28);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    z-index: 90;
  }
  .panel {
    width: min(620px, 100%);
    max-height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    padding: 18px 20px 16px;
    box-shadow: 0 12px 40px rgba(20, 20, 40, 0.18);
  }
  h2 { margin: 0 0 6px; font-size: 14px; font-weight: 600; }
  .status { margin: 0 0 10px; font-size: 13px; line-height: 1.5; font-weight: 500; }
  .report {
    flex: 1;
    min-height: 220px;
    height: 44vh;
    resize: none;
    width: 100%;
    box-sizing: border-box;
    padding: 10px 12px;
    border: 1px solid var(--hairline);
    border-radius: 6px;
    background: var(--ground);
    color: var(--text);
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 11.5px;
    line-height: 1.45;
    white-space: pre;
    overflow: auto;
  }
  .quiet { margin: 10px 0 0; color: var(--muted); font-size: 12px; line-height: 1.5; }
  .actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 12px; }
</style>
