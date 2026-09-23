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

  /**
   * **New conversation** (2026-09-23). On the column rather than inside the doc chat because it
   * clears all three channels. Main asks the learner to confirm; with no room yet there is nothing
   * to reset, so the button waits for the first message.
   */
  async function reset(): Promise<void> {
    const line = await chat.reset();
    if (line) store.notice = { level: 'error', text: line };
  }

  function select(key: ChatTab): void {
    if (key === 'doc') chat.tab = 'doc';
    else void chat.openPrivate(key);
  }

  /**
   * **The per-message meters for this room, asked for once** (#42 item C).
   *
   * One query for the whole room rather than one per card: forty turns on screen is forty
   * meters, and forty round trips behind one IPC lane to draw grey text would be the counter
   * costing more than the thing it counts. `ensureMessageCosts` is idempotent per room and
   * re-reads the map itself on `cost.updated`, so this runs once per opened document.
   */
  $effect(() => {
    store.ensureMessageCosts(chat.roomId);
  });
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
    <span class="spacer"></span>
    <button
      type="button"
      class="reset"
      aria-label="New conversation"
      disabled={!chat.roomId}
      title={chat.roomId
        ? 'Clear the doc chat and your one-to-one chats with Ellie and Max, and start again. Asks first. Your notes and progress stay.'
        : 'Nothing to reset yet.'}
      onclick={() => void reset()}
    >
      <span aria-hidden="true">↺</span>
    </button>
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
    min-width: 0;
    gap: 2px;
    padding: 7px 10px 0;
    border-bottom: 1px solid var(--hairline);
    background: var(--ground);
  }
  .tab {
    flex: none;
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

  /* A glyph, not a label: the tab strip is ~300 px at the default split, and a label was cut to
     "New…" as soon as an unread badge appeared. The tooltip and the confirm sheet say what it does,
     as the nav rail's glyphs do. Never wide enough to push the window into a horizontal scroll. */
  .spacer { flex: 1 1 auto; min-width: 4px; }
  .reset {
    flex: none;
    align-self: center;
    margin-bottom: 4px;
    width: 24px;
    height: 24px;
    display: inline-grid;
    place-items: center;
    border: 1px solid var(--hairline);
    border-radius: 999px;
    background: var(--pane);
    font-size: 13px;
    line-height: 1;
    color: var(--text-2);
  }
  .reset:hover:not(:disabled) { color: var(--text); border-color: #d4d4e2; }
  .reset:disabled { opacity: 0.5; cursor: default; }

  .body { flex: 1; min-height: 0; }
</style>
