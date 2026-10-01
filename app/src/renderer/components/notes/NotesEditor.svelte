<script lang="ts">
  /**
   * The ProseMirror host.
   *
   * **One `EditorView`, mounted once into a bare div, and Svelte never renders inside it.** That
   * is the whole contract of this component (architecture study §D8): PM owns its DOM subtree, so
   * there is no `{#each}` over content, no `{#key}` around it, and no reactive read that could
   * tear it down. The `$effect` below depends on exactly two things — the host element, and the
   * store's `epoch`, which is bumped only when a *different* document has been loaded.
   *
   * Everything the view reads from the store afterwards is read through `untrack`, because a
   * `$state` read during setup would make the effect depend on the store's edits and cursors and
   * rebuild the editor every time an agent moved.
   */
  import { untrack } from 'svelte';
  import { EditorState } from 'prosemirror-state';
  import { EditorView } from 'prosemirror-view';
  import { docFromJson } from '../../../shared/doc/schema.js';
  import type { DocStore } from '../../lib/docstore.svelte.js';
  import { authorship } from '../../lib/pm/authorship.js';
  import { chromePlugin, focusPlugin } from '../../lib/pm/chrome.js';
  import { nodeViews, submitAnswerAtSelection } from '../../lib/pm/nodeviews.js';
  import { revealPlugin } from '../../lib/pm/reveal.js';
  import { editorPlugins } from '../../lib/pm/setup.js';
  import { pageLinesFor } from '../../lib/pagelines.js';

  let {
    doc,
    onAskAboutFigure,
  }: {
    doc: DocStore;
    /** A figure label's "Ask Ellie about this". Wired in `NotesPane`, beside the other chat calls. */
    onAskAboutFigure?: (input: { blockId: string; quote: string; question: string }) => void;
  } = $props();

  /** One slide's text with its boxes, for the chip's preview and a figure's hotspots. */
  const pageLines = (page: number) => pageLinesFor(doc.fileId, page);

  let host = $state<HTMLDivElement | null>(null);
  let failure = $state<string | null>(null);

  $effect(() => {
    const element = host;
    // Read the epoch reactively: a new document means a new view.
    const epoch = doc.epoch;
    if (!element || epoch === 0) return;

    let view: EditorView | null = null;
    untrack(() => {
      const json = doc.docJson();
      if (json === null || json === undefined) return;
      try {
        const state = EditorState.create({
          doc: docFromJson(json),
          plugins: [
            authorship({ onLearnerEdit: (at) => doc.onLearnerEdit(at) }),
            revealPlugin(),
            chromePlugin(() => ({ ...doc.chromeContext(), reader: { slides: () => doc.slides(), pageLines } })),
            // The caret's block (its toolbar shows without a hover) and the note slots' placeholder.
            focusPlugin(),
            ...editorPlugins({
              onAskAboutSelection: () => doc.askAboutSelection(),
              onSaveNow: () => {
                void doc.saveNow();
                return true;
              },
              submitAnswer: submitAnswerAtSelection,
            }),
          ],
        });
        const created: EditorView = new EditorView(element, {
          state,
          nodeViews: nodeViews({
            slides: () => doc.slides(),
            onOpenSlide: (page, rect) => doc.openSlide(page, rect),
            onAnswerQuestion: (answer) => doc.answerQuestion(answer),
            pageLines,
            onAskAboutFigure: (input) => onAskAboutFigure?.(input),
          }),
          attributes: { spellcheck: 'true', 'aria-label': 'Lecture notes' },
          dispatchTransaction(tr) {
            created.updateState(created.state.apply(tr));
            doc.onTransaction(tr.docChanged);
          },
        });
        view = created;
        doc.attach(created);
        failure = null;
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
    });

    return () => {
      doc.detach();
      view?.destroy();
      view = null;
    };
  });
</script>

<div class="nd-editor" bind:this={host}></div>
{#if failure}
  <p class="nd-state-line">These notes could not be opened: {failure}</p>
{/if}
