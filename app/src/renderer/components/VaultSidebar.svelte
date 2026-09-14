<script lang="ts">
  /**
   * The vault's topic list and file tree (issue #22 decision 2).
   *
   * NUSSync-shaped: a coloured dot, a name, a count badge. The dot is never the only cue — the
   * name is always beside it (product-design.md §C2 rule 1) — and its hue comes from
   * TOPIC_COLOURS, which deliberately avoids the three agent hues and indigo (rules 2 and 3).
   */
  import type { VaultFileView, VaultTreeNode } from '../../shared/types.js';
  import { store } from '../lib/store.svelte.js';
  import FileTree from './FileTree.svelte';

  let { onopen }: { onopen: (file: VaultFileView) => void } = $props();

  const vault = $derived(store.vault);
  const indexing = $derived(vault?.index.running === true && vault.index.done < vault.index.total);

  function nodeCount(nodes: VaultTreeNode[]): number {
    let n = 0;
    for (const node of nodes) n += node.dir ? nodeCount(node.children) : 1;
    return n;
  }
</script>

<aside class="sidebar" aria-label="Vault">
  {#if vault?.rootPath}
    <header class="head">
      <span class="root" title={vault.rootPath}>{vault.displayName}</span>
      <button type="button" class="mini" onclick={() => void store.openTopicSheet()}>Topics…</button>
    </header>

    <nav class="topics" aria-label="Topics">
      {#each vault.topics as t (t.id)}
        <button
          type="button"
          class="topic"
          class:active={store.selectedTopic === t.id}
          onclick={() => void store.selectTopic(t.id)}
        >
          <span class="dot" style="background: {t.colour}" aria-hidden="true"></span>
          <span class="name">{t.name}</span>
          <span class="count">{t.fileCount}</span>
        </button>
      {/each}
      <button
        type="button"
        class="topic"
        class:active={store.selectedTopic === 'other'}
        onclick={() => void store.selectTopic('other')}
      >
        <span class="dot hollow" aria-hidden="true"></span>
        <span class="name">Other</span>
        <span class="count">{vault.otherCount}</span>
      </button>
    </nav>

    {#if indexing}
      <!-- §B1 L212: beyond two seconds, a determinate strip under the course name. -->
      <div class="indexing">
        <div class="bar"><div class="fill" style="width: {(vault.index.done / Math.max(1, vault.index.total)) * 100}%"></div></div>
        <span class="line">Reading {vault.index.total} files… {vault.index.done} done</span>
      </div>
    {/if}

    <div class="tree" role="tree" aria-label="Files">
      {#if store.vaultTree.length === 0}
        <p class="none">Nothing here.</p>
      {:else}
        <FileTree nodes={store.vaultTree} depth={0} {onopen} />
      {/if}
    </div>

    <footer class="foot">
      <span class="n">{nodeCount(store.vaultTree)} files</span>
      <button type="button" class="mini" onclick={() => void store.rescanVault()} disabled={store.vaultBusy}>
        Re-scan
      </button>
    </footer>
  {:else}
    <div class="unset">
      <p>No vault yet.</p>
    </div>
  {/if}
</aside>

<style>
  .sidebar {
    width: 244px;
    flex: none;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--ground);
    border-right: 1px solid var(--hairline);
  }

  .head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 14px 12px 8px;
  }
  .root {
    flex: 1;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mini { font-size: 11px; color: var(--text-2); }
  .mini:hover { color: var(--indigo); }
  .mini:disabled { color: var(--muted); cursor: default; }

  .topics { display: flex; flex-direction: column; gap: 1px; padding: 0 8px 6px; }
  .topic {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 8px;
    border-radius: 6px;
    font-size: 12px;
    color: var(--text-2);
    text-align: left;
  }
  .topic:hover { background: #eeeef5; }
  .topic.active { background: #eaeaf4; color: var(--text); font-weight: 500; }
  .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
  .dot.hollow { border: 1px solid var(--muted); background: none; }
  .name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .count { color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }

  .indexing { padding: 4px 14px 8px; }
  .bar { height: 2px; background: var(--hairline); border-radius: 1px; overflow: hidden; }
  .fill { height: 100%; background: var(--glyph); transition: width 200ms linear; }
  .line { display: block; margin-top: 5px; font-size: 11px; color: var(--muted); }

  .tree { flex: 1; overflow-y: auto; padding: 4px 6px 10px; min-height: 0; }
  .none { margin: 8px 10px; font-size: 12px; color: var(--muted); }

  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 12px;
    border-top: 1px solid var(--hairline);
  }
  .n { font-size: 11px; color: var(--muted); }

  .unset { padding: 16px 12px; color: var(--muted); font-size: 12px; }
  .unset p { margin: 0; }
</style>
