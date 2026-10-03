<script lang="ts">
  /**
   * **Where does this slide belong?** (2026-10-03.) While a slide thumbnail is being dragged out of
   * a section's strip (`pm/slidestrip.ts`), the notes give way to a list of their sections, titles
   * only, each one a place to drop it — a whole lecture's sections on one screen, so moving p. 41
   * from the introduction to *Reachable sets* is one drag rather than a scroll through the notes
   * with a slide held under the pointer.
   *
   * The grouping is code's guess (`shared/doc/slidegroups.ts`) and this is the learner's
   * correction of it: a drop is stored for the document (`DocStore.moveSlide`) and outlives every
   * regrouping after it. Letting go anywhere else, or Esc, changes nothing.
   */
  import type { SlideGroup } from '../../../shared/doc/slidegroups.js';
  import { SLIDE_DRAG_TYPE, pageRuns } from '../../lib/pm/slidestrip.js';
  import type { SlideSource } from '../../lib/rasterise.js';

  let {
    groups,
    page,
    from,
    source,
    top = 0,
    ondrop,
    oncancel,
  }: {
    groups: SlideGroup[];
    page: number;
    from: string;
    source: SlideSource | null;
    top?: number;
    ondrop: (key: string, title: string) => void;
    oncancel: () => void;
  } = $props();

  /** Every section, even one with no slides yet; Opening and Other slides are always offered. */
  const targets = $derived.by(() => {
    const list = groups.map((g) => ({ key: g.key, title: g.title, pages: g.pages }));
    if (!list.some((t) => t.key === 'opening')) list.unshift({ key: 'opening', title: 'Opening', pages: [] });
    if (!list.some((t) => t.key === 'other')) list.push({ key: 'other', title: 'Other slides', pages: [] });
    return list;
  });

  let over = $state<string | null>(null);
  let preview = $state<HTMLElement | null>(null);

  $effect(() => {
    const host = preview;
    if (!host || !source) return;
    void source.canvas(page, 240).then((rendered) => {
      if (!rendered || !host.isConnected) return;
      const copy = document.createElement('canvas');
      copy.width = 240;
      copy.height = Math.round((240 * rendered.height) / Math.max(1, rendered.width));
      copy.getContext('2d')?.drawImage(rendered, 0, 0, copy.width, copy.height);
      host.replaceChildren(copy);
    });
  });

  $effect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') oncancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function carries(event: DragEvent): boolean {
    return event.dataTransfer?.types.includes(SLIDE_DRAG_TYPE) ?? false;
  }

  function enter(event: DragEvent, key: string): void {
    if (!carries(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    over = key;
  }

  function drop(event: DragEvent, key: string, title: string): void {
    if (!carries(event)) return;
    event.preventDefault();
    over = null;
    if (key === from) {
      oncancel();
      return;
    }
    ondrop(key, title);
  }
</script>

<div class="nd-regroup" style:top={`${String(top)}px`} role="dialog" aria-label="Move this slide to a section">
  <div class="nd-regroup-head">
    <div class="nd-regroup-preview" bind:this={preview}></div>
    <div>
      <div class="nd-regroup-title">Move {source?.title(page) ?? `slide ${String(page)}`} to…</div>
      <p class="nd-regroup-hint">Drop it on the section it belongs to. Esc or letting go elsewhere leaves it where it is.</p>
    </div>
  </div>
  <ol class="nd-regroup-list">
    {#each targets as target (target.key)}
      <li
        class="nd-regroup-row"
        class:nd-regroup-over={over === target.key}
        class:nd-regroup-here={target.key === from}
        ondragenter={(e) => enter(e, target.key)}
        ondragover={(e) => enter(e, target.key)}
        ondragleave={() => {
          if (over === target.key) over = null;
        }}
        ondrop={(e) => drop(e, target.key, target.title)}
      >
        <span class="nd-regroup-name">{target.title}</span>
        <span class="nd-regroup-pages">
          {target.key === from ? 'here now · ' : ''}{target.pages.length > 0 ? pageRuns(target.pages) : 'no slides yet'}
        </span>
      </li>
    {/each}
  </ol>
</div>
