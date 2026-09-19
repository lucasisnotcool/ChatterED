<script lang="ts">
  /**
   * The right-hand column: three channels behind one header (#48, §4.1).
   *
   * **Doc chat · Ellie · Max.** A segmented header rather than a stack, because the two private
   * threads are not part of the conversation the document is having — that is the whole of what
   * "private" means here — and a learner has to be able to see at a glance which of the three
   * they are typing into.
   *
   * The unread dot is a dot *and* a number in its tooltip (colour is never the only signal), and
   * it clears when the thread is actually on screen rather than when the turn arrives.
   */
  import { tabs, type ChatTab } from '../../lib/chatview.js';
  import { store } from '../../lib/store.svelte.js';
  import DocChat from './DocChat.svelte';
  import PrivateThread from './PrivateThread.svelte';

  let {
    pages = [],
    onjump,
    onpage,
  }: {
    pages?: readonly number[];
    onjump?: (blockId: string) => void;
    onpage?: (page: number) => void;
  } = $props();

  const chat = store.chat;
  const strip = $derived(
    tabs({
      threads: chat.threads,
      messages: chat.messages,
      privateUnread: { ellie: chat.ellie.unread, max: chat.max.unread },
    }),
  );

  function select(key: ChatTab): void {
    if (key === 'doc') chat.tab = 'doc';
    else void chat.openPrivate(key);
  }
</script>

<section class="column" aria-label="Conversation">
  <header class="tabs" role="tablist" aria-label="Which conversation">
    {#each strip as tab (tab.key)}
      <button
        type="button"
        role="tab"
        class="tab"
        class:on={chat.tab === tab.key}
        aria-selected={chat.tab === tab.key}
        style={tab.hue ? `--hue: ${tab.hue}` : '--hue: var(--indigo)'}
        title={tab.unread > 0 ? `${tab.unread} new` : tab.label}
        onclick={() => select(tab.key)}
      >
        {#if tab.hue}
          <span class="dot" aria-hidden="true"></span>
        {/if}
        <span class="label">{tab.label}</span>
        {#if tab.unread > 0}
          <span class="unread" aria-label={`${tab.unread} unread`}>{tab.unread}</span>
        {/if}
      </button>
    {/each}
  </header>

  <div class="body">
    {#if chat.tab === 'doc'}
      <DocChat {pages} {onjump} {onpage} />
    {:else if chat.tab === 'ellie'}
      <PrivateThread agent="ellie" />
    {:else}
      <PrivateThread agent="max" />
    {/if}
  </div>
</section>

<style>
  .column {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    height: 100%;
    background: var(--pane);
    border-left: 1px solid var(--hairline);
  }

  .tabs {
    flex: none;
    display: flex;
    gap: 2px;
    padding: 7px 10px 0;
    border-bottom: 1px solid var(--hairline);
    background: var(--ground);
  }
  .tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 11px;
    border-radius: 7px 7px 0 0;
    font-size: 12px;
    color: var(--text-2);
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  .tab:hover { color: var(--text); }
  .tab.on {
    background: var(--pane);
    color: var(--text);
    font-weight: 600;
    border-bottom-color: var(--hue);
  }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--hue); flex: none; }
  .label { white-space: nowrap; }
  .unread {
    min-width: 15px;
    padding: 0 4px;
    border-radius: 999px;
    background: var(--indigo);
    color: #fff;
    font-size: 9.5px;
    font-weight: 600;
    line-height: 15px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .body { flex: 1; min-height: 0; }
</style>
