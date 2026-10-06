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
   *
   * **A second view** (`mirror`, the tutorial's Split): a second `EditorView` with its own state
   * over the same document, mounted into the element given, kept in lockstep with this one by
   * `pm/splitview.ts`. This view stays the store's and the document's; the second one renders the
   * same decorations and node views, and its edits, undo and redo are carried into this one.
   */
  import { untrack } from 'svelte';
  import { EditorState, Plugin, type Transaction } from 'prosemirror-state';
  import { EditorView } from 'prosemirror-view';
  import { Mark } from 'prosemirror-model';
  import { docFromJson, inlineFigures } from '../../../shared/doc/schema.js';
  import { unnestCopiedParts } from '../../../shared/doc/partref.js';
  import 'prosemirror-gapcursor/style/gapcursor.css';
  import type { DocStore } from '../../lib/docstore.svelte.js';
  import { authorship, learnerStoredMarks } from '../../lib/pm/authorship.js';
  import { bumpChrome, chromeKey, chromePlugin, focusPlugin } from '../../lib/pm/chrome.js';
  import { nodeViews, submitAnswerAtSelection } from '../../lib/pm/nodeviews.js';
  import { revealKey, revealPlugin } from '../../lib/pm/reveal.js';
  import { editorPlugins } from '../../lib/pm/setup.js';
  import { slideStripPlugin } from '../../lib/pm/slidestrip.js';
  import { MIRROR_TR, SplitLink, mirrorPlugins, type Relay } from '../../lib/pm/splitview.js';
  import { pageLinesFor } from '../../lib/pagelines.js';
  import { bumpTutorialChrome, tutorialChromeKey, type PracticeChipsContext, type TutorialChromeContext } from '../../lib/pm/tutorial.js';

  let {
    doc,
    onAskAboutFigure,
    tutorial,
    practice,
    label = 'Lecture notes',
    mirror = null,
  }: {
    doc: DocStore;
    /** A figure label's "Ask Ellie about this". Wired in `NotesPane`, beside the other chat calls. */
    onAskAboutFigure?: (input: { blockId: string; quote: string; question: string }) => void;
    /**
     * Given for a **tutorial's** document (`TutorialPane`): its parts' chrome, blanks and tick boxes
     * (`pm/tutorial.ts`). Such a document has no slide strips: its sections are the sheet's, not
     * the lecture's, and the slides they would gather are the lecture's.
     */
    tutorial?: () => TutorialChromeContext;
    /** Given for the **main notes**: the tutorial parts that practise each section (§7). */
    practice?: () => PracticeChipsContext;
    /** The editor's accessible name. */
    label?: string;
    /** Where to mount a second, independently scrolled view of this document (Split), or null. */
    mirror?: HTMLElement | null;
  } = $props();

  /** One slide's text with its boxes, for the chip's preview and a figure's hotspots. */
  const pageLines = (page: number) => pageLinesFor(doc.fileId, page);

  let host = $state<HTMLDivElement | null>(null);
  let failure = $state<string | null>(null);
  /** The mounted view, for the second view to follow. Raw: an `EditorView` is never proxied. */
  let primary = $state.raw<EditorView | null>(null);
  /** The second view's link, while there is one (`pm/splitview.ts`). Plain: nothing renders it. */
  let link: SplitLink | null = null;

  /**
   * The plugins both views draw with. The second view's lacks what has effects beyond drawing:
   * authorship (the stamp and the block-id minter, which run in this view and come back as
   * steps), the slide strips (never on a tutorial anyway) and, through `mirrorPlugins`, the
   * history.
   */
  function drawingPlugins(): Plugin[] {
    return [
      revealPlugin(),
      chromePlugin(() => ({ ...doc.chromeContext(), reader: { slides: () => doc.slides(), pageLines } })),
      // The caret's block (its toolbar shows without a hover) and the note slots' placeholder.
      focusPlugin(),
    ];
  }

  function keyPlugins(): Plugin[] {
    return editorPlugins({
      onAskAboutSelection: () => doc.askAboutSelection(),
      onSaveNow: () => {
        void doc.saveNow();
        return true;
      },
      submitAnswer: submitAnswerAtSelection,
      // The concept cards' folds are kept per document for the session (`pm/concept.ts`).
      docKey: () => doc.docId,
      // Opening a card's depth counts towards "Ready to check this?" (D2, 2026-10-06).
      onCardsOpened: (ids) => {
        for (const id of ids) doc.noteDepthOpened(id);
      },
      // A tutorial's part chrome (`pm/tutorial.ts`), or the main notes' practice rows.
      ...(tutorial ? { tutorial } : {}),
      ...(practice ? { practice } : {}),
    });
  }

  function views(): ReturnType<typeof nodeViews> {
    return nodeViews({
      slides: () => doc.slides(),
      onOpenSlide: (page, rect, anchor, afterBlockId) => doc.openSlide(page, rect, anchor, afterBlockId ?? null),
      onInsertSlide: (target, afterBlockId) => void doc.insertSlide(target.page, target.rect, afterBlockId),
      onOpenImage: (input) => doc.openImage(input),
      onAnswerQuestion: (answer) => doc.answerQuestion(answer),
      pageLines,
      onAskAboutFigure: (input) => onAskAboutFigure?.(input),
    });
  }

  /**
   * What of the primary's transactions the second view also needs: the chrome's redraws (the
   * store's cursors, edits and threads moved), the part chrome's (a part's record changed; not
   * the course-admin fold, which is each view's own) and a reveal's progress.
   */
  const relay: Relay = (from: Transaction, to: Transaction) => {
    let any = false;
    if (from.getMeta(chromeKey)) {
      bumpChrome(to);
      any = true;
    }
    if ((from.getMeta(tutorialChromeKey) as { bump?: boolean } | undefined)?.bump) {
      bumpTutorialChrome(to);
      any = true;
    }
    const revealing: unknown = from.getMeta(revealKey);
    if (revealing) {
      to.setMeta(revealKey, revealing);
      any = true;
    }
    return any;
  };

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
          // A figure saved as a block before 3 Oct is opened as an image in a line (`inlineFigures`).
          // Figures in line with text; a tutorial part copied as a second live part made a reference.
          doc: unnestCopiedParts(inlineFigures(docFromJson(json))),
          plugins: [
            authorship({ onLearnerEdit: (at) => doc.onLearnerEdit(at) }),
            ...drawingPlugins(),
            // Each section's slides, in a collapsed strip at the section's end (`slidestrip.ts`).
            // Not on a tutorial: its sections are the sheet's.
            ...(tutorial ? [] : [slideStripPlugin(() => doc.stripContext())]),
            ...keyPlugins(),
          ],
        });
        const created: EditorView = new EditorView(element, {
          state,
          nodeViews: views(),
          attributes: { spellcheck: 'true', 'aria-label': label },
          dispatchTransaction(tr) {
            const { state: next, transactions } = created.state.applyTransaction(tr);
            // The second view replays them after this update, in the order they were applied.
            const second = link;
            second?.queue(transactions);
            created.updateState(next);
            doc.onTransaction(tr.docChanged);
            second?.drain();
          },
        });
        view = created;
        doc.attach(created);
        primary = created;
        failure = null;
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
    });

    return () => {
      doc.detach();
      view?.destroy();
      view = null;
      primary = null;
    };
  });

  /**
   * **The second view** (Split): mounted while there is both an element for it and a view to
   * follow; rebuilt when the document is (a new `primary`), gone when the split closes.
   */
  $effect(() => {
    const element = mirror;
    const main = primary;
    if (!element || !main) return;

    let second: EditorView | null = null;
    let joined: SplitLink | null = null;
    untrack(() => {
      try {
        const state = EditorState.create({
          doc: main.state.doc,
          selection: main.state.selection,
          plugins: [
            // ⌘Z and the Edit menu's Undo in this view run on the primary's history.
            new Plugin({
              props: {
                handleDOMEvents: {
                  beforeinput(_view, event) {
                    const kind = event.inputType === 'historyUndo' ? 'undo' : event.inputType === 'historyRedo' ? 'redo' : null;
                    if (!kind) return false;
                    event.preventDefault();
                    joined?.history(kind);
                    return true;
                  },
                },
              },
              // The learner's author mark at an empty caret, as authorship pre-loads it in the
              // primary, so an IME composition here starts out theirs (`learnerStoredMarks`).
              appendTransaction(transactions, _old, next) {
                if (transactions.some((t) => t.getMeta(MIRROR_TR)) || !transactions.some((t) => t.selectionSet)) return null;
                if (!next.selection.empty) return null;
                const wanted = learnerStoredMarks(next);
                const have = next.storedMarks ?? next.selection.$from.marks();
                return Mark.sameSet(wanted, have) ? null : next.tr.setStoredMarks(wanted);
              },
            }),
            ...mirrorPlugins([...drawingPlugins(), ...keyPlugins()]),
          ],
        });
        const created: EditorView = new EditorView(element, {
          state,
          nodeViews: views(),
          attributes: { spellcheck: 'true', 'aria-label': `${label} (second view)` },
          dispatchTransaction(tr) {
            if (joined) joined.dispatchSecondary(tr);
            else created.updateState(created.state.apply(tr));
          },
        });
        // Capture: ahead of the editor's keymap and of a blank's own field, both of which would
        // otherwise run an undo on this view's (absent) history.
        created.dom.addEventListener('keydown', onUndoKey, true);
        second = created;
        joined = new SplitLink(main, created, relay);
        link = joined;
      } catch (error) {
        console.warn('[split] the second view could not be opened', error);
      }
    });

    function onUndoKey(event: KeyboardEvent): void {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      if ((event.target as Element | null)?.closest?.('math-field')) return;
      event.preventDefault();
      event.stopPropagation();
      joined?.history(key === 'y' || event.shiftKey ? 'redo' : 'undo');
    }

    return () => {
      joined?.close();
      if (link === joined) link = null;
      second?.dom.removeEventListener('keydown', onUndoKey, true);
      second?.destroy();
      second = null;
      joined = null;
    };
  });
</script>

<div class="nd-editor" bind:this={host}></div>
{#if failure}
  <p class="nd-state-line">These notes could not be opened: {failure}</p>
{/if}
