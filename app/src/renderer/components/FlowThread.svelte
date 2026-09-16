<script lang="ts">
  /**
   * One segment's thread: everything said about this crop, under it
   * (`flow-build-plan.md` §3.3 track B, `pivot-spec.md` §B1–B2).
   *
   * The asymmetry §B2 asks for is the layout: **what the learner wrote is in the document, what
   * the agents wrote is beside it.** A learner turn is a full-width indigo-tinted block; an agent
   * turn is an inset card with its own left rule, drawn by `AiSegment.svelte`, which is where the
   * never-rule lives.
   *
   * Two states this component is responsible for making legible:
   *
   *  - **the lock.** While a REFERENCE card is waiting for *Explain it back →* there is no
   *    composer, because there is nothing the learner can say into a thread no agent may answer
   *    in. The buttons are the only way forward, and that is the mechanism that turns "the AI
   *    gave me the answer" into the hook (`flow-build-plan.md` §4.3).
   *  - **the wait.** `pivot-spec.md` §B9: the reserved slot at its final width, the three dots,
   *    `Ellie is typing…` / `Max is reading…`, and — for the Tester only — the counter climbing
   *    from 3 s, with the amber ring on the avatar. The wait has a location before it has
   *    content, which is the whole reason a held reply in a document reads as deliberate rather
   *    than as lag.
   */
  import type { MessageView, RoomSnapshot } from '../../shared/types.js';
  import { store } from '../lib/store.svelte.js';
  import { clockTime } from '../lib/time.js';
  import AiSegment from './AiSegment.svelte';
  import ThinkingIndicator from './ThinkingIndicator.svelte';

  let {
    anchorId,
    messages,
    room,
    /** The REFERENCE card this thread is locked by, if any. */
    lockedByAnswerId = null,
    composerOpen = false,
  }: {
    anchorId: string;
    messages: MessageView[];
    room: RoomSnapshot;
    lockedByAnswerId?: string | null;
    composerOpen?: boolean;
  } = $props();

  let text = $state('');
  let box = $state<HTMLTextAreaElement | null>(null);
  let lastBeat = 0;

  const visible = $derived(messages.filter((m) => !store.answersRemoved[m.id]));
  /**
   * The wait belongs to *this* thread. The actor allows one agent turn in flight document-wide
   * (`pivot-spec.md` §B10 R2), so the held turn is drawn under the segment the learner is in —
   * the only place it can be, and the only place they are looking.
   */
  const holding = $derived(room.thinking && store.composerAt === anchorId ? room.thinking : null);
  const waiting = $derived(room.thinking !== null);

  $effect(() => {
    if (composerOpen && box) box.focus();
  });

  function beat(): void {
    const now = Date.now();
    if (text.trim().length === 0) return;
    if (now - lastBeat < 3000) {
      store.lastTypedAt = now;
      return;
    }
    lastBeat = now;
    store.typing(text.length);
  }

  function submit(): void {
    const body = text.trim();
    if (!body) return;
    store.flowSend(anchorId, body);
    text = '';
  }
</script>

<section class="thread" aria-label="Conversation about this segment">
  {#each visible as message (message.id)}
    {#if message.speaker.kind === 'student'}
      <!-- The learner's own writing, in the document, full width and indigo-tinted (§B2). -->
      <article class="mine">
        <header class="mine-head">
          <span class="label-caps">You</span>
          {#if message.promotedFromWhisper}
            <!-- `pivot-spec.md` §B5's dual attribution: authored by the learner, *from a private
                 note*. What was in that note is not here and never will be. -->
            <span class="from-private" title="You approved this out of a private note">from a private note</span>
          {/if}
          <span class="time" aria-hidden="true">{clockTime(message.createdAt)}</span>
        </header>
        <p>{message.body}</p>
      </article>
    {:else}
      <AiSegment
        {message}
        callout={message.speaker.kind !== 'reference'}
        collapsed={store.answersCollapsed[message.id] === true}
        onexplain={message.id === lockedByAnswerId ? () => void store.explainBack(message.id) : undefined}
        onremove={message.id === lockedByAnswerId ? () => store.removeAnswer(message.id) : undefined}
      />
    {/if}
  {/each}

  {#if holding}
    <div class="slot"><ThinkingIndicator thinking={holding} /></div>
  {/if}

  {#if lockedByAnswerId}
    <!-- No composer while the card is unanswered. Saying so beats an input that does nothing. -->
    <p class="locked">
      Ellie and Max are out of this thread until you have said it back.
    </p>
  {:else if composerOpen}
    <div class="composer">
      <textarea
        bind:this={box}
        bind:value={text}
        rows="3"
        placeholder="Explain this in your own words…"
        aria-label="Your explanation"
        oninput={beat}
        onkeydown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      ></textarea>
      <div class="foot">
        <span class="hint">Enter sends · ⇧Enter newline</span>
        <span class="gap"></span>
        {#if waiting && !holding}
          <!-- The off-screen breadcrumb's local twin: a held turn somewhere else in the document
               (§B9 device 3). One at a time, guaranteed by R2. -->
          <span class="elsewhere">Someone is replying further up ↑</span>
        {/if}
      </div>
    </div>
  {:else if visible.length > 0}
    <button type="button" class="reopen" onclick={() => (store.composerAt = anchorId)}>Reply here</button>
  {/if}
</section>

<style>
  .thread {
    width: 100%;
    max-width: 760px;
    margin: 2px auto 0;
    padding-left: 2px;
  }

  .mine {
    margin: 10px 0;
    padding: 9px 14px;
    background: var(--indigo-tint);
    border-right: 3px solid var(--indigo);
    border-radius: var(--radius);
  }
  .mine-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .mine-head .label-caps { color: var(--indigo); }
  .mine p { margin: 0; font-size: 13.5px; line-height: 1.6; white-space: pre-wrap; }
  .from-private {
    font-size: 9.5px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
    border: 1px dashed var(--hairline);
    border-radius: 3px;
    padding: 0 4px;
  }
  .time { font-size: 10px; color: var(--muted); opacity: 0; transition: opacity 120ms ease-out; }
  .mine:hover .time { opacity: 1; }

  /* §B9 device 2: the reserved slot, at the note's final width, before it has content. */
  .slot { margin-left: 26px; }

  .locked {
    margin: 8px 0 4px 26px;
    font-size: 11.5px;
    color: var(--muted);
    font-style: italic;
  }

  .composer { margin: 10px 0 4px; }
  textarea {
    width: 100%;
    resize: none;
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--pane);
    padding: 9px 12px;
    font-size: 13.5px;
    line-height: 1.55;
  }
  textarea::placeholder { color: var(--muted); }
  textarea:focus { border-color: var(--indigo); outline: none; }

  .foot { display: flex; align-items: center; gap: 12px; margin-top: 6px; }
  .gap { flex: 1; }
  .hint { font-size: 10.5px; color: var(--muted); }
  .elsewhere { font-size: 10.5px; color: var(--text-2); }

  .reopen {
    margin: 4px 0 2px;
    font-size: 11px;
    color: var(--muted);
    opacity: 0.7;
  }
  .reopen:hover { opacity: 1; color: var(--indigo); }
</style>
