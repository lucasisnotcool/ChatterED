/**
 * The IPC contract. The preload bridge exposes exactly this and nothing else
 * (architecture-mac.md §C.1: "IPC bridge — contextIsolation, preload allowlist").
 */
import type {
  ApiProvider,
  Bootstrap,
  ConceptDraft,
  CreateSessionInput,
  DocumentView,
  RecapView,
  RelayAttribution,
  RoomEvent,
  RoomSnapshot,
  ProviderTestResult,
  SettingsPatch,
  SettingsView,
  TeachbackResult,
  WhisperThreadView,
  AppCommand,
  WindowState,
} from './types.js';
import type { SegmentDocumentView } from './segment/types.js';
import type { AddSourcesResult, NotebookChange, NotebookSummary, NotebookView } from './notebook.js';
import type { PageLinesView } from './doc/cite.js';
import type { LearningObjectiveState, LearningTree } from './objectives.js';
import type {
  CostAnalytics,
  CostAnalyticsQuery,
  CostCallView,
  CostMessageCost,
  CostMessageQuery,
  CostSummary,
  CostSummaryQuery,
  CostUpdate,
} from './cost.js';
import type { StopTurnResult, TurnTraceView } from './types.js';
import type { TrialApi } from './trial.js';

import type {
  AgentAuthor,
  BlockActionKind,
  ChatResetResult,
  ChatView,
  DocEditStatus,
  GeneratedBlockKind,
  NotesDocView,
  NotesRegenerateResult,
  PageImage,
  PrivateTurnView,
  OverviewMeta,
  ProgressView,
  Suggestion,
} from './doc/types.js';
export const IPC = {
  bootstrap: 'app:bootstrap',
  setApiKey: 'app:setApiKey',
  clearApiKey: 'app:clearApiKey',
  completeFirstRun: 'app:completeFirstRun',
  getSettings: 'app:getSettings',
  saveSettings: 'app:saveSettings',
  detectCli: 'app:detectCli',
  // BYOK providers (2026-09-25). Bodies in `src/main/llm/providerservice.ts`.
  setProviderKey: 'app:setProviderKey',
  clearProviderKey: 'app:clearProviderKey',
  testProvider: 'app:testProvider',
  draftConcept: 'session:draftConcept',
  createSession: 'session:create',
  openRoom: 'room:open',
  sendMessage: 'room:send',
  typing: 'room:typing',
  holdTimer: 'room:hold',
  pauseNudges: 'room:pauseNudges',
  wrapUp: 'room:wrapUp',
  /** The **Retry** on a failed-turn card (`TurnFailureView`). */
  retryTurn: 'room:retryTurn',
  /** renderer → main: a `window.onerror` or an unhandled rejection inside the webview. */
  logRendererError: 'app:logRendererError',
  /** Settings ▸ Open log folder / Copy diagnostics. */
  openLogFolder: 'app:openLogFolder',
  diagnostics: 'app:diagnostics',
  acceptTeachback: 'room:acceptTeachback',
  openWhisper: 'whisper:open',
  sendWhisper: 'whisper:send',
  relayWhisper: 'whisper:relay',
  closeWhisper: 'whisper:close',
  event: 'room:event',
  /** main → renderer: the window entered or left macOS fullscreen (issue #21). */
  windowState: 'app:windowState',
  /** main → renderer: an application-menu item, or a trackpad swipe, was used. */
  appCommand: 'app:command',

  // The vault (issue #22).
  vaultDocument: 'vault:document',

  // The flow's segments (issue #25).
  segmentsGet: 'segments:get',
  segmentsSplit: 'segments:split',
  segmentsMerge: 'segments:merge',
  segmentsReorder: 'segments:reorder',
  segmentsRename: 'segments:rename',

  /**
   * Turn status (cui-standards-audit.md §2 / §10, issue #34).
   *
   * The two survivors of the retired crop flow's `flow:*` surface (#48). They keep their channel
   * names because they are about a **turn**, not about the screen it is drawn on, and renaming a
   * live channel buys nothing: the chat column's Stop calls the first, the ⌥⌘D drawer the second.
   */
  /** **Stop** on a generating turn. Refused while the floor is still running. */
  flowStop: 'flow:stop',
  /** One turn's timings for the ⌥⌘D debug drawer. No bodies. */
  flowTurnTrace: 'flow:turnTrace',

  // The learning-objective tree (issue #38, `docs/research/learning-objectives.md` §6).
  objectivesTree: 'objectives:tree',
  objectivesStates: 'objectives:states',
  objectivesRegenerate: 'objectives:regenerate',
  objectivesReset: 'objectives:reset',
  objectivesTeach: 'objectives:teach',

  // What the app has spent (`src/shared/cost.ts`, `src/main/cost/`).
  costSummary: 'cost:summary',
  costRecent: 'cost:recent',
  costExport: 'cost:export',
  /** What each reply in a room cost, joined on `turn_id` (#42 item B, migration 021). */
  costMessages: 'cost:messages',
  /** Every panel of the Usage page, aggregated in SQLite (#42 item D). */
  costAnalytics: 'cost:analytics',
  /** main → renderer: one call was just recorded, with the deltas, so a counter can tick. */
  costUpdated: 'cost:updated',

  // ── collab-doc (#48, docs/research/collab-doc.md) ────────────────────────────────────────
  // The lecture-notes document. Bodies in `src/main/notes/ipc.ts`.
  notesGet: 'notes:get',
  notesIngest: 'notes:ingest',
  notesPageImages: 'notes:pageImages',
  notesSave: 'notes:save',
  notesFreeze: 'notes:freeze',
  notesEditResolved: 'notes:editResolved',
  notesSuggestionResolved: 'notes:suggestionResolved',
  notesRegenerate: 'notes:regenerate',
  /** One slide's text lines with their boxes. Body in `src/main/notes/pagelines.ts`. */
  notesPageLines: 'notes:pageLines',
  // The chats. Bodies in `src/main/docroom/ipc.ts`.
  notesDocText: 'notes:docText',
  notesAnswerQuestion: 'notes:answerQuestion',
  notesGenerateBlock: 'notes:generateBlock',
  chatThreads: 'chat:threads',
  chatSend: 'chat:send',
  chatOpenSpan: 'chat:openSpan',
  chatPrivateOpen: 'chat:privateOpen',
  chatPrivateSend: 'chat:privateSend',
  chatInsertIntoDoc: 'chat:insertIntoDoc',
  quizPass: 'quiz:pass',
  chatReset: 'chat:reset',
  chatCloseFile: 'chat:closeFile',
  // Progress. Bodies in `src/main/docroom/progress.ts`.
  progressGet: 'progress:get',
  progressStart: 'progress:start',

  // ── notebooks (`docs/research/notebooks.md`, 2026-10-01) ─────────────────────────────────
  // Bodies in `src/main/notebooks/ipc.ts`. See `app/docs/NOTEBOOK-CONTRACT.md`.
  notebookList: 'notebook:list',
  notebookGet: 'notebook:get',
  notebookCreate: 'notebook:create',
  notebookRename: 'notebook:rename',
  notebookDelete: 'notebook:delete',
  notebookOpen: 'notebook:open',
  notebookPickFiles: 'notebook:pickFiles',
  notebookAddSources: 'notebook:addSources',
  notebookSetEnabled: 'notebook:setEnabled',
  notebookRemoveSource: 'notebook:removeSource',
  /** main → renderer: a notebook or one of its sources changed (added, read, ticked, removed). */
  notebookChanged: 'notebook:changed',
  // The overview. Bodies in `src/main/notes/ipc.ts`.
  notesUpdateOverview: 'notes:updateOverview',
  notesSetRecommendation: 'notes:setRecommendation',
  // Block actions. Body in `src/main/docroom/ipc.ts`.
  notesBlockAction: 'notes:blockAction',
} as const;

export interface ChatterEdApi {
  /** The experimental trial: consent and the research export (`shared/trial.ts`). */
  trial: TrialApi;
  bootstrap(): Promise<Bootstrap>;
  /** Stored in <userData>/anthropic-api-key, mode 0600. Never written to SQLite (#15). */
  setApiKey(key: string): Promise<{ ok: boolean; error?: string }>;
  clearApiKey(): Promise<void>;
  completeFirstRun(): Promise<void>;

  getSettings(): Promise<SettingsView>;
  /** Returns the settings as they now are, or the reason the patch was refused. */
  saveSettings(patch: SettingsPatch): Promise<{ ok: boolean; error?: string; settings?: SettingsView }>;
  /**
   * Spawns `claude` once to check the binary and the login. Costs one Haiku round trip, so it
   * is cached — `force` is the "Check again" button (issue #19).
   */
  detectCli(input?: { force?: boolean }): Promise<SettingsView>;
  /**
   * One provider's key, stored in its own 0600 file under Application Support (`anthropic` is the
   * same file `setApiKey` writes). The key never comes back across IPC — Settings sees `••••1a2b`.
   */
  setProviderKey(input: { provider: ApiProvider; key: string }): Promise<{ ok: boolean; error?: string }>;
  clearProviderKey(input: { provider: ApiProvider }): Promise<void>;
  /** Settings ▸ Test connection: one tiny call to that provider on its fast-lane model. */
  testProvider(input: { provider: ApiProvider }): Promise<ProviderTestResult>;

  /** Turns pasted text into a draft concept + 3–5 claim rows the learner then edits. */
  draftConcept(input: { moduleCode: string; title: string; text: string }): Promise<ConceptDraft>;
  createSession(input: CreateSessionInput): Promise<{ roomId: string }>;

  openRoom(roomId: string): Promise<RoomSnapshot>;
  sendMessage(input: { roomId: string; text: string }): Promise<void>;
  /** Typing heartbeat. Rate-limited by the renderer to at most one per 3 s (§C.3). */
  typing(input: { roomId: string; textLen: number }): Promise<void>;
  /** The composer's `Hold` control: +60 s, posts nothing. */
  holdTimer(input: { roomId: string }): Promise<void>;
  /** `Wait for me`: pauses nudges for this round, with an undo. */
  pauseNudges(input: { roomId: string; paused: boolean }): Promise<void>;
  wrapUp(input: { roomId: string }): Promise<RecapView>;
  /**
   * Replay the turn a `turn.failed` card is about.
   *
   * It takes the **failure id**, not a message or a trigger, so the renderer cannot ask for a
   * turn that never happened: the main process holds the trigger and the anchor the failed turn
   * ran with, and replays exactly those (`actor.retryTurn`).
   */
  retryTurn(input: { roomId: string; failureId: string }): Promise<void>;

  /**
   * Forward a renderer-side failure into `main.log`.
   *
   * A `window.onerror` in the webview is invisible to the main process and dies with the window;
   * this is how a broken render lands in the same file, with the same timestamps, as the turn it
   * broke. A class, a message and a source location — never a DOM node, never page text.
   */
  logRendererError(input: {
    kind: 'error' | 'unhandledrejection';
    name: string;
    message: string;
    source?: string;
    line?: number;
  }): Promise<void>;
  /** Settings ▸ **Open log folder**: reveals `~/Library/Logs/ChatterED` in Finder. */
  openLogFolder(): Promise<void>;
  /** Settings ▸ **Copy diagnostics**: version, build, backend, models and the last 50 log lines. */
  diagnostics(): Promise<string>;
  /**
   * "Yes, invite Theo" on the recap. Records the acceptance and says what happens next; Theo's
   * round itself is A2 and `available` is false until it exists.
   */
  acceptTeachback(input: { roomId: string; agentKey: string }): Promise<TeachbackResult>;

  openWhisper(input: { roomId: string; agentKey: string }): Promise<WhisperThreadView>;
  sendWhisper(input: { roomId: string; threadId: string; text: string }): Promise<void>;
  relayWhisper(input: {
    roomId: string;
    threadId: string;
    whisperId: string;
    attribution: RelayAttribution;
    text: string;
  }): Promise<void>;
  closeWhisper(input: { roomId: string; threadId: string }): Promise<void>;

  /** Subscribe to pushed room events. Returns an unsubscribe function. */
  onEvent(listener: (event: RoomEvent) => void): () => void;

  // ── Source bytes (the vault's one survivor; notebooks own the rest, issue #58) ───
  /**
   * Everything the document pane needs for one source file. PDF and image bytes come back over
   * IPC as a Uint8Array rather than through a custom protocol: the renderer then holds no URL it
   * could re-request, and a file it was never handed stays unreachable.
   */
  openDocument(input: { fileId: string }): Promise<DocumentView>;

  // ── The flow's segments (issue #25) ─────────────────────────────────────
  /**
   * The flow for one document: whole-page segments, the candidate ticks inside each, the build
   * chips, and a notice when the document is not a slide deck.
   *
   * Runs stages 0–3 on the first call for these bytes and caches the result against
   * `content_sha`; every later call is a SQLite read. **No model call, ever** (issue #25
   * decision 4), so this works with the network off and costs nothing per page.
   */
  getSegments(input: { fileId: string }): Promise<SegmentDocumentView>;
  /**
   * Split one segment. `at` is normalised — a `y` for a horizontal cut, an `x` for a vertical
   * one. It snaps to a candidate within ~8 pt unless `free` is set, and is **refused** if the
   * resulting line would cross a figure: the view comes back unchanged with `refused` set.
   */
  splitSegment(input: {
    fileId: string;
    segmentId: string;
    at: number;
    axis?: 'horizontal' | 'vertical';
    free?: boolean;
  }): Promise<SegmentDocumentView>;
  /** Same-page merge of two adjacent segments — the undo of a split. */
  mergeSegments(input: { fileId: string; segmentIds: [string, string] }): Promise<SegmentDocumentView>;
  /** Move a card in the flow. Pixels never move. */
  reorderSegments(input: { fileId: string; segmentId: string; toIndex: number }): Promise<SegmentDocumentView>;
  /** Rename a segment. Labels are the learner's, and the text-layer guess is only a default. */
  renameSegment(input: { fileId: string; segmentId: string; label: string }): Promise<SegmentDocumentView>;

  // ── Turn status (audit §2 / §7 / §10, issue #34) ────────────────────────
  /**
   * **Stop** a turn that is generating.
   *
   * Lucas's decision of 16 Sep 2026: *Stop appears only after the floor has elapsed*. A learner
   * who can cancel every Tester turn can opt out of the retrieval practice the app exists for,
   * so the deliberate wait cannot be skipped — but a hung backend can always be escaped. A stop
   * during the floor comes back `{ stopped: false, refused: 'floor' }` and the renderer should
   * not have offered the button yet; `turnId` comes from `turn.received` or `turn.delta`.
   *
   * What a stop does: aborts the client call (the CLI child process is killed), keeps whatever
   * text had already arrived as the message with `stopped: true`, releases the floor, and
   * **does not count as a failure** — no card, no Retry, and the silence timer does not nudge
   * on top of it.
   */
  flowStop(input: { roomId: string; turnId: string }): Promise<StopTurnResult>;
  /**
   * Per-turn timings for the debug drawer, newest last. Omit `turnId` for the whole in-memory
   * ring (the last 50 turns of the open room). Bodies are never in it.
   */
  flowTurnTrace(input: { roomId: string; turnId?: string | null }): Promise<TurnTraceView[]>;

  // ── The learning-objective tree (issue #38) ─────────────────────────────
  /**
   * The file's tree, or **null when no ingest has ever been asked for this file**.
   *
   * The deviation from spec §6 (`→ LearningTree`) is argued at the top of `shared/objectives.ts`:
   * a deck the flow has never opened has no row, and a synthesised `pending` one would put
   * "Ellie is reading the deck…" on screen for a deck nobody is reading. Every other state —
   * including a failed ingest — comes back as a real tree carrying its `status`.
   *
   * Never blocks on the model: the ingest runs in the background from the first `segments:get`
   * that succeeds on a PDF, and its progress arrives as `objectives.tree` events.
   */
  objectivesTree(input: { fileId: string }): Promise<LearningTree | null>;
  /** The file's states, one per objective the learner has moved. Missing ⟹ level 0. */
  objectivesStates(input: { fileId: string }): Promise<LearningObjectiveState[]>;
  /**
   * **Regenerate** in the panel header. Drops the cached tree and ingests again, keeping the
   * states whose objective ids still match (§3) — an id is `sha1(content_sha + title)`, so a
   * node whose title survives the re-read keeps the level the learner earned on it.
   */
  objectivesRegenerate(input: { fileId: string }): Promise<LearningTree | null>;
  /**
   * **Reset** (§4): every state to level 0, evidence cleared, `taughtAt` cleared. The tree
   * stays. One confirm on the renderer side — the main process does not ask twice.
   *
   * Returns the reset states so the panel redraws from the answer rather than racing the
   * per-node events.
   */
  objectivesReset(input: { fileId: string }): Promise<LearningObjectiveState[]>;
  /**
   * **Teach me this** on a prerequisite the deck assumes (§5, #36's contract).
   *
   * A Teacher turn anchored to the requiring objective's first ref — or to the deck anchor when
   * nothing in the deck refers to it — explained from general knowledge rather than from a slide
   * that does not mention it, and marking `taughtAt` so the Tester may later quiz it.
   *
   * Returns where the turn landed, so the flow can scroll to it; `null` when the objective is
   * not in the file's tree.
   */
  objectivesTeach(input: { fileId: string; objectiveId: string }): Promise<{
    roomId: string;
    anchorId: string;
    objectiveId: string;
  } | null>;

  // ── What the app has spent (`src/shared/cost.ts`) ───────────────────────
  /**
   * Tokens, calls and a dollar **estimate** at one of the three levels.
   *
   * `level: 'app'` spans everything, including the background ingest and every call that belongs
   * to no document. `'file'` needs a `fileId` and covers every room on that document plus its
   * ingest and its objectives tree. `'thread'` needs an `anchorId` and covers one segment's
   * conversation — its REFERENCE answers, its agent turns and the orchestrator and ledger calls
   * those turns made. The three nest: **thread ≤ file ≤ app**.
   *
   * `since` is an ISO timestamp, the literal `SESSION_WINDOW` for "since this app launched", or
   * omitted for all time. On the CLI path the answer also carries `cliWindow` — the rolling
   * 5-hour burn, which on a subscription is the constraint that actually bites.
   *
   * **Every dollar figure on this channel is labelled by `mode`**, and a renderer must use
   * `usdLabel()` rather than printing one bare: on the default backend nobody is being billed
   * per token and "API-equivalent" is the only true thing to call it.
   */
  costSummary(input: CostSummaryQuery): Promise<CostSummary>;
  /** The last `limit` calls, newest first, for the debug drawer. Sizes and ids, never bodies. */
  costRecent(input?: { limit?: number }): Promise<CostCallView[]>;
  /**
   * Write `~/Documents/ChatterED/usage-<date>.csv` — one row per call, no message bodies — and
   * return where it went. A second export on the same day replaces the first.
   */
  costExport(input?: { since?: string | null }): Promise<{ path: string; rows: number; bytes: number }>;
  /**
   * **What each message in a room cost** — the level the other three cannot reach, because it is
   * a sum over a *causal set* and not over a filter: every call made on one reply's behalf (the
   * turn that wrote it, the decision that chose the speaker, the ledger coding of the learner
   * message it answered, the doc-edit planner it triggered).
   *
   * One call answers a whole column; `cost.updated` keeps it current afterwards, matched by the
   * `turnId` the event already carries. A message with no row is one written by a rule, or one
   * recorded before migration 021 — the renderer shows no meter there rather than a zero.
   */
  costMessages(input: CostMessageQuery): Promise<CostMessageCost[]>;
  /**
   * **The Usage page, in one call.** Totals and this session; documents ranked with their ingest
   * split out; tokens by scope, by model, by backend and by day; the rolling 5-hour window; cost
   * per learner message; cache hit share; the slowest and priciest recent calls; and what was
   * killed. Filters: time range, document, backend. No learner text, ever.
   */
  costAnalytics(input?: CostAnalyticsQuery): Promise<CostAnalytics>;
  /**
   * Subscribe to the per-call tick. Fires after every recorded call and carries the **delta**
   * plus the running session totals, so three counters can be updated without re-asking.
   */
  onCostUpdated(listener: (update: CostUpdate) => void): () => void;

  /**
   * Subscribe to application-menu commands.
   *
   * ⌘+ / ⌘− / ⌘0 are **ChatterED's**, not Chromium's: the default Electron menu bound them to
   * `zoomIn`/`zoomOut`/`resetZoom`, which scale the whole application chrome — sidebar, rail,
   * composer and all — instead of the PDF (ui-review-code.md §4). The menu sends its intent
   * here; the renderer routes it to whichever viewer is open.
   */
  onAppCommand(listener: (command: AppCommand) => void): () => void;

  /**
   * Subscribe to window chrome changes. The only thing the renderer needs from the window is
   * whether macOS is currently drawing the traffic lights over its top-left corner: in
   * fullscreen it is not, and the reserved spacer must collapse (issue #21).
   */
  onWindowState(listener: (state: WindowState) => void): () => void;

  // ── collab-doc (#48) ─────────────────────────────────────────────────────────────────────
  // Payloads are the contract types in `shared/doc/types.ts`; see `app/docs/COLLAB-CONTRACT.md`.

  /** The notes doc for a file, or null when it has never been ingested. Never starts an ingest. */
  notesGet(input: { fileId: string }): Promise<NotesDocView | null>;
  /**
   * Start (or, with `force`, redo) the two-pass ingest. Resolves as soon as the doc row exists —
   * the windows arrive as `notes.window` / `notes.status` events. A doc the learner has edited is
   * never re-ingested over unless `force` is set.
   */
  notesIngest(input: { fileId: string; force?: boolean }): Promise<NotesDocView>;
  /**
   * **Regenerate Notes**: main asks the learner to confirm (a native sheet) and clears what points
   * into the old document. On `confirmed` the renderer re-sends the page images and calls
   * `notesIngest` with `force`. Refused while the deck is still being written.
   */
  notesRegenerate(input: { fileId: string }): Promise<NotesRegenerateResult>;
  /**
   * Page images for the refine pass, sent in batches **before** `notesIngest`. Optional: with
   * none, the ingest runs on structured text + geometry. Main cannot rasterise a PDF.
   */
  notesPageImages(input: { fileId: string; images: PageImage[]; done: boolean }): Promise<{ stored: number }>;
  /**
   * One slide's own text with its boxes, normalised 0 to 1: what the provenance chip's preview
   * outlines and what an inline figure's hotspots sit on (`shared/doc/cite.ts`). Read from the
   * ingest's pass 1, cached per file and page.
   */
  notesPageLines(input: { fileId: string; page: number }): Promise<PageLinesView>;
  /**
   * Persist the renderer's doc. Optimistic: `baseVersion` must be the stored version, else the
   * stored doc comes back as a conflict and the renderer rebases.
   */
  notesSave(input: {
    docId: string;
    baseVersion: number;
    doc: unknown;
    learnerTouched: boolean;
  }): Promise<{ ok: true; version: number } | { ok: false; conflict: true; version: number; doc: unknown }>;
  notesFreeze(input: { docId: string; frozen: boolean }): Promise<{ frozen: boolean }>;
  /** What became of an agent edit in the renderer: applied, kept, removed, dropped or guarded. */
  notesEditResolved(input: {
    docId: string;
    editId: string;
    status: DocEditStatus;
    blockIds: string[];
    docVersion: number;
    /** Set when the guard turned (part of) the batch into a suggestion. */
    suggestion?: Suggestion | null;
  }): Promise<void>;
  notesSuggestionResolved(input: {
    docId: string;
    suggestionId: string;
    status: 'accepted' | 'rejected';
  }): Promise<void>;
  /**
   * The learner paused after writing in the doc (brief §6). Main decides whether it maps to an
   * objective and is long enough to be an attempt; if so it becomes a `doc_text` learner message
   * in that span's thread and Max assesses it.
   */
  notesDocText(input: {
    fileId: string;
    docId: string;
    blockId: string;
    text: string;
  }): Promise<{ assessed: boolean; threadId: string | null; reason: string | null }>;
  /**
   * **The learner answered a question where it sits, inside its Q block** (brief §5.5, §5.6;
   * 2026-10-01). An explicit Submit, so none of `notesDocText`'s pause and length rules apply: a
   * one-word answer to a fill-in-the-blank is an answer.
   *
   * `askedBy: 'max'` is an attempt on Max's open question and is marked exactly as a chat answer
   * is, in the thread he asked it in; it is refused (`not_open`) when that question is not the
   * open one. `askedBy: 'user'` is a question the learner wrote themselves: Max marks the answer
   * in a thread anchored to the Q block, and it fills no progress.
   */
  notesAnswerQuestion(input: NotesAnswerQuestionInput): Promise<NotesAnswerQuestionResult>;
  /**
   * **The learner asked for a table or a diagram at a place in the notes** (brief §5.7,
   * 2026-10-01). Ellie writes it from the section around `blockId` and the slides that section
   * came from, and it arrives as an ordinary agent edit (`doc.edit`) inserted after that block:
   * green, with Remove · Keep, under the guard. Nothing is inserted when the doc is frozen, when
   * the model says the section has nothing to tabulate or draw, or when its reply does not pass
   * validation; `reason` says which.
   */
  notesGenerateBlock(input: NotesGenerateBlockInput): Promise<NotesGenerateBlockResult>;

  /** Every thread on the file's room: the doc chat, span threads, and the two private threads. */
  chatThreads(input: { fileId: string }): Promise<ChatView>;
  /** Creates the room on the first message. `threadId` defaults to the doc chat. */
  chatSend(input: { fileId: string; threadId?: string; text: string }): Promise<{ roomId: string; threadId: string }>;
  /** Highlight + Ctrl+E: a question anchored to a span. */
  chatOpenSpan(input: {
    fileId: string;
    blockId: string;
    quote: string;
    question: string;
  }): Promise<{ roomId: string; threadId: string }>;
  chatPrivateOpen(input: {
    fileId: string;
    agent: AgentAuthor;
  }): Promise<{ roomId: string; threadId: string; turns: PrivateTurnView[] }>;
  chatPrivateSend(input: { roomId: string; threadId: string; text: string }): Promise<void>;
  /** The one path from private to shared (brief §4.1). */
  chatInsertIntoDoc(input: {
    roomId: string;
    threadId: string;
    turnId: string;
    anchorBlockId: string | null;
  }): Promise<{ editId: string | null }>;
  /** The Pass control on Max's open question: releases the answer (brief §4.4). */
  quizPass(input: { roomId: string; threadId: string }): Promise<{ released: boolean; refused: string | null }>;
  /**
   * **New Conversation**: main asks the learner to confirm, then retires the file's room — the doc
   * chat, span threads, private threads and any open question go; the notes and progress stay.
   * The next message opens a fresh room.
   */
  chatReset(input: { fileId: string }): Promise<ChatResetResult>;
  /**
   * **The learner closed the file** (brief §4.7). Main releases Max's open question on it, if the
   * file's room is the open one, and does not wait for the turn. Never opens a room.
   */
  chatCloseFile(input: { fileId: string }): Promise<{ closing: boolean }>;

  progressGet(input: { fileId: string }): Promise<ProgressView>;
  /** A lesson card's Start: Ellie's intro in the doc chat; returns where to scroll (brief §6). */
  progressStart(input: {
    fileId: string;
    objectiveId: string;
  }): Promise<{ roomId: string; threadId: string; blockId: string | null }>;

  // ── notebooks (`docs/research/notebooks.md`, 2026-10-01) ─────────────────────────────────
  //
  // **On every notes / chat / progress / objectives channel above, `fileId` is the notebook's
  // id (`nb_…`)** — the subject the doc, the room and the tree belong to. The name stays because
  // it is wired through forty call sites and renaming it buys nothing. Page numbers on those
  // channels are notebook pages (`shared/notebook.ts`). `openDocument({ fileId })` still takes a
  // *source's* file id, and is how the renderer gets a source's bytes for its slides.

  /** The Notebooks home: every notebook, most recently opened first. */
  notebookList(): Promise<NotebookSummary[]>;
  notebookGet(input: { notebookId: string }): Promise<NotebookView | null>;
  /**
   * A new notebook. With `paths`, those files are added as its first sources and the name
   * defaults to the first file's name without its extension; with none it is "Untitled notebook".
   */
  notebookCreate(input: { name?: string | null; paths?: string[] }): Promise<AddSourcesResult>;
  notebookRename(input: { notebookId: string; name: string }): Promise<NotebookView>;
  /** Main asks the learner to confirm (a native sheet). Deletes the copies, never the originals. */
  notebookDelete(input: { notebookId: string }): Promise<{ deleted: boolean }>;
  /** The learner opened it: stamps `opened_at` so the home sorts it first. */
  notebookOpen(input: { notebookId: string }): Promise<NotebookView>;
  /** The native multi-file picker, filtered to `SOURCE_EXTENSIONS`. Empty when cancelled. */
  notebookPickFiles(): Promise<{ paths: string[] }>;
  /**
   * Copy files into the notebook (`notebooks.md` §1). Returns as soon as the copies exist; each
   * source is then read in the background (`status: 'reading'` → `'ready'` or `'failed'`), and
   * every step is pushed on `notebook:changed`.
   */
  notebookAddSources(input: { notebookId: string; paths: string[] }): Promise<AddSourcesResult>;
  /** The checkboxes, and **All** (`notebooks.md` §2). */
  notebookSetEnabled(input: { notebookId: string; fileIds: string[]; enabled: boolean }): Promise<NotebookView>;
  /** Main asks the learner to confirm. Deletes the copy; its pages become a gap, never reused. */
  notebookRemoveSource(input: { notebookId: string; fileId: string }): Promise<{ removed: boolean; notebook: NotebookView }>;
  onNotebookChanged(listener: (change: NotebookChange) => void): () => void;
  /**
   * The absolute path of a file dropped on the window. Electron's sandboxed renderer has no
   * `File.path`; the preload asks `webUtils.getPathForFile`. Empty string for a file with no path
   * (dragged out of another app's memory), which the renderer then refuses.
   */
  pathForFile(file: File): string;

  /**
   * **Update overview** (`notebooks.md` §2): rewrite the overview from the sources ticked now.
   * Only the overview's own AI-written blocks are replaced; learner text and agent edits the
   * learner kept are carried over under the section with the matching heading, or under a final
   * *Earlier notes* heading. Runs in the background like the first ingest (`notes.status`).
   */
  notesUpdateOverview(input: { fileId: string }): Promise<NotesUpdateOverviewResult>;
  /** A section's recommended block was added (after `notesGenerateBlock` inserted it) or dismissed. */
  notesSetRecommendation(input: {
    fileId: string;
    docId: string;
    recommendationId: string;
    status: 'added' | 'dismissed';
  }): Promise<OverviewMeta | null>;
  /**
   * **Explain, Example or Quiz me on one block** (`notebooks.md` §4). Explain and Example: Ellie's
   * full answer in the block's span thread, and a separate one-line doc edit under the block
   * (`cause: 'block_action'`). Quiz me: Max's question in that thread and as a Q block under it.
   * Ask… never comes here: the renderer opens the composer with the block quoted.
   */
  notesBlockAction(input: NotesBlockActionInput): Promise<NotesBlockActionResult>;
}

export interface NotesUpdateOverviewResult {
  started: boolean;
  /** `in_flight`: an ingest or update is already running. `no_sources`: nothing is ticked. */
  reason: 'in_flight' | 'no_sources' | 'no_doc' | null;
}

export interface NotesBlockActionInput {
  fileId: string;
  docId: string;
  blockId: string;
  kind: Exclude<BlockActionKind, 'ask'>;
  /** The block's text as the doc shows it: the span thread's quote. */
  quote: string;
}

export interface NotesBlockActionResult {
  accepted: boolean;
  roomId: string | null;
  /** The span thread the answer lands in, so the chat can bring it into view. */
  threadId: string | null;
  /**
   * `no_doc`: no doc, or the block has no id yet. `busy`: an answer on this notebook is still being
   * written. `question_open`: Quiz me while Max's question is still open (one at a time, §5.2).
   */
  reason: 'no_doc' | 'busy' | 'question_open' | null;
}

export interface NotesAnswerQuestionInput {
  fileId: string;
  docId: string;
  /** The Q block's `questionId` and its own `blockId`. */
  questionId: string;
  qBlockId: string;
  askedBy: 'max' | 'user';
  /** The question as the document carries it: the text of the Q block's first child. */
  question: string;
  /** The first block after the question that holds learner text: where a suggestion would land. */
  answerBlockId: string;
  /** The learner's own text in the Q block after the question, blocks joined by a newline. */
  answer: string;
}

/**
 * Why an in-place answer was not marked. The renderer says it under the Q block; nothing else
 * happens.
 */
export type AnswerQuestionRefusal =
  /** The file has no notes doc, or the Q block has no id yet. */
  | 'no_doc'
  /** Nothing of the learner's to mark. */
  | 'empty'
  /** A question of the learner's own with no question text. */
  | 'no_question'
  /** Max's question, and it is not the open one: resolved, released, or replaced. */
  | 'not_open'
  /** The previous answer to this question is still being marked. */
  | 'in_flight';

export interface NotesAnswerQuestionResult {
  accepted: boolean;
  /** The thread the feedback lands in, so the renderer can bring it into view. */
  threadId: string | null;
  reason: AnswerQuestionRefusal | null;
}

export interface NotesGenerateBlockInput {
  fileId: string;
  docId: string;
  /** The block the cursor is in: the section it belongs to is the source, and the insert point. */
  blockId: string;
  kind: GeneratedBlockKind;
  /** What it should show, in the learner's words. Optional: empty means "whatever fits best". */
  instruction: string | null;
}

export type GenerateBlockRefusal =
  /** No notes doc, or the block has no id yet. */
  | 'no_doc'
  /** The doc is frozen: no agent edits it (brief §3). */
  | 'frozen'
  /** The model judged that this section has nothing to tabulate or draw. */
  | 'declined'
  /** The reply did not pass validation, or the call failed. */
  | 'failed'
  /** A generation for this file is already running. */
  | 'in_flight';

export interface NotesGenerateBlockResult {
  inserted: boolean;
  editId: string | null;
  reason: GenerateBlockRefusal | null;
}

declare global {
  interface Window {
    chattered: ChatterEdApi;
  }
}
