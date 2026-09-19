<script lang="ts">
  /**
   * One span-anchored thread, inside the doc chat (#48, §3 and §4.1).
   *
   * Highlight a line, press Ctrl+E, ask: the conversation about that line lives here, headed by
   * the line itself. The quote is the header for a reason — a thread about a sentence that does
   * not show the sentence makes the learner scroll the document to find out what it is about,
   * and the whole point of anchoring it was that they should not have to.
   *
   * **Jump to span** is the other direction of the same link: T4 draws the highlight and clicking
   * it focuses this card; clicking here scrolls the document back to the line.
   */
  import type { MessageView, ThinkingView } from '../../../shared/types.js';
  import type { ThreadView } from '../../../shared/doc/types.js';
  import ChatMessage from './ChatMessage.svelte';
  import CostFooter from '../cost/CostFooter.svelte';

  let {
    thread,
    messages,
    pages = [],
    focused = false,
    /** Drawn inside the card while the turn being waited for belongs to this thread. */
    thinking = null,
    onjump,
    onpage,
    children,
  }: {
    thread: ThreadView;
    messages: MessageView[];
    pages?: readonly number[];
    focused?: boolean;
    thinking?: ThinkingView | null;
    onjump?: (blockId: string) => void;
    onpage?: (page: number) => void;
    children?: import('svelte').Snippet;
  } = $props();

  let open = $state(true);
  const quiz = $derived(thread.quiz);
</script>

<section class="span" class:focused data-thread={thread.threadId} aria-label="About a line in the document">
  <header class="head">
    <button
      type="button"
      class="fold"
      aria-expanded={open}
      title={open ? 'Hide this thread' : `${messages.length} turns`}
      onclick={() => (open = !open)}
    >{open ? '▾' : '▸'}</button>

    <blockquote class="quote" title={thread.quote ?? ''}>{thread.quote ?? 'a line in the document'}</blockquote>

    {#if thread.blockId && onjump}
      <button type="button" class="jump" onclick={() => onjump(thread.blockId!)}>Jump to span ↗</button>
    {/if}
  </header>

  {#if quiz?.open}
    <p class="open-q">Max has a question open here.</p>
  {/if}

  {#if open}
    <div class="turns">
      {#each messages as message (message.id)}
        <ChatMessage {message} {pages} {onpage} />
      {/each}
      {#if thinking}
        {@render children?.()}
      {/if}
      <!-- What this aside has cost (#42 item C). Inside the fold: a collapsed thread is a thread
           the learner has put away, and a number is not a reason to reopen it. -->
      <CostFooter anchorId={thread.threadId} />
    </div>
  {:else}
    <p class="folded">{messages.length} {messages.length === 1 ? 'turn' : 'turns'}</p>
  {/if}
</section>

<style>
  .span {
    margin: 14px 0;
    padding: 8px 10px 4px;
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--ground);
  }
  /* Focused by a highlight click in the document. It fades, rather than staying lit: the point
     is "this one", not "this one forever". */
  .span.focused {
    border-color: var(--indigo);
    box-shadow: 0 0 0 3px var(--indigo-tint);
    transition: box-shadow 600ms ease-out, border-color 600ms ease-out;
  }

  .head { display: flex; align-items: flex-start; gap: 7px; }
  .fold {
    flex: none;
    font-size: 10px;
    color: var(--muted);
    line-height: 1.6;
  }
  .fold:hover { color: var(--indigo); }

  /* The quoted span, set as a quotation and clamped to two lines: it is a handle, not the text. */
  .quote {
    flex: 1;
    margin: 0;
    padding-left: 8px;
    border-left: 2px solid var(--muted);
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--text-2);
    font-style: italic;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .jump {
    flex: none;
    font-size: 10.5px;
    color: var(--muted);
    white-space: nowrap;
  }
  .jump:hover { color: var(--indigo); }

  .open-q {
    margin: 6px 0 0 17px;
    font-size: 10.5px;
    color: var(--challenger);
  }

  .turns { margin-left: 17px; }
  .folded { margin: 4px 0 6px 17px; font-size: 11px; color: var(--muted); }
</style>
