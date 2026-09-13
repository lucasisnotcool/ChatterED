<script lang="ts">
  /** The labelled divider above a silence-fill message (product-design.md §C5). */
  import type { MessageView } from '../../shared/types.js';

  let {
    divider,
    onComplain,
  }: { divider: NonNullable<MessageView['divider']>; onComplain?: () => void } = $props();
</script>

<div class="divider" role="separator">
  <span class="rule"></span>
  <span class="cause">{divider.cause}</span>
  {#if divider.control === 'dont_do_this'}
    <button class="dont" type="button" onclick={() => onComplain?.()}>don't do this</button>
  {/if}
  <span class="rule"></span>
</div>

<style>
  .divider {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 32px 0 16px;
    max-width: 72ch;
  }
  .rule { flex: 1; height: 1px; background: var(--hairline); }
  .cause { font-size: 11px; color: var(--text-2); white-space: nowrap; }
  .dont {
    font-size: 11px;
    color: var(--muted);
    border-bottom: 1px solid transparent;
    white-space: nowrap;
  }
  .dont:hover { color: var(--text-2); border-bottom-color: var(--hairline); }
</style>
