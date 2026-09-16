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
import type {
  AgentProfile,
  ReplySpeed,
  StopTurnResult,
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
  buildReferenceRequest,
  composeReferenceBody,
  explainBack,
  findReferenceParticipant,
  isAnchorLocked,
  type ReferenceAnswerState,
} from './reference.js';
import {
  FLOW,
  answerQuiz,
  handOffDue,
  handOffLine,
  markFeedbackGiven,
  noteActivity,
  noteHandOff,
  openQuiz,
  openSession,
  tickSession,
  type FlowProfile,
  type FlowSession,
  type PendingQuiz,
  type TaughtItem,
  type TesterMode,
} from './flow.js';
import { decideTurn, extractJson as extractJsonObject, type TurnDecision, type TurnTrigger } from './orchestrator.js';
import { SILENT_LOG, type Clock, type Store, type Transport, type TurnLog } from './ports.js';
import type { ConceptPack, LedgerRow, MessageRefRow, MessageRow, RoomConfig } from './records.js';
import type { ReferenceContext } from './reference.js';
import { latestByElement } from './flow.js';
import { decisionDirective, ledgerDirective, taughtBlock } from './prompts.js';
import { ledgerSystemBlock } from './prompts.ledger.js';
import { limitsLine } from './prompts.whisper.js';
import { SCRIPT_WHISPERS } from './llm/script.psd-hessian.js';
import { roundCardFor } from './roundcard.js';
import { SilenceTimer } from './timer.js';
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
  };
  newId: (prefix: string) => string;
  /** Injectable for deterministic tests. */
  random?: () => number;
  /**
   * Structured logging. Defaults to silent, so tests and any non-Electron host stay quiet; the
   * main process passes `src/main/log.ts`. Sizes, ids, models and durations only — never a body.
   */
  log?: TurnLog;
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
  #handOffs = 0;
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
  #pendingQuiz: PendingQuiz | null = null;
  #testerMode: TesterMode = 'proactive';
  /** Every REFERENCE card inserted this session, and whether it has been explained back. */
  #answers: ReferenceAnswerState[] = [];
  /** The segment the learner last acted in. Where an unanchored fill (a nudge) goes. */
  #lastAnchorId: string | null = null;
  /** The turn whose `turn.received` is still on screen, so exactly one `turn.released` closes it. */
  #received: string | null = null;
  /** Settings ▸ Reply speed. Read per turn, so a change applies to the next turn, never this one. */
  #replySpeed: ReplySpeed;
  /** anchorId → the highest `seq` the learner has seen there (audit §7). */
  #seen = new Map<string, number>();
  /** anchorId → the card's renderer state, which must survive a reopen (audit §7). */
  #cards = new Map<string, { collapsed?: boolean; removed?: boolean }>();
  #asks = 0;
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
    this.#answers = [...(deps.flowState?.answers ?? [])];
    this.#asks = this.#answers.length;
    this.#replySpeed = deps.replySpeed ?? 'default';
    this.#seen = new Map(Object.entries(deps.flowState?.seen ?? {}));
    this.#cards = new Map(Object.entries(deps.flowState?.cards ?? {}));
    const room = this.#room();
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
  }

  stop(): void {
    this.#timer.stop();
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
  async sendMessage(text: string, anchorId: string | null = null): Promise<void> {
    const body = text.trim();
    if (body.length === 0) return;

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
      this.#noteLearnerActivity('turn', anchorId);
      const row = this.#insertMessage({
        participantId: this.#studentParticipant().id,
        body,
        anchorId,
      });
      // An answer to the Tester's outstanding question puts the room in feedback debt, which
      // `ruleDecision` then discharges before anything else can be decided.
      if (this.#pendingQuiz) this.#pendingQuiz = answerQuiz(this.#pendingQuiz, row.id);
      studentMessageId = row.id;
      this.#event('student', 'message.send', { seq: row.seq, chars: body.length, anchor_id: anchorId });
      this.#d.store.rooms.update(this.#d.roomId, { consecutive_agent_turns: 0, expects_reply: 1 });
    });

    await this.#runAgentTurn('student_message', { studentBody: body, anchorId, studentMessageId });
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

  // ── "+ Ask here" — the REFERENCE path (pivot-spec.md §B1) ─────────────────

  /**
   * The learner asks a factual question about one segment, and gets one neutral card back.
   *
   * **This is not an agent turn**, and the four properties that make that true are enforced
   * here rather than asked for in a prompt (`flow-build-plan.md` §4.3):
   *
   *  1. no floor — `consecutive_agent_turns` is untouched, and no `pending_turn_id` is written,
   *     so a held reply elsewhere is neither cancelled nor displaced;
   *  2. no timer — `this.#timer` is not called at all. The deadline, the epoch and
   *     `nudge_fires_this_round` all come out the other side unchanged, which is the assertion
   *     the test makes: reading an answer is not explaining, so it does not buy silence;
   *  3. no ledger — `#updateLedger` is not called, and could not help the learner if it were,
   *     since evidence must be a verbatim substring of a *learner* message;
   *  4. the segment's thread is locked to Ellie and Max until `explainBack()`.
   *
   * The learner's question *is* written as their own message, because it is theirs and the flow
   * renders it; it simply does not schedule anybody.
   */
  async askHere(input: {
    anchorId: string | null;
    question: string;
    /**
     * What the model is given: the page for a `'segment'` question, the whole document for a
     * `'deck'` one (issue #35). Resolved by `flowroom.referenceContext()`, which also produces
     * `scopeShown` — one resolver, so the answer and the footer cannot describe different reads.
     */
    context: ReferenceContext;
  }): Promise<{ questionId: string; answerId: string; body: string; truncated: boolean; scopeShown: string }> {
    const question = input.question.trim();
    if (question.length === 0) throw new Error('An "Ask here" needs a question');
    this.#asks += 1;

    const asked = await this.#mailbox.enqueue(() => {
      this.#noteLearnerActivity('ask', input.anchorId);
      const row = this.#insertMessage({
        participantId: this.#studentParticipant().id,
        body: question,
        anchorId: input.anchorId,
      });
      this.#event('student', 'message.send', {
        seq: row.seq,
        chars: question.length,
        scope: 'reference',
        anchor_id: input.anchorId,
      });
      return row;
    });

    const material = this.#d.store.materials.get(this.#room().material_id)!;
    const request = buildReferenceRequest({
      model: this.#models.orchestrator,
      roomId: this.#d.roomId,
      deckTitle: material.title,
      context: input.context,
      question,
      anchorId: input.anchorId,
      scriptCue: `reference:${this.#asks}`,
    });

    const started = this.#d.clock.now();
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
      this.#event('system', 'agent.turn.error', { scope: 'reference', cause: (err as Error).message });
      this.#notice('error', 'That lookup did not come back — try again.');
      throw err;
    }

    // "Held 2–3 s: this is retrieval, not deliberation — it must not borrow the Challenger's
    // considered pacing" (§B1). A short floor, and it is a floor on visible TTFT like every
    // other one in this file.
    await this.#holdUntil(started, this.#floor(Math.round((2_000 + this.#rand() * 1_000) * this.#d.config.latency_scale)));

    // The 120-word cap is applied here, in code. A prompt that asks for 120 words is a prompt
    // that produces 180 on the take you keep.
    const { body, truncated } = composeReferenceBody(raw);

    const answer = await this.#mailbox.enqueue(() => {
      const row = this.#insertMessage({
        participantId: this.#referenceParticipant().id,
        body,
        model,
        backend,
        usage: JSON.stringify(usage),
        anchorId: input.anchorId,
        scopeShown: input.context.scopeShown,
      });
      this.#answers.push({ answerId: row.id, anchorId: input.anchorId, explainedBackAt: null });
      this.#event('system', 'agent.turn.dispatched', {
        seq: row.seq,
        scope: 'reference',
        anchor_id: input.anchorId,
        ask_scope: input.context.scope,
        scope_shown: input.context.scopeShown,
        words: body.split(/\s+/).length,
        truncated,
        // Neither of these moved, and the event log is where that is checkable.
        took_floor: false,
        reset_timer: false,
      });
      return row;
    });

    return { questionId: asked.id, answerId: answer.id, body, truncated, scopeShown: input.context.scopeShown };
  }

  /**
   * "Explain it back →". The answer card collapses, a composer opens on the same anchor, and
   * **Ellie and Max become eligible on that anchor for the first time**.
   *
   * This is the hook: the learner has read the answer, and the only way to move the ledger from
   * there is still to say it in their own words.
   */
  explainBack(answerId: string): { unlocked: boolean; anchorId: string | null } {
    const before = this.#answers.find((a) => a.answerId === answerId);
    if (!before) return { unlocked: false, anchorId: null };
    this.#answers = explainBack(this.#answers, answerId, this.#d.clock.now());
    this.#event('student', 'reference.explain_back', { answer_id: answerId, anchor_id: before.anchorId });
    this.#d.transport.emit({ type: 'room.state', roomId: this.#d.roomId, state: this.#room().state });
    return { unlocked: true, anchorId: before.anchorId };
  }

  /**
   * The reference participant, created with the room. Made on demand for a room that predates
   * this build, so an old transcript can still be asked a question.
   */
  #referenceParticipant() {
    const existing = findReferenceParticipant(this.#d.store.participants.forRoom(this.#d.roomId));
    if (existing) return existing;
    const row = {
      id: this.#d.newId('p'),
      room_id: this.#d.roomId,
      kind: 'agent' as const,
      user_id: null,
      // Null on purpose: the REFERENCE voice is not an agent, has no row in `agents`, and can
      // therefore never be found by `agentByRole` or selected by the orchestrator.
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
  ): Promise<void> {
    const body = text.trim();
    if (body.length === 0) return;
    const thread = this.#d.store.whispers.forThread(threadId);
    const agentParticipantId = thread[0]?.agent_participant_id ?? this.#peerParticipant().id;
    const agentKey = this.#d.store.participants.get(agentParticipantId)?.agent_key ?? '';
    const agent = agentByKey(this.#d.roster, agentKey) ?? agentByRole(this.#d.roster, 'peer');
    const snapshot = this.#room().turn_seq;

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

    // A relayed question is treated as an ordinary group turn from here on — on the segment it
    // was inserted under, so the reply lands in that thread rather than at the room level.
    await this.#runAgentTurn('promote', { anchorId });
    return { messageId: inserted.id };
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
      timer: timerView(this.#timer.snapshot, this.#d.config.silence_ms, this.#d.clock.now(), this.#typingActive()),
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
    } = {},
  ): Promise<void> {
    /**
     * The segment this turn belongs to. Every message the turn writes carries it — the hand-off
     * line, the agent's reply — so a thread stays a thread and the flow never has to guess where
     * a turn landed. `null` is the room-level stream, which is every pre-flow room.
     */
    const anchorId = opts.anchorId ?? null;
    const turnStart = this.#d.clock.now();
    const pending: PendingTurn = {
      id: this.#d.newId('turn'),
      cancelled: false,
      floorPassed: false,
      stopped: false,
      abort: new AbortController(),
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
      // `rule:teacher_answers`). `null` is the pre-flow room-level stream.
      anchoredThread: anchorId !== null,
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
    if (trigger === 'student_message' || trigger === 'promote') {
      // `#updateLedger` catches its own failures and surfaces them as a card, so nothing here
      // can reject; the `catch` is belt and braces against a future edit that changes that.
      void this.#updateLedger(cue, turnStart).catch(() => undefined);
    }
    const decidedAt = this.#d.clock.now();
    const decision = await this.#decide(decisionInput, cue, turnLog, turnStart);
    this.#trace(pending.id, {
      decisionMs: this.#d.clock.now() - decidedAt,
      decidedBy: decision.decidedBy,
      role: decision.role,
      moveType: decision.moveType,
      failed: decision.failure?.reason ?? null,
    });

    this.#recordDecision(trigger, decision);
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
    const target = this.#floor(latencyTargetMs(agent, this.#d.config.latency_scale, this.#rand));
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
      this.#handOffs += 1;
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

    // A hand-off and its feedback turn have their own script cues, so the video path can carry
    // Max's question and his feedback without the orchestrator's cue doing double duty.
    const turnCue =
      decision.decidedBy === 'rule:handoff'
        ? `handoff:${this.#handOffs}`
        : decision.moveType === 'quiz_feedback'
          ? `feedback:${this.#handOffs}`
          : cue;

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
        dividerCause: trigger === 'silence' ? this.#dividerFor(opts.silenceStage ?? 1, agent) : null,
        anchorId,
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
      this.#noteTurnForFlow(decision, row.id);
      if (trigger === 'silence') this.#markFirstHelp();
    });

    this.#pending = null;
    this.#lastFillWasScaffold = trigger === 'silence' && opts.silenceStage === 2;
    if (decision.probeType) this.#lastProbeType = decision.probeType;
    for (const id of decision.challenges) this.#challenged.add(id);
    this.#armTimer();
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
    request.meta = { ...request.meta, scope: 'orchestrator', scriptCue: cue, turnId: this.#pending?.id };
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
        note: this.#taughtNote(decision),
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
    return this.#d.llm.complete(request, onDelta, signal);
  }

  async #updateLedger(cue: string, turnStart: number): Promise<void> {
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
    request.meta = { ...request.meta, scope: 'ledger', scriptCue: cue };
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
  } {
    return {
      session: this.#flow,
      taught: [...this.#taught],
      pendingQuiz: this.#pendingQuiz,
      answers: [...this.#answers],
      seen: this.seenSnapshot(),
      cards: this.cardStateSnapshot(),
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
  #noteTurnForFlow(decision: TurnDecision, messageId: string): void {
    const now = this.#d.clock.now();
    if (decision.role === 'peer' && decision.targetElementId) {
      this.#taught.push({
        elementId: decision.targetElementId,
        taughtAt: now,
        by: 'teacher',
        sessionId: this.#flow?.id,
        label: this.#learnerLabel(decision.targetElementId),
      });
    }
    if (decision.moveType === 'quiz' && decision.targetElementId) {
      this.#pendingQuiz = openQuiz({ quizMessageId: messageId, elementId: decision.targetElementId }, now);
    }
    if (decision.moveType === 'quiz_feedback' && this.#pendingQuiz) {
      // Rowland 2014's constraint is discharged only when the feedback turn actually landed.
      this.#pendingQuiz = markFeedbackGiven(this.#pendingQuiz);
    }
  }

  #learnerLabel(elementId: string): string {
    const element = this.#d.pack.elements.find((e) => e.id === elementId);
    return element?.learner_label ?? element?.label ?? elementId;
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
      stopped: input.stopped ? 1 : 0,
      total_ms: input.totalMs ?? null,
      decided_by: input.decidedBy ?? null,
      scope_shown: input.scopeShown ?? null,
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

  #dividerFor(stage: 1 | 2, agent: AgentProfile): string {
    const seconds = Math.round(this.#d.config.silence_ms / 1000);
    return stage === 1
      ? `${seconds}s quiet · ${agent.displayName} stepped in`
      : `${Math.round(this.#d.config.stage_two_ms / 1000)}s quiet · ${agent.displayName} offered a starting point`;
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
  #armTimer(): void {
    if (this.#room().state === 'closed') return;
    if (this.#nudgesHeldForFailure || this.#nudgesHeldForStop) {
      this.#timer.cancel();
      this.#turnLog.event('warn', 'timer.held', { reason: this.#nudgesHeldForFailure ? 'turn_failed' : 'turn_stopped' });
      return;
    }
    this.#timer.arm();
    this.#turnLog.event('debug', 'timer.armed', { silence_ms: this.#d.config.silence_ms });
  }

  #emitTimer(): void {
    this.#d.transport.emit({
      type: 'timer.updated',
      roomId: this.#d.roomId,
      timer: timerView(this.#timer.snapshot, this.#d.config.silence_ms, this.#d.clock.now(), this.#typingActive()),
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

function scriptRelayOffer(turn: number): { draftText: string; defaultAttribution: RelayAttribution } | null {
  const beat = SCRIPT_WHISPERS.find((b) => b.cue === `whisper:${turn}`);
  return beat?.relayOffer ?? null;
}
