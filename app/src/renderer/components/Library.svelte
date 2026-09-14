<script lang="ts">
  /**
   * The launcher (product-design.md §B1), revamped into a vault browser (issue #22).
   *
   * §B1 L169 calls this screen "a *launcher*, not a content manager", and issue #22 knowingly
   * moves that line: the learner now browses, searches and reads their own files here. The
   * launcher's two load-bearing rules survive intact, and they are the ones that carried a
   * design decision —
   *   - **no upload button exists anywhere: files arrive by being on disk** (§B1 L180);
   *   - **no agent appears here.** "Ellie and Max do not exist until a room is open" (§B1 L222).
   * What it drops is the "watched folders, one per module" shape of §B1 L179, because a student
   * keeps one notes tree and the modules are the folders inside it. That is recorded as a
   * deliberate departure in app/docs/STATUS.md.
   *
   * The launcher is handed to VaultBrowser as the thing to show when nothing is open, so the
   * sidebar, the search box and the ⌘K hint exist exactly once and never re-mount underneath a
   * learner who is mid-keystroke.
   */
  import Finder from './Finder.svelte';
  import TopicSheet from './TopicSheet.svelte';
  import VaultBrowser from './VaultBrowser.svelte';
  import { LEDGER_GLYPH, glyphAlt } from '../lib/labels.js';
  import { store } from '../lib/store.svelte.js';
  import { relative } from '../lib/time.js';

  const recents = $derived((store.boot?.recentSessions ?? []).slice(0, 3));
  const vault = $derived(store.vault);

  function openById(fileId: string): void {
    void store.openFile(fileId);
  }
</script>

{#snippet continueStrip()}
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
{/snippet}

{#snippet launcher()}
  <div class="screen">
    {@render continueStrip()}

    <p class="paste">
      <button type="button" class="btn-link" onclick={() => store.goSetup()}>Paste text instead →</button>
    </p>

    {#if vault}
      <h2 class="label-caps">{vault.displayName}</h2>
      <div class="list">
        <div class="empty">
          {#if vault.totalFiles === 0}
            <p>Nothing readable in this folder yet.</p>
            <p class="path">{vault.rootPath}</p>
          {:else}
            <p>
              {vault.totalFiles} files across {vault.topics.length}
              {vault.topics.length === 1 ? 'topic' : 'topics'}. Pick one on the left to read it, or
              search across all of them.
            </p>
            {#if vault.index.failed > 0}
              <p class="path">{vault.index.failed} couldn't be read for search — their rows say which.</p>
            {/if}
          {/if}
          <button type="button" class="btn-link" onclick={() => void store.chooseVault()}>Choose another folder…</button>
        </div>
      </div>
    {/if}
  </div>
{/snippet}

<div class="library">
  {#if vault?.rootPath}
    <VaultBrowser empty={launcher} />
  {:else}
    <div class="screen wide">
      <header class="top"><h1>Library</h1></header>

      {@render continueStrip()}

      <p class="paste">
        <button type="button" class="btn-link" onclick={() => store.goSetup()}>Paste text instead →</button>
      </p>

      <h2 class="label-caps">Your files</h2>
      <div class="list">
        <div class="empty">
          <p>
            Point ChatterED at the folder where your course material lives — the whole tree, not
            one module. It reads the files from disk; nothing is uploaded anywhere you didn't put
            it.
          </p>
          <p>You pick which folders inside it are topics, and the rest stays browsable under Other.</p>
          <button type="button" class="btn-primary" disabled={store.vaultBusy} onclick={() => void store.chooseVault()}>
            {store.vaultBusy ? 'Reading…' : 'Choose a folder…'}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

{#if store.finderOpen}
  <Finder onopen={openById} />
{/if}

{#if store.topicSheetOpen}
  <TopicSheet />
{/if}

<style>
  .library { flex: 1; display: flex; min-width: 0; min-height: 0; }
  .screen { flex: 1; overflow-y: auto; padding: 16px 24px 40px; min-width: 0; }
  .screen.wide { padding: 20px 28px 40px; }
  .top { display: flex; align-items: baseline; gap: 14px; margin-bottom: 18px; }
  h1 { margin: 0; font-size: 16px; font-weight: 600; }
  h2 { margin: 18px 0 10px; color: var(--muted); font-size: 10px; }

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
