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
 *  - **`NotesDocView` carries active edit controls and kept response links**: `edits` is
 *    status `applied`, `keptEdits` is status `kept`, and `suggestions` is status `open`.
 */
import type { IpcHandle, DocHost } from '../dochost.js';
import { IPC, type NotesUpdateOverviewResult } from '../../shared/ipc.js';
import type {
  DocEditStatus,
  NotesDocView,
  NotesRegenerateResult,
  OverviewMeta,
  PageImage,
  Suggestion,
} from '../../shared/doc/types.js';
import { isNotebookId, notebookContentKey } from '../../shared/notebook.js';
import { notesRepo, type NotesDocRecord, type NotesRepo } from '../db/repos/notes.js';
import { commentsRepo } from '../db/repos/comments.js';
import { log } from '../log.js';
import { docFromJson, learnerSpans } from '../../shared/doc/schema.js';
import { ensureNotes, ingestInFlight, ingestView, mapObjectiveBlocks, placeholderSuperseded } from './ingest.js';
import {
  ensureOverview,
  overviewInFlight,
  overviewPlaceholderSuperseded,
  readySources,
  setRecommendationStatus,
  updateOverview,
  type OverviewDeps,
} from './overviewingest.js';
import { clearPageImages, pageImageDir, storePageImages } from './pageimages.js';
import { pageGeometry } from '../vault/pagecache.js';
import { registerPageLinesIpc } from './pagelines.js';
import { registerPageTextsIpc } from './pagetexts.js';

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
    keptEdits: repo.edits(record.id, 'kept').map(({ roomId: _roomId, ...edit }) => ({
      ...edit,
      status: 'kept' as DocEditStatus,
    })),
    suggestions: repo.suggestions(record.id, 'open'),
    overview: record.overview,
  };
}

/**
 * **A notebook with no doc yet and nothing ready to write one from** (`notebooks.md` §2): status
 * `none`, and nothing created. The editor calls `notes:ingest` again when a source turns ready.
 */
function noneView(host: DocHost, notebookId: string): NotesDocView {
  const subject = host.notebooks.subject(notebookId);
  return {
    docId: '',
    fileId: notebookId,
    contentSha: notebookContentKey(notebookId),
    title: subject?.name ?? 'Notebook',
    pageCount: subject?.pageCount ?? 0,
    version: 0,
    doc: null,
    ingest: { status: 'none', windowsDone: 0, windowsTotal: 0, withImages: false, error: null },
    frozen: false,
    edits: [],
    suggestions: [],
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

  /** What the overview run is given (`overviewingest.ts`), for this notebook, now. */
  const overviewDeps = (notebookId: string, roomId: string | null): OverviewDeps => {
    const backend = host.backend();
    const subject = host.notebooks.subject(notebookId);
    const first = subject ? readySources(subject)[0] : undefined;
    return {
      repo,
      objectives: host.store.objectives,
      llm:
        backend.kind === 'scripted'
          ? null
          : host.llm(backend, { fileName: first?.name ?? null, contentSha: notebookContentKey(notebookId) }),
      models: backend.models,
      mode: backend.kind === 'scripted' ? 'scripted' : 'live',
      userDataDir: host.userDataDir,
      notebooks: host.notebooks,
      emit: (event) => host.emit(event),
      onTree: (tree) => host.emit({ type: 'objectives.tree', roomId, fileId: tree.fileId, tree }),
      geometry: (input) => pageGeometry(input),
    };
  };

  handle<{ fileId: string }>(IPC.notesGet, async ({ fileId }) => {
    if (isNotebookId(fileId)) {
      const record = repo.byContentSha(notebookContentKey(fileId));
      const subject = host.notebooks.subject(fileId);
      // The placeholder written without a model reads as "nothing yet" once there is one, so the
      // renderer takes its first-open path and `notes:ingest` writes the real overview.
      if (subject && overviewPlaceholderSuperseded(host, record, subject, host.backend().kind !== 'scripted')) return null;
      return record ? view(repo, record) : null;
    }
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
    if (isNotebookId(fileId)) {
      const roomId = await roomFor(fileId);
      const record = await ensureOverview(overviewDeps(fileId, roomId), { notebookId: fileId, roomId }, { force: force === true });
      return record ? view(repo, record) : noneView(host, fileId);
    }
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
    const notebook = isNotebookId(fileId);
    const contentSha = notebook ? notebookContentKey(fileId) : (await host.fileBytesKey(fileId)).contentSha;
    const record = repo.byContentSha(contentSha);
    if (ingestInFlight(contentSha) || overviewInFlight(contentSha)) {
      return { confirmed: false, refused: 'busy', view: record ? view(repo, record) : null };
    }

    const title =
      record?.title ??
      (notebook ? (host.notebooks.subject(fileId)?.name ?? 'Notebook') : titleFor(host.vault.fileRow(fileId)?.name ?? null));
    const learnerWords = record ? learnerWordsIn(record.doc) : 0;
    const agentEdits = record ? repo.edits(record.id, 'applied').length : 0;
    const lost: string[] = [];
    if (learnerWords > 0) lost.push(`the ${learnerWords} word${learnerWords === 1 ? '' : 's'} you wrote in them`);
    if (agentEdits > 0) lost.push(`${agentEdits} addition${agentEdits === 1 ? '' : 's'} from Ellie and Max`);
    const detail = [
      (notebook
        ? 'Ellie will rewrite the overview from the ticked sources. Everything in the current notes is replaced'
        : 'Ellie will rewrite these notes from the slides. Everything in the current notes is replaced') +
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
    // A notebook's images live under each source's own bytes (C1), shared with any other notebook
    // holding the same file; they are cleared the same way and the renderer re-sends them.
    for (const sha of notebook ? sourceShas(host, fileId) : [contentSha]) {
      await clearPageImages(pageImageDir(host.userDataDir, sha));
    }
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
      if (isNotebookId(fileId)) {
        const { stored, unplaced } = await storeNotebookPageImages(host, fileId, images);
        if (done) log().info('notes.pageimages.done', { file_id: fileId, stored, unplaced });
        return { stored };
      }
      const { contentSha } = await host.fileBytesKey(fileId);
      const { stored } = await storePageImages(pageImageDir(host.userDataDir, contentSha), images);
      if (done) log().info('notes.pageimages.done', { file_id: fileId, stored });
      return { stored };
    },
  );

  // `notes:pageLines`: the chip preview's and the figure hotspots' read of pass 1.
  registerPageLinesIpc(host, handle);
  // `notes:pageTexts`: every page's indexed text, for the slide strips' grouping.
  registerPageTextsIpc(host, handle);

  /**
   * **The learner's slide moves** (migration 025). The grouping itself is computed in the
   * renderer (`shared/doc/slidegroups.ts`); only a move the learner made is stored, and every set
   * returns the whole list so the renderer never has to merge.
   */
  handle<{ docId: string }>(IPC.notesSlideGroups, ({ docId }) => repo.slideOverrides(docId));

  /** The blocks' stored explain comments (migration 033): read here, written only by the importer. */
  handle<{ docId: string }>(IPC.notesComments, (input) =>
    typeof input?.docId === 'string' && input.docId ? commentsRepo(host.db).forDoc(input.docId) : [],
  );

  handle<{ docId: string; page: number; key: string | null; title: string }>(
    IPC.notesSetSlideGroup,
    ({ docId, page, key, title }) => {
      requireDoc(docId);
      if (key !== null && (typeof key !== 'string' || key === '')) throw new Error('A slide group needs a key.');
      repo.setSlideOverride({ docId, page, key, title: typeof title === 'string' ? title : '' }, new Date().toISOString());
      log().info('notes.slide_group', { doc_id: docId, page, key, reset: key === null });
      return repo.slideOverrides(docId);
    },
  );

  /**
   * **Update overview** (`notebooks.md` §2): the same call on the sources ticked now, with the
   * learner's text and their kept agent edits carried over. Runs in the background; the renderer
   * follows `notes.status` and re-reads the doc when it is `ready` again.
   */
  handle<{ fileId: string }>(IPC.notesUpdateOverview, async ({ fileId }): Promise<NotesUpdateOverviewResult> => {
    if (!isNotebookId(fileId)) return { started: false, reason: 'no_doc' };
    if (ingestInFlight(notebookContentKey(fileId))) return { started: false, reason: 'in_flight' };
    const roomId = await roomFor(fileId);
    return updateOverview(overviewDeps(fileId, roomId), { notebookId: fileId, roomId });
  });

  /** A section's recommended block was added or dismissed (§5.3). Null when the doc has no overview. */
  handle<{ fileId: string; docId: string; recommendationId: string; status: 'added' | 'dismissed' }>(
    IPC.notesSetRecommendation,
    ({ docId, recommendationId, status }): OverviewMeta | null => {
      if (status !== 'added' && status !== 'dismissed') throw new Error(`Unknown recommendation status: ${String(status)}`);
      const overview = setRecommendationStatus({ repo }, { docId, recommendationId, status });
      log().info('notes.recommendation', { doc_id: docId, recommendation_id: recommendationId, status, found: overview !== null });
      return overview;
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

/** The content shas of a notebook's PDF sources that have been read: where their images live. */
function sourceShas(host: DocHost, notebookId: string): string[] {
  const subject = host.notebooks.subject(notebookId);
  if (!subject) return [];
  const out = new Set<string>();
  for (const source of subject.sources) {
    if (source.pageCount < 1) continue;
    const sha = host.notebooks.locate(notebookId, source.pageBase + 1)?.contentSha;
    if (sha) out.add(sha);
  }
  return [...out];
}

/**
 * **Page images by notebook page** (contract C1). The renderer numbers them as the doc does; each
 * is stored under its source's bytes and its own page, so `<userData>/notes-pages/<sourceSha>/
 * p-<local>.jpg` is the same file a pre-024 open of that deck wrote, and a deck in two notebooks
 * is rendered once. A page in a gap, or of a source not read yet, is not placed.
 */
export async function storeNotebookPageImages(
  host: Pick<DocHost, 'notebooks' | 'userDataDir'>,
  notebookId: string,
  images: readonly PageImage[],
): Promise<{ stored: number; unplaced: number }> {
  const bySha = new Map<string, PageImage[]>();
  let unplaced = 0;
  for (const image of images) {
    const located = host.notebooks.locate(notebookId, image.page);
    if (!located?.contentSha) {
      unplaced += 1;
      continue;
    }
    const list = bySha.get(located.contentSha) ?? [];
    list.push({ ...image, page: located.localPage });
    bySha.set(located.contentSha, list);
  }
  let stored = 0;
  for (const [sha, list] of bySha) {
    stored += (await storePageImages(pageImageDir(host.userDataDir, sha), list)).stored;
  }
  return { stored, unplaced };
}
