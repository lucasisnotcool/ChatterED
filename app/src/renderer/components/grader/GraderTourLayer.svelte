<script lang="ts">
  /**
   * Help ▸ Show the Grader Tour (`shared/grader.ts`): the first-run tour again, over whatever is on
   * screen. Listens only in a grader copy; the menu item exists only there too (`main/menu.ts`).
   */
  import { bridge } from '../../lib/bridge.js';
  import { trial } from '../../lib/trialstore.svelte.js';
  import GraderTour from './GraderTour.svelte';

  let open = $state(false);

  $effect(() => {
    if (trial.status?.grader !== true) return;
    return bridge().onAppCommand((command) => {
      if (command === 'grader.tour') open = true;
    });
  });

  function onkeydown(e: KeyboardEvent): void {
    if (open && e.key === 'Escape') open = false;
  }
</script>

<svelte:window onkeydown={onkeydown} />

{#if open}
  <div class="scrim">
    <div class="card" role="dialog" aria-modal="true" aria-label="Grader tour">
      <!-- Mounted afresh on each opening, so the tour starts on its first card. -->
      <GraderTour ondone={() => (open = false)} doneLabel="Done" />
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 70;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(0, 0, 0, 0.28);
  }
  .card {
    width: min(560px, 100%);
    max-height: 100%;
    overflow-y: auto;
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    padding: 28px 32px 26px;
  }
</style>
