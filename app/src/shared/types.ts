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
    | { kind: 'agent'; key: string; role: AgentRole; displayName: string; colour: string };
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

export interface RecentSession {
  roomId: string;
  conceptTitle: string;
  moduleCode: string;
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
  slidesFolder: string | null;
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
  slidesFolder: string | null;
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
  claims?: { id: string; label: string }[];
  sourceKind?: 'pdf_pages' | 'pasted_text';
  fileName?: string;
  pageFrom?: number;
  pageTo?: number;
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
