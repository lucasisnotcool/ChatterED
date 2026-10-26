<script lang="ts">
  /**
   * **The map of the notes**, shown over the notes while they scroll.
   *
   * An outline of the open file's notes by idea — its headings — with each entry marked by how
   * far the learner has got on the objectives that section covers. The progress bar says *how
   * much* of the lecture is theirs; this says *where* the rest of it is, and a click goes there.
   * It generates nothing: the headings are the document's and the fills are the ledger's, and
   * `lib/notesmap.ts` does the arithmetic.
   *
   * **It reads the rendered document, not the editor.** The live document is the `EditorView`'s
   * and the store keeps it private on purpose, so this component watches the DOM ProseMirror
   * draws — every schema block carries `data-block-id` and `data-pages` — the way the shell's
   * own `jump` already falls back on `[data-block-id]`. That needs no plumbing in the editor and
   * is live by construction: an ingest window, an agent's edit and a retitled heading all arrive
   * as mutations. What it cannot see is a block drawn by a node view (a slide figure, a math
   * block), which has no `data-*`; a section's pages are therefore those of its text.
   *
   * The marker is the bar's own segment — empty, half, full, in the same indigo — so the two
   * read as one instrument. A section no objective covers has no marker at all.
   */
  import { untrack } from 'svelte';
  import {
    currentEntry,
    entryDepths,
    entryLabel,
    headingLevel,
    mapEntries,
    pagesFromAttr,
    sameBlocks,
    type MapBlock,
  } from '../../lib/notesmap.js';
  import { layout } from '../../lib/layoutstore.svelte.js';
  import { store } from '../../lib/store.svelte.js';

  let {
    root,
    onjump,
  }: {
    /** The document column. Stable for the life of the shell; the editor comes and goes in it. */
    root: HTMLElement | null;
    /** The shell's `jump`: the same scroll a lesson card's Start uses. */
    onjump: (blockId: string) => void;
  } = $props();

  /**
   * Where a heading counts as "being read": the upper part of the scrolling pane, down to just past
   * its middle and never less than this far from the top. The middle, because the shell's `jump`
   * centres the heading it scrolls to, and a click on an entry must mark that entry.
   */
  const READING_LINE_PX = 96;
  const READING_LINE_SHARE = 0.55;
  /** Typing is a burst of mutations; one reading per this long is enough for an outline. */
  const READ_DELAY_MS = 120;

  // `$state.raw`: replaced whole, never mutated, and only when the reading actually differs.
  let blocks = $state.raw<MapBlock[]>([]);
  let current = $state<string | null>(null);
  let visible = $state(false);
  let hovering = $state(false);

  const entries = $derived(mapEntries(blocks, store.progress.view));
  const depths = $derived(entryDepths(entries));
  const open = $derived(layout.mapOpen);

  function headings(host: HTMLElement): HTMLElement[] {
    return [...host.querySelectorAll<HTMLElement>('.nd-editor .ProseMirror :is(h1, h2, h3)[data-block-id]')];
  }

  /**
   * A heading's own words. The chrome ProseMirror hangs inside a block — the provenance chip,
   * Remove · Keep, an agent's cursor — is a widget in the same element, and `textContent` alone
   * put "p. 11" in front of every title on the map.
   */
  function ownText(el: HTMLElement): string {
    if (!el.querySelector('.ProseMirror-widget')) return el.textContent ?? '';
    const copy = el.cloneNode(true) as HTMLElement;
    for (const widget of copy.querySelectorAll('.ProseMirror-widget')) widget.remove();
    return copy.textContent ?? '';
  }

  function read(host: HTMLElement): void {
    const next: MapBlock[] = [];
    for (const el of host.querySelectorAll<HTMLElement>('.nd-editor .ProseMirror [data-block-id]')) {
      const level = headingLevel(el.tagName);
      next.push({
        blockId: el.dataset.blockId ?? '',
        level,
        // Only a heading's text is on the map, so only a heading's text can change it.
        text: level === null ? '' : ownText(el),
        pages: pagesFromAttr(el.dataset.pages),
      });
    }
    if (!sameBlocks(blocks, next)) blocks = next;
    locate(host);
  }

  function locate(host: HTMLElement): void {
    const pane = host.querySelector<HTMLElement>('.nd-scroll') ?? host;
    const line = pane.getBoundingClientRect().top + Math.max(READING_LINE_PX, pane.clientHeight * READING_LINE_SHARE);
    const tops = headings(host).map((el) => ({
      blockId: el.dataset.blockId ?? '',
      top: el.getBoundingClientRect().top,
    }));
    current = currentEntry(tops, line);
  }

  $effect(() => {
    const host = root;
    if (!host) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    let frame = 0;
    // Throttled, not debounced: an agent typing an edit in is one long burst, and a reading that
    // waited for silence would hold the map still until the last character.
    const schedule = (): void => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        read(host);
      }, READ_DELAY_MS);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(host, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['data-block-id', 'data-pages'],
    });

    // `scroll` does not bubble, so it is caught on the way down; one measurement per frame.
    const onscroll = (): void => {
      visible = true;
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => { if (!hovering) visible = false; }, 1500);
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        locate(host);
      });
    };
    host.addEventListener('scroll', onscroll, { capture: true, passive: true });

    // Untracked: `read` compares against `blocks`, and an effect that depended on what it
    // writes would take the observer down and put it back on every change to the outline.
    untrack(() => read(host));

    return () => {
      observer.disconnect();
      host.removeEventListener('scroll', onscroll, { capture: true });
      if (timer) clearTimeout(timer);
      if (hideTimer) clearTimeout(hideTimer);
      if (frame) cancelAnimationFrame(frame);
    };
  });
</script>

<!-- No notes document, or one with no heading in it yet: no map. It grows as the ingest writes. -->
{#if store.doc.docId && entries.length > 0}
  <section class="map" class:visible aria-label="Map of the notes" inert={!visible} onpointerenter={() => { hovering = true; }} onpointerleave={() => { hovering = false; visible = false; }} onfocusin={() => { hovering = true; }} onfocusout={() => { hovering = false; visible = false; }}>
    <button
      type="button"
      class="head"
      aria-expanded={open}
      aria-controls="notes-map-list"
      onclick={() => layout.setMapOpen(!open)}
    >
      <span class="twist" aria-hidden="true">{open ? '⌄' : '›'}</span>
      <span class="label">Map of the notes</span>
      <span class="n">{entries.length}</span>
    </button>

    {#if open}
      <ul class="list" id="notes-map-list">
        <!-- Keyed by place, not by id: splitting a heading gives two blocks one id for a
             transaction, and a duplicate key is a thrown error rather than a row drawn twice. -->
        {#each entries as entry, i (i)}
          <li>
            <button
              type="button"
              class="entry"
              class:current={entry.blockId === current}
              style:padding-left={`${8 + depths[i]! * 12}px`}
              aria-label={entryLabel(entry)}
              aria-current={entry.blockId === current ? 'location' : undefined}
              title={entryLabel(entry)}
              onclick={() => onjump(entry.blockId)}
            >
              <span
                class="mark"
                class:none={entry.fill === 'none'}
                class:partial={entry.fill === 'partial'}
                class:complete={entry.fill === 'complete'}
                aria-hidden="true"
              ></span>
              <span class="title" class:top={depths[i] === 0}>{entry.title}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<style>
  /* Under the sources (`notebooks.md` §8): the map takes what it needs and scrolls inside what
     the panel gives it. The 46 % cap was for sharing the column with the file tree; the
     sources panel sizes it now (N5's SourcesPanel). */
  .map {
    flex: 0 1 auto;
    display: flex;
    flex-direction: column;
    min-height: 0;
    max-height: min(48vh, 420px);
    border: 1px solid var(--hairline);
    border-radius: 10px;
    background: var(--pane);
    box-shadow: 0 10px 28px rgb(20 20 40 / 12%);
    opacity: 0;
    visibility: hidden;
    transform: translateY(-5px);
    transition: opacity 160ms ease, transform 160ms ease, visibility 160ms ease;
  }
  .map.visible { opacity: 1; visibility: visible; transform: translateY(0); }

  .head {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 14px 6px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-2);
    text-align: left;
  }
  .head:hover { color: var(--indigo); }
  .twist { width: 7px; font-size: 10px; color: var(--muted); flex: none; }
  .label { flex: 1; }
  .n { color: var(--muted); font-weight: 400; font-variant-numeric: tabular-nums; }

  .list { list-style: none; margin: 0; padding: 0 6px 8px; overflow-y: auto; min-height: 0; }

  .entry {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    padding: 4px 8px;
    border-radius: 6px;
    font-size: 12px;
    line-height: 1.35;
    color: var(--text-2);
    text-align: left;
  }
  .entry:hover { background: #eeeef5; }
  /* Where the learner is reading: the file panel's own "active" row. */
  .entry.current { background: #eaeaf4; color: var(--text); }

  /* The bar's segment, turned into a marker: a fill, not a tint, so a half reads as a half.
     Unmapped keeps the box's width and draws nothing, so the titles still line up. */
  .mark {
    flex: none;
    width: 9px;
    height: 7px;
    border-radius: 2px;
    background-repeat: no-repeat;
    transition: background-image 480ms ease-out;
  }
  .mark.none,
  .mark.partial,
  .mark.complete {
    background-color: var(--hairline);
    background-image: linear-gradient(to right, var(--indigo) 0%, var(--indigo) 0%, transparent 0%);
  }
  .mark.partial {
    background-image: linear-gradient(to right, var(--indigo) 0%, var(--indigo) 50%, transparent 50%);
  }
  .mark.complete {
    background-image: linear-gradient(to right, var(--indigo) 0%, var(--indigo) 100%, transparent 100%);
  }

  .title { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .title.top { font-weight: 500; }

  @media (prefers-reduced-motion: reduce) {
    .mark { transition: none; }
  }
</style>
