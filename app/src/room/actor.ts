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
  MessageView,
  RecapView,
  RelayAttribution,
  RoomSnapshot,
  ThinkingView,
  WhisperThreadView,
} from '../shared/types.js';
import { agentByKey, agentByRole, latencyTargetMs } from './agents.js';
import { buildGroupContext } from './context.group.js';
import { buildWhisperContext } from './context.whisper.js';
import { applyLedgerRules, type LedgerProposal } from './ledger.js';
import type { LLMClient, LlmBackend } from './llm/types.js';
import { API_PLAN, type ModelPlan } from './llm/models.js';
import { Mailbox } from './mailbox.js';
import { decideTurn, type TurnDecision, type TurnTrigger } from './orchestrator.js';
import type { Clock, Store, Transport } from './ports.js';
import type { ConceptPack, LedgerRow, MessageRow, RoomConfig } from './records.js';
import { limitsLine } from './prompts.whisper.js';
import { SCRIPT_ROUND_CARD, SCRIPT_WHISPERS } from './llm/script.psd-hessian.js';
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
  #lastFillWasScaffold = false;
  #typingUntil = 0;
  #openedAt: number;
  #firstHelpAt: number | null = null;

  constructor(deps: RoomActorDeps) {
    this.#d = deps;
    this.#openedAt = deps.clock.now();
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

  async sendMessage(text: string): Promise<void> {
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
      const row = this.#insertMessage({
        participantId: this.#studentParticipant().id,
        body,
      });
      this.#event('student', 'message.send', { seq: row.seq, chars: body.length });
      this.#d.store.rooms.update(this.#d.roomId, { consecutive_agent_turns: 0, expects_reply: 1 });
    });

    await this.#runAgentTurn('student_message', { studentBody: body });
  }

  typing(): void {
    this.#typingUntil = this.#d.clock.now() + 3_500;
    this.#timer.typing();
  }

  hold(): void {
    this.#timer.hold();
    this.#event('student', 'silence.timer.set', { reason: 'hold' });
  }

  pauseNudges(paused: boolean): void {
    this.#timer.setNudgesPaused(paused);
    this.#event('student', paused ? 'silence.timer.cancelled' : 'silence.timer.set', { reason: 'wait_for_me' });
  }

  // ── whisper ───────────────────────────────────────────────────────────────

  openWhisper(agentKey: string): WhisperThreadView {
    const agent = agentByKey(this.#d.roster, agentKey) ?? agentByRole(this.#d.roster, 'peer');
    const participant = this.#d.store.participants.byAgentKey(this.#d.roomId, agent.key);
    if (!participant) throw new Error(`No participant for ${agent.key}`);
    const threadId =
      this.#d.store.whispers.openThread(this.#d.roomId, participant.id) ?? this.#d.newId('wthread');
    const other = this.#d.roster.find((a) => a.key !== agent.key && a.role !== 'tutee');
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
  async sendWhisper(threadId: string, text: string): Promise<void> {
    const body = text.trim();
    if (body.length === 0) return;
    const thread = this.#d.store.whispers.forThread(threadId);
    const agentParticipantId =
      thread[0]?.agent_participant_id ?? this.#d.store.participants.byAgentKey(this.#d.roomId, agentByRole(this.#d.roster, 'peer').key)!.id;
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
  async relay(input: { threadId: string; whisperId: string; attribution: RelayAttribution; text: string }): Promise<void> {
    const whisper = this.#d.store.whispers.get(input.whisperId);
    const agentParticipantId = whisper?.agent_participant_id ?? null;
    const asAgent = input.attribution === 'as_agent' && agentParticipantId !== null;

    await this.#mailbox.enqueue(() => {
      this.#timer.cancel();
      const row = this.#insertMessage({
        participantId: asAgent ? agentParticipantId : this.#studentParticipant().id,
        body: input.text,
        promotedFromWhisper: input.whisperId,
      });
      this.#d.store.whispers.markPromoted(input.whisperId, row.id);
      this.#event('student', 'whisper.relay', { attribution: input.attribution, seq: row.seq });
    });

    // A relayed question is treated as an ordinary group turn from here on.
    await this.#runAgentTurn('promote');
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

  snapshot(): RoomSnapshot {
    const room = this.#room();
    const material = this.#d.store.materials.get(room.material_id)!;
    const participants = new Map(this.#d.store.participants.forRoom(this.#d.roomId).map((p) => [p.id, p]));
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
        .map((m) => messageView(m, participants, this.#d.roster)),
      ledger: ledgerView(this.#ledgerRows(), this.#d.pack),
      timer: timerView(this.#timer.snapshot, this.#d.config.silence_ms, this.#d.clock.now(), this.#typingActive()),
      thinking: this.#thinking,
      nudgesPaused: this.#timer.snapshot.nudgesPaused,
      mode: this.#d.config.mode,
      roundCard: SCRIPT_ROUND_CARD,
    };
  }

  // ── the turn itself ───────────────────────────────────────────────────────

  async #runAgentTurn(trigger: TurnTrigger, opts: { studentBody?: string; silenceStage?: 1 | 2 } = {}): Promise<void> {
    const turnStart = this.#d.clock.now();
    const pending: PendingTurn = { id: this.#d.newId('turn'), cancelled: false };
    this.#pending = pending;

    const room = this.#room();
    const decisionInput = {
      trigger,
      consecutiveAgentTurns: room.consecutive_agent_turns,
      agreementRun: room.agreement_run,
      silenceStage: opts.silenceStage,
      lastProbeType: this.#lastProbeType,
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

    // Generate now; hold the tokens until the floor. The buffer is the product decision.
    const generation = this.#generate(agent, decision, cue);

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
        disagreement: decision.disagreement
          ? JSON.stringify({
              marker: decision.disagreement.marker,
              targetAgentKey: agentByRole(this.#d.roster, decision.disagreement.targetRole).key,
              targetMessageId: this.#lastMessageIdByRole(decision.disagreement.targetRole),
            })
          : null,
      });
      const roomNow = this.#room();
      this.#d.store.rooms.update(this.#d.roomId, {
        state: 'open',
        pending_turn_id: null,
        pending_turn_due_ts: null,
        consecutive_agent_turns: roomNow.consecutive_agent_turns + 1,
        agreement_run: decision.disagreement ? 0 : roomNow.agreement_run + 1,
        last_speaker_id: agent.key,
      });
      this.#event(decision.role!, 'agent.turn.dispatched', {
        seq: row.seq,
        latency_target_ms: target,
        ttft_actual_ms: ttft,
        usage,
      });
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

  async #runSilenceFill(stage: 1 | 2): Promise<void> {
    this.#silenceFires += 1;
    await this.#runAgentTurn('silence', { silenceStage: stage });
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
        note: decision.mustDisagree
          ? 'You have agreed with the other agent for several turns. Differ with them visibly this turn where you honestly do.'
          : undefined,
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
      created_at: this.#nowIso(),
    };
    this.#d.store.messages.insert(row);
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
    const view: MessageView = messageView(row, participants, this.#d.roster);
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

  #lastMessageIdByRole(role: AgentProfile['role']): string | null {
    const key = agentByRole(this.#d.roster, role).key;
    const participant = this.#d.store.participants.byAgentKey(this.#d.roomId, key);
    if (!participant) return null;
    const rows = this.#d.store.messages.forRoom(this.#d.roomId).filter((m) => m.participant_id === participant.id);
    return rows.at(-1)?.id ?? null;
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
    const beat = this.#d.config.mode === 'scripted' ? scriptRelayOffer(turn) : null;
    return beat;
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
    return {
      roomId: this.#d.roomId,
      conceptTitle: this.#d.pack.title,
      before: beforeView.rows,
      after: view.rows,
      bloom: view.bloom,
      actProfile: [
        { label: 'claims established', count: view.rows.filter((r) => r.state !== 'not_yet').length },
        { label: 'defended under challenge', count: view.rows.filter((r) => r.state === 'defended').length },
        { label: 'revisited', count: view.rows.filter((r) => r.revisit).length },
      ],
      unaidedMs: (this.#firstHelpAt ?? this.#d.clock.now()) - this.#openedAt,
      corrections: [...resolvedByLearner, ...openMisconceptions],
      openQuestions: view.rows.filter((r) => r.state === 'not_yet').map((r) => `What about ${r.learnerLabel}?`),
      teachbackOffer: tutee
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
