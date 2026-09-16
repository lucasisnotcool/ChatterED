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
  import {
    RECEIVED_LINE,
    pendingFor,
    receivedVisible,
    stopAllowed,
    thinkingAnchor,
  } from '../lib/flowchat.js';
  import { clock, store } from '../lib/store.svelte.js';
  import { clockTime } from '../lib/time.js';
  import { canSummarise, conversationFor, offersSummary, splitThread } from '../lib/summary.js';
  import AiSegment from './AiSegment.svelte';
  import SummaryCard from './SummaryCard.svelte';
  import ThinkingIndicator from './ThinkingIndicator.svelte';
  import TurnFailureCard from './TurnFailureCard.svelte';
  import WaitLine from './WaitLine.svelte';

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
   * **The artefact, lifted out of the conversation** (issue #41, `lib/summary.ts`).
   *
   * A summarised thread is shown *as its summary*, with the conversation behind a disclosure on
   * the card — because the artefact exists precisely so the learner does not have to read the
   * thread again to recall what it taught. The turns are not hidden, they are one click away and
   * the click is on the card that replaced them.
   */
  const split = $derived(splitThread(anchorId, visible));
  const artefact = $derived(split.artefact);
  /**
   * The conversation, in `flow:threadOf`'s order when it has answered and in the local grouping
   * until then. Identical in every case the main process actually produces; the call is made
   * because the side that wrote the card is the authority on what is behind it.
   */
  const convo = $derived(
    artefact ? conversationFor(anchorId, split.turns, store.threadOf[artefact.id] ?? null) : split.turns,
  );
  const busy = $derived(store.summarising === anchorId);
  /** Offer the action once something has actually been taught here (`canSummarise`'s docstring). */
  const offerAction = $derived(store.canSummarise && canSummarise(split.turns));
  /** The learner's own turns that have not been echoed back yet (audit §1). */
  const pending = $derived(pendingFor(store.pendingSends, anchorId));

  /**
   * The wait belongs to **the turn**, not to whichever composer happens to be open.
   *
   * This used to read `store.composerAt === anchorId` — a single global set by *Explain it back*
   * or *Reply here* — so opening another segment's composer, reopening the document, or letting
   * a nudge land on the last anchor rendered `room.thinking` **nowhere at all** (audit Fact 2).
   * The actor allows one agent turn in flight document-wide (`pivot-spec.md` §B10 R2), so there
   * is exactly one right answer and `thinkingAnchor()` is it.
   */
  const heldAnchor = $derived(thinkingAnchor(room.thinking, store.lastSendAnchor, store.composerAt));
  const holding = $derived(heldAnchor === anchorId ? room.thinking : null);
  const waiting = $derived(room.thinking !== null);
  /** Failed turns belong under the thread they failed in, where the learner is looking. */
  const failures = $derived(room.failures.filter((f) => f.anchorId === anchorId));

  /**
   * **The received state (audit §2a).** For the first 3–8 s after a send the app was completely
   * silent by design: `product-design.md` §C3 asks for a floor-yield window with "nothing at
   * all", and paid for it with two devices the flow does not have. §C3 governs *agent* chrome,
   * and "the room has your message" is not agent chrome — so this line is neutral, carries no
   * name, no avatar and no verb, and disappears the instant real agent chrome arrives.
   */
  const receivedAnchor = $derived(store.turnReceived?.anchorId ?? store.lastSendAnchor);
  const received = $derived(
    receivedAnchor === anchorId &&
      receivedVisible(store.turnReceivedAt, room.thinking !== null, clock.ms),
  );

  /**
   * The provisional block of a turn that is unrolling (audit §2, P1). Nothing here is visible
   * earlier than the floor allows — the main process buffers every token until the floor passes
   * and only then starts emitting — so this is purely the difference between a long turn that
   * *unrolls* and one that thuds.
   */
  const streamHere = $derived(
    store.stream && (store.stream.anchorId ?? store.lastSendAnchor) === anchorId ? store.stream : null,
  );
  const streamAgent = $derived(
    streamHere ? (room.agents.find((a) => a.key === streamHere.agentKey) ?? null) : null,
  );
  /** A `MessageView` shape so the provisional card is drawn by the same component as the real one. */
  const streamCard = $derived<MessageView | null>(
    streamHere && streamAgent
      ? {
          id: `stream:${streamHere.turnId}`,
          seq: Number.MAX_SAFE_INTEGER,
          speaker: {
            kind: 'agent',
            key: streamAgent.key,
            role: streamAgent.role,
            displayName: streamAgent.displayName,
            colour: streamAgent.colour,
          },
          body: streamHere.text,
          createdAt: new Date(clock.ms).toISOString(),
          latencyTargetMs: null,
          ttftActualMs: null,
          promotedFromWhisper: false,
          disagreement: null,
          divider: null,
          reference: null,
          anchorId,
          byRule: null,
        }
      : null,
  );

  /**
   * **Stop**, offered only once the floor has elapsed (Lucas, 2026-09-16). A learner who can
   * cancel every Tester turn can opt out of the retrieval practice the app exists for; a learner
   * behind a hung backend must always be able to get out. The same clock decides both.
   */
  const canStop = $derived(holding !== null && stopAllowed(room.thinking, clock.ms));

  /** The highest seq on screen here, for `flow:markSeen` — the unread dot's other half. */
  const topSeq = $derived(visible.reduce((n, m) => Math.max(n, m.seq), 0));
  const collapsed = $derived(store.threadCollapsed[anchorId] === true);
  /**
   * The agent the silence timer would fire, for the wait-line's caption. Same rule as the room's
   * composer: stage 1 is the Teacher's, and naming her is the whole point of the affordance.
   */
  const firingAgent = $derived(room.agents.find((a) => a.role === 'peer') ?? null);

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

  /**
   * Send.
   *
   * The composer is cleared **after** the send has been handed to the bridge and an optimistic
   * block exists to carry the text, never before: `flowSend` used to be fire-and-forget with
   * `text = ''` on the next line, so a rejected send lost the learner's words entirely
   * (audit §1). Focus is restored either way — a send that steals the keyboard is a send that
   * makes the learner reach for the mouse to write the next sentence.
   */
  function submit(): void {
    const body = text.trim();
    if (!body) return;
    const id = store.flowSend(anchorId, body);
    if (id === null) return;
    text = '';
    box?.focus();
  }

  /** `Esc` closes the composer and hands focus back to the card (audit §5). */
  function closeComposer(): void {
    store.composerAt = null;
    const card = document.querySelector<HTMLElement>(`[data-segment="${anchorId}"]`);
    card?.focus();
  }

  /**
   * Seen. The dot on the card's label strip clears when the thread is actually on screen, not
   * when the message arrives — which is the whole difference between an unread marker and a
   * decoration (audit §7).
   */
  function watchSeen(node: HTMLElement) {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) store.markSeen(anchorId, topSeq);
      },
      { threshold: 0.2 },
    );
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }
</script>

<!--
  The conversation itself, as a snippet, because since #41 it has **two** places it can be drawn:
  standalone under the segment, or inside the summary card's *Show the conversation* disclosure.
  One definition, so the composer, the wait chrome and the optimistic block are identical in both
  — a second copy of this markup would drift within a week.
-->
{#snippet conversation()}
  {#each convo as message (message.id)}
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
        onremove={message.id === lockedByAnswerId ? () => store.removeAnswer(message.id, anchorId) : undefined}
        stopped={(message as { stopped?: boolean }).stopped === true}
        onsummarise={offersSummary(message) && store.canSummarise
          ? () => void store.summarise(anchorId)
          : undefined}
        summarising={busy}
      />
    {/if}
  {/each}

  <!--
    **The optimistic block (audit §1).** The learner's words are on screen from the keystroke,
    greyed until the main process echoes them back, and if the send is rejected they are still
    here with a Retry rather than gone into a dismissible banner. Every mature chat UI does this
    and the flow did none of it.
  -->
  {#each pending as send (send.id)}
    <article class="mine" class:sending={send.state === 'pending'} class:failed={send.state === 'failed'}>
      <header class="mine-head">
        <span class="label-caps">You</span>
        <span class="gap"></span>
        {#if send.state === 'pending'}
          <span class="state" aria-hidden="true">Sending…</span>
        {:else}
          <span class="state bad">Didn't send</span>
        {/if}
      </header>
      <p>{send.body}</p>
      {#if send.state === 'failed'}
        <div class="sendfoot">
          <span class="why">{send.error ?? 'The app could not reach the room.'}</span>
          <button type="button" class="ctrl" onclick={() => store.retrySend(send.id)}>Retry</button>
          <button type="button" class="ctrl ghost" onclick={() => store.dropSend(send.id)}>Discard</button>
        </div>
      {/if}
    </article>
  {/each}

  <!--
    Room state, not agent state: no name, no avatar, no verb. It is what keeps the 3–8 s window
    §C3 deliberately leaves free of agent chrome from being a blank screen (audit §2a).
  -->
  {#if received}
    <p class="received" role="status">{RECEIVED_LINE}</p>
  {/if}

  {#if streamCard}
    <AiSegment message={streamCard} callout streaming={streamCard.body} />
  {:else if holding}
    <div class="slot"><ThinkingIndicator thinking={holding} /></div>
  {/if}

  {#if canStop}
    <div class="stopwrap">
      <button type="button" class="ctrl" onclick={() => void store.stopTurn()}>Stop</button>
    </div>
  {/if}

  {#each failures as failure (failure.id)}
    <TurnFailureCard {failure} />
  {/each}

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
          /* `AskHereLine` has always handled Esc; the thread composer did not, so it could not
             be closed without the mouse (audit §5). */
          if (e.key === 'Escape') {
            e.preventDefault();
            closeComposer();
          }
        }}
      ></textarea>
      <!--
        **The silence timer, in the flow (audit §4).** The 45 s countdown, the *"Ellie may chime
        in"* caption and the **Hold** / **Wait for me** controls existed only under the room's
        composer; in the document the timer was completely invisible and uncontrollable, so a
        nudge arrived out of nowhere and there was no way to say "give me a minute".

        The per-round pause is the researched behaviour and stays a per-round pause: Lucas's
        2026-09-16 decision is that there is deliberately **no global off switch**, because that
        would remove the mechanism from the study without removing it from the build.
      -->
      <WaitLine
        timer={room.timer}
        {firingAgent}
        onhold={() => store.hold()}
        onwait={() => store.pauseNudges(!room.nudgesPaused)}
      />

      <div class="foot">
        <span class="hint">Enter sends · ⇧Enter newline · Esc closes</span>
        <span class="gap"></span>
        {#if waiting && !holding}
          <!-- The off-screen breadcrumb's local twin: a held turn somewhere else in the document
               (§B9 device 3). One at a time, guaranteed by R2. -->
          <span class="elsewhere">Someone is replying further up ↑</span>
        {/if}
        <!-- A visible Send. Enter-only is a shortcut, not an affordance, and nothing was ever
             disabled — so an empty composer looked exactly like a full one (audit §1). -->
        <button type="button" class="send" disabled={text.trim().length === 0} onclick={submit}>Send</button>
      </div>
    </div>
  {:else if convo.length > 0}
    <div class="threadfoot">
      <button type="button" class="reopen" onclick={() => (store.composerAt = anchorId)}>Reply here</button>
      {#if offerAction && !artefact}
        <!--
          **Lucas's item 2**, as a button on every thread rather than only on the Teacher's offer:
          *"for artefact creation and generation, this should be provided as a button, which will
          create a slide / segment that basically summarises what was taught in that conversational
          chain."* `rule:offer_summary` is the app volunteering; this is the learner not having to
          wait for it.
        -->
        <button type="button" class="summarise" disabled={busy} onclick={() => void store.summarise(anchorId)}>
          {busy ? 'Writing the summary…' : '❖ Summarise into the document'}
        </button>
      {/if}
    </div>
  {/if}
{/snippet}

<section class="thread" aria-label="Conversation about this segment" use:watchSeen data-thread={anchorId}>
  {#if artefact}
    <!--
      A summarised thread. The card is the face of it and the conversation is what the card opens
      onto — Lucas's item 3: *"the conversation summarised to create that artefact should be
      retrievable, continuable by the user."* Retrievable is the disclosure; continuable is the
      composer inside it, which posts into this same thread and never opens a new one.
    -->
    <SummaryCard
      message={artefact}
      turns={convo.length}
      open={!collapsed}
      {busy}
      onregenerate={() => void store.summarise(anchorId)}
      ontoggle={(open) => void store.showConversation(artefact.id, anchorId, open)}
      {conversation}
    />
  {:else}
    {#if visible.length > 1}
      <!-- Thread collapse, persisted (audit §7). A deck with forty threads in it is a deck the
           learner scrolls past, not one they read. -->
      <button
        type="button"
        class="fold"
        aria-expanded={!collapsed}
        onclick={() => store.setThreadCollapsed(anchorId, !collapsed)}
      >
        {collapsed ? `▸ ${visible.length} turns` : '▾ hide this thread'}
      </button>
    {/if}
    {#if !collapsed}
      {@render conversation()}
    {/if}
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

  /* The optimistic block, and its two states. Greyed rather than coloured: a message in flight
     is not an error, and nothing here should read as one until it actually is. */
  .mine.sending { opacity: 0.58; }
  .mine.failed { border-right-color: #b4543a; background: var(--pane); }
  .mine-head .gap { flex: 1; }
  .state { font-size: 10px; color: var(--muted); }
  .state.bad { color: #8a2708; }
  .sendfoot { display: flex; align-items: center; gap: 10px; margin-top: 6px; }
  .why { flex: 1; font-size: 11px; color: var(--muted); }
  .ctrl {
    font-size: 11px;
    color: var(--indigo);
    border: 1px solid var(--hairline);
    border-radius: 4px;
    padding: 2px 8px;
  }
  .ctrl:hover { border-color: var(--indigo); }
  .ctrl.ghost { color: var(--muted); }

  .received {
    margin: 10px 0 6px 26px;
    font-size: 11px;
    color: var(--muted);
    letter-spacing: 0.01em;
  }

  .stopwrap { margin: 6px 0 2px 26px; }

  .fold {
    display: block;
    margin: 6px 0 0;
    font-size: 10.5px;
    color: var(--muted);
    opacity: 0.75;
  }
  .fold:hover { opacity: 1; color: var(--indigo); }

  .send {
    font-size: 11px;
    color: #fff;
    background: var(--indigo);
    border-radius: 5px;
    padding: 3px 12px;
  }
  .send:disabled { background: var(--hairline); color: var(--muted); cursor: default; }

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

  .threadfoot { display: flex; align-items: center; gap: 14px; margin: 4px 0 2px; }
  .reopen {
    font-size: 11px;
    color: var(--muted);
    opacity: 0.7;
  }
  .reopen:hover { opacity: 1; color: var(--indigo); }

  /* Quiet, like *Reply here*: an artefact is a thing the learner may make, not a thing the app
     is pushing. `rule:offer_summary` is where the app does the pushing, once per thread. */
  .summarise {
    font-size: 11px;
    color: var(--muted);
    opacity: 0.7;
  }
  .summarise:hover:not(:disabled) { opacity: 1; color: var(--indigo); }
  .summarise:disabled { opacity: 0.55; cursor: default; }
</style>
