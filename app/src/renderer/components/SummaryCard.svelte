<script lang="ts">
  /**
   * **The artefact** (issue #41, `conversation-refinement.md` §5, `pdf-fidelity-segmentation.md` §C4).
   *
   * Lucas's suggested workflow, step 2: *"this should be provided as a button, which will create
   * a slide / segment that basically summarises what was taught in that conversational chain…
   * these artifacts help the user to review and recall, without having to go through the
   * conversation again."* This is that card, and step 3 — *"the conversation summarised to create
   * that artefact should be retrievable, continuable"* — is the disclosure at the bottom of it.
   *
   * **It must be visibly an artefact**, which §C4 spends a page on and this component holds in
   * three ways at once:
   *
   *  1. **It is not a crop.** Typeset in the app's own font on the app's own ground, KaTeX maths
   *     in the app's faces — never Beamer's, which in a maths module is the confusion with the
   *     highest cost. Nothing is drawn inside a slide's bounds.
   *  2. **It is not a chat turn.** No avatar, no persona colour, no role word, no time. A ruled
   *     block with a REFERENCE-register header, because it is not something anybody *said* — it
   *     is something the app wrote down from what was said.
   *  3. **It says so, on its face.** *"Summary · written by ChatterED from this conversation."*
   *     Not a tooltip and not a hover: an artefact whose provenance is discoverable rather than
   *     stated is an artefact a learner will eventually mistake for the lecturer's own words.
   *
   * The two controls are the whole of the interaction. **Regenerate** rewrites it from the same
   * thread (`flow:summarise` replaces, never appends). **Show the conversation** expands the
   * source thread beneath — the parent renders it into the `conversation` snippet, so this card
   * owns the disclosure and `FlowThread` owns what is inside it.
   */
  import type { MessageView } from '../../shared/types.js';
  import { aiBody } from '../lib/aitext.js';
  import { SUMMARY_HEADER, SUMMARY_WORD_CAP, conversationLabel } from '../lib/summary.js';
  import { wordCount } from '../lib/flowchat.js';
  import type { Snippet } from 'svelte';

  let {
    message,
    /** How many turns are behind it, for the disclosure's label. */
    turns = 0,
    open = false,
    busy = false,
    onregenerate,
    ontoggle,
    conversation,
  }: {
    message: MessageView;
    turns?: number;
    open?: boolean;
    busy?: boolean;
    onregenerate?: () => void;
    ontoggle?: (open: boolean) => void;
    /** The source thread and its composer, rendered by `FlowThread` inside the disclosure. */
    conversation?: Snippet;
  } = $props();

  /**
   * The same renderer every AI card uses — escape-first, with the markdown subset put back. A
   * summary is model-written prose like any other and gets no wider licence for being an
   * artefact; if anything the opposite, since this is the card that is meant to look official.
   */
  const parsed = $derived(aiBody(message.body));
  const words = $derived(wordCount(message.body));
  /** The cap is enforced in `flow:summarise`; this is the card able to say what it was held to. */
  const capped = $derived(words >= SUMMARY_WORD_CAP);
</script>

<article class="artefact" aria-label="Summary written by ChatterED from this conversation">
  <header class="head">
    <span class="mark" aria-hidden="true">❖</span>
    <span class="label-caps title">{SUMMARY_HEADER}</span>
  </header>

  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  <div class="body">{@html parsed.html}</div>

  <div class="foot">
    <button
      type="button"
      class="disclose"
      aria-expanded={open}
      onclick={() => ontoggle?.(!open)}
    >
      {open ? '▾' : '▸'} {conversationLabel(open, turns)}
    </button>
    <span class="gap"></span>
    {#if capped}
      <span class="cap" title={`Capped in code at ${SUMMARY_WORD_CAP} words, not asked for in a prompt`}>
        {SUMMARY_WORD_CAP}-word cap
      </span>
    {/if}
    <button type="button" class="ctrl" disabled={busy} onclick={() => onregenerate?.()}>
      {busy ? 'Rewriting…' : 'Regenerate'}
    </button>
  </div>

  {#if open && conversation}
    <!-- Step 3. The conversation is *inside* the artefact, which is the claim the layout makes:
         the card is the thing, and the thread behind it is what the card opens onto. -->
    <div class="behind">
      {@render conversation()}
    </div>
  {/if}
</article>

<style>
  /*
    Separation 2 of §C4, taken further than an AI turn takes it. A turn is inset with a coloured
    left rule; this is full width with a ruled top and bottom and no persona colour at all,
    because it belongs to the document rather than to a speaker. Still on the app's ground and
    never full-bleed — a crop is the only full-bleed object in this app.
  */
  .artefact {
    width: 100%;
    max-width: 760px;
    margin: 14px auto 12px;
    padding: 11px 16px 10px;
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-top: 2px solid var(--text-2);
    border-radius: var(--radius);
    /* Separation 1: the app's UI font, explicitly, so this can never inherit a slide's. */
    font-family: inherit;
  }

  .head { display: flex; align-items: baseline; gap: 7px; margin-bottom: 7px; }
  .mark { font-size: 10px; color: var(--text-2); }
  /* REFERENCE's own register: letterspaced, neutral, no colour and no name. */
  .title { color: var(--text-2); letter-spacing: 0.07em; }

  .body :global(p) { margin: 0 0 8px; font-size: 13.5px; line-height: 1.65; }
  .body :global(p:last-child) { margin-bottom: 0; }
  .body :global(strong) { font-weight: 600; }
  .body :global(em) { font-style: italic; }
  .body :global(ul), .body :global(ol) {
    margin: 0 0 8px;
    padding-left: 20px;
    font-size: 13.5px;
    line-height: 1.65;
  }
  .body :global(li) { margin: 0 0 4px; }
  /* §C4 again: agent-written maths is set in the app's faces, never Computer Modern. */
  .body :global(.katex) { font-family: inherit; font-size: 1em; }
  .body :global(.katex .mathnormal) { font-family: inherit; font-style: italic; }
  .body :global(.math-error) { font-size: 12px; color: #8a2708; }

  .foot {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px solid var(--hairline);
  }
  .gap { flex: 1; }
  .disclose { font-size: 11px; color: var(--indigo); opacity: 0.85; }
  .disclose:hover { opacity: 1; }
  .cap {
    font-size: 9.5px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
    border: 1px dashed var(--hairline);
    border-radius: 3px;
    padding: 0 4px;
  }
  .ctrl {
    font-size: 11px;
    color: var(--text-2);
    border: 1px solid var(--hairline);
    border-radius: 4px;
    padding: 2px 8px;
  }
  .ctrl:hover:not(:disabled) { color: var(--indigo); border-color: var(--indigo); }
  .ctrl:disabled { color: var(--muted); cursor: default; }

  /* The conversation, indented under the artefact so the nesting is visible: this thread is
     *behind* this card, not beside it. */
  .behind {
    margin-top: 6px;
    padding-top: 4px;
    border-top: 1px dashed var(--hairline);
  }
</style>
