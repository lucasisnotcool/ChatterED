/**
 * Domain and view types shared by the main process, the preload bridge and the renderer.
 *
 * Everything here is plain data: it crosses the Electron IPC boundary, so it must survive
 * structured cloning. No classes, no Dates, no functions. Timestamps are ISO-8601 strings,
 * which is also how they are stored in SQLite (architecture-mac.md §D.1).
 */

export type AgentRole = 'peer' | 'challenger' | 'tutee' | 'whisper';

/**
 * What an agent is shown doing while its reply is held (`pivot-spec.md` §B9). One union rather
 * than a boolean because the verb is per *role*, and `'thinking'` is retained only so a stored
 * `ThinkingView` from a build before 16 Sep still parses — `agents.ts` no longer mints it.
 */
export type AgentVerb = 'reading' | 'typing' | 'thinking';

/** 'ellie_peer' = Ellie is the Peer and Max is the Challenger; 'ellie_challenger' is the flip. */
export type RolePairing = 'ellie_peer' | 'ellie_challenger';

export interface AgentProfile {
  /** Stable key, e.g. 'peer.ellie'. Role-first so the key sorts by role. */
  key: string;
  role: AgentRole;
  displayName: string;
  /** Hue used ONLY for this agent's rule, avatar and label (product-design.md §C2 rule 2). */
  colour: string;
  /**
   * The hold verb, per role (`product-design.md` §C3, `pivot-spec.md` §B9). `'reading'` for the
   * Tester — what he does first is read your region — `'typing'` for everyone else. `'thinking'`
   * is kept in the union so a historical `ThinkingView` still parses; nothing mints it now.
   */
  verb: AgentVerb;
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
  /** Time to the first **visible** token, i.e. measured from the floor, not from the call. */
  ttftActualMs: number | null;
  /**
   * Provenance, added 16 Sep 2026 (audit §6). *"A turn that does not say which backend produced
   * it is a claim about a model that never ran"* — and a research prototype can silently be
   * answering from `ScriptedClient`. Render `model`/`backend`/`ttftActualMs`/`totalMs` on hover;
   * render `scripted` **unconditionally**.
   */
  model?: string | null;
  /**
   * The **client** kind, as the message row stores it: `'claude-cli' | 'anthropic' | 'scripted'`.
   * Deliberately not `BackendKind` — that is Settings' vocabulary (`claude_cli`, underscore) and
   * the two must not be silently conflated.
   */
  backend?: string | null;
  /** Turn start → the message row: what the learner actually waited. */
  totalMs?: number | null;
  /** `rule:teacher_answers`, `rule:handoff`, `model:sonnet`, … — who chose this speaker. */
  decidedBy?: string | null;
  /** True when this body is the partial the learner stopped (`flow:stop`). Not a failure. */
  stopped?: boolean;
  /**
   * True when this message was relayed out of a whisper.
   *
   * **The chat and the flow render this differently, on purpose.** In `Thread.svelte` there is
   * no badge (product-design.md §B4 / §G2 state 9): the room is an ephemeral stream, and a
   * marker there would out the learner who would not ask in public. In the flow the card is a
   * *durable artefact in the document* — the thing §B5 says the learner would show a tutor — so
   * `FlowThread` prints `pivot-spec.md` §B5's dual attribution, **from a private note**, under
   * the author's name. It says that a private aside happened; it never says what was in it, and
   * nothing about it reaches any agent's prompt, which reads `body` and nothing else.
   */
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
  verb: AgentVerb;
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
  /** Turns that failed and have not been retried or superseded. Rendered as system cards. */
  failures: TurnFailureView[];
}

/**
 * **A turn that failed, on screen, with a way out.**
 *
 * The 2026-09-16 bug was not only that a turn evaporated — it was that *nothing said so*. A
 * failed LLM call, a failed orchestrator decision and a deliberate silence were one state
 * downstream, so the learner saw an empty thread and then a nudge asking why they were quiet.
 * This is the difference: the thread says what broke and offers the retry, and `actor.#armTimer`
 * refuses to nudge while one of these is outstanding.
 */
export interface TurnFailureView {
  /** The retry token. `api.retryTurn({ roomId, failureId })` replays exactly this turn. */
  id: string;
  /** The segment thread the card belongs under; `null` is the room-level stream. */
  anchorId: string | null;
  /**
   * `turn` — nobody replied. `ledger` — the reply arrived but the progress rail did not move.
   * They are different sentences on screen because they are different losses to the learner.
   */
  kind: 'turn' | 'ledger';
  /** Whose turn it was, for the card's first clause. Null for a ledger failure. */
  displayName: string | null;
  /** One short sentence: "the Claude CLI exited 1". Never a stack, never a message body. */
  reason: string;
  at: string;
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

/**
 * Settings ▸ **Reply speed** (audit §9, `design-brief.md` §D4, `product-design.md` §C3).
 *
 * `'default'` is the studied pacing. `'faster'` halves every floor and the floor-yield window.
 * `'off'` sets them to zero and **must be disclosed in the control itself** — "for testing, not
 * the studied pacing" — because §C3's own closing argument is that a paced system the learner
 * cannot un-pace is a dark pattern, and an un-paced system that does not say so is worse.
 * Applied at the **next** turn, never to a turn already in flight.
 */
export type ReplySpeed = 'default' | 'faster' | 'off';

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
  /**
   * Tester pacing: `'default'` is the shipped profile, `'demo'` the disclosed filming one
   * (`room/flow.ts`). Named here by the profile's own `name` so there is one spelling of it
   * end to end — Settings, the pacing strip and the event log all say the same word.
   */
  flowProfile: 'default' | 'demo';
  /** False until the learner has dismissed the flow's first-open pacing strip (§3.5). */
  pacingStripSeen: boolean;
  /** See `ReplySpeed`. Takes effect on the next turn, in the open room, without a reopen. */
  replySpeed: ReplySpeed;
}

export interface SettingsPatch {
  backendChoice?: BackendChoice;
  cliPathOverride?: string | null;
  agentModel?: string;
  orchestratorModel?: string;
  flowProfile?: 'default' | 'demo';
  /** Set false from Settings to show the pacing strip again; set true when it is dismissed. */
  pacingStripSeen?: boolean;
  replySpeed?: ReplySpeed;
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
   * The highest `seq` in this thread the learner has seen, from `flow:markSeen`. `0` means the
   * thread has never been marked. Anything in `messageIds` above it is unread — which is what
   * the dot on the card's label strip is for (audit §7), and it matters most for the reply that
   * landed eight slides up.
   */
  lastSeenSeq: number;
  /** Per-card renderer state that must survive a reopen: a dismissed card must stay dismissed. */
  collapsed: boolean;
  removed: boolean;
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

/**
 * The private thread behind one segment's whisper popover (`flow-build-plan.md` §3.5,
 * `pivot-spec.md` §B5).
 *
 * It is a `WhisperThreadView` that knows where it is. `anchorId` is the whole of the
 * ephemerality rule on the renderer's side: the popover shows this thread and only this thread,
 * and a thread belongs to one **segment sitting** — see `actor.openSegmentWhisper()`.
 */
export interface FlowWhisperView {
  anchorId: string;
  threadId: string;
  agent: AgentProfile;
  turns: WhisperTurnView[];
  limitsLine: string;
}

/**
 * What an approved *Insert into the document* produced: the new **shared** card, and the room as
 * it now stands. The private thread is not in it, and never is.
 */
export interface FlowRelayView {
  messageId: string;
  anchorId: string;
  attribution: RelayAttribution;
  flow: FlowRoomView;
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

// ── Turn status on the wire (cui-standards-audit.md §2, issue #34) ─────────────────────────
/**
 * **Three new events, 16 Sep 2026.** The flow inherited the conversation's *content* from the
 * chat room and none of its *status surfaces*; these are the missing ones. Read them in order.
 *
 * 1. **`turn.received`** — *the room has your message.* Emitted the instant the actor accepts a
 *    learner turn: **before** the floor-yield sleep, before the orchestrator, before any model
 *    call. It exists so the 3–8 s window that `product-design.md` §C3 deliberately keeps free of
 *    **agent** chrome is never a blank screen (`design-brief.md` §D4 asks for an indicator during
 *    the hold; the audit reconciles the two — the yield window shows **room** state, not agent
 *    state). Render it neutral and un-attributed: *"Sent · the room has 8s to respond"*, no name,
 *    no avatar, no verb. `responder` is filled only when a rule already fixes the speaker (an
 *    anchored thread is the Teacher's by `rule:teacher_answers`); it is there for the reserved
 *    slot's **position** and for the debug drawer, and must not put a name on screen during the
 *    yield.
 *
 * 2. **`turn.delta`** — one chunk of an agent reply, **already past the floor**. Nothing is ever
 *    emitted before the floor has elapsed: whatever the model produced during the hold is
 *    flushed as a single first delta at the moment the floor passes, and the remainder streams
 *    live. The floor is a floor on *visible* TTFT, not on generation (`design-brief.md` §D4,
 *    Tan et al. §3.2.3), so `ttft_actual_ms` on the message is the first **visible** token.
 *    Render the accumulating text as a provisional block keyed on `turnId`.
 *
 * 3. **`turn.released`** — the turn is over. Emitted **exactly once** for every turn that opened
 *    a `turn.received`, whatever the ending: a message (`messageId` names it, and it arrives
 *    immediately after that `message.appended`), a partial the learner stopped (`stopped: true`,
 *    which is not a failure and never nudges), a failure card, or a decision to stay quiet —
 *    the last two with `messageId: null`. Clear the provisional block and the "Sent…" line on
 *    it and a thread can never be left acknowledging a turn that has moved on.
 */
export interface TurnParticipantView {
  agentKey: string;
  role: AgentRole;
  displayName: string;
  colour: string;
}

export interface TurnReceivedView {
  /** The correlation id every event, log line and `flow:turnTrace` row for this turn carries. */
  turnId: string;
  /**
   * The learner message that was accepted — already on `message.appended`, so the renderer can
   * match its optimistic block to this acknowledgement. Null on a `promote`, which answers an
   * approved whisper relay rather than a message the learner typed into the thread.
   */
  messageId: string | null;
  anchorId: string | null;
  receivedAt: string;
  /**
   * How long the room will show **no agent chrome at all**, in ms (`FLOOR_YIELD_MS`, halved or
   * zeroed by Settings ▸ Reply speed). The neutral "the room has your message" line is the only
   * thing that may be on screen for this long.
   */
  yieldMs: number;
  /** The floor target for the reply, when a rule already fixed the speaker; null otherwise. */
  etaMs: number | null;
  /** See the note above: position and diagnostics only, never a name during the yield. */
  responder: TurnParticipantView | null;
}

/** What `flow:stop` answers. A stop before the floor has elapsed is refused, not queued. */
export type StopTurnResult = { stopped: true; turnId: string } | { stopped: false; refused: 'floor' | 'unknown' };

/**
 * One turn's timings for the ⌥⌘D debug drawer (audit §10). **No bodies, ever** — the same rule
 * the log sink enforces by key name. Read from an in-memory ring in the actor, newest last.
 */
export interface TurnTraceView {
  turnId: string;
  roomId: string;
  anchorId: string | null;
  trigger: string;
  startedAt: string;
  decidedBy: string | null;
  role: AgentRole | null;
  moveType: string | null;
  model: string | null;
  backend: string | null;
  /** Orchestrator round trip. 0–4 ms on the rule path, seconds on the model path. */
  decisionMs: number | null;
  /** Wall time of the generation call itself, floor excluded. */
  generationMs: number | null;
  /** Time to the first **visible** token — after the floor, which is the whole point. */
  ttftActualMs: number | null;
  latencyTargetMs: number | null;
  /** Turn start → the message row. What the learner actually waited. */
  totalMs: number | null;
  usage: Record<string, number>;
  stopped: boolean;
  /** The failure reason, when the turn ended in a card instead of a message. */
  failed: string | null;
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
  | { type: 'notice'; roomId: string | null; level: 'info' | 'error'; text: string }
  | { type: 'turn.failed'; roomId: string; failure: TurnFailureView }
  | { type: 'turn.failed.cleared'; roomId: string; failureId: string }
  | { type: 'turn.received'; roomId: string; received: TurnReceivedView }
  | { type: 'turn.delta'; roomId: string; turnId: string; anchorId: string | null; participant: TurnParticipantView; text: string }
  | { type: 'turn.released'; roomId: string; turnId: string; messageId: string | null; stopped: boolean };

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
