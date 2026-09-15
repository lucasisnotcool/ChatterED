/**
 * Domain and view types shared by the main process, the preload bridge and the renderer.
 *
 * Everything here is plain data: it crosses the Electron IPC boundary, so it must survive
 * structured cloning. No classes, no Dates, no functions. Timestamps are ISO-8601 strings,
 * which is also how they are stored in SQLite (architecture-mac.md §D.1).
 */

export type AgentRole = 'peer' | 'challenger' | 'tutee' | 'whisper';

/** 'ellie_peer' = Ellie is the Peer and Max is the Challenger; 'ellie_challenger' is the flip. */
export type RolePairing = 'ellie_peer' | 'ellie_challenger';

export interface AgentProfile {
  /** Stable key, e.g. 'peer.ellie'. Role-first so the key sorts by role. */
  key: string;
  role: AgentRole;
  displayName: string;
  /** Hue used ONLY for this agent's rule, avatar and label (product-design.md §C2 rule 2). */
  colour: string;
  /** 'thinking' for the Challenger, 'typing' for everyone else (product-design.md §C3). */
  verb: 'thinking' | 'typing';
  model: string;
  latency: { ttftMinMs: number; ttftMaxMs: number };
}

export type DisagreementMarker = 'pushes back on' | "isn't sure about" | 'sides with you against';

export interface MessageView {
  id: string;
  seq: number;
  speaker:
    | { kind: 'student'; displayName: 'You' }
    | { kind: 'agent'; key: string; role: AgentRole; displayName: string; colour: string }
    /**
     * The REFERENCE voice — **a scope, not an agent** (`src/room/reference.ts`). It has no
     * `agent_key`, no row in `agents` and no role, which is exactly what keeps it out of the
     * roster; it therefore cannot be an `'agent'` speaker, and it must not fall through to
     * `'student'` either, because a machine answer wearing the learner's face is the one
     * confusion the whole 120-word card exists to prevent.
     */
    | { kind: 'reference'; displayName: 'REFERENCE' };
  body: string;
  createdAt: string;
  latencyTargetMs: number | null;
  ttftActualMs: number | null;
  /** True when this message was relayed out of a whisper. The UI must NOT render a badge
   *  for it (product-design.md §B4 / §G2 state 9) — it exists for the research export only. */
  promotedFromWhisper: boolean;
  /** Rendered as the connector + marker in product-design.md §C6. Never drawn for agreement. */
  disagreement: { marker: DisagreementMarker; targetAgentKey: string; targetMessageId: string | null } | null;
  /** A labelled divider drawn immediately above this message, e.g. '45s quiet · Ellie stepped in'. */
  divider: { cause: string; control?: 'dont_do_this' } | null;
  /**
   * Set when the learner used "Show the room" (issue #22 decision 4). Rendered as a compact
   * document card in the transcript; the page text it carries is NOT in `body` and is never
   * shown, because the card is a reference, not a paste.
   */
  reference: MessageReferenceView | null;
  /**
   * Which segment of the flow this message hangs off (migration 010). `null` is a room-level
   * message — every message written before the flow existed, and the opener.
   */
  anchorId: string | null;
  /**
   * Set when this turn was **written** by a rule rather than generated — today that is exactly
   * `'handoff'`, Ellie's hand-off line from `flow.handOffLine()`. The flow renders it as a small
   * `by rule` tag, which is the whole point of writing that line in `flow.ts` instead of asking
   * a model for it (`flow-build-plan.md` §4.2: "a rule I can see and turn down"). A quiz turn is
   * *decided* by a rule but still generated, and is deliberately not tagged.
   */
  byRule: string | null;
}

export interface MessageReferenceView {
  /** Null once the file has left the vault. The transcript outlives the file. */
  fileId: string | null;
  fileName: string;
  relPath: string;
  kind: VaultFileKind;
  pageFrom: number | null;
  pageTo: number | null;
  /** What the learner had highlighted, capped. Shown in the card, collapsed if long. */
  selection: string | null;
  /** How much extracted text went to the agents, so the card can say so honestly. */
  attachedChars: number;
}

export type LedgerState = 'not_yet' | 'stated' | 'justified' | 'defended';
export type LedgerLevel = 0 | 1 | 2 | 3 | 4;
export type BloomRung = 'remember' | 'understand' | 'apply' | 'analyse';

export interface LedgerRowView {
  elementId: string;
  label: string;
  learnerLabel: string;
  level: LedgerLevel;
  state: LedgerState;
  /** Verbatim substring of one of the learner's own messages, or null. */
  evidenceText: string | null;
  evidenceMsgId: string | null;
  evidenceTurn: number | null;
  /** e.g. "defended against Max's probe on assumptions (turn 3)". Only Max can produce it. */
  defendedAgainst: string | null;
  revisit: boolean;
  contested: boolean;
  openMisconceptions: string[];
}

export interface LedgerView {
  rows: LedgerRowView[];
  covered: number;
  total: number;
  /** Layer 2: one line at the lowest element's rung (product-design.md §D1). */
  bloom: BloomRung;
  coverage: number;
}

export type TimerStage = 0 | 1 | 2;

export interface TimerView {
  /** Authoritative. The renderer animates against this timestamp; it is never sent a countdown. */
  deadlineTs: string | null;
  epoch: number;
  silenceMs: number;
  stage: TimerStage;
  paused: boolean;
  pausedReason: 'typing' | 'user' | 'offline' | null;
  /** True once the timer has fired twice in this round — after that the app says nothing. */
  nudgesDone: boolean;
  /** Server clock at the moment this view was produced, so the renderer can correct for drift. */
  now: string;
}

export interface ThinkingView {
  agentKey: string;
  displayName: string;
  role: AgentRole;
  colour: string;
  verb: 'thinking' | 'typing';
  startedAt: string;
  etaMs: number;
  /** Only the Challenger shows the climbing seconds counter (product-design.md §C3). */
  showCounter: boolean;
}

export type RoomState = 'open' | 'agent_scheduled' | 'agent_speaking' | 'closed';

export interface MaterialView {
  id: string;
  moduleCode: string;
  title: string;
  sourceKind: 'pdf_pages' | 'pasted_text';
  fileName: string | null;
  /** The vault file, when there is one, so the room can render the page and not a text dump. */
  fileId: string | null;
  pageFrom: number | null;
  pageTo: number | null;
  pageCount: number | null;
  extractedText: string;
  cacheEligible: boolean;
  tokenCount: number;
}

export interface RoomSnapshot {
  roomId: string;
  sessionId: string;
  moduleCode: string;
  topic: string;
  round: number;
  state: RoomState;
  startedAt: string;
  material: MaterialView;
  agents: AgentProfile[];
  messages: MessageView[];
  ledger: LedgerView;
  timer: TimerView;
  thinking: ThinkingView | null;
  nudgesPaused: boolean;
  /** 'scripted' replays design-brief.md §G; 'live' calls the Anthropic API. */
  mode: 'scripted' | 'live';
  roundCard: { title: string; body: string };
}

export interface WhisperTurnView {
  id: string;
  threadId: string;
  seq: number;
  sender: 'student' | 'agent';
  body: string;
  createdAt: string;
  /** Attached to an agent turn when it offers to raise the point in the group. */
  relayOffer: { draftText: string; defaultAttribution: RelayAttribution } | null;
}

export type RelayAttribution = 'as_me' | 'as_agent';

export interface WhisperThreadView {
  threadId: string;
  agent: AgentProfile;
  turns: WhisperTurnView[];
  /** The limits statement, always the first thing in the pane (critique1-btw.txt Suggestion 2). */
  limitsLine: string;
}

export interface RecapView {
  roomId: string;
  conceptTitle: string;
  before: LedgerRowView[];
  after: LedgerRowView[];
  bloom: BloomRung;
  /** Layer 3, recap only. */
  actProfile: { label: string; count: number }[];
  /** Layer 4, recap only, phrased as an achievement. */
  unaidedMs: number;
  corrections: { text: string; caughtByLearner: boolean }[];
  openQuestions: string[];
  teachbackOffer: { agentKey: string; displayName: string; blurb: string } | null;
}

/**
 * What came back from accepting the teach-back invitation. `available` is false until Theo's
 * round exists (A2); the note is what the recap card shows in place of the two buttons.
 */
export interface TeachbackResult {
  available: boolean;
  note: string;
}

/**
 * What the application menu (and the macOS three-finger swipe) can ask the renderer to do.
 * Deliberately a closed union: the preload allowlist carries one channel, and the renderer
 * decides what each name means — the main process never reaches into the view.
 */
export type AppCommand =
  | 'zoom.in'
  | 'zoom.out'
  | 'zoom.reset'
  | 'fit.width'
  | 'fit.page'
  | 'page.next'
  | 'page.prev'
  | 'vault.open'
  | 'vault.rescan'
  | 'topics.edit'
  | 'search.files'
  | 'settings.open';

export interface RecentSession {
  roomId: string;
  conceptTitle: string;
  /**
   * `rooms.module_code` is deliberately **not** here. It was read only by the nav rail's
   * `COURSES` list, which was a second taxonomy of "a course" beside the vault's topics and was
   * fed by a hard-coded `'MA3236'` (ui-review-code.md §3). The column stays in the database —
   * every historical room's frozen prompt prefix was hashed with the code in it (§E.3) — it is
   * just no longer displayed anywhere.
   */
  states: LedgerState[];
  endedAt: string | null;
  updatedAt: string;
}

/** The three live backends, plus 'auto' for "pick the best one available" (issue #19). */
export type BackendKind = 'claude_cli' | 'anthropic' | 'scripted';
export type BackendChoice = 'auto' | BackendKind;

/** What the last `claude` binary probe found. Cached in settings; see src/main/llm/detect.ts. */
export interface CliStatus {
  found: boolean;
  path: string | null;
  /** null when the binary was found but the login has not been probed yet. */
  loggedIn: boolean | null;
  detail: string | null;
  checkedAt: string;
}

export interface SettingsView {
  appVersion: string;
  /** What the learner chose. 'auto' means CLI → API key → scripted, in that order. */
  backendChoice: BackendChoice;
  /** What that actually resolved to, once reality was consulted. */
  resolvedBackend: BackendKind;
  /** Set when the choice could not be honoured — e.g. "forced the CLI, but it is not logged in". */
  fellBackBecause: string | null;
  cli: CliStatus;
  cliPathOverride: string | null;
  /** Resolved model ids for the two roles. On the CLI path these are aliases: haiku/sonnet/opus. */
  agentModel: string;
  orchestratorModel: string;
  /** The dropdown options, in order. Fable is deliberately not among them (CLAUDE.md). */
  modelChoices: string[];
  hasApiKey: boolean;
  /** The vault root, so Settings can offer "Change vault…" without opening the Library. */
  vaultRoot: string | null;
}

export interface SettingsPatch {
  backendChoice?: BackendChoice;
  cliPathOverride?: string | null;
  agentModel?: string;
  orchestratorModel?: string;
}

export interface Bootstrap {
  appVersion: string;
  hasApiKey: boolean;
  mode: 'scripted' | 'live';
  /** Which backend the next room will open on, and why (issue #19). */
  backend: BackendKind;
  backendChoice: BackendChoice;
  cli: CliStatus;
  pairing: RolePairing;
  agents: AgentProfile[];
  recentSessions: RecentSession[];
  /** True until the first-run flow has been completed once. */
  firstRun: boolean;
}

export interface CreateSessionInput {
  moduleCode: string;
  title: string;
  /** Pasted text, or text extracted from a PDF page range. */
  text: string;
  /** Optional: load a committed fixed pack instead of eliciting one (progress-tracking.md §3). */
  conceptId?: string;
  /**
   * The claim rows as the learner confirmed them. `learnerLabel` is the short handle the
   * progress rail shows; it is shortened again in `packFor` whatever arrives here.
   */
  claims?: { id: string; label: string; learnerLabel?: string }[];
  sourceKind?: 'pdf_pages' | 'pasted_text';
  fileName?: string;
  pageFrom?: number;
  pageTo?: number;
  /** The vault file this came from, when it did (issue #22 decision 4). */
  fileId?: string;
  /**
   * The digest to key this material on. The flow passes the file's own `content_sha` — the same
   * one the segment cache uses — so that a document's room is reopened rather than duplicated on
   * the second question, and a *changed* deck correctly opens a new one. Omitted everywhere else,
   * and then `file_sha256` is the sha of `text`, exactly as it always was.
   */
  fileSha?: string;
  /**
   * The vault topic the file sits in. Its name and file list go into the frozen prompt prefix,
   * so the agents know which module they are in (issue #22 decision 5).
   */
  topic?: { name: string; fileNames: string[] };
}

export interface ConceptDraft {
  conceptId: string;
  title: string;
  claims: { id: string; label: string; learnerLabel: string; levelThreeCriterion: string }[];
  provenance: 'fixed' | 'elicited';
}

/**
 * Window chrome, pushed from main. `fullScreen` is the only bit the renderer needs: macOS
 * hides the traffic lights in fullscreen, so the reserved spacer in the custom title bar has
 * to collapse (issue #21).
 */
export interface WindowState {
  fullScreen: boolean;
}

// ── The conversation inside the flow (issue #25, flow-build-plan.md §3.3 / §4.1) ──────────
/**
 * One segment's thread.
 *
 * Deliberately **ids, not messages**: the full `MessageView`s already travel on `room.messages`
 * and on the `message.appended` event stream, and duplicating them here would give the renderer
 * two copies of the same turn that could disagree the moment one of them is stale.
 */
export interface FlowThreadView {
  /** The `SegmentView.id` this thread hangs off. */
  anchorId: string;
  messageIds: string[];
  /**
   * The REFERENCE answer still waiting for **Explain it back →**, if any. While it is set,
   * neither Ellie nor Max may post into this thread — enforced in `reference.ts`, reported here
   * so the renderer can show the two buttons rather than a composer.
   */
  lockedByAnswerId: string | null;
}

/**
 * The room behind one document, plus its threads. Returned by `flow:messages` on open and by
 * `flow:askHere` when the first question creates the room.
 *
 * `room` is the ordinary `RoomSnapshot` — the flow is not a second kind of room, and everything
 * downstream of it (the event stream, the ledger, the timer, the whisper scoping) is the shipped
 * machinery, unchanged.
 */
export interface FlowRoomView {
  room: RoomSnapshot;
  threads: FlowThreadView[];
}

/** What `flow:askHere` gives back: the room (possibly just created) and the card that landed. */
export interface FlowAnswerView {
  roomId: string;
  anchorId: string;
  questionId: string;
  answerId: string;
  /** The capped answer, the rule and the hand-back line, exactly as `reference.ts` composed it. */
  body: string;
  truncated: boolean;
  flow: FlowRoomView;
}

/** Events pushed from main to the renderer. The renderer never polls. */
export type RoomEvent =
  | { type: 'message.appended'; roomId: string; message: MessageView }
  | { type: 'agent.thinking'; roomId: string; thinking: ThinkingView }
  | { type: 'agent.thinking.cleared'; roomId: string }
  | { type: 'ledger.updated'; roomId: string; ledger: LedgerView; changed: string[] }
  | { type: 'timer.updated'; roomId: string; timer: TimerView }
  | { type: 'room.state'; roomId: string; state: RoomState }
  | { type: 'whisper.turn'; roomId: string; threadId: string; turn: WhisperTurnView }
  | { type: 'whisper.cleared'; roomId: string; threadId: string }
  | { type: 'session.recap'; roomId: string; recap: RecapView }
  | { type: 'notice'; roomId: string | null; level: 'info' | 'error'; text: string };

// ── The vault (issue #22) ──────────────────────────────────────────────────
// Everything below crosses IPC, so it is plain data. Paths are absolute only where the learner
// is meant to read them (a "Reveal in Finder" target, the vault root under the topic list);
// everywhere else a file is addressed by its opaque `fileId`, so the renderer can never ask the
// main process to open a path it was not handed (src/main/ipc.ts: the renderer holds no
// authority). Nothing here is mirrored: architecture-mac.md §D.3 keeps file paths and extracted
// text local because the text is copyrighted lecture material.

export type VaultFileKind = 'pdf' | 'markdown' | 'text' | 'code' | 'image' | 'other';

export interface VaultTopicView {
  id: string;
  /** The folder name as the learner promoted it, e.g. 'MA3236'. */
  name: string;
  relPath: string;
  /** From TOPIC_COLOURS — never an agent hue and never indigo (product-design.md §C2). */
  colour: string;
  moduleCode: string | null;
  fileCount: number;
}

export interface VaultFileView {
  id: string;
  name: string;
  relPath: string;
  kind: VaultFileKind;
  size: number;
  mtimeMs: number;
  /** null when the file is not under a promoted topic — the "Other" bucket. */
  topicId: string | null;
  pageCount: number | null;
  indexed: boolean;
  /** e.g. 'scanned image, maybe?' — rendered on the row, which never disappears (§B1). */
  indexError: string | null;
}

/** A folder in the per-topic tree. Directories carry children; files carry `file`. */
export interface VaultTreeNode {
  name: string;
  relPath: string;
  dir: boolean;
  children: VaultTreeNode[];
  file: VaultFileView | null;
}

export interface IndexStatus {
  /** Indexable files known to the vault. */
  total: number;
  done: number;
  failed: number;
  running: boolean;
  /** The file being read right now, for the determinate strip in §B1. */
  current: string | null;
}

export interface VaultView {
  rootPath: string | null;
  displayName: string;
  topics: VaultTopicView[];
  /** Files not under any promoted topic. Browsable under "Other" (issue #22 decision 1). */
  otherCount: number;
  totalFiles: number;
  lastScanAt: string | null;
  index: IndexStatus;
}

export interface TopicCandidateView {
  relPath: string;
  name: string;
  fileCount: number;
  promoted: boolean;
}

export interface FinderHitView {
  fileId: string;
  name: string;
  relPath: string;
  topicName: string | null;
  kind: VaultFileKind;
  /** Indices into `relPath` that matched, for highlighting. */
  positions: number[];
}

export interface SearchHitView {
  fileId: string;
  name: string;
  relPath: string;
  topicName: string | null;
  kind: VaultFileKind;
  /** 1-indexed page for a PDF hit; null for Markdown, text and code. */
  page: number | null;
  /** An FTS5 snippet. Matched terms are wrapped in the SNIPPET_MARK delimiters. */
  snippet: string;
}

/** What the document pane needs to render one file. */
export interface DocumentView {
  fileId: string;
  name: string;
  relPath: string;
  /** Shown in the "no viewer" card, and the Reveal in Finder target. */
  absPath: string;
  kind: VaultFileKind;
  ext: string;
  size: number;
  pageCount: number | null;
  /** Markdown, text and code: the file's contents. Null for PDF and images. */
  text: string | null;
  /** PDF and image bytes, handed over IPC. Null otherwise. */
  bytes: Uint8Array | null;
  /** Set when the file could not be opened at all. */
  error: string | null;
}

/**
 * A session started from a file and a page range (issue #22 decision 4). It is not a new flow:
 * the extracted text simply pre-fills the paste box, and everything downstream is the existing
 * concept-pack path. Paste remains as the fallback it always was.
 */
export interface SessionSeed {
  fileId: string;
  fileName: string;
  relPath: string;
  /** From the topic folder when it looks like a module code, else null. */
  moduleCode: string | null;
  pageFrom: number | null;
  pageTo: number | null;
  /** The extracted text, capped. This is what lands in the textarea. */
  text: string;
  /** Goes into the frozen prompt prefix so the agents know the module (decision 5). */
  topic: { name: string; fileNames: string[] } | null;
}

/** What "Show the room" posts. The extracted page text is attached; the bytes never are. */
export interface DocumentReference {
  fileId: string;
  name: string;
  relPath: string;
  kind: VaultFileKind;
  pageFrom: number | null;
  pageTo: number | null;
  /** The learner's selection, capped at SELECTION_CAP characters. */
  selection: string | null;
}
