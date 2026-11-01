<script lang="ts">
  /** The single error/info surface. Fed only by the `notice` event (§B3 error state). */
  import { store } from '../lib/store.svelte.js';
</script>

{#if store.notice}
  <div class="notice" class:err={store.notice.level === 'error'} role="status" aria-live="polite">
    <span>{store.notice.text}</span>
    <button type="button" onclick={() => (store.notice = null)}>Dismiss</button>
  </div>
{/if}

<style>
  .notice {
    position: fixed;
    top: 64px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 40;
    display: flex;
    align-items: center;
    gap: 14px;
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    box-shadow: 0 6px 24px rgb(27 27 34 / 10%);
    padding: 9px 14px;
    font-size: 13px;
    max-width: 620px;
    -webkit-app-region: no-drag;
  }
  .err { border-color: #d8d8e2; }
  button { font-size: 12px; color: var(--text-2); border-bottom: 1px solid var(--hairline); }
</style>
