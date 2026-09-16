<script lang="ts">
  /**
   * The labelled divider above a silence-fill message (product-design.md §C5), and the control
   * that turns the nudges off — Koala's "reject a note" (`Academia/Sources/[NEW] Koala System`),
   * which is the reason a per-round control exists at all rather than a Settings toggle.
   *
   * **The label is the main process's sentence, printed verbatim.** `divider.cause` arrives
   * already written (`divider_cause` on the message row): *"45 s quiet · Ellie stepped in"* for a
   * content-free nudge, *"Ellie tried again"* for a re-explanation. The two are different events
   * and the Teacher track is making them read differently; nothing here maps, matches or
   * rewrites the string, so whichever cause arrives is whichever cause is shown.
   *
   * **The control used to read `don't do this`** (issue #37). Lower-case, unpunctuated, jammed
   * against the cause between two hairlines, it read as a stray debug tag on the divider rather
   * than as something a learner could press — and nothing said what pressing it would do or how
   * long it would last. It is now a sentence, it carries the "how long" in a `title`, and it is
   * separated from the cause by its own gap and a quiet link underline so it reads as an offer
   * rather than as part of the label.
   *
   * It stays **undoable**, and visibly so: once the nudges are paused the same control says so
   * and turns them back on. A one-way "make it stop" is a control a learner will not risk
   * pressing, which is the same argument §C5 makes for the affordance existing at all.
   */
  import type { MessageView } from '../../shared/types.js';

  let {
    divider,
    /** Whether the quiet-timer nudges are currently paused for this round (`room.nudgesPaused`). */
    paused = false,
    onComplain,
  }: {
    divider: NonNullable<MessageView['divider']>;
    paused?: boolean;
    onComplain?: (next: boolean) => void;
  } = $props();
</script>

<div class="divider" role="separator">
  <span class="rule"></span>
  <span class="cause">{divider.cause}</span>
  {#if divider.control === 'dont_do_this'}
    <button
      class="stop"
      class:on={paused}
      type="button"
      title={paused
        ? 'Turn the quiet-timer nudges back on for the rest of this round.'
        : 'Stop the quiet-timer nudges for the rest of this round. Nothing will step in while you think; the next segment starts them again, and you can turn them back on here.'}
      onclick={() => onComplain?.(!paused)}
    >
      {paused ? 'Nudges paused · turn back on' : 'Stop nudging this round'}
    </button>
  {/if}
  <span class="rule"></span>
</div>

<style>
  .divider {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 32px 0 16px;
    max-width: 72ch;
  }
  .rule { flex: 1; height: 1px; background: var(--hairline); }
  .cause { font-size: 11px; color: var(--text-2); white-space: nowrap; }

  /* A quiet link-button, held off the cause by its own margin: the gap is what stops it reading
     as a second half of the label. Underlined on hover and on focus, never a filled control —
     it is an offer beside a status line, not an action the divider is asking for. */
  .stop {
    margin-left: 4px;
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
    border-bottom: 1px solid transparent;
    padding: 0;
  }
  .stop:hover,
  .stop:focus-visible {
    color: var(--indigo);
    border-bottom-color: var(--indigo);
    outline: none;
  }
  /* Paused is a state the learner has to be able to see from across the thread, because it is
     the explanation for a silence that would otherwise read as the app having stopped. */
  .stop.on { color: var(--indigo); border-bottom-color: color-mix(in srgb, var(--indigo) 40%, transparent); }
</style>
