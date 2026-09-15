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
   */
  let {
    open = false,
    /** Set while this segment's question is in flight — the 2–3 s retrieval hold. */
    busy = false,
    onopen,
    oncancel,
    onask,
  }: {
    open?: boolean;
    busy?: boolean;
    onopen?: () => void;
    oncancel?: () => void;
    onask?: (question: string) => void;
  } = $props();

  let text = $state('');
  let box = $state<HTMLInputElement | null>(null);

  // Pre-focused: the line is clicked and the next keystroke is already in the field.
  $effect(() => {
    if (open && box) box.focus();
  });

  function submit(): void {
    const question = text.trim();
    if (question.length === 0) return;
    text = '';
    onask?.(question);
  }

  function cancel(): void {
    text = '';
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
      placeholder="Ask about this…"
      aria-label="Ask about this segment"
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
    <span class="hint" aria-hidden="true">⏎ ask · esc cancel</span>
  </div>
{:else}
  <button type="button" class="ask" onclick={() => onopen?.()}>+ Ask here</button>
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
