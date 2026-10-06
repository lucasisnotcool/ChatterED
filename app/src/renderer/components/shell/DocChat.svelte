<script lang="ts">
  /**
   * **The doc chat** (#48, §4.1): the shared thread for the open file, with its span-anchored
   * threads inside it rather than beside it.
   *
   * Interleaved by arrival, not stacked in two piles. A span thread opened halfway through a
   * conversation belongs where it happened — the alternative is a column whose top half is the
   * conversation and whose bottom half is every aside ever made, in which neither reads as a
   * sequence.
   *
   * The wait chrome is the shipped machinery, unchanged and for the reasons the audit gives:
   * the neutral *the room has it* line for the floor-yield window, the named indicator, the
   * elapsed counter for Max only, **Stop** once the floor has passed, and the failure card with
   * its retry. A turn always ends in something the learner can see.
   *
   * **Replying in a span thread** (2026-10-04): the one composer sends where `composeTarget`
   * says: the thread the learner chose (**Reply here** on its card, or the thread last brought
   * into view, such as a tutorial part's after Help or Check), else Max's open question, else the
   * notebook chat. A chip above the composer names the thread and clears it.
   */
  import { untrack } from 'svelte';
  import type { MessageView } from '../../../shared/types.js';
  import type { ThreadView } from '../../../shared/doc/types.js';
  import { RECEIVED_LINE, pendingFor, receivedVisible, stopAllowed, type PendingSend } from '../../lib/flowchat.js';
  import { ASK_PLACEHOLDER, REPLY_PLACEHOLDER, chatComposer, composeTarget, messagesOf } from '../../lib/chatview.js';
  import { NOTEBOOK_ASK_PLACEHOLDER, TUTORIAL_ASK_PLACEHOLDER, greetingOf } from '../../lib/notebookview.js';
  import { clock, store } from '../../lib/store.svelte.js';
  import ChatMessage from './ChatMessage.svelte';
  import CostFooter from '../cost/CostFooter.svelte';
  import MentionComposer from './MentionComposer.svelte';
  import SpanThreadCard from './SpanThreadCard.svelte';
  import ThinkingIndicator from '../ThinkingIndicator.svelte';

  let {
    pages = [],
    onjump,
    onpage,
  }: {
    /** The deck's pages, for clickable `p. N` grounds. */
    pages?: readonly number[];
    onjump?: (blockId: string) => void;
    onpage?: (page: number) => void;
  } = $props();

  const chat = store.chat;
  let scroller = $state<HTMLElement | null>(null);
  let refused = $state<string | null>(null);

  const docId = $derived(chat.docThreadId);
  const docMessages = $derived(messagesOf(docId, chat.messages));
  const spans = $derived(chat.threads.filter((t) => t.kind === 'span'));

  /**
   * The column's contents in one ordered list: the doc thread's own turns, and each span thread
   * at the point its first turn arrived. A span thread with no turns yet (it cannot happen from
   * here, but `notes:docText` can open one) sorts to the end rather than to the top.
   */
  interface Entry {
    key: string;
    seq: number;
    message?: MessageView;
    thread?: ThreadView;
  }
  const entries = $derived<Entry[]>(
    [
      ...docMessages.map((m) => ({ key: m.id, seq: m.seq, message: m })),
      ...spans.map((t) => {
        const own = messagesOf(t.threadId, chat.messages);
        return { key: t.threadId, seq: own[0]?.seq ?? Number.MAX_SAFE_INTEGER, thread: t };
      }),
    ].sort((a, b) => a.seq - b.seq),
  );

  const open = $derived(chat.openQuiz);
  const target = $derived(
    composeTarget({
      replyTo: chat.replyTo,
      spanThreadIds: spans.map((t) => t.threadId),
      openQuizThreadId: open?.threadId ?? null,
      docThreadId: docId,
    }),
  );
  const replyThread = $derived(target.replying ? (spans.find((t) => t.threadId === target.threadId) ?? null) : null);
  const composer = $derived(chatComposer(target.answering ? (open?.quiz ?? null) : null));
  /** §6: the notebook's own placeholder while nothing is open; the answering ones are unchanged. */
  const placeholder = $derived(
    composer.placeholder !== ASK_PLACEHOLDER
      ? composer.placeholder
      : replyThread
        ? REPLY_PLACEHOLDER
        : chat.mainTutorial
          ? TUTORIAL_ASK_PLACEHOLDER
          : NOTEBOOK_ASK_PLACEHOLDER,
  );

  let foot = $state<HTMLElement | null>(null);
  /** A card's **Reply here**: the composer takes that thread, and the caret goes to it. */
  function replyIn(threadId: string): void {
    chat.replyIn(threadId);
    queueMicrotask(() => foot?.querySelector<HTMLTextAreaElement>('textarea')?.focus());
  }

  /**
   * **Ellie's greeting and the three starter questions** (§6, contract C10), from the overview's
   * metadata (`OverviewMeta`, which the doc store holds). Read defensively: a doc from before the
   * overview, or one still being written, has none, and the chat falls back to a static line. No
   * model call and no room: a starter is sent as the learner's own question, and only that
   * creates the room.
   */
  const welcome = $derived(greetingOf((store.doc as unknown as { overview?: unknown }).overview ?? null));
  const draft = $derived(chat.draft);

  /** Where the wait is drawn: the turn's own anchor, then the anchor last sent to. */
  const heldAnchor = $derived(chat.stream?.anchorId ?? chat.lastSendAnchor);
  const received = $derived(receivedVisible(chat.receivedAt, chat.thinking !== null, clock.ms));
  const canStop = $derived(chat.thinking !== null && stopAllowed(chat.thinking, clock.ms));
  const pendingHere = $derived(pendingFor(chat.pending, docId));

  /** The provisional card, drawn by the same component as the real one. */
  const streamCard = $derived<MessageView | null>(
    chat.stream
      ? {
          id: `stream:${chat.stream.turnId}`,
          seq: Number.MAX_SAFE_INTEGER,
          speaker: {
            kind: 'agent',
            key: chat.stream.agentKey,
            role: chat.stream.agentKey.startsWith('challenger') ? 'challenger' : 'peer',
            displayName: chat.stream.agentKey.startsWith('challenger') ? 'Max' : 'Ellie',
            colour: '',
          },
          body: chat.stream.text,
          createdAt: new Date(clock.ms).toISOString(),
          latencyTargetMs: null,
          ttftActualMs: null,
          promotedFromWhisper: false,
          disagreement: null,
          divider: null,
          reference: null,
          anchorId: chat.stream.anchorId,
          byRule: null,
        }
      : null,
  );

  /**
   * Follow the tail. A reply that lands below the fold in a 340 px column is a reply the learner
   * never sees, and the chat column — unlike the document — has no other way to show it.
   */
  $effect(() => {
    void entries.length;
    void chat.stream?.text;
    void chat.thinking;
    const el = untrack(() => scroller);
    if (!el) return;
    queueMicrotask(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    });
  });

  /**
   * A focus request from a highlight click in the document, or from a lesson card's Start.
   *
   * The ring it leaves is a **flash**, not a state: "this one" is the message, and a card that
   * stayed ringed until something else was focused would be claiming to be selected.
   */
  let flashed = $state<string | null>(null);
  $effect(() => {
    const request = chat.focusRequest;
    const el = untrack(() => scroller);
    if (!request || !el) return;
    const node = el.querySelector<HTMLElement>(`[data-thread="${CSS.escape(request.threadId)}"]`);
    node?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    untrack(() => {
      flashed = request.threadId;
    });
    const handle = setTimeout(() => {
      flashed = null;
    }, 1600);
    return () => clearTimeout(handle);
  });

  /**
   * Seen, when the column is actually on screen — the unread dot's other half.
   *
   * Every thread drawn here, not only the doc thread: a span thread's turns are on screen too,
   * and an unread count that included them would keep a badge on the tab the learner is
   * currently reading.
   */
  $effect(() => {
    const marks = [docId, ...spans.map((t) => t.threadId)].map((id) => ({
      id,
      top: messagesOf(id, chat.messages).reduce((n, m) => Math.max(n, m.seq), 0),
    }));
    untrack(() => {
      for (const mark of marks) if (mark.top > 0) chat.markSeen(mark.id, mark.top);
    });
  });

  function send(text: string): void {
    refused = null;
    if (draft) {
      void chat.sendDraft(text);
      return;
    }
    chat.send(target.threadId, text);
  }

  async function pass(): Promise<void> {
    refused = await chat.pass();
  }
</script>

{#snippet mine(sent: PendingSend)}
  <article class="mine" class:sending={sent.state === 'pending'} class:failed={sent.state === 'failed'}>
    <header>
      <span class="label-caps">You</span>
      <span class="gap"></span>
      <span class="state" class:bad={sent.state === 'failed'}>
        {sent.state === 'pending' ? 'Sending…' : "Didn't send"}
      </span>
    </header>
    <p>{sent.body}</p>
    {#if sent.state === 'failed'}
      <div class="sendfoot">
        <span class="why">{sent.error ?? 'The app could not reach the room.'}</span>
        <button type="button" class="ctrl" onclick={() => chat.retrySend(sent.id)}>Retry</button>
        <button type="button" class="ctrl ghost" onclick={() => chat.dropSend(sent.id)}>Discard</button>
      </div>
    {/if}
  </article>
{/snippet}

<div class="chat">
  <div class="scroll" bind:this={scroller}>
    {#if entries.length === 0}
      <!-- Nothing has been asked yet. `chat:threads` creates no room, so this is genuinely an
           empty document rather than a conversation that failed to load. -->
      <div class="empty">
        <article class="greeting">
          <header><span class="dot" aria-hidden="true"></span><span class="who">Ellie</span></header>
          <p>{welcome.greeting}</p>
        </article>
        {#if welcome.starters.length > 0}
          <div class="starters" role="group" aria-label="Suggested questions">
            {#each welcome.starters as question (question)}
              <button type="button" onclick={() => chat.send(docId, question)}>{question}</button>
            {/each}
          </div>
        {/if}
        <p class="sub">
          Ask Ellie anything about the notebook. Press <b>Quiz me</b> on a line when you want Max to
          test you. Name one of them with <code>@Ellie</code> or <code>@Max</code> to get just that one.
        </p>
      </div>
    {/if}

    {#each entries as entry (entry.key)}
      {#if entry.message}
        <ChatMessage message={entry.message} {pages} {onpage} />
      {:else if entry.thread}
        <SpanThreadCard
          thread={entry.thread}
          messages={messagesOf(entry.thread.threadId, chat.messages)}
          focused={flashed === entry.thread.threadId}
          thinking={heldAnchor === entry.thread.threadId ? chat.thinking : null}
          {pages}
          {onjump}
          {onpage}
          replying={replyThread?.threadId === entry.thread.threadId}
          onreply={() => replyIn(entry.thread!.threadId)}
        >
          {#snippet tail()}
            {#each pendingFor(chat.pending, entry.thread!.threadId) as sent (sent.id)}
              {@render mine(sent)}
            {/each}
          {/snippet}
          {#if chat.thinking}<ThinkingIndicator thinking={chat.thinking} />{/if}
        </SpanThreadCard>
      {/if}
    {/each}

    <!-- The learner's words, on screen from the keystroke and greyed until the echo. -->
    {#each pendingHere as sent (sent.id)}
      {@render mine(sent)}
    {/each}

    {#if received && (heldAnchor === docId || heldAnchor === null)}
      <p class="received" role="status">{RECEIVED_LINE}</p>
    {/if}

    {#if streamCard && (streamCard.anchorId ?? docId) === docId}
      <ChatMessage message={streamCard} streaming={streamCard.body} {pages} {onpage} />
    {:else if chat.thinking && (heldAnchor === docId || heldAnchor === null)}
      <ThinkingIndicator thinking={chat.thinking} />
    {/if}

    {#if canStop}
      <div class="stopwrap">
        <button type="button" class="ctrl" onclick={() => void chat.stop()}>Stop</button>
      </div>
    {/if}

    {#each chat.failures as failure (failure.id)}
      <div class="failed-turn" role="status">
        <span class="mark" aria-hidden="true">!</span>
        <p>{failure.displayName ?? 'A reply'} couldn't reply — {failure.reason}.</p>
        <button type="button" onclick={() => void chat.retry(failure.id)}>Retry</button>
      </div>
    {/each}
  </div>

  <div class="foot" bind:this={foot}>
    {#if replyThread && !draft}
      <!-- The thread the composer is replying in. ✕ (or Esc) goes back to the notebook chat. -->
      <div class="draft replyto">
        <blockquote title={replyThread.quote ?? ''}>
          <span class="replyto-label">Replying in the thread about</span>
          {replyThread.quote ?? 'a line in the document'}
        </blockquote>
        <button type="button" class="drop" title="Ask the notebook chat instead" onclick={() => chat.clearReply()}>✕</button>
      </div>
    {/if}
    {#if draft}
      <!-- The draft span thread: the quote is here, the thread is not created until this sends. -->
      <div class="draft">
        <blockquote>{draft.quote}</blockquote>
        <button type="button" class="drop" title="Don't ask about this" onclick={() => chat.cancelDraft()}>✕</button>
      </div>
    {/if}

    {#if refused}
      <p class="refused" role="status">{refused}</p>
    {/if}

    <!-- What this thread has cost (#42 item C). Above the composer rather than at the end of the
         scroller, so it is where the learner already is rather than somewhere they have to
         scroll to — and so it does not move every time a reply lands. -->
    <!-- The thread the composer sends to, so "this thread" means the one being written in. -->
    <CostFooter anchorId={target.threadId} />

    <MentionComposer
      placeholder={draft ? 'Ask about this line…' : placeholder}
      note={draft ? null : composer.note}
      pass={composer.pass && !draft}
      showMe={composer.showMe && !draft}
      passing={chat.passing}
      busy={chat.draftBusy}
      autofocus={draft !== null}
      cancelLabel={draft ? 'cancels' : replyThread ? 'leaves the thread' : null}
      onsend={send}
      onpass={() => void pass()}
      oncancel={draft ? () => chat.cancelDraft() : replyThread ? () => chat.clearReply() : undefined}
    />
  </div>
</div>

<style>
  .chat { display: flex; flex-direction: column; min-height: 0; height: 100%; }
  .scroll { flex: 1; overflow-y: auto; min-height: 0; padding: 10px 14px 4px; }
  .foot { flex: none; padding: 0 14px 10px; border-top: 1px solid var(--hairline); }

  .empty { padding: 12px 0 8px; display: grid; gap: 10px; }
  .empty p { margin: 0; font-size: 13px; line-height: 1.6; }
  .empty .sub { font-size: 11.5px; line-height: 1.55; color: var(--text-2); max-width: 46ch; }
  .greeting {
    padding: 9px 11px;
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-left: 3px solid var(--peer);
    border-radius: var(--radius);
  }
  .greeting header { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; }
  .greeting .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--peer); }
  .greeting .who { font-size: 12px; font-weight: 700; color: var(--peer); }
  .starters { display: grid; gap: 6px; }
  .starters button {
    text-align: left;
    border: 1px solid var(--hairline);
    background: var(--pane);
    border-radius: 10px;
    padding: 7px 10px;
    font-size: 12.5px;
    line-height: 1.45;
    color: var(--text);
  }
  .starters button:hover { border-color: var(--indigo); }
  .empty code {
    font-size: 11.5px;
    background: var(--ground);
    border: 1px solid var(--hairline);
    border-radius: 4px;
    padding: 0 4px;
  }

  .mine {
    margin: 10px 0;
    padding: 8px 12px;
    background: var(--indigo-tint);
    border-right: 3px solid var(--indigo);
    border-radius: var(--radius);
  }
  .mine header { display: flex; align-items: center; gap: 8px; margin-bottom: 3px; }
  .mine .label-caps { color: var(--indigo); }
  .mine p { margin: 0; font-size: 13px; line-height: 1.55; white-space: pre-wrap; }
  .mine.sending { opacity: 0.58; }
  .mine.failed { border-right-color: #b4543a; background: var(--pane); }
  .gap { flex: 1; }
  .state { font-size: 10px; color: var(--muted); }
  .state.bad { color: #8a2708; }
  .sendfoot { display: flex; align-items: center; gap: 10px; margin-top: 6px; }
  .why { flex: 1; font-size: 11px; color: var(--muted); }

  .received { margin: 10px 0 6px; font-size: 11px; color: var(--muted); }
  .stopwrap { margin: 6px 0 2px; }
  .ctrl {
    font-size: 11px;
    color: var(--indigo);
    border: 1px solid var(--hairline);
    border-radius: 4px;
    padding: 2px 8px;
  }
  .ctrl:hover { border-color: var(--indigo); }
  .ctrl.ghost { color: var(--muted); }

  .failed-turn {
    display: flex;
    align-items: center;
    gap: 9px;
    margin: 10px 0;
    padding: 7px 11px;
    border: 1px dashed var(--hairline);
    border-radius: var(--radius);
    background: var(--pane);
  }
  .failed-turn .mark {
    flex: none;
    width: 15px; height: 15px;
    border-radius: 50%;
    border: 1px solid var(--hairline);
    color: var(--muted);
    font-size: 10px;
    line-height: 13px;
    text-align: center;
  }
  .failed-turn p { margin: 0; flex: 1; font-size: 11.5px; line-height: 1.5; color: var(--muted); }
  .failed-turn button {
    flex: none;
    font-size: 11px;
    color: var(--indigo);
    padding: 2px 8px;
    border: 1px solid var(--hairline);
    border-radius: 4px;
  }

  .draft {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-top: 10px;
    padding: 7px 9px;
    background: var(--indigo-tint);
    border-radius: var(--radius);
  }
  .draft blockquote {
    flex: 1;
    margin: 0;
    padding-left: 8px;
    border-left: 2px solid var(--indigo);
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--text-2);
    font-style: italic;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .replyto-label { display: block; font-style: normal; font-size: 10px; color: var(--indigo); }
  .drop { flex: none; font-size: 11px; color: var(--muted); }
  .drop:hover { color: #8a2708; }

  .refused { margin: 8px 0 0; font-size: 11.5px; color: #8a2708; }
</style>
