<script lang="ts">
  /**
   * Settings ▸ Study credit, on a study build only: the code field until it is entered, then the
   * credit as a bar with the numbers under it, and what to do when it runs out.
   */
  import { study } from '../../lib/studystore.svelte.js';
  import { store } from '../../lib/store.svelte.js';
  import { usd } from '../../../shared/study.js';
  import CreditBar from './CreditBar.svelte';
  import StudyUnlock from './StudyUnlock.svelte';

  $effect(() => {
    void study.load();
  });

  const s = $derived(study.status);
</script>

{#if s.available || s.unlocked}
  <section>
    <h2>Study credit</h2>
    {#if !s.unlocked}
      <p>Enter the study code you were sent. It unlocks the API credit the study pays for, on this Mac only.</p>
      <StudyUnlock onunlocked={() => void store.loadSettings()} />
    {:else if !s.active}
      <p class="quiet">
        {s.endedReason === 'key_removed'
          ? 'The study key was removed from this Mac, so ChatterED is no longer using the study credit.'
          : 'You are using your own Anthropic key now, so the study credit is no longer counted.'}
        {usd(s.spentUsd)} of the {usd(s.budgetUsd)} study credit was used before that.
      </p>
      <p class="quiet">To go back to the study credit, enter your study code again.</p>
      <StudyUnlock onunlocked={() => void store.loadSettings()} />
    {:else}
      <div class="credit">
        <CreditBar fraction={s.fraction} exhausted={s.exhausted} />
        <p class="nums">
          <strong>{s.exhausted ? 'Used up' : `${usd(s.remainingUsd)} left`}</strong>
          <span class="quiet">· {usd(s.spentUsd)} of {usd(s.budgetUsd)} used · participant slot {s.slot}</span>
        </p>
      </div>
      {#if s.exhausted}
        <p>
          The study credit is used up. You can keep using ChatterED with your own provider: add an
          Anthropic, OpenAI or Gemini key (or an OpenAI-compatible endpoint) under
          <strong>Where the study partners run</strong> above, and choose it there. Your notebooks and
          progress stay as they are.
        </p>
      {:else}
        <p class="quiet">
          The amount is ChatterED's estimate from each call's token count. Nothing is ever billed to
          you: the study pays, and when its credit runs out ChatterED stops and tells you.
        </p>
      {/if}
    {/if}
  </section>
{/if}

<style>
  /* The section frame matches Settings.svelte's own; its styles are scoped to that file. */
  section {
    max-width: 68ch;
    padding: 18px 20px;
    margin-bottom: 16px;
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
  }
  h2 { margin: 0 0 10px; font-size: 12px; font-weight: 600; letter-spacing: 0.02em; }
  p { margin: 0 0 10px; font-size: 13px; line-height: 1.7; }
  .quiet { color: var(--text-2); font-size: 12px; }
  .credit { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
  .nums { margin: 0; font-variant-numeric: tabular-nums; }
</style>
