<script lang="ts">
  /**
   * **Insert ▸ Table / Diagram / Flashcards / Quiz / Infographic** (2026-10-01; notebooks §5.3):
   * ask Ellie for one of the five of the section the caret is in, placed after the block it is in.
   *
   * The header's control and the glue around `doc.generateBlock`: a five-item menu, then a
   * one-line prompt that is optional ("whatever fits best" when empty), then the call. The call
   * can take half a minute, and the block it makes arrives by itself as Ellie's edit, so on
   * success the control just closes. A refusal is said in plain words for a few seconds.
   *
   * It never inserts at a guess: until the learner has put the caret somewhere in the notes it
   * says so, rather than dropping Ellie's table under the title.
   */
  import { onDestroy, tick } from 'svelte';
  import type { DocStore, GenerateBlockOutcome } from '../../lib/docstore.svelte.js';
  import type { GeneratedBlockKind } from '../../../shared/doc/types.js';
  import { BLOCK_KINDS, blockKindLabel, declinedLine } from '../../lib/insertkinds.js';

  let { doc }: { doc: DocStore } = $props();

  type Kind = GeneratedBlockKind;
  type Phase = 'closed' | 'menu' | 'prompt' | 'busy';

  let phase = $state<Phase>('closed');
  let kind = $state<Kind>('table');
  let instruction = $state('');
  let note = $state<string | null>(null);
  let root = $state<HTMLElement | null>(null);
  let field = $state<HTMLInputElement | null>(null);
  let noteTimer: ReturnType<typeof setTimeout> | null = null;

  /** How long a refusal stays up. */
  const NOTE_MS = 4_500;

  const status = $derived(doc.ingest.status);
  /** The editor is on screen: the same condition the pane mounts it under. */
  const open = $derived(Boolean(doc.docId) && (status === 'streaming' || status === 'ready'));
  const usable = $derived(open && !doc.frozen);

  /** Why it did not happen, in the learner's words. */
  function line(reason: NonNullable<GenerateBlockOutcome['reason']>, what: Kind): string {
    switch (reason) {
      case 'frozen':
        return 'The notes are frozen, so Ellie cannot add to them.';
      case 'declined':
        return declinedLine(what);
      case 'in_flight':
        return 'Ellie is already drawing one.';
      case 'no_doc':
        return 'The notes are not ready yet.';
      case 'no_place':
        return 'Click where it should go first';
      default:
        return 'That did not work. Try again.';
    }
  }

  function say(text: string): void {
    note = text;
    if (noteTimer) clearTimeout(noteTimer);
    noteTimer = setTimeout(() => {
      note = null;
      noteTimer = null;
    }, NOTE_MS);
  }

  function toggleMenu(): void {
    if (phase === 'busy') return;
    note = null;
    phase = phase === 'closed' ? 'menu' : 'closed';
  }

  async function choose(next: Kind): Promise<void> {
    kind = next;
    if (!doc.insertTarget()) {
      phase = 'closed';
      say(line('no_place', next));
      return;
    }
    instruction = '';
    phase = 'prompt';
    await tick();
    field?.focus();
  }

  function cancel(): void {
    if (phase !== 'busy') phase = 'closed';
  }

  async function submit(): Promise<void> {
    if (phase !== 'prompt') return;
    const what = kind;
    phase = 'busy';
    let result: GenerateBlockOutcome;
    try {
      result = await doc.generateBlock(what, instruction);
    } catch {
      result = { inserted: false, editId: null, reason: 'failed' };
    }
    phase = 'closed';
    if (!result.inserted) say(line(result.reason ?? 'failed', what));
  }

  function onkeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  }

  /** A press anywhere else closes the menu or the prompt, as Escape does. */
  $effect(() => {
    if (phase !== 'menu' && phase !== 'prompt') return;
    const away = (e: PointerEvent): void => {
      if (root && e.target instanceof Node && !root.contains(e.target)) cancel();
    };
    const escape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cancel();
    };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', escape);
    };
  });

  /** The notes going away or freezing mid-choice closes the choice; a call already out is left to land. */
  $effect(() => {
    if (!usable && (phase === 'menu' || phase === 'prompt')) phase = 'closed';
  });

  onDestroy(() => {
    if (noteTimer) clearTimeout(noteTimer);
  });

  /** A click on the control must not take the caret out of the notes: it is where the block goes. */
  const keepCursor = (e: MouseEvent): void => e.preventDefault();
</script>

<span class="ni" bind:this={root}>
  <button
    class="nd-toggle"
    type="button"
    aria-haspopup="menu"
    aria-expanded={phase === 'menu'}
    disabled={!usable || phase === 'busy'}
    title={!open
      ? 'The notes are not open yet.'
      : doc.frozen
        ? 'The notes are frozen, so Ellie cannot add to them.'
        : 'Ask Ellie for a table, diagram, flashcards, quiz or infographic of this section, after the block your cursor is in.'}
    onmousedown={keepCursor}
    onclick={toggleMenu}
  >
    {phase === 'busy' ? 'Ellie is writing…' : 'Insert'}
  </button>

  {#if phase === 'menu'}
    <span class="ni-pop ni-menu" role="menu">
      {#each BLOCK_KINDS as option (option)}
        <button type="button" role="menuitem" onmousedown={keepCursor} onclick={() => void choose(option)}>
          {blockKindLabel(option)}
        </button>
      {/each}
    </span>
  {:else if phase === 'prompt'}
    <span class="ni-pop ni-prompt" role="dialog" aria-label={`Insert ${blockKindLabel(kind).toLowerCase()}`}>
      <input
        bind:this={field}
        bind:value={instruction}
        type="text"
        placeholder="What should it show? (optional)"
        aria-label="What should it show? (optional)"
        {onkeydown}
      />
      <span class="ni-actions">
        <button type="button" class="ni-go" onclick={() => void submit()}>Insert</button>
        <button type="button" onclick={cancel}>Cancel</button>
      </span>
    </span>
  {/if}

  {#if note}
    <span class="ni-pop ni-note" role="status">{note}</span>
  {/if}
</span>

<style>
  .ni {
    position: relative;
    display: inline-flex;
    flex: none;
  }

  /* Hangs under the control, right-aligned so it never runs off the pane. */
  .ni-pop {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 20;
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    box-shadow: 0 6px 20px rgb(20 20 40 / 9%);
    font-size: 11.5px;
  }

  .ni-menu {
    display: flex;
    flex-direction: column;
    min-width: 140px;
    padding: 4px;
  }
  .ni-menu button {
    text-align: left;
    padding: 5px 10px;
    border-radius: 5px;
    color: var(--text);
  }
  .ni-menu button:hover,
  .ni-menu button:focus-visible { background: var(--indigo-tint); color: var(--indigo); }

  .ni-prompt {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 340px;
    max-width: 70vw;
    padding: 8px;
  }
  .ni-prompt input {
    flex: 1 1 auto;
    min-width: 0;
    font: inherit;
    color: var(--text);
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-radius: 6px;
    padding: 4px 8px;
    outline: none;
  }
  .ni-prompt input:focus { border-color: #c7c7e8; }
  .ni-actions { display: inline-flex; gap: 6px; flex: none; }
  .ni-actions button {
    border: 1px solid var(--hairline);
    border-radius: 6px;
    padding: 3px 10px;
    font-size: 11px;
    color: var(--text-2);
    background: var(--pane);
  }
  .ni-actions button:hover { border-color: #d4d4e2; color: var(--text); }
  .ni-actions .ni-go { border-color: var(--indigo); background: var(--indigo); color: #fff; }
  .ni-actions .ni-go:hover { background: #443cd0; color: #fff; }

  .ni-note {
    padding: 6px 10px;
    color: var(--text-2);
    white-space: nowrap;
  }
</style>
