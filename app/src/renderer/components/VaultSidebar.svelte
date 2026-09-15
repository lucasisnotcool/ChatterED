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
  const onOther = $derived(store.selectedTopic === 'other');

  function nodeCount(nodes: VaultTreeNode[]): number {
    let n = 0;
    for (const node of nodes) n += node.dir ? nodeCount(node.children) : 1;
    return n;
  }
</script>

<aside class="sidebar" aria-label="Vault">
  {#if vault?.rootPath}
    <!-- The header used to be one line: a name ellipsed to `OneDrive-NationalUnivers…` with no
         tooltip, and an 11 px `Topics…` link nobody could read as "this is how you choose what a
         topic is" (ui-review-ux.md M5, p3). Two lines: the vault, then what you can do to it —
         including changing it, which was previously only reachable from an empty-state card that
         disappeared the moment a file was open. -->
    <header class="head">
      <span class="root" title={vault.rootPath}>{vault.displayName}</span>
      <div class="rowacts">
        <button type="button" class="mini" onclick={() => void store.openTopicSheet()}>Edit topics</button>
        <span class="sep" aria-hidden="true">·</span>
        <button type="button" class="mini" disabled={store.vaultBusy} onclick={() => void store.chooseVault()}>
          Change vault…
        </button>
      </div>
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
    </nav>

    <!-- "Other" is the rest of the tree, not a topic. It sat in the same visual weight as the
         real ones and dominated the list at `Other 3940` (§p5), so it is pinned to the bottom of
         the topic list, under a hairline, muted, and closed until it is asked for. -->
    <div class="other">
      <button
        type="button"
        class="topic muted"
        class:active={onOther}
        aria-expanded={onOther}
        onclick={() => void store.selectTopic(onOther ? (vault.topics[0]?.id ?? 'other') : 'other')}
      >
        <span class="twist" aria-hidden="true">{onOther ? '⌄' : '›'}</span>
        <span class="name">Other</span>
        <span class="count">{vault.otherCount}</span>
      </button>
    </div>

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
        <FileTree nodes={store.vaultTree} depth={0} defaultOpen={!onOther} {onopen} />
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
    flex-direction: column;
    gap: 3px;
    padding: 12px 12px 8px;
  }
  .root {
    font-size: 12px;
    font-weight: 600;
    line-height: 1.35;
    /* Two lines before it ellipses, and the full path is always in the tooltip. */
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .rowacts { display: flex; align-items: baseline; gap: 5px; }
  .sep { color: var(--muted); font-size: 11px; }
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
  .other { padding: 4px 8px 6px; border-top: 1px solid var(--hairline); margin: 2px 0 0; }
  .topic.muted { color: var(--muted); }
  .topic.muted.active { color: var(--text-2); }
  .twist { width: 7px; font-size: 10px; color: var(--muted); flex: none; }
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
