<script lang="ts">
  /**
   * A bench for the document surface: `NotesPane` on the right, and on the left the buttons that
   * fire the events the real system fires — an agent edit, a cursor, a question, a resolution, a
   * correction to the learner's own words.
   *
   * It applies events **straight into `store.doc.apply`**, exactly as `store.svelte.ts` does, so
   * what is being watched here is the real path and not a demo of it.
   */
  import { onMount } from 'svelte';
  import { store } from '../../../lib/store.svelte.js';
  import { bridge } from '../../../lib/bridge.js';
  import { MOCK_DOC_ID, MOCK_FILE_ID, mockBlockOnPage } from '../../../lib/mockNotes.js';
  import type { AgentDocOpBatch } from '../../../../shared/doc/types.js';
  import NotesPane from '../NotesPane.svelte';

  const ROOM = 'room_mock_1';
  const doc = store.doc;

  let seq = 0;
  let lastQuestionId = 'q_dev_0';
  let log = $state<string[]>([]);
  let ask = $state<{ blockId: string; quote: string } | null>(null);

  function note(line: string): void {
    log = [`${new Date().toLocaleTimeString()}  ${line}`, ...log].slice(0, 12);
  }

  onMount(() =>
    bridge().onEvent((e) => {
      doc.apply(e);
      // The chat store too, because the span highlights are drawn from `store.chat.spanThreads`
      // and a thread only reaches it on a `chat.thread` event.
      store.chat.apply(e);
    }),
  );

  /**
   * The mock bridge has no PDF bytes, so the figures and the carousel would draw nothing. Vite
   * serves anything under the workspace root through `/@fs/`, so the real demo deck can be
   * handed straight to the store — which is the only way to see whether §3's "pixels, not a
   * redraw" actually holds.
   */
  async function loadRealDeck(): Promise<void> {
    note('fetching the demo deck…');
    try {
      // Vite refuses `/@fs/` outside its root, so the harness is pointed at a plain static
      // server over `Academia/Sources` (`python3 -m http.server 5401` in that folder).
      const response = await fetch('http://localhost:5401/CS3249+Lecture+4.pdf');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await doc.attachSlides(new Uint8Array(await response.arrayBuffer()));
      note(`deck attached — ${doc.pageCount} pages`);
    } catch (error) {
      note(`deck: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Watch Ctrl+E without taking the wiring away from `NotesPane` (its assignment runs first).
  $effect(() => {
    const previous = doc.askAboutSpan;
    doc.askAboutSpan = (input) => {
      ask = input;
      note(`Ctrl+E → openSpanThread({ blockId: ${input.blockId}, quote: "${input.quote.slice(0, 40)}…" })`);
      previous?.(input);
    };
    return () => {
      doc.askAboutSpan = previous;
    };
  });

  function edit(batch: Omit<AgentDocOpBatch, 'editId'>): void {
    seq += 1;
    const editId = `edit_dev_${seq}`;
    doc.apply({ type: 'doc.cursor', roomId: ROOM, docId: MOCK_DOC_ID, author: batch.author, blockId: batch.focusBlockId, state: 'typing' });
    doc.apply({ type: 'doc.edit', roomId: ROOM, docId: MOCK_DOC_ID, batch: { ...batch, editId } });
    note(`doc.edit ${editId} — ${batch.author} · ${batch.cause}`);
  }

  function anchor(): string {
    return doc.caretBlockId() ?? mockBlockOnPage(4) ?? '';
  }

  function ellieAnswers(): void {
    edit({
      author: 'ellie',
      cause: 'answer_missing',
      focusBlockId: anchor(),
      why: 'You asked how a Wizard-of-Oz study differs from a paper prototype, and the notes did not say.',
      ops: [
        {
          op: 'insert_after',
          anchorBlockId: anchor(),
          blocks: [
            {
              kind: 'paragraph',
              text: 'A **Wizard of Oz** study puts a person behind the interface: the participant believes they are talking to a working system, while a researcher types the replies. It is the only way to test a conversational flow before the model behind it exists, and it is why $latency$ has to be simulated deliberately rather than left at human speed.',
              prov: { pages: [12, 13], reason: null },
            },
            {
              kind: 'bullets',
              items: [
                'The wizard follows a script, so two participants meet the same system.',
                'Latency is held at the value the real system would have.',
              ],
              prov: { pages: [13], reason: null },
            },
          ],
        },
      ],
    });
  }

  function maxAsks(): void {
    lastQuestionId = `q_dev_${seq + 1}`;
    edit({
      author: 'max',
      cause: 'q_block',
      focusBlockId: anchor(),
      why: 'Checking whether the difference between the two techniques has landed.',
      ops: [
        {
          op: 'insert_q',
          anchorBlockId: anchor(),
          questionId: lastQuestionId,
          objectiveId: null,
          text: 'In your own words: what can a Wizard-of-Oz study tell you that a paper prototype cannot?',
          prov: { pages: [12], reason: null },
        },
      ],
    });
  }

  function maxResolves(): void {
    edit({
      author: 'max',
      cause: 'q_resolved',
      focusBlockId: anchor(),
      why: 'Writing the correct version under the question.',
      ops: [
        {
          op: 'resolve_q',
          questionId: lastQuestionId,
          resolution: 'partly_yours',
          blocks: [
            {
              kind: 'paragraph',
              text: 'It tells you how the conversation *behaves in time* — turn-taking, repair, and what a two-second wait feels like — which a static prototype cannot show at all.',
              prov: { pages: [12], reason: null },
            },
          ],
        },
      ],
    });
  }

  function maxSuggests(): void {
    const mine = doc.learnerText()[0];
    if (!mine) {
      note('Type a sentence of your own into the document first — a suggestion needs learner text.');
      return;
    }
    const quote = mine.text.trim().split(/\s+/).slice(0, 6).join(' ');
    edit({
      author: 'max',
      cause: 'suggestion',
      focusBlockId: mine.blockId,
      why: 'Correcting the learner’s own sentence — the one place a suggestion arises naturally.',
      ops: [],
      suggestion: {
        blockId: mine.blockId,
        quote,
        replacement: 'the wizard supplies the replies',
        note: 'Close — but it is the wizard, not the model, that answers.',
        threadId: null,
      },
    });
  }

  function thinking(author: 'ellie' | 'max'): void {
    doc.apply({ type: 'doc.cursor', roomId: ROOM, docId: MOCK_DOC_ID, author, blockId: anchor(), state: 'thinking' });
    note(`doc.cursor ${author} thinking`);
  }

  function idle(): void {
    for (const author of ['ellie', 'max'] as const) {
      doc.apply({ type: 'doc.cursor', roomId: ROOM, docId: MOCK_DOC_ID, author, blockId: null, state: 'idle' });
    }
    note('cursors idle');
  }
</script>

<div class="bench">
  <aside class="rail">
    <h1>Notes surface</h1>
    <p class="hint">
      Mock bridge, fixture deck. Click into the document, then fire an event. Select a phrase and
      press ⌘E.
    </p>

    <div class="group">
      <button class="btn" onclick={ellieAnswers}>Ellie writes an answer</button>
      <button class="btn" onclick={maxAsks}>Max asks a question</button>
      <button class="btn" onclick={maxResolves}>Max resolves it</button>
      <button class="btn" onclick={maxSuggests}>Max corrects your sentence</button>
    </div>

    <div class="group">
      <button class="btn" onclick={() => thinking('ellie')}>Ellie is thinking</button>
      <button class="btn" onclick={() => thinking('max')}>Max is thinking</button>
      <button class="btn" onclick={idle}>Cursors away</button>
    </div>

    <div class="group">
      <button class="btn" onclick={() => doc.scrollToBlock(mockBlockOnPage(20) ?? '')}>Jump to a later block</button>
      <button class="btn" onclick={() => doc.openSlide(12, { x0: 0.08, y0: 0.2, x1: 0.92, y1: 0.7 })}>
        Open slide 12 with a region
      </button>
      <button class="btn" onclick={() => void loadRealDeck()}>Attach the real deck</button>
    </div>

    <dl class="facts">
      <dt>status</dt><dd>{doc.ingest.status}</dd>
      <dt>version</dt><dd>{doc.version}</dd>
      <dt>edits</dt><dd>{doc.edits.length}</dd>
      <dt>suggestions</dt><dd>{doc.suggestions.length}</dd>
      <dt>frozen</dt><dd>{doc.frozen}</dd>
      <dt>caret</dt><dd>{doc.caretBlockId() ?? '—'}</dd>
      <dt>spans</dt><dd>{(doc.spanThreads?.() ?? []).length}</dd>
      <dt>mine</dt><dd>{doc.learnerText().length}</dd>
    </dl>

    {#if ask}
      <p class="hint">Last ⌘E: <code>{ask.quote}</code></p>
    {/if}

    <ul class="log">
      {#each log as line, i (i)}<li>{line}</li>{/each}
    </ul>
  </aside>

  <main class="stage">
    <NotesPane fileId={MOCK_FILE_ID} />
  </main>
</div>

<style>
  .bench {
    display: grid;
    grid-template-columns: 268px 1fr;
    height: 100vh;
  }
  .rail {
    border-right: 1px solid var(--hairline);
    background: var(--pane);
    padding: 16px;
    overflow: auto;
  }
  h1 {
    font-size: 13px;
    margin: 0 0 6px;
  }
  .hint {
    font-size: 11px;
    color: var(--muted);
    margin: 0 0 14px;
    line-height: 1.5;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 14px;
  }
  .group :global(.btn) {
    text-align: left;
    font-size: 11.5px;
    padding: 6px 10px;
  }
  .facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 10px;
    font-size: 11px;
    margin: 0 0 12px;
    color: var(--text-2);
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .log {
    list-style: none;
    padding: 0;
    margin: 0;
    font-size: 10.5px;
    color: var(--muted);
    line-height: 1.5;
  }
  .stage {
    min-width: 0;
    overflow: hidden;
  }
</style>
