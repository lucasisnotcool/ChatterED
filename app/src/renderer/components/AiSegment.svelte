<script lang="ts">
  /**
   * One AI card in the flow — REFERENCE, Teacher or Tester
   * (`pdf-fidelity-segmentation.md` §C4, `pivot-spec.md` §C4, `flow-build-plan.md` §4.1).
   *
   * **The never-rule, enforced here:** no AI-generated text is ever rendered in a slide's fonts,
   * on a slide's background, or inside a crop's bounds. This component is the place that rule
   * lives, so the four separations §C4 asks for are all structural rather than stylistic:
   *
   *   1. **Typography** — the app's UI font on the app's background; maths through KaTeX in the
   *      app's style, never Computer Modern. A crop carries the slide's fonts, always.
   *   2. **Edge** — inset, with the conversation's own left rule in the speaker's colour. A crop
   *      is full-bleed with a hairline border, like a photograph. The crop is an *object*; this
   *      is *annotation around it*.
   *   3. **Attribution** — name and avatar in the header. A crop carries a page chip. The two
   *      card types share zero chrome, and neither ever grows the other's.
   *   4. **The callout.** A card that needs to point at a region draws a short rule up to the
   *      crop's edge and stays outside it. That rule and the split guide are the only two things
   *      this app ever draws near slide pixels, and only the guide is ever drawn *on* them.
   *
   * The REFERENCE voice is neutral grey and carries no role word, because it has no role: it is
   * a scope, not an agent (`src/room/reference.ts`). Its card is the one with the rule, the
   * hand-back line and the two buttons (`pivot-spec.md` §B1).
   */
  import type { MessageView } from '../../shared/types.js';
  import { aiBody, collapsedLine } from '../lib/aitext.js';
  import { EMPTY_TURN_LINE, emptyBody, metaAlwaysOn, metaParts } from '../lib/flowchat.js';
  import { monogram, roleWord } from '../lib/labels.js';
  import { ruleTag } from '../lib/quiz.js';
  import { store } from '../lib/store.svelte.js';
  import { clockTime } from '../lib/time.js';
  import Divider from './Divider.svelte';

  let {
    message,
    /** Draw the callout rule from this card's top-left up to the crop above it. */
    callout = false,
    collapsed = false,
    /** REFERENCE only: the two buttons `pivot-spec.md` §B1 draws under the hand-back line. */
    onexplain,
    onremove,
    /** A provisional body streamed in ahead of `turn.released` (audit §2, P1). */
    streaming = null,
    stopped = false,
    /**
     * Set on the Teacher's `rule:offer_summary` line (issue #41): the offer is a sentence, and
     * this is the one click that is the whole of what it does. R1 is why it is a button here and
     * not an insertion there — *"nothing enters the learner's document without the learner"*.
     */
    onsummarise,
    summarising = false,
  }: {
    message: MessageView;
    callout?: boolean;
    collapsed?: boolean;
    onexplain?: () => void;
    onremove?: () => void;
    streaming?: string | null;
    stopped?: boolean;
    onsummarise?: () => void;
    summarising?: boolean;
  } = $props();

  const agent = $derived(message.speaker.kind === 'agent' ? message.speaker : null);
  const isReference = $derived(message.speaker.kind === 'reference');
  /** Neutral grey for the reference voice — deliberately not one of the three personas. */
  const hue = $derived(agent ? agent.colour : 'var(--muted)');
  const isTester = $derived(agent?.role === 'challenger');
  /**
   * The deck's own page numbers, so a `p. N` in the Tester's grounds becomes a button (issue #47,
   * §3). Read off the store rather than passed in: `FlowThread` renders in two places and the deck
   * is the same deck in both, and the alternative is threading one array through three components
   * that have no other interest in it. Empty outside the flow, where no button is written.
   */
  const deckPages = $derived([...new Set((store.flow?.segments ?? []).map((sg) => sg.page))]);
  const parsed = $derived(aiBody(streaming ?? message.body, { pages: deckPages }));
  /** A turn that came back with no text at all still has to say so — see `emptyBody`. */
  const empty = $derived(emptyBody(streaming ?? message.body, streaming !== null));
  /**
   * Provenance (audit §6). A turn that does not say which backend produced it is a claim about a
   * model that never ran — and this app can silently be answering from `ScriptedClient`. Hidden
   * until the card is hovered, except `scripted`, which is shown unconditionally for that reason.
   */
  /**
   * A click anywhere in the body, looking for a `p. N` citation (issue #47, §3).
   *
   * Delegated because the body is `@html` and there is no Svelte handler to attach to a button
   * `aitext.ts` wrote. The only thing trusted here is `data-page`, and `aitext.ts` writes it from a
   * parsed integer that is in the deck — so the worst a model can do is cite a page that exists.
   */
  function onBodyClick(e: MouseEvent): void {
    const hit = (e.target as HTMLElement | null)?.closest?.('[data-page]');
    const page = Number(hit?.getAttribute('data-page') ?? '');
    if (!Number.isInteger(page) || page <= 0) return;
    e.stopPropagation();
    store.requestPage(page);
  }

  const meta = $derived(metaParts(message));
  const loud = $derived(metaAlwaysOn((message as { backend?: string | null }).backend));
  /**
   * **Which §2.3 rule decided this turn** (issue #47, `attempt-first.md` §2.3).
   *
   * `byRule` above is for a turn a rule *wrote*; this is for a turn a rule *decided*, and only
   * for the two decisions the brief nominates as the app's one important design decision: the
   * answer withheld before an attempt, and the answer shown without the ledger moving. Everything
   * else the loop decides stays untagged — `ruleTag()` has the list and the argument.
   */
  const decided = $derived(ruleTag(message.decidedBy));
</script>

<!--
  **The nudge's divider (audit §4).** `actor.ts` has written `dividerCause` on every silence turn
  since the timer shipped and `views.ts` has carried it on the `MessageView`; the flow dropped it
  on the floor, so a content-free pool nudge was pixel-identical to a considered reply. That is
  most of the confusion in the 2026-09-16 screenshot, and this is the markup that was missing.
-->
{#if message.divider}
  <div class="dividerwrap">
    <Divider divider={message.divider} paused={store.room?.nudgesPaused ?? false} onComplain={(next) => store.pauseNudges(next)} />
  </div>
{/if}

<article
  class="ai"
  class:reference={isReference}
  class:tester={isTester}
  class:callout
  data-anchor={message.anchorId ?? ''}
  style="--hue: {hue}"
>
  {#if callout}
    <!-- Outside the crop, pointing at it. Never inside its bounds (§C4 rule 4). -->
    <span class="pointer" aria-hidden="true"></span>
  {/if}

  <header class="head">
    {#if agent}
      <span class="avatar" class:ringed={isTester} aria-hidden="true">{monogram(agent.displayName)}</span>
      <span class="label-caps name">{agent.displayName} · {roleWord(agent.role)}</span>
    {:else}
      <span class="label-caps name ref">REFERENCE</span>
    {/if}
    {#if message.byRule}
      <!-- "That hand-off is a rule I can see and turn down, not a model's whim" (beat 10). -->
      <span class="rule-tag" title="Written by a rule in flow.ts, not generated by a model">by rule</span>
    {/if}
    {#if decided}
      <!--
        The attempt loop's own tag (§2.3). Same weight as `by rule`, different sentence: this turn
        was generated, but *whether it could contain the answer* was not the model's call. The
        report's "one important design decision" is this tag being legible on the card.
      -->
      <span class="rule-tag decided" title={decided.title}>{decided.label}</span>
    {/if}
    {#if message.promotedFromWhisper}
      <!-- `pivot-spec.md` §B5's dual attribution. It says a private note happened; it never says
           what was in it, and no agent's prompt carries this line — see the field's docstring in
           shared/types.ts for why the room's stream does not draw it and the document does. -->
      <span class="from-private" title="This card came out of a private note you approved">from a private note</span>
    {/if}
    <span class="gap"></span>
    <span class="time" aria-hidden="true">{clockTime(message.createdAt)}</span>
  </header>

  {#if collapsed}
    <p class="one-line">{collapsedLine(message.body)}</p>
  {:else}
    {#if empty}
      <p class="empty">{EMPTY_TURN_LINE}</p>
    {:else}
      <!--
        **The grounds, clickable** (§3). One delegated handler rather than a component per
        citation: the body is `@html`, so there is no Svelte handler to attach, and the only thing
        this listens for is a `data-page` written by `aitext.ts` from a parsed integer. `FlowCanvas`
        owns where the flow actually goes — this only says which page was asked for.
      -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="body" onclick={onBodyClick}>
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        {@html parsed.html}
      </div>
    {/if}

    {#if parsed.handBack}
      <hr class="rule" />
      <p class="handback">{parsed.handBack}</p>
    {/if}

    {#if streaming !== null}
      <!-- Provisional. The floor already elapsed in the main process; this only unrolls what it
           released, and the caret says the turn is not finished yet. -->
      <span class="caret" aria-hidden="true"></span>
    {/if}

    {#if stopped}
      <p class="stopped">You stopped this reply.</p>
    {/if}

    {#if meta.length > 0}
      <p class="meta" class:loud>{meta.join(' · ')}</p>
    {/if}

    {#if onsummarise}
      <!-- The offer, made actionable. The Teacher wrote the sentence; the chip is the app's, and
           pressing it is the only thing that puts an artefact in the document (R1). -->
      <div class="actions">
        <button type="button" class="chip" disabled={summarising} onclick={onsummarise}>
          {summarising ? 'Writing the summary…' : 'Summarise into the document'}
        </button>
      </div>
    {/if}

    {#if isReference && (onexplain || onremove)}
      <div class="actions">
        {#if onexplain}
          <button type="button" class="btn" onclick={onexplain}>Explain it back →</button>
        {/if}
        {#if onremove}
          <button type="button" class="ghost" onclick={onremove}>✕ Remove</button>
        {/if}
      </div>
    {/if}
  {/if}
</article>

<style>
  /* Separation 2: inset, on the app's ground, with the speaker's left rule. A crop is
     full-bleed on its own background; these two must never be confusable at a glance. */
  .ai {
    position: relative;
    margin: 10px 0 10px 26px;
    padding: 9px 14px 11px;
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-left: 3px solid var(--hue);
    border-radius: var(--radius);
    /* Separation 1: the app's UI font, explicitly, so this can never inherit a slide's. */
    font-family: inherit;
  }
  /* The Tester's non-colour cue, unchanged from the room: a dashed rule and a ringed avatar. */
  .ai.tester { border-left-style: dashed; }
  .ai.reference { background: var(--ground); border-left-color: var(--muted); }

  /* The callout: a short rule from this card's top-left up to the crop's lower edge. It stops
     at the edge — nothing is ever drawn inside the pixels. */
  .pointer {
    position: absolute;
    left: -14px;
    top: -12px;
    width: 12px;
    height: 24px;
    border-left: 1px solid var(--hue);
    border-bottom: 1px solid var(--hue);
    border-bottom-left-radius: 6px;
    opacity: 0.65;
  }

  .head { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; }
  .gap { flex: 1; }
  .name { color: var(--hue); }
  .name.ref { color: var(--text-2); letter-spacing: 0.08em; }
  .time { font-size: 10px; color: var(--muted); opacity: 0; transition: opacity 120ms ease-out; }
  .ai:hover .time { opacity: 1; }

  .avatar {
    width: 18px; height: 18px; border-radius: 50%;
    background: var(--hue); color: #fff; font-size: 10px; font-weight: 600;
    display: inline-flex; align-items: center; justify-content: center; flex: none;
  }
  .avatar.ringed { background: transparent; color: var(--hue); border: 1.5px solid var(--hue); }

  .from-private {
    font-size: 9.5px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
    border: 1px dashed var(--hairline);
    border-radius: 3px;
    padding: 0 4px;
  }

  .rule-tag {
    font-size: 9.5px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
    border: 1px solid var(--hairline);
    border-radius: 3px;
    padding: 0 4px;
  }
  /* The attempt loop's tag is a sentence rather than two words, so it is not upper-cased — at
     9.5 px, "ANSWER WITHHELD UNTIL YOU TRY" in caps is a header, and this is a footnote. */
  .rule-tag.decided { text-transform: none; letter-spacing: 0.01em; white-space: nowrap; }

  /*
    A citation, not a link. Underlined on the dotted rather than the solid, because it goes nowhere
    outside the document: it scrolls the deck to the page the Tester cited. `:global` because the
    button is written by `aitext.ts` into `@html` and Svelte's scoping cannot see it.
  */
  .body :global(.pageref) {
    font: inherit;
    color: var(--indigo);
    border-bottom: 1px dotted var(--indigo);
    padding: 0;
    cursor: pointer;
    white-space: nowrap;
  }
  .body :global(.pageref:hover) { border-bottom-style: solid; }

  .body :global(p) { margin: 0 0 8px; font-size: 13.5px; line-height: 1.6; }
  .body :global(p:last-child) { margin-bottom: 0; }
  /* The markdown subset `aitext.ts` renders (issue #41). A list is set tight against the prose
     above it, because in these turns it nearly always *is* the prose — "the lineage is:" and
     then three numbered points — and a browser's default 16 px indent pushes it out past the
     card's own text column. */
  .body :global(strong) { font-weight: 600; }
  .body :global(em) { font-style: italic; }
  .body :global(ul), .body :global(ol) {
    margin: 0 0 8px;
    padding-left: 20px;
    font-size: 13.5px;
    line-height: 1.6;
  }
  .body :global(ul:last-child), .body :global(ol:last-child) { margin-bottom: 0; }
  .body :global(li) { margin: 0 0 4px; }
  .body :global(li:last-child) { margin-bottom: 0; }
  .body :global(li)::marker { color: var(--muted); }
  /* Separation 1 again, and the one that matters most in a maths module: agent-written maths is
     set in the app's faces, never in the slide's (§C4). KaTeX ships Computer Modern; it is
     overridden here rather than loaded and ignored. */
  .body :global(.katex) { font-family: inherit; font-size: 1em; }
  .body :global(.katex .mathnormal) { font-family: inherit; font-style: italic; }
  .body :global(.math-error) { font-size: 12px; color: #8a2708; }

  .rule { border: 0; border-top: 1px solid var(--hairline); margin: 10px 0 8px; }
  .handback { margin: 0; font-size: 12.5px; line-height: 1.55; color: var(--text-2); }
  .one-line {
    margin: 0;
    font-size: 12.5px;
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* The divider is a room-level rule, so it spans the thread rather than the inset card. */
  .dividerwrap { margin-left: 26px; }

  /* Hover-revealed, tiny, muted: provenance the researcher needs and the learner never reads —
     except `scripted`, which is the one case the learner must not miss. */
  .meta {
    margin: 7px 0 0;
    font-size: 10px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    opacity: 0;
    transition: opacity 120ms ease-out;
  }
  .ai:hover .meta, .meta.loud { opacity: 1; }
  .meta.loud { color: #8a5a08; }

  .stopped { margin: 7px 0 0; font-size: 11px; color: var(--muted); font-style: italic; }
  /* Not an error colour: an empty turn is an outage, not the learner's mistake (TurnFailureCard
     makes the same argument about the same kind of event). */
  .empty { margin: 0; font-size: 12.5px; color: var(--muted); font-style: italic; }

  .caret {
    display: inline-block;
    width: 6px;
    height: 13px;
    margin-left: 2px;
    vertical-align: -2px;
    background: var(--hue);
    animation: blink 1s steps(2, start) infinite;
  }
  @keyframes blink { 0%, 100% { opacity: 0.15; } 50% { opacity: 0.9; } }
  @media (prefers-reduced-motion: reduce) {
    .caret { animation: none; opacity: 0.5; }
  }

  .actions { display: flex; align-items: center; gap: 14px; margin-top: 10px; }
  /* The offer's chip. Indigo-tinted like every other affordance the learner owns, and sized as
     a chip rather than a button: it is one of two ways forward, not the way forward. */
  .chip {
    font-size: 11.5px;
    color: var(--indigo);
    background: var(--indigo-tint);
    border: 1px solid var(--indigo);
    border-radius: 999px;
    padding: 3px 12px;
  }
  .chip:disabled { color: var(--muted); background: transparent; border-color: var(--hairline); cursor: default; }
  .btn { font-size: 12px; padding: 5px 12px; }
  .ghost { font-size: 11px; color: var(--text-2); border-bottom: 1px solid transparent; }
  .ghost:hover { color: #8a2708; border-bottom-color: #8a2708; }
</style>
