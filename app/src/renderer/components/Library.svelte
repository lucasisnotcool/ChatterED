<script lang="ts">
  /** The launcher (product-design.md §B1). No upload button exists anywhere. */
  import { bridge } from '../lib/bridge.js';
  import { LEDGER_GLYPH, glyphAlt } from '../lib/labels.js';
  import { store } from '../lib/store.svelte.js';
  import { relative } from '../lib/time.js';

  const recents = $derived((store.boot?.recentSessions ?? []).slice(0, 3));
  const folder = $derived(store.boot?.slidesFolder ?? null);

  async function chooseFolder(): Promise<void> {
    const picked = await bridge().chooseSlidesFolder();
    if (picked && store.boot) store.boot.slidesFolder = picked;
  }
</script>

<div class="screen">
  <header class="top">
    <h1>Library</h1>
  </header>

  {#if recents.length > 0}
    <h2 class="label-caps">Continue</h2>
    <div class="strip">
      {#each recents as s (s.roomId)}
        <button type="button" class="card" onclick={() => void store.openRoom(s.roomId)}>
          <span class="title">{s.conceptTitle}</span>
          <span class="row">
            <span class="glyphs">
              {#each s.states.slice(0, 3) as st, i (i)}
                <span class="g">{LEDGER_GLYPH[st]}</span><span class="sr-only">{glyphAlt(st)}</span>
              {/each}
            </span>
            <span class="when">{relative(s.endedAt ?? s.updatedAt)}</span>
          </span>
        </button>
      {/each}
    </div>
  {/if}

  <p class="paste">
    <button type="button" class="btn-link" onclick={() => store.goSetup()}>Paste text instead →</button>
  </p>

  <h2 class="label-caps">{folder ?? 'Your slides'}</h2>
  <div class="list">
    {#if !folder}
      <div class="empty">
        <p>
          Point ChatterED at the folder where your lecture slides live. It reads them from disk —
          nothing is uploaded anywhere you didn't put it.
        </p>
        <button type="button" class="btn-primary" onclick={() => void chooseFolder()}>
          Choose a folder…
        </button>
      </div>
    {:else}
      <div class="empty">
        <p>No PDFs in this folder yet.</p>
        <p class="path">{folder}</p>
        <button type="button" class="btn-link" onclick={() => void chooseFolder()}>Choose another…</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .screen { flex: 1; overflow-y: auto; padding: 20px 28px 40px; min-width: 0; }
  .top { display: flex; align-items: baseline; gap: 14px; margin-bottom: 18px; }
  h1 { margin: 0; font-size: 16px; font-weight: 600; }
  h2 { margin: 22px 0 10px; color: var(--muted); font-size: 10px; }

  .strip { display: flex; gap: 12px; flex-wrap: wrap; }
  .card {
    width: 230px;
    text-align: left;
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    padding: 12px 14px;
  }
  .card:hover { border-color: var(--indigo); }
  .title { display: block; font-size: 13px; line-height: 1.4; margin-bottom: 14px; }
  .row { display: flex; align-items: baseline; justify-content: space-between; }
  .glyphs { display: inline-flex; gap: 7px; }
  .g { color: var(--glyph); }
  .when { font-size: 11px; color: var(--muted); }

  .paste { margin: 14px 0 0; }

  .list { background: var(--pane); border: 1px solid var(--hairline); border-radius: var(--radius); }
  .empty { padding: 22px 24px; max-width: 62ch; }
  .empty p { margin: 0 0 14px; font-size: 13px; line-height: 1.65; }
  .path { color: var(--text-2); font-size: 12px; }
</style>
