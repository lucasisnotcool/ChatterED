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
import type { DocEditStatus, NotesDocView, PageImage, Suggestion } from '../../shared/doc/types.js';
import { notesRepo, type NotesDocRecord, type NotesRepo } from '../db/repos/notes.js';
import { log } from '../log.js';
import { ensureNotes, ingestView, mapObjectiveBlocks } from './ingest.js';
import { clearPageImages, pageImageDir, storePageImages } from './pageimages.js';
import { pageGeometry } from '../vault/pagecache.js';

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
    return record ? view(repo, record) : null;
  });

  handle<{ fileId: string; force?: boolean }>(IPC.notesIngest, async ({ fileId, force }) => {
    const { contentSha, pageCount } = await host.fileBytesKey(fileId);
    const file = host.vault.fileRow(fileId);
    const backend = host.backend();

    if (force === true) {
      // A re-render may be at a different width; half a deck at the old one is worse than none.
      await clearPageImages(pageImageDir(host.userDataDir, contentSha));
    }

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

/** The document's title: the file's name without its extension, or a neutral fallback. */
export function titleFor(fileName: string | null): string {
  const base = (fileName ?? '').replace(/\.[^.]+$/, '').trim();
  return base.length > 0 ? base : 'Lecture notes';
}
