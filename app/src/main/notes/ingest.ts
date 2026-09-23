/**
 * **The two-pass lecture-notes ingest** (#48, `docs/research/collab-doc.md` §2).
 *
 * A deck becomes an editable document that reads without the slides. Pass 1 (`extract.ts`) is
 * deterministic structure from pdf.js; pass 2 is this — a window of slides at a time, with the
 * slide images when the renderer has sent them, under `DRAFT_BLOCK_JSON_SCHEMA`, validated so
 * that a block with no provenance never reaches the document.
 *
 * ## What it deliberately is
 *
 *  - **Not on any path.** Fired and not awaited, on the CLI queue's background lane
 *    (`scope: 'notes'` — priority 2, deferred behind the grace window, pre-emptible).
 *  - **Not lost when it is pre-empted.** Unlike the concept ingest, a killed window is a slice
 *    of the learner's document, not a disposable draft, so a `CliPreemptedError` is **re-queued**
 *    and `ingest_state` is written after every window — an app quit mid-deck resumes rather than
 *    redoes. This is the one behavioural difference from `objectives/ingest.ts`, and it is why
 *    `notes` is on `CLI_PREEMPTIBLE` at all.
 *  - **Append-only.** A window only ever adds after the previous window's last block
 *    (`appendWindow`), so it can never collide with a learner already editing higher up. That is
 *    what lets the doc open after window 1 instead of after window nine.
 *  - **Not repeated.** Cached on `content_sha` + `NOTES_PROMPT_VERSION`. A document the learner
 *    has edited (`learner_touched`) is **never** re-ingested over without an explicit force —
 *    009's `segments_touched` rule, and §5.4's "nothing the learner writes is ever overwritten".
 *  - **Not trusted.** Everything the model returns goes through `validateDrafts`: a block with
 *    neither `pages` nor `reason` is rejected (§2 says so), a page the deck does not have is
 *    dropped, and the counts are logged so a prompt that keeps producing them is visible without
 *    a second run.
 *
 * A failure is a `failed` row with its reason and whatever windows had already landed — never a
 * throw into the UI.
 */
import { EditorState } from 'prosemirror-state';
import type { DocBlockDraft, NotesIngestStatus } from '../../shared/doc/types.js';
import type { DocRoomEvent } from '../../shared/docevents.js';
import { blocksForPages, docFromJson, emptyDoc, notesSchema } from '../../shared/doc/schema.js';
import { appendNodes, draftToNodes } from '../../shared/doc/ops.js';
import { DRAFT_BLOCK_JSON_SCHEMA, draftsToDocJson, validateDrafts } from '../../shared/doc/validate.js';
import type { LearningTree } from '../../shared/objectives.js';
import type { PageGeometry } from '../../shared/segment/types.js';
import type { LLMClient } from '../../room/llm/types.js';
import type { ModelPlan } from '../../room/llm/models.js';
import { matchFixtureDeck } from '../../room/llm/scripts.js';
import type {
  NotesDocRecord,
  NotesIngestState,
  NotesRepo,
  ObjectiveBlockRow,
} from '../db/repos/notes.js';
import { newDocId } from '../db/repos/notes.js';
import { log } from '../log.js';
import { extractNotesPages, type NotesPageExtract } from './extract.js';
import { critique1Notes, placeholderNotes } from './fixture.js';
import { countPageImages, pageImageDir, pageImagesFor } from './pageimages.js';
import { NOTES_PROMPT_VERSION, NOTES_SYSTEM, draftWords, outlineLines, windowMessage, windowWordBudget } from './prompts.js';
import { inWindow, planWindows, type PageWindow } from './windows.js';

export { NOTES_PROMPT_VERSION };

/**
 * How many times one window is retried after a learner took the lane back.
 *
 * Generous, because every one of these is "the learner asked something" and not a fault: a
 * learner working through a deck while it ingests can take the lane several times in a row, and
 * the right answer is for the window to keep waiting. When even this runs out the row is left
 * `streaming` with its state on it, so the next open resumes rather than losing the deck.
 */
export const WINDOW_PREEMPT_RETRIES = 6;

/** How long a re-queued window waits before asking for the lane again. */
export const WINDOW_REQUEUE_MS = 2_000;

/** One genuine (non-pre-emption) failure per window is a race; two is a fault. */
export const WINDOW_ERROR_RETRIES = 1;

/**
 * The ceiling on one window's answer. Generous against the word budget on purpose: the JSON, the
 * provenance and the figure rects are most of the tokens, and a truncated window is a lost one.
 */
export const WINDOW_MAX_TOKENS = 16_000;

export interface NotesIngestDeps {
  repo: NotesRepo;
  /** Null in scripted mode and whenever the resolved backend cannot ingest. */
  llm: LLMClient | null;
  models: ModelPlan;
  mode: 'scripted' | 'live';
  /** `app.getPath('userData')` — the page images live under it. */
  userDataDir: string;
  /** The one main→renderer stream. */
  emit(event: DocRoomEvent): void;
  /** One pdf.js pass per deck (`vault/pagecache.ts`). */
  geometry(input: { filePath: string; contentSha: string }): Promise<PageGeometry[]>;
  /**
   * Fire the objective ingest. Called **after window 1**, never before: the objective tree is
   * the progress bar's data and nobody is waiting for it, while the learner is waiting for the
   * document (architect §D2 (d)).
   */
  ensureObjectives(fileId: string): void;
  objectivesTree(fileId: string): LearningTree | null;
  now?: () => string;
}

export interface NotesIngestInput {
  fileId: string;
  contentSha: string;
  pageCount: number;
  /** The deck's title, as the flow names it. */
  title: string;
  /** Absolute path to the PDF — pass 1 only; the renderer never sees it. */
  filePath: string;
  /** For `matchFixtureDeck` in scripted mode. */
  fileName: string | null;
  /** Null until the learner has asked something: the ingest runs before any room exists. */
  roomId: string | null;
}

/** Decks with an ingest in flight. Module level: one app, one database, one CLI lane. */
const inFlight = new Map<string, Promise<void>>();

/** Tests and the live-run harness: the run started by `ensureNotes`, to await. */
export function ingestInFlight(contentSha: string): Promise<void> | undefined {
  return inFlight.get(contentSha);
}

/** True when the stored doc is this deck's, under this prompt, and finished. */
export function notesAreCurrent(doc: NotesDocRecord | null, contentSha: string): boolean {
  if (!doc) return false;
  return (
    doc.contentSha === contentSha &&
    doc.ingestVersion === NOTES_PROMPT_VERSION &&
    doc.ingestStatus === 'ready'
  );
}

/**
 * Ingest this deck if it needs it. Resolves **as soon as the row exists** — the windows arrive as
 * `notes.window` and `notes.status` events, which is §2's "the doc opens as soon as the first
 * window lands".
 */
export async function ensureNotes(
  deps: NotesIngestDeps,
  input: NotesIngestInput,
  opts: { force?: boolean } = {},
): Promise<NotesDocRecord> {
  const now = deps.now ?? (() => new Date().toISOString());
  const existing = deps.repo.byContentSha(input.contentSha);

  if (!opts.force) {
    if (notesAreCurrent(existing, input.contentSha)) return existing!;
    /**
     * **The learner's edits win over a better prompt.** A document they have written in is never
     * re-ingested over: `NOTES_PROMPT_VERSION` moving is not a reason to throw their words away,
     * and remaining windows on a resumed run still only append.
     */
    if (existing?.learnerTouched) return existing;
    const running = inFlight.get(input.contentSha);
    if (running && existing) return existing;
  }

  // ── no live backend: a document, not an error ──
  if (deps.mode !== 'live' || !deps.llm || deps.llm.kind === 'scripted') {
    return writeFixture(deps, input, existing, now());
  }

  const images = await countPageImages(pageImageDir(deps.userDataDir, input.contentSha));
  const withImages = images > 0;

  // Resumable: the plan on the row is the plan, so a resume produces the same windows as the
  // run it is resuming even if `planWindows` is tuned in between.
  const resumable =
    !opts.force &&
    existing !== null &&
    existing.ingestVersion === NOTES_PROMPT_VERSION &&
    existing.ingestState !== null &&
    existing.ingestState.done > 0 &&
    existing.ingestState.done < existing.ingestState.windows.length &&
    existing.doc !== null;

  let record: NotesDocRecord;
  if (resumable) {
    record = deps.repo.setIngest(
      existing!.id,
      { status: 'streaming', error: null, withImages, model: deps.models.orchestrator },
      now(),
    )!;
    log().info('notes.ingest.resume', {
      file_id: input.fileId,
      doc_id: record.id,
      windows_done: record.ingestState?.done ?? 0,
      windows_total: record.ingestState?.windows.length ?? 0,
    });
  } else if (existing) {
    record = deps.repo.resetForIngest(
      {
        docId: existing.id,
        doc: emptyDoc(input.title).toJSON(),
        title: input.title,
        pageCount: input.pageCount,
        fileId: input.fileId,
        ingestVersion: NOTES_PROMPT_VERSION,
        // An estimate, corrected the moment pass 1 has run. It exists so the first status event
        // can say "1 of 6" rather than "1 of 0".
        windowsTotal: estimateWindows(input.pageCount),
        withImages,
        model: deps.models.orchestrator,
      },
      now(),
    );
  } else {
    record = deps.repo.create(
      {
        id: newDocId(),
        contentSha: input.contentSha,
        fileId: input.fileId,
        title: input.title,
        pageCount: input.pageCount,
        doc: emptyDoc(input.title).toJSON(),
        ingestStatus: 'pending',
        ingestVersion: NOTES_PROMPT_VERSION,
        windowsTotal: estimateWindows(input.pageCount),
        withImages,
        model: deps.models.orchestrator,
      },
      now(),
    );
  }

  emitStatus(deps, input, record);

  const run = runIngest(deps, input, record.id).finally(() => inFlight.delete(input.contentSha));
  inFlight.set(input.contentSha, run);
  // Deliberately not awaited, and its rejection is swallowed here because `runIngest` writes
  // every failure onto the row: an unhandled rejection would be the same information twice, once
  // where nobody can act on it.
  void run.catch(() => undefined);
  return record;
}

/** The window count `planWindows` will produce for a deck of this many pages. */
function estimateWindows(pageCount: number): number {
  return planWindows(Array.from({ length: Math.max(0, pageCount) }, (_, i) => i + 1)).length;
}

/**
 * The whole run: pass 1, then one call per window, each landed on the document before the next
 * one is asked for.
 */
async function runIngest(deps: NotesIngestDeps, input: NotesIngestInput, docId: string): Promise<void> {
  const now = deps.now ?? (() => new Date().toISOString());
  const startedAt = Date.now();
  let record = deps.repo.byId(docId);
  if (!record) return;

  try {
    // ── pass 1 ──
    const geometry = await deps.geometry({ filePath: input.filePath, contentSha: input.contentSha });
    const pages = extractNotesPages(geometry);
    if (pages.length === 0) throw new Error('that PDF has no readable text layer');

    const state: NotesIngestState = record.ingestState ?? {
      windows: planWindows(pages.map((p) => p.page)),
      done: 0,
      lastBlockId: null,
      outlineSoFar: '',
    };
    if (state.windows.length === 0) throw new Error('that PDF produced no pages to read');

    record = deps.repo.setIngest(
      docId,
      { status: 'streaming', windowsTotal: state.windows.length, windowsDone: state.done, ingestState: state },
      now(),
    )!;
    emitStatus(deps, input, record);
    log().info('notes.ingest.start', {
      file_id: input.fileId,
      doc_id: docId,
      model: deps.models.orchestrator,
      pages: pages.length,
      windows: state.windows.length,
      resuming_from: state.done,
      with_images: record.withImages,
    });

    const imageDir = pageImageDir(deps.userDataDir, input.contentSha);
    let blocksTotal = 0;
    let rejectedTotal = 0;
    let figuresTotal = 0;

    for (let index = state.done; index < state.windows.length; index += 1) {
      const window = state.windows[index]!;
      const windowPages = inWindow(pages, window);
      const windowStartedAt = Date.now();

      const outcome = await askWindow(deps, input, {
        window,
        index,
        total: state.windows.length,
        pages: windowPages,
        outlineSoFar: state.outlineSoFar,
        imageDir,
      });

      if (outcome.kind === 'preempted_out') {
        // The learner kept the lane. Everything landed so far is on the row with its state; the
        // next open resumes at this window rather than at the top of the deck.
        log().warn('notes.ingest.yielded', { file_id: input.fileId, doc_id: docId, window: index });
        return;
      }
      if (outcome.kind === 'failed') throw outcome.error;

      const { blocks, issues, usage } = outcome;
      const rejected = issues.filter((i) => i.reason === 'no_provenance').length;
      blocksTotal += blocks.length;
      rejectedTotal += rejected;
      figuresTotal += blocks.filter((b) => b.kind === 'figure').length;

      // Words written against what the slides said and what the budget allowed: the ratio a prompt
      // change has to move, visible per window without re-measuring the database (2026-09-23).
      const slideWords = windowPages.reduce((n, p) => n + p.words, 0);
      log().info('notes.window', {
        file_id: input.fileId,
        doc_id: docId,
        window: index,
        pages: `${window.from}-${window.to}`,
        words: draftWords(blocks),
        slide_words: slideWords,
        budget_words: windowWordBudget(windowPages),
        ms: Date.now() - windowStartedAt,
        blocks: blocks.length,
        figures: blocks.filter((b) => b.kind === 'figure').length,
        rejected_no_provenance: rejected,
        rejected_bad_page: issues.filter((i) => i.reason === 'bad_page').length,
        rejected_empty: issues.filter((i) => i.reason === 'empty').length,
        rejected_unknown: issues.filter((i) => i.reason === 'unknown_kind').length,
        output_tokens: usage,
      });

      if (blocks.length === 0) {
        // One window that produced nothing is a gap in the notes, not a reason to throw away the
        // eight windows around it. The learner sees the gap; the log says which pages.
        log().warn('notes.window.empty', { file_id: input.fileId, doc_id: docId, window: index });
        state.done = index + 1;
        record = deps.repo.setIngest(docId, { windowsDone: state.done, ingestState: state }, now())!;
        emitStatus(deps, input, record);
        continue;
      }

      const afterBlockId = state.lastBlockId;
      const applied = applyWindow(record.doc, afterBlockId, blocks);
      state.done = index + 1;
      state.lastBlockId = applied.lastBlockId;
      state.outlineSoFar = [state.outlineSoFar, ...outlineLines(blocks)].filter((l) => l.length > 0).join('\n');

      record = deps.repo.appendWindow(
        { docId, doc: applied.doc, ingest: { windowsDone: state.done, ingestState: state } },
        now(),
      );

      deps.emit({
        type: 'notes.window',
        roomId: input.roomId,
        fileId: input.fileId,
        docId,
        afterBlockId,
        blocks,
        nodes: applied.nodes,
      });
      emitStatus(deps, input, record);

      /**
       * **After window 1, not before it.** The objective tree feeds the progress bar; the
       * document is what the learner is looking at. Firing it here also means the two ingests
       * are never the first two things on the CLI lane together.
       */
      if (index === 0) deps.ensureObjectives(input.fileId);
    }

    record = deps.repo.setIngest(docId, { status: 'ready', error: null, ingestState: state }, now())!;
    mapObjectiveBlocks(deps, input.fileId, record);
    emitStatus(deps, input, record);
    log().info('notes.ready', {
      file_id: input.fileId,
      doc_id: docId,
      ms: Date.now() - startedAt,
      windows: state.windows.length,
      blocks: blocksTotal,
      figures: figuresTotal,
      rejected_no_provenance: rejectedTotal,
      with_images: record.withImages,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const failed = deps.repo.setIngest(docId, { status: 'failed', error: reason }, now());
    if (failed) emitStatus(deps, input, failed);
    log().error('notes.ingest.failed', {
      file_id: input.fileId,
      doc_id: docId,
      ms: Date.now() - startedAt,
      cause: reason,
    });
  }
}

type WindowOutcome =
  | { kind: 'ok'; blocks: DocBlockDraft[]; issues: ReturnType<typeof validateDrafts>['issues']; usage: number }
  | { kind: 'preempted_out' }
  | { kind: 'failed'; error: Error };

/** One window: the call, its retries, and the validation. Never throws. */
async function askWindow(
  deps: NotesIngestDeps,
  input: NotesIngestInput,
  ask: {
    window: PageWindow;
    index: number;
    total: number;
    pages: NotesPageExtract[];
    outlineSoFar: string;
    imageDir: string;
  },
): Promise<WindowOutcome> {
  const tree = deps.objectivesTree(input.fileId);
  const objectives =
    tree?.status === 'ready' ? tree.objectives.map((o) => ({ id: o.id, title: o.title })) : undefined;
  const images = await pageImagesFor(ask.imageDir, ask.pages.map((p) => p.page));

  const message = windowMessage({
    title: input.title,
    window: ask.window,
    index: ask.index,
    total: ask.total,
    pages: ask.pages,
    outlineSoFar: ask.outlineSoFar,
    withImages: images.length > 0,
    objectives,
  });

  let preempted = 0;
  let errors = 0;
  for (;;) {
    try {
      const result = await deps.llm!.complete({
        // Sonnet, named as the orchestrator model rather than the fast lane: `ModelPlan.fast`
        // records the measurement (Haiku emits 2–4× the output tokens on a schema-bound call and
        // is *slower*), and the day `fast` drops to Haiku again this call must not follow it.
        model: deps.models.orchestrator,
        max_tokens: WINDOW_MAX_TOKENS,
        system: [{ type: 'text', text: NOTES_SYSTEM }],
        messages: [{ role: 'user', content: message }],
        jsonSchema: DRAFT_BLOCK_JSON_SCHEMA,
        ...(images.length > 0 ? { images } : {}),
        // `costScope: 'notes'` rather than `'ingest'`: it shares the background lane, but on a
        // 66-page deck it is by far the biggest per-file cost in the app and a learner asking
        // what a document cost them has to see it on its own line.
        meta: { scope: 'notes' as const, costScope: 'notes' as const, fileId: input.fileId },
      });
      const parsed = JSON.parse(extractJsonObject(result.text)) as unknown;
      const { blocks, issues } = validateDrafts(parsed, input.pageCount);
      return { kind: 'ok', blocks, issues, usage: result.usage.output_tokens };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      /**
       * **A pre-empted window is re-queued, not lost.** This is the whole difference between
       * this ingest and the concept one: there, a killed draft leaves the row where it started;
       * here it would leave a hole in the learner's document.
       */
      if (error.name === 'CliPreemptedError') {
        preempted += 1;
        if (preempted > WINDOW_PREEMPT_RETRIES) return { kind: 'preempted_out' };
        log().info('notes.window.requeued', {
          file_id: input.fileId,
          window: ask.index,
          attempt: preempted,
        });
        await new Promise((r) => setTimeout(r, WINDOW_REQUEUE_MS));
        continue;
      }
      if (error.name === 'LlmAbortedError') return { kind: 'failed', error };
      errors += 1;
      if (errors > WINDOW_ERROR_RETRIES) return { kind: 'failed', error };
      log().warn('notes.window.retry', {
        file_id: input.fileId,
        window: ask.index,
        cause: error.message,
      });
    }
  }
}

/**
 * Apply one window to the stored document. No view, no DOM — `prosemirror-state` in main.
 *
 * Returns the **nodes it inserted**, as JSON, so the `notes.window` event can carry them and the
 * open editor inserts the same blocks with the same ids (`ops.ts` `appendNodes` says why that is
 * the difference between a window landing once and landing twice).
 */
export function applyWindow(
  docJson: unknown,
  afterBlockId: string | null,
  blocks: readonly DocBlockDraft[],
): { doc: unknown; lastBlockId: string | null; nodes: unknown[] } {
  const state = EditorState.create({ schema: notesSchema, doc: docFromJson(docJson) });
  const inserted = draftToNodes(notesSchema, blocks, 'ingest', null);
  const tr = appendNodes(state, afterBlockId, inserted);
  // `appendNodes` always hands back a transaction; an empty one means it had nothing to add.
  if (tr.steps.length === 0) return { doc: docJson, lastBlockId: afterBlockId, nodes: [] };
  const next = state.apply(tr).doc;
  const last = next.lastChild;
  // `blockId` defaults to `''`, which means "not minted" — never a target for the next window.
  const lastBlockId = typeof last?.attrs.blockId === 'string' ? (last.attrs.blockId as string) : '';
  return {
    doc: next.toJSON(),
    lastBlockId: lastBlockId.length > 0 ? lastBlockId : null,
    nodes: inserted.map((node) => node.toJSON()),
  };
}

/**
 * Which blocks carry which objective (`notes_objective_blocks`).
 *
 * Page intersection, the primary mechanism: an objective's `refs[].page` against every block's
 * `pages`. It works whichever ingest finished first, and it is a cache of a pure function, so it
 * is replaced whole rather than diffed.
 */
export function mapObjectiveBlocks(
  deps: Pick<NotesIngestDeps, 'repo' | 'objectivesTree'>,
  fileId: string,
  record: NotesDocRecord,
): number {
  const tree = deps.objectivesTree(fileId);
  if (!tree || tree.status !== 'ready' || record.doc === null) return 0;
  let doc;
  try {
    doc = docFromJson(record.doc);
  } catch {
    return 0;
  }
  const rows: ObjectiveBlockRow[] = [];
  for (const objective of tree.objectives) {
    const pages = objective.refs.map((r) => r.page).filter((p): p is number => typeof p === 'number');
    if (pages.length === 0) continue;
    blocksForPages(doc, pages).forEach((blockId, ord) => {
      rows.push({ objectiveId: objective.id, blockId, ord });
    });
  }
  deps.repo.replaceObjectiveBlocks(record.id, rows);
  return rows.length;
}

/** The scripted backend's document: a canned set of notes, written once and marked `ready`. */
function writeFixture(
  deps: NotesIngestDeps,
  input: NotesIngestInput,
  existing: NotesDocRecord | null,
  now: string,
): NotesDocRecord {
  const fixture = matchFixtureDeck({ fileName: input.fileName, contentSha: input.contentSha });
  const blocks = fixture === 'critique1' ? critique1Notes() : placeholderNotes(input.title);
  const doc = draftsToDocJson(input.title, blocks);

  const record = existing
    ? deps.repo.resetForIngest(
        {
          docId: existing.id,
          doc,
          title: input.title,
          pageCount: input.pageCount,
          fileId: input.fileId,
          ingestVersion: NOTES_PROMPT_VERSION,
          windowsTotal: 1,
          withImages: false,
          model: 'fixture',
        },
        now,
      )
    : deps.repo.create(
        {
          id: newDocId(),
          contentSha: input.contentSha,
          fileId: input.fileId,
          title: input.title,
          pageCount: input.pageCount,
          doc,
          ingestStatus: 'pending',
          ingestVersion: NOTES_PROMPT_VERSION,
          windowsTotal: 1,
          withImages: false,
          model: 'fixture',
        },
        now,
      );

  const ready = deps.repo.setIngest(record.id, { status: 'ready', windowsDone: 1, error: null }, now)!;
  deps.emit({
    type: 'notes.window',
    roomId: input.roomId,
    fileId: input.fileId,
    docId: ready.id,
    afterBlockId: null,
    blocks,
  });
  emitStatus(deps, input, ready);
  log().info('notes.fixture', { file_id: input.fileId, doc_id: ready.id, fixture: fixture ?? 'placeholder' });
  return ready;
}

function emitStatus(deps: NotesIngestDeps, input: NotesIngestInput, record: NotesDocRecord): void {
  deps.emit({
    type: 'notes.status',
    roomId: input.roomId,
    fileId: input.fileId,
    docId: record.id,
    ingest: ingestView(record),
  });
}

/** The row's ingest half, as the renderer sees it. */
export function ingestView(record: NotesDocRecord): {
  status: NotesIngestStatus;
  windowsDone: number;
  windowsTotal: number;
  withImages: boolean;
  error: string | null;
} {
  return {
    status: record.ingestStatus,
    windowsDone: record.windowsDone,
    windowsTotal: record.windowsTotal,
    withImages: record.withImages,
    error: record.error,
  };
}

/**
 * The same unwrapper the decision, ledger and objective paths use: a model that wraps its object
 * in prose under a schema is a known shape, and it is not a reason to throw a window away.
 */
function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return trimmed;
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end <= start) return trimmed;
  return trimmed.slice(start, end + 1);
}
