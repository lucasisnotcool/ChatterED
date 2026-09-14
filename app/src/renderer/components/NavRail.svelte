<script lang="ts">
  /** Left nav rail (product-design.md §B0). Collapses to 56px icons during a session. */
  import type { RecentSession } from '../../shared/types.js';
  import { store } from '../lib/store.svelte.js';

  let { collapsed = false }: { collapsed?: boolean } = $props();

  const courses = $derived.by(() => {
    const out: { code: string; count: number }[] = [];
    for (const s of (store.boot?.recentSessions ?? []) as RecentSession[]) {
      const found = out.find((o) => o.code === s.moduleCode);
      if (found) found.count += 1;
      else out.push({ code: s.moduleCode, count: 1 });
    }
    return out;
  });

  const dot = (code: string): string => {
    const hues = ['#4F46E5', '#0F7B6C', '#B45309', '#7C3AED', '#56566B'];
    let h = 0;
    for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) % hues.length;
    return hues[h] ?? '#56566B';
  };
</script>

<nav class="rail" class:collapsed aria-label="Main">
  <div class="brand">{collapsed ? '◆' : '◆ ChatterED'}</div>

  <button
    type="button"
    class="item"
    class:active={store.screen === 'library'}
    onclick={() => (store.screen === 'room' ? store.leaveRoom() : (store.screen = 'library'))}
  >
    <span class="icon" aria-hidden="true">⌂</span>
    {#if !collapsed}<span>Library</span>{/if}
    <span class="sr-only">Library</span>
  </button>

  <span class="item off" title="Not in this build">
    <span class="icon" aria-hidden="true">▤</span>
    {#if !collapsed}<span>History</span>{/if}
  </span>
  <button
    type="button"
    class="item"
    class:active={store.screen === 'settings'}
    onclick={() => void store.openSettings()}
  >
    <span class="icon" aria-hidden="true">⚙</span>
    {#if !collapsed}<span>Settings</span>{/if}
    <span class="sr-only">Settings</span>
  </button>

  {#if !collapsed && courses.length > 0}
    <p class="head label-caps">Courses</p>
    {#each courses as c (c.code)}
      <div class="course">
        <span class="cdot" style="background: {dot(c.code)}" aria-hidden="true"></span>
        <span class="code">{c.code}</span>
        <span class="count">{c.count}</span>
      </div>
    {/each}
  {/if}
</nav>

<style>
  .rail {
    width: 168px;
    flex: none;
    background: var(--ground);
    border-right: 1px solid var(--hairline);
    padding: 14px 10px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    transition: width 180ms ease-out;
    overflow: hidden;
  }
  .rail.collapsed { width: 56px; }

  .brand { font-size: 12px; font-weight: 600; padding: 2px 8px 14px; color: var(--text); white-space: nowrap; }

  .item {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 6px 8px;
    border-radius: 6px;
    font-size: 12px;
    color: var(--text-2);
    white-space: nowrap;
  }
  .item:hover { background: #eeeef5; }
  .item.active { background: #eaeaf4; color: var(--text); font-weight: 500; }
  .item.off { color: var(--muted); cursor: default; }
  .item.off:hover { background: none; }
  .icon { width: 14px; text-align: center; }

  .head { margin: 18px 0 6px; padding: 0 8px; color: var(--muted); font-size: 10px; }
  .course { display: flex; align-items: center; gap: 8px; padding: 4px 8px; font-size: 12px; color: var(--text-2); }
  .cdot { width: 6px; height: 6px; border-radius: 50%; flex: none; }
  .code { flex: 1; }
  .count { color: var(--muted); font-size: 11px; }
</style>
