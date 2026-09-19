<script lang="ts">
  /**
   * **A stand-in for T4's editor**, and nothing more (#48).
   *
   * The contract has T4 export `components/notes/NotesPane.svelte`; the two tracks build in
   * parallel, and `ThreeColumn` mounts the real pane the moment that file exists. Until then the
   * middle column cannot be empty, because everything this track builds is *about* the document:
   * a lesson card's **Start** scrolls it, a span thread quotes it, an agent edit lands in it.
   *
   * So this reads the same `notes:*` channels, renders the document read-only, shows the windows
   * arriving and the agents' edits landing, and supports highlight + Ctrl+E — the one gesture
   * that crosses back into this track. It is **not** an editor: no ProseMirror, no typing, no
   * guard, no save. Every one of those is T4's, and this file is deleted when their pane lands.
   */
  import { untrack } from 'svelte';
  import type { DocBlockDraft, NotesDocView } from '../../../shared/doc/types.js';
  import type { RoomEvent } from '../../../shared/types.js';
  import { AGENT_HUE } from '../../lib/chatview.js';
  import { bridge } from '../../lib/bridge.js';
  import { store } from '../../lib/store.svelte.js';

  let { fileId }: { fileId: string } = $props();

  interface Line {
    blockId: string;
    kind: string;
    level: number;
    text: string;
    pages: number[];
    reason: string | null;
    author: string;
    /** Set on a Q block, and on the answer written under one. */
    tag: string | null;
  }

  let notes = $state<NotesDocView | null>(null);
  let lines = $state<Line[]>([]);
  let error = $state<string | null>(null);
  let ingesting = $state(false);
  let cursor = $state<{ author: string; blockId: string | null } | null>(null);

  let idSeq = 0;
  const nextId = (): string => `b_local${(idSeq += 1)}`;

  /** PM JSON → flat lines. Marks are read only for `author`, which is what the colour is. */
  function linesOf(json: unknown): Line[] {
    const doc = json as { content?: unknown[] };
    const out: Line[] = [];
    for (const raw of doc.content ?? []) {
      const node = raw as {
        type: string;
        attrs?: Record<string, unknown>;
        content?: unknown[];
      };
      const attrs = node.attrs ?? {};
      out.push({
        blockId: String(attrs.blockId ?? nextId()),
        kind: node.type,
        level: Number(attrs.level ?? 0),
        text: textOf(node),
        pages: Array.isArray(attrs.pages) ? (attrs.pages as number[]) : [],
        reason: (attrs.reason as string | null) ?? null,
        author: authorOf(node),
        tag: node.type === 'q_block' ? String(attrs.status ?? 'open') : null,
      });
    }
    return out;
  }

  function textOf(node: { type?: string; attrs?: Record<string, unknown>; content?: unknown[] }): string {
    if (node.type === 'text') return String((node as { text?: string }).text ?? '');
    if (node.type === 'slide_figure') return `[slide ${String(node.attrs?.page ?? '')}] ${String(node.attrs?.caption ?? '')}`;
    if (node.type === 'math_block') return String(node.attrs?.tex ?? '');
    const parts: string[] = [];
    for (const child of node.content ?? []) {
      const kid = child as { type?: string; content?: unknown[] };
      parts.push(textOf(kid));
      if (kid.type === 'list_item') parts.push('\n');
    }
    return parts.join('');
  }

  function authorOf(node: { content?: unknown[] }): string {
    for (const child of node.content ?? []) {
      const marks = (child as { marks?: { type: string; attrs?: Record<string, unknown> }[] }).marks ?? [];
      const author = marks.find((m) => m.type === 'author');
      if (author) return String(author.attrs?.by ?? 'ingest');
    }
    return 'ingest';
  }

  function draftLine(draft: DocBlockDraft, author: string, tag: string | null = null): Line {
    const text =
      draft.kind === 'bullets' || draft.kind === 'numbers'
        ? draft.items.join('\n')
        : draft.kind === 'figure'
          ? `[slide ${draft.page}] ${draft.caption}`
          : draft.kind === 'math'
            ? draft.tex
            : draft.kind === 'heading' || draft.kind === 'paragraph' || draft.kind === 'code'
              ? draft.text
              : '';
    return {
      blockId: nextId(),
      kind: draft.kind === 'heading' ? 'heading' : draft.kind === 'bullets' || draft.kind === 'numbers' ? 'bullet_list' : 'paragraph',
      level: draft.kind === 'heading' ? draft.level : 0,
      text,
      pages: draft.prov.pages,
      reason: draft.prov.reason,
      author,
      tag,
    };
  }

  function insertAfter(blockId: string | null, added: Line[]): void {
    const at = blockId ? lines.findIndex((l) => l.blockId === blockId) : -1;
    if (at < 0) lines = [...lines, ...added];
    else lines = [...lines.slice(0, at + 1), ...added, ...lines.slice(at + 1)];
  }

  async function load(): Promise<void> {
    error = null;
    const existing = await bridge()
      .notesGet({ fileId })
      .catch((e: unknown) => {
        error = e instanceof Error ? e.message : String(e);
        return null;
      });
    if (existing) {
      notes = existing;
      lines = linesOf(existing.doc);
      return;
    }
    if (error) return;
    // Never ingested. The real pane makes the same call; the doc opens on window 1.
    ingesting = true;
    const started = await bridge()
      .notesIngest({ fileId })
      .catch((e: unknown) => {
        error = e instanceof Error ? e.message : String(e);
        return null;
      });
    ingesting = false;
    if (!started) return;
    notes = started;
    lines = linesOf(started.doc);
  }

  $effect(() => {
    void fileId;
    untrack(() => {
      lines = [];
      notes = null;
      void load();
    });
  });

  /**
   * The document's own events. Subscribed directly rather than through a store, because the
   * store that owns them (`store.doc`) is T4's and this file is scaffolding that goes away.
   */
  $effect(() => {
    return bridge().onEvent((e: RoomEvent) => untrack(() => {
      if (e.type === 'notes.window') {
        insertAfter(e.afterBlockId, e.blocks.map((b) => draftLine(b, 'ingest')));
      } else if (e.type === 'notes.status') {
        notes = notes ? { ...notes, ingest: e.ingest } : notes;
      } else if (e.type === 'doc.cursor') {
        cursor = e.state === 'idle' ? null : { author: e.author, blockId: e.blockId };
      } else if (e.type === 'doc.edit') {
        for (const op of e.batch.ops) {
          if (op.op === 'insert_after' || op.op === 'insert_before') {
            insertAfter(op.anchorBlockId, op.blocks.map((b) => draftLine(b, e.batch.author)));
          } else if (op.op === 'insert_q') {
            insertAfter(op.anchorBlockId, [
              draftLine({ kind: 'paragraph', text: op.text, prov: op.prov }, e.batch.author, 'open'),
            ]);
          } else if (op.op === 'resolve_q') {
            insertAfter(null, op.blocks.map((b) => draftLine(b, e.batch.author, op.resolution)));
          }
        }
      }
    }));
  });

  /** Highlight + Ctrl+E — T4's keybinding, and the one gesture that crosses into this track. */
  function onkeydown(e: KeyboardEvent): void {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'e') return;
    const selection = window.getSelection();
    const quote = selection?.toString().trim() ?? '';
    if (quote.length === 0) return;
    const node = selection?.anchorNode;
    const el = (node instanceof Element ? node : node?.parentElement) ?? null;
    const blockId = el?.closest<HTMLElement>('[data-block-id]')?.dataset.blockId;
    if (!blockId) return;
    e.preventDefault();
    store.chat.openSpanThread({ blockId, quote });
  }
</script>

<svelte:window onkeydown={onkeydown} />

<div class="notes" aria-label="Lecture notes">
  <p class="scaffold">
    Read-only stand-in for the editor. Highlight a line and press <kbd>⌘E</kbd> to ask about it.
  </p>

  {#if error}
    <p class="error">The notes could not be opened: {error}</p>
  {:else if ingesting && lines.length === 0}
    <p class="marker">Ellie is reading the deck…</p>
  {/if}

  {#each lines as line (line.blockId)}
    <div
      class="block"
      class:ellie={line.author === 'ellie'}
      class:max={line.author === 'max'}
      data-block-id={line.blockId}
      style="--hue: {line.author === 'ellie' ? AGENT_HUE.ellie : line.author === 'max' ? AGENT_HUE.max : 'transparent'}"
    >
      {#if line.tag}
        <span class="qtag">{line.tag === 'open' ? 'Max asked' : line.tag.replace(/_/g, ' ')}</span>
      {/if}

      {#if line.kind === 'heading'}
        {#if line.level === 1}
          <h1>{line.text}</h1>
        {:else if line.level === 2}
          <h2>{line.text}</h2>
        {:else}
          <h3>{line.text}</h3>
        {/if}
      {:else if line.kind === 'bullet_list' || line.kind === 'ordered_list'}
        <ul>
          {#each line.text.split('\n').filter((t) => t.trim().length > 0) as item, i (i)}
            <li>{item}</li>
          {/each}
        </ul>
      {:else if line.kind === 'slide_figure'}
        <figure><span class="fig">{line.text}</span></figure>
      {:else}
        <p>{line.text}</p>
      {/if}

      <span class="prov" aria-hidden="true">
        {line.pages.length > 0 ? `p. ${line.pages.join(', ')}` : ''}
        {line.reason ? `added: ${line.reason}` : ''}
      </span>

      {#if cursor?.blockId === line.blockId}
        <span class="cursor" style="--hue: {cursor.author === 'ellie' ? AGENT_HUE.ellie : AGENT_HUE.max}">
          {cursor.author === 'ellie' ? 'Ellie' : 'Max'}
        </span>
      {/if}
    </div>
  {/each}

  {#if notes && notes.ingest.status === 'streaming'}
    <p class="marker">Ellie is still writing… ({notes.ingest.windowsDone} of {notes.ingest.windowsTotal})</p>
  {/if}
</div>

<style>
  .notes { max-width: 74ch; margin: 0 auto; padding: 16px 24px 80px; }

  .scaffold {
    margin: 0 0 18px;
    padding: 6px 10px;
    border: 1px dashed var(--hairline);
    border-radius: 6px;
    font-size: 11px;
    color: var(--muted);
  }
  kbd {
    font: inherit;
    font-size: 10.5px;
    border: 1px solid var(--hairline);
    border-radius: 3px;
    padding: 0 4px;
  }

  .block { position: relative; padding: 1px 0 1px 10px; border-left: 2px solid transparent; }
  .block.ellie, .block.max { border-left-color: var(--hue); background: color-mix(in srgb, var(--hue) 5%, transparent); }

  h1 { margin: 6px 0 12px; font-size: 20px; line-height: 1.3; }
  h2 { margin: 22px 0 8px; font-size: 15px; line-height: 1.35; }
  h3 { margin: 16px 0 6px; font-size: 13.5px; line-height: 1.4; }
  p { margin: 0 0 10px; font-size: 14px; line-height: 1.7; }
  ul { margin: 0 0 10px; padding-left: 20px; }
  li { font-size: 14px; line-height: 1.65; margin-bottom: 3px; }
  figure {
    margin: 12px 0;
    padding: 18px 12px;
    background: var(--ground);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
  }
  .fig { font-size: 12px; color: var(--muted); }

  .prov {
    position: absolute;
    right: 100%;
    top: 2px;
    margin-right: 10px;
    width: 120px;
    text-align: right;
    font-size: 10px;
    color: var(--muted);
    opacity: 0;
    transition: opacity 120ms ease-out;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .block:hover .prov { opacity: 1; }

  .qtag {
    display: inline-block;
    margin-bottom: 2px;
    font-size: 9.5px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--challenger);
  }

  .cursor {
    position: absolute;
    left: -2px;
    top: 0;
    padding: 0 4px;
    background: var(--hue);
    color: #fff;
    font-size: 9px;
    border-radius: 2px;
  }

  .marker { margin: 14px 0; font-size: 12px; color: var(--muted); font-style: italic; }
  .error { margin: 14px 0; font-size: 12.5px; color: #8a2708; }
</style>
