/**
 * The Room actor — the orchestrator loop, in the main process, in one place.
 *
 * One turn, end to end (architecture-mac.md §C.2):
 *   student message → cancel the timer (bump the epoch) → persist → judgement runs *inside*
 *   the delay window (orchestrator + ledger, concurrently) → the rail animates → the agent's
 *   reply is released at its latency floor → the timer is re-armed.
 *
 * Three properties this file is responsible for keeping true:
 *  - **the hold is a floor on visible TTFT, not an added delay** (design-brief.md §D4): the
 *    model call starts immediately, and the reply is buffered until the floor;
 *  - **a held reply is cancelled, not queued, when the learner speaks** (turn rule 6);
 *  - **a group prompt is assembled from a store view that has no whispers** (§D.4).
 */
import { NO_DOC, type DocPort } from './docport.js';
import {
  DOC_ANCHOR_ID,
  SPAN_THREAD_PREFIX,
  type AgentAuthor,
  type AgentDocOpBatch,
  type DocQuizView,
  type PrivateTurnView,
  type QuizOutcome,
  type QuizVerdict3,
  type ThreadKind,
  type ThreadView,
} from '../shared/doc/types.js';
import { parseMention } from '../shared/doc/mention.js';
import { DECK_ANCHOR_ID } from '../shared/scope.js';
import {
  buildQuestionEdit,
  buildResolveEdit,
  buildWhisperInsert,
  planAnswerEdit,
  planSuggestionEdit,
  type DocEditDeps,
} from './docedit.js';
import {
  ELLIE_CUE_SCHEMA,
  cueCorrectionLines,
  docTextBlock,
  ellieAnswersBlock,
  ellieCueBlock,
  learnerNotesBlock,
  lessonStartBlock,
  maxFollowupBlock,
  maxPromptBlock,
  mentionReplyBlock,
  releaseBlock,
} from './prompts.doc.js';
import type {
  AgentProfile,
  ReplySpeed,
  StopTurnResult,
  FlowQuizView,
  FlowWhisperView,
  MessageView,
  RecapView,
  RelayAttribution,
  RoomSnapshot,
  TeachbackResult,
  ThinkingView,
  TurnFailureView,
  TurnParticipantView,
  TurnTraceView,
  WhisperThreadView,
} from '../shared/types.js';
import { agentByKey, agentByRole, latencyTargetMs, otherStandingAgent } from './agents.js';
import { buildGroupContext } from './context.group.js';
import { buildWhisperContext } from './context.whisper.js';
import { LEDGER_SCHEMA, applyLedgerRules, type LedgerProposal } from './ledger.js';
import type { LLMClient, LlmBackend } from './llm/types.js';
import { API_PLAN, type ModelPlan } from './llm/models.js';
import { Mailbox } from './mailbox.js';
import {
  REFERENCE_DISPLAY_NAME,
  anyAnchorLocked,
  findReferenceParticipant,
  isAnchorLocked,
  type ReferenceAnswerState,
} from './reference.js';
import {
  SUMMARY_OFFER_LINE,
  buildSummaryRequest,
  composeSummaryBody,
  renderThread,
  shouldOfferSummary,
  summaryInThread,
} from './summary.js';
import { classifyLearnerTurn, quizCue, type LearnerTurnKind } from './attempt.js';
import {
  FLOW,
  answerQuiz,
  attemptsOf,
  feedbackDue,
  handOffDue,
  handOffLine,
  markAnswerShown,
  markCueGiven,
  markFeedbackGiven,
  cueGiven,
  cueMistakeToCorrect,
  feedbackVerdict,
  feedbackVerdict3,
  qResolutionOf,
  verdictOf,
  verdict3Of,
  quizOpen,
  noteActivity,
  noteHandOff,
  openQuiz,
  pickTarget,
  openSession,
  tickSession,
  type FlowProfile,
  type FlowSession,
  type PendingQuiz,
  type TaughtItem,
  type TesterMode,
} from './flow.js';
import {
  classifyAgentTurn,
  closureDecision,
  decideTurn,
  extractJson as extractJsonObject,
  followupDue,
  lessonStartDecision,
  maxFollowupDecision,
  type LastAgentTurn,
  type TurnDecision,
  type TurnTrigger,
} from './orchestrator.js';
import { SILENT_LOG, type Clock, type Store, type Transport, type TurnLog } from './ports.js';
import type { ConceptPack, LedgerRow, MessageRefRow, MessageRow, RoomConfig } from './records.js';
import type { ReferenceContext } from './reference.js';
import { latestByElement } from './flow.js';
import {
  decisionDirective,
  learnerBlock,
  ledgerDirective,
  quizBlock,
  taughtBlock,
  type QuizTurn,
  teachObjectiveBlock,
  whereBlock,
} from './prompts.js';
import {
  DEFAULT_PITCH,
  notePitch,
  pitchBlock,
  pitchInputs,
  pitchLine,
  type PitchInputs,
  type PitchOutcome,
  type PitchState,
} from './pitch.js';
import { progressFill } from '../shared/doc/progress.js';
import { ledgerSystemBlock } from './prompts.ledger.js';
import { limitsLine } from './prompts.whisper.js';
import { SCRIPT_WHISPERS } from './llm/script.psd-hessian.js';
import { roundCardFor } from './roundcard.js';
import { SilenceTimer, silenceStagesMs, wordCount, type SilenceStages } from './timer.js';
import { ledgerView, messageView, timerView, whisperTurnView } from './views.js';

/** No agent indicator at all for the first 8 s after a learner message (product-design.md §C3). */
export const FLOOR_YIELD_MS = 8_000;
/** Doubled after a stage-2 fill: the learner needs room to reject a half-idea (§C5). */
export const FLOOR_YIELD_AFTER_SCAFFOLD_MS = 16_000;

/**
 * Stage-1 nudges are drawn from a pool and are never generated against the concept. This is
 * enforced in the product, not just in the prompt (§C5): a nudge that supplies subject matter
 * turns a persistence problem into a comprehension shortcut.
 */
/**
 * How often the actor checks whether the sitting has gone idle with a question still open
 * (#48 §4.7). Thirty seconds against a twenty-minute gap — see `start()`.
 */
export const CLOSURE_TICK_MS = 30_000;

export const CONTENT_FREE_NUDGES = [
  'Still turning it over? Happy to wait. Or I can make the question smaller if that helps.',
  'No rush — want me to break the question into two?',
  "Take your time. If it helps, say the bit you're sure about first.",
];

export interface RoomActorDeps {
  store: Store;
  /** The narrowed view handed to every group-scope prompt. */
  groupStore: Parameters<typeof buildGroupContext>[0];
  clock: Clock;
  transport: Transport;
  llm: LLMClient;
  roomId: string;
  sessionId: string;
  roster: AgentProfile[];
  pack: ConceptPack;
  config: RoomConfig;
  /**
   * Which model answers which call (issue #19). The actor does not choose it and cannot tell
   * which backend resolved it — it just stamps it on the orchestrator and ledger requests,
   * the way the roster already stamps the agent model on a group turn.
   */
  models?: ModelPlan;
  /** Settings ▸ Reply speed as it stands when the room opens; `rebind()` updates it after. */
  replySpeed?: ReplySpeed;
  appVersion: string;
  /** `FLOW` by default; `DEMO` is the disclosed filming profile (flow.ts). */
  flowProfile?: FlowProfile;
  /**
   * The flow session as it stood when the app last ran, restored on relaunch. A flow session is
   * bounded by an absolute deadline, so a sitting must survive a quit the way the silence timer
   * does — `tickSession` then closes it on the first tick if the gap elapsed while the app was
   * shut (flow-session.md §8.1 close condition 3).
   */
  flowState?: {
    session?: FlowSession | null;
    taught?: TaughtItem[];
    pendingQuiz?: PendingQuiz | null;
    /**
     * The REFERENCE cards and whether each has been explained back. Restored with the rest,
     * because property 4 — no agent posts into that thread until the learner says it back — is
     * a promise about the *card*, and the card is still on screen after a relaunch.
     */
    answers?: ReferenceAnswerState[];
    /**
     * The unread marks and the per-card `collapsed` / `removed` (audit §7). Restored with the
     * rest because both are answers to "what did I already deal with?", and a deck that reopens
     * with a dismissed card back and a reply the learner never read silently marked as read is
     * the app forgetting on their behalf.
     */
    seen?: Record<string, number>;
    cards?: Record<string, { collapsed?: boolean; removed?: boolean }>;
    /** anchorId → the objective a thread was opened about (issue #38 §5). */
    objectives?: Record<string, string>;
    /** The per-file pitch (#41, `pitch.ts`). Absent on a state written before that build. */
    pitch?: PitchState;
    /** Threads already offered a summary card (#41). "At most once" outlives a relaunch. */
    offeredSummary?: string[];
  };
  newId: (prefix: string) => string;
  /** Injectable for deterministic tests. */
  random?: () => number;
  /**
   * Structured logging. Defaults to silent, so tests and any non-Electron host stay quiet; the
   * main process passes `src/main/log.ts`. Sizes, ids, models and durations only — never a body.
   */
  log?: TurnLog;
  /**
   * **The learning-objective states, written from the ledger's own output** (issue #38 §4).
   *
   * A callback rather than a repository on the `Store` port, because an objective is keyed per
   * *file* and this module knows about rooms, sessions and elements. The actor says "these rows
   * moved"; the main process, which knows which file the room is on, mirrors them. Nothing is
   * judged twice — these are `applyLedgerRules`' rows, after its four rules.
   */
  onLedgerApplied?: (input: { rows: LedgerRow[]; changed: string[] }) => void;
  /** The Teacher taught this element, just now. Feeds `taughtAt` on the file's state (§4). */
  onTaught?: (input: { elementId: string; at: string }) => void;
  /**
   * **What this learner has shown, on this file** (issue #41), for `prompts.learnerBlock()`.
   *
   * A callback for the same reason `onLedgerApplied` is one: the objective tree is keyed per
   * *file*, and this module knows about rooms. It is read once per Teacher turn and may return
   * an empty array — which is not a failure, it is the *assume less* default, and the block says
   * so in as many words.
   */
  learnerObjectives?: () => readonly {
    title: string;
    level: 0 | 1 | 2 | 3;
    assumedByDeck: boolean;
  }[];
  /**
   * **The notes doc, as the actor sees it** (collab-doc §5, #48; `docport.ts`). Optional: a room
   * with no doc gets `NO_DOC`, where every read is empty and every write is dropped, so nothing
   * downstream needs a null check.
   */
  docPort?: DocPort;
}

interface PendingTurn {
  id: string;
  cancelled: boolean;
  /** True once the floor has elapsed — and only then may this turn be stopped. */
  floorPassed: boolean;
  /** Set by `stopTurn`. Not a failure: no card, no Retry, no nudge on top of it. */
  stopped: boolean;
  /** Aborts the client call. The CLI path kills its child process on it. */
  abort: AbortController;
  /**
   * The segment this turn belongs to, carried so that the three model calls it makes — the
   * orchestrator decision, the agent's reply and the ledger update — are billed to the thread
   * the learner is actually in (`src/main/cost/`). Read by nothing else.
   */
  anchorId: string | null;
}

/**
 * **The floor, applied to tokens instead of to the whole reply.**
 *
 * `design-brief.md` §D4 asks for a floor on *visible* time to first token, and Tan et al. §3.2.3
 * is about when a reply starts arriving, not about when it finishes. Until now the actor honoured
 * that by buffering the entire generation and posting it as one block, which is correct and also
 * means a 200-word Teacher turn behind a 40 s cold start shows nothing for 40 s and then
 * everything at once. Both clients have streamed all along (`claude-cli.ts` parses
 * `content_block_delta`, `anthropic.ts` likewise) and the deltas were accumulated and thrown away.
 *
 * So: deltas that arrive **during** the hold go into the buffer and nothing is emitted. The
 * moment the floor elapses the buffer is flushed as a single delta — that is the visible first
 * token, and `ttft_actual_ms` is measured there — and everything after it streams live. Nothing
 * becomes visible one millisecond earlier than it did before; a long turn now unrolls instead of
 * thudding.
 */
class TurnStream {
  readonly #emit: (text: string) => void;
  readonly #now: () => number;
  #buffer = '';
  #open = false;
  #closed = false;
  #text = '';
  /** When the first token became **visible**, not when the model produced it. */
  firstVisibleAt: number | null = null;

  constructor(emit: (text: string) => void, now: () => number) {
    this.#emit = emit;
    this.#now = now;
  }

  /** Everything the client has produced so far, floor or no floor. */
  get text(): string {
    return this.#text;
  }

  push(delta: string): void {
    if (this.#closed || delta.length === 0) return;
    this.#text += delta;
    if (!this.#open) {
      this.#buffer += delta;
      return;
    }
    if (this.firstVisibleAt === null) this.firstVisibleAt = this.#now();
    this.#emit(delta);
  }

  /** The floor has elapsed. Flush what the hold accumulated, then go live. */
  openFloor(): void {
    if (this.#open || this.#closed) return;
    this.#open = true;
    if (this.#buffer.length === 0) return;
    this.firstVisibleAt = this.#now();
    const flush = this.#buffer;
    this.#buffer = '';
    this.#emit(flush);
  }

  /** A cancelled or stopped turn stops emitting; whatever was said stays in `text`. */
  close(): void {
    this.#closed = true;
  }
}

/** What `Retry` needs to replay the *same* turn rather than schedule a new one. */
interface TurnReplay {
  trigger: TurnTrigger;
  anchorId: string | null;
  silenceStage?: 1 | 2;
}

interface FailureRecord {
  view: TurnFailureView;
  replay: TurnReplay | null;
}

export class RoomActor {
  readonly #d: RoomActorDeps;
  readonly #mailbox = new Mailbox();
  readonly #timer: SilenceTimer;
  #pending: PendingTurn | null = null;
  #thinking: ThinkingView | null = null;
  #challenged = new Set<string>();
  #studentTurns = 0;
  #silenceFires = 0;
  #whisperTurns = 0;
  #lastProbeType: string | null = null;
  /**
   * **Tester questions asked in this actor's lifetime, across both doors** (issue #47).
   *
   * The time-based hand-off (`rule:handoff`) and "+ Try this" (`rule:try_here`) both ask one, and
   * every turn that belongs to question *N* — the question, its feedback, its hints, its
   * clarifications, its answer — carries `:N` in its script cue (`attempt.quizCue`). One counter,
   * because the scripted beats are written against those names and a second counter would let the
   * feedback for question 2 be cued as question 1's.
   */
  #testerQuestions = 0;
  /**
   * **What the learner's last turn was** (`attempt.ts`), carried from the mailbox tick that wrote
   * the row to the decision that answers it. The answer lock reads it; nothing else may.
   */
  #lastLearnerTurn: LearnerTurnKind | null = null;
  /**
   * **This window's silence thresholds** (#47 §5), from the word count of the last agent turn. Kept
   * here as well as in the timer because the divider copy ("Ns quiet · …") has to name the same
   * number the timer actually waited.
   */
  #stages: SilenceStages;
  #lastFillWasScaffold = false;
  #typingUntil = 0;
  #openedAt: number;
  #firstHelpAt: number | null = null;
  /**
   * The flow session (#33). It opens on the first **learner-authored** action, never on the room
   * simply being open: `flow-session.md` §8.1 — a reader who scrolls and leaves has not started
   * a session, and sessions that open on `document.open` corrupt the gap distribution the A1 log
   * exists to collect.
   */
  #flow: FlowSession | null = null;
  #taught: TaughtItem[] = [];
  /**
   * **Which objective a thread is about** (issue #38 §5), anchor by anchor.
   *
   * Set when the learner opens an Ask from a node in the objectives panel, or presses *Teach me
   * this*; read by `#insertMessage`, so every message in that thread carries it — the question,
   * the REFERENCE answer, the learner's explanation and Ellie's reply. That is what makes an
   * explanation given there attributable to the node the learner clicked, rather than only the
   * first message of it.
   */
  #objectiveByAnchor = new Map<string, string>();
  /** The objective a `teach_objective` turn is about, for the length of that turn. */
  #teachTarget: {
    title: string;
    statement: string;
    criteria: string[];
    assumedByDeck: boolean;
    requiring: string | null;
  } | null = null;
  #pendingQuiz: PendingQuiz | null = null;
  #testerMode: TesterMode = 'proactive';
  /** Every REFERENCE card inserted this session, and whether it has been explained back. */
  /**
   * The REFERENCE cards of `pivot-spec.md` §B1. **Nothing pushes to this since #41** — the Teacher
   * answers the entry question — so it is always empty and `#referenceLocked()` is always false.
   * The field and the lock helpers stay for one release so a stored flow state still parses and
   * the rule that reads them keeps its test.
   */
  #answers: ReferenceAnswerState[] = [];
  /**
   * **Where each thread is in the document** (issue #41): the scope and the passage the Teacher is
   * answering that thread from, resolved once per question by `flowroom.referenceContext()`. In
   * memory only — a reopened deck re-resolves on the next question, and a thread with no entry
   * here simply gets no *where* line.
   */
  #askContext = new Map<string, ReferenceContext>();
  /**
   * **The pitch this learner has asked for on this file** (issue #41, `pitch.ts`). Persisted with
   * the flow state, so "simpler" said once is still true after a quit, and cleared by
   * `objectives:reset` along with everything else the app has claimed to know about them.
   */
  #pitch: PitchState = DEFAULT_PITCH;
  /**
   * Threads the Teacher has already offered to summarise (issue #41). At most once per thread:
   * an offer the learner did not take is an answer, and repeating it is the app arguing.
   */
  #offeredSummary = new Set<string>();
  #summaries = 0;
  /** The segment the learner last acted in. Where an unanchored fill (a nudge) goes. */
  #lastAnchorId: string | null = null;
  /** The anchor the turn currently being generated belongs to. Turns are serialised by the mailbox. */
  #turnAnchorId: string | null = null;
  /**
   * **What the last agent turn in the thread was** (#37) — the input that tells a silence after
   * an explanation apart from a silence after a question. Classified by the **move**, not the
   * speaker: a Teacher content-free nudge is a Teacher message and must not itself count as an
   * explanation to try again, or a second silence would re-explain the nudge.
   */
  #lastAgentTurn: LastAgentTurn = 'none';
  /** The turn whose `turn.received` is still on screen, so exactly one `turn.released` closes it. */
  #received: string | null = null;
  /** Settings ▸ Reply speed. Read per turn, so a change applies to the next turn, never this one. */
  #replySpeed: ReplySpeed;
  /** anchorId → the highest `seq` the learner has seen there (audit §7). */
  #seen = new Map<string, number>();
  /** anchorId → the card's renderer state, which must survive a reopen (audit §7). */
  #cards = new Map<string, { collapsed?: boolean; removed?: boolean }>();
  /**
   * **The whisper's ephemerality, and the whole of it** (`flow-build-plan.md` §3.5,
   * `design-brief.md` §D5 "clears at the end of the round", Dennis et al.).
   *
   * In the chat a whisper cleared at the end of a *round*. A flow has no rounds, so the unit is
   * the **segment sitting**: the key is `${flow session id}|${anchorId}`, and a key that is not
   * in this map mints a **fresh thread id**. Three consequences, all of them the point:
   *
   *  - ⌘K on a *different* card is a different sitting, and opens an empty thread;
   *  - a sitting that closed while the app was shut (`flow.tickSession`'s 20-minute gap) takes
   *    its private threads with it, because the new sitting has a new id;
   *  - **this map is in memory and is deliberately not in `flowSnapshot()`**, so quitting the
   *    app or closing the document ends every private thread. The rows stay in `whispers` for
   *    the research export, unreachable from any thread the popover can ask for — which is the
   *    same "never deleted, never rendered" shape the chat's `whisper.cleared` already had.
   */
  #segmentWhispers = new Map<string, string>();
  /** The segment whose popover is open, or null. Read by the hand-off rule, never by a prompt. */
  #whisperAnchor: string | null = null;
  /**
   * Turns that failed and are still on screen, newest last. Replayable: each carries the trigger
   * and the anchor it needs, so `retryTurn()` runs the *same* turn rather than inventing one.
   */
  #failures: FailureRecord[] = [];
  /**
   * **A failed turn does not get nudged at.** Set the moment a turn fails and cleared only by
   * the learner doing something; while it is set `#armTimer()` leaves the window closed, so the
   * room cannot follow "nothing happened" with "you have been quiet for 45 s" — which is exactly
   * what room_6a9609d5c6fb did, twice.
   */
  #nudgesHeldForFailure = false;
  /** Same shape as the failure hold, different cause: the learner stopped the turn themselves. */
  #nudgesHeldForStop = false;
  /**
   * **The debug drawer's ring** (audit §10).
   *
   * `latency_target_ms`, `ttft_actual_ms`, usage and cost are all persisted and none of them are
   * visible while running, so diagnosing "hung or thinking?" meant opening SQLite. This is the
   * same numbers, in memory, for the open room — last 50 turns, newest last. **No bodies**: the
   * same rule the log sink enforces by key name, enforced here by only ever writing scalars.
   */
  #traces: TurnTraceView[] = [];
  /**
   * Where the stage-1 pool is up to. A pool sampled independently each time repeats — the
   * learner on 2026-09-16 got the same "Take your time…" line twice in a row — so it is a
   * rotation with a random *start*, not a random *draw*.
   */
  #nudgeCursor = -1;

  // ── the collaborative notes doc (#48) ──────────────────────────────────

  /**
   * **The actor's only view of the document** (`docport.ts`). `NO_DOC` for a room with no notes
   * doc, where every read is empty and every write is dropped — so nothing downstream needs a null
   * check and a room opened before the ingest ran simply never edits.
   */
  #docPort: DocPort;
  /**
   * **The three channels** (brief §4.1), as a thread registry keyed by `messages.anchor_id`.
   *
   * There is no second thread identifier, which is the whole of architect §A.4: a thread id IS an
   * anchor id. `'doc'` is the doc chat, `span_<12 hex>` is a Ctrl+E thread, and a private thread's
   * key is its whisper thread id. What this map holds is the little that an anchor id cannot say
   * for itself — the block a span hangs off, the quote it was opened on, when it was created.
   */
  #threads = new Map<string, { kind: ThreadKind; blockId: string | null; quote: string | null; agentKey: AgentAuthor | null; createdAt: string }>();
  /**
   * **A private thread per agent** (brief §4.1: *"one with Ellie, one with Max"*).
   *
   * This is the deliberate widening of #32, which resolved Ellie in code specifically so the
   * renderer could not ask for a private channel to the Tester. The brief asks for exactly that
   * channel, so the argument #32 made — *"a private channel to the person quizzing you is the one
   * shape this feature must not have"* — is overruled by name in `collab-doc.md` §4.1, and the
   * protection it was really buying is kept in full elsewhere: a private thread **never edits the
   * doc**, never reaches the group context, and never touches the ledger or the open question.
   * `context.test.ts`'s canary is widened to cover both threads rather than relaxed.
   *
   * Keyed by agent and by sitting, exactly as `#segmentWhispers` is, so a private thread dies with
   * its flow session and with the app.
   */
  #privateThreads = new Map<string, string>();
  /**
   * **Every question that has resolved on this file**, newest last, for `pitch.pitchInputs`
   * (brief §4.5) and for the outcome rows the progress bar is a pure function of (§6).
   *
   * In memory and per-actor, which is the same scope `#taught` has: the durable copy is written
   * through `docPort.recordOutcome`, and this is the reading copy so a pitch does not need a
   * round trip to main in the middle of a turn.
   */
  #outcomes: QuizOutcome[] = [];
  /** The mention parsed off the learner's row this turn, carried to the decision. Never stored. */
  #lastMention: AgentAuthor | null = null;
  /**
   * **The question with the marker taken off**, for the prompt only.
   *
   * The row keeps `@Max what is a heuristic?` verbatim — the transcript is the learner's, not the
   * app's, and the renderer highlights the mention from the same parse. What the model is asked to
   * answer is `what is a heuristic?`, because an answer that opens by acknowledging being
   * addressed is a turn spent on the app rather than on the question.
   */
  #mentionRest: string | null = null;
  /** What Ellie's structured cue reported about itself, for the turn that records it (§4.7). */
  #pendingCue: { hasMistake: boolean; claim: string | null } | null = null;
  /** Her cue's text, so Max's prompt can answer *it* rather than the question (§4.3 step 2). */
  #cueText: string | null = null;
  /** The objective a `lesson_start` turn is about, for the length of that turn (§6). */
  #lessonTarget: { title: string; statement: string; criteria: string[]; pages: number[] } | null = null;
  /** The learner's own doc text being assessed, for the length of that turn (§6). */
  #docTextTarget: { blockId: string; text: string; anchorId: string } | null = null;
  /** Questions asked, so a `questionId` is minted once and shared by the Q block and the outcomes. */
  #nextQuestionId: string | null = null;
  /** Which door the release in flight came through, read by `#noteTurnForFlow` when it lands. */
  #releaseBy: 'give_up' | 'pass' | 'closure' | null = null;
  /** Cancels the closure tick. Null while the actor is stopped. */
  #stopClosureTick: (() => void) | null = null;
  /**
   * **Every question Max has asked on this file**, verbatim (interview finding, `findings.md` §6:
   * quiz quality decays through a long session and the questions start to circle). Handed to the
   * question prompt so a rephrasing of one already asked is ruled out by name rather than hoped
   * against. Capped, because the point is a list he can read, not a transcript.
   */
  #questionsAsked: string[] = [];

  #log: TurnLog;
  /** The current turn's logger, so helpers off the main path (`#failTurn`) share its id. */
  #turnLog: TurnLog;

  constructor(deps: RoomActorDeps) {
    this.#d = deps;
    this.#log = deps.log ?? SILENT_LOG;
    this.#turnLog = this.#log;
    this.#openedAt = deps.clock.now();
    this.#flow = deps.flowState?.session ?? null;
    this.#taught = [...(deps.flowState?.taught ?? [])];
    this.#pendingQuiz = deps.flowState?.pendingQuiz ?? null;
    /**
     * **Deliberately not restored** (issue #41). A stored `answers` array would re-lock a thread
     * behind a REFERENCE card that no longer exists — migration 017 turned those rows into summary
     * cards — and there is no *Explain it back* left to lift the lock with.
     */
    this.#answers = [];
    this.#replySpeed = deps.replySpeed ?? 'default';
    this.#seen = new Map(Object.entries(deps.flowState?.seen ?? {}));
    this.#cards = new Map(Object.entries(deps.flowState?.cards ?? {}));
    this.#objectiveByAnchor = new Map(Object.entries(deps.flowState?.objectives ?? {}));
    this.#pitch = deps.flowState?.pitch ?? DEFAULT_PITCH;
    this.#offeredSummary = new Set(deps.flowState?.offeredSummary ?? []);
    this.#docPort = deps.docPort ?? NO_DOC;
    const room = this.#room();
    // The room's own constants until the first turn says how much there was to read.
    this.#stages = { stageOneMs: deps.config.silence_ms, stageTwoMs: deps.config.stage_two_ms };
    this.#timer = new SilenceTimer({
      clock: deps.clock,
      config: deps.config,
      initial: {
        deadlineTs: room.deadline_ts ? Date.parse(room.deadline_ts) : null,
        epoch: room.timer_epoch,
        cumulativeIdleMs: room.cumulative_idle_ms,
        windowExtensionMs: room.window_extension_ms,
        firesThisRound: room.nudge_fires_this_round,
        nudgesPaused: room.nudges_paused === 1,
        windowStartTs: room.last_activity_ts ? Date.parse(room.last_activity_ts) : null,
      },
      hooks: {
        persist: (patch) => this.#d.store.rooms.update(this.#d.roomId, patch),
        changed: () => this.#emitTimer(),
        fire: (fire) => {
          if (!this.#timer.isCurrentEpoch(fire.epoch)) return; // stale-epoch guard
          this.#event('system', 'silence.timer.fired', {
            stage: fire.stage,
            late_by_ms: fire.lateByMs,
            cause: fire.cause,
          });
          this.#log.event('info', 'timer.fired', {
            stage: fire.stage,
            late_by_ms: fire.lateByMs,
            cause: fire.cause,
            epoch: fire.epoch,
          });
          if (fire.lateByMs > 2_000) {
            this.#event('system', 'timer.fired_late', { late_by_ms: fire.lateByMs, cause: fire.cause });
          }
          void this.#runSilenceFill(fire.stage);
        },
        resumeCard: (lateByMs) => {
          this.#event('system', 'timer.fired_late', { late_by_ms: lateByMs, cause: 'resume_card' });
          this.#notice('info', 'Welcome back — pick up where you left off?');
        },
      },
    });
    this.#loadChallenged();
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  start(): void {
    this.#timer.start();
    /**
     * **The closure tick** (#48, `collab-doc.md` §4.7: *"If a question is still open when the flow
     * session goes idle (the existing inactivity gap)… Max releases the answer"*).
     *
     * It is a clock of its own rather than a hook on the silence timer, because the two measure
     * different things: the silence timer is reading time (2 minutes of quiet after a turn), and
     * this is the **flow session's 20-minute gap** — the learner has left. Thirty seconds of
     * granularity on a twenty-minute deadline is generous and costs one comparison.
     *
     * `tickSession` is wall-clock against an absolute deadline (`flow.ts`: *"the row is the
     * timer"*), so this survives sleep and a relaunch exactly as the silence timer does: a gap
     * that elapsed while the app was shut closes on the first tick after it comes back.
     */
    this.#stopClosureTick = this.#d.clock.setInterval(() => this.#tickClosure(), CLOSURE_TICK_MS);
  }

  stop(): void {
    this.#timer.stop();
    this.#stopClosureTick?.();
    this.#stopClosureTick = null;
  }

  /**
   * One comparison a tick: has the sitting gone idle with a question still open? If it has, the
   * debt is paid — and it is paid **once**, because `closeOpenQuestion` closes the question, after
   * which `quizOpen` is false and this does nothing until the next question is asked.
   */
  #tickClosure(): void {
    const session = this.#flow;
    if (session === null || !quizOpen(this.#pendingQuiz)) return;
    const ticked = tickSession(session, this.#d.clock.now());
    if (ticked.closedAt === null) return;
    this.#flow = ticked;
    void this.closeOpenQuestion('closure').catch((err) => {
      this.#log.event('error', 'quiz.closure.error', { cause: failureReason(err) });
    });
  }

  /** Launch / resume recovery: idempotent, fenced by timerEpoch (architecture-mac.md §B.4). */
  recover(): void {
    const room = this.#room();
    if (room.pending_turn_id && room.pending_turn_due_ts) {
      const overdueBy = this.#d.clock.now() - Date.parse(room.pending_turn_due_ts);
      if (overdueBy > 25_000) {
        // Never replay a lost in-flight turn blind: a duplicated agent message is a worse
        // corruption of the transcript than a missing one.
        this.#event('system', 'agent.turn.error', { stage: 'recovery', cause: 'lost_in_flight' });
        this.#d.store.rooms.update(this.#d.roomId, { pending_turn_id: null, pending_turn_due_ts: null, state: 'open' });
      }
    }
    this.#timer.recover();
  }

  /** Open the round: the round card, the Peer's opener, then the floor is the learner's. */
  async open(): Promise<void> {
    const existing = this.#d.store.messages.forRoom(this.#d.roomId);
    if (existing.length > 0) return;
    this.#event('system', 'session.start', { concept_id: this.#d.pack.concept_id });
    await this.#runAgentTurn('open');
  }

  // ── inbound from the renderer ─────────────────────────────────────────────

  /**
   * A learner turn. `anchorId` is the segment its thread hangs off — the flow always passes one,
   * and `null` is the room-level composer the chat shipped with, which is the same call it has
   * always been. Everything downstream (the cancel, the timer, the ledger, the 8 s floor-yield)
   * is unchanged: an anchored turn is an ordinary turn that knows where it is.
   */
  async sendMessage(
    text: string,
    anchorId: string | null = null,
    /**
     * Where in the document this turn was written, resolved by `flowroom.referenceContext()`
     * (issue #41). It used to be the REFERENCE call's private input; now that the Teacher answers
     * the thread it is hers, and it is what lets her say *this page* rather than guess from a
     * 58-page prefix. Optional: the pre-flow room-level composer has no segment.
     */
    context?: ReferenceContext,
    /**
     * **Where this turn came from** (#47). `askHere` sets `ask`, and that is the whole of the
     * explain path's exemption from the answer lock: an Ask is a request for the Teacher, so it is
     * neither an attempt nor a request for Max's answer, however its words happen to read (§6,
     * beat 11; the bug the scripted take pinned on 2026-09-19).
     */
    origin: 'composer' | 'ask' = 'composer',
  ): Promise<void> {
    const body = text.trim();
    if (body.length === 0) return;
    if (anchorId !== null && context) this.#askContext.set(anchorId, context);
    /**
     * **`@Ellie` / `@Max`, parsed on the learner's own row** (#48, brief §4.2 rows 2–3).
     *
     * Parsed here, in code, and read by `ruleDecision` — for the same reason
     * `classifyLearnerTurn` is: who answers is a rule, and a model asked to notice a mention is a
     * model that will sometimes not. Two halves that are easy to get backwards:
     *
     *  - **the row is stored verbatim.** The learner wrote `@Max`, the transcript says `@Max`, and
     *    the renderer highlights it with the same function. Stripping it from the record would be
     *    the app editing what they said;
     *  - **the model is shown `rest`** — the question without the marker — so the answer is not
     *    about being addressed. That happens in `#askNote`, at prompt-assembly time.
     */
    // An Ask has already named its answerer (`origin: 'ask'` is Ellie's door), so a mention inside
    // one would be a second answer to a settled question.
    const mention = origin === 'ask' ? null : parseMention(body);
    this.#lastMention = mention?.agent ?? null;
    this.#mentionRest = mention === null ? null : mention.rest;
    this.#registerThread(anchorId, anchorId?.startsWith(SPAN_THREAD_PREFIX) ? 'span' : 'doc');

    /**
     * The id of the row the learner just wrote, carried out of the mailbox so `turn.received`
     * can name it. The renderer keys its optimistic block on it: a pending block and a received
     * state that cannot be matched to each other are two acknowledgements of one message.
     */
    let studentMessageId: string | null = null;
    await this.#mailbox.enqueue(() => {
      // A held reply is cancelled, not queued. The floor belongs to the learner.
      if (this.#pending) {
        this.#pending.cancelled = true;
        this.#clearThinking();
      }
      this.#timer.cancel();
      this.#studentTurns += 1;
      /**
       * The composer is empty again, so the learner is no longer mid-sentence.
       *
       * This matters beyond the typing indicator: `flow.handOffDue`'s R4 refuses to quiz within
       * `composerIdleMs` of a keystroke, and a message is *always* sent within milliseconds of
       * the last one. Without this line the hand-off could never fire on the turn that satisfies
       * R1 — it would be blocked by the very keystrokes that produced the turn — and beat 10
       * would be unreachable on camera (flow-session.md §8.2 R4: "never quiz mid-sentence"; a
       * sent message is the end of the sentence).
       */
      this.#typingUntil = 0;
      /**
       * **"Simpler" is data, not a mood** (#41). Every learner turn is read for a pitch signal
       * before anything is decided, so the correction the learner makes on turn 2 is in the
       * prompt on turn 3 — and on every turn after that, on this file. `notePitch` returns the
       * same object when nothing fired, so an ordinary turn costs a regex sweep and no write.
       */
      const pitched = notePitch(this.#pitch, body, this.#d.clock.now());
      if (pitched !== this.#pitch) {
        this.#pitch = pitched;
        this.#event('student', 'flow.pitch', { level: pitched.level, signal: pitched.signals[0] ?? null });
      }
      this.#noteLearnerActivity('turn', anchorId);
      const row = this.#insertMessage({
        participantId: this.#studentParticipant().id,
        body,
        anchorId,
      });
      /**
       * **What this turn is, while Max's question is open** (issue #47, `attempt-first.md` §2.2).
       *
       * Classified here, on the row the learner just wrote, and read by the rules in
       * `orchestrator.ruleDecision` — so the decision to withhold or give the answer is made from
       * the learner's own words and never from a model's reading of them.
       *
       * Only an **attempt** puts the room in feedback debt. An answer request, a clarification or
       * an "ok" leaves the count where it is, which is what makes the lock about having tried.
       */
      /**
       * **Max's question lives in one thread, and only that thread answers it** (#48, brief §4.2:
       * *"Ellie's answer to a new learner question simply stands, and Max's open question stays
       * open"*). The collab doc has several threads at once — the doc chat and every Ctrl+E span
       * thread — so a learner who highlights another paragraph and asks about it while Max waits
       * is asking Ellie, exactly as "+ Ask here" was. Without this, that question was classified
       * against Max's and drew `rule:quiz_clarify`, or counted as an attempt at a question it was
       * not about. Inside the question's own thread nothing changes: a clarification there is
       * still Max's (row 5), and `@Ellie` is still the way to reach her from it.
       */
      // Collab-doc rooms only, like `rule:max_followup`: the old flow's scripted take answers a
      // hand-off question from a neighbouring card, and keeps working until that UI is removed.
      if (
        origin !== 'ask' &&
        this.#docPort.docId() !== null &&
        this.#pendingQuiz !== null &&
        quizOpen(this.#pendingQuiz) &&
        (this.#anchorOfQuiz(this.#pendingQuiz) ?? null) !== (anchorId ?? null)
      ) {
        origin = 'ask';
      }
      this.#lastLearnerTurn = origin === 'ask' ? null : classifyLearnerTurn(body);
      /**
       * **An Ask never touches the open question.** Not the attempt count, not the answer lock, not
       * the feedback debt: it is a question for Ellie, and counting it would unlock the answer to
       * Max's question on the strength of the learner asking something else.
       */
      if (this.#pendingQuiz && origin !== 'ask') {
        this.#pendingQuiz = answerQuiz(this.#pendingQuiz, row.id, {
          attempt: this.#lastLearnerTurn === 'attempt',
        });
      }
      studentMessageId = row.id;
      this.#event('student', 'message.send', { seq: row.seq, chars: body.length, anchor_id: anchorId });
      this.#d.store.rooms.update(this.#d.roomId, { consecutive_agent_turns: 0, expects_reply: 1 });
    });

    await this.#runAgentTurn('student_message', {
      studentBody: body,
      anchorId,
      studentMessageId,
      askedHere: origin === 'ask',
    });
  }

  /**
   * "Show the room" (issue #22 decision 4): the learner brings a document over.
   *
   * It is a **learner message**, not a system event. That decides three things that would
   * otherwise each need arguing:
   *   - it cancels a held agent reply and resets the silence timer, because the floor belongs
   *     to the learner and they have just used it (product-design.md §C3 L731);
   *   - it opens the 8 s floor-yield window, so no agent acknowledges it instantly (§C3 L719);
   *   - the ledger can only ever quote the short line they see on screen. The page text lives on
   *     the reference row, not in `body`, so document text can never become "evidence the
   *     learner explained it" — which is the whole point of the ledger's verbatim rule.
   */
  async showDocument(input: {
    fileId: string | null;
    fileName: string;
    relPath: string;
    kind: string;
    pageFrom: number | null;
    pageTo: number | null;
    selection: string | null;
    pageText: string;
  }): Promise<void> {
    const where =
      input.pageFrom !== null && input.pageTo !== null
        ? input.pageFrom === input.pageTo
          ? `p. ${input.pageFrom}`
          : `pp. ${input.pageFrom}\u2013${input.pageTo}`
        : null;
    const body = where
      ? `Look at this \u2014 ${input.fileName}, ${where}.`
      : `Look at this \u2014 ${input.fileName}.`;

    await this.#mailbox.enqueue(() => {
      if (this.#pending) {
        this.#pending.cancelled = true;
        this.#clearThinking();
      }
      this.#timer.cancel();
      this.#studentTurns += 1;
      const row = this.#insertMessage({
        participantId: this.#studentParticipant().id,
        body,
        // Written by #insertMessage between the message row and the emitted view: the row it
        // points at has to exist first (the foreign key), and the view has to carry the card on
        // its first emission or the transcript flashes a bare line and grows one a tick later.
        reference: {
          file_id: input.fileId,
          file_name: input.fileName,
          rel_path: input.relPath,
          kind: input.kind,
          page_from: input.pageFrom,
          page_to: input.pageTo,
          selection: input.selection,
          page_text: input.pageText,
        },
      });
      this.#event('student', 'message.send', { seq: row.seq, chars: body.length, reference: true });
      this.#d.store.rooms.update(this.#d.roomId, { consecutive_agent_turns: 0, expects_reply: 1 });
    });

    // Bringing a document over is not an answer to Max's question, and it is emphatically not a
    // request for one (#47 §2.2): classify it rather than leave the last typed turn standing.
    this.#lastLearnerTurn = classifyLearnerTurn(body);
    await this.#runAgentTurn('student_message', { studentBody: body });
  }

  typing(): void {
    this.#typingUntil = this.#d.clock.now() + 3_500;
    this.#timer.typing();
    // Keystrokes pause the flow session's gap clock too, or a learner writing a long answer for
    // twenty-five minutes would be treated as having left (flow-session.md §8.1).
    if (this.#flow) this.#noteLearnerActivity('keystroke');
  }

  hold(): void {
    this.#timer.hold();
    this.#event('student', 'silence.timer.set', { reason: 'hold' });
  }

  pauseNudges(paused: boolean): void {
    this.#timer.setNudgesPaused(paused);
    this.#event('student', paused ? 'silence.timer.cancelled' : 'silence.timer.set', { reason: 'wait_for_me' });
  }

  // ── "+ Ask here" — the Teacher answers it (issue #41) ─────────────────────

  /**
   * **The learner asks on a segment, and the Teacher answers.**
   *
   * Until #41 this inserted a neutral REFERENCE card and locked Ellie and Max out of the thread
   * until *Explain it back*. `pivot-spec.md` §B1 argued that from the Peer contract — *"Ellie may
   * never supply a complete correct explanation"* — and #32 removed that contract, #36 replaced it
   * with ANSWER FIRST, THEN TEACH. The routing outlived its argument, and all three of Lucas's
   * #41 transcripts paid for it: on the MDP title slide the passage-faithful answer was *"the
   * passage contains no further content on the topic"*, and it took two more prompts to reach
   * Ellie, who was right on her first turn. Three prompts to satisfaction, two of them spent on
   * the card.
   *
   * So this is now an ordinary learner turn with an ordinary Teacher answer:
   * `rule:teacher_answers` → `answer_then_teach`, the 3–8 s yield, the latency floor, the
   * ledger inside the delay window, the flow session, the hand-off. What it keeps from the old
   * path is the **scope** (issue #35): `context` says whether she was shown this page or the whole
   * deck, `scopeShown` goes on her reply's row, and `#askContext` remembers it for the rest of the
   * thread so a follow-up is answered on the same slide.
   *
   * What is gone: the card, the 120-word cap, the per-anchor lock, and `explainBack`.
   */
  async askHere(input: {
    anchorId: string | null;
    question: string;
    /** What the Teacher is shown: this page, or the whole document (issue #35). */
    context: ReferenceContext;
    /**
     * The objective this Ask was opened from (issue #38 §5). Tags the whole thread, not just
     * this question — see `#objectiveByAnchor`.
     */
    objectiveId?: string | null;
  }): Promise<{ questionId: string; scopeShown: string }> {
    const question = input.question.trim();
    if (question.length === 0) throw new Error('An "Ask here" needs a question');
    if (input.anchorId !== null && input.objectiveId) {
      this.#objectiveByAnchor.set(input.anchorId, input.objectiveId);
    }
    if (input.anchorId !== null) this.#askContext.set(input.anchorId, input.context);

    this.#event('student', 'flow.ask', {
      anchor_id: input.anchorId,
      ask_scope: input.context.scope,
      scope_shown: input.context.scopeShown,
      // The one line that says this is no longer the REFERENCE path.
      answered_by: 'teacher',
    });

    /**
     * Straight through `sendMessage`, which is the point: an Ask is a learner turn now, so it has
     * to be *the same* learner turn — the cancel, the typing reset, the quiz bookkeeping, the
     * `turn.received` acknowledgement and the ledger all come from one implementation rather than
     * from a second one that drifts.
     */
    const before = this.#d.store.messages.maxSeq(this.#d.roomId);
    // `'ask'`: the same learner turn in every respect except the one that matters mid-question —
    // it is the Teacher's, and it is not an attempt at Max's question (#47 §6, beat 11).
    await this.sendMessage(question, input.anchorId, undefined, 'ask');
    const asked = this.#d.store.messages
      .forRoom(this.#d.roomId)
      .find((m) => m.seq === before + 1);

    return { questionId: asked?.id ?? '', scopeShown: input.context.scopeShown };
  }

  // ── "+ Try this" and "Show the answer" — the attempt loop (issue #47) ─────

  /**
   * **"+ Try this"** on a segment (`attempt-first.md` §2.1): the learner asks Max for one question.
   *
   * This is the **hero interaction** of the A1 prototype, and the reason it exists is that the
   * alternative does not work: in five of the six studied sessions the learner never produced an
   * attempt, the AI never asked for one, and *every* offer to quiz was declined — 0 of 10 in R2, 0
   * of 3 in R5 (`findings.md` §3.0, RQ3). A declinable offer after a rate rule is what learners
   * decline, so the Tester becomes **askable and default** and the time-based hand-off
   * (`rule:handoff`, unchanged) becomes the secondary door onto the same `pendingQuiz`.
   *
   * What it does, in order: tag the thread with the objective, remember the page (so Max can quote
   * it — `whereBlock` is now in his note too), open the sitting, and run one Tester turn whose
   * decision is written here rather than by a model. `#noteTurnForFlow` opens the quiz off that
   * turn's `moveType: 'quiz'`, which is what arms the answer lock.
   */
  async tryHere(input: {
    anchorId: string;
    objectiveId: string;
    /** The page the question is asked on, resolved by `flowroom.referenceContext()` like an Ask. */
    context?: ReferenceContext;
  }): Promise<{ anchorId: string; objectiveId: string }> {
    this.#objectiveByAnchor.set(input.anchorId, input.objectiveId);
    if (input.context) this.#askContext.set(input.anchorId, input.context);
    this.#noteLearnerActivity('ask', input.anchorId);
    this.#event('student', 'flow.try', {
      anchor_id: input.anchorId,
      objective_id: input.objectiveId,
      // Which door this question came through, so the log can separate the two (§2.4).
      door: 'try_here',
      question_number: this.#testerQuestions + 1,
    });
    await this.#runAgentTurn('promote', {
      anchorId: input.anchorId,
      tryHere: { objectiveId: input.objectiveId },
    });
    return { anchorId: input.anchorId, objectiveId: input.objectiveId };
  }

  /**
   * **"Show the answer"** (§2.4), which is only ever visible after one attempt.
   *
   * The refusal is the product decision, so it lives here and not in the renderer — the same
   * argument `stopTurn` makes about its own. Before the first attempt the composer shows a quiet
   * line instead of the control, and if an older renderer calls anyway it is told why rather than
   * answered.
   */
  async showAnswer(anchorId: string): Promise<{ shown: boolean; refused: string | null }> {
    const result = await this.pass(anchorId);
    return { shown: result.released, refused: result.refused };
  }

  /**
   * **Pass** (#48, `collab-doc.md` §4.4: *"There is also a **Pass** control on the open
   * question"*), and the whole of what changed from "Show the answer".
   *
   * The attempt precondition is **gone**. #47 refused the button before one try and said so in the
   * composer; the brief retires that knowingly (§1): *"a learner must never see a question they
   * never get the answer to, and a refused answer teaches less than a lowered question."* So the
   * only refusal left is the one that is about the world rather than about the learner — there is
   * no open question here to pass on.
   *
   * `showAnswer()` stays as its old name because `IPC.flowShowAnswer` is frozen for this build.
   */
  async pass(anchorId: string): Promise<{ released: boolean; refused: string | null }> {
    const quiz = this.#pendingQuiz;
    if (quiz === null || !quizOpen(quiz) || this.#anchorOfQuiz(quiz) !== anchorId) {
      return { released: false, refused: 'There is no open question here.' };
    }
    this.#noteLearnerActivity('ask', anchorId);
    this.#releaseBy = 'pass';
    this.#event('student', 'quiz.pass', { anchor_id: anchorId, attempts: attemptsOf(quiz) });
    await this.#runAgentTurn('promote', { anchorId, showAnswer: true });
    return { released: true, refused: null };
  }

  /**
   * **`rule:closure` — no question Max asked is left without its answer** (brief §4.7).
   *
   * Two callers, and the difference between them is the whole of architect §E3. The **inactivity
   * gap** calls it from inside a turn, where there is time for a real model answer. The **file
   * close** (and `before-quit`) calls it from a path that must never block: closing a file
   * unmounts the renderer and may dispose the actor before a 9–12 s Tester turn could land.
   *
   * So a close that cannot get an answer quickly does not wait for one. The question is still
   * resolved — in the doc, as *released*, from the objective's own criteria — because a Q block
   * left open forever is the debt §4.7 exists to pay. Silence would be the one outcome the brief
   * rules out.
   */
  async closeOpenQuestion(reason: 'closure' = 'closure'): Promise<void> {
    const quiz = this.#pendingQuiz;
    if (!quizOpen(quiz) || quiz === null) return;
    const anchorId = this.#anchorOfQuiz(quiz) ?? quiz.anchorId ?? this.#lastAnchorId;
    this.#releaseBy = reason;
    this.#event('challenger', 'quiz.closure', {
      element_id: quiz.elementId,
      anchor_id: anchorId,
      attempts: attemptsOf(quiz),
      cue_had_mistake: quiz.cueHasMistake === true,
    });
    try {
      await this.#runAgentTurn('promote', { anchorId, closure: { elementId: quiz.elementId } });
    } catch (err) {
      this.#turnLog.event('error', 'quiz.closure.error', { cause: failureReason(err) });
    }
    /**
     * **And it closes whether or not the turn landed.** `#runAgentTurn` swallows a generation
     * failure into a card rather than throwing — which is right for a conversation and wrong for a
     * debt — so the state is checked here rather than in a `catch`. If the question is still open,
     * the model could not be had, and §4.7's fallback resolves it from the objective's criteria.
     */
    if (quizOpen(this.#pendingQuiz)) this.#resolveFromCriteria(this.#pendingQuiz!);
  }

  /**
   * The fallback half of §4.7: no model answer could be had in time, so the Q block is resolved
   * from the objective's own criteria — which is what the ingest already wrote as *what a correct
   * demonstration contains*. It is a worse answer than Max's and it is infinitely better than an
   * open question the learner never gets back to.
   */
  #resolveFromCriteria(quiz: PendingQuiz): void {
    if (!quizOpen(quiz)) return;
    this.#pendingQuiz = markAnswerShown(quiz, 'closure');
    this.#recordOutcome({ kind: 'released', verdict: null, releasedBy: 'closure', messageId: null, source: 'chat' });
    const element = this.#d.pack.elements.find((e) => e.id === quiz.elementId);
    /**
     * *"What a correct demonstration contains"*, which the objective ingest writes as
     * `demonstration` — and, for a pack that has none (a fixture, or `draftConcept`), the ledger's
     * own level-3 and level-4 descriptions of the same claim. Both are the objective's criteria in
     * the sense §4.7 means; taking the second is the difference between a thin answer and none.
     */
    const criteria = (
      (element?.demonstration ?? []).length > 0
        ? element!.demonstration!
        : [element?.criteria['3'], element?.criteria['4']].filter((c): c is string => typeof c === 'string')
    ).filter((c) => c.trim().length > 0);
    if (criteria.length === 0) return;
    const text = [`The answer needed to cover:`, ...criteria.map((c) => `- ${c}`)].join('\n');
    void this.#emitDocEdit(
      buildResolveEdit(this.#docEditDeps(quiz.anchorId ?? null, null), {
        questionId: quiz.questionId ?? quiz.quizMessageId,
        resolution: 'released',
        text,
      }),
      { objectiveId: quiz.objectiveId ?? null, messageId: null, turnId: null },
    );
  }

  /**
   * **The open question, and which thread it is in** (§2.4), for `flowRoomView` to project onto
   * `FlowThreadView.quiz`.
   *
   * The anchor is read off the Tester's own message row rather than stored on `PendingQuiz`: the
   * row is where a message's thread lives, and a second copy of it is a second thing that can
   * disagree. `null` when nothing is open — including once the answer has been shown, which is
   * exactly when the renderer should stop offering to show it.
   */
  pendingQuizView(): { anchorId: string; quiz: FlowQuizView } | null {
    const quiz = this.#pendingQuiz;
    if (quiz === null) return null;
    const anchorId = this.#anchorOfQuiz(quiz);
    if (anchorId === null) return null;
    return {
      anchorId,
      quiz: {
        quizMessageId: quiz.quizMessageId,
        elementId: quiz.elementId,
        attempts: attemptsOf(quiz),
        feedbackGiven: quiz.feedbackGiven === true,
        answerShown: quiz.answerShown === true,
        verdict: verdictOf(quiz),
      },
    };
  }

  #anchorOfQuiz(quiz: PendingQuiz): string | null {
    return this.#d.store.messages.get(quiz.quizMessageId)?.anchor_id ?? null;
  }

  /**
   * **"Explain it back →" — a no-op since #41**, kept for one release.
   *
   * There is no REFERENCE entry card to collapse and no lock to lift: the Teacher answered the
   * question in the thread, and the thread was never closed to her. The call is logged and
   * answers `unlocked: true` so an older renderer's button does nothing visible rather than
   * throwing. Delete it, and `IPC.flowExplainBack`, in the release after.
   */
  explainBack(answerId: string): { unlocked: boolean; anchorId: string | null } {
    this.#event('student', 'reference.explain_back', {
      answer_id: answerId,
      deprecated: true,
      note: 'no-op since #41: the Teacher answers the Ask, so no thread is locked',
    });
    return { unlocked: true, anchorId: null };
  }

  // ── "Summarise into the document" — the artefact (issue #41) ──────────────

  /**
   * **One thread, summarised into the learner's document.**
   *
   * `conversation-refinement.md` §5, and Lucas's own workflow in #41: *"this should be provided as
   * a button, which will create a slide / segment that basically summarises what was taught in
   * that conversational chain"*. The card is written from the **thread** — the deck's text is not
   * in the request at all, which is the only way to stop a model summarising the easier document —
   * capped in code at 150 words, and inserted under the segment the thread hangs off.
   *
   * Called again on the same thread it **replaces** the card in place rather than appending a
   * second one: two records of one conversation, disagreeing, in the learner's own file.
   */
  async summarise(threadId: string): Promise<{
    messageId: string;
    anchorId: string;
    sourceThreadId: string;
    body: string;
    truncated: boolean;
    regenerated: boolean;
  }> {
    const all = this.#d.store.messages.forRoom(this.#d.roomId);
    const thread = all.filter((m) => m.anchor_id === threadId).sort((a, b) => a.seq - b.seq);
    if (thread.length === 0) throw new Error('There is no conversation there to summarise yet.');

    const participants = new Map(this.#d.store.participants.forRoom(this.#d.roomId).map((p) => [p.id, p]));
    const transcript = renderThread(thread, participants);
    if (transcript.trim().length === 0) throw new Error('There is no conversation there to summarise yet.');

    const material = this.#d.store.materials.get(this.#room().material_id)!;
    const context = this.#askContext.get(threadId);
    this.#summaries += 1;
    /**
     * **A summary card is not an agent turn, and it still costs one call** (#42 item B).
     *
     * `pivot-spec.md` §B1 is right that nobody took the floor for it — no `#pending`, no timer,
     * no ledger — but the learner pressed a button and a model answered, and the card is the
     * only place that fact can be shown. So it mints an id of its own in the same namespace as
     * `PendingTurn.id`, hands it to the call and writes it on the row it inserts.
     */
    const summaryTurnId = this.#d.newId('turn');
    const request = buildSummaryRequest({
      model: this.#models.orchestrator,
      roomId: this.#d.roomId,
      deckTitle: material.title,
      segmentLabel: context?.label ?? null,
      page: context?.page ?? null,
      transcript,
      anchorId: threadId,
      scriptCue: `summary:${this.#summaries}`,
    });
    // `fileId` is left to the ledger, which resolves it from `roomId` — one spelling of one fact.
    request.meta.turnId = summaryTurnId;

    let raw: string;
    let model = request.model;
    let backend: LlmBackend | null = null;
    let usage: Record<string, number> = {};
    try {
      const result = await this.#d.llm.complete(request);
      raw = result.text;
      model = result.model;
      backend = result.backend ?? null;
      usage = result.usage as unknown as Record<string, number>;
    } catch (err) {
      this.#event('system', 'agent.turn.error', { scope: 'summary', cause: (err as Error).message });
      this.#notice('error', 'That summary did not come back — try again.');
      throw err;
    }

    // The cap, in code. A prompt that asks for 150 words is a prompt that produces 260.
    const { body, truncated } = composeSummaryBody(raw);
    const existing = summaryInThread(all, threadId);

    const row = await this.#mailbox.enqueue(() => {
      if (existing) {
        this.#d.store.messages.updateBody(existing.id, body, this.#nowIso());
        const updated = this.#d.store.messages.get(existing.id)!;
        this.#d.transport.emit({
          type: 'message.appended',
          roomId: this.#d.roomId,
          message: messageView(updated, participants, this.#d.roster),
        });
        return updated;
      }
      return this.#insertMessage({
        participantId: this.#referenceParticipant().id,
        body,
        model,
        backend,
        usage: JSON.stringify(usage),
        anchorId: threadId,
        kind: 'summary',
        sourceThreadId: threadId,
        turnId: summaryTurnId,
      });
    });

    /**
     * **Not an agent turn**, and for once that claim is the same one `pivot-spec.md` §B1 made: no
     * floor, no `consecutive_agent_turns`, no timer, no ledger. The learner pressed a button on
     * their own document; nobody took the conversational floor to do it.
     */
    this.#event('system', 'flow.summarise', {
      anchor_id: threadId,
      message_id: row.id,
      thread_messages: thread.length,
      words: body.split(/\s+/).length,
      truncated,
      regenerated: existing !== undefined,
      took_floor: false,
      reset_timer: false,
    });

    return {
      messageId: row.id,
      anchorId: threadId,
      sourceThreadId: threadId,
      body,
      truncated,
      regenerated: existing !== undefined,
    };
  }

  /**
   * **The conversation behind a summary card** (issue #41): the click that expands it, and the
   * composer that continues it. Ids only — the bodies are already in `room.messages`.
   */
  threadOf(summaryId: string): { summaryId: string; threadId: string; messageIds: string[] } | null {
    const card = this.#d.store.messages.get(summaryId);
    if (!card || (card.kind ?? 'turn') !== 'summary') return null;
    const threadId = card.source_thread_id ?? card.anchor_id;
    if (threadId === null) return null;
    const messageIds = this.#d.store.messages
      .forRoom(this.#d.roomId)
      .filter((m) => m.anchor_id === threadId && m.id !== summaryId)
      .sort((a, b) => a.seq - b.seq)
      .map((m) => m.id);
    return { summaryId, threadId, messageIds };
  }

  /**
   * **The offer** (`rule:offer_summary`, R1).
   *
   * A one-line Teacher turn saying the card is available, posted at most once per thread after
   * the thread has two Teacher turns in it and the sitting has taught something. Written by
   * `summary.ts` rather than generated, the same treatment the hand-off line gets and for the
   * same reason (`flow-build-plan.md` §4.2: "a rule I can see and turn down"), and it **inserts
   * nothing** — the button on it does, if the learner presses it.
   */
  #maybeOfferSummary(anchorId: string | null): void {
    /**
     * **Retired where the collab doc exists** (#48, `collab-doc.md` §9: the doc *is* the
     * artefact now). The offer's whole argument was that a conversation deserves a durable
     * record in the learner's document — and §5 gives it one without asking, written at the
     * segment it belongs to. A button offering to summarise into a document that is already
     * writing itself is the app arguing with its own feature.
     *
     * Gated rather than deleted, because the old flow keeps working until the lead removes it in
     * one commit (COLLAB-CONTRACT rule 3), and `summary.ts` is still what it runs on.
     */
    if (this.#docPort.docId() !== null) return;
    if (anchorId === null || this.#offeredSummary.has(anchorId)) return;
    const teacher = agentByRole(this.#d.roster, 'peer');
    const participant = this.#d.store.participants.byAgentKey(this.#d.roomId, teacher.key);
    if (!participant) return;
    const thread = this.#d.store.messages
      .forRoom(this.#d.roomId)
      .filter((m) => m.anchor_id === anchorId)
      .sort((a, b) => a.seq - b.seq);
    const offer = shouldOfferSummary({
      thread,
      teacherParticipantId: participant.id,
      taughtSomething: this.#taught.length > 0,
      alreadyOffered: false,
    });
    if (!offer) return;
    this.#offeredSummary.add(anchorId);
    this.#insertMessage({
      participantId: participant.id,
      body: SUMMARY_OFFER_LINE,
      model: 'rule:offer_summary',
      anchorId,
    });
    this.#event('peer', 'agent.turn.dispatched', { move: 'offer_summary', decided_by: 'rule:offer_summary' });
  }

  /**
   * The reference participant, created with the room.
   *
   * It survives #41 as **the summary card's author**. The entry card is retired, but the argument
   * for a voice that is outside the roster was always about the *artefact*: a durable block in the
   * learner's document is not Ellie speaking, and a persona's name on it would make every later
   * turn from her read against a record she did not write. `agent_key` is null, which is what the
   * schema already means by "not an agent" — `agentByRole` cannot find it and the orchestrator
   * cannot select it. Made on demand for a room that predates this build.
   */
  #referenceParticipant() {
    const existing = findReferenceParticipant(this.#d.store.participants.forRoom(this.#d.roomId));
    if (existing) return existing;
    const row = {
      id: this.#d.newId('p'),
      room_id: this.#d.roomId,
      kind: 'agent' as const,
      user_id: null,
      agent_key: null,
      display_name: REFERENCE_DISPLAY_NAME,
      joined_at: this.#nowIso(),
      left_at: null,
    };
    this.#d.store.participants.insert(row);
    return row;
  }

  /**
   * **The room's Teacher, not the setting's.**
   *
   * A room keeps its participants for life (`agents.ts`: stored role strings are never renamed
   * and the pairing is decided once, at `createSession`). Resolving the whisper's counterpart by
   * roster key alone therefore throws on any room opened after the pairing was last changed —
   * which is every room in a vault that has been used across a settings change, and is exactly
   * what the first live run of the popover hit. Prefer the key, fall back to the role.
   */
  #peerParticipant() {
    const participants = this.#d.store.participants.forRoom(this.#d.roomId);
    const preferred = agentByRole(this.#d.roster, 'peer');
    const row =
      participants.find((p) => p.agent_key === preferred.key) ??
      participants.find((p) => p.agent_key?.startsWith('peer.'));
    if (!row) throw new Error('This room has no Teacher to ask privately.');
    return row;
  }

  // ── whisper ───────────────────────────────────────────────────────────────

  openWhisper(agentKey: string): WhisperThreadView {
    const agent = agentByKey(this.#d.roster, agentKey) ?? agentByRole(this.#d.roster, 'peer');
    const participant = this.#d.store.participants.byAgentKey(this.#d.roomId, agent.key);
    if (!participant) throw new Error(`No participant for ${agent.key}`);
    const threadId =
      this.#d.store.whispers.openThread(this.#d.roomId, participant.id) ?? this.#d.newId('wthread');
    const other = otherStandingAgent(this.#d.roster, agent);
    this.#event('student', 'whisper.open', { agent_key: agent.key });
    return {
      threadId,
      agent,
      turns: this.#d.store.whispers.forThread(threadId).map(whisperTurnView),
      limitsLine: limitsLine(agent, other?.displayName ?? 'the challenger'),
    };
  }

  /**
   * A whisper does NOT pause the group silence timer, and does NOT advance the ledger
   * (architecture-mac.md §C.4, progress-tracking.md §4.5). Whispering is not explaining to the
   * group, and if it advanced the ledger the private channel would become the efficient path.
   */
  async sendWhisper(
    threadId: string,
    text: string,
    /** The anchored segment, when the whisper came from the flow's popover (§3.5). */
    segment?: { label: string; page: number | null; text: string },
    /**
     * Who the private thread is with, when the caller knows (#48 §4.1's Max thread). Absent
     * callers keep the Teacher, which is every path that predates the second private channel.
     */
    agentParticipantIdHint?: string,
  ): Promise<void> {
    const body = text.trim();
    if (body.length === 0) return;
    const thread = this.#d.store.whispers.forThread(threadId);
    const agentParticipantId = thread[0]?.agent_participant_id ?? agentParticipantIdHint ?? this.#peerParticipant().id;
    const agentKey = this.#d.store.participants.get(agentParticipantId)?.agent_key ?? '';
    const agent = agentByKey(this.#d.roster, agentKey) ?? agentByRole(this.#d.roster, 'peer');
    const snapshot = this.#room().turn_seq;
    /**
     * **A private exchange is a turn for accounting purposes** (#42 item B, migration 021).
     *
     * It is emphatically not one for any other purpose — no floor, no orchestrator, no ledger,
     * no `#pending` — which is exactly why it has to mint its own id: the ledger's per-message
     * join is `turn_id`, and a whisper reply with none is a card the learner cannot ask "what
     * did that cost" about. Minted before the student's row so both halves of the exchange carry
     * it and the reply can be found from either.
     */
    const whisperTurnId = this.#d.newId('turn');

    const studentTurn = await this.#mailbox.enqueue(() => {
      this.#whisperTurns += 1;
      const row = {
        id: this.#d.newId('w'),
        room_id: this.#d.roomId,
        thread_id: threadId,
        student_participant_id: this.#studentParticipant().id,
        agent_participant_id: agentParticipantId,
        seq: this.#d.store.whispers.maxSeq(threadId) + 1,
        sender: 'student' as const,
        body,
        group_seq_snapshot: snapshot,
        relay_offer: null,
        promoted_message_id: null,
        usage: null,
        turn_id: whisperTurnId,
        created_at: this.#nowIso(),
      };
      this.#d.store.whispers.insert(row);
      this.#event('student', 'whisper.send', { thread_id: threadId, chars: body.length });
      this.#markFirstHelp();
      return row;
    });

    this.#d.transport.emit({
      type: 'whisper.turn',
      roomId: this.#d.roomId,
      threadId,
      turn: whisperTurnView(studentTurn),
    });

    const request = buildWhisperContext(this.#d.store, {
      roomId: this.#d.roomId,
      threadId,
      upToGroupSeq: snapshot,
      speaker: agent,
      roster: this.#d.roster,
      pack: this.#d.pack,
      segment: segment ?? null,
    });
    request.meta.scriptCue = `whisper:${this.#whisperTurns}`;
    // The thread is already on `meta.anchorId` (`context.whisper.ts`); this is the other half.
    request.meta.turnId = whisperTurnId;

    const started = this.#d.clock.now();
    const result = await this.#d.llm.complete(request);
    const target = this.#floor(
      latencyTargetMs({ ...agent, latency: { ttftMinMs: 1000, ttftMaxMs: 2000 } }, this.#d.config.latency_scale, this.#rand),
    );
    await this.#holdUntil(started, target);

    const scripted = this.#relayOfferFor(this.#whisperTurns);
    const reply = await this.#mailbox.enqueue(() => {
      const row = {
        id: this.#d.newId('w'),
        room_id: this.#d.roomId,
        thread_id: threadId,
        student_participant_id: this.#studentParticipant().id,
        agent_participant_id: agentParticipantId,
        seq: this.#d.store.whispers.maxSeq(threadId) + 1,
        sender: 'agent' as const,
        body: result.text,
        group_seq_snapshot: snapshot,
        relay_offer: scripted ? JSON.stringify(scripted) : null,
        promoted_message_id: null,
        usage: JSON.stringify(result.usage),
        turn_id: whisperTurnId,
        created_at: this.#nowIso(),
      };
      this.#d.store.whispers.insert(row);
      this.#event('whisper', 'whisper.reply', { thread_id: threadId, ttft_ms: result.ttftMs });
      return row;
    });

    this.#d.transport.emit({
      type: 'whisper.turn',
      roomId: this.#d.roomId,
      threadId,
      turn: whisperTurnView(reply),
    });
  }

  /**
   * The relay. The promoted text becomes a **new row in `messages`**, approved by the student;
   * the group context builder then reads it from there like any other message. There is no
   * "promoted from whisper" badge in the UI — the person this feature is for is the one who
   * will not ask in public (product-design.md §B4).
   */
  async relay(input: {
    threadId: string;
    whisperId: string;
    attribution: RelayAttribution;
    text: string;
    /** The segment the new shared card is inserted under. Null is the pre-flow room stream. */
    anchorId?: string | null;
  }): Promise<{ messageId: string }> {
    const whisper = this.#d.store.whispers.get(input.whisperId);
    const agentParticipantId = whisper?.agent_participant_id ?? null;
    const asAgent = input.attribution === 'as_agent' && agentParticipantId !== null;
    const anchorId = input.anchorId ?? null;

    const inserted = await this.#mailbox.enqueue(() => {
      this.#timer.cancel();
      const row = this.#insertMessage({
        participantId: asAgent ? agentParticipantId : this.#studentParticipant().id,
        body: input.text,
        promotedFromWhisper: input.whisperId,
        anchorId,
      });
      this.#d.store.whispers.markPromoted(input.whisperId, row.id);
      this.#event('student', 'whisper.relay', {
        attribution: input.attribution,
        seq: row.seq,
        anchor_id: anchorId,
        // R5, in the event log where it is checkable: the relayed text is a learner message and
        // the flow renders it, but `#updateLedger` is not called on this path and never has
        // been. Nothing said privately can move a row, relayed or not.
        ledger_touched: false,
      });
      return row;
    });

    /**
     * **The relayed text is classified like any learner turn** (#47 §2.2). It *is* one — R5 only
     * keeps it out of the ledger — and without this the answer lock would read the stale
     * classification of whatever the learner last typed in the composer, so a relayed question
     * could be answered as if it were a second "what's the answer".
     */
    this.#lastLearnerTurn = classifyLearnerTurn(input.text);
    // A relayed question is treated as an ordinary group turn from here on — on the segment it
    // was inserted under, so the reply lands in that thread rather than at the room level.
    await this.#runAgentTurn('promote', { anchorId });
    return { messageId: inserted.id };
  }

  /**
   * **Teach me this** (issue #38 §5; #36's contract for a prerequisite the deck assumes).
   *
   * A Teacher turn on the segment the requiring objective points at — or the deck anchor when
   * nothing in the deck points at it — with the objective in the directive and the orchestrator
   * bypassed. Bypassed deliberately: the learner has *named the move*, there is nothing for a
   * model to decide, and the alternative is 20 s of Sonnet to be told what the button already
   * said (`orchestrator.ts`'s own argument for `rule:teacher_answers`).
   *
   * It goes through `#runAgentTurn`, so the turn is an ordinary Teacher turn in every other
   * respect: the floor, the thinking indicator, Stop, the trace, the failure card — and
   * `#noteTurnForFlow` records it as taught, which is what writes `taughtAt` and what makes the
   * Tester able to quiz it later.
   */
  async teachObjective(input: {
    anchorId: string;
    objectiveId: string;
    title: string;
    statement: string;
    criteria: string[];
    assumedByDeck: boolean;
    /** The objective that requires this one, by title, so the explanation can land somewhere. */
    requiring: string | null;
  }): Promise<{ anchorId: string }> {
    // The tag first: every message this turn writes into the thread carries the objective.
    this.#objectiveByAnchor.set(input.anchorId, input.objectiveId);
    this.#noteLearnerActivity('ask', input.anchorId);
    this.#teachTarget = {
      title: input.title,
      statement: input.statement,
      criteria: input.criteria,
      assumedByDeck: input.assumedByDeck,
      requiring: input.requiring,
    };
    try {
      await this.#runAgentTurn('promote', {
        anchorId: input.anchorId,
        teach: { objectiveId: input.objectiveId, title: input.title },
      });
    } finally {
      this.#teachTarget = null;
    }
    return { anchorId: input.anchorId };
  }

  // ── the whisper popover, on a segment (flow-build-plan.md §3.5) ───────────

  /**
   * ⌘K on a focused card. Ellie only, anchored, and **ephemeral by construction**.
   *
   * *Ellie only* is not a UI choice: `pivot-spec.md` §B5's addressee control was a two-option
   * segmented header, and #32 removed the second option by removing the group — Max is the
   * Tester, and a private channel to the person quizzing you is the one shape this feature must
   * not have. `rosterFor()`'s peer is resolved here rather than passed in, so the renderer
   * cannot name an addressee at all.
   *
   * The thread id comes from `#segmentWhispers` — see the field's docstring for what a "round"
   * became. Reopening ⌘K on the same card in the same sitting returns the same turns; on any
   * other card, or after the sitting closed, it returns none.
   */
  openSegmentWhisper(anchorId: string): FlowWhisperView {
    // **The room's Teacher, not the setting's.** A room created under one pairing keeps its
    // participants for life (`agents.ts`: stored role strings are never renamed), so resolving
    // by key alone would throw on any deck opened before the pairing was last changed — which
    // is every deck in a vault that has been used. Fall back to the row whose role is peer.
    const participant = this.#peerParticipant();
    const agent = agentByKey(this.#d.roster, participant.agent_key ?? '') ?? agentByRole(this.#d.roster, 'peer');
    // Opening the popover is learner activity: it pushes the sitting's gap clock, which is what
    // mints `#flow` on a document whose first act is a private question.
    this.#noteLearnerActivity('whisper', anchorId);
    const key = `${this.#flow?.id ?? 'no-session'}|${anchorId}`;
    let threadId = this.#segmentWhispers.get(key);
    if (!threadId) {
      threadId = this.#d.newId('wthread');
      this.#segmentWhispers.set(key, threadId);
    }
    this.#whisperAnchor = anchorId;
    const other = otherStandingAgent(this.#d.roster, agent);
    this.#event('student', 'whisper.open', { agent_key: agent.key, anchor_id: anchorId });
    return {
      anchorId,
      threadId,
      agent,
      turns: this.#d.store.whispers.forThread(threadId).map(whisperTurnView),
      limitsLine: limitsLine(agent, other?.displayName ?? 'the challenger'),
    };
  }

  /** `Esc` / click-away. The popover is closed; nothing is written and nothing is posted. */
  closeSegmentWhisper(): void {
    this.#whisperAnchor = null;
  }

  // ── private threads, with Ellie *and* Max (#48, collab-doc.md §4.1) ───────

  /**
   * **One private thread with Ellie, one with Max.**
   *
   * `openSegmentWhisper` above resolves Ellie in code specifically so the renderer could not ask
   * for a private channel to the Tester (#32: *"a private channel to the person quizzing you is
   * the one shape this feature must not have"*). `collab-doc.md` §4.1 overrules that by name, and
   * this method is the deliberate widening — it is not an oversight and it is not a generalisation
   * of the old one, which is why it is a new method rather than a parameter on the old.
   *
   * What #32 was really protecting is kept whole, and is enforced somewhere other than here:
   *
   *  - a private thread **never edits the doc**. The only crossing is `insertPrivateIntoDoc`,
   *    which the learner presses (§4.1);
   *  - a private turn never reaches the group context — `buildWhisperContext` is the only builder
   *    that can see `whispers`, and `context.test.ts`'s canary now plants a string in **both**
   *    threads and looks for it in every shared surface;
   *  - a private turn never touches the ledger, the open question, the silence timer or the taught
   *    set. `sendWhisper` already does none of those things, and this changes none of that.
   *
   * Ephemeral by construction, the same way ⌘K is: the key carries the flow session id, so a
   * sitting that closed takes its private threads with it, and the map is deliberately absent from
   * `flowSnapshot()` so quitting ends every one of them.
   */
  openPrivate(agent: AgentAuthor): { threadId: string; turns: PrivateTurnView[] } {
    const role = agent === 'max' ? 'challenger' : 'peer';
    const participant = this.#participantForRole(role);
    this.#noteLearnerActivity('whisper', null);
    const key = `${this.#flow?.id ?? 'no-session'}|private|${agent}`;
    let threadId = this.#privateThreads.get(key);
    if (!threadId) {
      threadId = this.#d.newId('wthread');
      this.#privateThreads.set(key, threadId);
    }
    this.#registerThread(threadId, 'private', { agentKey: agent });
    this.#event('student', 'whisper.open', { agent_key: participant.agent_key, private_thread: true });
    return { threadId, turns: this.#privateTurns(threadId, agent) };
  }

  /**
   * A learner turn in a private thread. Straight through `sendWhisper`, which is the point: one
   * implementation of "a private turn", so the four things a whisper does not do stay not done for
   * Max exactly as they are for Ellie.
   */
  async sendPrivate(threadId: string, text: string): Promise<void> {
    const agent = this.#privateAgentOf(threadId);
    const before = this.#d.store.whispers.forThread(threadId).length;
    await this.sendWhisper(threadId, text, undefined, this.#privateParticipantFor(threadId, agent).id);
    for (const turn of this.#privateTurns(threadId, agent).slice(before)) {
      this.#d.transport.emit({ type: 'chat.private', roomId: this.#d.roomId, threadId, turn });
    }
  }

  /**
   * **"Insert into the document"** — the one path from private to shared (brief §4.1, issue #16's
   * surviving half).
   *
   * It is the *learner's* act, so there is no model call and no judgement about whether the doc
   * already says it: they have made that call. The batch is authored by the agent whose thread it
   * came from, with `cause: 'whisper_insert'`, which is how the edit log can say later that this
   * block entered the document by the one door that crosses the private boundary.
   */
  async insertPrivateIntoDoc(input: {
    threadId: string;
    turnId: string;
    anchorBlockId: string | null;
  }): Promise<{ editId: string | null }> {
    const turn = this.#d.store.whispers.get(input.turnId);
    if (!turn || turn.thread_id !== input.threadId || turn.sender !== 'agent') return { editId: null };
    const agent = this.#privateAgentOf(input.threadId);
    const batch = buildWhisperInsert(this.#docEditDeps(null, null), {
      author: agent,
      text: turn.body,
      anchorBlockId: input.anchorBlockId,
    });
    const emitted = await this.#emitDocEdit(batch, { objectiveId: null, messageId: null, turnId: null });
    if (emitted) {
      this.#event('student', 'whisper.relay', {
        attribution: 'insert_into_doc',
        thread_id: input.threadId,
        edit_id: batch!.editId,
        ledger_touched: false,
      });
    }
    return { editId: emitted ? batch!.editId : null };
  }

  /** Private turns as the chat column renders them. Never `messages`, and never a group surface. */
  #privateTurns(threadId: string, agent: AgentAuthor): PrivateTurnView[] {
    return this.#d.store.whispers.forThread(threadId).map((row) => ({
      id: row.id,
      role: row.sender === 'student' ? ('learner' as const) : ('agent' as const),
      agentKey: agent,
      text: row.body,
      createdAt: row.created_at,
      insertedEditId: null,
    }));
  }

  /** Which agent a private thread belongs to, from the registry, defaulting to the Teacher. */
  #privateAgentOf(threadId: string): AgentAuthor {
    const registered = this.#threads.get(threadId)?.agentKey;
    if (registered === 'ellie' || registered === 'max') return registered;
    for (const [key, id] of this.#privateThreads) {
      if (id === threadId) return key.endsWith('|max') ? 'max' : 'ellie';
    }
    return 'ellie';
  }

  #privateParticipantFor(threadId: string, agent: AgentAuthor) {
    const existing = this.#d.store.whispers.forThread(threadId)[0]?.agent_participant_id;
    if (existing) return this.#d.store.participants.get(existing) ?? this.#participantForRole(agent === 'max' ? 'challenger' : 'peer');
    return this.#participantForRole(agent === 'max' ? 'challenger' : 'peer');
  }

  /**
   * The room's participant for a role, not the setting's — `#peerParticipant`'s argument
   * generalised to both roles. A room keeps its participants for life (`agents.ts`), so resolving
   * by roster key alone throws on any room opened before the pairing was last changed.
   */
  #participantForRole(role: 'peer' | 'challenger') {
    const participants = this.#d.store.participants.forRoom(this.#d.roomId);
    const preferred = agentByRole(this.#d.roster, role);
    const row =
      participants.find((p) => p.agent_key === preferred.key) ??
      participants.find((p) => p.agent_key?.startsWith(`${role}.`));
    if (!row) throw new Error(`This room has no ${role === 'peer' ? 'Teacher' : 'Tester'} to ask privately.`);
    return row;
  }

  // ── the lesson card, and the learner's own doc text (#48 §6) ─────────────

  /**
   * **Start**, on a lesson card (brief §6). One Ellie turn that says what the objective is and
   * ends by asking the learner to ask — *"has Ellie prompt the learner to ask a question to
   * begin"*. It teaches nothing, deliberately: every studied session opened by the learner asking
   * (R1, R3, R4), and lecturing first would take that from them.
   *
   * It reuses `tryHere`'s code path, as the brief's own §9 note says it should — the learner named
   * the move, so the orchestrator is bypassed and the decision is written here.
   */
  async startLesson(input: { objectiveId: string; anchorId: string; blockId: string | null }): Promise<void> {
    this.#objectiveByAnchor.set(input.anchorId, input.objectiveId);
    this.#registerThread(input.anchorId, this.#threadKindOf(input.anchorId), { blockId: input.blockId });
    this.#noteLearnerActivity('ask', input.anchorId);
    const element = this.#d.pack.elements.find((e) => e.id === input.objectiveId);
    this.#lessonTarget = {
      title: element?.learner_label || element?.label || input.objectiveId,
      // The element's own label is the statement of what it is; `demonstration` is what a correct
      // answer contains, which is exactly §6's "what it asks of you".
      statement: element?.label ?? '',
      criteria: [...(element?.demonstration ?? [])],
      pages: [],
    };
    this.#event('student', 'flow.lesson_start', { objective_id: input.objectiveId, anchor_id: input.anchorId });
    try {
      await this.#runAgentTurn('promote', { anchorId: input.anchorId, lesson: { objectiveId: input.objectiveId } });
    } finally {
      this.#lessonTarget = null;
    }
  }

  /**
   * **The learner's own doc text counts** (brief §6, architect §E4).
   *
   * *"When the learner writes in the doc (their own provenance span, at least one sentence, in a
   * segment mapped to an objective), it is assessed as an attempt on that objective once they
   * pause."*
   *
   * The carrier is a **synthetic learner message** with `kind: 'doc_text'` in the span's thread,
   * inserted here — inside the mailbox, which is the only writer to `messages` — carrying the span
   * verbatim. Then the existing pipeline runs untouched: `classifyLearnerTurn`, `answerQuiz`,
   * `rule:quiz_feedback`, and every one of the ledger's hard rules, whose evidence id stays a
   * message id. The cost is one row; the benefit is that §6 needs no second evaluator and the
   * ledger's verbatim rule protects doc text exactly as it protects a typed answer.
   *
   * If there is no open question the text is still recorded and still judged by the ledger — it is
   * the learner's own words about an objective, which is what the ledger scores.
   */
  async assessDocText(input: { anchorId: string; objectiveId: string; blockId: string; text: string }): Promise<void> {
    const body = input.text.trim();
    if (body.length === 0) return;
    this.#objectiveByAnchor.set(input.anchorId, input.objectiveId);
    this.#registerThread(input.anchorId, 'span', { blockId: input.blockId, quote: body.slice(0, 90) });
    this.#docTextTarget = { blockId: input.blockId, text: body, anchorId: input.anchorId };

    let messageId: string | null = null;
    await this.#mailbox.enqueue(() => {
      this.#noteLearnerActivity('turn', input.anchorId);
      const row = this.#insertMessage({
        participantId: this.#studentParticipant().id,
        body,
        anchorId: input.anchorId,
        kind: 'doc_text',
      });
      messageId = row.id;
      /**
       * Classified like any learner turn, and for the same reason the relay path is: the rules
       * that answer it read this, and a stale classification from whatever was last typed in the
       * chat would mark doc text against the wrong intent.
       */
      this.#lastLearnerTurn = classifyLearnerTurn(body);
      this.#lastMention = null;
      this.#mentionRest = null;
      if (this.#pendingQuiz) {
        this.#pendingQuiz = answerQuiz(this.#pendingQuiz, row.id, { attempt: this.#lastLearnerTurn === 'attempt' });
      }
      this.#event('student', 'flow.doc_text', {
        anchor_id: input.anchorId,
        block_id: input.blockId,
        objective_id: input.objectiveId,
        chars: body.length,
      });
      this.#d.store.rooms.update(this.#d.roomId, { consecutive_agent_turns: 0, expects_reply: 1 });
    });

    try {
      await this.#runAgentTurn('promote', {
        anchorId: input.anchorId,
        studentBody: body,
        studentMessageId: messageId,
      });
    } finally {
      this.#docTextTarget = null;
    }
  }

  /**
   * **A selection change** — the learner focused a segment card (`pivot-spec.md` §B8).
   *
   * It is the document's analogue of a keystroke, and it is handled exactly like one: the
   * silence window is extended under the same 120 s cap, and the sitting's gap clock is pushed
   * if there already is a sitting. It does **not** open one — `flow-session.md` §8.1 is explicit
   * that a reader who looks at a card and leaves has not started a session, and the same guard
   * `typing()` uses applies here for the same reason.
   */
  noteSelection(anchorId: string | null): void {
    this.#timer.onSelectionChange();
    if (this.#flow) this.#noteLearnerActivity('scroll', anchorId);
    if (anchorId !== null) this.#lastAnchorId = anchorId;
  }

  /**
   * A private turn in a segment's popover.
   *
   * `sendWhisper()` unchanged, plus the segment's own text — the same page text the REFERENCE
   * card is built from (`flowroom.segmentText()`). Everything `sendWhisper` does *not* do is
   * still not done here: no floor, no timer reset, no ledger, and nothing that reaches Max.
   */
  async sendSegmentWhisper(input: {
    threadId: string;
    anchorId: string;
    text: string;
    segment: { label: string; page: number | null; text: string };
  }): Promise<void> {
    this.#whisperAnchor = input.anchorId;
    await this.sendWhisper(input.threadId, input.text, { ...input.segment });
  }

  // ── wrap up ───────────────────────────────────────────────────────────────

  async wrapUp(): Promise<RecapView> {
    return this.#mailbox.enqueue(() => {
      this.#timer.cancel();
      this.#timer.stop();
      this.#d.store.rooms.update(this.#d.roomId, { state: 'closed', closed_at: this.#nowIso() });
      this.#d.store.sessions.end(this.#d.sessionId, this.#nowIso(), 'wrapped_up');
      this.#event('student', 'session.end', { reason: 'wrapped_up' });
      const recap = this.#buildRecap();
      this.#d.transport.emit({ type: 'session.recap', roomId: this.#d.roomId, recap });
      this.#d.transport.emit({ type: 'room.state', roomId: this.#d.roomId, state: 'closed' });
      return recap;
    });
  }

  /**
   * "Yes, invite Theo."
   *
   * Theo's teach-back round is A2 work and is not built. Until it is, the honest thing a button
   * can do is be a real button: the acceptance is written to the event log — it is a finding,
   * the recap's reward gate is one of the things the study is measuring — and the card says
   * plainly what happens next instead of sitting there with no handler at all
   * (ui-review-ux.md M9: "wire or remove the Theo button").
   */
  acceptTeachback(agentKey: string): TeachbackResult {
    const tutee = this.#d.roster.find((a) => a.key === agentKey && a.role === 'tutee');
    if (!tutee) return { available: false, note: 'That study partner is not in this room.' };
    this.#event('student', 'teachback.accepted', { agent_key: tutee.key });
    return {
      available: false,
      note: `Noted — ${tutee.displayName}'s round is the next thing being built. Nothing here is lost: the transcript and your ledger stay with this session.`,
    };
  }

  snapshot(): RoomSnapshot {
    const room = this.#room();
    const material = this.#d.store.materials.get(room.material_id)!;
    const participants = new Map(this.#d.store.participants.forRoom(this.#d.roomId).map((p) => [p.id, p]));
    const references = new Map(this.#d.store.messageRefs.forRoom(this.#d.roomId).map((r) => [r.message_id, r]));
    return {
      roomId: room.id,
      sessionId: this.#d.sessionId,
      moduleCode: room.module_code,
      topic: room.topic,
      round: 1,
      state: room.state,
      startedAt: new Date(this.#openedAt).toISOString(),
      material: {
        id: material.id,
        moduleCode: material.module_code,
        title: material.title,
        sourceKind: material.source_kind,
        fileName: material.file_path,
        fileId: material.file_id,
        pageFrom: material.page_from,
        pageTo: material.page_to,
        pageCount: material.page_count,
        extractedText: material.extracted_text,
        cacheEligible: material.cache_eligible === 1,
        tokenCount: material.token_count,
      },
      agents: this.#d.roster,
      messages: this.#d.store.messages
        .forRoom(this.#d.roomId)
        .map((m) => messageView(m, participants, this.#d.roster, references.get(m.id))),
      ledger: ledgerView(this.#ledgerRows(), this.#d.pack),
      timer: timerView(this.#timer.snapshot, this.#timer.snapshot.stageOneMs, this.#d.clock.now(), this.#typingActive()),
      thinking: this.#thinking,
      nudgesPaused: this.#timer.snapshot.nudgesPaused,
      mode: this.#d.config.mode,
      // Built from *this* session's pack and roster. It used to be the PSD/Hessian demo
      // script's card in every real session, so a room about pedagogical agent roles opened
      // with "Your slide: convexity and the Hessian" (ui-review-ux.md B4).
      roundCard: roundCardFor({ pack: this.#d.pack, roster: this.#d.roster, mode: this.#d.config.mode }),
      failures: this.#failures.map((f) => f.view),
    };
  }

  // ── the turn itself ───────────────────────────────────────────────────────

  async #runAgentTurn(
    trigger: TurnTrigger,
    opts: {
      studentBody?: string;
      silenceStage?: 1 | 2;
      anchorId?: string | null;
      /** The learner row this turn is answering, so `turn.received` can name it. */
      studentMessageId?: string | null;
      /**
       * **Teach me this** (#38 §5): the learner named the move, so there is nothing to decide
       * and the orchestrator is skipped. Everything else about the turn is unchanged.
       */
      teach?: { objectiveId: string; title: string };
      /**
       * **"+ Try this"** (#47 §2.1): likewise named by the learner. One Tester question on this
       * objective, decided here rather than by a model, and it opens the quiz the answer lock runs
       * on.
       */
      tryHere?: { objectiveId: string };
      /** **Pass** (#48 §4.4): the control's door into `rule:answer_released`. */
      showAnswer?: boolean;
      /** **"+ Ask here"** (#47 §6): the explain path, which is the Teacher's even mid-question. */
      askedHere?: boolean;
      /** **`rule:max_followup`** (#48 §4.2): the second of the two chained agent turns. */
      followup?: { objectiveId: string | null };
      /** **`rule:closure`** (#48 §4.7): the sitting went idle with a question still open. */
      closure?: { elementId: string };
      /** **`rule:lesson_start`** (#48 §6): the lesson card's Start. */
      lesson?: { objectiveId: string };
    } = {},
  ): Promise<void> {
    /**
     * The segment this turn belongs to. Every message the turn writes carries it — the hand-off
     * line, the agent's reply — so a thread stays a thread and the flow never has to guess where
     * a turn landed. `null` is the room-level stream, which is every pre-flow room.
     */
    const anchorId = opts.anchorId ?? null;
    this.#turnAnchorId = anchorId;
    const turnStart = this.#d.clock.now();
    const pending: PendingTurn = {
      id: this.#d.newId('turn'),
      cancelled: false,
      floorPassed: false,
      stopped: false,
      abort: new AbortController(),
      anchorId,
    };
    this.#pending = pending;
    /**
     * **The correlation id.** Everything this turn does — the orchestrator decision, the ledger
     * update, every LLM call underneath both, the dispatch and the timer — is logged with it, so
     * one `jq 'select(.turn=="turn_7")'` reconstructs the whole chain with its timings. Reading
     * the 2026-09-16 failure out of `events` and `turn_decisions` by timestamp is what this
     * replaces.
     */
    const turnLog = this.#log.child(pending.id);
    this.#turnLog = turnLog;
    turnLog.event('info', 'turn.start', {
      trigger,
      anchor_id: anchorId,
      silence_stage: opts.silenceStage ?? null,
      consecutive_agent_turns: this.#room().consecutive_agent_turns,
      backend: this.#d.llm.kind,
    });

    /**
     * **"The room has your message"** — the first half of the audit's P0 #3, and the reason the
     * 3–8 s floor-yield window is no longer a blank screen.
     *
     * It is emitted *here*: before the orchestrator, before the ledger, before the sleep below,
     * on the same mailbox tick the learner's row was written on. `design-brief.md` §D4 wants an
     * indicator during the hold and `product-design.md` §C3 wants *nothing at all* for the first
     * 8 s; both are right, about different things. §C3 governs **agent** chrome — a name, a
     * verb, a typing animation — and "the room received it" is not agent chrome. So this goes
     * out immediately and `#showThinking()` still does not, and neither brief moves.
     *
     * Only the two triggers that actually have a yield window get it. An `open` or a `silence`
     * turn is not answering anything the learner just did, so there is nothing to acknowledge.
     */
    this.#trace(pending.id, { anchorId, trigger, startedAt: this.#nowIso() });
    const receivesAck = trigger === 'student_message' || trigger === 'promote';
    if (receivesAck) {
      this.#received = pending.id;
      this.#emitReceived({
        turnId: pending.id,
        messageId: opts.studentMessageId ?? null,
        anchorId,
        yieldMs: this.#yieldMs(),
        etaMs: null,
        responder: null,
      });
    }

    const room = this.#room();
    // The flow verdict is computed here, on the room's clock, and handed to the rules. The
    // Tester is eligible only when it says so (#33, flow-session.md §8.2).
    const now = this.#d.clock.now();
    this.#flow = this.#flow ? tickSession(this.#flow, now) : null;
    const verdict = handOffDue(
      {
        session: this.#flow,
        taught: this.#taught,
        pendingTeacherQuestion: this.#room().expects_reply === 1 && trigger !== 'student_message',
        silenceWindowOpen: trigger === 'silence',
        // Wired for the first time by the popover (§3.5). It was hard-coded `false` while ⌘K was
        // unbound; the rule it feeds has always been "do not spring a quiz on someone who is
        // mid-aside", and there was no aside to be mid-of until now.
        whisperOpen: this.#whisperAnchor !== null,
        referenceLocked: this.#referenceLocked(anchorId),
        lastKeystrokeAt: this.#typingUntil > 0 ? this.#typingUntil - 3_500 : null,
        ledgerLevels: Object.fromEntries(this.#ledgerRows().map((r) => [r.element_id, r.level])),
        mode: this.#testerMode,
      },
      now,
    );
    this.#event('system', 'progress.update', {
      flow: 'state.changed',
      ready: verdict.due,
      reasons: verdict.reasons,
      taught_count: verdict.candidates.length,
      learner_turns_in_window: verdict.learnerTurnsInWindow,
      learner_turns_since_handoff: verdict.learnerTurnsSinceHandOff,
      youngest_quizzable_age_ms: verdict.youngestQuizzableAgeMs,
      profile: (this.#flow?.profile ?? FLOW).name,
    });

    const decisionInput = {
      trigger,
      consecutiveAgentTurns: room.consecutive_agent_turns,
      silenceStage: opts.silenceStage,
      lastProbeType: this.#lastProbeType,
      handOff: verdict,
      handOffLine: verdict.due
        ? handOffLine(this.#d.roster, verdict.candidates, (id) => this.#learnerLabel(id))
        : null,
      pendingQuiz: this.#pendingQuiz,
      referenceLocked: this.#referenceLocked(anchorId),
      // In the flow every turn has an anchor, and a learner turn under a segment is the
      // Teacher's to answer by rule — no model call, no 20 s, no null role (orchestrator.ts
      // `rule:ellie_answers`). `null` is the pre-flow room-level stream.
      anchoredThread: anchorId !== null,
      /**
       * **Which channel this is** (#48, brief §4.1). A private thread never reaches here at all —
       * `sendPrivate` goes through the whisper path, which does not run the orchestrator — so this
       * is only ever `doc` or `span`, and it is passed so the gate reads as the brief states it.
       */
      threadKind: anchorId === null ? null : this.#threadKindOf(anchorId),
      /** Who the learner named, if anyone (brief §4.2 rows 2–3). Only on a learner turn. */
      mention:
        trigger === 'student_message' || trigger === 'promote' ? this.#lastMention : null,
      // What the quiet is quiet *about* (#37, `silenceDecision`).
      lastAgentTurn: this.#lastAgentTurn,
      /**
       * **The answer lock's two inputs** (#47 §2.3). The classification is only meaningful on a
       * learner turn, so it is cleared on anything else rather than left to go stale — a silence
       * fill must not be read as the learner having asked for the answer again.
       */
      learnerTurn:
        trigger === 'student_message' || trigger === 'promote' ? this.#lastLearnerTurn : null,
      showAnswer: opts.showAnswer === true,
      askedHere: opts.askedHere === true,
    };

    const cue =
      trigger === 'open'
        ? 'open'
        : trigger === 'silence'
          ? `silence:${this.#silenceFires}`
          : `student:${this.#studentTurns}`;

    /**
     * The ledger runs *inside* the delay window — that is the strongest argument the latency
     * mechanic has, the delay being the assessment window — but **the turn does not wait for
     * it** (progress-tracking.md §4.6: "the chat never blocks on the ledger. A progress display
     * that can stall the conversation is worse than no progress display").
     *
     * It used to, through a `Promise.all`, and that was invisible only because the ledger call
     * had no schema and failed in five seconds flat (see the commit that gave it one). With the
     * ledger actually working, a measured live turn on the CLI backend went: orchestrator 4 ms,
     * **ledger 24.1 s**, Ellie 4.7 s — 28.8 s to a reply the learner should have had in ~9. The
     * rail is a side-channel and is now wired as one: it animates when it animates, and the code
     * above it is the conversation.
     */
    /**
     * **The ledger does not run on the answer** (issue #47, `attempt-first.md` §2.3: *"the ledger
     * is not run on this turn and never moves on a shown answer"*).
     *
     * Two turns are excluded. The **Show the answer** button is not a learner turn at all — there
     * is no new message to judge, and running the ledger here would re-judge the previous one. An
     * **answer request** is a learner turn, but it is the learner asking to be told; ledger rule 1
     * already makes it impossible for Max's words to become the learner's evidence, and this is the
     * same guarantee said once more where it is cheap to check.
     */
    const ledgerRuns =
      (trigger === 'student_message' || trigger === 'promote') &&
      opts.showAnswer !== true &&
      this.#lastLearnerTurn !== 'give_up';
    if (ledgerRuns) {
      /**
       * **The proposal travels with the turn that judges the attempt** (#47 §2.3, and a seam the
       * scripted take found on 2026-09-19).
       *
       * The ledger call used to carry the learner cue always, so a Critique 1 ledger block written
       * against `feedback:2` — where it belongs, because it is a judgement of the attempt that
       * feedback answers — was never reached, and the rail stayed at ○ ○ ○ after two attempts and
       * two feedback turns. `feedbackDue` is already true here (the mailbox tick counted the
       * attempt), so the upcoming decision is `rule:quiz_feedback` and the cue is known.
       *
       * Both cues are passed, not one: `script.psd-hessian.ts` keys its blocks to `student:N`, and
       * switching globally would silence that script (`scripted.ledgerFor` tries them in order).
       */
      const ledgerCue = feedbackDue(this.#pendingQuiz)
        ? quizCue('feedback', this.#testerQuestions)
        : cue;
      // `#updateLedger` catches its own failures and surfaces them as a card, so nothing here
      // can reject; the `catch` is belt and braces against a future edit that changes that.
      void this.#updateLedger(ledgerCue, turnStart, ledgerCue === cue ? undefined : cue).catch(() => undefined);
    }
    const decidedAt = this.#d.clock.now();
    const decision = opts.tryHere
      ? /**
         * **"+ Try this"** (#47 §2.1). The learner asked Max for a question on this objective;
         * there is nothing for a model to decide, and `rule:handoff` is not the only door any more.
         * `challenges` carries the element because a question *is* what puts it under test — which
         * is the difference between this and the hint the answer lock gives, where nothing is.
         */
        ({
          speak: true,
          role: 'challenger',
          moveType: 'quiz',
          probeType: null,
          targetElementId: opts.tryHere.objectiveId,
          challenges: [opts.tryHere.objectiveId],
          rationale: 'The learner pressed "+ Try this": the Tester asks one question on this objective.',
          decidedBy: 'rule:try_here',
          handOffLine: null,
          failure: null,
        } satisfies TurnDecision)
      : /**
         * **The three turns #48 writes in code** (`collab-doc.md` §4.2, §4.7, §6). Same argument
         * as `rule:try_here` above it: the learner (or the clock) has already named the move, so
         * there is nothing left for a model to decide and a call here would buy 20 s of Sonnet to
         * be told what the button already said.
         */
        opts.followup
        ? maxFollowupDecision(opts.followup.objectiveId)
        : opts.closure
          ? closureDecision(opts.closure.elementId)
          : opts.lesson
            ? lessonStartDecision(opts.lesson.objectiveId)
            : opts.teach
      ? ({
          speak: true,
          role: 'peer',
          moveType: 'teach_objective',
          probeType: null,
          targetElementId: opts.teach.objectiveId,
          challenges: [],
          rationale: `The learner asked to be taught "${opts.teach.title}" from their objectives panel.`,
          decidedBy: 'rule:teach_objective',
          handOffLine: null,
          failure: null,
        } satisfies TurnDecision)
      : await this.#decide(decisionInput, cue, turnLog, turnStart);
    this.#trace(pending.id, {
      decisionMs: this.#d.clock.now() - decidedAt,
      decidedBy: decision.decidedBy,
      role: decision.role,
      moveType: decision.moveType,
      failed: decision.failure?.reason ?? null,
    });

    this.#recordDecision(trigger, decision);
    /**
     * **The lock, in the event log** (#47 §2.3). These two lines are what the A1 log can be asked
     * "how often was the answer asked for before a try, and how often after" — the question the
     * report's DG1 claim rests on.
     */
    if (decision.decidedBy === 'rule:answer_released' || decision.decidedBy === 'rule:closure') {
      this.#event('challenger', 'quiz.answer_released', {
        element_id: decision.targetElementId,
        attempts: attemptsOf(this.#pendingQuiz),
        released_by: this.#releaseReason(decision, opts),
        anchor_id: anchorId,
        // §4.4: "It fills no progress." Stated where it can be audited, not only in a comment.
        ledger_touched: false,
        fills_progress: false,
      });
    }
    /**
     * **A decision that failed is never allowed to look like a decision to say nothing.**
     *
     * `decideTurn` now answers a learner turn with the Teacher even when the call threw, so a
     * failure here usually still dispatches — the card goes up *alongside* the reply, saying the
     * judgement step was skipped. When it did not dispatch, the card is the only thing the
     * learner gets, and it is still infinitely better than the empty thread of 2026-09-16.
     */
    if (decision.failure) {
      this.#failTurn({
        kind: 'turn',
        anchorId,
        displayName: agentByRole(this.#d.roster, decision.role ?? 'peer').displayName,
        reason: decision.failure.reason,
        detail: decision.failure.detail,
        replay: { trigger, anchorId, silenceStage: opts.silenceStage },
      });
    }
    if (!decision.speak || decision.role === null) {
      this.#pending = null;
      this.#releaseTurn(pending.id, null);
      this.#armTimer();
      return;
    }

    const agent = agentByRole(this.#d.roster, decision.role);
    /**
     * **A question the learner asked for arrives at the Teacher's band** (#47 §2.1).
     *
     * The Tester's 9–12 s floor is Tan et al.'s considered judgement, and it is right for
     * *feedback*: the learner has answered and the wait says the answer is being weighed. It is
     * wrong for the question itself when the learner has just pressed a button asking for one, so
     * a "+ Try this" question uses the Teacher's band (`LATENCY.peer`, 4–6 s — the brief says 3–6 s
     * and the code's own band is the single source of it). Everything else about the turn, feedback
     * included, keeps the Tester's band.
     */
    const band =
      decision.decidedBy === 'rule:try_here' ||
      /**
       * **§4.3's pair is short, and waiting 9–12 s on either half would break it** (#48). Ellie's
       * cue is a peer thinking aloud — a classmate does not deliberate for twelve seconds — and
       * Max's prompt answers her while the learner is still reading it. Both use the Teacher's
       * 4–6 s band. Tan et al.'s considered judgement is about *feedback on an answer*, and
       * neither of these is that.
       */
      decision.moveType === 'peer_guess' ||
      decision.moveType === 'max_prompt'
        ? agentByRole(this.#d.roster, 'peer').latency
        : agent.latency;
    const target = this.#floor(latencyTargetMs({ ...agent, latency: band }, this.#d.config.latency_scale, this.#rand));
    this.#d.store.rooms.update(this.#d.roomId, {
      state: 'agent_scheduled',
      pending_turn_id: pending.id,
      pending_turn_due_ts: new Date(turnStart + target).toISOString(),
    });
    /**
     * The speaker is known now, and for a rule decision it was known before any model ran. Refresh
     * the acknowledgement with it and with the floor target, so the renderer can size and place
     * the reserved slot (`pivot-spec.md` §B9 device 2) and put the ETA in a `title` on hover —
     * Lucas's decision of 16 Sep: *ETA only on hover*, never advertised. A model decision is not
     * re-emitted: it arrives mid-yield, and a name appearing at second 4 is exactly the agent
     * chrome §C3 forbids there.
     */
    if (receivesAck && decision.decidedBy?.startsWith('rule:')) {
      this.#emitReceived({
        turnId: pending.id,
        messageId: opts.studentMessageId ?? null,
        anchorId,
        yieldMs: this.#yieldMs(),
        etaMs: target,
        responder: { agentKey: agent.key, role: agent.role, displayName: agent.displayName, colour: agent.colour },
      });
    }
    this.#trace(pending.id, { latencyTargetMs: target });
    this.#event(decision.role, 'agent.turn.plan', {
      move: decision.moveType,
      probe_type: decision.probeType,
      target_element_id: decision.targetElementId,
      latency_target_ms: target,
      decided_by: decision.decidedBy,
    });

    /**
     * The Teacher's hand-off line is posted **before** the Tester generates anything, and it is
     * written by `flow.handOffLine()` rather than by the model (flow-build-plan.md §4.2). On
     * camera that is the difference between "a rule I can see and turn down" and a model's whim;
     * in the code it is the same treatment the stage-1 nudge pool already gets.
     */
    if (decision.decidedBy === 'rule:handoff' && decision.handOffLine) {
      this.#testerQuestions += 1;
      // R1b (`flow.requiresTurnsSinceHandOff`): the Demo profile counts learner turns from here,
      // so a second walkthrough in the same sitting teaches again before it quizzes again.
      if (this.#flow) this.#flow = noteHandOff(this.#flow, this.#d.clock.now());
      const teacher = agentByRole(this.#d.roster, 'peer');
      await this.#mailbox.enqueue(() => {
        this.#insertMessage({
          participantId: this.#d.store.participants.byAgentKey(this.#d.roomId, teacher.key)!.id,
          body: decision.handOffLine!,
          model: 'rule:handoff',
          anchorId,
        });
        this.#event('peer', 'agent.turn.dispatched', { move: 'hand_off', decided_by: decision.decidedBy });
      });
    }

    // "+ Try this" is the other door onto the same counter, and it is counted here for the same
    // reason the hand-off is above: the cue has to carry the question's number. `rule:max_followup`
    // is the third door (#48 §4.2) and counts identically — one counter, so a second question's
    // feedback can never be cued as the first question's.
    if (decision.decidedBy === 'rule:try_here' || decision.decidedBy === 'rule:max_followup') {
      this.#testerQuestions += 1;
    }
    /**
     * **The script cues of one Tester question** (#47; `attempt.quizCue`). Every turn that belongs
     * to question N carries `:N`, so the scripted backend can hold a whole attempt loop — question,
     * attempt, feedback, hint, clarification, answer — as named beats, and a second question's
     * feedback can never be played against the first.
     */
    const turnCue = this.#cueFor(decision, cue);

    /**
     * Generate now; hold the tokens until the floor. The buffer is the product decision.
     *
     * The result is settled into a value **immediately**, before the floor-yield sleep below.
     * The promise is created here and not awaited for up to 8 s, and on a cancelled turn it is
     * never awaited at all — so a rejection in that gap had no handler on it, which Node reports
     * as an unhandled rejection and Electron turns into a main-process crash dialog. The reject
     * path is exactly the path this commit exists to make visible; it must not take the app down
     * on the way to the card.
     */
    const participant: TurnParticipantView = {
      agentKey: agent.key,
      role: agent.role,
      displayName: agent.displayName,
      colour: agent.colour,
    };
    const stream = new TurnStream(
      (text) =>
        this.#d.transport.emit({
          type: 'turn.delta',
          roomId: this.#d.roomId,
          turnId: pending.id,
          anchorId,
          participant,
          text,
        }),
      () => this.#d.clock.now(),
    );
    const generatingFrom = this.#d.clock.now();
    /**
     * `generationMs` is stamped **when the promise settles**, not when it is awaited. The await
     * below is on the far side of the floor-yield sleep, so measuring there reported the yield as
     * generation time — the first live run showed `gen=4996ms` for a reply that was produced in
     * milliseconds, which is exactly the kind of number the debug drawer exists to stop people
     * believing.
     */
    let generationMs: number | null = null;
    const stampGeneration = (): void => {
      generationMs ??= this.#d.clock.now() - generatingFrom;
    };
    const generation = this.#generate(agent, decision, turnCue, (delta) => stream.push(delta), pending.abort.signal).then(
      (value) => {
        stampGeneration();
        return { ok: true as const, value };
      },
      (error: unknown) => {
        stampGeneration();
        return { ok: false as const, error };
      },
    );
    /**
     * The floor runs **concurrently with the generation**, not after it. That is the whole change:
     * the hold is a wall-clock deadline measured from `turnStart`, and what it gates is when the
     * tokens become visible, not when the call is allowed to finish. `await`ing it below gives
     * the same total timing it always had — the later of the two — with the deltas already out.
     */
    const floor = this.#holdUntil(turnStart, target).then(() => {
      pending.floorPassed = true;
      if (!pending.cancelled) stream.openFloor();
    });

    const yieldMs = this.#yieldMs();
    if (trigger === 'student_message' || trigger === 'promote') {
      await this.#sleep(Math.max(0, Math.min(yieldMs, target - 1_000) - (this.#d.clock.now() - turnStart)));
    }
    if (pending.cancelled) {
      stream.close();
      this.#cancelTurn(decision.role, pending);
      return;
    }
    this.#showThinking(agent, turnStart, target);

    let text: string;
    /** The model's own time to first token. The *visible* one is computed after the floor. */
    let ttft = 0;
    let model = agent.model;
    let backend: LlmBackend | null = null;
    let usage: Record<string, number> = {};
    const settled = await generation;
    if (pending.stopped) {
      await this.#dispatchStopped({ pending, agent, decision, stream, anchorId, target, turnStart, turnLog, generationMs });
      return;
    }
    if (!settled.ok) {
      /**
       * This used to emit a transient banner that said "retrying" and then retried nothing. The
       * card stays in the thread, names what broke, and the button actually replays the turn.
       */
      stream.close();
      this.#clearThinking();
      this.#pending = null;
      this.#trace(pending.id, {
        failed: failureReason(settled.error),
        totalMs: this.#d.clock.now() - turnStart,
      });
      this.#releaseTurn(pending.id, null);
      this.#failTurn({
        kind: 'turn',
        anchorId,
        displayName: agent.displayName,
        reason: failureReason(settled.error),
        detail: settled.error instanceof Error ? settled.error.message : String(settled.error),
        replay: { trigger, anchorId, silenceStage: opts.silenceStage },
      });
      this.#armTimer();
      return;
    }
    {
      const result = settled.value;
      text = result.text;
      ttft = result.ttftMs;
      model = result.model;
      backend = result.backend ?? null;
      usage = result.usage as unknown as Record<string, number>;
    }
    this.#trace(pending.id, { generationMs, model, backend, usage });

    await floor;
    if (pending.cancelled) {
      stream.close();
      this.#cancelTurn(decision.role, pending);
      return;
    }
    stream.close();
    /**
     * `ttft_actual_ms` is the **visible** first token, which is the number the manipulation is
     * about and the number the message card shows. The client's own `ttftMs` is the model's, and
     * it is smaller than this by however much of the floor was left when it arrived; it stays in
     * the log line under `llm.complete`, where it belongs.
     */
    const visibleTtft =
      stream.firstVisibleAt !== null
        ? stream.firstVisibleAt - turnStart
        : Math.max(0, this.#d.clock.now() - turnStart);

    /** The row this turn wrote, carried out of the mailbox for the doc-edit call beside it. */
    let dispatchedMessageId: string | null = null;
    await this.#mailbox.enqueue(() => {
      this.#clearThinking();
      const row = this.#insertMessage({
        participantId: this.#d.store.participants.byAgentKey(this.#d.roomId, agent.key)!.id,
        body: text,
        model,
        backend,
        usage: JSON.stringify(usage),
        latencyTargetMs: target,
        ttftActualMs: visibleTtft,
        totalMs: this.#d.clock.now() - turnStart,
        decidedBy: decision.decidedBy,
        // Migration 021: the other end of `llm_usage.turn_id`, so this card can say what it cost.
        turnId: pending.id,
        dividerCause:
          trigger === 'silence' ? this.#dividerFor(opts.silenceStage ?? 1, agent, decision.moveType) : null,
        anchorId,
        /**
         * **What the Teacher was shown** (issue #35's footer, issue #41's answerer). It used to
         * ride only on a REFERENCE card; the Teacher answers the thread now, so the card that
         * says `p. 14 + outline` is hers. Only the Teacher's: the Tester's question is not
         * answered from a passage, and claiming a scope for it would be an overclaim.
         */
        scopeShown:
          decision.role === 'peer' && anchorId !== null
            ? (this.#askContext.get(anchorId)?.scopeShown ?? null)
            : null,
        // `disagreement` is never written any more: the S2 quota and the whole social-group
        // framing went with #32. The column and the view field stay so that a room recorded
        // before this build still renders its markers (masg-drop-assessment.md §D2 Option 2).
      });
      const roomNow = this.#room();
      this.#d.store.rooms.update(this.#d.roomId, {
        state: 'open',
        pending_turn_id: null,
        pending_turn_due_ts: null,
        consecutive_agent_turns: roomNow.consecutive_agent_turns + 1,
        last_speaker_id: agent.key,
      });
      this.#event(decision.role!, 'agent.turn.dispatched', {
        seq: row.seq,
        latency_target_ms: target,
        ttft_actual_ms: visibleTtft,
        usage,
      });
      turnLog.event('info', 'turn.dispatched', {
        role: decision.role,
        agent_key: agent.key,
        move_type: decision.moveType,
        decided_by: decision.decidedBy,
        model,
        backend,
        latency_target_ms: target,
        // Both: what the learner saw, and what the model did behind the floor.
        ttft_actual_ms: visibleTtft,
        ttft_model_ms: ttft,
        total_ms: this.#d.clock.now() - turnStart,
        // The length of what was said, never what was said.
        reply_chars: text.length,
        usage,
      });
      this.#trace(pending.id, {
        ttftActualMs: visibleTtft,
        totalMs: this.#d.clock.now() - turnStart,
      });
      this.#releaseTurn(pending.id, row.id);
      dispatchedMessageId = row.id;
      this.#noteTurnForFlow(decision, row.id, text);
      if (trigger === 'silence') this.#markFirstHelp();
      /**
       * **The offer** (#41, `rule:offer_summary`). After the Teacher's reply, never instead of it,
       * and never into a silence — a learner who has gone quiet is not being asked to press a
       * button. It posts one line and inserts nothing; R1 is the whole design.
       */
      if (decision.role === 'peer' && trigger !== 'silence') this.#maybeOfferSummary(anchorId);
    });

    this.#pending = null;
    /**
     * **The doc edit runs beside the turn** (#48, brief §5; architect §A.2's last row).
     *
     * `void`, not `await`: the reply has already been released, and a document that could make the
     * next turn wait would be the artefact charging the conversation for its own ambitions. Every
     * failure inside is swallowed and logged there.
     */
    void this.#maybeDocEdit(decision, text, dispatchedMessageId ?? '', pending.id, anchorId);
    this.#lastAgentTurn = classifyAgentTurn(decision, this.#lastAgentTurn);
    /**
     * **How long the next silence has to be** (#47 §5): the reading time of what was just said,
     * doubled and clamped. A *fill* is deliberately excluded — the learner is still reading the turn
     * the fill interrupted, and `#armTimer(true)` therefore leaves the window's thresholds where
     * they were.
     */
    if (trigger !== 'silence') this.#stages = silenceStagesMs(wordCount(text));
    this.#lastFillWasScaffold = trigger === 'silence' && opts.silenceStage === 2;
    if (decision.probeType) this.#lastProbeType = decision.probeType;
    for (const id of decision.challenges) this.#challenged.add(id);
    this.#armTimer(trigger === 'silence');

    /**
     * **`rule:max_followup` — the second of the two consecutive agent turns** (#48, brief §4.2
     * row 1): *"Ellie answers in full, then Max asks one follow-up to the chat."*
     *
     * Chained here, at the end of the turn that earned it, rather than decided inside it: it is a
     * second turn, with its own floor, its own thinking indicator and its own Stop, and folding it
     * into the first would make it a paragraph rather than a turn.
     *
     * `MAX_CONSECUTIVE_AGENT_TURNS` is 2 and this spends the second, which is right at the cap
     * (architect §E5). `silenceDecision` is still reached **before** the cap is checked, so §4.3's
     * cue can still fire afterwards — there is an orchestrator test on exactly that, because it is
     * a one-line regression waiting to happen.
     *
     * The gate is the brief's own invariant, and it is checked *after* the answer rather than
     * before: **one open Max question at a time per file**. While one is open Ellie's answer simply
     * stands and his question stays open.
     */
    if (
      /**
       * **The follow-up needs a doc to be about.** `rule:max_followup` is a collab-doc rule and
       * it arrives with the collab doc: a room with no notes document (`NO_DOC`) is the old flow,
       * which `collab-doc.md` §9 supersedes as a *surface* and which the lead removes in one
       * commit at the end of this build. Until then it keeps behaving as it did, and that is what
       * this gate buys — one condition rather than thirty rewritten tests asserting a turn the
       * old surface has no column to draw.
       */
      this.#docPort.docId() !== null &&
      followupDue({
        decidedBy: decision.decidedBy,
        pendingQuiz: this.#pendingQuiz,
        mention: this.#lastMention,
        threadKind: anchorId === null ? null : this.#threadKindOf(anchorId),
      })
    ) {
      const target = this.#followupTarget();
      this.#nextQuestionId = this.#d.newId('q');
      await this.#runAgentTurn('promote', { anchorId, followup: { objectiveId: target } });
    }
  }

  /**
   * **Which objective the follow-up is about** (brief §4.2: *"targets an objective the answer
   * touched that the learner has not yet shown, lowest first"*).
   *
   * The pick is the one `+ Try this` already used — lowest ledger level first, deck order as the
   * tie-break (`flow.pickTarget`) — reused rather than reinvented, because two policies for "what
   * should the Tester ask about" is how the two of them come to disagree. What is narrowed here is
   * the pool: the taught set, which is what the answers in this sitting have actually touched.
   */
  #followupTarget(): string | null {
    const levels = Object.fromEntries(this.#ledgerRows().map((r) => [r.element_id, r.level]));
    const taught = latestByElement(this.#taught).map((item) => ({ ...item, ageMs: 0, recency: 1 }));
    const picked = pickTarget(taught, levels);
    if (picked) return picked.elementId;
    // Nothing taught yet in this sitting: fall back to the lowest-level element in the pack, which
    // is the same ordering one step wider.
    const byLevel = [...this.#d.pack.elements].sort((a, b) => (levels[a.id] ?? 0) - (levels[b.id] ?? 0));
    return byLevel[0]?.id ?? null;
  }

  /**
   * **Stop** (audit §2(e); Lucas's decision of 16 Sep 2026).
   *
   * *"Stop appears only after the floor has elapsed"* — while the floor is running the turn is
   * inside the deliberate wait the app exists for, and a learner who can cancel every Tester turn
   * can opt out of the retrieval practice. Once the floor has passed the turn is genuinely
   * generating, and a hung backend must always be escapable. So a stop before the floor is
   * refused here rather than queued, and the renderer should not have offered the button.
   *
   * A stop is **not a failure**: the partial text the learner was already looking at becomes the
   * message, flagged `stopped`, with no card and no Retry.
   */
  stopTurn(turnId: string): StopTurnResult {
    const pending = this.#pending;
    if (!pending || pending.id !== turnId || pending.cancelled) return { stopped: false, refused: 'unknown' };
    if (!pending.floorPassed) {
      this.#turnLog.event('info', 'turn.stop.refused', { reason: 'floor' });
      return { stopped: false, refused: 'floor' };
    }
    if (pending.stopped) return { stopped: true, turnId };
    pending.stopped = true;
    // The client's own abort path: the API request is cancelled, the CLI child is SIGKILLed.
    pending.abort.abort();
    return { stopped: true, turnId };
  }

  /**
   * What a stopped turn leaves behind: whatever was on screen, as a message.
   *
   * Not a failure card, because nothing failed; not a silent drop, because the learner watched
   * several sentences arrive and a thread that then contains none of them is the app deciding
   * their reading did not happen. The silence timer is **held** afterwards for the same reason it
   * is held after an outage — the learner has just told the room to stop talking, and nudging
   * them 45 s later is the app arguing with them. Their next action clears the hold.
   */
  async #dispatchStopped(input: {
    pending: PendingTurn;
    agent: AgentProfile;
    decision: TurnDecision;
    stream: TurnStream;
    anchorId: string | null;
    target: number;
    turnStart: number;
    turnLog: TurnLog;
    generationMs?: number | null;
  }): Promise<void> {
    const { pending, agent, decision, stream, anchorId, target, turnStart, turnLog } = input;
    stream.close();
    const partial = stream.text.trim();
    this.#clearThinking();
    this.#pending = null;
    let messageId: string | null = null;
    if (partial.length > 0) {
      await this.#mailbox.enqueue(() => {
        const row = this.#insertMessage({
          participantId: this.#d.store.participants.byAgentKey(this.#d.roomId, agent.key)!.id,
          body: partial,
          model: agent.model,
          backend: this.#d.llm.kind,
          latencyTargetMs: target,
          ...(stream.firstVisibleAt === null ? {} : { ttftActualMs: stream.firstVisibleAt - turnStart }),
          totalMs: this.#d.clock.now() - turnStart,
          decidedBy: decision.decidedBy,
          // A stopped turn still spent what it spent, and the partial is where it shows.
          turnId: pending.id,
          anchorId,
          stopped: true,
        });
        messageId = row.id;
        this.#d.store.rooms.update(this.#d.roomId, {
          state: 'open',
          pending_turn_id: null,
          pending_turn_due_ts: null,
          last_speaker_id: agent.key,
        });
      });
    } else {
      this.#d.store.rooms.update(this.#d.roomId, { state: 'open', pending_turn_id: null, pending_turn_due_ts: null });
    }
    this.#event(decision.role ?? 'system', 'agent.turn.stopped', {
      turn_id: pending.id,
      // The length of what was kept, never what it said.
      reply_chars: partial.length,
    });
    turnLog.event('info', 'turn.stopped', {
      role: decision.role,
      agent_key: agent.key,
      decided_by: decision.decidedBy,
      reply_chars: partial.length,
      total_ms: this.#d.clock.now() - turnStart,
    });
    this.#trace(pending.id, {
      stopped: true,
      generationMs: input.generationMs ?? null,
      model: agent.model,
      backend: this.#d.llm.kind,
      ttftActualMs: stream.firstVisibleAt !== null ? stream.firstVisibleAt - turnStart : null,
      totalMs: this.#d.clock.now() - turnStart,
    });
    this.#releaseTurn(pending.id, messageId, true);
    this.#nudgesHeldForStop = true;
    this.#armTimer();
  }

  /**
   * **Re-bind the backend without reopening the room** (the bug the 16 Sep live run turned up).
   *
   * `openRoom` returns the already-open actor when the room is the same one, and the client was
   * bound once, at construction. So changing the backend or a model in Settings did nothing until
   * the deck was closed and reopened — which is also why an attempt to force a live failure by
   * pointing Settings at a broken binary never reached the actor at all, and the failed-turn card
   * could only be proved in tests. Same for the roster, which carries the agent model id.
   *
   * It is applied **between** turns, never inside one: `#runAgentTurn` reads the client once and
   * a turn that changed backend halfway through would produce a message whose `backend` column
   * is a lie. A turn in flight keeps the client it started with, which is what the abort is for
   * if the learner does not want to wait for it.
   */
  rebind(next: {
    llm?: LLMClient;
    models?: ModelPlan;
    roster?: AgentProfile[];
    mode?: RoomConfig['mode'];
    replySpeed?: ReplySpeed;
    /**
     * The concept pack, when the background ingest has just drafted one (issue #35). A flow
     * room opens on a `pending` pack so the first Ask is not held behind a 37 s ingest; when
     * the draft lands the material row is rewritten and the actor is rebound onto it, which is
     * what "swapped in at the next turn" means. Every read of the pack in this class goes
     * through `this.#d.pack`, so one assignment is the whole swap.
     */
    pack?: ConceptPack;
  }): void {
    if (next.pack) this.#d.pack = next.pack;
    if (next.llm) this.#d.llm = next.llm;
    if (next.models) this.#d.models = next.models;
    if (next.roster) this.#d.roster = next.roster;
    if (next.mode) this.#d.config = { ...this.#d.config, mode: next.mode };
    if (next.replySpeed) this.#replySpeed = next.replySpeed;
    this.#log.event('info', 'room.rebound', {
      backend: this.#d.llm.kind,
      agent_model: this.#d.roster[0]?.model ?? null,
      orchestrator_model: this.#models.orchestrator,
      mode: this.#d.config.mode,
      reply_speed: this.#replySpeed,
    });
  }

  /** A held reply that the learner spoke over is dropped, logged, and never posted. */
  #cancelTurn(role: AgentProfile['role'] | null, pending: PendingTurn): void {
    this.#event(role ?? 'system', 'agent.turn.error', { cause: 'cancelled_by_student', turn_id: pending.id });
    this.#clearThinking();
    this.#releaseTurn(pending.id, null);
    this.#d.store.rooms.update(this.#d.roomId, { pending_turn_id: null, pending_turn_due_ts: null, state: 'open' });
  }

  /**
   * The silence nudge lands **in the thread the learner was last in**, not at the bottom of a
   * room-level stream nobody is looking at. In the flow there is no single bottom of the page:
   * a nudge posted with no anchor would be written into a transcript that is not on screen, and
   * a nudge nobody can see is worse than no nudge — it burns one of the two fires per round.
   */
  async #runSilenceFill(stage: 1 | 2): Promise<void> {
    this.#silenceFires += 1;
    await this.#runAgentTurn('silence', { silenceStage: stage, anchorId: this.#lastAnchorId });
  }

  async #decide(
    input: Parameters<typeof decideTurn>[0]['input'],
    cue: string,
    turnLog: TurnLog,
    turnStart: number,
  ): Promise<TurnDecision> {
    const peer = agentByRole(this.#d.roster, 'peer');
    const request = buildGroupContext(this.#d.groupStore, {
      roomId: this.#d.roomId,
      speaker: peer,
      roster: this.#d.roster,
      pack: this.#d.pack,
      directive: { agentRole: 'peer', move: 'decide_next_turn' },
      directiveText: decisionDirective(this.#d.roster),
      maxTokens: 400,
    });
    request.model = this.#models.orchestrator;
    request.meta = {
      ...request.meta,
      scope: 'orchestrator',
      scriptCue: cue,
      turnId: this.#pending?.id,
      anchorId: this.#pending?.anchorId ?? null,
    };
    const startedAt = this.#d.clock.now();
    turnLog.event('info', 'orchestrator.request', {
      model: request.model,
      backend: this.#d.llm.kind,
      trigger: input.trigger,
      anchored: input.anchoredThread === true,
    });
    const decision = await decideTurn({ client: this.#d.llm, request, input });
    /**
     * The line that would have made 2026-09-16 a five-minute diagnosis. `parsed_ok` and
     * `chosen_role` together are the whole bug: a decision with a move, a rationale and no
     * speaker. `ms` is the 20 s.
     */
    turnLog.event(decision.failure ? 'error' : 'info', 'orchestrator.response', {
      model: request.model,
      backend: this.#d.llm.kind,
      ms: this.#d.clock.now() - startedAt,
      since_turn_start_ms: this.#d.clock.now() - turnStart,
      parsed_ok: decision.failure === null,
      decided_by: decision.decidedBy,
      speak: decision.speak,
      chosen_role: decision.role,
      move_type: decision.moveType,
      target_element_id: decision.targetElementId,
      failure: decision.failure?.reason ?? null,
    });
    return decision;
  }

  async #generate(
    agent: AgentProfile,
    decision: TurnDecision,
    cue: string,
    onDelta?: (text: string) => void,
    signal?: AbortSignal,
  ) {
    // Stage-1 fills are never generated against the concept (product-design.md §C5).
    if (decision.moveType === 'content_free_nudge') {
      const pool = CONTENT_FREE_NUDGES;
      // A random *draw* repeats; on 2026-09-16 the learner got "Take your time…" twice running,
      // which reads as a stuck app rather than as a patient one. Random start, then rotate.
      if (this.#nudgeCursor < 0) this.#nudgeCursor = Math.floor(this.#rand() * pool.length);
      else this.#nudgeCursor = (this.#nudgeCursor + 1) % pool.length;
      const line = pool[this.#nudgeCursor] ?? pool[0]!;
      // Through the same pump as a generated turn: a nudge that appears by a different mechanism
      // than every other message is a nudge that looks different, and §C5 already makes it look
      // different enough.
      onDelta?.(line);
      return { text: line, model: 'pool:content_free', usage: {}, ttftMs: 0, backend: undefined };
    }
    const request = buildGroupContext(this.#d.groupStore, {
      roomId: this.#d.roomId,
      speaker: agent,
      roster: this.#d.roster,
      pack: this.#d.pack,
      directive: {
        agentRole: agent.role,
        move: decision.moveType,
        probeType: decision.probeType ?? undefined,
        targetElementId: decision.targetElementId ?? undefined,
        note: this.#turnNote(decision),
        // One move, three causes (#47): only the withheld-answer hint owes the "one try unlocks it"
        // clause, and the rule name is what tells them apart.
        byRule: decision.decidedBy,
      },
    });
    request.meta.scriptCue = cue;
    /**
     * **What the prefix carried, per call** (issue #35 item 4). The reply's prompt is the frozen
     * room prefix, which since the whole-deck fix holds the entire document rather than the
     * first 6,000 characters of it — and the one number that says whether that is true on a
     * given turn is the size of `system[0]`. `llm.request` logs `system_chars` for every scope;
     * this says what those characters *are*, in the same vocabulary the REFERENCE path uses,
     * so `jq 'select(.event=="context.built")'` answers the question for both paths at once.
     */
    this.#log.event('info', 'context.built', {
      scope: 'group',
      chars: request.system.reduce((n, b) => n + b.text.length, 0),
      material_chars: this.#d.store.materials.get(this.#room().material_id)?.extracted_text.length ?? 0,
      pages: null,
      strategy: 'prefix',
      cache_breakpoints: request.system.filter((b) => b.cache_control).length,
    });
    // The agent's own generation belongs to the turn too: without this its `llm.request` /
    // `llm.complete` pair carried no correlation id and fell out of `jq 'select(.turn==…)'`,
    // which is the one query the log exists to answer.
    request.meta.turnId = this.#pending?.id;
    request.meta.anchorId = this.#pending?.anchorId ?? null;

    /**
     * **Ellie's cue is a structured call** (#48 §4.3, architect §E6).
     *
     * *"Ellie's cue may contain a plausible mistake"* is a prompt request, and §4.7 requires the
     * resolving turn to correct it — so whether she planted one, and what the claim was, have to
     * be **facts** the closure rule can check rather than prose a model was asked to self-report
     * in. Asking for them as fields is the same discipline as everywhere else here: the rules
     * decide, the model writes the words.
     *
     * It does not stream. A schema-bound reply is a JSON object, and chunking one into the
     * renderer would put `{"text":"I think` on screen; a 60-word turn loses nothing by arriving
     * whole, and it goes out through the same pump as one delta so the dispatch path is unchanged.
     */
    if (decision.moveType === 'peer_guess') {
      request.jsonSchema = ELLIE_CUE_SCHEMA;
      const result = await this.#d.llm.complete(request, undefined, signal);
      const cue = parseCue(result.text);
      this.#pendingCue = { hasMistake: cue.hasMistake, claim: cue.claim };
      onDelta?.(cue.text);
      return { ...result, text: cue.text };
    }
    return this.#d.llm.complete(request, onDelta, signal);
  }

  async #updateLedger(cue: string, turnStart: number, fallbackCue?: string): Promise<void> {
    const turnLog = this.#turnLog;
    const messages = this.#d.store.messages.forRoom(this.#d.roomId);
    const participants = new Map(this.#d.store.participants.forRoom(this.#d.roomId).map((p) => [p.id, p]));
    const studentMessages = messages
      .filter((m) => participants.get(m.participant_id)?.kind === 'student')
      .map((m) => ({ id: m.id, seq: m.seq, body: m.body }));
    const trigger = studentMessages.at(-1);
    if (!trigger) return;

    const peer = agentByRole(this.#d.roster, 'peer');
    const request = buildGroupContext(this.#d.groupStore, {
      roomId: this.#d.roomId,
      speaker: peer,
      roster: this.#d.roster,
      pack: this.#d.pack,
      directive: { agentRole: 'peer', move: 'ledger_update' },
      directiveText: ledgerDirective({
        conceptId: this.#d.pack.concept_id,
        messageId: trigger.id,
        elementIds: this.#d.pack.elements.map((e) => e.id),
      }),
      maxTokens: 900,
    });
    /**
     * **Not a turn, and no longer prompted or priced as one** (issue #35 item 5b).
     *
     * `buildGroupContext` gave this call the frozen room prefix — house rules, safeguards, the
     * concept pack and the learner's *whole document* — plus Ellie's role block: 15,090 system
     * characters, measured, for a call that does not speak and is judging four sentences. The
     * message stream is kept, because it is the transcript and there must be exactly one
     * builder of it (and one whisper invariant); the system block is replaced with the rubric.
     *
     * And it runs on `models.fast`, not on the orchestrator: 17.2 s and 9.8 s on Sonnet, all of
     * it reasoning tokens, for a glyph nobody is waiting to read. See `ModelPlan.fast`.
     */
    request.system = [{ type: 'text', text: ledgerSystemBlock(this.#d.pack), cache_control: { type: 'ephemeral' } }];
    request.model = this.#models.fast;
    request.meta = {
      ...request.meta,
      scope: 'ledger',
      scriptCue: cue,
      // Scripted replay only, and only on a feedback turn — see the call site (#47 §2.3).
      ...(fallbackCue === undefined ? {} : { scriptCueFallback: fallbackCue }),
      anchorId: this.#pending?.anchorId ?? null,
    };
    // Structured output, for the same reason the decision uses it: the CLI enforces the schema
    // and repairs one bad answer before the caller ever sees it (`claude-cli.ts`).
    request.jsonSchema = LEDGER_SCHEMA;
    request.meta.turnId = this.#pending?.id;
    const ledgerStartedAt = this.#d.clock.now();
    turnLog.event('info', 'ledger.request', {
      model: request.model,
      backend: this.#d.llm.kind,
      elements: this.#d.pack.elements.length,
      student_messages: studentMessages.length,
    });

    let proposal: LedgerProposal;
    try {
      const result = await this.#d.llm.complete(request);
      // Same unwrapper as the decision path: a model that wraps the object in prose under a
      // schema is a known shape, and it is not a reason to throw the turn's progress away.
      proposal = JSON.parse(extractJsonObject(result.text)) as LedgerProposal;
    } catch (err) {
      // The chat never blocks on the ledger (progress-tracking.md §4.6) — but a rail that
      // silently stopped moving is a lie about the learner's progress, so it says so. This is
      // the `progress.update {"parse_ok":false}` of 2026-09-16 02:30:38, which until now was
      // visible only in the events table.
      this.#event('system', 'progress.update', { parse_ok: false, cause: (err as Error).message });
      turnLog.event('error', 'ledger.error', {
        model: request.model,
        backend: this.#d.llm.kind,
        ms: this.#d.clock.now() - ledgerStartedAt,
        parse_ok: false,
        cause: failureReason(err),
      });
      this.#failTurn({
        kind: 'ledger',
        anchorId: this.#lastAnchorId,
        displayName: null,
        reason: failureReason(err),
        detail: (err as Error).message,
        replay: null,
      });
      return;
    }

    const current = this.#ledgerRows();
    const applied = applyLedgerRules({
      proposal,
      current,
      studentMessages,
      triggerMessage: trigger,
      challengedElementIds: this.#challenged,
      defenceLabel: (elementId) => this.#defenceLabel(elementId),
      now: this.#nowIso(),
    });

    this.#d.store.transaction(() => {
      for (const row of applied.rows) this.#d.store.ledger.upsert(row);
      for (const h of applied.history) this.#d.store.ledger.appendHistory({ ...h, session_id: this.#d.sessionId });
    });
    // §4: the same move, mirrored onto the file's objective states with the learner's own
    // message ids as its evidence. After the rules, never instead of them.
    this.#d.onLedgerApplied?.({ rows: applied.rows, changed: applied.changed });
    this.#event('system', 'progress.update', {
      changed: applied.changed,
      skipped: applied.skipped,
      gates: applied.history.map((h) => h.gate).filter(Boolean),
      inside_hold_ms: this.#d.clock.now() - turnStart,
    });
    turnLog.event('info', 'ledger.applied', {
      model: request.model,
      backend: this.#d.llm.kind,
      ms: this.#d.clock.now() - ledgerStartedAt,
      parse_ok: true,
      proposed: proposal.elements?.length ?? 0,
      changed: applied.changed.length,
      // Which of the four hard rules fired. The ids only — never the quote they tested.
      gates: applied.history.map((h) => h.gate).filter(Boolean).join(','),
      skipped: applied.skipped,
      inside_hold_ms: this.#d.clock.now() - turnStart,
    });

    // The rail animates while the next agent is still thinking: acknowledged, then pressed.
    this.#d.transport.emit({
      type: 'ledger.updated',
      roomId: this.#d.roomId,
      ledger: ledgerView(applied.rows, this.#d.pack),
      changed: applied.changed,
    });
  }

  /**
   * Which segment threads are still locked to Ellie and Max, and by which REFERENCE card.
   *
   * The flow renders that as the two buttons — **Explain it back →** and **✕ Remove** — instead
   * of a composer, so the state the actor enforces and the state the learner sees are the same
   * state. `reference.ts` property 4 is the authority; this is its read-only projection.
   */
  lockedAnchors(): Map<string, string> {
    const locked = new Map<string, string>();
    for (const a of this.#answers) {
      if (a.anchorId !== null && a.explainedBackAt === null) locked.set(a.anchorId, a.answerId);
    }
    return locked;
  }

  // ── unread and per-card state (audit §7) ─────────────────────────────────
  /**
   * The highest `seq` the learner has seen in each thread, and each card's `collapsed` /
   * `removed`.
   *
   * Both live here rather than in the renderer because both are answers to *"what did I already
   * deal with?"*, and a reopened deck that brings back a dismissed card and hides a reply the
   * learner never read is the app forgetting on their behalf. They ride out with
   * `flowSnapshot()`, in the settings row the sitting already uses.
   */
  markSeen(anchorId: string, seq: number): void {
    this.#seen.set(anchorId, Math.max(this.#seen.get(anchorId) ?? 0, seq));
  }

  setCardState(anchorId: string, patch: { collapsed?: boolean; removed?: boolean }): void {
    const next = { ...(this.#cards.get(anchorId) ?? {}) };
    if (patch.collapsed !== undefined) next.collapsed = patch.collapsed;
    if (patch.removed !== undefined) next.removed = patch.removed;
    this.#cards.set(anchorId, next);
  }

  /**
   * One turn's timings, or the whole ring. Read by `flow:turnTrace` for the ⌥⌘D drawer, which is
   * what makes every latency claim in the audit measurable rather than argued.
   */
  turnTrace(turnId?: string | null): TurnTraceView[] {
    return turnId ? this.#traces.filter((t) => t.turnId === turnId) : [...this.#traces];
  }

  #trace(turnId: string, patch: Partial<TurnTraceView>): void {
    const existing = this.#traces.find((t) => t.turnId === turnId);
    if (existing) {
      Object.assign(existing, patch);
      return;
    }
    this.#traces.push({
      turnId,
      roomId: this.#d.roomId,
      anchorId: null,
      trigger: 'student_message',
      startedAt: this.#nowIso(),
      decidedBy: null,
      role: null,
      moveType: null,
      model: null,
      backend: null,
      decisionMs: null,
      generationMs: null,
      ttftActualMs: null,
      latencyTargetMs: null,
      totalMs: null,
      usage: {},
      stopped: false,
      failed: null,
      ...patch,
    });
    if (this.#traces.length > 50) this.#traces.shift();
  }

  seenSnapshot(): Record<string, number> {
    return Object.fromEntries(this.#seen);
  }

  cardStateSnapshot(): Record<string, { collapsed?: boolean; removed?: boolean }> {
    return Object.fromEntries(this.#cards);
  }

  /** What the caller must persist to make the sitting survive a quit. */
  flowSnapshot(): {
    session: FlowSession | null;
    taught: TaughtItem[];
    pendingQuiz: PendingQuiz | null;
    answers: ReferenceAnswerState[];
    seen: Record<string, number>;
    cards: Record<string, { collapsed?: boolean; removed?: boolean }>;
    objectives: Record<string, string>;
    pitch: PitchState;
    offeredSummary: string[];
  } {
    return {
      session: this.#flow,
      taught: [...this.#taught],
      pendingQuiz: this.#pendingQuiz,
      answers: [...this.#answers],
      seen: this.seenSnapshot(),
      cards: this.cardStateSnapshot(),
      // A thread opened from a node keeps its tag across a quit: the next message the learner
      // writes in it is about the same objective the deck was reopened on.
      objectives: Object.fromEntries(this.#objectiveByAnchor),
      // "Simpler", said once, on this file (#41). It outlives the sitting because the learner does.
      pitch: this.#pitch,
      offeredSummary: [...this.#offeredSummary],
    };
  }

  // ── the flow session (#33) ────────────────────────────────────────────────

  /**
   * Opens the flow session on the first learner-authored action, or extends the open one.
   * Typing is activity, exactly as it is for the silence timer (`design-brief.md` §D3): the two
   * clocks must agree about what "still here" means or one of them will close on a learner who
   * is mid-sentence.
   */
  #noteLearnerActivity(kind: 'turn' | 'keystroke' | 'ask' | 'whisper' | 'scroll', anchorId?: string | null): void {
    // Any learner act ends the outage hold; the cards in *this* thread go with it, because the
    // learner has moved past the turn that failed and a stale Retry is worse than none.
    if (kind === 'turn' || kind === 'ask') this.#clearFailureHold(anchorId ?? null);
    const now = this.#d.clock.now();
    if (this.#flow) this.#flow = tickSession(this.#flow, now);
    if (!this.#flow || this.#flow.closedAt !== null) {
      this.#flow = openSession(
        { id: this.#d.newId('fs'), documentId: this.#d.roomId, anchorId, profile: this.#d.flowProfile ?? FLOW },
        now,
      );
      this.#event('student', 'session.start', {
        flow: 'session.open',
        session_id: this.#flow.id,
        trigger: kind,
        profile: this.#flow.profile.name,
      });
    }
    this.#flow = noteActivity(this.#flow, { kind, anchorId }, now);
    if (anchorId !== undefined && anchorId !== null) this.#lastAnchorId = anchorId;
  }

  /**
   * What the Teacher has taught, and what the learner has evidenced, with `taught_at`.
   *
   * `taught_at` is **derived, not a new column** (flow-session.md §10): the ledger already
   * stores `evidence_msg_id` per element and message rows carry timestamps. A re-teach appends
   * rather than resetting, and `flow.quizzable` reads the most recent (§12 q. 7).
   */
  #noteTurnForFlow(decision: TurnDecision, messageId: string, text = ''): void {
    const now = this.#d.clock.now();
    if (decision.role === 'peer' && decision.targetElementId) {
      this.#taught.push({
        elementId: decision.targetElementId,
        taughtAt: now,
        by: 'teacher',
        sessionId: this.#flow?.id,
        label: this.#learnerLabel(decision.targetElementId),
        ...(this.#orderOf(decision.targetElementId) !== null ? { order: this.#orderOf(decision.targetElementId)! } : {}),
      });
      // The panel's `taughtAt` (#38 §4), so a node the learner has been taught is quizzable in
      // the next sitting too and `taughtBlock` and the tree read the same fact.
      this.#d.onTaught?.({ elementId: decision.targetElementId, at: this.#nowIso() });
    }
    if (decision.moveType === 'quiz' && decision.targetElementId) {
      /**
       * **The question's own id** (#48). Minted here, once, and shared by three things that must
       * agree about which question they mean: the doc's `q_block` (brief §5.2), the `resolve_q`
       * that closes it (§5.3), and every `quiz_outcomes` row filed under it (§6). Deriving it from
       * the message id instead would tie the Q block's life to a message row's thread, which is
       * the coupling architect §A.4 warns against.
       */
      this.#pendingQuiz = openQuiz(
        {
          quizMessageId: messageId,
          elementId: decision.targetElementId,
          questionId: this.#nextQuestionId ?? this.#d.newId('q'),
          objectiveId: this.#objectiveOf(decision.targetElementId),
          anchorId: this.#turnAnchorId,
        },
        now,
      );
      this.#nextQuestionId = null;
      // The list the next question prompt reads, so a session cannot circle (findings.md §6).
      this.#questionsAsked = [...this.#questionsAsked, text.trim()].filter((q) => q.length > 0).slice(-8);
      this.#emitThread(this.#turnAnchorId);
    }
    if (decision.moveType === 'quiz_feedback' && this.#pendingQuiz) {
      // Rowland 2014's constraint is discharged only when the feedback turn actually landed. It is
      // per *attempt* since #47: a second attempt re-opens it (`flow.answerQuiz`).
      // And the turn's first line is read once, for the verdict (`flow.feedbackVerdict`): it is
      // what tells the composer to ask for the next attempt or to say the question is done.
      const answered = this.#pendingQuiz.answerMessageId;
      this.#pendingQuiz = markFeedbackGiven(this.#pendingQuiz, feedbackVerdict(text), feedbackVerdict3(text));
      /**
       * **One outcome row per verdict** (#48, brief §6). The progress bar is a pure function of
       * these (`shared/doc/progress.progressFill`), which is the whole reason they exist as rows
       * rather than as a second copy of the ledger's level: *Well done* completes an objective,
       * *Partly there* half-fills it, *Not yet* and every release fill nothing — and that is three
       * values the ledger's four levels cannot express without being re-interpreted twice.
       */
      this.#recordOutcome({
        kind: 'verdict',
        verdict: verdict3Of(this.#pendingQuiz),
        releasedBy: null,
        messageId: answered,
        source: this.#docTextTarget !== null ? 'doc_text' : 'chat',
      });
      this.#emitThread(this.#anchorOfQuiz(this.#pendingQuiz));
    }
    /**
     * **The released answer closes the question** (#48 §4.4), and closes it only once it has
     * actually landed — the same discipline as the feedback flag above. After this `quizOpen` is
     * false, so none of the rules above can fire again on this question and Pass goes away.
     */
    if (decision.moveType === 'quiz_answer' && this.#pendingQuiz) {
      const releasedBy = this.#releaseBy ?? 'give_up';
      this.#pendingQuiz = markAnswerShown(this.#pendingQuiz, releasedBy);
      this.#releaseBy = null;
      // §4.4: "It fills no progress." The row is still written, because a question the learner
      // never answered is evidence about the *teaching*, and §4.5's pitch reads it.
      this.#recordOutcome({ kind: 'released', verdict: null, releasedBy, messageId: null, source: 'chat' });
      this.#emitThread(this.#anchorOfQuiz(this.#pendingQuiz));
    }
    /**
     * **Ellie's cue, recorded as a fact** (#48 §4.3, §4.7, architect §E6). `#pendingCue` is what
     * the structured call reported about itself; putting it on the question is what lets the
     * closure rule check that a mistake she made was corrected, however long afterwards.
     */
    if (decision.moveType === 'peer_guess' && this.#pendingQuiz) {
      const reported = this.#pendingCue;
      this.#cueText = text;
      this.#pendingQuiz = markCueGiven(this.#pendingQuiz, {
        at: now,
        hasMistake: reported?.hasMistake === true,
        claim: reported?.claim ?? null,
      });
      this.#pendingCue = null;
      this.#event('peer', 'quiz.cue_given', {
        element_id: decision.targetElementId,
        has_mistake: reported?.hasMistake === true,
        // The claim itself is learner-visible content and never goes to the log.
        words: wordCount(text),
      });
      this.#emitThread(this.#anchorOfQuiz(this.#pendingQuiz));
    }
  }

  /**
   * **The learner asked to start this deck again** (issue #38 §4's Reset).
   *
   * The taught set is what the Tester may quiz from, and it is derived from what has been taught
   * *and evidenced*. A reset that cleared the record but left the taught set would have Max
   * quizzing a learner about progress the app has just agreed to forget. The flow session itself
   * is untouched: the sitting is still the same sitting.
   */
  resetTaught(): void {
    this.#taught = [];
    this.#pendingQuiz = null;
    /**
     * **The pitch goes with it** (#41). Reset is the learner saying *forget what you think you
     * know about me on this file*; a remembered "explain it simpler" is exactly that, so keeping
     * it would be the app agreeing to forget the evidence and keeping the inference drawn from it.
     */
    this.#pitch = DEFAULT_PITCH;
  }

  // ── the collab doc's threads, outcomes and edits (#48) ───────────────────

  /**
   * **A thread id IS an anchor id** (architect §A.4). `'doc'` is the doc chat, `'deck'` is its
   * alias in rooms opened before this build, `span_<12 hex>` is a Ctrl+E thread, and a private
   * thread's key is its whisper thread id. Registering one is idempotent and costs nothing, which
   * is why it happens on every path that can be the first message in a thread.
   */
  #registerThread(
    anchorId: string | null,
    kind: ThreadKind,
    extra: { blockId?: string | null; quote?: string | null; agentKey?: AgentAuthor | null } = {},
  ): void {
    if (anchorId === null) return;
    const existing = this.#threads.get(anchorId);
    this.#threads.set(anchorId, {
      kind,
      blockId: extra.blockId ?? existing?.blockId ?? null,
      quote: extra.quote ?? existing?.quote ?? null,
      agentKey: extra.agentKey ?? existing?.agentKey ?? null,
      createdAt: existing?.createdAt ?? this.#nowIso(),
    });
    if (existing === undefined) this.#emitThread(anchorId);
  }

  /**
   * Which channel an anchor belongs to. Read from the id rather than from the registry where the
   * id says so, because a room reopened from the database has messages whose threads were never
   * registered in this actor's lifetime — and a span thread that came back as `doc` would put
   * Ctrl+E's question in the wrong column.
   */
  #threadKindOf(anchorId: string): ThreadKind {
    const known = this.#threads.get(anchorId);
    if (known) return known.kind;
    if (anchorId.startsWith(SPAN_THREAD_PREFIX)) return 'span';
    // `'doc'` is the collab doc's chat and `'deck'` is what the same thread was called before it
    // (`shared/scope.ts`'s `DECK_ANCHOR_ID`). Both are the doc chat; a room recorded under the old
    // name keeps its messages where they are rather than being migrated to a new id.
    if (anchorId === DOC_ANCHOR_ID || anchorId === DECK_ANCHOR_ID) return 'doc';
    return 'doc';
  }

  /**
   * **The threads the actor knows about, with their quiz state** (brief §4.1; T6 merges this with
   * its own registry on `chat:threads`).
   *
   * The quiz travels on the thread rather than on a whole-room view, which is what retires the
   * renderer's `refreshFlowQuiz` poll (architect §D10): with three chat columns a poll on every
   * `turn.released` is three reads of everything to notice one change.
   */
  docThreads(): ThreadView[] {
    const messages = this.#d.store.messages.forRoom(this.#d.roomId);
    const byAnchor = new Map<string, string[]>();
    for (const m of messages.slice().sort((a, b) => a.seq - b.seq)) {
      const anchor = m.anchor_id;
      if (anchor === null) continue;
      const list = byAnchor.get(anchor) ?? [];
      list.push(m.id);
      byAnchor.set(anchor, list);
    }
    const anchors = new Set<string>([...this.#threads.keys(), ...byAnchor.keys()]);
    const quizAnchor = this.#pendingQuiz === null ? null : this.#anchorOfQuiz(this.#pendingQuiz);
    const views: ThreadView[] = [];
    for (const anchorId of anchors) {
      const reg = this.#threads.get(anchorId);
      const kind = reg?.kind ?? this.#threadKindOf(anchorId);
      views.push({
        threadId: anchorId,
        kind,
        blockId: reg?.blockId ?? null,
        quote: reg?.quote ?? null,
        agentKey: reg?.agentKey ?? null,
        // A private thread's turns live in `whispers`, not in `messages` (brief §4.1), so it
        // never carries message ids — which is also the shape that makes a leak impossible here.
        messageIds: kind === 'private' ? [] : (byAnchor.get(anchorId) ?? []),
        lastSeenSeq: this.#seen.get(anchorId) ?? 0,
        quiz: anchorId === quizAnchor ? this.#docQuizView() : null,
        createdAt: reg?.createdAt ?? this.#nowIso(),
      });
    }
    return views;
  }

  /** `FlowQuizView` plus what the collab doc adds: the question id, the cue, the resolution. */
  #docQuizView(): DocQuizView | null {
    const quiz = this.#pendingQuiz;
    if (quiz === null) return null;
    return {
      quizMessageId: quiz.quizMessageId,
      elementId: quiz.elementId,
      attempts: attemptsOf(quiz),
      feedbackGiven: quiz.feedbackGiven === true,
      answerShown: quiz.answerShown === true,
      verdict: verdictOf(quiz),
      questionId: quiz.questionId ?? quiz.quizMessageId,
      objectiveId: quiz.objectiveId ?? null,
      cueGiven: cueGiven(quiz),
      resolution: qResolutionOf(quiz),
      open: quizOpen(quiz),
    };
  }

  /**
   * **`chat.thread`, whenever a thread is created or its quiz state changes** (architect §D10).
   * Cheap, idempotent, and emitted from exactly the places that can change either fact.
   */
  #emitThread(anchorId: string | null): void {
    if (anchorId === null) return;
    const view = this.docThreads().find((t) => t.threadId === anchorId);
    if (!view) return;
    this.#d.transport.emit({ type: 'chat.thread', roomId: this.#d.roomId, thread: view });
  }

  /**
   * One resolved question, as a row. Written through the port so the durable copy is main's, and
   * kept in memory so `pitchInputs` does not need a round trip mid-turn.
   */
  #recordOutcome(input: {
    kind: 'verdict' | 'released';
    verdict: QuizVerdict3 | null;
    releasedBy: 'give_up' | 'pass' | 'closure' | null;
    messageId: string | null;
    source: 'chat' | 'doc_text';
  }): void {
    const quiz = this.#pendingQuiz;
    if (quiz === null) return;
    const outcome: Omit<QuizOutcome, 'id' | 'contentSha' | 'createdAt'> = {
      roomId: this.#d.roomId,
      objectiveId: quiz.objectiveId ?? null,
      questionId: quiz.questionId ?? quiz.quizMessageId,
      kind: input.kind,
      verdict: input.verdict,
      releasedBy: input.releasedBy,
      messageId: input.messageId,
      source: input.source,
    };
    this.#outcomes.push({ ...outcome, id: this.#d.newId('qo'), contentSha: '', createdAt: this.#nowIso() });
    try {
      this.#docPort.recordOutcome(outcome);
    } catch (err) {
      // The conversation never blocks on the document (§5, and the ledger's own rule §4.6).
      this.#turnLog.event('error', 'doc.outcome.error', { cause: failureReason(err) });
    }
  }

  /**
   * **The script cue for one turn** (#47's `quizCue`, extended by #48's beats).
   *
   * Every turn that belongs to Tester question *N* carries `:N`, so `script.notes.ts` can hold a
   * whole loop — answer, follow-up, attempt, feedback, cue, prompt, give-up, release — as named
   * beats, and a second question's feedback can never be played against the first.
   */
  #cueFor(decision: TurnDecision, fallback: string): string {
    const n = this.#testerQuestions;
    switch (decision.decidedBy) {
      case 'rule:handoff':
        return quizCue('handoff', n);
      case 'rule:try_here':
        return quizCue('try', n);
      case 'rule:max_followup':
        return quizCue('followup', n);
      case 'rule:ellie_cue':
        return quizCue('cue', n);
      case 'rule:max_prompt':
        return quizCue('prompt', n);
      case 'rule:closure':
        return quizCue('closure', n);
      case 'rule:answer_released':
        return quizCue('release', n);
      case 'rule:lesson_start':
        return `lesson:${n + 1}`;
      default:
        break;
    }
    switch (decision.moveType) {
      case 'quiz_feedback':
        return this.#docTextTarget !== null ? quizCue('doctext', n) : quizCue('feedback', n);
      case 'quiz_hint':
        return quizCue('hint', n);
      case 'quiz_clarify':
        return quizCue('clarify', n);
      case 'quiz_answer':
        return quizCue('answer', n);
      default:
        return fallback;
    }
  }

  /** Everything `docedit.ts` needs to bill and address a call. */
  #docEditDeps(anchorId: string | null, turnId: string | null): DocEditDeps {
    return {
      llm: this.#d.llm,
      docPort: this.#docPort,
      // `models.orchestrator`, as every schema-bound call in this app does: `fast` deliberately
      // resolves to the same model, because Haiku emits 2–4× the output tokens on a schema and is
      // *slower* for it (`llm/models.ts`'s measured table).
      model: this.#models.orchestrator,
      newId: this.#d.newId,
      roomId: this.#d.roomId,
      fileId: this.#d.store.materials.get(this.#room().material_id)?.file_id ?? null,
      anchorId,
      turnId,
    };
  }

  /**
   * **Record it, then emit it** (brief §5, architect §B.5).
   *
   * `recordEdit` comes first and deliberately: an edit the renderer never reports back on is still
   * in the log, which is the only way "every agent edit can be removed in one click" can be true
   * after a crash. The cursor moves before the edit so the learner sees *who* is about to write
   * where, which is §5's "typed in at reading speed with the cursor, not pasted".
   *
   * Returns whether anything was emitted. **Nothing in here may throw**: a doc-edit failure is not
   * a turn failure (§5, and the ledger's own rule in `progress-tracking.md` §4.6 — the
   * conversation never blocks on the artefact beside it).
   */
  async #emitDocEdit(
    batch: AgentDocOpBatch | null,
    meta: { objectiveId: string | null; messageId: string | null; turnId: string | null },
  ): Promise<boolean> {
    if (batch === null) return false;
    const docId = this.#docPort.docId();
    // §3's Freeze: *"Edits that would have happened are dropped, not queued."* Checked here as
    // well as in the renderer (architect §D4) — in both, because a queue in main is the easy
    // mistake and it makes Freeze a delay rather than a refusal.
    if (docId === null || this.#docPort.frozen()) return false;
    try {
      this.#d.transport.emit({
        type: 'doc.cursor',
        roomId: this.#d.roomId,
        docId,
        author: batch.author,
        blockId: batch.focusBlockId,
        state: 'thinking',
      });
      this.#docPort.recordEdit({
        batch,
        roomId: this.#d.roomId,
        turnId: meta.turnId,
        messageId: meta.messageId,
        objectiveId: meta.objectiveId,
      });
      this.#d.transport.emit({
        type: 'doc.cursor',
        roomId: this.#d.roomId,
        docId,
        author: batch.author,
        blockId: batch.focusBlockId,
        state: 'typing',
      });
      this.#d.transport.emit({ type: 'doc.edit', roomId: this.#d.roomId, docId, batch });
      this.#event(batch.author === 'max' ? 'challenger' : 'peer', 'doc.edit', {
        edit_id: batch.editId,
        cause: batch.cause,
        ops: batch.ops.map((o) => o.op),
        suggestion: batch.suggestion !== undefined,
      });
      return true;
    } catch (err) {
      this.#turnLog.event('error', 'doc.edit.error', { cause: failureReason(err), edit_id: batch.editId });
      return false;
    }
  }

  /**
   * **The edit that goes with a turn** (brief §5.1–5.3), run **beside** the turn and never inside
   * it: the reply has already been released by the time this starts, and nothing here can delay,
   * fail or cancel it.
   *
   * Two turns deliberately produce no edit. **Ellie's cue** — §4.3 is explicit: *"It is never
   * written to the doc"*, because a guess that may contain a plausible mistake is the one thing
   * that must not become durable notes. And **every private turn**, which is §4.1's whole boundary.
   */
  async #maybeDocEdit(decision: TurnDecision, text: string, messageId: string, turnId: string, anchorId: string | null): Promise<void> {
    if (this.#docPort.docId() === null || this.#docPort.frozen()) return;
    if (decision.moveType === 'peer_guess' || decision.moveType === 'max_prompt') return;
    const deps = this.#docEditDeps(anchorId, turnId);
    const blockId = anchorId === null ? null : (this.#threads.get(anchorId)?.blockId ?? null);
    const quiz = this.#pendingQuiz;
    try {
      // 5.2 — Max asked a question: it goes in as a Q block at the segment it is about.
      if (decision.moveType === 'quiz' && quiz !== null) {
        await this.#emitDocEdit(
          buildQuestionEdit(deps, {
            questionId: quiz.questionId ?? quiz.quizMessageId,
            objectiveId: quiz.objectiveId ?? null,
            text,
            blockId,
          }),
          { objectiveId: quiz.objectiveId ?? null, messageId, turnId },
        );
        return;
      }
      /**
       * **§6 — the one place a suggestion arises naturally.** The learner wrote in the doc, Max
       * marked it, and their own words are wrong. Everything else an agent wants to change is
       * worked around; this is the case where the correct edit *is* an edit to learner text, so
       * it is offered as Accept · Reject with their wording struck through rather than replaced.
       */
      const docText = this.#docTextTarget;
      if (docText !== null && decision.moveType === 'quiz_feedback') {
        await this.#emitDocEdit(
          await planSuggestionEdit(deps, {
            blockId: docText.blockId,
            text: docText.text,
            feedback: text,
            threadId: docText.anchorId,
          }),
          { objectiveId: quiz?.objectiveId ?? null, messageId, turnId },
        );
        // …and the Q block still resolves below, because the answer was still an answer.
      }
      // 5.3 — a Max question resolved: his correct version goes under the Q block, tagged.
      const resolution = qResolutionOf(quiz);
      if (
        quiz !== null &&
        resolution !== null &&
        (decision.moveType === 'quiz_answer' || decision.moveType === 'quiz_feedback')
      ) {
        await this.#emitDocEdit(
          buildResolveEdit(deps, {
            questionId: quiz.questionId ?? quiz.quizMessageId,
            resolution,
            text,
          }),
          { objectiveId: quiz.objectiveId ?? null, messageId, turnId },
        );
        return;
      }
      // 5.1 — Ellie answered, and the notes may be missing it. The one model call in here.
      if (decision.role === 'peer' && (decision.moveType === 'answer_then_teach' || decision.moveType === 'lesson_start')) {
        const pages = this.#askContext.get(anchorId ?? '')?.page;
        const outline = this.#docPort.outlineNear({
          blockId,
          pages: typeof pages === 'number' ? [pages] : undefined,
        });
        const { batch, pointsTo } = await planAnswerEdit(deps, {
          answer: text,
          blockId,
          outline,
          // The learner highlighted this span and asked about it: the answer goes beside it, not
          // wherever the planner finds tidier (`findings.md` §6).
          pinAnchor: anchorId !== null && this.#threadKindOf(anchorId) === 'span' && blockId !== null,
        });
        if (batch === null) {
          // §5.1: "If the doc already says it, no edit; she points to the block instead."
          if (pointsTo !== null) {
            this.#d.transport.emit({
              type: 'doc.cursor',
              roomId: this.#d.roomId,
              docId: this.#docPort.docId()!,
              author: 'ellie',
              blockId: pointsTo,
              state: 'idle',
            });
          }
          return;
        }
        await this.#emitDocEdit(batch, { objectiveId: null, messageId, turnId });
      }
    } catch (err) {
      this.#turnLog.event('error', 'doc.edit.error', { cause: failureReason(err), move: decision.moveType });
    }
  }

  /** Which door a release came through, for the event log and for `markAnswerShown`. */
  #releaseReason(decision: TurnDecision, opts: { showAnswer?: boolean }): 'give_up' | 'pass' | 'closure' {
    if (decision.decidedBy === 'rule:closure') return 'closure';
    return opts.showAnswer === true ? 'pass' : 'give_up';
  }

  /** The objective a ledger element belongs to. They share one id space (`objectives/pack.ts`). */
  #objectiveOf(elementId: string | null): string | null {
    if (elementId === null) return null;
    return this.#d.pack.elements.some((e) => e.id === elementId) ? elementId : null;
  }

  #learnerLabel(elementId: string): string {
    const element = this.#d.pack.elements.find((e) => e.id === elementId);
    return element?.learner_label ?? element?.label ?? elementId;
  }

  /** Deck order, when the pack came from a learning-objective tree. `pickTarget`'s tie-break. */
  #orderOf(elementId: string): number | null {
    const index = this.#d.pack.elements.findIndex((e) => e.id === elementId);
    return index < 0 ? null : index + 1;
  }

  /**
   * The turn directive's note — the one slot in `turnDirective` that carries data rather than
   * instructions, and therefore the one place three different turns are told what they are about.
   *
   *  - the **Teacher**: what she has already taught this sitting (`taughtBlock`);
   *  - the **Teacher on a Teach-me-this**: the objective the learner clicked (#38 §5);
   *  - the **Tester**: the objective's own `quizSeeds`, and on the feedback turn what a correct
   *    demonstration contains (#38 §4).
   */
  #turnNote(decision: TurnDecision): string | undefined {
    /**
     * **The collab doc's own turns** (#48), checked first because each of them is a whole turn
     * rather than a variation on the Tester's or the Teacher's. Their blocks are in
     * `prompts.doc.ts`; what is assembled here is the data they read.
     */
    const docBlock = this.#docTurnNote(decision);
    if (docBlock !== undefined) return docBlock;
    if (decision.role === 'challenger' && decision.targetElementId) {
      const element = this.#d.pack.elements.find((e) => e.id === decision.targetElementId);
      if (!element) return undefined;
      const quiz = quizBlock({
        label: element.learner_label || element.label,
        seeds: element.quiz_seeds ?? [],
        demonstration: element.demonstration ?? [],
        turn: quizTurnFor(decision),
      });
      /**
       * **The Tester gets the page too, since #47 §3.** He is asked to ground every point as
       * `p. N: "…"`, quoting the page's own words — which he cannot do from a 58-page prefix he has
       * to find the slide in. Same block the Teacher reads, same resolver, so the quote he offers
       * and the slide the learner is looking at are the same text.
       */
      const where = this.#whereNote();
      return (
        [where, quiz, ...this.#docExtras(decision)]
          .filter((b): b is string => typeof b === 'string' && b.length > 0)
          .join('\n\n') || undefined
      );
    }
    /**
     * The Teacher's note is now **several blocks**, in the order she should read them: what this
     * turn is about, where in the document the learner is (#41), and what she has already taught.
     * One string still, because `turnDirective` has one slot; joined here rather than by four
     * callers so the order is in one place.
     */
    const blocks: string[] = [];
    if (decision.moveType === 'teach_objective' && this.#teachTarget) {
      blocks.push(teachObjectiveBlock(this.#teachTarget));
    }
    const where = this.#whereNote();
    if (where) blocks.push(where);
    if (decision.role === 'peer') blocks.push(this.#learnerNote());
    const taught = this.#taughtNote(decision);
    if (taught) blocks.push(taught);
    blocks.push(...this.#docExtras(decision));
    return blocks.length > 0 ? blocks.join('\n\n') : undefined;
  }

  /**
   * **The notes for the collab doc's own turns** (#48), or `undefined` when this is not one of
   * them and the older assembly below should run.
   *
   * One function rather than six branches scattered through `#turnNote`, because the *order* the
   * blocks are read in is a decision and it belongs in one place: where the learner is, what they
   * have already written there, what this turn is, and only then how it should be pitched.
   */
  #docTurnNote(decision: TurnDecision): string | undefined {
    const blocks: string[] = [];
    const where = this.#whereNote();
    const mention = this.#mentionNote();
    const notes = this.#learnerNotesNote();

    switch (decision.moveType) {
      case 'mention_reply':
        blocks.push(mentionReplyBlock());
        break;
      case 'quiz': {
        if (decision.decidedBy !== 'rule:max_followup') return undefined;
        blocks.push(
          maxFollowupBlock({
            objectiveLabel: decision.targetElementId ? this.#learnerLabel(decision.targetElementId) : null,
            askedBefore: this.#questionsAsked,
          }),
          pitchBlock(this.#pitchInputs(decision.targetElementId)),
        );
        break;
      }
      case 'peer_guess':
        blocks.push(ellieCueBlock({ question: this.#openQuestionText(), roster: this.#d.roster }));
        break;
      case 'max_prompt':
        blocks.push(maxPromptBlock({ guess: this.#cueText ?? '', roster: this.#d.roster }));
        break;
      case 'lesson_start':
        if (this.#lessonTarget === null) return undefined;
        blocks.push(lessonStartBlock(this.#lessonTarget));
        break;
      case 'quiz_answer': {
        const quiz = this.#pendingQuiz;
        blocks.push(
          releaseBlock({
            releasedBy: this.#releaseBy ?? (decision.decidedBy === 'rule:closure' ? 'closure' : 'give_up'),
            attempts: attemptsOf(quiz),
            cueClaim: cueMistakeToCorrect(quiz),
            roster: this.#d.roster,
          }),
        );
        break;
      }
      default:
        return undefined;
    }

    // Where they are, what they have written there, and who they addressed — in front of the
    // turn's own block, because all three are about the question rather than about the reply.
    const head = [where, notes, mention].filter((b): b is string => typeof b === 'string' && b.length > 0);
    return [...head, ...blocks].join('\n\n');
  }

  /**
   * **The blocks #48 *adds* to a turn that already existed**, as opposed to the six turns it
   * invented (`#docTurnNote`). Appended to the older assembly rather than replacing it, because
   * everything the Teacher and the Tester were already told — the learner's objective states, the
   * pitch she was asked for, the taught set, the verdict rules — is still true.
   */
  #docExtras(decision: TurnDecision): string[] {
    const blocks: string[] = [];
    if (decision.moveType === 'answer_then_teach' && (decision.decidedBy === 'rule:ellie_answers' || decision.decidedBy === 'rule:mention')) {
      const page = this.#turnAnchorId === null ? null : (this.#askContext.get(this.#turnAnchorId)?.page ?? null);
      blocks.push(ellieAnswersBlock({ page }));
      const mention = this.#mentionNote();
      if (mention) blocks.push(mention);
    }
    if (decision.moveType === 'quiz_feedback') {
      // §6: the attempt came out of the document rather than out of the composer.
      if (this.#docTextTarget !== null) blocks.push(docTextBlock({ blockQuote: this.#docTextTarget.text }));
      /**
       * **§4.7's second invariant, carried on whichever Max turn resolves the question.** A
       * feedback turn that ends a question Ellie guessed wrongly at must correct her claim
       * explicitly — that is the mitigation the brief names for the risk it takes on in §1
       * (*"Ellie's cue may contain a plausible mistake… the closure rule exists for that"*).
       */
      const claim = cueMistakeToCorrect(this.#pendingQuiz);
      if (claim !== null) blocks.push(cueCorrectionLines(claim, agentByRole(this.#d.roster, 'peer').displayName).join('\n'));
    }
    // The learner's own notes near the anchor, on any turn that is answering them there.
    const notes = this.#learnerNotesNote();
    if (notes && blocks.length > 0) blocks.push(notes);
    return blocks;
  }

  /**
   * **The question, without the marker** (#48 §4.2). The row stays verbatim; the model is asked to
   * answer the question rather than to acknowledge being addressed.
   */
  #mentionNote(): string | undefined {
    const rest = this.#mentionRest;
    if (rest === null) return undefined;
    if (rest.length === 0) {
      // `@Max` and nothing else. They called him over; the useful reading is "ask me something",
      // which is what `rule:mention`'s reply block says and what `parseMention` distinguishes from
      // "no mention" by returning an empty `rest` rather than null.
      return 'THE LEARNER TYPED ONLY YOUR NAME. Take it as "over to you" and say something useful about where they are.';
    }
    return ['WHAT THEY ASKED, WITHOUT THE @NAME', rest].join('\n');
  }

  /**
   * **The learner's own notes near the anchor** (interview finding, `findings.md` §6: what he
   * writes down is never *registered to the AI*).
   *
   * The outline marks which blocks carry learner-authored text, which is the only signal needed —
   * and it is a signal no previous surface in this app had, because until the doc there was
   * nowhere for the learner to write that the agents could see at all.
   */
  #learnerNotesNote(): string | undefined {
    if (this.#docPort.docId() === null) return undefined;
    const anchorId = this.#turnAnchorId;
    const blockId = anchorId === null ? null : (this.#threads.get(anchorId)?.blockId ?? null);
    const page = anchorId === null ? undefined : this.#askContext.get(anchorId)?.page;
    const outline = this.#docPort.outlineNear({
      blockId,
      pages: typeof page === 'number' ? [page] : undefined,
    });
    const mine = outline.filter((e) => e.learnerText && e.text.trim().length > 0);
    if (mine.length === 0) return undefined;
    return learnerNotesBlock(mine.map((e) => ({ blockId: e.blockId, text: e.text, pages: e.pages })));
  }

  /** Max's open question, verbatim, for the cue that has to guess at it (§4.3). */
  #openQuestionText(): string {
    const quiz = this.#pendingQuiz;
    if (quiz === null) return '';
    return this.#d.store.messages.get(quiz.quizMessageId)?.body ?? '';
  }

  /** The inputs §4.5's pitch is a pure function of, assembled where all three are reachable. */
  #pitchInputs(objectiveId: string | null): PitchInputs {
    const outcomes: PitchOutcome[] = this.#outcomes.map((o) => ({
      objectiveId: o.objectiveId,
      kind: o.kind,
      verdict: o.verdict,
      releasedBy: o.releasedBy,
    }));
    return pitchInputs({ objectiveId, outcomes, fill: progressFill(this.#outcomes) });
  }

  /**
   * **What the Teacher is told about the learner** (#41): the file's objective states, the
   * learner's own words out of the ledger, and the pitch. Assembled here because this is where
   * all three are reachable; the block itself decides what to say about them, including what to
   * say when they are all empty.
   */
  #learnerNote(): string {
    const objectives = this.#d.learnerObjectives?.() ?? [];
    const evidence = this.#ledgerRows()
      .filter((r) => r.evidence_text !== null && r.evidence_text.trim().length > 0)
      .map((r) => ({ label: this.#learnerLabel(r.element_id), quote: r.evidence_text! }));
    return learnerBlock({ objectives, evidence, pitchLine: pitchLine(this.#pitch) });
  }

  /** Which slide this thread is on, for the Teacher (#41). Null when nothing resolved one. */
  #whereNote(): string | undefined {
    const context = this.#turnAnchorId === null ? undefined : this.#askContext.get(this.#turnAnchorId);
    if (!context) return undefined;
    return whereBlock({
      scope: context.scope,
      label: context.label ?? null,
      page: context.page ?? null,
      passageText: context.passageText,
    });
  }

  /** The turn directive's taught-set line — data from `flow.ts`, not a memory feat asked of the model. */
  #taughtNote(decision: TurnDecision): string | undefined {
    if (decision.role !== 'peer') return undefined;
    const now = this.#d.clock.now();
    const items = latestByElement(this.#taught)
      .filter((t) => t.by === 'teacher')
      .slice(0, 6)
      .map((t) => ({ label: t.label ?? t.elementId, minutesAgo: Math.max(0, Math.round((now - t.taughtAt) / 60_000)) }));
    return taughtBlock(items);
  }

  /**
   * True while any REFERENCE card is waiting for "Explain it back". `ruleDecision` reads it
   * before every other rule, so no agent can schedule a turn into that thread.
   */
  #referenceLocked(anchorId: string | null = null): boolean {
    return anchorId === null ? anyAnchorLocked(this.#answers) : isAnchorLocked(this.#answers, anchorId);
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  get #rand(): () => number {
    return this.#d.random ?? Math.random;
  }

  /** Defaults to the API-path plan so every existing caller and test keeps its behaviour. */
  get #models(): ModelPlan {
    return this.#d.models ?? API_PLAN;
  }

  #room() {
    const room = this.#d.store.rooms.get(this.#d.roomId);
    if (!room) throw new Error(`No such room: ${this.#d.roomId}`);
    return room;
  }

  #ledgerRows(): LedgerRow[] {
    return this.#d.store.ledger.forSession(this.#d.sessionId);
  }

  #studentParticipant() {
    const p = this.#d.store.participants.student(this.#d.roomId);
    if (!p) throw new Error('Room has no student participant');
    return p;
  }

  #insertMessage(input: {
    participantId: string;
    body: string;
    model?: string;
    backend?: LlmBackend | null;
    usage?: string;
    latencyTargetMs?: number;
    ttftActualMs?: number;
    promotedFromWhisper?: string;
    dividerCause?: string | null;
    disagreement?: string | null;
    /** Which segment this message hangs off (migration 010). Null is a room-level message. */
    anchorId?: string | null;
    /** A document the learner is showing the room (issue #22 decision 4). */
    reference?: Omit<MessageRefRow, 'id' | 'message_id' | 'room_id' | 'created_at'>;
    /** The learner pressed Stop and this is the partial (migration 011). */
    stopped?: boolean;
    /** Turn start → this row, and who chose the speaker (migration 012, audit §6). */
    totalMs?: number;
    decidedBy?: string | null;
    /** What the REFERENCE call was allowed to see, already phrased (migration 015). */
    scopeShown?: string | null;
    /**
     * What this card is (migration 017, issue #41). Defaults to a conversation turn.
     *
     * `'doc_text'` (#48 §6, architect §E4 and §D9) is the learner's own writing in the document,
     * carried into the transcript so the ledger can score it with the evidence rules untouched.
     * The column is free text and needs no migration.
     */
    kind?: 'turn' | 'answer' | 'summary' | 'doc_text';
    /** On a summary card: the anchor of the thread it was written from (migration 017). */
    sourceThreadId?: string | null;
    /**
     * **Which turn wrote this** (migration 021, #42 item B).
     *
     * The other end of `llm_usage.turn_id`: every call the turn made — the orchestrator's
     * decision, the ledger coding, the generation, the doc-edit planner beside it — already
     * files under this id, and with it on the row a message's cost is one `SUM`.
     *
     * **Explicit, never inferred from `#pending`.** A learner message sent while an agent turn
     * is still pending would otherwise inherit that turn's id and be billed for a reply it
     * caused rather than received. Only the sites that *are* the turn's own output pass one:
     * the dispatch, the stopped partial, and the summary card (which has its own call and mints
     * its own id). A rule-written line — the hand-off, a nudge, the summary offer — passes
     * nothing and gets no meter, which is right: it cost nothing.
     */
    turnId?: string | null;
  }): MessageRow {
    const seq = this.#d.store.messages.maxSeq(this.#d.roomId) + 1;
    const row: MessageRow = {
      id: this.#d.newId('m'),
      room_id: this.#d.roomId,
      participant_id: input.participantId,
      seq,
      body: input.body,
      turn_decision_id: null,
      model: input.model ?? null,
      backend: input.backend ?? null,
      usage: input.usage ?? null,
      latency_target_ms: input.latencyTargetMs ?? null,
      ttft_actual_ms: input.ttftActualMs ?? null,
      released_at: this.#nowIso(),
      promoted_from_whisper: input.promotedFromWhisper ?? null,
      divider_cause: input.dividerCause ?? null,
      disagreement: input.disagreement ?? null,
      anchor_id: input.anchorId ?? null,
      // §5's tag, carried by the whole thread rather than by one message — see `#objectiveByAnchor`.
      objective_id: input.anchorId ? (this.#objectiveByAnchor.get(input.anchorId) ?? null) : null,
      stopped: input.stopped ? 1 : 0,
      total_ms: input.totalMs ?? null,
      decided_by: input.decidedBy ?? null,
      scope_shown: input.scopeShown ?? null,
      kind: input.kind ?? 'turn',
      source_thread_id: input.sourceThreadId ?? null,
      turn_id: input.turnId ?? null,
      created_at: this.#nowIso(),
    };
    this.#d.store.messages.insert(row);
    if (input.reference) {
      this.#d.store.messageRefs.insert({
        ...input.reference,
        id: this.#d.newId('ref'),
        message_id: row.id,
        room_id: this.#d.roomId,
        created_at: row.created_at,
      });
    }
    this.#d.store.rooms.update(this.#d.roomId, { turn_seq: seq });
    this.#d.store.outbox.enqueue({
      collection: 'messages',
      doc_path: `rooms/${this.#d.roomId}/messages/${seq}`,
      op: 'set',
      body: JSON.stringify({ ...row, body: row.body }),
      last_error: null,
      enqueued_at: this.#nowIso(),
    });
    const participants = new Map(this.#d.store.participants.forRoom(this.#d.roomId).map((p) => [p.id, p]));
    const view: MessageView = messageView(
      row,
      participants,
      this.#d.roster,
      this.#d.store.messageRefs.forMessage(row.id),
    );
    this.#d.transport.emit({ type: 'message.appended', roomId: this.#d.roomId, message: view });
    return row;
  }

  #recordDecision(trigger: TurnTrigger, decision: TurnDecision): void {
    this.#d.store.turnDecisions.insert({
      id: this.#d.newId('td'),
      room_id: this.#d.roomId,
      trigger: trigger === 'open' ? 'open' : trigger === 'silence' ? 'silence' : trigger === 'promote' ? 'promote' : 'student_message',
      chosen_participant_id: decision.role
        ? (this.#d.store.participants.byAgentKey(this.#d.roomId, agentByRole(this.#d.roster, decision.role).key)?.id ?? null)
        : null,
      move_type: decision.moveType,
      target_element_id: decision.targetElementId,
      probe_type: decision.probeType,
      rationale: decision.rationale,
      decided_by: decision.decidedBy,
      challenged_element_ids: JSON.stringify(decision.role === 'challenger' ? decision.challenges : []),
      usage: null,
      created_at: this.#nowIso(),
    });
  }

  #loadChallenged(): void {
    for (const d of this.#d.store.turnDecisions.forRoom(this.#d.roomId)) {
      try {
        for (const id of JSON.parse(d.challenged_element_ids) as string[]) this.#challenged.add(id);
      } catch {
        /* a decision row written by an older build */
      }
    }
  }

  #defenceLabel(elementId: string): string | null {
    const challenger = agentByRole(this.#d.roster, 'challenger');
    const decision = this.#d.store.turnDecisions
      .forRoom(this.#d.roomId)
      .filter((d) => {
        try {
          return (JSON.parse(d.challenged_element_ids) as string[]).includes(elementId);
        } catch {
          return false;
        }
      })
      .at(-1);
    if (!decision) return null;
    const probe = decision.probe_type ? ` on ${decision.probe_type.replace(/_/g, ' ')}` : '';
    return `defended against ${challenger.displayName}'s probe${probe}`;
  }

  /**
   * The divider names the cause so the learner can attribute the message (§C5) — and since #37
   * there is more than one thing a fill can be, it must name **which**. "Ellie stepped in" after
   * a re-explanation would be a lie about what just happened, and the divider is the only place
   * the learner is told a timer fired at all.
   */
  #dividerFor(stage: 1 | 2, agent: AgentProfile, moveType: string): string {
    // #47 §5: the number the learner reads is the one the timer actually waited, which is no longer
    // a constant — it is the reading time of the turn they went quiet on.
    const seconds = Math.round((stage === 1 ? this.#stages.stageOneMs : this.#stages.stageTwoMs) / 1000);
    const what =
      moveType === 'reexplain_simpler'
        ? 'tried again'
        : moveType === 'offer_step_back'
          ? 'offered to step back'
          : moveType === 'quiz_hint'
            ? 'offered a hint'
            : stage === 1
              ? 'stepped in'
              : 'offered a starting point';
    return `${seconds}s quiet · ${agent.displayName} ${what}`;
  }

  /**
   * Put a failed turn on screen and stop the clock.
   *
   * Every failure inside a turn lands here — the orchestrator decision, the agent generation,
   * the ledger update — because the property the 2026-09-16 bug broke is not about any one of
   * them: it is that **a turn must always end in something the learner can see**. A dispatch, or
   * this card.
   */
  #failTurn(input: {
    kind: 'turn' | 'ledger';
    anchorId: string | null;
    displayName: string | null;
    reason: string;
    detail?: string;
    replay: TurnReplay | null;
  }): void {
    const view: TurnFailureView = {
      id: this.#d.newId('fail'),
      anchorId: input.anchorId,
      kind: input.kind,
      displayName: input.displayName,
      reason: input.reason,
      at: this.#nowIso(),
    };
    this.#failures.push({ view, replay: input.replay });
    this.#turnLog.event('error', 'turn.failed', {
      kind: input.kind,
      failure_id: view.id,
      anchor_id: input.anchorId,
      reason: input.reason,
      detail: input.detail ?? null,
    });
    // A turn failure silences the nudge; a ledger failure does not — the reply did arrive, and
    // the learner has something to answer.
    if (input.kind === 'turn') this.#nudgesHeldForFailure = true;
    this.#event('system', 'agent.turn.error', {
      kind: input.kind,
      failure_id: view.id,
      anchor_id: input.anchorId,
      cause: input.detail ?? input.reason,
    });
    this.#d.transport.emit({ type: 'turn.failed', roomId: this.#d.roomId, failure: view });
  }

  /** The learner did something: the outage is over as far as the timer is concerned. */
  #clearFailureHold(anchorId: string | null): void {
    this.#nudgesHeldForFailure = false;
    this.#nudgesHeldForStop = false;
    const kept: FailureRecord[] = [];
    for (const f of this.#failures) {
      if (f.view.anchorId === anchorId) {
        this.#d.transport.emit({ type: 'turn.failed.cleared', roomId: this.#d.roomId, failureId: f.view.id });
      } else {
        kept.push(f);
      }
    }
    this.#failures = kept;
  }

  /**
   * The card's **Retry** button. Replays the same turn — same trigger, same anchor — rather than
   * scheduling a new one, so a retry cannot turn a failed silence fill into a fresh learner turn.
   */
  async retryTurn(failureId: string): Promise<void> {
    const found = this.#failures.find((f) => f.view.id === failureId);
    if (!found) return;
    this.#failures = this.#failures.filter((f) => f.view.id !== failureId);
    this.#nudgesHeldForFailure = false;
    this.#d.transport.emit({ type: 'turn.failed.cleared', roomId: this.#d.roomId, failureId });
    this.#event('student', 'agent.turn.retry', { failure_id: failureId, kind: found.view.kind });
    this.#log.event('info', 'turn.retry', { failure_id: failureId, kind: found.view.kind });
    if (found.view.kind === 'ledger') {
      await this.#updateLedger('retry', this.#d.clock.now());
      return;
    }
    if (!found.replay) return;
    await this.#runAgentTurn(found.replay.trigger, {
      anchorId: found.replay.anchorId,
      silenceStage: found.replay.silenceStage,
    });
  }

  /** 1 / 0.5 / 0. `'off'` collapses every floor, and the control that sets it must say so. */
  #speedScale(): number {
    return this.#replySpeed === 'off' ? 0 : this.#replySpeed === 'faster' ? 0.5 : 1;
  }

  /**
   * Settings ▸ Reply speed, applied to a floor **where the floor is computed** rather than where
   * it is slept on, so `latency_target_ms` on the row and `etaMs` on the wire are the floor that
   * actually ran. A research log whose target column says 9 s for a turn the app released in 4.5
   * is a log that cannot be analysed.
   *
   * Every floor is scaled, not only the agent turn: a pacing control that reaches the group reply
   * but not the REFERENCE hold or the whisper hold makes the app feel half-un-paced, which is
   * worse than either setting.
   */
  #floor(ms: number): number {
    return Math.round(ms * this.#speedScale());
  }

  /** The floor-yield window as it stands now — Settings ▸ Reply speed scales it (audit §9). */
  #yieldMs(): number {
    const base = this.#lastFillWasScaffold ? FLOOR_YIELD_AFTER_SCAFFOLD_MS : FLOOR_YIELD_MS;
    return Math.round(base * this.#speedScale());
  }

  /**
   * The acknowledgement is **two-phase on purpose**, and the second phase is not a double emit.
   *
   * Phase 1 goes out the instant the turn is accepted, with no speaker and no ETA, because
   * neither is known yet and the learner needs the acknowledgement *now*. Phase 2 goes out when a
   * rule has fixed the speaker — on an anchored thread that is `rule:teacher_answers`, decided
   * with no model call, so it usually lands in the same millisecond — and carries the responder
   * and the floor target for §B9's reserved slot and the hover ETA.
   *
   * Identical payloads are dropped, so the renderer never sees the same state twice; a second
   * event always means something changed. Key your render on `turnId` and treat it as a replace.
   */
  #lastReceived: string | null = null;

  #emitReceived(received: {
    turnId: string;
    messageId: string | null;
    anchorId: string | null;
    yieldMs: number;
    etaMs: number | null;
    responder: TurnParticipantView | null;
  }): void {
    const fingerprint = JSON.stringify(received);
    if (this.#lastReceived === fingerprint) return;
    this.#lastReceived = fingerprint;
    this.#d.transport.emit({
      type: 'turn.received',
      roomId: this.#d.roomId,
      received: { ...received, receivedAt: this.#nowIso() },
    });
  }

  /**
   * Close the acknowledgement. Emitted **once** per turn that opened one, whatever the ending:
   * a message, a partial the learner stopped, a failure card, or a decision to stay quiet
   * (`messageId: null`). A renderer that clears on this can never be left with a "Sent…" line
   * under a thread that has moved on.
   */
  #releaseTurn(turnId: string, messageId: string | null, stopped = false): void {
    if (this.#received !== turnId) return;
    this.#received = null;
    this.#lastReceived = null;
    this.#d.transport.emit({ type: 'turn.released', roomId: this.#d.roomId, turnId, messageId, stopped });
  }

  #showThinking(agent: AgentProfile, turnStart: number, etaMs: number): void {
    this.#thinking = {
      agentKey: agent.key,
      displayName: agent.displayName,
      role: agent.role,
      colour: agent.colour,
      verb: agent.verb,
      // The counter reads elapsed since the turn began, so it shows ~9s when it appears.
      startedAt: new Date(turnStart).toISOString(),
      etaMs,
      showCounter: agent.role === 'challenger',
    };
    this.#d.transport.emit({ type: 'agent.thinking', roomId: this.#d.roomId, thinking: this.#thinking });
  }

  #clearThinking(): void {
    if (!this.#thinking) return;
    this.#thinking = null;
    this.#d.transport.emit({ type: 'agent.thinking.cleared', roomId: this.#d.roomId });
  }

  /**
   * Arm the silence window — unless a turn has just failed.
   *
   * A dispatched turn and a failed turn both end the agent's half of the exchange, so both must
   * stop the clock; the difference is that a failed turn leaves the learner with nothing to
   * respond *to*. Nudging into that is the app blaming the learner for its own outage, so the
   * window stays shut until they act (`#clearFailureHold`).
   */
  /**
   * `afterFill` keeps the cumulative-idle counter, so the *second* fire of a round is stage 2
   * (#37, `timer.arm`). An agent speaking into a silence does not end the silence.
   */
  #armTimer(afterFill = false): void {
    if (this.#room().state === 'closed') return;
    if (this.#nudgesHeldForFailure || this.#nudgesHeldForStop) {
      this.#timer.cancel();
      this.#turnLog.event('warn', 'timer.held', { reason: this.#nudgesHeldForFailure ? 'turn_failed' : 'turn_stopped' });
      return;
    }
    // #47 §5: a fresh window is armed on the reading time of the turn that opened it; a fill keeps
    // the window it interrupted, because an agent speaking into a silence does not end the silence.
    this.#timer.arm(afterFill ? { keepCumulativeIdle: true } : { stages: this.#stages });
    this.#turnLog.event('debug', 'timer.armed', {
      stage_one_ms: this.#stages.stageOneMs,
      stage_two_ms: this.#stages.stageTwoMs,
      after_fill: afterFill,
    });
  }

  #emitTimer(): void {
    this.#d.transport.emit({
      type: 'timer.updated',
      roomId: this.#d.roomId,
      timer: timerView(this.#timer.snapshot, this.#timer.snapshot.stageOneMs, this.#d.clock.now(), this.#typingActive()),
    });
  }

  #typingActive(): boolean {
    return this.#d.clock.now() < this.#typingUntil;
  }

  #notice(level: 'info' | 'error', text: string): void {
    this.#d.transport.emit({ type: 'notice', roomId: this.#d.roomId, level, text });
  }

  #markFirstHelp(): void {
    this.#firstHelpAt ??= this.#d.clock.now();
  }

  #relayOfferFor(turn: number): { draftText: string; defaultAttribution: RelayAttribution } | null {
    // In scripted mode the offer text comes from the script; in live mode the whisper agent is
    // asked for a draft in its own reply, and the UI's Preview step is what makes it real.
    //
    // *Which* script is the client's business, not the actor's: `ScriptedClient` latches the
    // deck it is replaying, and a sitting on the Critique 1 deck must not be handed the
    // PSD/Hessian draft (flow-build-plan.md §4.4). The actor asks if it can and falls back to
    // the original script otherwise, so no other backend has to grow this method.
    if (this.#d.config.mode !== 'scripted') return null;
    const client = this.#d.llm as Partial<{
      relayOfferFor(turn: number): { draftText: string; defaultAttribution: RelayAttribution } | null;
    }>;
    if (typeof client.relayOfferFor === 'function') return client.relayOfferFor(turn);
    return scriptRelayOffer(turn);
  }

  #buildRecap(): RecapView {
    const rows = this.#ledgerRows();
    const history = this.#d.store.ledger.historyForSession(this.#d.sessionId);
    const before = rows.map((r) => {
      const first = history.find((h) => h.element_id === r.element_id);
      return { ...r, level: (first?.level_before ?? 0) as LedgerRow['level'] };
    });
    const view = ledgerView(rows, this.#d.pack);
    const beforeView = ledgerView(before, this.#d.pack);
    const openMisconceptions = rows.flatMap((r) => {
      const open = JSON.parse(r.misconceptions_open) as string[];
      const resolved = JSON.parse(r.misconceptions_resolved) as string[];
      const element = this.#d.pack.elements.find((e) => e.id === r.element_id);
      return open
        .filter((id) => !resolved.includes(id))
        .map((id) => ({
          text: element?.misconceptions.find((m) => m.id === id)?.text ?? id,
          caughtByLearner: false,
        }));
    });
    const resolvedByLearner = rows.flatMap((r) => {
      const element = this.#d.pack.elements.find((e) => e.id === r.element_id);
      return (JSON.parse(r.misconceptions_resolved) as string[]).map((id) => ({
        text: element?.misconceptions.find((m) => m.id === id)?.text ?? id,
        caughtByLearner: true,
      }));
    });
    const tutee = this.#d.roster.find((a) => a.role === 'tutee');

    /**
     * What the learner *did*, not how well they did it (P5, §B6). The three numbers here used
     * to be a re-count of ledger states — "0 claims established · 0 defended under challenge ·
     * 0 revisited" — which is a score, and three zeroes on the payoff screen is precisely the
     * evaluation apprehension the design exists to remove (ui-review-ux.md M9). A count of zero
     * is dropped rather than printed, and when nothing is left the recap omits the block.
     */
    const participants = new Map(this.#d.store.participants.forRoom(this.#d.roomId).map((p) => [p.id, p]));
    const learnerTurns = this.#d.store.messages
      .forRoom(this.#d.roomId)
      .filter((m) => participants.get(m.participant_id)?.kind === 'student').length;
    const acts = ([
      ['turn you took', 'turns you took', learnerTurns],
      ['challenge you answered', 'challenges you answered', rows.filter((r) => r.defended_against !== null).length],
      ['time you corrected yourself', 'times you corrected yourself', resolvedByLearner.length],
      ['document you brought in', 'documents you brought in', this.#d.store.messageRefs.forRoom(this.#d.roomId).length],
    ] as const)
      .filter(([, , count]) => count > 0)
      .map(([one, many, count]) => ({ label: count === 1 ? one : many, count }));

    // §B6: "gate not met ⇒ the Theo block is absent entirely, not shown greyed — an unavailable
    // reward is a punishment". It used to be offered whenever a tutee existed in the roster,
    // i.e. always, including on a completely empty ledger.
    const anythingOnTheRecord = view.rows.some((r) => r.state !== 'not_yet');
    return {
      roomId: this.#d.roomId,
      conceptTitle: this.#d.pack.title,
      before: beforeView.rows,
      after: view.rows,
      bloom: view.bloom,
      actProfile: acts,
      unaidedMs: (this.#firstHelpAt ?? this.#d.clock.now()) - this.#openedAt,
      corrections: [...resolvedByLearner, ...openMisconceptions],
      // A statement, not a question. `What about ${learnerLabel}?` produced "What about <60-word
      // paragraph>.?" five times over (ui-review-ux.md B5); the labels are short now, and this
      // is not pretending to be a question the learner has to answer.
      openQuestions: view.rows.filter((r) => r.state === 'not_yet').map((r) => `Nothing yet on ${r.learnerLabel}.`),
      teachbackOffer:
        tutee && anythingOnTheRecord
          ? {
              agentKey: tutee.key,
              displayName: tutee.displayName,
              blurb: `${tutee.displayName} is a first year who hasn't seen this yet. Want 3 minutes to teach it to him?`,
            }
          : null,
    };
  }

  #event(actor: string, type: string, payload: Record<string, unknown>): void {
    this.#d.store.events.append({
      room_id: this.#d.roomId,
      session_id: this.#d.sessionId,
      actor,
      type,
      envelope: JSON.stringify({
        concept_id: this.#d.pack.concept_id,
        app_version: this.#d.appVersion,
        mode: this.#d.config.mode,
      }),
      payload: JSON.stringify(payload),
      client_ts: null,
      server_ts: this.#nowIso(),
    });
  }

  #nowIso(): string {
    return new Date(this.#d.clock.now()).toISOString();
  }

  async #holdUntil(startedAt: number, floorMs: number): Promise<void> {
    const elapsed = this.#d.clock.now() - startedAt;
    await this.#sleep(floorMs - elapsed);
  }

  #sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => this.#d.clock.setTimeout(resolve, ms));
  }
}

/**
 * One short, true sentence for the card. It must never carry a prompt, a message body or a
 * key — `failureReason` deliberately answers from the error's *class*, not from its text, and
 * only the CLI's own exit line is ever quoted, capped.
 */
export function failureReason(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/not logged in|log in/i.test(message)) return 'Claude Code is not logged in';
  if (/did not answer within/i.test(message)) return 'the model did not answer in time';
  if (/was not found|ENOENT/i.test(message)) return 'the Claude CLI was not found';
  if (/exited (\d+)/i.test(message)) return `the Claude CLI exited ${/exited (\d+)/i.exec(message)![1]}`;
  if (/no JSON object|JSON|parse/i.test(message)) return 'the reply could not be read';
  if (/rate|429|overloaded|529/i.test(message)) return 'the model was overloaded';
  if (/network|ECONN|fetch|socket/i.test(message)) return 'the connection dropped';
  return 'the call failed';
}

/**
 * **Which turn of the attempt loop a Tester decision is** (issue #47 §2.3), for `quizBlock`.
 *
 * Keyed on the move, which is what the rules set, and not on the rule name: `quiz_hint` arrives from
 * three rules and only one of them changes what the *note* should say (the other two are hints in
 * the ordinary sense, and `turnDirective` handles the difference).
 */
/**
 * **Ellie's cue, out of its structured reply** (#48 §4.3, `ELLIE_CUE_SCHEMA`).
 *
 * Tolerant on purpose. A cue whose JSON will not parse is still a turn the learner is waiting for,
 * and the honest fallback is the raw text with **no** mistake claimed: a claim the app cannot read
 * is a claim the closure rule cannot check, and asserting one it never saw would be worse than
 * admitting there is none. The same unwrapper the decision and ledger paths use handles a model
 * that wraps the object in prose.
 */
export function parseCue(raw: string): { text: string; hasMistake: boolean; claim: string | null } {
  try {
    const parsed = JSON.parse(extractJsonObject(raw)) as Record<string, unknown>;
    const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
    if (text.length === 0) return { text: raw.trim(), hasMistake: false, claim: null };
    const claim = typeof parsed.claim === 'string' && parsed.claim.trim().length > 0 ? parsed.claim.trim() : null;
    // `has_mistake` without a claim is not a mistake the closure rule can correct, so it is not
    // recorded as one — §4.7's invariant is about a *named* claim, not about a flag.
    return { text, hasMistake: parsed.has_mistake === true && claim !== null, claim };
  } catch {
    return { text: raw.trim(), hasMistake: false, claim: null };
  }
}

function quizTurnFor(decision: TurnDecision): QuizTurn {
  switch (decision.moveType) {
    case 'quiz_feedback':
      return 'feedback';
    case 'quiz_answer':
      return 'answer';
    case 'quiz_clarify':
      return 'clarify';
    case 'quiz_hint':
      return decision.decidedBy === 'rule:answer_withheld' ? 'hint_withheld' : 'question';
    default:
      return 'question';
  }
}

function scriptRelayOffer(turn: number): { draftText: string; defaultAttribution: RelayAttribution } | null {
  const beat = SCRIPT_WHISPERS.find((b) => b.cue === `whisper:${turn}`);
  return beat?.relayOffer ?? null;
}
