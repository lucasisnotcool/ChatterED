<script lang="ts">
  /**
   * The faint "+ Ask here" line between two cards, and the prompt it opens
   * (`flow-build-plan.md` §4.1, `pivot-spec.md` §B1, video beat 7).
   *
   * Faint on purpose: it is an offer, not a call to action. And it is the *only* way anything
   * gets written into this document — "every boundary in this document was authored by me; so is
   * every question — no agent writes anywhere I have not asked."
   *
   * The prompt is §B1's gesture with the box-select taken out: a single line, **pre-focused**,
   * placeholder `Ask about this…`, `Enter` asks, `Esc` cancels and discards the anchor. It is
   * one line rather than a textarea because a question that needs a paragraph is an explanation,
   * and explanations go in the thread composer, which is the next primitive along.
   *
   * ## The scope chip (issue #35, `shared/scope.ts`)
   *
   * *"Summarise what I will be learning"* asked under slide 3 used to be answered from slide 3,
   * because a question in the flow is anchored to a segment and there was nothing else it could
   * be about. It now has a scope, and the chip is where the learner sees and changes it
   * **before** pressing Enter rather than after reading a disappointing answer.
   *
   * The chip calls `guessScope()` — the *same* function the main process calls when no scope is
   * passed — so the chip and the answer can never disagree. It re-guesses on every keystroke
   * until the learner touches it; from then on it is theirs and the guess stops moving it,
   * because a control that argues back while you type is not a control.
   */
  import { DECK_ANCHOR_ID, guessScope, type AskScope } from '../../shared/scope.js';

  let {
    open = false,
    /** Set while this segment's question is in flight — the 2–3 s retrieval hold. */
    busy = false,
    /** The anchor this line sits on, so the guess can tell a deck line from a segment card. */
    anchorId = DECK_ANCHOR_ID,
    /** False on the deck line: a deck question is a deck question, and there is no other scope. */
    scopeChip = true,
    placeholder = 'Ask about this…',
    label = '+ Ask here',
    onopen,
    oncancel,
    onask,
  }: {
    open?: boolean;
    busy?: boolean;
    anchorId?: string;
    scopeChip?: boolean;
    placeholder?: string;
    label?: string;
    onopen?: () => void;
    oncancel?: () => void;
    onask?: (question: string, scope: AskScope) => void;
  } = $props();

  let text = $state('');
  let box = $state<HTMLInputElement | null>(null);
  /** Null until the learner has touched the chip. After that it is theirs and the guess yields. */
  let chosen = $state<AskScope | null>(null);

  const guessed = $derived(guessScope({ question: text, anchorId }).scope);
  const scope = $derived<AskScope>(chosen ?? guessed);

  const SCOPE_WORD: Record<AskScope, string> = { segment: 'this segment', deck: 'whole deck' };

  // Pre-focused: the line is clicked and the next keystroke is already in the field.
  $effect(() => {
    if (open && box) box.focus();
  });

  function submit(): void {
    const question = text.trim();
    if (question.length === 0) return;
    const sending = scope;
    text = '';
    chosen = null;
    onask?.(question, sending);
  }

  function cancel(): void {
    text = '';
    chosen = null;
    oncancel?.();
  }
</script>

{#if busy}
  <p class="busy" aria-live="polite">Looking it up…</p>
{:else if open}
  <div class="prompt">
    <input
      bind:this={box}
      bind:value={text}
      type="text"
      {placeholder}
      aria-label={placeholder}
      onkeydown={(e) => {
        // The card and the flow both listen for keys; a question containing a ⌘Z is not an undo.
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          submit();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        }
      }}
      onblur={() => {
        if (text.trim().length === 0) cancel();
      }}
    />
    {#if scopeChip}
      <!--
        Two states, one click apart, and it says which one is live rather than offering a menu:
        the scope is nearly always right, and a dropdown for a binary the app already guessed
        would put a decision in front of every question.
      -->
      <button
        type="button"
        class="scope"
        class:deck={scope === 'deck'}
        aria-label={`What this question is about: ${SCOPE_WORD[scope]}. Click to change.`}
        title={scope === 'deck'
          ? 'Answered from the whole document. Click for this segment only.'
          : 'Answered from this segment. Click for the whole document.'}
        onmousedown={(e) => e.preventDefault()}
        onclick={() => {
          chosen = scope === 'deck' ? 'segment' : 'deck';
          box?.focus();
        }}
      >
        {SCOPE_WORD[scope]}
      </button>
    {/if}
    <span class="hint" aria-hidden="true">⏎ ask · esc cancel</span>
  </div>
{:else}
  <button type="button" class="ask" onclick={() => onopen?.()}>{label}</button>
{/if}

<style>
  /* 26 px, matching ASK_LINE in flowview.ts. */
  .ask {
    height: 26px;
    width: 100%;
    text-align: left;
    padding: 0 4px;
    font-size: 11px;
    color: var(--muted);
    opacity: 0.6;
  }
  .ask:hover { opacity: 1; color: var(--indigo); }

  .prompt { display: flex; align-items: center; gap: 10px; width: 100%; padding: 2px 0 4px; }
  input {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    padding: 6px 10px;
    border: 1px solid var(--indigo);
    border-radius: var(--radius);
    background: var(--pane);
    outline: none;
  }
  input::placeholder { color: var(--muted); }
  .hint { font-size: 10px; color: var(--muted); white-space: nowrap; }

  /* The scope, stated rather than offered. Indigo once it is the deck, because that is the
     state a learner needs to notice they are in. */
  .scope {
    flex: none;
    font-size: 10px;
    color: var(--text-2);
    border: 1px solid var(--hairline);
    border-radius: 999px;
    padding: 2px 9px;
    white-space: nowrap;
  }
  .scope:hover { color: var(--indigo); border-color: var(--indigo); }
  .scope.deck { color: var(--indigo); border-color: var(--indigo); background: var(--indigo-tint); }

  .busy {
    margin: 0;
    height: 26px;
    display: flex;
    align-items: center;
    padding: 0 4px;
    font-size: 11px;
    color: var(--text-2);
  }
</style>
