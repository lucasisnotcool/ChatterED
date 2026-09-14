<script lang="ts">
  /**
   * The ⌘K finder (issue #22 decision 2): fuzzy filename and path matching over the vault.
   *
   * §C10 L1004 binds ⌘K to the whisper, and §B1's own header ASCII at L186 already prints
   * `[ Search ⌘K ]`. The two are reconciled by scope, not by moving either: inside a room the
   * Room component owns the keydown and ⌘K is the whisper; outside one, it is this. They can
   * never both be live, because the Library is not on screen while a room is open.
   *
   * Matching happens in the main process (`src/main/vault/finder.ts`) — the renderer holds no
   * file list of its own, and therefore cannot go stale against the index.
   */
  import { store } from '../lib/store.svelte.js';

  let { onopen }: { onopen: (fileId: string) => void } = $props();

  let input = $state<HTMLInputElement | null>(null);
  let cursor = $state(0);

  $effect(() => {
    input?.focus();
  });

  // Re-clamp whenever the hit list changes under the selection.
  $effect(() => {
    if (cursor >= store.finderHits.length) cursor = Math.max(0, store.finderHits.length - 1);
  });

  function choose(index: number): void {
    const hit = store.finderHits[index];
    if (!hit) return;
    store.finderOpen = false;
    onopen(hit.fileId);
  }

  function onkeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      store.finderOpen = false;
      return;
    }
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault();
      cursor = Math.min(cursor + 1, store.finderHits.length - 1);
      return;
    }
    if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault();
      cursor = Math.max(cursor - 1, 0);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      choose(cursor);
    }
  }

  /** Split a path into matched and unmatched runs using the positions the matcher returned. */
  function runs(text: string, positions: number[]): { text: string; match: boolean }[] {
    const hit = new Set(positions);
    const out: { text: string; match: boolean }[] = [];
    for (let i = 0; i < text.length; i += 1) {
      const match = hit.has(i);
      const last = out[out.length - 1];
      if (last && last.match === match) last.text += text[i];
      else out.push({ text: text[i] ?? '', match });
    }
    return out;
  }
</script>

<div
  class="scrim"
  role="presentation"
  onclick={(e) => {
    if (e.target === e.currentTarget) store.finderOpen = false;
  }}
>
  <div class="palette" role="dialog" aria-modal="true" aria-label="Find a file">
    <input
      bind:this={input}
      class="query"
      type="text"
      placeholder="Find a file…"
      autocomplete="off"
      spellcheck="false"
      value={store.finderQuery}
      oninput={(e) => void store.runFinder(e.currentTarget.value)}
      {onkeydown}
    />

    {#if store.finderQuery.trim().length === 0}
      <p class="hint">Type part of a file name, or part of its folder.</p>
    {:else if store.finderHits.length === 0}
      <p class="hint">Nothing matches that.</p>
    {:else}
      <ul class="hits" role="listbox" aria-label="Matches">
        {#each store.finderHits as hit, i (hit.fileId)}
          <li>
            <button
              type="button"
              class="hit"
              class:on={i === cursor}
              role="option"
              aria-selected={i === cursor}
              onmousemove={() => (cursor = i)}
              onclick={() => choose(i)}
            >
              <span class="path">
                {#each runs(hit.relPath, hit.positions) as run, j (j)}<span class:m={run.match}>{run.text}</span>{/each}
              </span>
              {#if hit.topicName}<span class="topic">{hit.topicName}</span>{/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(27, 27, 34, 0.22);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: 96px 20px 20px;
    z-index: 50;
  }
  .palette {
    width: min(560px, 100%);
    max-height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    box-shadow: 0 18px 48px rgba(27, 27, 34, 0.18);
    overflow: hidden;
  }
  .query {
    border: 0;
    border-bottom: 1px solid var(--hairline);
    padding: 14px 16px;
    font-size: 14px;
    outline: none;
    background: none;
  }
  .hint { margin: 0; padding: 14px 16px; font-size: 12px; color: var(--muted); }

  .hits { list-style: none; margin: 0; padding: 6px; overflow-y: auto; min-height: 0; }
  .hit {
    display: flex;
    align-items: baseline;
    gap: 10px;
    width: 100%;
    padding: 6px 10px;
    border-radius: 6px;
    text-align: left;
    font-size: 12px;
    color: var(--text-2);
  }
  .hit.on { background: var(--indigo-tint); color: var(--text); }
  .path { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; direction: rtl; }
  /* The matched characters are bold, not tinted: indigo is the learner's and primary actions'
     (§C2 rule 3), and weight survives greyscale and deuteranopia (rule 1). */
  .m { font-weight: 700; color: var(--text); }
  .topic { flex: none; font-size: 11px; color: var(--muted); }
</style>
