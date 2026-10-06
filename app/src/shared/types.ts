/**
 * Domain and view types shared by the main process, the preload bridge and the renderer.
 *
 * Everything here is plain data: it crosses the Electron IPC boundary, so it must survive
 * structured cloning. No classes, no Dates, no functions. Timestamps are ISO-8601 strings,
 * which is also how they are stored in SQLite (architecture-mac.md §D.1).
 */
import type { DocRoomEvent } from './docevents.js';
import type { LearningObjectiveState, LearningTree } from './objectives.js';
import type { CostUpdate } from './cost.js';

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

/**
 * **What a card in the flow *is*** (issue #41).
 *
 * `'turn'` is a conversation turn — the learner's, Ellie's, Max's — and is the default for every
 * row ever written. `'summary'` is the artefact: a typeset, capped, REFERENCE-register card
 * written **from a thread** and inserted under the segment, produced by `flow:summarise` and
 * never by a model deciding to write one (`conversation-refinement.md` §5).
 *
 * `'answer'` is the retired REFERENCE entry card of `pivot-spec.md` §B1. Nothing mints it any
 * more — the Teacher answers the entry question now — and migration 017 rewrites the ones that
 * exist into `'summary'`. It stays in the union so that a row which escaped the migration (an
 * older vault opened on a newer build) still renders as what it was rather than as a turn.
 */
export type MessageKind = 'turn' | 'answer' | 'summary';

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
   * The **client** kind, as the message row stores it: `'claude-cli' | 'anthropic' | 'openai' |
   * 'gemini' | 'openai-compatible' | 'scripted'`.
   * Deliberately not `BackendKind` — that is Settings' vocabulary (`claude_cli`, underscore) and
   * the two must not be silently conflated.
   */
  backend?: string | null;
  /** Turn start → the message row: what the learner actually waited. */
  totalMs?: number | null;
  /**
   * **What the model was allowed to see** (issue #35, migration 015). A ready-to-render phrase,
   * not a code: `'p. 14'`, `'p. 14 + outline'`, `'whole deck'`, `'outline + pp. 3, 14, 40'`.
   * The footer that shows `14:22 · 9.4s · haiku-4-5 · claude-cli` should show it too, so that an
   * answer which is narrow because it was shown one slide does not read as an answer which is
   * narrow because the model is weak. `null` on everything that is not a REFERENCE answer.
   */
  scopeShown?: string | null;
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
   *
   * **`'offer_summary'`** (issue #41) is the second value: a one-line Teacher turn offering to
   * summarise this thread into the document. Render it with the **Summarise into the document**
   * action on it; the offer is a sentence and the button is the whole of what it does. It is
   * posted at most once per thread and never inserts anything by itself (R1).
   */
  byRule: string | null;
  /**
   * **What this card is** (issue #41). `'turn'` on everything the conversation produced;
   * `'summary'` on the artefact a thread was summarised into; `'answer'` only on a legacy
   * REFERENCE entry card. Render a `'summary'` as a typeset document artefact, visually distinct
   * from the deck's own crops (`pdf-fidelity-segmentation.md` §C4) and from a chat turn.
   */
  kind?: MessageKind;
  /**
   * On a `'summary'` card: the thread it was written from — an `anchorId`, which is what a thread
   * is identified by everywhere in the flow. Clicking the card expands that thread beneath it
   * (`flow:threadOf` returns its message ids), and the card's composer continues **that** thread
   * rather than opening a new one. `null` on everything else.
   */
  sourceThreadId?: string | null;
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
  /** 'scripted' replays design-brief.md §G; 'live' calls a real model (the CLI or an API provider). */
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
  | 'settings.open'
  | 'notes.regenerate'
  | 'chat.reset'
  /** View ▸ Show or Hide Files — the shell's file panel (`layoutstore.svelte.ts`). */
  | 'files.toggle'
  /** File ▸ Export Research Data… — handled by the trial store, not `store.runCommand`. */
  | 'research.export'
  /** File ▸ New Notebook (`docs/research/notebooks.md` §1). */
  | 'notebook.new'
  /** File ▸ Add Sources… — the picker, into the open notebook. */
  | 'notebook.addSources'
  /** View ▸ Notebooks — the home grid. */
  | 'notebook.home'
  /** View ▸ Search All Notebooks (⇧⌘F) — the search page (`docs/research/search.md` §5). */
  | 'search.open'
  /** View ▸ Show or Hide Slides / Notes / Results (⌘J ⌘K ⌘L) — the search page's columns. */
  | 'search.toggleSlides'
  | 'search.toggleNotes'
  | 'search.toggleHits';

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

/**
 * The API providers a learner can bring their own key for (BYOK, 2026-09-25). `anthropic` was the
 * first (#15); `openai_compatible` is any endpoint that speaks OpenAI's Chat Completions dialect
 * at a base URL the learner types — OpenRouter, Ollama, LM Studio, Groq, DeepSeek, vLLM.
 */
export type ApiProvider = 'anthropic' | 'openai' | 'gemini' | 'openai_compatible';

/** In the order `auto` tries them when no preferred provider is set, after the Claude CLI. */
export const API_PROVIDERS: readonly ApiProvider[] = ['anthropic', 'openai', 'gemini', 'openai_compatible'];

/** The live backends, plus 'auto' for "pick the best one available" (issue #19). */
export type BackendKind = 'claude_cli' | ApiProvider | 'scripted';
export type BackendChoice = 'auto' | BackendKind;

/**
 * One API provider, as Settings shows it. Never carries the key: `keyHint` is `••••1a2b`.
 */
export interface ProviderView {
  id: ApiProvider;
  label: string;
  /** Whether a key is stored. */
  hasKey: boolean;
  keyHint: string | null;
  /** False only for `openai_compatible`, where a local server may take none. */
  keyRequired: boolean;
  /** The file the key lives in, under Application Support, for the copy under the field. */
  keyFile: string;
  /** Whether this provider can answer right now: a key (or, for compatible, a URL and a model). */
  configured: boolean;
  /** The learner's two model choices, resolved against the provider default. '' when there is none. */
  agentModel: string;
  orchestratorModel: string;
  /** The provider's defaults, for the "(default)" mark in the dropdown. '' for compatible. */
  defaultAgentModel: string;
  defaultOrchestratorModel: string;
  /** Dropdown suggestions. Free text is always allowed too. Fable is never among them. */
  suggestions: string[];
  /** `openai_compatible` only: the base URL, or null. */
  baseUrl: string | null;
}

/** What Settings ▸ Test connection reports. */
export interface ProviderTestResult {
  ok: boolean;
  provider: ApiProvider;
  model: string;
  /** Wall time of the one tiny call. */
  ms: number;
  /** On failure: the sentence the client threw. On success: null. */
  error: string | null;
}

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
  /**
   * What the learner chose. 'auto' means the Claude CLI, then the preferred API provider, then
   * the first configured provider (anthropic, openai, gemini, openai_compatible), then scripted.
   */
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
  /** Whether an **Anthropic** key is stored (#15). Every provider's own flag is on `providers`. */
  hasApiKey: boolean;
  /** Every API provider, in `API_PROVIDERS` order. */
  providers: ProviderView[];
  /** The provider `auto` prefers after the Claude CLI, or null for "the first one configured". */
  preferredProvider: ApiProvider | null;
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
  /**
   * **A learner-supplied price table, merged over the built-in one** (`src/main/cost/rates.ts`).
   *
   * The JSON exactly as it is stored, or `''` when there is none — not a parsed object, because
   * what Settings shows in the box has to be what the learner typed, including the typo that
   * made one entry invalid. Shape:
   * `{"claude-sonnet-5": {"input": 2, "output": 10}}`.
   *
   * It exists because these prices are cached rather than fetched and this app ships unsigned to
   * a cohort for a semester: when a price changes, the right fix is a build and the right
   * *fallback* is a settings row.
   */
  rateCardOverride: string;
  /**
   * What was wrong with it, entry by entry, from `parseRateCardOverride()`. Empty when the
   * override parsed cleanly or there is none. Rendered under the box: a malformed entry is
   * **ignored**, not fatal, and the learner has to be able to see which one.
   */
  rateCardErrors: string[];
  /** The date the built-in card was priced on, for the line under the box. */
  rateCardDate: string;
}

export interface SettingsPatch {
  backendChoice?: BackendChoice;
  /** Which API provider `auto` tries first after the Claude CLI. null clears it. */
  preferredProvider?: ApiProvider | null;
  /**
   * One API provider's model choices. `''` returns a role to the provider default. A Fable id is
   * refused, exactly as it is for the CLI's two fields.
   */
  providerModels?: { provider: ApiProvider; agent?: string; orchestrator?: string };
  /** `openai_compatible`'s base URL. http only for localhost; https otherwise. '' clears it. */
  compatibleBaseUrl?: string;
  cliPathOverride?: string | null;
  agentModel?: string;
  orchestratorModel?: string;
  flowProfile?: 'default' | 'demo';
  /** Set false from Settings to show the pacing strip again; set true when it is dismissed. */
  pacingStripSeen?: boolean;
  replySpeed?: ReplySpeed;
  /**
   * The rate-card override, as typed. `''` (or whitespace) clears it and returns to the built-in
   * card. **It is stored whether or not it parses**: the errors come back on `SettingsView` and
   * the pricing falls back per entry, because a box that silently refuses to keep what was typed
   * is a box nobody can correct a typo in.
   */
  rateCardOverride?: string;
}

export interface Bootstrap {
  appVersion: string;
  /** Whether any API provider is configured (a key, or a compatible endpoint). */
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
  /**
   * The deck's table of contents — segment labels with their page numbers, one per line
   * (migration 013). Frozen on the material and emitted into the prefix, so the agents can say
   * *where* a thing sits and a whole-deck question has headings to answer from. Omitted for
   * pasted text, which has no pages to outline.
   */
  outline?: string;
  /**
   * **Open this room with no concept pack** (issue #35, migration 014). Set by the flow for any
   * deck that is not a committed fixture: the pack is drafted in the background and swapped in
   * at the next turn, so the first "+ Ask here" is not held behind a 37-second ingest and no
   * deck is ever scored against another deck's claims. Mutually exclusive with `conceptId`.
   */
  pending?: boolean;
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
   * **Always `null` since issue #41**, and kept only so an older renderer still parses.
   *
   * It used to name the REFERENCE answer a thread was waiting on: while it was set, neither
   * Ellie nor Max could post there until the learner pressed *Explain it back*. The Teacher now
   * answers the entry question herself (`conversation-refinement.md` §2), so there is no entry
   * card to be locked behind and nothing ever sets this. Render a composer, always.
   */
  lockedByAnswerId: string | null;
  /**
   * **The Tester's open question in this thread**, if any (issue #47, `attempt-first.md` §2.3).
   * Null when no quiz is open here. The renderer reads it for three things: the composer's
   * *"Max won't give the answer until you've tried once"* line (`attempts === 0`), the **Show the
   * answer** control (`attempts >= 1 && !answerShown`), and **Try another** (after `feedbackGiven`).
   */
  quiz: FlowQuizView | null;
}

/** What the renderer may know about a pending quiz. Never the answer, never the seeds. */
export interface FlowQuizView {
  /** The Tester message that asked it. */
  quizMessageId: string;
  /** The objective / pack element under test. */
  elementId: string;
  /** Learner turns classified as an attempt since the question was asked (`core/attempt.ts`). */
  attempts: number;
  /** True once the Tester's feedback turn has landed for the latest attempt. */
  feedbackGiven: boolean;
  /**
   * What that feedback said about the attempt: `complete` (it opened "Well done."), or `partial`
   * (it ended on a follow-up question, and the composer asks for the next attempt). `null` until
   * feedback has landed on the latest attempt; absent from a build before this.
   */
  verdict?: 'complete' | 'partial' | null;
  /** True once `flow:showAnswer` (or an answer request after one attempt) has been honoured. */
  answerShown: boolean;
  /**
   * **Max has offered Show me** (2026-10-06, D3; `core/pitch.followUpPlan`): after the second
   * answer that was not *Well done*, or after a guess, his feedback asks nothing smaller and the
   * composer's Pass becomes **Show me**. Absent from a main built before this.
   */
  showMe?: boolean;
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

/**
 * What `flow:askHere` and `flow:askDeck` give back: the room (possibly just created), the
 * learner's own question as it was written, and the threads as they now stand.
 *
 * **It no longer carries an answer** (issue #41). The entry question used to be answered inline
 * by the REFERENCE voice, in one round trip, which is why this shape had a body on it. The
 * Teacher answers it now, so the reply arrives the way every other Teacher turn arrives — on the
 * event stream, at its latency floor, after the 3–8 s yield — and the three fields below are
 * `null` on every Ask made on this build. They are kept, rather than deleted, so a renderer that
 * still reads them gets a defined value instead of a crash mid-render.
 */
export interface FlowAnswerView {
  roomId: string;
  anchorId: string;
  questionId: string;
  /** Null since #41. Watch `message.appended` / `turn.delta` on `anchorId` for the reply. */
  answerId: string | null;
  /** Null since #41. */
  body: string | null;
  /** False since #41: nothing on this path is truncated any more. */
  truncated: boolean;
  /**
   * What the model was given, already phrased for the footer — `'p. 14'`, `'p. 14 + outline'`,
   * `'whole deck'`, `'outline + pp. 3, 14, 40'` (issue #35, `shared/scope.ts`). Still resolved on
   * every Ask, because the scope still decides what the Teacher is shown, and still carried on
   * the reply's own `MessageView`.
   */
  scopeShown: string;
  flow: FlowRoomView;
}

/**
 * **The artefact** (issue #41, `conversation-refinement.md` §5): what
 * **Summarise into the document** produced.
 *
 * The card itself is an ordinary `MessageView` on `flow.room.messages`, with
 * `kind: 'summary'` and `sourceThreadId` set — this is the handle to it, plus the room as it now
 * stands, in the shape every other flow mutation returns.
 */
export interface FlowSummaryView {
  roomId: string;
  /** The segment the card was inserted under. */
  anchorId: string;
  messageId: string;
  /** The thread it was written from. Equal to `anchorId` for a thread under its own segment. */
  sourceThreadId: string;
  /** The card's body: prose in the REFERENCE register, capped in code, maths in `$…$`. */
  body: string;
  /** True when the model ran over the cap and the body was cut. */
  truncated: boolean;
  /** True when this replaced an existing card for the same thread rather than adding one. */
  regenerated: boolean;
  flow: FlowRoomView;
}

/**
 * **The conversation behind a summary card** (issue #41): what `flow:threadOf` returns, so a
 * click on the card can expand its source thread beneath it.
 *
 * Ids, not messages, for the same reason `FlowThreadView` is: the bodies already travel on
 * `flow.room.messages` and two copies could disagree. `null` when the id is not a summary card,
 * or its thread no longer exists.
 */
/**
 * **"+ Try this"** on a segment (issue #47): the Tester has been asked for one question on the
 * objective the card teaches. Resolves as soon as the pick is made; the question itself arrives
 * on the event stream at the short latency band, like a Teacher turn.
 */
export interface FlowTryView {
  roomId: string;
  anchorId: string;
  /** The objective the pick chose (`attempt-first.md` §2.1). */
  objectiveId: string;
  /** Why no question could be asked, when the tree is not ready; `null` on success. */
  refused: string | null;
  flow: FlowRoomView;
}

/** **Show the answer** after at least one attempt (issue #47, `rule:answer_shown`). */
export interface FlowShowAnswerView {
  roomId: string;
  anchorId: string;
  /** False when refused: no open quiz here, or no attempt yet. The ledger never moves on this. */
  shown: boolean;
  refused: string | null;
  flow: FlowRoomView;
}

export interface FlowThreadOfView {
  summaryId: string;
  threadId: string;
  messageIds: string[];
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
  // The collab doc's events (#48) live beside this file so the union gains one line, not eight.
  | DocRoomEvent
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
  | { type: 'turn.released'; roomId: string; turnId: string; messageId: string | null; stopped: boolean }
  /**
   * **The concept pack this deck was waiting for has arrived** (issue #35).
   *
   * A flow room opens on a `pending` pack — no elements, an empty rail — so that the first
   * "+ Ask here" is not held behind a 37-second ingest and no deck is ever given another deck's
   * claims. When the background draft lands, the material row is rewritten and this is emitted.
   *
   * `ledger` is the rail as it now stands, so a renderer that only handles `ledger.updated` is
   * already correct: **`ledger.updated` is emitted alongside this**, carrying the same rows. The
   * extra field here is `conceptTitle`, which is what the rail's heading and the round card say.
   */
  | { type: 'pack.ready'; roomId: string; conceptTitle: string; elements: number; ledger: LedgerView }
  /**
   * **The file's learning-objective tree changed status** (issue #38, §6).
   *
   * Emitted on `pending` (the ingest has started, so the panel can say "Ellie is reading the
   * deck…"), on `ready` and on `failed` — a status change, never a heartbeat. `roomId` is null
   * until the deck has a room: the ingest starts on first open, which is before the first
   * question, which is what creates one.
   */
  | { type: 'objectives.tree'; roomId: string | null; fileId: string; tree: LearningTree }
  /**
   * **One node moved** (§4). Carried per node rather than as a whole tree because the panel
   * animates the node that just lit, and a wholesale redraw cannot say which one that was.
   * `evidenceMessageIds` on the state are the **learner's own** messages that earned it.
   */
  | { type: 'objectives.state'; roomId: string | null; fileId: string; state: LearningObjectiveState }
  /**
   * **One call was counted** (`src/main/cost/`).
   *
   * The cost ledger already pushes this on its own channel, `IPC.costUpdated` / `onCostUpdated`,
   * and that channel is unchanged. It is **also** on the room stream because every other
   * per-turn push in the app is, and a renderer that already holds one `onEvent` subscription
   * should not need a second one to make a header counter tick — the live run that found this
   * was falling back to `turn.released`, which ticks on turns and misses the orchestrator, the
   * ledger, the ingest and the summary calls entirely.
   *
   * **The same payload, pushed twice. Subscribe to one.** `onCostUpdated` is the typed,
   * single-purpose channel; this is the same `CostUpdate` on the stream a room already listens
   * to. Counting both would double every figure.
   *
   * `roomId` is null for a call that belongs to no room — the concept or objectives ingest,
   * which runs on a file before a room exists.
   */
  | { type: 'cost.updated'; roomId: string | null; update: CostUpdate };

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
