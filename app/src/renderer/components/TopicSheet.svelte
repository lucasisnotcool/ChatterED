<script lang="ts">
  /**
   * Promoting folders to topics (issue #22 decision 1).
   *
   * The whole screen is one question — "which of these folders are modules?" — so it is a sheet
   * over the Library, not a Settings page: the learner is already looking at the vault, and the
   * answer changes what they are looking at. Everything not ticked stays browsable under
   * "Other", so there is no wrong answer and therefore no confirmation step.
   */
  import { SvelteSet } from 'svelte/reactivity';
  import { store } from '../lib/store.svelte.js';

  const picked = new SvelteSet(store.topicCandidates.filter((c) => c.promoted).map((c) => c.relPath));

  function toggle(relPath: string): void {
    if (picked.has(relPath)) picked.delete(relPath);
    else picked.add(relPath);
  }

  function onkeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      store.topicSheetOpen = false;
    }
  }
</script>

<svelte:window onkeydown={onkeydown} />

<div class="scrim">
  <div class="sheet" role="dialog" aria-modal="true" aria-label="Choose topics">
    <h2>Which folders are your topics?</h2>
    <p class="blurb">
      Ticked folders become topics in the sidebar, with their own file tree. Everything else stays
      browsable under Other — nothing is hidden either way.
    </p>

    {#if store.topicCandidates.length === 0}
      <p class="empty">There are no folders inside this one yet.</p>
    {:else}
      <ul class="list">
        {#each store.topicCandidates as c (c.relPath)}
          <li>
            <label>
              <input type="checkbox" checked={picked.has(c.relPath)} onchange={() => toggle(c.relPath)} />
              <span class="name">{c.name}</span>
              <span class="count">{c.fileCount} {c.fileCount === 1 ? 'file' : 'files'}</span>
            </label>
          </li>
        {/each}
      </ul>
    {/if}

    <div class="actions">
      <button type="button" class="btn" onclick={() => (store.topicSheetOpen = false)}>Cancel</button>
      <button
        type="button"
        class="btn-primary"
        disabled={store.vaultBusy}
        onclick={() => void store.promoteTopics([...picked])}
      >
        {store.vaultBusy ? 'Scanning…' : 'Use these'}
      </button>
    </div>
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(27, 27, 34, 0.28);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    z-index: 40;
  }
  .sheet {
    width: min(460px, 100%);
    max-height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    padding: 20px 22px 18px;
  }
  h2 { margin: 0 0 8px; font-size: 14px; font-weight: 600; }
  .blurb { margin: 0 0 16px; font-size: 12px; line-height: 1.6; color: var(--text-2); }
  .empty { margin: 0 0 16px; font-size: 12px; color: var(--muted); }

  .list { list-style: none; margin: 0 0 18px; padding: 0; overflow-y: auto; min-height: 0; }
  label {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 6px;
    border-radius: 6px;
    font-size: 13px;
    cursor: pointer;
  }
  label:hover { background: var(--ground); }
  .name { flex: 1; }
  .count { color: var(--muted); font-size: 11px; }

  .actions { display: flex; justify-content: flex-end; gap: 10px; }
</style>
