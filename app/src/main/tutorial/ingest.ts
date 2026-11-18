/**
 * **Reading a tutorial sheet into its document** (`docs/research/tutorials.md` §3, §5, §7;
 * `TUTORIAL-CONTRACT.md` S2, S3).
 *
 * The overview's pattern, for a sheet: fired, not awaited; one schema-bound call on the
 * orchestrator model over the sheet's page text, its page images (the JPEGs the renderer stored
 * through `notes:pageImages`, under the source's bytes), the geometry's figure boxes, the main
 * notes' outline and the objective tree. A long sheet (an exam paper) is read the same way a few
 * pages at a time and joined in code (`windows.ts`, `readcache.ts`; 2026-11-18). Then it is
 * validated in code (`validate.ts`); formal parts solved by
 * code; the other parts re-solved once, independently, and compared, which sets each key's
 * confidence. Then the document lands whole (`tutorialDoc`), the learner's answers carried over
 * by part id on a re-read (`carryAnswers`), the part records upserted, and `tutorial:changed`
 * pushed. **Official solutions**, when the notebook has them for this tutorial, then rewrite the
 * keys (`from: 'solutions'`), asking about each part once per answer sheet.
 *
 * The row: `notes_docs` with `content_sha = tutorialContentKey(notebook, file)` and
 * `file_id = file`, `pending` while it is read, `ready` or `failed` with a sentence the learner can
 * act on. A failed re-read leaves a ready document as it was.
 */
import type { Node } from 'prosemirror-model';
import { docOutline, emptyDoc, newBlockId, notesSchema } from '../../shared/doc/schema.js';
import { carryAnswers, partAnswers, tutorialDoc, type PartAnswer } from '../../shared/doc/tutorialdoc.js';
import { citationLabel, pageRanges } from '../../shared/notebook.js';
import { tutorialContentKey, type PartKey, type SheetRect, type TutorialIngestInput, type TutorialView } from '../../shared/tutorial.js';
import type { NotebookSubject } from '../dochost.js';
import { newDocId, notesRepo } from '../db/repos/notes.js';
import { log } from '../log.js';
import { extractNotesPages } from '../notes/extract.js';
import { pageImageDir, pageImagesFor, type StoredPageImage } from '../notes/pageimages.js';
import {
  callJson,
  capText,
  ReplyTruncated,
  waitingReads,
  lecturePageTest,
  notebookDoc,
  nowOf,
  pushView,
  tutorialRecord,
  tutorialSource,
  viewOf,
  type TutorialDeps,
} from './context.js';
import { FIXTURE_SHEET, fixtureKeys } from './fixture.js';
import {
  COMPARE_JSON_SCHEMA,
  COMPARE_SYSTEM,
  compareMessage,
  RESOLVE_JSON_SCHEMA,
  RESOLVE_SYSTEM,
  resolveMessage,
  SOLUTIONS_JSON_SCHEMA,
  SOLUTIONS_SYSTEM,
  solutionsMessage,
  VISUAL_CHOICES_JSON_SCHEMA,
  VISUAL_CHOICES_SYSTEM,
  TUTORIAL_JSON_SCHEMA,
  TUTORIAL_PROMPT_VERSION,
  TUTORIAL_SYSTEM,
  tutorialContext,
  tutorialMessage,
  tutorialWindowMessage,
} from './prompt.js';
import { tutorialRepo, type LandedPart } from './repo.js';
import { keyFrom, validateTutorial, type TutorialRepairs } from './validate.js';
import { promptInContext } from './part.js';
import { choiceEvidenceFromText, pagesForPart, quoteOnPage, quoteSupportsAnswer, type QuoteMiss, type SolutionPage } from './solution-evidence.js';
import type { RoleChange } from '../notebooks/service.js';
import type { LLMClient } from '../../room/llm/types.js';
import { createHash } from 'node:crypto';
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { REFUSAL_MESSAGE } from '../../room/llm/anthropic.js';
import { errorClass } from '../log.js';
import { WindowCache } from './readcache.js';
import {
  batches,
  mapLimit,
  MAX_SHEET_PAGES,
  mergeWindowReads,
  noticeText,
  planWindows,
  readWindows,
  wholeAnswer,
  WINDOW_CONCURRENCY,
  WindowDeclined,
  WindowEmpty,
  WindowTruncated,
  type MergeStats,
  type SheetWindow,
  type WindowNotice,
} from './windows.js';

/**
 * The ceiling on one read's answer: a faithful copy of a sheet (or of one window of a long one,
 * `windows.ts`) plus a key per part.
 */
export const TUTORIAL_MAX_TOKENS = 16_000;
export const RESOLVE_MAX_TOKENS = 6_000;
export const COMPARE_MAX_TOKENS = 1_500;
export const SOLUTIONS_MAX_TOKENS = 8_000;
/**
 * Parts per re-solve and compare call, and per solutions call. A tutorial has a dozen or two; an
 * exam has fifty, whose answers do not fit one call's budget (a key ran ~300 output tokens).
 */
export const CONFIRM_BATCH_PARTS = 12;
export const SOLUTIONS_BATCH_PARTS = 12;
/** The most page images one call is given: a short sheet's first pages, or one window's. */
export const TUTORIAL_MAX_IMAGES = 12;
/** The most of the sheet's text the read is given, in characters. */
export const SHEET_TEXT_CAP = 120_000;
/** The most notes outline entries the read is given. */
export const OUTLINE_MAX_ENTRIES = 250;

export const MESSAGES = {
  notTutorial: 'That source is not a tutorial of this notebook.',
  notReady: 'This sheet has not finished reading yet.',
  noParts: "No questions were found on this sheet. If it is a tutorial, Retry; if not, use it as a lecture instead.",
  failed: (reason: string) => `Couldn't read this sheet (${reason}). Retry to try again.`,
  /** A transport failure after its retries: the windows read so far are kept for the Retry. */
  stopped: (why: string) => `Couldn't finish reading this sheet: ${why}. Retry in a minute; the pages already read are kept.`,
  signedOut: 'Claude Code is signed out. Open Terminal and run claude to sign in, or pick another backend in Settings. The pages already read are kept.',
  noCli: "Claude Code isn't installed on this Mac, or ChatterED can't find it. Install it, or pick another backend in Settings.",
  limit: (resets: string | null) =>
    `Your Claude usage limit is reached for now${resets ? ` (it resets ${resets})` : ''}. Retry after that; the pages already read are kept.`,
  badRequest: "Claude couldn't accept this request (error 400). Retry; if it happens again, send the team a debug report with ⇧⌘D.",
} as const;

/** Content keys with a read in flight. */
const inFlight = new Map<string, Promise<void>>();

/** The read (or key rewrite) started for this tutorial, for the tests to await. */
export function tutorialInFlight(contentKey: string): Promise<void> | undefined {
  return inFlight.get(contentKey);
}

function start(key: string, run: Promise<void>): void {
  const tracked = run.finally(() => inFlight.delete(key));
  inFlight.set(key, tracked);
  void tracked.catch(() => undefined);
}

/**
 * **`tutorial:ingest`**: read the sheet if it needs reading. Returns at once with the view
 * (`pending` while the read runs). A ready document is read again only with `force`; a failed one
 * is retried by any call.
 */
export function ingestTutorial(deps: TutorialDeps, input: TutorialIngestInput): TutorialView {
  const subject = deps.notebooks.subject(input.notebookId);
  const source = tutorialSource(subject, input.fileId);
  if (!subject || !source) throw new Error(MESSAGES.notTutorial);
  if (source.status !== 'ready') throw new Error(MESSAGES.notReady);
  const key = tutorialContentKey(input.notebookId, input.fileId);
  const repo = notesRepo(deps.db);
  const existing = repo.byContentSha(key);
  if (inFlight.has(key)) {
    if (input.forceSolutions) void inFlight.get(key)!.then(() => rewriteKeys(deps, input.notebookId, input.fileId));
    return viewOf(deps, input.notebookId, input.fileId)!;
  }
  if (input.forceSolutions && existing?.ingestStatus === 'ready') {
    start(key, rewriteKeys(deps, input.notebookId, input.fileId).then(() => undefined));
    return viewOf(deps, input.notebookId, input.fileId)!;
  }
  // Ready stays ready without `force`; failed is a Retry; pending with nothing running is a read
  // an app quit cut short, and is run again.
  if (existing && existing.ingestStatus === 'ready' && !input.force) return viewOf(deps, input.notebookId, input.fileId)!;

  const live = deps.llm(input.notebookId) !== null;
  const model = live ? deps.models().orchestrator : 'fixture';
  const title = existing?.title || source.name.replace(/\.[^.]+$/, '');
  const record = existing
    ? repo.setIngest(existing.id, { status: 'pending', windowsDone: 0, windowsTotal: 1, error: null, model }, nowOf(deps))!
    : repo.create(
        {
          id: newDocId(),
          contentSha: key,
          fileId: input.fileId,
          title,
          pageCount: subject.pageCount,
          doc: emptyDoc(title).toJSON(),
          ingestStatus: 'pending',
          ingestVersion: TUTORIAL_PROMPT_VERSION,
          windowsTotal: 1,
          withImages: false,
          model,
        },
        nowOf(deps),
      );
  // A doc with no part in it has only ever been the placeholder: a first read, whatever its row says.
  const firstRead = partAnswersOf(existing?.doc ?? null).length === 0;
  log().info('tutorial.ingest.start', { notebook_id: input.notebookId, file_id: input.fileId, doc_id: record.id, force: input.force === true });
  // The pending view is pushed before the run starts, so it is never pushed after a scripted
  // read that lands at once.
  const pending = pushView(deps, input.notebookId, input.fileId)!;
  start(key, runIngest(deps, input.notebookId, input.fileId, record.id, firstRead));
  return pending;
}

async function runIngest(deps: TutorialDeps, notebookId: string, fileId: string, docId: string, firstRead: boolean): Promise<void> {
  const repo = notesRepo(deps.db);
  const startedAt = Date.now();
  let stats = { windows: 0, splits: 0 };
  try {
    const subject = deps.notebooks.subject(notebookId);
    const source = tutorialSource(subject, fileId);
    if (!subject || !source) throw new Error('it is no longer a tutorial here');
    const llm = deps.llm(notebookId);
    const isLecturePage = lecturePageTest(subject);
    const nbDoc = notebookDoc(deps, notebookId);
    const outline = nbDoc ? docOutline(nbDoc) : [];
    const tree = deps.objectivesTree(notebookId);
    const objectiveIds = new Set((tree?.objectives ?? []).map((o) => o.id));
    const located = deps.notebooks.locate(notebookId, source.pageBase + 1);

    let figures = new Map<number, SheetRect[]>();
    if (source.kind === 'pdf' && located?.contentSha) {
      try {
        const geometry = await deps.geometry({ filePath: located.path, contentSha: located.contentSha });
        figures = new Map(extractNotesPages(geometry).map((p) => [p.page, p.figures.map((f) => ({ ...f.rect }))]));
      } catch {
        // Figures without their boxes are still figures: the model's rectangles stand.
      }
    }

    let raw: unknown;
    let read: SheetRead | null = null;
    if (llm) {
      read = await readSheet(deps, llm, {
        notebookId,
        docId,
        source,
        figures,
        context: {
          notesOutline: outline
            .filter((e) => e.text.trim().length > 0)
            .slice(0, OUTLINE_MAX_ENTRIES)
            .map((e) => `${e.blockId} | ${e.pages.length > 0 ? `p. ${pageRanges(e.pages)}` : '-'} | ${e.path.join(' > ') || '(top)'} | ${capText(e.text, 120)}`)
            .join('\n'),
          objectives: (tree?.objectives ?? []).map((o) => `${o.id}: ${o.title}`).join('\n'),
          lecturePages: subject.sources
            .filter((s) => s.role === 'lecture' && s.status === 'ready' && s.pageCount > 0)
            .map((s) => `${s.name}: p. ${s.pageBase + 1}–${s.pageBase + s.pageCount}`)
            .join('\n'),
        },
        imageDir: await sheetImageDir(deps, source.kind, located),
      });
      raw = read.raw;
      stats = { windows: read.windows, splits: read.splits };
    } else {
      raw = fixtureRaw(subject, outline.find((e) => e.kind !== 'heading')?.blockId ?? null, tree?.objectives[0]?.id ?? null);
    }

    const checked = validateTutorial(raw, {
      pageCount: Math.max(1, source.pageCount),
      fallbackTitle: source.name.replace(/\.[^.]+$/, ''),
      figureCandidates: figures,
      notesBlockIds: outline.map((e) => e.blockId),
      isLecturePage,
      objectiveIds,
    });
    // No part, and pages that could not be read: say that, not that the sheet has no questions.
    if (!checked) {
      // Nothing to land: the next Retry asks the model again rather than replaying this.
      read?.cache.clear();
      // Pages that came back empty twice, and nothing else: the model found no question.
      const unread = (read?.notices ?? []).filter((n) => n.reason !== 'empty');
      throw read && unread.length > 0 ? new SheetUnread(read.notices, source.pageCount) : new NoParts();
    }

    // A re-read keeps what the official solutions verified, part by part (same id, same label),
    // so the same answer sheet is not paid for again.
    const carriedKeys = firstRead ? 0 : carrySolutionKeys(deps, docId, checked);

    let disagreed = 0;
    let unverified = 0;
    if (llm) {
      const outcome = await confirmKeys(deps, llm, notebookId, checked.sheet, source.pageBase, checked.parts);
      disagreed = outcome.disagreed;
      unverified = outcome.unverified;
    }

    land(deps, { notebookId, fileId, docId, pageBase: source.pageBase, firstRead, windows: read?.windows ?? 1 }, checked.sheet, checked.parts, llm ? deps.models().orchestrator : 'fixture');
    // Landed: the next read of this sheet is a fresh one.
    read?.cache.clear();
    logLanding(notebookId, fileId, docId, startedAt, checked.parts, checked.repairs, {
      disagreed,
      unverified,
      images: read?.images ?? 0,
      windows: read?.windows ?? 1,
      splits: read?.splits ?? 0,
      calls: read?.calls ?? 0,
      resumed: read?.resumed ?? 0,
      emptyRetries: read?.emptyRetries ?? 0,
      carriedKeys,
      notices: (read?.notices ?? []).map((n) => ({ from: n.from, to: n.to, reason: n.reason })),
      merge: read?.merge ?? null,
    });

    // Official solutions already in this notebook win over the key just written.
    if (solutionsFor(subject, fileId).length > 0) await rewriteKeys(deps, notebookId, fileId);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const learnerFacing = readFailure(err);
    const record = repo.byId(docId);
    // A re-read that fails leaves the sheet the learner is working in as it was.
    const keep = !firstRead && record !== null && partAnswersOf(record.doc).length > 0;
    repo.setIngest(docId, keep ? { status: 'ready', error: learnerFacing } : { status: 'failed', error: learnerFacing }, nowOf(deps));
    log().error('tutorial.ingest.failed', {
      notebook_id: notebookId,
      file_id: fileId,
      doc_id: docId,
      ms: Date.now() - startedAt,
      cause: reason.slice(0, 300),
      class: errorClass(err),
      // Window counts and pages only, never the sheet's words. The windows read are kept.
      ...((err as { readProgress?: unknown })?.readProgress ? { read: (err as { readProgress: unknown }).readProgress } : { windows: stats.windows, splits: stats.splits }),
      ...(err instanceof SheetUnread ? { notices: err.notices.map((n) => ({ from: n.from, to: n.to, reason: n.reason })) } : {}),
    });
    pushView(deps, notebookId, fileId);
  }
}

/**
 * The official keys of the sheet being replaced, onto the new reading's parts with the same id
 * and the same label: a key verified against the answer sheet, and the record that the answer
 * sheet was already asked about a part. Returns how many parts kept one.
 */
function carrySolutionKeys(deps: TutorialDeps, docId: string, checked: { sheet: import('../../shared/tutorial.js').TutorialSheet; parts: LandedPart[] }): number {
  const before = new Map(tutorialRepo(deps.db).parts(docId).map((r) => [r.partId, r.key]));
  const labels = new Map(partAnswersOf(notesRepo(deps.db).byId(docId)?.doc ?? null).map((a) => [a.partId, a.label]));
  const now = new Map(
    checked.sheet.blocks.filter((b): b is import('../../shared/tutorial.js').SheetPart => b.type === 'part').map((p) => [p.id, p.label]),
  );
  let carried = 0;
  for (const part of checked.parts) {
    const old = before.get(part.partId);
    if (!old || labels.get(part.partId) !== now.get(part.partId)) continue;
    if (old.solutionEvidence?.version === 1) {
      part.key = { ...old, ...(part.key.check && !old.check ? { check: part.key.check } : {}) };
      carried += 1;
    } else if (old.solutionsTried) {
      part.key = { ...part.key, solutionsTried: old.solutionsTried };
    }
  }
  return carried;
}

class NoParts extends Error {
  constructor() {
    super('the model found no part to answer');
    this.name = 'NoParts';
  }
}

/** No part came through, and some pages could not be read: the notices are why. */
class SheetUnread extends Error {
  constructor(
    readonly notices: readonly WindowNotice[],
    pageCount: number,
  ) {
    const kinds = new Map<WindowNotice['reason'], WindowNotice[]>();
    for (const n of notices) kinds.set(n.reason, [...(kinds.get(n.reason) ?? []), n]);
    super(`Couldn't read this sheet. ${[...kinds.values()].map((group) => noticeText(group, pageCount).replace(/^\*|\*$/g, '')).join(' ')}`);
    this.name = 'SheetUnread';
  }
}

/**
 * Where the images this read sends are. A PDF's pages are the JPEGs the renderer stored under its
 * bytes; an image source is itself the page, copied there as page 1 so the CLI is only ever given
 * a directory the app wrote (`claude-cli.ts` `argsFor`). A text source has none.
 */
async function sheetImageDir(deps: TutorialDeps, kind: string, located: ReturnType<TutorialDeps['notebooks']['locate']>): Promise<string | null> {
  if (!located?.contentSha) return null;
  const dir = pageImageDir(deps.userDataDir, located.contentSha);
  if (kind === 'pdf') return dir;
  if (kind !== 'image') return null;
  const ext = /\.png$/i.test(located.path) ? 'png' : /\.jpe?g$/i.test(located.path) ? 'jpg' : null;
  if (!ext) return null;
  try {
    await mkdir(dir, { recursive: true });
    await copyFile(located.path, join(dir, `p-1.${ext}`));
    return dir;
  } catch {
    return null;
  }
}

function shortReason(reason: string): string {
  // Never the CLI's exit line or an SDK's JSON: what is left of the first line before either.
  const one = reason.split('\n')[0]!.replace(/^The Claude CLI exited -?\d+:\s*/i, '').replace(/\s*\{.*$/, '').trim();
  return one.length > 120 ? `${one.slice(0, 119)}…` : one || 'unknown error';
}

function partAnswersOf(json: unknown): PartAnswer[] {
  try {
    return json ? partAnswers(notesSchema.nodeFromJSON(json)) : [];
  } catch {
    return [];
  }
}

/**
 * **Read the sheet** (`windows.ts`): one call for a short sheet, exactly as before; a long one a
 * few pages at a time, each window with only its pages' text, images and figure boxes, joined in
 * page order. A cut-off answer is cut smaller and read again, never taken for an empty sheet.
 *
 * - Each window's answer is kept as it lands (`readcache.ts`): a read stopped by the network, the
 *   credit or the app quitting resumes, and Retry pays only for the windows not yet read.
 * - A transport failure (429, 529, 5xx, a dropped connection) is waited out and asked again,
 *   `TRANSIENT_BACKOFF_MS`, before it stops the read.
 * - A window that comes back empty though its pages have text is asked once more.
 * - The record's `windowsDone`/`windowsTotal` move as windows land, and the view is pushed.
 */
async function readSheet(
  deps: TutorialDeps,
  llm: LLMClient,
  at: {
    notebookId: string;
    docId: string;
    source: NonNullable<ReturnType<typeof tutorialSource>>;
    figures: ReadonlyMap<number, SheetRect[]>;
    context: { notesOutline: string; objectives: string; lecturePages: string };
    /** The page images, by the source's bytes; null when there are none to send. */
    imageDir: string | null;
  },
): Promise<SheetRead> {
  const { source, notebookId, docId } = at;
  const repo = notesRepo(deps.db);
  const filePages = Math.max(1, source.pageCount);
  // A file longer than `MAX_SHEET_PAGES` is read to there, and the sheet says so at its end.
  const pageCount = Math.min(filePages, MAX_SHEET_PAGES);
  const pages = pageTexts(deps, notebookId, source.pageBase, pageCount);
  const plan = planWindows(pages.map((t) => t.length));
  const cache = new WindowCache(deps.userDataDir, [
    String(TUTORIAL_PROMPT_VERSION),
    tutorialContentKey(notebookId, source.fileId),
    String(filePages),
    ...pages,
  ]);
  const resumed = cache.size;
  let images = 0;
  let calls = 0;
  let emptyRetries = 0;
  const figuresOf = (from: number, to: number): string =>
    [...at.figures.entries()]
      .filter(([page, rects]) => rects.length > 0 && page >= from && page <= to)
      .map(([page, rects]) => `p. ${page}: ${rects.map((r) => [r.x0, r.y0, r.x1, r.y1].map((n) => n.toFixed(3)).join(' ')).join(' · ')}`)
      .join('\n');
  const imagesOf = async (from: number, to: number): Promise<StoredPageImage[]> => {
    if (!at.imageDir) return [];
    const span = Array.from({ length: Math.max(0, Math.min(to, from + TUTORIAL_MAX_IMAGES - 1) - from + 1) }, (_, i) => from + i);
    return pageImagesFor(at.imageDir, span);
  };

  const ask = async (w: SheetWindow, shown: StoredPageImage[], again: boolean): Promise<unknown> => {
    const whole = w.from === 1 && w.to >= filePages && w.ahead === null;
    // The whole sheet in one call is the request this read always made, byte for byte.
    const request = whole
      ? {
          system: [{ type: 'text' as const, text: TUTORIAL_SYSTEM }],
          content: tutorialMessage({
            sourceName: source.name,
            pageCount: source.pageCount,
            sheetText: sheetText(deps, notebookId, source.pageBase, source.pageCount),
            figures: figuresOf(1, pageCount),
            ...at.context,
            // Images are labelled with the sheet's own page, as its blocks are.
            imagePages: shown.map((i) => i.page),
          }),
        }
      : {
          system: [
            { type: 'text' as const, text: TUTORIAL_SYSTEM },
            { type: 'text' as const, text: tutorialContext(at.context), cache_control: { type: 'ephemeral' as const } },
          ],
          content: tutorialWindowMessage({
            sourceName: source.name,
            pageCount: filePages,
            from: w.from,
            to: w.to,
            ahead: w.ahead,
            // The whole page before: a part here may have its stem or its code there.
            previousPage: w.from > 1 ? capText(pages[w.from - 2] ?? '', PREVIOUS_PAGE_CHARS) : '',
            sheetText: windowText(pages, w),
            figures: figuresOf(w.from, w.ahead ?? w.to),
            imagePages: shown.map((i) => i.page),
            again,
          }),
        };
    // At most `1 + waits.length` asks of this window over the transport, each on the CLI capped at
    // `CLI_WINDOW_TIMEOUT_MS`; a learner is told the read is waiting while it waits.
    const waits = deps.backoffMs ?? TRANSIENT_BACKOFF_MS;
    const key = tutorialContentKey(notebookId, source.fileId);
    for (let attempt = 0; ; attempt += 1) {
      calls += 1;
      const timer = llm.kind === 'claude-cli' ? AbortSignal.timeout(deps.cliWindowTimeoutMs ?? CLI_WINDOW_TIMEOUT_MS) : undefined;
      try {
        return await callJson(
          deps,
          llm,
          {
            model: deps.models().orchestrator,
            max_tokens: TUTORIAL_MAX_TOKENS,
            system: request.system,
            messages: [{ role: 'user', content: request.content }],
            jsonSchema: TUTORIAL_JSON_SCHEMA,
            ...(shown.length > 0 ? { images: shown } : {}),
            meta: { scope: 'notes', costScope: 'tutorial', fileId: notebookId },
          },
          'tutorial',
          { retryErrors: false, ...(timer ? { signal: timer } : {}) },
        );
      } catch (caught) {
        // Our own wall clock on a CLI call that never answers (a dropped network): a timeout.
        const err = timer?.aborted ? Object.assign(new Error('the Claude CLI did not answer in time'), { code: 'ETIMEDOUT' }) : caught;
        if (err instanceof ReplyTruncated) throw new WindowTruncated('max_tokens');
        if (refused(err)) throw new WindowDeclined();
        // An answer that would not parse is most often one that was cut off on a backend that
        // does not say so: read smaller rather than give up.
        if (err instanceof SyntaxError) throw new WindowTruncated('malformed');
        if (!transient(err) || attempt >= waits.length) throw err;
        log().warn('tutorial.window.backoff', { doc_id: docId, from: w.from, to: w.to, attempt: attempt + 1, class: transientClass(err) });
        waitingReads.add(key);
        pushView(deps, notebookId, source.fileId);
        try {
          await new Promise((r) => setTimeout(r, waits[attempt]));
        } finally {
          waitingReads.delete(key);
          pushView(deps, notebookId, source.fileId);
        }
      }
    }
  };

  const readOne = async (w: SheetWindow): Promise<Record<string, unknown>> => {
    const kept = cache.get(w);
    if (kept) return kept;
    const startedAt = Date.now();
    const shown = await imagesOf(w.from, w.ahead ?? w.to);
    if (shown.length > 0) {
      if (images === 0) repo.setIngest(docId, { withImages: true }, nowOf(deps));
      images += shown.length;
    }
    const first = await ask(w, shown, false);
    if (!wholeAnswer(first)) throw new WindowTruncated('malformed');
    let raw: Record<string, unknown> = first;
    // Nothing copied from pages that have words on them (or that are pictures with no text layer,
    // a scan): asked once more, and empty again is a notice. Blank pages may come back empty.
    const ownText = pages.slice(w.from - 1, w.to).join('').length;
    const shouldHaveWords = ownText >= EMPTY_WINDOW_CHARS || (shown.length > 0 && ownText < SCANNED_CHARS);
    if ((raw.blocks as unknown[]).length === 0 && shouldHaveWords) {
      emptyRetries += 1;
      log().warn('tutorial.window.empty', { doc_id: docId, from: w.from, to: w.to, chars: ownText, images: shown.length });
      const second = await ask(w, shown, true);
      if (!wholeAnswer(second)) throw new WindowTruncated('malformed');
      if ((second.blocks as unknown[]).length === 0) throw new WindowEmpty();
      raw = second;
    }
    log().info('tutorial.window', {
      doc_id: docId,
      from: w.from,
      to: w.to,
      ahead: w.ahead,
      depth: w.depth,
      blocks: (raw.blocks as unknown[]).length,
      parts: (raw.parts as unknown[]).length,
      // Question numbers seen in the text, to compare with the parts read; a count, never words.
      markers: questionMarkers(pages.slice(w.from - 1, w.to).join('\n')),
      images: shown.length,
      ms: Date.now() - startedAt,
    });
    // Only an answer with something in it is kept for a resume: an empty one is asked again next
    // time, never replayed (acceptance test, 2026-11-19: Retry after "no questions" made no call).
    if ((raw.blocks as unknown[]).length > 0) cache.put(w, raw);
    return raw;
  };

  if (plan.length > 1) {
    repo.setIngest(docId, { windowsDone: 0, windowsTotal: plan.length }, nowOf(deps));
    pushView(deps, notebookId, source.fileId);
  }
  let total = plan.length;
  const progress = { windows: plan.length, splits: 0, calls: 0, resumed, notices: 0 };
  try {
    const outcome = await readWindows(plan, readOne, {
      progress: (done, now) => {
        total = now;
        repo.setIngest(docId, { windowsDone: done, windowsTotal: now }, nowOf(deps));
        if (now > 1) pushView(deps, notebookId, source.fileId);
      },
      split: (w, reason) => {
        progress.splits += 1;
        log().warn('tutorial.window.split', { doc_id: docId, from: w.from, to: w.to, depth: w.depth, reason });
      },
    });
    const notices = [...outcome.notices];
    if (filePages > pageCount) {
      notices.push({ from: pageCount + 1, to: filePages, reason: 'beyond_limit' });
      log().warn('tutorial.ingest.capped', { doc_id: docId, pages: filePages, read: pageCount });
    }
    const merged = mergeWindowReads(outcome.reads, notices, filePages);
    return {
      raw: merged.raw,
      images,
      windows: total,
      splits: outcome.splits,
      calls,
      resumed,
      emptyRetries,
      notices,
      merge: outcome.reads.length > 1 || notices.length > 0 ? merged.stats : null,
      cache,
    };
  } catch (err) {
    // The failure event says how far the read got; the windows read are kept for the retry.
    progress.windows = total;
    progress.calls = calls;
    if (err && typeof err === 'object') Object.assign(err, { readProgress: progress });
    throw err;
  }
}

interface SheetRead {
  raw: Record<string, unknown>;
  images: number;
  windows: number;
  splits: number;
  calls: number;
  resumed: number;
  emptyRetries: number;
  notices: WindowNotice[];
  merge: MergeStats | null;
  cache: WindowCache;
}

/** The whole page before a window, at most this much: a stem and its code fit. */
const PREVIOUS_PAGE_CHARS = 3_000;
/** A window whose pages hold at least this much text and come back with no block is asked again. */
const EMPTY_WINDOW_CHARS = 200;
/** Less text than this on pages with images: a scan, which must not come back empty either. */
const SCANNED_CHARS = 20;
/**
 * The longest one CLI call reading a window may take before it is killed and counted as a
 * transport failure. The slowest healthy window measured on the CLI took 104 s (CS1010, five
 * pages); a dropped network left a child hanging about 187 s, twelve times over.
 */
export const CLI_WINDOW_TIMEOUT_MS = 180_000;
/**
 * The waits before asking a window again after a transport failure: one, so a window is asked
 * at most twice over the transport. Then the read stops, and keeps what it has.
 */
export const TRANSIENT_BACKOFF_MS = [10_000];

/** Question numbers a page's text shows: `12.` on its own line, `Question 3`, `(b)`. */
export function questionMarkers(text: string): number {
  return (text.match(/^\s*(?:\d{1,3}\.\s*$|(?:question|problem|q)\s*\d+\b|\([a-h]\)\s)/gim) ?? []).length;
}

/** A safety classifier declined (`anthropic.ts`): nothing to retry, and nothing the learner can rephrase. */
function refused(err: unknown): boolean {
  return err instanceof Error && err.message === REFUSAL_MESSAGE;
}

/** What a transport failure was, for the log and the sentence: rate, overloaded, server, network. */
function transientClass(err: unknown): 'rate' | 'overloaded' | 'server' | 'network' | null {
  const e = err as { status?: unknown; name?: unknown; message?: unknown; code?: unknown } | null;
  const status = typeof e?.status === 'number' ? e.status : null;
  const message = typeof e?.message === 'string' ? e.message : '';
  if (status === 429 || /\b429\b|rate.?limit/i.test(message)) return 'rate';
  if (status === 529 || /\b529\b|overloaded/i.test(message)) return 'overloaded';
  if ((status !== null && status >= 500) || e?.name === 'CliApiError' || /\b5\d\d\b|api error/i.test(message)) return 'server';
  if (e?.name === 'APIConnectionError' || e?.name === 'APIConnectionTimeoutError' || /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network|fetch failed|terminated/i.test(message) || typeof e?.code === 'string') {
    return 'network';
  }
  return null;
}

function transient(err: unknown): boolean {
  if (err instanceof Error && (err.name === 'StudyCreditUsedUpError' || err.name === 'CliLimitError' || err.name === 'Yielded' || err.name === 'LlmAbortedError')) return false;
  if (signedOut(err) || noCli(err)) return false;
  return transientClass(err) !== null;
}

/** Claude Code is not signed in: its own error, or a 401 / expired token it passed on. */
function signedOut(err: unknown): boolean {
  if (err instanceof Error && err.name === 'ClaudeCliNotLoggedInError') return true;
  const message = err instanceof Error ? err.message : '';
  return /Claude CLI/i.test(message) && /authentication_error|authentication_failed|oauth token has expired|not logged in|\b401\b/i.test(message);
}

/** The `claude` binary is not there to run. */
function noCli(err: unknown): boolean {
  if (err instanceof Error && err.name === 'ClaudeCliNotFoundError') return true;
  const e = err as { code?: unknown; message?: unknown } | null;
  return e?.code === 'ENOENT' && typeof e.message === 'string' && /spawn/i.test(e.message);
}

/**
 * **What the learner reads when a read stops** (red team, 2026-11-18): true, short, and never
 * the SDK's JSON. A spent credit says what the credit message says; a transport failure says the
 * pages read are kept; anything else names its first line.
 */
export function readFailure(err: unknown): string {
  if (err instanceof NoParts) return MESSAGES.noParts;
  if (err instanceof SheetUnread) return err.message;
  const name = err instanceof Error ? err.name : '';
  const message = err instanceof Error ? err.message : String(err);
  if (name === 'Yielded' || name === 'StudyCreditUsedUpError') return message;
  if (signedOut(err)) return MESSAGES.signedOut;
  if (noCli(err)) return MESSAGES.noCli;
  if (name === 'CliLimitError') return MESSAGES.limit(/resets\s+([^)\n·]+?)(?:\s*\(|\)|$)/i.exec(message)?.[1]?.trim() ?? null);
  if ((err as { status?: unknown })?.status === 400) return MESSAGES.badRequest;
  if (/ECONNREFUSED|connection refused/i.test(message)) return MESSAGES.stopped('the connection to Claude was refused');
  switch (transientClass(err)) {
    case 'rate':
      return MESSAGES.stopped('Claude is limiting how fast this key can ask');
    case 'overloaded':
      return MESSAGES.stopped('Claude is overloaded right now');
    case 'server':
      return MESSAGES.stopped('Claude had a server error');
    case 'network':
      return MESSAGES.stopped('the connection to Claude dropped');
    default:
      break;
  }
  return MESSAGES.failed(shortReason(message));
}

/** Each page's text, trimmed: what the windows are planned and read from. */
function pageTexts(deps: Pick<TutorialDeps, 'notebooks'>, notebookId: string, pageBase: number, pageCount: number): string[] {
  return Array.from({ length: pageCount }, (_, i) =>
    deps.notebooks.textFor({ notebookId, pageFrom: pageBase + i + 1, pageTo: pageBase + i + 1 }).trim(),
  );
}

/** A window's pages under `[sheet p. k]`, the look-ahead page marked as the next call's. */
export function windowText(pages: readonly string[], w: SheetWindow): string {
  const out: string[] = [];
  const last = w.ahead ?? w.to;
  for (let k = w.from; k <= last; k += 1) {
    const body = pages[k - 1] || '(no text on this page: read it from its image)';
    out.push(k === w.ahead ? `[sheet p. ${k}: the next call's page, shown only to finish a part from p. ${w.to}]\n${body}` : `[sheet p. ${k}]\n${body}`);
  }
  return capText(out.join('\n\n'), SHEET_TEXT_CAP);
}

/** The sheet's text, each page under `[sheet p. k]`, its own numbering. */
export function sheetText(deps: Pick<TutorialDeps, 'notebooks'>, notebookId: string, pageBase: number, pageCount: number): string {
  const out: string[] = [];
  let chars = 0;
  for (let k = 1; k <= pageCount; k += 1) {
    const body = deps.notebooks.textFor({ notebookId, pageFrom: pageBase + k, pageTo: pageBase + k }).trim();
    const chunk = `[sheet p. ${k}]\n${body || '(no text on this page: read it from its image)'}`;
    if (chars + chunk.length > SHEET_TEXT_CAP) break;
    out.push(chunk);
    chars += chunk.length + 2;
  }
  return out.join('\n\n');
}

/**
 * **The second, independent pass** (`tutorials.md` §5): every part code did not verify is solved
 * again without the key, then each pair is compared; a disagreement marks the key `low`. When the
 * pass cannot run, the keys it would have checked are `low` too: unverified is not agreed.
 */
async function confirmKeys(
  deps: TutorialDeps,
  llm: LLMClient,
  notebookId: string,
  sheet: import('../../shared/tutorial.js').TutorialSheet,
  pageBase: number,
  parts: LandedPart[],
): Promise<{ disagreed: number; unverified: number }> {
  const sheetParts = new Map(
    sheet.blocks.filter((b): b is import('../../shared/tutorial.js').SheetPart => b.type === 'part').map((p) => [p.id, p]),
  );
  // The part with the problem it belongs to above it, as Help and Check see it: "(b) p[0] = 'b';"
  // is not solvable without the declarations its stem makes (red team, 2026-11-18).
  const inDoc = new Map(partAnswersOf(tutorialDoc(sheet, { pageBase }).toJSON()).map((a) => [a.partId, a]));
  // An official key carried through a re-read is the solutions' answer: nothing to re-solve.
  const open = parts.filter((p) => !p.key.check && p.key.answer.length > 0 && p.key.solutionEvidence?.version !== 1);
  if (open.length === 0) return { disagreed: 0, unverified: 0 };
  const describe = (id: string) => {
    const p = sheetParts.get(id)!;
    const answer = inDoc.get(id);
    return {
      partId: id,
      label: p.label,
      kind: p.answer.kind,
      prompt: answer ? promptInContext(answer) : promptText(p),
      options: p.answer.kind === 'choice' ? p.answer.options.map((o) => `(${o.id}) ${o.text}`).join('\n') : '',
    };
  };
  // In batches, so an exam's fifty parts stay inside each call's budget; a batch cut off is
  // halved; a batch that fails leaves only its own keys unverified.
  const confirm = async (batch: LandedPart[]): Promise<Map<string, boolean>> => {
    try {
      return await confirmBatch(deps, llm, notebookId, batch, describe);
    } catch (err) {
      if (err instanceof Error && err.name === 'Yielded') throw err;
      if (err instanceof ReplyTruncated && batch.length > 1) {
        const mid = Math.ceil(batch.length / 2);
        return new Map([...(await confirm(batch.slice(0, mid))), ...(await confirm(batch.slice(mid)))]);
      }
      log().warn('tutorial.confirm.failed', { notebook_id: notebookId, parts: batch.length, cause: (err as Error).message.slice(0, 200) });
      return new Map<string, boolean>();
    }
  };
  const verdicts = await mapLimit(batches(open, CONFIRM_BATCH_PARTS), WINDOW_CONCURRENCY, confirm);
  const agree = new Map(verdicts.flatMap((m) => [...m]));
  let disagreed = 0;
  let unverified = 0;
  for (const p of open) {
    const verdict = agree.get(p.partId);
    if (verdict === true) p.key.confidence = 'high';
    else {
      p.key.confidence = 'low';
      if (verdict === false) disagreed += 1;
      else unverified += 1;
    }
  }
  return { disagreed, unverified };
}

/** One batch of the second pass: re-solve without the key, then compare. Part id → agree. */
async function confirmBatch(
  deps: TutorialDeps,
  llm: LLMClient,
  notebookId: string,
  open: readonly LandedPart[],
  describe: (id: string) => { partId: string; label: string; kind: string; prompt: string; options: string },
): Promise<Map<string, boolean>> {
  const resolved = (await callJson(
    deps,
    llm,
    {
      model: deps.models().orchestrator,
      max_tokens: RESOLVE_MAX_TOKENS,
      system: [{ type: 'text', text: RESOLVE_SYSTEM }],
      messages: [{ role: 'user', content: resolveMessage(open.map((p) => describe(p.partId))) }],
      jsonSchema: RESOLVE_JSON_SCHEMA,
      meta: { scope: 'notes', costScope: 'tutorial', fileId: notebookId },
    },
    'tutorial.resolve',
  )) as { answers?: { partId?: unknown; answer?: unknown }[] };
  const second = new Map<string, string>();
  for (const a of Array.isArray(resolved.answers) ? resolved.answers : []) {
    if (typeof a.partId === 'string' && typeof a.answer === 'string' && a.answer.trim()) second.set(a.partId, a.answer.trim());
  }
  const pairs = open.filter((p) => second.has(p.partId));
  const compared = pairs.length
    ? ((await callJson(
        deps,
        llm,
        {
          model: deps.models().orchestrator,
          max_tokens: COMPARE_MAX_TOKENS,
          system: [{ type: 'text', text: COMPARE_SYSTEM }],
          messages: [
            {
              role: 'user',
              content: compareMessage(
                pairs.map((p) => ({ partId: p.partId, prompt: describe(p.partId).prompt, first: keyText(p.key), second: second.get(p.partId)! })),
              ),
            },
          ],
          jsonSchema: COMPARE_JSON_SCHEMA,
          meta: { scope: 'notes', costScope: 'tutorial', fileId: notebookId },
        },
        'tutorial.compare',
      )) as { parts?: { partId?: unknown; agree?: unknown }[] })
    : { parts: [] };
  const agree = new Map<string, boolean>();
  for (const c of Array.isArray(compared.parts) ? compared.parts : []) {
    if (typeof c.partId === 'string' && typeof c.agree === 'boolean') agree.set(c.partId, c.agree);
  }
  return agree;
}

/** A key as an answer to compare: its answer, and its blanks or options. */
function keyText(key: PartKey): string {
  return [
    key.answer,
    key.blanks ? Object.entries(key.blanks).map(([id, v]) => `${id}: ${v[0] ?? ''}`).join('\n') : '',
    key.correct ? `Correct options: ${key.correct.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function promptText(p: import('../../shared/tutorial.js').SheetPart): string {
  return p.prompt
    .map((b) => {
      switch (b.type) {
        case 'heading':
        case 'paragraph':
          return b.text;
        case 'list':
          return b.items.map((i) => `- ${i}`).join('\n');
        case 'math':
          return `$$${b.tex}$$`;
        case 'code':
          return b.text;
        case 'figure':
          return `[figure: ${b.caption}]`;
        default:
          return '';
      }
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * The document, the title and the part records, written. On a re-read the learner's answers are
 * carried by part id; the answers of parts the new reading lacks go under a final *Earlier
 * answers* heading rather than being lost. Agent edits that pointed into the old blocks go.
 */
function land(
  deps: TutorialDeps,
  at: { notebookId: string; fileId: string; docId: string; pageBase: number; firstRead: boolean; windows?: number },
  sheet: import('../../shared/tutorial.js').TutorialSheet,
  parts: readonly LandedPart[],
  model: string,
): void {
  const repo = notesRepo(deps.db);
  const now = nowOf(deps);
  let doc: Node = tutorialDoc(sheet, { pageBase: at.pageBase });
  const stored = repo.byId(at.docId);
  let carried = 0;
  let orphaned = 0;
  if (stored?.doc) {
    let previous: Node | null = null;
    try {
      previous = notesSchema.nodeFromJSON(stored.doc);
    } catch {
      previous = null;
    }
    if (previous && partAnswers(previous).length > 0) {
      const result = carryAnswers(previous, doc);
      carried = partAnswers(previous).length - result.orphans.length;
      orphaned = result.orphans.length;
      const children: Node[] = [];
      result.doc.forEach((n) => children.push(n));
      if (result.orphans.length > 0) {
        children.push(
          notesSchema.nodes.heading!.create(
            { level: 2, blockId: newBlockId(), pages: [], reason: 'earlier_answers', objectiveIds: [] },
            notesSchema.text('Earlier answers'),
          ),
          ...result.orphans,
        );
      }
      doc = notesSchema.nodes.doc!.create(null, children);
    }
  }
  if (!at.firstRead) repo.clearForRegenerate(at.docId);
  const windows = Math.max(1, at.windows ?? 1);
  repo.appendWindow({ docId: at.docId, doc: doc.toJSON(), ingest: { status: 'ready', windowsDone: windows, windowsTotal: windows, error: null, model } }, now);
  deps.db.prepare('UPDATE notes_docs SET title = @t, ingest_version = @v WHERE id = @id').run({ t: sheet.title, v: TUTORIAL_PROMPT_VERSION, id: at.docId });
  tutorialRepo(deps.db).landParts(at.docId, parts, now);
  log().info('tutorial.landed', { doc_id: at.docId, carried, orphaned });
  pushView(deps, at.notebookId, at.fileId);
}

function logLanding(
  notebookId: string,
  fileId: string,
  docId: string,
  startedAt: number,
  parts: readonly LandedPart[],
  repairs: TutorialRepairs,
  extra: {
    disagreed: number;
    unverified: number;
    images: number;
    windows: number;
    splits: number;
    calls: number;
    resumed: number;
    emptyRetries: number;
    carriedKeys: number;
    notices: { from: number; to: number; reason: string }[];
    merge: MergeStats | null;
  },
): void {
  log().info('tutorial.ingest', {
    notebook_id: notebookId,
    file_id: fileId,
    doc_id: docId,
    ms: Date.now() - startedAt,
    parts: parts.length,
    formal: parts.filter((p) => p.key.check).length,
    low_confidence: parts.filter((p) => p.key.confidence === 'low').length,
    disagreed: extra.disagreed,
    unverified: extra.unverified,
    linked_notes: parts.filter((p) => p.links.notesBlockIds.length > 0).length,
    linked_objectives: parts.filter((p) => p.objectiveIds.length > 0).length,
    images: extra.images,
    windows: extra.windows,
    splits: extra.splits,
    calls: extra.calls,
    resumed: extra.resumed,
    empty_retries: extra.emptyRetries,
    carried_keys: extra.carriedKeys,
    ...(extra.notices.length > 0 ? { notices: extra.notices } : {}),
    ...(extra.merge ? { merged: extra.merge } : {}),
    repaired: repairs,
  });
}

// ── the scripted backend ────────────────────────────────────────────────────────────────────

/**
 * The fixture sheet as a raw answer, through the same validation as a live one. Each part is
 * linked to the first notes block, the first lecture page and the first objective there are, so
 * a scripted sitting can hint, check and fill.
 */
function fixtureRaw(subject: NotebookSubject, firstBlock: string | null, objectiveId: string | null): unknown {
  const keys = fixtureKeys();
  const lecture = subject.sources.find((s) => s.role === 'lecture' && s.status === 'ready' && s.pageCount > 0);
  return {
    title: FIXTURE_SHEET.title,
    blocks: FIXTURE_SHEET.blocks,
    parts: FIXTURE_SHEET.blocks
      .filter((b) => b.type === 'part')
      .map((b) => {
        const key = keys.get((b as { id: string }).id);
        return {
          partId: (b as { id: string }).id,
          answer: key?.answer ?? '',
          blanks: key?.blanks ? Object.entries(key.blanks).map(([id, accepted]) => ({ id, accepted })) : [],
          correct: key?.correct ?? [],
          steps: key?.steps ?? [],
          mistakes: key?.mistakes ?? [],
          prerequisites: key?.prerequisites ?? [],
          formalCheck: key?.check ? JSON.stringify(key.check) : null,
          notesBlockIds: firstBlock ? [firstBlock] : [],
          pages: lecture ? [lecture.pageBase + 1] : [],
          objectiveIds: objectiveId ? [objectiveId] : [],
        };
      }),
  };
}

// ── official solutions ──────────────────────────────────────────────────────────────────────

function solutionsFor(subject: NotebookSubject | null, tutorialFileId: string) {
  return (subject?.sources ?? []).filter((s) => s.role === 'solutions' && s.keyFor === tutorialFileId && s.status === 'ready');
}

/**
 * **A source's role changed** (`notebook:setRole`, or the guess on read). Solutions for a tutorial
 * that has been read rewrite its keys, in the background. A new tutorial is not read here: the
 * renderer sends its page images first, then asks.
 */
export function onRoleChanged(deps: TutorialDeps, change: RoleChange): void {
  if (change.role !== 'solutions' || !change.keyFor) return;
  const key = tutorialContentKey(change.notebookId, change.keyFor);
  const record = tutorialRecord(deps, change.notebookId, change.keyFor);
  if (!record || record.ingestStatus !== 'ready' || inFlight.has(key)) return;
  start(key, rewriteKeys(deps, change.notebookId, change.keyFor).then(
    () => undefined,
    () => undefined,
  ));
}

/**
 * **The official solutions rewrite the key** (`tutorials.md` §5): one call over the parts and
 * the solutions' text (read here and nowhere else), and every part it answers gets a key
 * `from: 'solutions'`, `confidence: 'high'`. A formal check is kept: it still judges the learner's
 * answer, since any valid plan is right, not only the official one. Scripted: the existing keys
 * are marked as the official ones.
 */
export function rewriteKeys(deps: TutorialDeps, notebookId: string, tutorialFileId: string): Promise<number> {
  // One pass per sheet at a time: a second ask while one runs (a drop, a reopen, the end of a read)
  // shares it rather than paying for the same answer sheet twice (acceptance test, 2026-11-19).
  const key = tutorialContentKey(notebookId, tutorialFileId);
  const running = solutionsInFlight.get(key);
  if (running) return running;
  const pass = rewriteKeysNow(deps, notebookId, tutorialFileId).finally(() => solutionsInFlight.delete(key));
  solutionsInFlight.set(key, pass);
  return pass;
}

const solutionsInFlight = new Map<string, Promise<number>>();

async function rewriteKeysNow(deps: TutorialDeps, notebookId: string, tutorialFileId: string): Promise<number> {
  const subject = deps.notebooks.subject(notebookId);
  const record = tutorialRecord(deps, notebookId, tutorialFileId);
  const solutions = solutionsFor(subject, tutorialFileId);
  if (!record || solutions.length === 0) return 0;
  const answers = partAnswersOf(record.doc);
  const parts = tutorialRepo(deps.db);
  const now = nowOf(deps);
  const llm = deps.llm(notebookId);
  let rewritten = 0;
  let batchesFailed = 0;
  try {
    if (!llm) {
      for (const p of parts.parts(record.id)) {
        parts.setKey(record.id, p.partId, { ...p.key, from: 'solutions', confidence: 'high' }, now);
        rewritten += 1;
      }
    } else {
      const pages: SolutionPage[] = solutions.flatMap((s) =>
        Array.from({ length: s.pageCount }, (_, i) => ({
          fileId: s.fileId,
          page: i + 1,
          text: deps.notebooks.textFor({
            notebookId,
            pageFrom: s.pageBase + i + 1,
            pageTo: s.pageBase + i + 1,
            includeSolutions: true,
          }),
        })),
      );
      // Old keys have no evidence marker. Invalidate them before an asynchronous re-read, so a
      // Check arriving meanwhile cannot use a legacy "high" confidence solution key. A key this
      // version verified against a page is never taken back (red team, 2026-11-18: every
      // notebook open used to downgrade them all, then pay to verify them again).
      for (const p of parts.parts(record.id)) {
        if (p.key.from === 'solutions' && p.key.solutionEvidence?.version !== 1) {
          parts.setKey(record.id, p.partId, { ...p.key, confidence: 'low', solutionEvidence: undefined }, now);
        }
      }
      // Once per answer sheet: a part these solutions were already asked about, and did not
      // verify, is not asked about again until the solutions (or this pass) change.
      const marker = solutionsMarker(pages);
      const settled = (partId: string): boolean => {
        const tried = parts.part(record.id, partId)?.key.solutionsTried;
        return tried?.marker === marker && (tried.done || tried.fails >= SOLUTIONS_MAX_FAILS);
      };
      for (const answer of answers) {
        if (answer.kind !== 'choice') continue;
        // Verified already: nothing to write again on the next open.
        if (parts.part(record.id, answer.partId)?.key.solutionEvidence?.version === 1) continue;
        const evidence = choiceEvidenceFromText(pages, answer.partId, answer.label, answer.options);
        const current = parts.part(record.id, answer.partId);
        if (!evidence || !current) continue;
        parts.setKey(record.id, answer.partId, {
          ...current.key,
          answer: evidence.correct.join(', '),
          correct: evidence.correct,
          from: 'solutions',
          confidence: 'high',
          solutionEvidence: { fileId: evidence.fileId, page: evidence.page, method: evidence.method, version: 1 },
        }, now);
        rewritten += 1;
      }
      const unverified = answers.filter((a) => !parts.part(record.id, a.partId)?.key.solutionEvidence);
      const text = pages.map((p) => `=== source ${p.fileId}, page ${p.page} ===\n${p.text}`).join('\n\n');
      const images = (await Promise.all(solutions.map(async (s) => {
        const located = deps.notebooks.locate(notebookId, s.pageBase + 1);
        return located?.contentSha
          ? pageImagesFor(pageImageDir(deps.userDataDir, located.contentSha), Array.from({ length: Math.min(s.pageCount, TUTORIAL_MAX_IMAGES) }, (_, i) => i + 1))
          : [];
      }))).flat();
      // A choice the text did not settle can only be verified from the answer sheet's page images.
      // Until the renderer has sent them (a sheet just dropped in), such a part is not asked about
      // and not marked tried: the pass runs again once the images are there.
      const imagesReady = images.length > 0;
      const unresolved = unverified.filter((a) => !settled(a.partId) && (imagesReady || a.kind !== 'choice'));
      if (unresolved.length === 0) {
        log().info('tutorial.solutions', {
          notebook_id: notebookId,
          file_id: tutorialFileId,
          doc_id: record.id,
          rewritten,
          parts: answers.length,
          ...(unverified.length > 0 ? { settled: unverified.length } : {}),
        });
        if (rewritten > 0) pushView(deps, notebookId, tutorialFileId);
        return rewritten;
      }
      /** The parts asked about whose answer came back, and those whose batch failed. */
      const asked = new Set<string>();
      const failedParts = new Set<string>();
      // In batches of parts, each with the whole solutions text: one call's budget holds about a
      // dozen keys, and an exam has fifty. A batch cut off is halved; one that fails leaves its
      // parts' keys as they were.
      let failedBatches = 0;
      // Each batch is shown only the page images its parts' answers are on, when those can be
      // found by question number; a re-read used to pay for all thirteen pages on every batch.
      const imagesFor = (batch: readonly PartAnswer[]): StoredPageImage[] => {
        if (solutions.length !== 1) return images;
        const wanted = new Set<number>();
        for (const a of batch) {
          const on = pagesForPart(pages, a.partId, a.label);
          if (!on) return images;
          for (const p of on) wanted.add(p.page);
        }
        return images.filter((i) => wanted.has(i.page));
      };
      const readBatch = async (batch: PartAnswer[]): Promise<unknown[]> => {
        const shown = imagesFor(batch);
        try {
          const raw = (await callJson(
            deps,
            llm,
            {
              model: deps.models().orchestrator,
              max_tokens: SOLUTIONS_MAX_TOKENS,
              system: [{ type: 'text', text: SOLUTIONS_SYSTEM }],
              messages: [
                {
                  role: 'user',
                  content: solutionsMessage({
                    parts: batch.map((a) => ({
                      partId: a.partId,
                      label: a.label,
                      kind: a.kind,
                      // With its stem, so "(b)" is matched to the right worked answer.
                      prompt: promptInContext(a),
                      options: a.options.map((o) => `(${o.id}) ${o.text}`).join('\n'),
                      blanks: Object.keys(a.blanks),
                    })),
                    solutionsText: capText(text, SHEET_TEXT_CAP),
                  }),
                },
              ],
              jsonSchema: SOLUTIONS_JSON_SCHEMA,
              ...(shown.length > 0 ? { images: shown } : {}),
              meta: { scope: 'notes', costScope: 'solutions', fileId: notebookId },
            },
            'tutorial.solutions',
          )) as { parts?: unknown[] };
          for (const a of batch) asked.add(a.partId);
          return Array.isArray(raw.parts) ? raw.parts : [];
        } catch (err) {
          if (err instanceof Error && (err.name === 'Yielded' || err.name === 'StudyCreditUsedUpError')) throw err;
          if (err instanceof ReplyTruncated && batch.length > 1) {
            const mid = Math.ceil(batch.length / 2);
            return [...(await readBatch(batch.slice(0, mid))), ...(await readBatch(batch.slice(mid)))];
          }
          for (const a of batch) failedParts.add(a.partId);
          failedBatches += 1;
          log().warn('tutorial.solutions.batch_failed', { notebook_id: notebookId, parts: batch.length, cause: (err as Error).message.slice(0, 200) });
          return [];
        }
      };
      const raw = { parts: (await mapLimit(batches(unresolved, SOLUTIONS_BATCH_PARTS), WINDOW_CONCURRENCY, readBatch)).flat() };
      const byId = new Map(answers.map((a) => [a.partId, a]));
      const visualCandidates = new Map<string, { page: number; correct: string[] }>();
      for (const entry of Array.isArray(raw.parts) ? raw.parts : []) {
        const r = entry as Record<string, unknown>;
        const answer = typeof r.partId === 'string' ? byId.get(r.partId) : undefined;
        const current = answer ? parts.part(record.id, answer.partId) : null;
        if (!answer || !current) continue;
        if (current.key.solutionEvidence) continue;
        const page = Number(r.sourcePage);
        const quote = typeof r.sourceQuote === 'string' ? r.sourceQuote.trim() : '';
        const sourcePage = pages.find((p) => p.page === page && quoteOnPage(p.text, quote));
        const fresh = keyFrom(sheetPartOf(answer), r);
        if (!fresh.answer) continue;
        // For choices, a quote merely containing the question is not evidence of which options
        // are ticked. The deterministic parser above owns text-layer choice keys.
        if (answer.kind === 'choice') {
          if (solutions.length === 1 && fresh.correct?.length && images.some((i) => i.page === page)) {
            visualCandidates.set(answer.partId, { page, correct: fresh.correct });
          }
          continue;
        }
        const miss: QuoteMiss | null = quote.length === 0 ? 'no_quote' : !sourcePage ? 'quote_not_on_page' : !quoteSupportsAnswer(quote, fresh.answer) ? 'quote_without_answer' : null;
        if (miss) {
          // Why an official answer was not taken, by part and reason; never the text.
          log().debug('tutorial.solutions.unmatched', { doc_id: record.id, part_id: answer.partId, kind: answer.kind, reason: miss });
          continue;
        }
        if (!sourcePage) continue;
        parts.setKey(
          record.id,
          answer.partId,
          { ...fresh, ...(current.key.check ? { check: current.key.check } : {}), from: 'solutions', confidence: 'high',
            solutionEvidence: { fileId: sourcePage.fileId, page, method: 'text', version: 1 } },
          now,
        );
        rewritten += 1;
      }
      if (visualCandidates.size > 0 && images.length > 0) {
        const candidates = unresolved.filter((a) => visualCandidates.has(a.partId));
        const reads = await mapLimit(batches(candidates, SOLUTIONS_BATCH_PARTS), WINDOW_CONCURRENCY, async (batch) => {
          try {
          const got = (await callJson(deps, llm, {
            model: deps.models().orchestrator,
            max_tokens: 1_200,
            system: [{ type: 'text', text: VISUAL_CHOICES_SYSTEM }],
            messages: [{ role: 'user', content: batch
              .map((a) => `PART ${a.partId} (${a.label})\n${a.prompt}\n${a.options.map((o) => `(${o.id}) ${o.text}`).join('\n')}`)
              .join('\n\n') }],
            images: imagesFor(batch),
            jsonSchema: VISUAL_CHOICES_JSON_SCHEMA,
            meta: { scope: 'notes', costScope: 'solutions', fileId: notebookId },
          }, 'tutorial.solutions.visual')) as { parts?: unknown[] };
          return Array.isArray(got.parts) ? got.parts : [];
          } catch (err) {
            if (err instanceof Error && (err.name === 'Yielded' || err.name === 'StudyCreditUsedUpError')) throw err;
            for (const a of batch) failedParts.add(a.partId);
            failedBatches += 1;
            log().warn('tutorial.solutions.batch_failed', { notebook_id: notebookId, parts: batch.length, visual: true, cause: (err as Error).message.slice(0, 200) });
            return [];
          }
        });
        const independent = { parts: reads.flat() };
        for (const entry of Array.isArray(independent.parts) ? independent.parts : []) {
          const r = entry as Record<string, unknown>;
          const answer = typeof r.partId === 'string' ? byId.get(r.partId) : undefined;
          const candidate = answer ? visualCandidates.get(answer.partId) : undefined;
          const correct = Array.isArray(r.correct) ? r.correct.filter((id): id is string => typeof id === 'string') : [];
          if (!answer || !candidate || candidate.page !== r.sourcePage ||
              correct.length !== candidate.correct.length ||
              !correct.every((id) => candidate.correct.includes(id))) continue;
          const source = solutions.length === 1 ? solutions[0] : undefined;
          if (!source) continue;
          const current = parts.part(record.id, answer.partId);
          if (!current) continue;
          parts.setKey(record.id, answer.partId, { ...current.key, answer: candidate.correct.join(', '),
            correct: candidate.correct, from: 'solutions', confidence: 'high',
            solutionEvidence: { fileId: source.fileId, page: candidate.page, method: 'image', version: 1 } }, now);
          rewritten += 1;
        }
      }
      batchesFailed = failedBatches;
      // What these solutions could not verify is settled for them: asked once, or failed twice.
      for (const a of unresolved) {
        const current = parts.part(record.id, a.partId);
        if (!current || current.key.solutionEvidence) continue;
        const before = current.key.solutionsTried?.marker === marker ? current.key.solutionsTried : null;
        const done = asked.has(a.partId) && !failedParts.has(a.partId);
        const fails = (before?.fails ?? 0) + (done ? 0 : 1);
        parts.setKey(record.id, a.partId, { ...current.key, solutionsTried: { marker, done, fails } }, now);
      }
    }
    log().info('tutorial.solutions', {
      notebook_id: notebookId,
      file_id: tutorialFileId,
      doc_id: record.id,
      rewritten,
      parts: answers.length,
      ...(batchesFailed > 0 ? { batches_failed: batchesFailed } : {}),
    });
  } catch (err) {
    log().error('tutorial.solutions.failed', { notebook_id: notebookId, file_id: tutorialFileId, cause: (err as Error).message.slice(0, 200) });
  }
  pushView(deps, notebookId, tutorialFileId);
  return rewritten;
}

/** Enough of a sheet part, rebuilt from the document, for `keyFrom`'s filtering. */
function sheetPartOf(a: PartAnswer): import('../../shared/tutorial.js').SheetPart {
  const answer =
    a.kind === 'blanks'
      ? { kind: 'blanks' as const, blanks: Object.keys(a.blanks) }
      : a.kind === 'choice'
        ? { kind: 'choice' as const, multi: true, options: a.options }
        : { kind: a.kind };
  return { type: 'part', id: a.partId, label: a.label, page: 1, prompt: [], answer };
}

/** How many failed tries settle a part for one answer sheet. */
const SOLUTIONS_MAX_FAILS = 2;
/** Moves when the solutions pass changes what it can verify, so every part is asked again once. */
const SOLUTIONS_PASS_VERSION = 4;

/** The answer sheet as this pass saw it: its pages' words, and the pass's version. */
function solutionsMarker(pages: readonly SolutionPage[]): string {
  const hash = createHash('sha256').update(String(SOLUTIONS_PASS_VERSION));
  for (const p of pages) hash.update(`\u0000${p.fileId}\u0000${p.page}\u0000${p.text}`);
  return hash.digest('hex').slice(0, 16);
}

/** Used by the help context: the label a lecture page's citation chip shows. */
export function slideLabel(subject: NotebookSubject, page: number): string {
  return citationLabel(subject.sources, [page]) || `p. ${page}`;
}
