/**
 * The IPC contract. The preload bridge exposes exactly this and nothing else
 * (architecture-mac.md §C.1: "IPC bridge — contextIsolation, preload allowlist").
 */
import type {
  Bootstrap,
  ConceptDraft,
  CreateSessionInput,
  DocumentView,
  FinderHitView,
  RecapView,
  RelayAttribution,
  RoomEvent,
  RoomSnapshot,
  SearchHitView,
  SessionSeed,
  SettingsPatch,
  SettingsView,
  TeachbackResult,
  TopicCandidateView,
  VaultTreeNode,
  VaultView,
  WhisperThreadView,
  AppCommand,
  WindowState,
} from './types.js';
import type { SegmentDocumentView } from './segment/types.js';
import type { AskScope } from './scope.js';
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
import type {
  FlowAnswerView,
  FlowShowAnswerView,
  FlowSummaryView,
  FlowThreadOfView,
  FlowTryView,
  FlowRelayView,
  FlowRoomView,
  FlowWhisperView,
  StopTurnResult,
  TurnTraceView,
} from './types.js';

import type {
  AgentAuthor,
  ChatView,
  DocEditStatus,
  NotesDocView,
  PageImage,
  PrivateTurnView,
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
  vaultGet: 'vault:get',
  vaultChoose: 'vault:choose',
  vaultRescan: 'vault:rescan',
  vaultCandidates: 'vault:candidates',
  vaultPromote: 'vault:promote',
  vaultTree: 'vault:tree',
  vaultFind: 'vault:find',
  vaultSearch: 'vault:search',
  vaultDocument: 'vault:document',
  vaultReveal: 'vault:reveal',
  vaultSeed: 'vault:seed',
  showDocument: 'room:showDocument',
  /** main → renderer: a scan finished, or the background indexer advanced. */
  vaultChanged: 'vault:changed',

  // The flow's segments (issue #25).
  segmentsGet: 'segments:get',
  segmentsSplit: 'segments:split',
  segmentsMerge: 'segments:merge',
  segmentsReorder: 'segments:reorder',
  segmentsRename: 'segments:rename',

  // The conversation inside the flow (issue #25, flow-build-plan.md §3.3 track B).
  flowAskHere: 'flow:askHere',
  /** "Ask about this deck" — the line at the top of the flow (issue #35, `shared/scope.ts`). */
  flowAskDeck: 'flow:askDeck',
  /**
   * **A logged no-op since issue #41**, kept for one release.
   *
   * It unlocked a segment's thread after a REFERENCE entry card. The Teacher answers the entry
   * question now, so there is no card and no lock; calling this logs a deprecation and returns
   * `{ unlocked: true, anchorId: null }` so an older renderer's button does nothing visible
   * rather than throwing. Remove it, and this line, in the release after.
   */
  flowExplainBack: 'flow:explainBack',
  /** **Summarise into the document** on a thread → one `summary` card (issue #41). */
  flowSummarise: 'flow:summarise',
  /** The source thread behind a summary card, so a click can expand it (issue #41). */
  flowThreadOf: 'flow:threadOf',
  /** **"+ Try this"** on a segment: one Tester question on the objective the card teaches (issue #47). */
  flowTryHere: 'flow:tryHere',
  /** **Show the answer** after at least one attempt; refused before (issue #47, `rule:answer_shown`). */
  flowShowAnswer: 'flow:showAnswer',
  flowSend: 'flow:send',
  flowMessages: 'flow:messages',

  // The whisper popover on a segment (issue #16 + flow-build-plan.md §3.5).
  flowWhisperOpen: 'flow:whisperOpen',
  flowWhisperSend: 'flow:whisperSend',
  flowWhisperRelay: 'flow:whisperRelay',
  flowWhisperClose: 'flow:whisperClose',
  flowSelection: 'flow:selection',

  // Turn status (cui-standards-audit.md §2 / §7 / §10, issue #34).
  /** **Stop** on a generating turn. Refused while the floor is still running. */
  flowStop: 'flow:stop',
  /** One turn's timings for the ⌥⌘D debug drawer. No bodies. */
  flowTurnTrace: 'flow:turnTrace',
  /** The learner has seen this thread up to `seq`; clears its unread dot. */
  flowMarkSeen: 'flow:markSeen',
  /** Per-card `collapsed` / `removed`, persisted so a dismissed card stays dismissed. */
  flowCardState: 'flow:cardState',

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
  // The chats. Bodies in `src/main/docroom/ipc.ts`.
  notesDocText: 'notes:docText',
  chatThreads: 'chat:threads',
  chatSend: 'chat:send',
  chatOpenSpan: 'chat:openSpan',
  chatPrivateOpen: 'chat:privateOpen',
  chatPrivateSend: 'chat:privateSend',
  chatInsertIntoDoc: 'chat:insertIntoDoc',
  quizPass: 'quiz:pass',
  // Progress. Bodies in `src/main/docroom/progress.ts`.
  progressGet: 'progress:get',
  progressStart: 'progress:start',
} as const;

export interface ChatterEdApi {
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

  // ── The vault (issue #22) ───────────────────────────────────────────────
  /** The Library's whole left-hand state: root, topics with counts, index progress. */
  getVault(): Promise<VaultView>;
  /** Opens the folder picker. Null when the learner cancelled. Scans before it returns. */
  chooseVault(): Promise<VaultView | null>;
  /** Re-walk the vault and reconcile by mtime. Cheap; called on window focus. */
  rescanVault(): Promise<VaultView>;
  /** The depth-1 folders on offer as topics, with the promoted ones ticked. */
  topicCandidates(): Promise<TopicCandidateView[]>;
  /** Sets the promoted set exactly. Anything omitted is demoted back to "Other". */
  promoteTopics(input: { relPaths: string[] }): Promise<VaultView>;
  /** The file tree for one topic, or for "Other" when topicId is null. */
  vaultTree(input: { topicId: string | null }): Promise<VaultTreeNode[]>;
  /**
   * The ⌘K finder: fuzzy filename and path matching, no index needed, instant.
   * ⌘K is the whisper key *inside a room* (§C10 L1004) and the finder key everywhere else —
   * §B1's own header already reads `[ Search ⌘K ]` (L186). Scope decides, and the two scopes
   * never overlap because the room owns the keydown while it is open.
   */
  findFiles(input: { query: string }): Promise<FinderHitView[]>;
  /** Full text, over the FTS5 index: snippets, and a page number for a PDF hit. */
  searchVault(input: { query: string }): Promise<SearchHitView[]>;
  /**
   * Everything the document pane needs for one file. PDF and image bytes come back over IPC as
   * a Uint8Array rather than through a custom protocol: the renderer then holds no URL it could
   * re-request, and a file it was never handed stays unreachable.
   */
  openDocument(input: { fileId: string }): Promise<DocumentView>;
  /** Reveal in Finder — the one action the "no viewer" card offers (issue #22 decision 3). */
  revealFile(input: { fileId: string }): Promise<void>;
  /**
   * Start session setup from a file and a page range: the extracted text pre-fills the paste
   * box, and the topic comes along for the room's system context (issue #22 decisions 4 and 5).
   */
  sessionSeed(input: { fileId: string; pageFrom: number | null; pageTo: number | null }): Promise<SessionSeed>;
  /**
   * "Show the room": post a reference to the open document into the group chat, as the learner.
   * The main process resolves the page text; the renderer only says which pages and what was
   * highlighted, because the renderer has no authority to decide what the agents are told.
   */
  showDocument(input: {
    roomId: string;
    fileId: string;
    pageFrom: number | null;
    pageTo: number | null;
    selection: string | null;
  }): Promise<void>;
  /** Subscribe to vault changes pushed by the scanner and the background indexer. */
  onVaultChanged(listener: (view: VaultView) => void): () => void;

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

  // ── The conversation inside the flow (issue #25) ────────────────────────
  /**
   * "+ Ask here" on one segment.
   *
   * **This call is what creates the document's room**, the first time it is made for a file
   * (`flow-build-plan.md` §3.3): there is no setup screen any more.
   *
   * **The Teacher answers it** (issue #41, `conversation-refinement.md` §2). It used to insert a
   * neutral REFERENCE card and lock Ellie and Max out of the thread until *Explain it back*; all
   * three of Lucas's #41 transcripts spent their first prompt on that card and their second
   * getting past it. So this now opens the thread and runs an ordinary Teacher turn on it: it
   * resolves as soon as the question is written, and the reply arrives on the event stream at its
   * latency floor, exactly like `flowSend`. Render the reserved slot from `turn.received`.
   *
   * Unchanged: the 3–8 s floor-yield, the latency floor, the scope resolution and `scopeShown`,
   * the flow session, the ledger's verbatim-evidence rule, and the `objectiveId` chip.
   */
  flowAskHere(input: {
    fileId: string;
    segmentId: string;
    question: string;
    /**
     * What the question is about (issue #35). Omit it and the main process guesses with
     * `guessScope()` from `shared/scope.ts` — call the same function to render the chip, so the
     * chip and the answer can never disagree. Passing it is the learner's override, and the log
     * records that it was one.
     */
    scope?: AskScope;
    /**
     * The objective this thread is about (issue #38 §5): set when the Ask was opened from a node
     * in the objectives panel. The main process writes it on every message of the thread
     * (`messages.objective_id`, migration 016) so an explanation given here is attributable to
     * the node the learner clicked.
     */
    objectiveId?: string;
  }): Promise<FlowAnswerView>;
  /**
   * **"Ask about this deck"** — the line above the first card (issue #35;
   * `whole-file-context.md` §3: a deck-level question had nowhere to go, so it was answered
   * from whichever slide happened to be nearest).
   *
   * Same return as `flowAskHere`, and since #41 the same answerer: the Teacher, reading the whole
   * deck instead of one page. The thread is anchored to the synthetic `DECK_ANCHOR_ID`, and
   * `FlowRoomView.threads` always lists it first.
   */
  flowAskDeck(input: { fileId: string; question: string }): Promise<FlowAnswerView>;
  /**
   * **Deprecated, a no-op since #41.** See `IPC.flowExplainBack`. Always resolves
   * `{ unlocked: true, anchorId: null }`; drop the button rather than calling it.
   */
  flowExplainBack(input: { answerId: string }): Promise<{ unlocked: boolean; anchorId: string | null }>;
  /**
   * **"Summarise into the document"** on a thread (issue #41, `conversation-refinement.md` §5).
   *
   * Produces one `summary` card under the segment: the REFERENCE register, a cap applied in code,
   * maths in `$…$`, and written **from the thread** rather than from the slide — the point is to
   * carry what *this conversation* taught, so the learner can review without reading it again.
   *
   * `threadId` is an `anchorId`. Call it again on the same thread to regenerate: the existing
   * card is replaced, not duplicated, and `regenerated` says so. The card is offered by
   * `rule:offer_summary` (a Teacher turn with `byRule: 'offer_summary'`) and is **never inserted
   * without this call**, which is R1.
   */
  flowSummarise(input: { roomId: string; threadId: string }): Promise<FlowSummaryView>;
  /**
   * The source thread behind a summary card, for the click that expands it (issue #41).
   * `null` when `summaryId` is not a summary card. Its composer continues that same thread —
   * `flowSend({ roomId, segmentId: threadId, text })`.
   */
  flowThreadOf(input: { summaryId: string }): Promise<FlowThreadOfView | null>;
  /**
   * A learner turn inside one segment's thread. Not awaited for the reply: like `sendMessage`,
   * the agent's answer arrives on the event stream at its latency floor.
   */
  flowSend(input: { roomId: string; segmentId: string; text: string }): Promise<void>;
  /**
   * **"+ Try this"** on one segment (issue #47, `docs/research/attempt-first.md` §2.1).
   *
   * Creates the document's room if it does not exist, exactly like `flowAskHere`. The main
   * process picks the objective — the ones the card teaches, lowest level first, deck order as
   * the tie-break, nearest earlier objective by page as the fallback — unless `objectiveId` is
   * passed (a click in the objectives panel, or **Try another** on a thread that already has one).
   * Max's question arrives on the event stream. `refused` is set, and no question is asked, when
   * the tree is `pending` or `failed`.
   */
  flowTryHere(input: { fileId: string; segmentId: string; objectiveId?: string }): Promise<FlowTryView>;
  /**
   * **Show the answer** on a thread with an open quiz (issue #47, §2.3 `rule:answer_shown`).
   * Honoured only after at least one attempt; before that `shown` is false and `refused` says
   * why. The answer turn is Max's, cites the deck, closes the quiz, and never moves the ledger.
   */
  flowShowAnswer(input: { roomId: string; threadId: string }): Promise<FlowShowAnswerView>;
  /**
   * The document's room and its threads, grouped by segment. `null` when the document has never
   * been asked a question — which is the common case, and is why nothing is created here.
   */
  flowMessages(input: { fileId: string }): Promise<FlowRoomView | null>;

  // ── The whisper popover on a segment (§3.5) ─────────────────────────────
  /**
   * `⌘K` on a focused segment card, or *Ask privately* in its label strip.
   *
   * Like `flowAskHere` it **creates the document's room if there isn't one**: a private question
   * is a learner-authored action on the document, and refusing to open one until a public
   * question had been asked would make the private channel the second-class one — which is the
   * opposite of what `design-brief.md` §D5 is for.
   *
   * The addressee is not a parameter. Ellie is resolved in `actor.openSegmentWhisper()`, so the
   * renderer cannot ask for a private channel to the Tester (#32).
   */
  flowWhisperOpen(input: { fileId: string; segmentId: string }): Promise<{ roomId: string; whisper: FlowWhisperView }>;
  /**
   * A private turn. Not awaited for the reply: Ellie's answer arrives on the `whisper.turn`
   * event stream at her 1–2 s floor, exactly as in the shipped pane.
   *
   * `fileId` + `segmentId` are here so the **main process** resolves the anchored page text —
   * the same text the REFERENCE call sees. The renderer has no authority to decide what any
   * agent is told, private or not.
   */
  flowWhisperSend(input: {
    roomId: string;
    fileId: string;
    segmentId: string;
    threadId: string;
    text: string;
  }): Promise<void>;
  /**
   * **Insert into the document.** The approved relay: a *new shared card* under the segment,
   * authored as the learner or as Ellie, carrying the text the learner edited and approved.
   *
   * It never moves, reveals or links the private turn (`pivot-spec.md` §B5's T4), and it cannot
   * advance the ledger — `actor.relay()` does not call the ledger, and `flow:whisperRelay` is
   * the only path from the popover to the document.
   */
  flowWhisperRelay(input: {
    roomId: string;
    segmentId: string;
    threadId: string;
    whisperId: string;
    attribution: RelayAttribution;
    text: string;
  }): Promise<FlowRelayView>;
  /** `Esc` or click-away. Closes the popover in the main process's model; writes nothing. */
  flowWhisperClose(input: { roomId: string; threadId: string }): Promise<void>;

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
  /** The learner has read this thread up to `seq`. Persisted with the sitting. */
  flowMarkSeen(input: { roomId: string; anchorId: string; seq: number }): Promise<void>;
  /** Persist a card's `collapsed` / `removed`; either may be omitted to leave it alone. */
  flowCardState(input: {
    roomId: string;
    anchorId: string;
    collapsed?: boolean;
    removed?: boolean;
  }): Promise<void>;
  /**
   * A **selection change**: the learner focused a segment card (`pivot-spec.md` §B8).
   *
   * The document's analogue of the typing heartbeat, and rate-limited by the renderer the same
   * way. Scroll, zoom and page navigation are deliberately *not* reported — re-reading a slide
   * by scrolling is precisely the behaviour the silence timer must not punish.
   */
  flowSelection(input: { roomId: string; segmentId: string | null }): Promise<void>;


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
   * Page images for the refine pass, sent in batches **before** `notesIngest`. Optional: with
   * none, the ingest runs on structured text + geometry. Main cannot rasterise a PDF.
   */
  notesPageImages(input: { fileId: string; images: PageImage[]; done: boolean }): Promise<{ stored: number }>;
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

  progressGet(input: { fileId: string }): Promise<ProgressView>;
  /** A lesson card's Start: Ellie's intro in the doc chat; returns where to scroll (brief §6). */
  progressStart(input: {
    fileId: string;
    objectiveId: string;
  }): Promise<{ roomId: string; threadId: string; blockId: string | null }>;
}

declare global {
  interface Window {
    chattered: ChatterEdApi;
  }
}
