<script lang="ts">
  /**
   * One level of the vault file tree, rendered recursively (issue #22 decision 2).
   *
   * A file that could not be read for search keeps its row and gets a muted warning glyph —
   * product-design.md §B1 L213: "The row stays; it does not disappear."
   */
  import type { VaultFileView, VaultTreeNode } from '../../shared/types.js';
  // Svelte 5 has no <svelte:self>; a component imports itself by name to recurse.
  import Self from './FileTree.svelte';
  import { KIND_GLYPH } from '../lib/labels.js';
  import { SvelteSet } from 'svelte/reactivity';
  import { store } from '../lib/store.svelte.js';

  let {
    nodes,
    depth,
    onopen,
    /**
     * Folders start open in a topic: a vault is browsed, not navigated, and one click to see a
     * week's slides is one click too many when the whole tree is twenty rows. **"Other" is the
     * exception** — it is the whole unpromoted remainder of the tree, thousands of files deep in
     * the developer's own vault, and opening all of it by default is what produced hundreds of
     * rows and a six-deep chain (ui-review-ux.md m5, p5).
     */
    defaultOpen = true,
  }: {
    nodes: VaultTreeNode[];
    depth: number;
    onopen: (file: VaultFileView) => void;
    defaultOpen?: boolean;
  } = $props();

  // Only the folders the learner has actually touched are remembered, in whichever direction
  // they moved them; everything else follows `defaultOpen`.
  const opened = new SvelteSet<string>();
  const closed = new SvelteSet<string>();

  function isOpen(relPath: string): boolean {
    if (opened.has(relPath)) return true;
    if (closed.has(relPath)) return false;
    return defaultOpen;
  }

  function toggle(relPath: string): void {
    if (isOpen(relPath)) {
      opened.delete(relPath);
      closed.add(relPath);
    } else {
      closed.delete(relPath);
      opened.add(relPath);
    }
  }
</script>

<ul class="level" role="group">
  {#each nodes as node (node.relPath)}
    <li>
      {#if node.dir}
        <button
          type="button"
          class="row dir"
          style="padding-left: {8 + depth * 12}px"
          aria-expanded={isOpen(node.relPath)}
          onclick={() => toggle(node.relPath)}
        >
          <span class="twist" aria-hidden="true">{isOpen(node.relPath) ? '⌄' : '›'}</span>
          <span class="label">{node.name}</span>
        </button>
        {#if isOpen(node.relPath)}
          <Self nodes={node.children} depth={depth + 1} {defaultOpen} {onopen} />
        {/if}
      {:else if node.file}
        <button
          type="button"
          class="row file"
          class:active={store.selectedFileId === node.file.id}
          style="padding-left: {8 + depth * 12}px"
          onclick={() => onopen(node.file!)}
        >
          <span class="glyph" aria-hidden="true">{KIND_GLYPH[node.file.kind]}</span>
          <span class="label">{node.name}</span>
          {#if node.file.indexError}
            <span class="warn" title={node.file.indexError} aria-label="Not searchable">!</span>
          {/if}
        </button>
      {/if}
    </li>
  {/each}
</ul>

<style>
  .level { list-style: none; margin: 0; padding: 0; }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 3px 8px;
    border-radius: 5px;
    font-size: 12px;
    color: var(--text-2);
    text-align: left;
  }
  .row:hover { background: #eeeef5; }
  .row.active { background: var(--indigo-tint); color: var(--text); }
  .twist { width: 10px; color: var(--muted); font-size: 10px; }
  .glyph { width: 12px; text-align: center; color: var(--muted); font-size: 11px; }
  .label { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dir .label { color: var(--text); }
  .warn {
    flex: none;
    width: 13px;
    height: 13px;
    line-height: 12px;
    text-align: center;
    border: 1px solid var(--muted);
    border-radius: 50%;
    color: var(--muted);
    font-size: 9px;
  }
</style>
