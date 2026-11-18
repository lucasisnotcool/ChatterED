<script lang="ts">
  /**
   * "Updated to build N": one line at the bottom of the window, once, after the first launch of a
   * new build (`main/update/`). Non-blocking; it goes by itself after a few seconds.
   */
  import { onMount } from 'svelte';
  import { bridge } from '../../lib/bridge.js';

  let note: { from: number; to: number } | null = $state(null);

  onMount(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    bridge()
      .updateNote?.()
      .then((n) => {
        if (!n) return;
        note = n;
        timer = setTimeout(() => (note = null), 8000);
      })
      .catch(() => undefined);
    return () => {
      if (timer) clearTimeout(timer);
    };
  });
</script>

{#if note}
  <div class="note" role="status" aria-live="polite">
    <span>Updated to build {note.to}</span>
    <button type="button" aria-label="Dismiss" onclick={() => (note = null)}>×</button>
  </div>
{/if}

<style>
  .note {
    position: fixed;
    bottom: 14px;
    right: 16px;
    z-index: 45;
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    box-shadow: 0 4px 16px rgb(27 27 34 / 8%);
    padding: 6px 10px;
    font-size: 12px;
    color: var(--text-2);
    -webkit-app-region: no-drag;
  }
  button {
    font-size: 13px;
    line-height: 1;
    color: var(--muted);
  }
</style>
