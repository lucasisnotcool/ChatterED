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
  FlowWhisperView,
  MessageView,
  RecapView,
  RelayAttribution,
  RoomSnapshot,
  TeachbackResult,
  ThinkingView,
  WhisperThreadView,
} from '../shared/types.js';
import { agentByKey, agentByRole, latencyTargetMs, otherStandingAgent } from './agents.js';
import { buildGroupContext } from './context.group.js';
import { buildWhisperContext } from './context.whisper.js';
import { applyLedgerRules, type LedgerProposal } from './ledger.js';
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
import { decideTurn, type TurnDecision, type TurnTrigger } from './orchestrator.js';
import type { Clock, Store, Transport } from './ports.js';
import type { ConceptPack, LedgerRow, MessageRefRow, MessageRow, RoomConfig } from './records.js';
import { latestByElement } from './flow.js';
import { taughtBlock } from './prompts.js';
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
  };
  newId: (prefix: string) => string;
  /** Injectable for deterministic tests. */
  random?: () => number;
}

interface PendingTurn {
  id: string;
  cancelled: boolean;
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

  constructor(deps: RoomActorDeps) {
    this.#d = deps;
    this.#openedAt = deps.clock.now();
    this.#flow = deps.flowState?.session ?? null;
    this.#taught = [...(deps.flowState?.taught ?? [])];
    this.#pendingQuiz = deps.flowState?.pendingQuiz ?? null;
    this.#answers = [...(deps.flowState?.answers ?? [])];
    this.#asks = this.#answers.length;
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
      this.#event('student', 'message.send', { seq: row.seq, chars: body.length, anchor_id: anchorId });
      this.#d.store.rooms.update(this.#d.roomId, { consecutive_agent_turns: 0, expects_reply: 1 });
    });

    await this.#runAgentTurn('student_message', { studentBody: body, anchorId });
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
    /** The extracted text of the segment being asked about. */
    segmentText: string;
  }): Promise<{ questionId: string; answerId: string; body: string; truncated: boolean }> {
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
      segmentText: input.segmentText,
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
    await this.#holdUntil(started, Math.round((2_000 + this.#rand() * 1_000) * this.#d.config.latency_scale));

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
      });
      this.#answers.push({ answerId: row.id, anchorId: input.anchorId, explainedBackAt: null });
      this.#event('system', 'agent.turn.dispatched', {
        seq: row.seq,
        scope: 'reference',
        anchor_id: input.anchorId,
        words: body.split(/\s+/).length,
        truncated,
        // Neither of these moved, and the event log is where that is checkable.
        took_floor: false,
        reset_timer: false,
      });
      return row;
    });

    return { questionId: asked.id, answerId: answer.id, body, truncated };
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
    const target = latencyTargetMs({ ...agent, latency: { ttftMinMs: 1000, ttftMaxMs: 2000 } }, this.#d.config.latency_scale, this.#rand);
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
    };
  }

  // ── the turn itself ───────────────────────────────────────────────────────

  async #runAgentTurn(
    trigger: TurnTrigger,
    opts: { studentBody?: string; silenceStage?: 1 | 2; anchorId?: string | null } = {},
  ): Promise<void> {
    /**
     * The segment this turn belongs to. Every message the turn writes carries it — the hand-off
     * line, the agent's reply — so a thread stays a thread and the flow never has to guess where
     * a turn landed. `null` is the room-level stream, which is every pre-flow room.
     */
    const anchorId = opts.anchorId ?? null;
    const turnStart = this.#d.clock.now();
    const pending: PendingTurn = { id: this.#d.newId('turn'), cancelled: false };
    this.#pending = pending;

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

    // The orchestrator and the ledger run concurrently, inside the delay window. That is the
    // strongest argument the latency mechanic has: the delay is the assessment window.
    const [decision] = await Promise.all([
      this.#decide(decisionInput, cue),
      trigger === 'student_message' || trigger === 'promote'
        ? this.#updateLedger(cue, turnStart)
        : Promise.resolve(),
    ]);

    this.#recordDecision(trigger, decision);
    if (!decision.speak || decision.role === null) {
      this.#pending = null;
      this.#armTimer();
      return;
    }

    const agent = agentByRole(this.#d.roster, decision.role);
    const target = latencyTargetMs(agent, this.#d.config.latency_scale, this.#rand);
    this.#d.store.rooms.update(this.#d.roomId, {
      state: 'agent_scheduled',
      pending_turn_id: pending.id,
      pending_turn_due_ts: new Date(turnStart + target).toISOString(),
    });
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

    // Generate now; hold the tokens until the floor. The buffer is the product decision.
    const generation = this.#generate(agent, decision, turnCue);

    const yieldMs = this.#lastFillWasScaffold ? FLOOR_YIELD_AFTER_SCAFFOLD_MS : FLOOR_YIELD_MS;
    if (trigger === 'student_message' || trigger === 'promote') {
      await this.#sleep(Math.max(0, Math.min(yieldMs, target - 1_000) - (this.#d.clock.now() - turnStart)));
    }
    if (pending.cancelled) {
      this.#cancelTurn(decision.role, pending);
      return;
    }
    this.#showThinking(agent, turnStart, target);

    let text: string;
    let ttft = 0;
    let model = agent.model;
    let backend: LlmBackend | null = null;
    let usage: Record<string, number> = {};
    try {
      const result = await generation;
      text = result.text;
      ttft = result.ttftMs;
      model = result.model;
      backend = result.backend ?? null;
      usage = result.usage as unknown as Record<string, number>;
    } catch (err) {
      this.#event(decision.role, 'agent.turn.error', { cause: (err as Error).message });
      this.#clearThinking();
      this.#pending = null;
      this.#notice('error', `${agent.displayName}'s connection dropped — retrying`);
      this.#armTimer();
      return;
    }

    await this.#holdUntil(turnStart, target);
    if (pending.cancelled) {
      this.#cancelTurn(decision.role, pending);
      return;
    }

    await this.#mailbox.enqueue(() => {
      this.#clearThinking();
      const row = this.#insertMessage({
        participantId: this.#d.store.participants.byAgentKey(this.#d.roomId, agent.key)!.id,
        body: text,
        model,
        backend,
        usage: JSON.stringify(usage),
        latencyTargetMs: target,
        ttftActualMs: ttft,
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
        ttft_actual_ms: ttft,
        usage,
      });
      this.#noteTurnForFlow(decision, row.id);
      if (trigger === 'silence') this.#markFirstHelp();
    });

    this.#pending = null;
    this.#lastFillWasScaffold = trigger === 'silence' && opts.silenceStage === 2;
    if (decision.probeType) this.#lastProbeType = decision.probeType;
    for (const id of decision.challenges) this.#challenged.add(id);
    this.#armTimer();
  }

  /** A held reply that the learner spoke over is dropped, logged, and never posted. */
  #cancelTurn(role: AgentProfile['role'] | null, pending: PendingTurn): void {
    this.#event(role ?? 'system', 'agent.turn.error', { cause: 'cancelled_by_student', turn_id: pending.id });
    this.#clearThinking();
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

  async #decide(input: Parameters<typeof decideTurn>[0]['input'], cue: string): Promise<TurnDecision> {
    const peer = agentByRole(this.#d.roster, 'peer');
    const request = buildGroupContext(this.#d.groupStore, {
      roomId: this.#d.roomId,
      speaker: peer,
      roster: this.#d.roster,
      pack: this.#d.pack,
      directive: { agentRole: 'peer', move: 'decide_next_turn' },
      maxTokens: 400,
    });
    request.model = this.#models.orchestrator;
    request.meta = { ...request.meta, scope: 'orchestrator', scriptCue: cue };
    return decideTurn({ client: this.#d.llm, request, input });
  }

  async #generate(agent: AgentProfile, decision: TurnDecision, cue: string) {
    // Stage-1 fills are never generated against the concept (product-design.md §C5).
    if (decision.moveType === 'content_free_nudge') {
      const pool = CONTENT_FREE_NUDGES;
      const line = pool[Math.floor(this.#rand() * pool.length)] ?? pool[0]!;
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
    return this.#d.llm.complete(request);
  }

  async #updateLedger(cue: string, turnStart: number): Promise<void> {
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
      maxTokens: 900,
    });
    // The ledger is a structured-output call, not an agent turn: it runs on the orchestrator
    // model, which is the whole point of the two-dropdown split (#19).
    request.model = this.#models.orchestrator;
    request.meta = { ...request.meta, scope: 'ledger', scriptCue: cue };

    let proposal: LedgerProposal;
    try {
      const result = await this.#d.llm.complete(request);
      proposal = JSON.parse(result.text) as LedgerProposal;
    } catch {
      // The chat never blocks on the ledger (progress-tracking.md §4.6).
      this.#event('system', 'progress.update', { parse_ok: false });
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

  /** What the caller must persist to make the sitting survive a quit. */
  flowSnapshot(): {
    session: FlowSession | null;
    taught: TaughtItem[];
    pendingQuiz: PendingQuiz | null;
    answers: ReferenceAnswerState[];
  } {
    return {
      session: this.#flow,
      taught: [...this.#taught],
      pendingQuiz: this.#pendingQuiz,
      answers: [...this.#answers],
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

  #armTimer(): void {
    if (this.#room().state === 'closed') return;
    this.#timer.arm();
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

function scriptRelayOffer(turn: number): { draftText: string; defaultAttribution: RelayAttribution } | null {
  const beat = SCRIPT_WHISPERS.find((b) => b.cue === `whisper:${turn}`);
  return beat?.relayOffer ?? null;
}
