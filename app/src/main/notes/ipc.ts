/**
 * **The notes document's IPC bodies** (#48). Track T1 owns this file; the lead placed the hook.
 *
 * Seven channels, and the shapes are in `shared/ipc.ts` — this is the body of each, and nothing
 * else: policy lives in `ingest.ts` and persistence in `db/repos/notes.ts`.
 *
 * Two rules the renderer depends on and that are enforced here rather than trusted:
 *
 *  - **`notes:get` never starts an ingest.** Opening a file, drawing the shell, restoring a tab:
 *    all of them read. The ingest is started by `notes:ingest`, which the renderer calls once,
 *    after it has sent the page images.
 *  - **`NotesDocView` shows only what wears chrome**: `edits` is status `applied` (the ones that
 *    still have their colour and a Remove · Keep control) and `suggestions` is status `open`.
 *    Everything else is history and is read from the log, not from the view.
 */
import type { IpcHandle, DocHost } from '../dochost.js';
import { IPC } from '../../shared/ipc.js';
import type { DocEditStatus, NotesDocView, NotesRegenerateResult, PageImage, Suggestion } from '../../shared/doc/types.js';
import { notesRepo, type NotesDocRecord, type NotesRepo } from '../db/repos/notes.js';
import { log } from '../log.js';
import { docFromJson, learnerSpans } from '../../shared/doc/schema.js';
import { ensureNotes, ingestInFlight, ingestView, mapObjectiveBlocks, placeholderSuperseded } from './ingest.js';
import { clearPageImages, pageImageDir, storePageImages } from './pageimages.js';
import { pageGeometry } from '../vault/pagecache.js';
import { registerPageLinesIpc } from './pagelines.js';

/** The document as the renderer sees it. */
function view(repo: NotesRepo, record: NotesDocRecord): NotesDocView {
  return {
    docId: record.id,
    fileId: record.fileId ?? '',
    contentSha: record.contentSha,
    title: record.title,
    pageCount: record.pageCount,
    version: record.version,
    doc: record.doc,
    ingest: ingestView(record),
    frozen: record.frozen,
    // Only the edits that still wear their colour, and only the suggestions still to be decided.
    edits: repo.edits(record.id, 'applied').map(({ roomId: _roomId, ...edit }) => ({
      ...edit,
      status: 'applied' as DocEditStatus,
    })),
    suggestions: repo.suggestions(record.id, 'open'),
    // Day 0: the overview track (N2) reads `overview_json` here.
    overview: null,
  };
}

export function registerNotesIpc(host: DocHost, handle: IpcHandle): void {
  const repo = notesRepo(host.db);

  /** The room for a file, when one exists. An ingest runs long before the first question. */
  const roomFor = async (fileId: string): Promise<string | null> =>
    (await host.roomForFile(fileId).catch(() => null))?.roomId ?? null;

  const requireDoc = (docId: string): NotesDocRecord => {
    const record = repo.byId(docId);
    if (!record) throw new Error('That document does not exist.');
    return record;
  };

  handle<{ fileId: string }>(IPC.notesGet, async ({ fileId }) => {
    const { contentSha } = await host.fileBytesKey(fileId);
    const record = repo.byContentSha(contentSha);
    /**
     * The placeholder written while no model was set up reads as "nothing yet" once one is
     * (release review P1-6), so the renderer takes its first-open path — page images, then
     * `notes:ingest` — and `ensureNotes` writes the real notes over it.
     */
    const live = host.backend().kind !== 'scripted';
    const fileName = host.vault.fileRow(fileId)?.name ?? null;
    if (placeholderSuperseded(record, { live, fileName, contentSha })) return null;
    return record ? view(repo, record) : null;
  });

  handle<{ fileId: string; force?: boolean }>(IPC.notesIngest, async ({ fileId, force }) => {
    const { contentSha, pageCount } = await host.fileBytesKey(fileId);
    const file = host.vault.fileRow(fileId);
    const backend = host.backend();

    // No page images are cleared here, even on `force`. The renderer sends them *before* this
    // call, so clearing here deleted the images it had just sent and every forced ingest ran
    // text-only (found 2026-09-23). A regenerate clears them in `notes:regenerate`, before the
    // renderer re-sends; a Retry overwrites them page by page (`p-<n>.<ext>`).
    const record = await ensureNotes(
      {
        repo,
        llm: backend.kind === 'scripted' ? null : host.llm(backend, { fileName: file?.name ?? null, contentSha }),
        models: backend.models,
        mode: backend.kind === 'scripted' ? 'scripted' : 'live',
        userDataDir: host.userDataDir,
        emit: (event) => host.emit(event),
        geometry: (input) => pageGeometry(input),
        ensureObjectives: (id) => host.ensureObjectives(id),
        objectivesTree: (id) => host.objectivesTree(id),
      },
      {
        fileId,
        contentSha,
        pageCount,
        title: titleFor(file?.name ?? null),
        filePath: host.vault.sourcePath(fileId),
        fileName: file?.name ?? null,
        roomId: await roomFor(fileId),
      },
      { force: force === true },
    );
    return view(repo, record);
  });

  /**
   * **Regenerate Notes** (2026-09-23): the confirm, and the clearing that has to happen before the
   * renderer re-sends the page images and calls `notes:ingest` with `force`.
   *
   * The confirm is asked **here**, not in the renderer, so the notes-pane button and the menu item
   * cannot differ and neither can skip it. It names what is lost — the learner's own words first,
   * because they are the one thing in the document nobody else can write again — and what is kept.
   * Refused while this deck is still being written: two runs appending to one document is not a
   * regenerate.
   */
  handle<{ fileId: string }>(IPC.notesRegenerate, async ({ fileId }): Promise<NotesRegenerateResult> => {
    const { contentSha } = await host.fileBytesKey(fileId);
    const record = repo.byContentSha(contentSha);
    if (ingestInFlight(contentSha)) {
      return { confirmed: false, refused: 'busy', view: record ? view(repo, record) : null };
    }

    const title = record?.title ?? titleFor(host.vault.fileRow(fileId)?.name ?? null);
    const learnerWords = record ? learnerWordsIn(record.doc) : 0;
    const agentEdits = record ? repo.edits(record.id, 'applied').length : 0;
    const lost: string[] = [];
    if (learnerWords > 0) lost.push(`the ${learnerWords} word${learnerWords === 1 ? '' : 's'} you wrote in them`);
    if (agentEdits > 0) lost.push(`${agentEdits} addition${agentEdits === 1 ? '' : 's'} from Ellie and Max`);
    const detail = [
      'Ellie will rewrite these notes from the slides. Everything in the current notes is replaced' +
        (lost.length > 0 ? `, including ${lost.join(' and ')}.` : '.'),
      'Your conversation and your progress are kept. Questions Max wrote into the notes go with them.',
      'This cannot be undone.',
    ].join('\n\n');

    const confirmed = await host.confirm({
      message: `Regenerate the notes for “${title}”?`,
      detail,
      confirmLabel: 'Regenerate Notes',
    });
    if (!confirmed) {
      log().info('notes.regenerate.cancelled', { file_id: fileId, learner_words: learnerWords });
      return { confirmed: false, refused: null, view: record ? view(repo, record) : null };
    }

    const cleared = record ? repo.clearForRegenerate(record.id) : { edits: 0, suggestions: 0 };
    // A re-render may be at a different width; half a deck at the old one is worse than none.
    await clearPageImages(pageImageDir(host.userDataDir, contentSha));
    log().info('notes.regenerate', {
      file_id: fileId,
      doc_id: record?.id ?? null,
      learner_words: learnerWords,
      edits_cleared: cleared.edits,
      suggestions_cleared: cleared.suggestions,
    });
    return { confirmed: true, refused: null, view: record ? view(repo, repo.byId(record.id) ?? record) : null };
  });

  /**
   * The renderer's page images, in batches, **before** the ingest. Main cannot rasterise a PDF,
   * so this is the only way the refine pass ever sees a slide.
   */
  handle<{ fileId: string; images: PageImage[]; done: boolean }>(
    IPC.notesPageImages,
    async ({ fileId, images, done }) => {
      const { contentSha } = await host.fileBytesKey(fileId);
      const { stored } = await storePageImages(pageImageDir(host.userDataDir, contentSha), images);
      if (done) log().info('notes.pageimages.done', { file_id: fileId, stored });
      return { stored };
    },
  );

  // `notes:pageLines`: the chip preview's and the figure hotspots' read of pass 1.
  registerPageLinesIpc(host, handle);

  handle<{ docId: string; baseVersion: number; doc: unknown; learnerTouched: boolean }>(
    IPC.notesSave,
    ({ docId, baseVersion, doc, learnerTouched }) => {
      const result = repo.save({ docId, baseVersion, doc, learnerTouched }, new Date().toISOString());
      if (!result.ok) return result;
      /**
       * The objective→block cache is a cache of a pure function over the document, so a save
       * that moved blocks makes it stale. Re-derived here rather than on read, because a lesson
       * card's Start must not wait for a page intersection over a 66-page document.
       */
      const record = repo.byId(docId);
      if (record) mapObjectiveBlocks({ repo, objectivesTree: (id) => host.objectivesTree(id) }, record.fileId ?? '', record);
      return result;
    },
  );

  handle<{ docId: string; frozen: boolean }>(IPC.notesFreeze, ({ docId, frozen }) => {
    requireDoc(docId);
    const now = repo.setFrozen(docId, frozen, new Date().toISOString());
    log().info('notes.freeze', { doc_id: docId, frozen: now });
    return { frozen: now };
  });

  /**
   * What became of an agent edit in the renderer. **The guard runs there**, where the editor is
   * — main cannot enforce §5.4 because a ProseMirror transaction happens where the view is — so
   * main records the outcome, and `rejected_guard` and `dropped_frozen` are outcomes, not bugs.
   */
  handle<{
    docId: string;
    editId: string;
    status: DocEditStatus;
    blockIds: string[];
    docVersion: number;
    suggestion?: Suggestion | null;
  }>(IPC.notesEditResolved, ({ docId, editId, status, blockIds, docVersion, suggestion }) => {
    repo.resolveEdit({ docId, editId, status, blockIds, docVersion }, new Date().toISOString());
    if (suggestion) repo.upsertSuggestion(suggestion);
    log().info('notes.edit.resolved', {
      doc_id: docId,
      edit_id: editId,
      status,
      blocks: blockIds.length,
      became_suggestion: suggestion ? suggestion.suggestionId : null,
    });
  });

  handle<{ docId: string; suggestionId: string; status: 'accepted' | 'rejected' }>(
    IPC.notesSuggestionResolved,
    ({ docId, suggestionId, status }) => {
      repo.resolveSuggestion({ docId, suggestionId, status }, new Date().toISOString());
      log().info('notes.suggestion.resolved', { doc_id: docId, suggestion_id: suggestionId, status });
    },
  );
}

/** The learner's own words in a stored document — what a regenerate would throw away. */
export function learnerWordsIn(docJson: unknown): number {
  if (docJson === null || docJson === undefined) return 0;
  try {
    return learnerSpans(docFromJson(docJson)).reduce(
      (n, span) => n + span.text.split(/\s+/).filter((w) => w.length > 0).length,
      0,
    );
  } catch {
    return 0;
  }
}

/** The document's title: the file's name without its extension, or a neutral fallback. */
export function titleFor(fileName: string | null): string {
  const base = (fileName ?? '').replace(/\.[^.]+$/, '').trim();
  return base.length > 0 ? base : 'Lecture notes';
}
