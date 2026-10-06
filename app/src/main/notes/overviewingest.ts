/**
 * **The learning overview's run: one call per notebook** (`docs/research/notebooks.md` §3.5, §2;
 * contract C2, C5, C6; #58).
 *
 * This replaces the per-window notes ingest for notebooks. A notebook's doc is keyed on its
 * content key (`nb:<id>`, contract C2), written from the ticked, ready sources' text
 * (`NotebookHost.deckText`, whose `[p. N]` markers are already notebook pages), with the page
 * images of the evidentiary pages when the renderer has sent them. One schema-bound call on
 * `models.orchestrator`, on the CLI's background, pre-emptible lane as the windows were; when the
 * sources are too long for one call (`deckText().truncated`), each source is first condensed in a
 * call of its own and the overview is written over the condensed text.
 *
 * ## The rules it keeps from the window ingest
 *
 *  - **Not on any path.** Fired, not awaited. `ensureOverview` resolves as soon as the row exists.
 *  - **Pre-emption is not failure.** A `CliPreemptedError` re-queues the call up to
 *    `WINDOW_PREEMPT_RETRIES` times; a genuine error is retried once (`WINDOW_ERROR_RETRIES`).
 *  - **Not repeated, and never over the learner's words.** Cached on the content key and
 *    `NOTES_PROMPT_VERSION`; a doc the learner has written in is not re-ingested without `force`.
 *  - **A legacy doc stays as it was.** A notebook whose doc is the #48 full notes (re-keyed by N1
 *    at boot; `overview_json` NULL, `ingest_version` below this one) is never re-ingested because
 *    the prompt version moved. The editor offers to turn it into an overview with Update overview.
 *
 * ## What is new
 *
 *  - **The editor is down while an overview is written** (status `pending`), because it lands
 *    whole rather than window by window. When it is `ready` the renderer re-reads the row.
 *  - **Update overview** (§2) runs the same call on the sources ticked now and rebuilds the doc
 *    around what the learner owns (`carry.ts`). A failed update leaves the doc exactly as it was,
 *    `ready`, with the reason in `error`.
 *  - **The objective tree comes from the same call** (C5), written here as the notebook's
 *    `LearningTree`, and the "By the end you can" list is drawn from it in tree order.
 */
import type { Node } from 'prosemirror-model';
import type { NotesIngestStatus, OverviewMeta } from '../../shared/doc/types.js';
import type { DocRoomEvent } from '../../shared/docevents.js';
import type { LearningTree } from '../../shared/objectives.js';
import type { PageGeometry } from '../../shared/segment/types.js';
import type { NotebookSourceView } from '../../shared/notebook.js';
import { notebookContentKey } from '../../shared/notebook.js';
import { docFromJson, emptyDoc, notesSchema } from '../../shared/doc/schema.js';
import type { LLMClient, LlmRequest } from '../../room/llm/types.js';
import type { ModelPlan } from '../../room/llm/models.js';
import { matchFixtureDeck } from '../../room/llm/scripts.js';
import type { NotebookHost, NotebookSubject } from '../dochost.js';
import type { NotesDocRecord, NotesRepo } from '../db/repos/notes.js';
import { newDocId } from '../db/repos/notes.js';
import type { ObjectivesRepo } from '../db/repos/objectives.js';
import { log } from '../log.js';
import { carryStates, notebookTreeRecord, objectivesFromOverview } from '../objectives/overviewtree.js';
import { carryOver } from './carry.js';
import { extractNotesPages } from './extract.js';
import { critique1OverviewRaw, placeholderOverviewRaw } from './fixture.js';
import { mapObjectiveBlocks, WINDOW_ERROR_RETRIES, WINDOW_PREEMPT_RETRIES, WINDOW_REQUEUE_MS } from './ingest.js';
import { countPageImages, pageImageDir, pageImagesFor, type StoredPageImage } from './pageimages.js';
import { NOTES_PROMPT_VERSION } from './prompts.js';
import {
  CARD_WORDS,
  CARDS_JSON_SCHEMA,
  CARDS_CONDENSE_MAX_TOKENS,
  CARDS_MAX_TOKENS,
  cardCondenseWords,
  CARDS_SYSTEM,
  cardBudget,
  cardsMessage,
  cardWords,
  figureRect,
  fitCards,
  hasCards,
  validateCards,
  type CardBudget,
  type CardRepairs,
  type CardWords,
} from './cards.js';
import type { Rect } from '../../shared/doc/types.js';
import {
  CONDENSE_SYSTEM,
  OVERVIEW_JSON_SCHEMA,
  OVERVIEW_MAX_OBJECTIVES,
  OVERVIEW_MIN_OBJECTIVES,
  overviewSectionRange,
  OVERVIEW_SYSTEM,
  condenseMessage,
  condenseWords,
  fitOverview,
  mintOverview,
  overviewMessage,
  overviewMeta,
  overviewPolicy,
  pageTextsOf,
  sourceWordsOf,
  validateOverview,
  type OverviewPolicy,
  type OverviewRepairs,
  type ValidOverview,
} from './overview.js';

/** The ceiling on the overview's answer. The JSON and the pages are most of it. */
export const OVERVIEW_MAX_TOKENS = 8_000;
/** The ceiling on one source's condensed outline. */
export const CONDENSE_MAX_TOKENS = 6_000;
/** The most of one source's text a condensing call is given, in characters. */
export const CONDENSE_INPUT_CHARS = 150_000;
/**
 * The most page images the overview call is given. The evidentiary pages of a long deck can be
 * thirty; the overview needs to *see* a handful of diagrams, not read them all, and every image is
 * input tokens on a call nobody is waiting for but the learner is paying for.
 */
export const OVERVIEW_MAX_IMAGES = 12;

export interface OverviewDeps {
  repo: NotesRepo;
  /** `host.store.objectives`: the notebook's tree is written here (C5). */
  objectives: ObjectivesRepo;
  /** Null in scripted mode and whenever the resolved backend cannot ingest. */
  llm: LLMClient | null;
  models: ModelPlan;
  mode: 'scripted' | 'live';
  userDataDir: string;
  notebooks: NotebookHost;
  emit(event: DocRoomEvent): void;
  /** A tree's status changed: the IPC layer tells the renderer (`objectives.tree`). */
  onTree?(tree: LearningTree): void;
  /** One pdf.js pass per source (`vault/pagecache.ts`), for which pages are evidentiary. */
  geometry(input: { filePath: string; contentSha: string }): Promise<PageGeometry[]>;
  now?: () => string;
  /** Tests: the wait before a pre-empted call asks for the lane again. */
  requeueMs?: number;
}

export interface OverviewInput {
  notebookId: string;
  /** Null until the learner has asked something. */
  roomId: string | null;
}

/** Content keys with an overview run in flight. One app, one database, one CLI lane. */
const inFlight = new Map<string, Promise<void>>();

/** The run started by `ensureOverview` / `updateOverview`, for tests and the harness to await. */
export function overviewInFlight(contentKey: string): Promise<void> | undefined {
  return inFlight.get(contentKey);
}

/** A live backend: not scripted, and a client to call. */
function isLive(deps: Pick<OverviewDeps, 'mode' | 'llm'>): boolean {
  return deps.mode === 'live' && deps.llm !== null && deps.llm.kind !== 'scripted';
}

/**
 * **A doc written before the overview existed** (#48's full notes), kept unchanged: its metadata
 * is NULL and it was written under an older prompt. A row this build created and has not finished
 * also has NULL metadata, but carries this build's version.
 */
export function isLegacyDoc(record: NotesDocRecord | null): boolean {
  return record !== null && record.overview === null && record.ingestVersion < NOTES_PROMPT_VERSION;
}

/** True when the stored doc is a finished overview under this prompt. */
export function overviewIsCurrent(record: NotesDocRecord | null): boolean {
  return (
    record !== null &&
    record.overview !== null &&
    record.ingestVersion === NOTES_PROMPT_VERSION &&
    record.ingestStatus === 'ready'
  );
}

/**
 * The ticked **lecture** sources whose text is in: the overview's context. A tutorial sheet is
 * not summarised into the overview and its solutions are never read (`tutorials.md` §1); a source
 * from before migration 028 has no role and is a lecture.
 */
export function readySources(subject: NotebookSubject): NotebookSourceView[] {
  return subject.sources.filter((s) => s.enabled && s.status === 'ready' && (s.role ?? 'lecture') === 'lecture');
}

/** What `deckText` is asked for by the overview: lecture sources only. */
const OVERVIEW_DECK = { roles: ['lecture'] as const };

/** Which scripted fixture this notebook is, judged by its first ready source. */
function fixtureFor(deps: Pick<OverviewDeps, 'notebooks'>, subject: NotebookSubject): 'critique1' | null {
  for (const source of readySources(subject)) {
    const located = deps.notebooks.locate(subject.id, source.pageBase + 1);
    const match = matchFixtureDeck({ fileName: source.name, contentSha: located?.contentSha ?? null });
    if (match === 'critique1') return 'critique1';
  }
  return null;
}

/**
 * The placeholder written while no model was set up, now that one is (release review P1-6, as
 * `placeholderSuperseded` for the window ingest): not current, so the next open writes the real
 * overview. Never over the learner's words, and never over the scripted demo's canned overview.
 */
export function overviewPlaceholderSuperseded(
  deps: Pick<OverviewDeps, 'notebooks'>,
  record: NotesDocRecord | null,
  subject: NotebookSubject,
  live: boolean,
): boolean {
  if (!record || !live) return false;
  if (record.model !== 'fixture' || record.learnerTouched) return false;
  return fixtureFor(deps, subject) !== 'critique1';
}

function emitStatus(deps: OverviewDeps, input: OverviewInput, record: NotesDocRecord): void {
  deps.emit({
    type: 'notes.status',
    roomId: input.roomId,
    fileId: input.notebookId,
    docId: record.id,
    ingest: {
      status: record.ingestStatus as NotesIngestStatus,
      windowsDone: record.windowsDone,
      windowsTotal: record.windowsTotal,
      withImages: record.withImages,
      error: record.error,
    },
  });
}

/**
 * Write this notebook's overview if it needs one. Resolves as soon as the row exists, or with null
 * when there is no doc and no ticked source is ready yet (nothing is created; the editor calls
 * again when a source becomes ready).
 */
export async function ensureOverview(
  deps: OverviewDeps,
  input: OverviewInput,
  opts: { force?: boolean } = {},
): Promise<NotesDocRecord | null> {
  const now = deps.now ?? (() => new Date().toISOString());
  const contentKey = notebookContentKey(input.notebookId);
  const existing = deps.repo.byContentSha(contentKey);
  const subject = deps.notebooks.subject(input.notebookId);
  if (!subject) return existing;

  const superseded = overviewPlaceholderSuperseded(deps, existing, subject, isLive(deps));
  if (superseded) log().info('notes.placeholder_superseded', { file_id: input.notebookId, doc_id: existing!.id });

  if (!opts.force && !superseded) {
    if (isLegacyDoc(existing)) return existing;
    if (overviewIsCurrent(existing)) return existing;
    // The learner's words win over a better prompt (009's `segments_touched` rule).
    if (existing?.learnerTouched) return existing;
  }
  if (inFlight.has(contentKey)) return existing;

  const sources = readySources(subject);
  if (sources.length === 0) {
    log().info('notes.overview.no_sources', { file_id: input.notebookId, doc_exists: existing !== null });
    return existing;
  }

  if (!isLive(deps)) return writeFixtureOverview(deps, input, subject, existing, now());

  const record = existing
    ? deps.repo.resetForIngest(
        {
          docId: existing.id,
          doc: emptyDoc(subject.name).toJSON(),
          title: subject.name,
          pageCount: subject.pageCount,
          fileId: input.notebookId,
          ingestVersion: NOTES_PROMPT_VERSION,
          windowsTotal: 1,
          withImages: false,
          model: deps.models.orchestrator,
        },
        now(),
      )
    : deps.repo.create(
        {
          id: newDocId(),
          contentSha: contentKey,
          fileId: input.notebookId,
          title: subject.name,
          pageCount: subject.pageCount,
          doc: emptyDoc(subject.name).toJSON(),
          ingestStatus: 'pending',
          ingestVersion: NOTES_PROMPT_VERSION,
          windowsTotal: 1,
          withImages: false,
          model: deps.models.orchestrator,
        },
        now(),
      );
  emitStatus(deps, input, record);
  start(contentKey, runOverview(deps, input, record.id, 'ingest'));
  return record;
}

export type UpdateOverviewRefusal = 'in_flight' | 'no_sources' | 'no_doc';

/**
 * **Update overview** (§2): the same call on the sources ticked now, then the doc rebuilt with
 * the learner's text and their kept agent edits carried over. Refused, with the reason, when a run
 * is already going, when nothing ticked is ready, or when there is no doc to update.
 */
export async function updateOverview(
  deps: OverviewDeps,
  input: OverviewInput,
): Promise<{ started: boolean; reason: UpdateOverviewRefusal | null }> {
  const now = deps.now ?? (() => new Date().toISOString());
  const contentKey = notebookContentKey(input.notebookId);
  const record = deps.repo.byContentSha(contentKey);
  if (!record) return { started: false, reason: 'no_doc' };
  if (inFlight.has(contentKey)) return { started: false, reason: 'in_flight' };
  const subject = deps.notebooks.subject(input.notebookId);
  if (!subject || readySources(subject).length === 0) return { started: false, reason: 'no_sources' };

  const pending = deps.repo.setIngest(
    record.id,
    { status: 'pending', windowsDone: 0, windowsTotal: 1, error: null },
    now(),
  )!;
  emitStatus(deps, input, pending);
  log().info('notes.overview.update', {
    file_id: input.notebookId,
    doc_id: record.id,
    legacy: record.overview === null,
    fingerprint_was: record.overview?.fingerprint ?? null,
    fingerprint_now: subject.fingerprint,
  });
  if (!isLive(deps)) {
    // The scripted backend answers at once, through the same landing as a live answer.
    start(contentKey, landFixture(deps, input, subject, record.id, 'update'));
    return { started: true, reason: null };
  }
  start(contentKey, runOverview(deps, input, record.id, 'update'));
  return { started: true, reason: null };
}

/** A recommendation was added (after `notesGenerateBlock` inserted it) or dismissed (§5.3). */
export function setRecommendationStatus(
  deps: Pick<OverviewDeps, 'repo' | 'now'>,
  input: { docId: string; recommendationId: string; status: 'added' | 'dismissed' },
): OverviewMeta | null {
  const record = deps.repo.byId(input.docId);
  if (!record?.overview) return null;
  const now = (deps.now ?? (() => new Date().toISOString()))();
  if (!record.overview.recommendations.some((r) => r.id === input.recommendationId)) return record.overview;
  const overview: OverviewMeta = {
    ...record.overview,
    recommendations: record.overview.recommendations.map((r) =>
      r.id === input.recommendationId ? { ...r, status: input.status } : r,
    ),
  };
  return deps.repo.setOverview(input.docId, overview, now)?.overview ?? null;
}

function start(contentKey: string, run: Promise<void>): void {
  const tracked = run.finally(() => inFlight.delete(contentKey));
  inFlight.set(contentKey, tracked);
  // Every failure is written onto the row; an unhandled rejection would say it twice.
  void tracked.catch(() => undefined);
}

// ── the run ───────────────────────────────────────────────────────────────────────────────────

type CallOutcome =
  | { kind: 'ok'; text: string; outputTokens: number }
  | { kind: 'preempted_out' }
  | { kind: 'failed'; error: Error };

/** One call with the window ingest's retry rules. Never throws. */
async function call(deps: OverviewDeps, request: LlmRequest, label: string, fileId: string): Promise<CallOutcome> {
  let preempted = 0;
  let errors = 0;
  for (;;) {
    try {
      const result = await deps.llm!.complete(request);
      return { kind: 'ok', text: result.text, outputTokens: result.usage.output_tokens };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (error.name === 'CliPreemptedError') {
        preempted += 1;
        if (preempted > WINDOW_PREEMPT_RETRIES) return { kind: 'preempted_out' };
        log().info('notes.overview.requeued', { file_id: fileId, call: label, attempt: preempted });
        await new Promise((r) => setTimeout(r, deps.requeueMs ?? WINDOW_REQUEUE_MS));
        continue;
      }
      if (error.name === 'LlmAbortedError') return { kind: 'failed', error };
      errors += 1;
      if (errors > WINDOW_ERROR_RETRIES) return { kind: 'failed', error };
      log().warn('notes.overview.retry', { file_id: fileId, call: label, cause: error.message });
    }
  }
}

class Yielded extends Error {
  constructor() {
    super('Ellie stopped writing the overview to answer you. Retry to finish it.');
    this.name = 'Yielded';
  }
}

async function runOverview(
  deps: OverviewDeps,
  input: OverviewInput,
  docId: string,
  mode: 'ingest' | 'update',
): Promise<void> {
  const now = deps.now ?? (() => new Date().toISOString());
  const startedAt = Date.now();
  try {
    const subject = deps.notebooks.subject(input.notebookId);
    if (!subject) throw new Error('that notebook no longer exists');
    const sources = readySources(subject);
    if (sources.length === 0) throw new Error('no ticked source is ready to read');

    const deck = deps.notebooks.deckText(input.notebookId, OVERVIEW_DECK);
    // §3.2, amended 2026-10-02: slides or prose, read off the text, and the budget from the body.
    const policy = overviewPolicy(deck.text);
    const sourceWords = policy.bodyWords;
    const budget = policy.budget;
    const steps = deck.truncated ? sources.length + 1 : 1;
    const asCards = policy.genre === 'slides';
    let done = 0;
    const progress = (): void => {
      const record = deps.repo.setIngest(docId, { status: 'pending', windowsDone: done, windowsTotal: steps }, now());
      if (record) emitStatus(deps, input, record);
    };
    progress();

    // ── §3.5: too long for one call ⟹ each source condensed on its own first ──
    let text = deck.text;
    if (deck.truncated) {
      const parts: string[] = [];
      for (const source of sources) {
        const own = sourceText(deps.notebooks, input.notebookId, source);
        // Cards keep the working (§11.2), so a condensed source keeps far more of it than a map needs.
        const words = asCards ? cardCondenseWords(sourceWordsOf(own)) : condenseWords(sourceWordsOf(own));
        const outcome = await call(
          deps,
          {
            model: deps.models.orchestrator,
            max_tokens: asCards ? CARDS_CONDENSE_MAX_TOKENS : CONDENSE_MAX_TOKENS,
            system: [{ type: 'text', text: CONDENSE_SYSTEM }],
            messages: [{ role: 'user', content: condenseMessage({ sourceName: source.name, text: own, words, keepWorking: asCards }) }],
            meta: { scope: 'notes', costScope: 'notes', fileId: input.notebookId },
          },
          `condense:${source.fileId}`,
          input.notebookId,
        );
        if (outcome.kind === 'preempted_out') throw new Yielded();
        if (outcome.kind === 'failed') throw outcome.error;
        parts.push(`=== SOURCE: ${source.name} ===\n${outcome.text.trim()}`);
        done += 1;
        progress();
      }
      text = parts.join('\n\n');
    }

    const images = await evidentiaryImages(deps, input.notebookId, sources);
    if (images.length > 0) deps.repo.setIngest(docId, { withImages: true }, now());
    /**
     * **Slides are written as concept cards** (`notebooks.md` §11.2, amended 2026-10-06); papers
     * keep the prose overview. The cards' budget is a share of the slides' own words, and the
     * figure regions of each page are what a `figure` item's crop is chosen from, in code.
     */
    const regions = asCards ? await figureRegions(deps, input.notebookId, sources) : new Map<number, FigureRegion[]>();
    const outcome = await call(
      deps,
      {
        // Sonnet, named as the orchestrator rather than the fast lane (see `ingest.ts`).
        model: deps.models.orchestrator,
        max_tokens: asCards ? CARDS_MAX_TOKENS : OVERVIEW_MAX_TOKENS,
        system: [{ type: 'text', text: asCards ? CARDS_SYSTEM : OVERVIEW_SYSTEM }],
        messages: [
          {
            role: 'user',
            content: asCards
              ? cardsMessage({
                  notebookName: subject.name,
                  sourceNames: sources.map((s) => s.name),
                  deckText: text,
                  condensed: deck.truncated,
                  budget: cardBudget(sourceWords),
                  imagePages: images.map((i) => i.page),
                  figurePages: [...regions].map(([page, boxes]) => ({ page, area: boxes[0]?.area ?? 0 })),
                })
              : overviewMessage({
                  notebookName: subject.name,
                  sourceNames: sources.map((s) => s.name),
                  deckText: text,
                  condensed: deck.truncated,
                  sourceWords,
                  budget,
                  genre: policy.genre,
                  imagePages: images.map((i) => i.page),
                }),
          },
        ],
        jsonSchema: asCards ? CARDS_JSON_SCHEMA : OVERVIEW_JSON_SCHEMA,
        ...(images.length > 0 ? { images } : {}),
        meta: { scope: 'notes', costScope: 'notes', fileId: input.notebookId },
      },
      'overview',
      input.notebookId,
    );
    if (outcome.kind === 'preempted_out') throw new Yielded();
    if (outcome.kind === 'failed') throw outcome.error;
    done += 1;

    const raw = JSON.parse(extractJsonObject(outcome.text)) as unknown;
    land(deps, input, subject, docId, mode, {
      raw,
      deckText: deck.text,
      sourceWords,
      budget,
      policy,
      model: deps.models.orchestrator,
      withImages: images.length > 0,
      steps,
      startedAt,
      outputTokens: outcome.outputTokens,
      condensed: deck.truncated,
      regions,
    });
  } catch (err) {
    fail(deps, input, docId, mode, err, startedAt);
  }
}

/** A failed run: `failed` on a first overview; on an update, the old doc stays, `ready`, with why. */
function fail(
  deps: OverviewDeps,
  input: OverviewInput,
  docId: string,
  mode: 'ingest' | 'update',
  err: unknown,
  startedAt: number,
): void {
  const now = deps.now ?? (() => new Date().toISOString());
  const reason = err instanceof Error ? err.message : String(err);
  const record = deps.repo.setIngest(
    docId,
    mode === 'update'
      ? { status: 'ready', error: `The overview was not updated: ${reason}`, windowsDone: 1, windowsTotal: 1 }
      : { status: 'failed', error: reason },
    now(),
  );
  if (record) emitStatus(deps, input, record);
  const fields = { file_id: input.notebookId, doc_id: docId, mode, ms: Date.now() - startedAt, cause: reason };
  // The learner took the lane back: not a fault, and the next open (or a Retry) finishes it.
  if (err instanceof Error && err.name === 'Yielded') log().warn('notes.overview.yielded', fields);
  else log().error('notes.overview.failed', fields);
}

interface Landing {
  raw: unknown;
  /** The sources' own text, for the blank check (the condensed text is not the slides). */
  deckText: string;
  sourceWords: number;
  budget: number;
  /** Slides or prose, and the caps that follow (§3.2, amended 2026-10-02). */
  policy: Pick<OverviewPolicy, 'genre' | 'maxSections' | 'maxIdeas' | 'referenceWords'>;
  model: string;
  withImages: boolean;
  steps: number;
  startedAt: number;
  outputTokens: number | null;
  condensed: boolean;
  /** Each notebook page's figure regions, biggest first: where a card's figure is cropped from. */
  regions?: ReadonlyMap<number, readonly FigureRegion[]>;
}

/**
 * The answer, checked, turned into the doc, the metadata and the tree, and stored. Throws when
 * nothing usable came back; the caller writes that onto the row.
 */
function land(
  deps: OverviewDeps,
  input: OverviewInput,
  subject: NotebookSubject,
  docId: string,
  mode: 'ingest' | 'update',
  landing: Landing,
): NotesDocRecord {
  const now = deps.now ?? (() => new Date().toISOString());
  const contentKey = notebookContentKey(input.notebookId);
  const ctx = {
    pageCount: subject.pageCount,
    pageExists: (page: number) => deps.notebooks.locate(input.notebookId, page) !== null,
    pageTexts: pageTextsOf(landing.deckText),
    fallbackTitle: subject.name,
    maxSections: landing.policy.maxSections,
    maxIdeas: landing.policy.maxIdeas,
  };
  /**
   * **Cards when the answer is cards** (§11.2): a slide deck's live call asks for them. An answer
   * in the map's shape (the scripted fixtures, or a model that ignored the schema) lands as a map,
   * through the gate it was written for, rather than as nothing.
   */
  const asCards = landing.policy.genre === 'slides' && hasCards(landing.raw);
  let overview: ValidOverview;
  let repairs: OverviewRepairs;
  let ideasCut = 0;
  let cards: CardLanding | null = null;
  if (asCards) {
    const checked = validateCards(landing.raw, { ...ctx, figureRect: (page) => figureRect(landing.regions?.get(page) ?? []) });
    if (!checked.overview) throw new Error('the model returned no usable section');
    const budget = cardBudget(landing.sourceWords);
    const fit = fitCards(checked.overview, budget);
    overview = fit.overview;
    repairs = checked.repairs;
    cards = { budget, itemsCut: fit.itemsCut, coresTrimmed: fit.coresTrimmed, repairs: checked.repairs, words: cardWords(overview) };
  } else {
    const checked = validateOverview(landing.raw, ctx);
    if (!checked.overview) throw new Error('the model returned no usable section');
    repairs = checked.repairs;
    // §3.2: the budget is a ceiling, so an overview well over it loses its third ideas.
    ({ overview, ideasCut } = fitOverview(checked.overview, landing.budget));
  }

  // ── C5: the tree first, so the list is drawn from what is stored ──
  const { objectives, notes } = objectivesFromOverview({
    notebookId: input.notebookId,
    contentKey,
    pageCount: subject.pageCount,
    objectives: overview.objectives,
    maxObjectives: OVERVIEW_MAX_OBJECTIVES,
  });
  const minted = mintOverview(overview, objectives.map((o) => o.title));

  // ── carry what the learner owns from the doc as it is now (§2) ──
  const stored = deps.repo.byId(docId);
  let old: Node | null = null;
  try {
    old = stored?.doc ? docFromJson(stored.doc) : null;
  } catch {
    old = null;
  }
  /**
   * Kept agent edits, and **Ellie's notes the learner has not removed** (`notebooks.md` §2 and
   * §4.2, amended 2026-10-02). A background note is the record of a gap a question filled, kept
   * for revision; dropping it because the learner never pressed Keep loses exactly that.
   */
  const ellieNotes = deps.repo.edits(docId, 'applied').filter((e) => e.author === 'ellie' && e.cause === 'block_action');
  const kept = new Set([...deps.repo.edits(docId, 'kept').flatMap((e) => e.blockIds), ...ellieNotes.flatMap((e) => e.blockIds)]);
  const { nodes, stats } = carryOver(old, minted.nodes, kept);
  const doc = notesSchema.nodes.doc!.create(null, nodes).toJSON();

  // Pending and applied agent edits point at blocks that are gone (as Regenerate drops them).
  // Ellie's carried notes keep their edit rows, so Remove · Keep still works on them.
  const cleared = deps.repo.clearForRegenerate(
    docId,
    ellieNotes.map((e) => e.editId),
  );

  const meta = overviewMeta({
    overview,
    headingIds: minted.headingIds,
    fingerprint: subject.fingerprint,
    writtenAt: now(),
    words: minted.words,
    wordBudget: cards ? cards.budget.notes.max : landing.budget,
    genre: landing.policy.genre,
    ...(cards ? { cards: { coreWords: cards.words.core, coreBudget: cards.budget.core.max } } : {}),
  });
  const record = deps.repo.landOverview(
    {
      docId,
      doc,
      overview: meta,
      title: overview.title,
      pageCount: subject.pageCount,
      windowsDone: landing.steps,
      windowsTotal: landing.steps,
      withImages: landing.withImages,
      model: landing.model,
    },
    now(),
  );

  // The learner's progress on an objective the update reworded goes to the objective that now
  // teaches the same pages (`carryStates`); only what has no successor is pruned.
  const carried = carryStates(deps.objectives.tree(input.notebookId)?.objectives ?? [], objectives, deps.objectives.states(input.notebookId));
  for (const { from, toId } of carried) {
    const there = deps.objectives.state(input.notebookId, toId);
    if (!there || there.level < from.level) {
      deps.objectives.setLevel({
        fileId: input.notebookId,
        objectiveId: toId,
        level: from.level,
        evidenceMessageIds: from.evidenceMessageIds,
        movedAt: from.lastMovedAt ?? now(),
      });
    }
    if (from.taughtAt && !there?.taughtAt) deps.objectives.markTaught({ fileId: input.notebookId, objectiveId: toId, at: from.taughtAt });
  }
  const dropped = deps.objectives.pruneStates(input.notebookId, objectives.map((o) => o.id));
  const tree = deps.objectives.upsertTree(
    notebookTreeRecord({ notebookId: input.notebookId, contentKey, model: landing.model, generatedAt: now(), objectives }),
    now(),
  );
  deps.onTree?.(tree);
  mapObjectiveBlocks({ repo: deps.repo, objectivesTree: () => tree }, input.notebookId, record);
  emitStatus(deps, input, record);

  logLanding(input, record, mode, landing, repairs, {
    objectives: objectives.length,
    sections: overview.sections.length,
    statesDropped: dropped,
    treeRepairs: notes.droppedDuplicate + notes.droppedOverCap + notes.droppedUntitled,
    carried: stats,
    editsCleared: cleared.edits,
    suggestionsCleared: cleared.suggestions,
    recommendations: meta.recommendations.length,
    ideasCut,
    statesCarried: carried.length,
    cards,
  });
  return record;
}

/** What the card path adds to the landing's log line (§11.2: the ratio is a check that is logged). */
interface CardLanding {
  budget: CardBudget;
  itemsCut: number;
  coresTrimmed: number;
  repairs: CardRepairs;
  words: CardWords;
}

function logLanding(
  input: OverviewInput,
  record: NotesDocRecord,
  mode: 'ingest' | 'update',
  landing: Landing,
  repairs: OverviewRepairs,
  extra: {
    objectives: number;
    sections: number;
    statesDropped: number;
    treeRepairs: number;
    carried: ReturnType<typeof carryOver>['stats'];
    editsCleared: number;
    suggestionsCleared: number;
    recommendations: number;
    ideasCut: number;
    statesCarried: number;
    cards: CardLanding | null;
  },
): void {
  const c = extra.cards;
  const share = (n: number): number => (landing.sourceWords > 0 ? Math.round((n / landing.sourceWords) * 1000) / 1000 : 0);
  log().info('notes.overview', {
    file_id: input.notebookId,
    doc_id: record.id,
    mode,
    model: landing.model,
    ms: Date.now() - landing.startedAt,
    // §3.2: words written against the computed ceiling, beside what the sources said.
    words: record.overview?.words ?? 0,
    budget_words: landing.budget,
    source_words: landing.sourceWords,
    genre: landing.policy.genre,
    reference_words: landing.policy.referenceWords,
    condensed: landing.condensed,
    with_images: landing.withImages,
    output_tokens: landing.outputTokens,
    sections: extra.sections,
    objectives: extra.objectives,
    recommendations: extra.recommendations,
    thin_sections: extra.sections < overviewSectionRange(landing.budget, landing.policy.genre).min,
    thin_objectives: extra.objectives < OVERVIEW_MIN_OBJECTIVES,
    repaired: {
      pages_dropped: repairs.pagesDropped,
      ideas_dropped: repairs.ideasDropped,
      invented_blanks: repairs.inventedBlanks,
      sections_dropped: repairs.sectionsDropped,
      sections_over_cap: repairs.sectionsOverCap,
      objectives_dropped: repairs.objectivesDropped,
      objectives_over_cap: repairs.objectivesOverCap,
      recommendations_dropped: repairs.recommendationsDropped,
      starters_filled: repairs.startersFilled,
      starters_cut: repairs.startersCut,
      greeting_filled: repairs.greetingFilled,
      title_filled: repairs.titleFilled,
      ideas_cut_over_budget: extra.ideasCut,
      tree: extra.treeRepairs,
    },
    carried: extra.carried.carried,
    carried_learner_blocks: extra.carried.learnerBlocks,
    carried_kept_blocks: extra.carried.keptBlocks,
    carried_to_earlier: extra.carried.earlier,
    edits_cleared: extra.editsCleared,
    suggestions_cleared: extra.suggestionsCleared,
    states_dropped: extra.statesDropped,
    states_carried: extra.statesCarried,
    carried_cards_merged: extra.carried.mergedCards,
    // §11.2: words written against the slides' words, the whole notes and the visible layer, each
    // beside its 30–40% / 8–10% band. A check, logged; never a reason to refuse the notes.
    form: c ? 'cards' : 'map',
    ...(c
      ? {
          cards: {
            count: c.words.perCard.length,
            notes_words: c.words.notes,
            notes_band: [c.budget.notes.min, c.budget.notes.max],
            notes_share: share(c.words.notes),
            core_words: c.words.core,
            core_band: [c.budget.core.min, c.budget.core.max],
            core_share: share(c.words.core),
            thin_cards: c.words.perCard.filter((w) => w < CARD_WORDS.min).length,
            heavy_cards: c.words.perCard.filter((w) => w > CARD_WORDS.max).length,
            items_cut_over_budget: c.itemsCut,
            cores_trimmed: c.coresTrimmed,
            cards_dropped: c.repairs.cardsDropped,
            items_dropped: c.repairs.itemsDropped,
            items_marked_added: c.repairs.itemsAddedForced,
            cores_cut: c.repairs.coresCut,
            figures_dropped: c.repairs.figuresDropped,
            tables_dropped: c.repairs.tablesDropped,
            problems: c.repairs.problems,
          },
        }
      : {}),
  });
}

// ── the scripted backend's overview ───────────────────────────────────────────────────────────

/** The raw answer the scripted backend gives: the Critique 1 overview, or an honest placeholder. */
function fixtureRaw(deps: OverviewDeps, subject: NotebookSubject): { raw: unknown; fixture: string } {
  const sources = readySources(subject);
  if (fixtureFor(deps, subject) === 'critique1') {
    const source = sources.find((s) => {
      const located = deps.notebooks.locate(subject.id, s.pageBase + 1);
      return matchFixtureDeck({ fileName: s.name, contentSha: located?.contentSha ?? null }) === 'critique1';
    })!;
    return { raw: critique1OverviewRaw(source.pageBase), fixture: 'critique1' };
  }
  return {
    raw: placeholderOverviewRaw({
      notebookName: subject.name,
      sources: sources.map((s) => ({ name: s.name, firstPage: s.pageBase + 1 })),
    }),
    fixture: 'placeholder',
  };
}

async function landFixture(
  deps: OverviewDeps,
  input: OverviewInput,
  subject: NotebookSubject,
  docId: string,
  mode: 'ingest' | 'update',
): Promise<void> {
  const startedAt = Date.now();
  try {
    const { raw, fixture } = fixtureRaw(deps, subject);
    const deck = deps.notebooks.deckText(input.notebookId, OVERVIEW_DECK);
    const policy = overviewPolicy(deck.text);
    land(deps, input, subject, docId, mode, {
      raw,
      deckText: deck.text,
      sourceWords: policy.bodyWords,
      budget: policy.budget,
      policy,
      model: 'fixture',
      withImages: false,
      steps: 1,
      startedAt,
      outputTokens: null,
      condensed: false,
    });
    log().info('notes.fixture', { file_id: input.notebookId, doc_id: docId, fixture, overview: true });
  } catch (err) {
    fail(deps, input, docId, mode, err, startedAt);
  }
}

/** No live model: the overview is written at once, and the doc is `ready` before this returns. */
async function writeFixtureOverview(
  deps: OverviewDeps,
  input: OverviewInput,
  subject: NotebookSubject,
  existing: NotesDocRecord | null,
  now: string,
): Promise<NotesDocRecord> {
  const record = existing
    ? deps.repo.resetForIngest(
        {
          docId: existing.id,
          doc: emptyDoc(subject.name).toJSON(),
          title: subject.name,
          pageCount: subject.pageCount,
          fileId: input.notebookId,
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
          contentSha: notebookContentKey(input.notebookId),
          fileId: input.notebookId,
          title: subject.name,
          pageCount: subject.pageCount,
          doc: emptyDoc(subject.name).toJSON(),
          ingestStatus: 'pending',
          ingestVersion: NOTES_PROMPT_VERSION,
          windowsTotal: 1,
          withImages: false,
          model: 'fixture',
        },
        now,
      );
  const contentKey = notebookContentKey(input.notebookId);
  const run = landFixture(deps, input, subject, record.id, 'ingest');
  start(contentKey, run);
  await run;
  return deps.repo.byId(record.id) ?? record;
}

// ── inputs ────────────────────────────────────────────────────────────────────────────────────

/** One source's text, each page under its `[p. N]` notebook-page line, capped for one call. */
export function sourceText(notebooks: NotebookHost, notebookId: string, source: NotebookSourceView): string {
  const lines: string[] = [];
  let chars = 0;
  for (let local = 1; local <= source.pageCount; local += 1) {
    const page = source.pageBase + local;
    const body = notebooks.textFor({ notebookId, pageFrom: page, pageTo: page }).trim();
    if (body.length === 0) continue;
    const chunk = `[p. ${page}]\n${body}`;
    if (chars + chunk.length > CONDENSE_INPUT_CHARS) break;
    lines.push(chunk);
    chars += chunk.length + 1;
  }
  return lines.join('\n');
}

/**
 * A slide that leaves a blank for the student (answer B): a line ending "=" ("Max(Cost) ="), a
 * ":?" anywhere in a line, or a run of underscores. Mid-line for the second, because a garbled
 * text layer runs a slide's columns together: Lecture-complex p. 17's "h_FF : ?" extracts as
 * "…•ℎ:?12%%Precond:…", and only the image shows the student what the blank is.
 */
const BLANK_SLIDE = /=\s*$|:\s*\?|_{3,}/;

/**
 * The page images worth sending: pages of the ticked PDF sources that **leave a blank**
 * (`BLANK_SLIDE`), then pages that have a drawn figure on them (pass 1's `figures`), when the
 * renderer has stored that source's images. Labelled with their **notebook** page, which is what
 * the call's `[p. N]` markers say. The blank pages come first because the overview may carry a
 * blank only where the slide leaves one, and the image is how the model sees it does; the figure
 * pages are spread evenly over what is left of `OVERVIEW_MAX_IMAGES`.
 *
 * The blank pages were added after the live run of 1 Oct 2026: on Lecture-complex the figure
 * detector finds no figure on any of the 58 pages (each page's only ink box is the template's
 * container), so the call went text-only and the model never saw p. 17 or p. 24.
 */
export async function evidentiaryImages(
  deps: Pick<OverviewDeps, 'notebooks' | 'userDataDir' | 'geometry'>,
  notebookId: string,
  sources: readonly NotebookSourceView[],
): Promise<StoredPageImage[]> {
  const blanks: StoredPageImage[] = [];
  const figures: StoredPageImage[] = [];
  for (const source of sources) {
    if (source.kind !== 'pdf') continue;
    const located = deps.notebooks.locate(notebookId, source.pageBase + 1);
    if (!located?.contentSha) continue;
    const dir = pageImageDir(deps.userDataDir, located.contentSha);
    if ((await countPageImages(dir)) === 0) continue;
    let blankPages: number[];
    let figurePages: number[];
    try {
      const geometry = await deps.geometry({ filePath: located.path, contentSha: located.contentSha });
      const pages = extractNotesPages(geometry);
      blankPages = pages.filter((p) => p.lines.some((l) => BLANK_SLIDE.test(l.text))).map((p) => p.page);
      figurePages = pages.filter((p) => p.figures.length > 0 && !blankPages.includes(p.page)).map((p) => p.page);
    } catch {
      continue;
    }
    for (const image of await pageImagesFor(dir, blankPages)) blanks.push({ ...image, page: source.pageBase + image.page });
    for (const image of await pageImagesFor(dir, figurePages)) figures.push({ ...image, page: source.pageBase + image.page });
  }
  const first = blanks.slice(0, OVERVIEW_MAX_IMAGES);
  const room = OVERVIEW_MAX_IMAGES - first.length;
  if (figures.length <= room) return [...first, ...figures].sort((a, b) => a.page - b.page);
  const step = figures.length / room;
  const spread = Array.from({ length: room }, (_, i) => figures[Math.floor(i * step)]!);
  return [...first, ...spread].sort((a, b) => a.page - b.page);
}

/** One figure region of a page (`extract.ts` `pageFigures`): its rect and the share of the slide it covers. */
export interface FigureRegion {
  rect: Rect;
  area: number;
}

/**
 * **The figure regions of every page of the ticked PDF sources**, by notebook page, biggest first,
 * for the pages that have one (§11.2: a card's `figure` is a crop of its slide, chosen in code).
 * One geometry pass per source, the same cached pass `evidentiaryImages` reads; a source whose
 * geometry cannot be had contributes nothing, and the figure is then the whole slide.
 */
export async function figureRegions(
  deps: Pick<OverviewDeps, 'notebooks' | 'geometry'>,
  notebookId: string,
  sources: readonly NotebookSourceView[],
): Promise<Map<number, FigureRegion[]>> {
  const out = new Map<number, FigureRegion[]>();
  for (const source of sources) {
    if (source.kind !== 'pdf') continue;
    const located = deps.notebooks.locate(notebookId, source.pageBase + 1);
    if (!located?.contentSha) continue;
    try {
      const geometry = await deps.geometry({ filePath: located.path, contentSha: located.contentSha });
      for (const page of extractNotesPages(geometry)) {
        if (page.figures.length === 0) continue;
        out.set(source.pageBase + page.page, page.figures.map((f) => ({ rect: f.rect, area: f.area })));
      }
    } catch {
      continue;
    }
  }
  return out;
}

/** The same unwrapper the window ingest uses: prose around the object is a known shape. */
function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return trimmed;
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end <= start) return trimmed;
  return trimmed.slice(start, end + 1);
}
