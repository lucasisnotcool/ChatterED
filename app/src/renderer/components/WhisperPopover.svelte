<script lang="ts">
  /**
   * **Ask privately** — the whisper, as a popover on one segment card
   * (`flow-build-plan.md` §3.5 / §4.1, `pivot-spec.md` §B5, `design-brief.md` §D5, issue #16).
   *
   * This is the **only** component in the flow's graph that may name the private layer, and
   * `context.test.ts`'s second walk holds an allowlist of exactly this file. Everything the
   * invariant rests on is structural rather than careful:
   *
   *  - it draws `store.flowWhisper` and nothing else, and that field is written only by
   *    `flow:whisperOpen` / the `whisper.turn` event for **this thread id**;
   *  - it is mounted by `FlowCanvas` *beside* the card, never inside the crop's bounds — the
   *    never-rule of §4.1 holds for a popover exactly as it does for an AI card;
   *  - nothing it renders is ever handed to `FlowThread`. The one path out is
   *    **Insert into the document**, which posts a *new shared card* through `actor.relay()`;
   *  - it is ephemeral by construction: `Esc` and click-away close it, and the thread behind it
   *    belongs to one segment sitting (see `actor.openSegmentWhisper`).
   *
   * The vocabulary is `WhisperPane.svelte`'s, deliberately: the lock, "Private with Ellie",
   * "Max can't see this", the limits statement as the first thing in the pane, and
   * `RelayOffer.svelte`'s offer → preview → edit → sent ladder. Only the verb changed — in a
   * document you *insert into the document*, you do not *raise it in the group*.
   */
  import type { FlowWhisperView, RelayAttribution } from '../../shared/types.js';
  import { aiBody } from '../lib/aitext.js';
  import { monogram } from '../lib/labels.js';

  let {
    whisper,
    otherName,
    /** A private turn is in flight: Ellie is held 1–2 s, the same floor the pane had. */
    thinking = false,
    inserting = false,
    /** The page this card came off, for the foot line and the breadcrumb. */
    page = null,
    onsend,
    oninsert,
    onclose,
  }: {
    whisper: FlowWhisperView;
    otherName: string;
    thinking?: boolean;
    inserting?: boolean;
    page?: number | null;
    onsend: (text: string) => void;
    oninsert: (input: { whisperId: string; attribution: RelayAttribution; text: string }) => void;
    onclose: () => void;
  } = $props();

  let text = $state('');
  let box = $state<HTMLTextAreaElement | null>(null);
  let turns = $state<HTMLDivElement | null>(null);

  /** The insert ladder, per offering turn. `RelayOffer`'s four stages, same order. */
  let stage = $state<'offer' | 'preview' | 'edit' | 'done'>('offer');
  let attribution = $state<RelayAttribution>('as_me');
  let draft = $state('');
  let draftFor = $state<string | null>(null);

  /** The last agent turn that offered to be inserted. One at a time; the newest wins. */
  const offer = $derived(
    [...whisper.turns].reverse().find((t) => t.sender === 'agent' && t.relayOffer !== null) ?? null,
  );

  $effect(() => {
    const id = offer?.id ?? null;
    if (id === draftFor) return;
    draftFor = id;
    draft = offer?.relayOffer?.draftText ?? '';
    attribution = offer?.relayOffer?.defaultAttribution ?? 'as_me';
    stage = 'offer';
  });

  $effect(() => {
    if (box) box.focus();
  });

  // Keep the newest private turn in view without scrolling the document behind it.
  $effect(() => {
    void whisper.turns.length;
    void thinking;
    if (turns) turns.scrollTop = turns.scrollHeight;
  });

  function send(): void {
    const body = text.trim();
    if (!body) return;
    onsend(body);
    text = '';
  }
</script>

<!-- `Esc` anywhere inside closes; the click-away is owned by FlowCanvas, which knows where the
     card ends. Stopping propagation matters: ⌘Z is the flow's undo and ⌘K would re-open this. -->
<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
<section
  class="pop"
  role="dialog"
  aria-label="Ask {whisper.agent.displayName} privately"
  data-private-note={whisper.anchorId}
  onkeydown={(e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
    }
  }}
>
  <span class="caret" aria-hidden="true"></span>

  <header>
    <span class="title"><span class="lock" aria-hidden="true">🔒</span> Private with {whisper.agent.displayName}</span>
    <span class="sub">{otherName} can't see this.</span>
    <button type="button" class="x" onclick={onclose} aria-label="Close">esc ✕</button>
  </header>

  <div class="turns" bind:this={turns}>
    <!-- The limits statement is always the first thing in the pane (§B5, verbatim). -->
    <div class="turn agent" style="--hue: {whisper.agent.colour}">
      <span class="label-caps lbl">{whisper.agent.displayName}</span>
      <p class="limits">{whisper.limitsLine}</p>
    </div>

    {#each whisper.turns as t (t.id)}
      <div
        class="turn"
        class:agent={t.sender === 'agent'}
        class:mine={t.sender === 'student'}
        style="--hue: {whisper.agent.colour}"
      >
        {#if t.sender === 'agent'}
          <span class="label-caps lbl">{whisper.agent.displayName}</span>
          <!-- The same escape-then-restore-two-things renderer every AI card uses, so a private
               answer is not the one place in the app where `**no**` shows its asterisks.
               `aiBody` escapes first and puts back exactly two things, which is why this is safe
               here for the same reason it is safe in `AiSegment`. -->
          <!-- eslint-disable-next-line svelte/no-at-html-tags -->
          <div class="body">{@html aiBody(t.body).html}</div>
        {:else}
          <p>{t.body}</p>
        {/if}
      </div>
    {/each}

    {#if thinking}
      <!-- §B9 device 2, in miniature: the wait has a location before it has content. Ellie
           *types* and Max *reads*, and there is no counter here because the counter is Max's. -->
      <p class="typing" role="status">{whisper.agent.displayName} is typing<span class="dots">…</span></p>
    {/if}
  </div>

  {#if offer && stage !== 'done'}
    <div class="insert">
      {#if stage === 'offer'}
        <p class="q">Insert into the document?</p>
        <p class="why">
          A new card under this segment, in the shared flow. This private note stays here.
        </p>
        <label>
          <input type="radio" name="attr-{offer.id}" value="as_me" bind:group={attribution} />
          <span>As my note</span>
        </label>
        <label>
          <input type="radio" name="attr-{offer.id}" value="as_agent" bind:group={attribution} />
          <span>Let {whisper.agent.displayName} write it as her own</span>
        </label>
        <div class="acts">
          <button type="button" class="btn-primary small" onclick={() => (stage = 'preview')}>
            Preview &amp; insert
          </button>
          <button type="button" class="ghost" onclick={() => (stage = 'done')}>Keep it here</button>
        </div>
      {:else}
        <p class="q">This is what goes into the document</p>
        <div class="preview" style="--hue: {attribution === 'as_agent' ? whisper.agent.colour : 'var(--indigo)'}">
          <div class="phead">
            {#if attribution === 'as_agent'}
              <span class="avatar" aria-hidden="true">{monogram(whisper.agent.displayName)}</span>
              <span class="label-caps">{whisper.agent.displayName}</span>
            {:else}
              <span class="label-caps">You</span>
            {/if}
            <!-- §B5's dual attribution. It says a private note happened; it never says what
                 was in it, and no agent's prompt carries this line. -->
            <span class="from">from a private note</span>
          </div>
          {#if stage === 'edit'}
            <textarea bind:value={draft} rows="5" aria-label="Edit what goes into the document"></textarea>
          {:else}
            <p class="ptext">{draft}</p>
          {/if}
        </div>
        <p class="why">
          {otherName} will see this card. {otherName} won't see anything else from this note.
        </p>
        <div class="acts">
          <button
            type="button"
            class="btn-primary small"
            disabled={inserting || draft.trim().length === 0}
            onclick={() => {
              oninsert({ whisperId: offer.id, attribution, text: draft.trim() });
              stage = 'done';
            }}
          >
            {inserting ? 'Inserting…' : 'Insert into the document'}
          </button>
          {#if stage === 'preview'}
            <button type="button" class="ghost" onclick={() => (stage = 'edit')}>Edit</button>
          {:else}
            <button type="button" class="ghost" onclick={() => (stage = 'preview')}>Done editing</button>
          {/if}
          <button type="button" class="ghost" onclick={() => (stage = 'offer')}>Back</button>
        </div>
      {/if}
    </div>
  {/if}

  <div class="composer">
    <textarea
      bind:this={box}
      bind:value={text}
      rows="2"
      placeholder="Ask {whisper.agent.displayName} privately about this segment…"
      aria-label="Private message"
      onkeydown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          onclose();
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          send();
        }
      }}
    ></textarea>
    <p class="foot">
      Enter sends · Esc closes · nothing here reaches {otherName}{page === null ? '' : ` · p.${page}`}
    </p>
    <!-- Accurate, and the accuracy is the point: it clears with the **sitting**, which is what a
         "round" became in a document (`actor.openSegmentWhisper`). Reopening ⌘K on this card in
         this sitting shows these turns again; another card, or a new sitting, shows none. -->
    <p class="foot dim">Clears with this sitting · never part of the document.</p>
  </div>
</section>

<style>
  .pop {
    position: relative;
    width: 100%;
    max-width: 520px;
    display: flex;
    flex-direction: column;
    background: var(--pane);
    border: 1px solid var(--hairline);
    /* The whisper tint of §B5, carried as a left rule rather than a full wash so the popover
       still reads as the app's chrome and never as a slide. */
    border-left: 3px solid var(--indigo);
    border-radius: var(--radius);
    box-shadow: 0 10px 28px rgb(0 0 0 / 18%);
    overflow: hidden;
  }
  .caret {
    position: absolute;
    top: -5px;
    left: 34px;
    width: 9px;
    height: 9px;
    background: var(--pane);
    border-left: 1px solid var(--hairline);
    border-top: 1px solid var(--hairline);
    transform: rotate(45deg);
  }

  header {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 3px 8px;
    padding: 9px 12px;
    border-bottom: 1px solid var(--hairline);
  }
  .title { font-size: 12px; font-weight: 600; }
  .lock { font-size: 10px; }
  .sub { font-size: 11px; color: var(--text-2); }
  .x { margin-left: auto; color: var(--muted); font-size: 10px; }
  .x:hover { color: var(--text); }

  .turns { max-height: 320px; overflow-y: auto; padding: 11px 12px 2px; }
  .turn { margin-bottom: 10px; }
  .turn p { margin: 0; font-size: 12.5px; line-height: 1.55; white-space: pre-wrap; }
  .turn .body { font-size: 12.5px; line-height: 1.55; }
  .turn .body :global(p) { margin: 0 0 7px; }
  .turn .body :global(p:last-child) { margin-bottom: 0; }
  .lbl { color: var(--hue); display: block; margin-bottom: 3px; }
  .agent p,
  .agent .body {
    background: var(--ground);
    border-left: 2px solid var(--hue);
    border-radius: 5px;
    padding: 7px 9px;
  }
  .agent .limits { background: none; border-left: 2px solid var(--hue); }
  .limits { font-style: italic; color: var(--text-2); }
  .mine p {
    background: var(--indigo-tint);
    border-radius: 5px;
    padding: 7px 9px;
    margin-left: 16px;
  }
  .typing { margin: 0 0 8px; font-size: 11px; color: var(--text-2); }
  .dots { letter-spacing: 1px; }

  .insert {
    border-top: 1px solid var(--hairline);
    background: var(--ground);
    padding: 9px 12px;
  }
  .q { margin: 0 0 4px; font-size: 12px; font-weight: 500; }
  .why { margin: 0 0 7px; font-size: 11px; color: var(--muted); line-height: 1.45; }
  label { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--text-2); padding: 2px 0; }
  input[type='radio'] { accent-color: var(--indigo); margin: 0; }
  .acts { display: flex; align-items: center; gap: 10px; margin-top: 9px; flex-wrap: wrap; }
  .small { padding: 4px 11px; font-size: 12px; }
  .ghost { font-size: 11px; color: var(--text-2); border-bottom: 1px solid transparent; }
  .ghost:hover { color: var(--indigo); border-bottom-color: var(--indigo); }

  .preview {
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-left: 3px solid var(--hue);
    border-radius: 6px;
    padding: 7px 9px;
  }
  .phead { display: flex; align-items: center; gap: 5px; margin-bottom: 4px; color: var(--hue); flex-wrap: wrap; }
  .avatar {
    width: 14px; height: 14px; border-radius: 50%; background: var(--hue); color: #fff;
    font-size: 8px; display: inline-flex; align-items: center; justify-content: center;
  }
  .from {
    font-size: 9.5px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .ptext { margin: 0; font-size: 12.5px; line-height: 1.55; }
  .preview textarea {
    width: 100%; resize: vertical; border: 1px solid var(--hairline);
    border-radius: 5px; padding: 6px 8px; font-size: 12.5px;
  }

  .composer { border-top: 1px solid var(--hairline); padding: 9px 12px 10px; }
  .composer textarea {
    width: 100%;
    resize: none;
    border: 1px solid var(--hairline);
    border-radius: 6px;
    padding: 7px 9px;
    font-size: 12.5px;
    line-height: 1.5;
    background: var(--pane);
  }
  .composer textarea:focus { border-color: var(--indigo); outline: none; }
  .foot { margin: 5px 0 0; font-size: 10px; color: var(--muted); }
  .foot.dim { opacity: 0.75; }
</style>
