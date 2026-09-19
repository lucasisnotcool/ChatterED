/**
 * ────────────────────────────────────────────────────────────────────────────
 *  DEV-ONLY SCAFFOLDING. Not shipped behaviour, not a spec.
 *  Replays design-brief.md §G so `vite dev` alone shows a working UI without
 *  Electron. The real implementation of every call here lives in the main
 *  process; this file exists so the renderer can be built and looked at.
 * ────────────────────────────────────────────────────────────────────────────
 */
import type { ChatterEdApi } from '../../shared/ipc.js';
import { DECK_ANCHOR_ID, guessScope, scopeShownFor, type AskScope } from '../../shared/scope.js';
import { refusalMessage, type SegmentDocumentView, type SegmentRefusal } from '../../shared/segment/index.js';
import type { LearningObjective, LearningObjectiveState, LearningTree } from '../../shared/objectives.js';
import type {
  AgentProfile,
  Bootstrap,
  ConceptDraft,
  FlowQuizView,
  LedgerRowView,
  LedgerState,
  LedgerView,
  MessageView,
  RecapView,
  RelayAttribution,
  RoomEvent,
  RoomSnapshot,
  SettingsPatch,
  SettingsView,
  TimerView,
  TurnParticipantView,
  TurnTraceView,
  VaultView,
  WhisperThreadView,
  WhisperTurnView,
} from '../../shared/types.js';

const EMPTY_VAULT: VaultView = {
  rootPath: null,
  displayName: '',
  topics: [],
  otherCount: 0,
  totalFiles: 0,
  lastScanAt: null,
  index: { total: 0, done: 0, failed: 0, running: false, current: null },
};

function emptyFlow(fileId: string, refused?: SegmentRefusal['reason']): SegmentDocumentView {
  return {
    fileId,
    contentSha: '',
    genre: 'prose',
    notice: 'No document store outside Electron.',
    pageCount: 0,
    pageSizes: [],
    builds: [],
    segments: [],
    refused: refused ? { reason: refused, message: refusalMessage(refused) } : null,
  };
}

/**
 * ── the attempt loop's classifier, **copied on purpose** (issue #47) ──────────
 *
 * `docs/research/attempt-first.md` §2.2 puts the real one in `src/room/attempt.ts`, where the
 * orchestrator can call it; this is the dev mock's local copy, and it is a copy rather than an
 * import because this file is renderer-side scaffolding and must not pull the main process's
 * module graph into `vite dev`. **It has to track §2.2**, and the shared tests are the brief's own
 * examples — R6's literal lines — so a drift between the two shows up as a failure here.
 */
const ANSWER_REQUESTS = [
  'answer?',
  "what's the answer",
  'what is the answer',
  'just tell me',
  'give me the answer',
  'send me the answer',
  'show me the answer',
  'solve it',
  'please solve',
  'how would you do it',
  'how do you do it',
  'i give up',
  'skip',
] as const;

/** Ledger rule 4's agreement-only turns: a receipt, not a contribution. */
const AGREEMENT = new Set([
  'ok', 'okay', 'k', 'kk', 'yes', 'yeah', 'yep', 'no', 'nope', 'sure', 'right', 'cool', 'nice',
  'thanks', 'thank', 'you', 'got', 'it', 'i', 'see', 'understood', 'makes', 'sense', 'hmm', 'ah',
  'oh', 'alright', 'fine', 'great',
]);

export type MockLearnerTurn = 'attempt' | 'answer_request' | 'question' | 'other';

/**
 * §2.2, in the order the brief states it. The order matters: an answer request that happens to end
 * in `?` is an answer request, and "what's the answer?" must never be read as a clarification.
 *
 * **`attempt` is the default, and a two-word answer is an attempt.** It may not move the ledger —
 * rule 4's eight-word floor is a separate question, answered separately — but it lifts the answer
 * lock, which is §2.2's own sentence and the one thing this function exists to get right.
 */
export function classifyMockLearnerTurn(body: string): MockLearnerTurn {
  const text = body.replace(/[\u2018\u2019]/g, "'").trim().toLowerCase();
  if (text.length === 0) return 'other';
  const words = text.split(/\s+/);
  if (words.length <= 25 && ANSWER_REQUESTS.some((phrase) => text.includes(phrase))) {
    return 'answer_request';
  }
  // One sentence: nothing terminal before the final mark.
  const oneSentence = !/[.?!]\s/.test(text) && !/[.?!].+$/.test(text.slice(0, -1));
  if (words.length <= 25 && text.endsWith('?') && oneSentence) return 'question';
  if (words.every((w) => AGREEMENT.has(w.replace(/[^a-z']/g, '')))) return 'other';
  return 'attempt';
}

const ROOM = 'mock-room-1';
const SILENCE = 45000;
const iso = (offset = 0) => new Date(Date.now() + offset).toISOString();

const AGENTS: AgentProfile[] = [
  { key: 'peer.ellie', role: 'peer', displayName: 'Ellie', colour: '#0F7B6C', verb: 'typing', model: 'mock', latency: { ttftMinMs: 4000, ttftMaxMs: 6000 } },
  { key: 'challenger.max', role: 'challenger', displayName: 'Max', colour: '#B45309', verb: 'reading', model: 'mock', latency: { ttftMinMs: 9000, ttftMaxMs: 12000 } },
  { key: 'tutee.theo', role: 'tutee', displayName: 'Theo', colour: '#7C3AED', verb: 'typing', model: 'mock', latency: { ttftMinMs: 2000, ttftMaxMs: 3000 } },
];
const ellie = AGENTS[0]!;
const max = AGENTS[1]!;

const MOCK_CLI = { found: true, path: '/Users/you/.local/bin/claude', loggedIn: true, detail: null, checkedAt: iso() };
const mockSettings: SettingsView = {
  appVersion: '0.1.0-mock',
  backendChoice: 'auto',
  resolvedBackend: 'claude_cli',
  fellBackBecause: null,
  cli: MOCK_CLI,
  cliPathOverride: null,
  agentModel: 'sonnet',
  orchestratorModel: 'sonnet',
  modelChoices: ['haiku', 'sonnet', 'opus'],
  hasApiKey: false,
  vaultRoot: null,
  flowProfile: 'default',
  replySpeed: 'default',
  // The mock renderer shows the pacing strip, because the strip's first-open state is the one
  // worth being able to look at without Electron.
  pacingStripSeen: false,
  // No override in the mock: the built-in card is the state Settings opens in.
  rateCardOverride: '',
  rateCardErrors: [],
  rateCardDate: '2026-06-24',
};

const row = (id: string, label: string, learnerLabel: string): LedgerRowView => ({
  elementId: id, label, learnerLabel, level: 0, state: 'not_yet',
  evidenceText: null, evidenceMsgId: null, evidenceTurn: null,
  defendedAgainst: null, revisit: false, contested: false, openMisconceptions: [],
});

export function createMockBridge(): ChatterEdApi {
  const listeners = new Set<(e: RoomEvent) => void>();
  const emit = (e: RoomEvent) => listeners.forEach((l) => l(e));
  const later = (ms: number, fn: () => void) => { setTimeout(fn, ms); };

  let seq = 0;
  let turn = 0;
  let mockTurn = 0;
  /** Turns that have reached the floor and can therefore be stopped (audit §2 decision 2). */
  const stoppable = new Map<
    string,
    { agent: AgentProfile; anchorId: string | null; extra: Partial<MessageView>; body: string; floorAt: number }
  >();
  const traces: TurnTraceView[] = [];
  /** `flow:markSeen` and `flow:cardState`, which the real build persists with the sitting. */
  const seen = new Map<string, number>();
  const cardState = new Map<string, { collapsed?: boolean; removed?: boolean }>();
  let learnerTurns = 0;
  const messages: MessageView[] = [];
  const ledger: LedgerView = {
    rows: [
      row('R1', 'PSD Hessian everywhere on S ⇒ convex on S', 'PSD ⇒ convex on S'),
      row('R2', '"PSD" means zᵀHz ≥ 0 for all z, not entries ≥ 0', 'what PSD means'),
      row('R3', 'the condition must hold at every point of S', 'at every point of S'),
    ],
    covered: 0, total: 3, bloom: 'remember', coverage: 0,
  };
  let timer: TimerView = {
    deadlineTs: null, epoch: 0, silenceMs: SILENCE, stage: 0,
    paused: false, pausedReason: null, nudgesDone: false, now: iso(),
  };
  let fireHandle: ReturnType<typeof setTimeout> | null = null;
  let resumeHandle: ReturnType<typeof setTimeout> | null = null;

  const pushTimer = () => { timer = { ...timer, now: iso() }; emit({ type: 'timer.updated', roomId: ROOM, timer }); };

  function post(body: string, from: AgentProfile | null, extra: Partial<MessageView> = {}): MessageView {
    seq += 1; turn += 1;
    const m: MessageView = {
      id: `m${seq}`, seq, body, createdAt: iso(), latencyTargetMs: null, ttftActualMs: null,
      promotedFromWhisper: false, disagreement: null, divider: null, reference: null,
      anchorId: null, byRule: null,
      model: from ? 'mock' : null, backend: from ? 'scripted' : null, totalMs: null,
      decidedBy: null, stopped: false,
      speaker: from
        ? { kind: 'agent', key: from.key, role: from.role, displayName: from.displayName, colour: from.colour }
        : { kind: 'student', displayName: 'You' },
      ...extra,
    };
    messages.push(m);
    emit({ type: 'message.appended', roomId: ROOM, message: m });
    return m;
  }

  /**
   * One agent turn, with the **whole** event sequence the real actor emits (audit §2):
   * `agent.thinking` → the floor → `turn.delta` in word chunks → `message.appended` →
   * `turn.released`. Nothing streams before the floor: the mock buffers exactly as `actor.ts`
   * does, so a renderer that looks right here looks right against the CLI backend too.
   */
  function think(
    agent: AgentProfile,
    ms: number,
    body: string,
    extra: Partial<MessageView> = {},
    /**
     * Run the instant the turn lands and **before** `turn.released` is emitted (issue #47).
     * The attempt loop's state moves on the agent's turn — feedback landing sets `feedbackGiven`,
     * the answer turn sets `answerShown` — and the renderer re-reads the quiz on `turn.released`,
     * so a flag flipped any later than this would be read one gesture stale.
     */
    onLanded?: () => void,
  ) {
    const turnId = `turn_mock_${(mockTurn += 1)}`;
    const anchorId = extra.anchorId ?? null;
    const participant: TurnParticipantView = {
      agentKey: agent.key, role: agent.role, displayName: agent.displayName, colour: agent.colour,
    };
    const startedAt = Date.now();
    stoppable.set(turnId, { agent, anchorId, extra, body, floorAt: startedAt + ms });
    emit({ type: 'agent.thinking', roomId: ROOM, thinking: {
      agentKey: agent.key, displayName: agent.displayName, role: agent.role, colour: agent.colour,
      verb: agent.verb, startedAt: iso(), etaMs: ms, showCounter: agent.role === 'challenger',
    } });
    later(ms, () => {
      const live = stoppable.get(turnId);
      if (!live) return;
      // The flush: everything generated during the hold arrives as one delta, then the rest
      // unrolls. `ttftActualMs` is the first *visible* token, which is the floor.
      const chunks = chunkWords(body);
      let sent = 0;
      const step = () => {
        if (!stoppable.has(turnId)) return;
        const chunk = chunks[sent];
        if (chunk === undefined) {
          stoppable.delete(turnId);
          emit({ type: 'agent.thinking.cleared', roomId: ROOM });
          onLanded?.();
          const row = post(body, agent, {
            ...extra, latencyTargetMs: ms, ttftActualMs: ms, totalMs: Date.now() - startedAt,
            // A rule the caller named wins: `rule:answer_withheld` on this card is the whole
            // point of the card (`attempt-first.md` §2.3), and 'mock:script' would hide it.
            decidedBy: extra.decidedBy ?? 'mock:script',
          });
          emit({ type: 'turn.released', roomId: ROOM, turnId, messageId: row.id, stopped: false });
          traces.push({
            turnId, roomId: ROOM, anchorId, trigger: 'student_message', startedAt: iso(),
            decidedBy: 'mock:script', role: agent.role, moveType: 'respond', model: 'mock',
            backend: 'scripted', decisionMs: 2, generationMs: ms, ttftActualMs: ms,
            latencyTargetMs: ms, totalMs: Date.now() - startedAt, usage: {}, stopped: false, failed: null,
          });
          arm();
          return;
        }
        sent += 1;
        emit({ type: 'turn.delta', roomId: ROOM, turnId, anchorId, participant, text: chunk });
        later(45, step);
      };
      step();
    });
  }

  /** ~4 words a chunk, the rate a real stream arrives at. The first chunk is the flush. */
  function chunkWords(body: string): string[] {
    const words = body.split(/(\s+)/);
    const out: string[] = [];
    for (let i = 0; i < words.length; i += 8) out.push(words.slice(i, i + 8).join(''));
    return out;
  }

  function moveLedger(changes: [string, LedgerState, string | null, string | null][]) {
    for (const [id, state, quote, defended] of changes) {
      const r = ledger.rows.find((x) => x.elementId === id);
      if (!r) continue;
      r.state = state;
      r.level = state === 'defended' ? 3 : state === 'justified' ? 2 : state === 'stated' ? 1 : 0;
      if (quote) { r.evidenceText = quote; r.evidenceTurn = turn; r.evidenceMsgId = messages.at(-1)?.id ?? null; }
      if (defended) r.defendedAgainst = defended;
    }
    ledger.covered = ledger.rows.filter((r) => r.state !== 'not_yet').length;
    ledger.coverage = ledger.covered / ledger.total;
    ledger.bloom = ledger.rows.every((r) => r.state === 'defended') ? 'analyse'
      : ledger.covered >= 2 ? 'apply' : ledger.covered >= 1 ? 'understand' : 'remember';
    // A fresh object each time: the renderer holds its own copy of the snapshot.
    const snapshot: LedgerView = { ...ledger, rows: ledger.rows.map((r) => ({ ...r })) };
    emit({ type: 'ledger.updated', roomId: ROOM, ledger: snapshot, changed: changes.map((c) => c[0]) });
  }

  /** Arm the silence timer. The renderer only ever sees the absolute deadline. */
  function arm(stage: 0 | 1 | 2 = timer.stage) {
    if (fireHandle) clearTimeout(fireHandle);
    if (timer.nudgesDone) return;
    timer = { ...timer, deadlineTs: iso(SILENCE), epoch: timer.epoch + 1, stage, paused: false, pausedReason: null };
    pushTimer();
    fireHandle = setTimeout(fire, SILENCE);
  }

  function fire() {
    if (timer.stage === 0) {
      timer = { ...timer, stage: 1 };
      post('Still turning it over? Happy to wait. Or I can make the question smaller if that helps.', ellie, {
        divider: { cause: '45s quiet · Ellie stepped in', control: 'dont_do_this' },
      });
      arm(1);
    } else {
      timer = { ...timer, stage: 2, nudgesDone: true, deadlineTs: null };
      post('Here is a half-thought you can knock down: I think the condition has to hold on the whole set, but I am not certain why openness matters.', ellie, {
        divider: { cause: '90s quiet · Ellie offered a starting point', control: 'dont_do_this' },
      });
      pushTimer();
    }
  }

  function onLearnerTurn() {
    learnerTurns += 1;
    if (learnerTurns === 1) {
      later(8000, () => {
        moveLedger([['R1', 'stated', 'if the Hessian is positive semidefinite then the function is convex', null]]);
        think(max, 11000,
          'You might not like this next question, and that is fine — I am testing the statement, not you. You said "if the Hessian is PSD then f is convex". PSD where? Your sentence works for a single point; the slide says something about a set. Does the point-version survive?');
      });
    } else if (learnerTurns === 3) {
      later(2000, () => {
        moveLedger([
          ['R2', 'defended', 'it is zᵀHz ≥ 0 for every vector z, not the entries', "defended against Max's probe on assumptions (turn 3)"],
          ['R3', 'justified', 'it cannot just be at the stationary point', null],
        ]);
        think(max, 10000,
          'Good — you moved the quantifier. Now make it bite. Give me a function on ℝ where the Hessian is PSD at one specific point and the function is not convex on any neighbourhood of that point. If no such function exists, your original sentence was fine after all.');
      });
    } else if (learnerTurns === 4) {
      later(2000, () => {
        moveLedger([
          ['R3', 'defended', "x³ has f″(0) = 0 and still isn't convex near 0", "defended against Max's probe on implications (turn 8)"],
          ['R1', 'defended', 'the set has to be convex, otherwise the segment does not stay inside', "defended against Max's probe on implications (turn 8)"],
        ]);
        think(ellie, 5000,
          'I will push back on Max here — I would have let your first version through, because in most tutorial problems S is all of ℝⁿ and the distinction never shows up. I think he was right to press it and I was being lazy. I am also not fully certain whether openness of S is doing real work.',
          { disagreement: { marker: 'pushes back on', targetAgentKey: max.key, targetMessageId: messages.filter((m) => m.speaker.kind === 'agent' && m.speaker.key === max.key).at(-1)?.id ?? null } });
      });
    } else {
      arm();
    }
  }

  function snapshot(): RoomSnapshot {
    return {
    roomId: ROOM, sessionId: 's1', moduleCode: 'MA3236', topic: 'Convexity and the Hessian',
    round: 1, state: 'open', startedAt: iso(-60000), agents: AGENTS,
    messages: messages.map((m) => ({ ...m })),
    ledger: { ...ledger, rows: ledger.rows.map((r) => ({ ...r })) },
    timer,
    thinking: null, nudgesPaused: false, mode: 'scripted', failures: [],
    material: {
      id: 'mat1', moduleCode: 'MA3236', title: 'Second-order condition for convexity',
      sourceKind: 'pdf_pages', fileName: 'Slides_L06_Convexity.pdf', fileId: null, pageFrom: 30, pageTo: 31,
      pageCount: 38, cacheEligible: false, tokenCount: 180,
      extractedText: 'Second-order condition for convexity\n\nA twice-differentiable f is convex on an open convex set S if and only if ∇²f(x) ⪰ 0 for every x ∈ S.\n\nHere ⪰ 0 means positive semidefinite: zᵀ∇²f(x)z ≥ 0 for every z.',
    },
    roundCard: {
      title: 'Round 1 · Explain',
      body: "Your slide: convexity and the Hessian. You'll explain it to Ellie and Max. They won't answer for you, they'll disagree with each other sometimes, and replies here are deliberately paced so you get room to think first. You can whisper to either of them privately. You have the last word.",
    },
    };
  }

  const whisperTurns: WhisperTurnView[] = [];
  /** segment id → its sitting's private thread id. The real actor keys the same way (§3.5). */
  const flowWhispers = new Map<string, string>();

  // ── the flow's thread (issue #25) ────────────────────────────────────────
  const locked = new Map<string, string>();
  let flowRoomOpen = false;
  let flowTurns = 0;

  /**
   * ── the attempt loop, drivable without Electron (issue #47) ──────────────
   *
   * anchor → the Tester's open question there, in exactly the shape the renderer reads. Kept after
   * the answer is shown rather than deleted, because §2.4's **Try another** is drawn off
   * `answerShown` and a deleted quiz would take the only on-ramp to the second question with it.
   */
  const flowQuizzes = new Map<string, FlowQuizView>();
  /** `meta.scriptCue = 'try:N'` in the real request — here, just so the copy can vary. */
  let tryCount = 0;

  /**
   * **The learning-objective tree, mocked** (issue #38, `learning-objectives.md` §2).
   *
   * Four objectives and one prerequisite the deck assumes, which is the smallest tree that
   * exercises every branch the panel has: nesting, an `assumedByDeck` node under the objective
   * that requires it, a node with refs and one without, and states at three different levels.
   * The real fixture for the demo deck lives in the main process, where the ingest is; this is
   * the `vite dev` stand-in, and like everything else in this file it is scaffolding.
   */
  const mockObjectives: LearningObjective[] = [
    {
      id: 'mock-btw-spec', fileId: '', title: 'State what /btw promises to do', kind: 'objective',
      statement: 'Say what /btw is for: a question about the current work that does not enter the conversation history.',
      criteria: ['names both halves — ask now, leave the history untouched', 'says the answer comes from the session already open'],
      quizSeeds: ['What does /btw promise about the conversation history?'],
      refs: [{ page: 2 }], parentId: null, requires: ['mock-context-window'], assumedByDeck: false, order: 1,
    },
    {
      id: 'mock-context-window', fileId: '', title: 'What a context window is', kind: 'prerequisite',
      statement: 'The bounded span of tokens a model can attend to in one call, and why it has to be spent on something.',
      criteria: ['says it is bounded', 'says what competes for it'],
      quizSeeds: ['Why does a side question cost the main one anything at all?'],
      refs: [], parentId: null, requires: [], assumedByDeck: true, order: 1,
    },
    {
      id: 'mock-btw-limits', fileId: '', title: 'Name what /btw cannot see', kind: 'objective',
      statement: 'No tools, no memory between calls, and nothing outside the session it is asked in.',
      criteria: ['names the missing tools', 'names the missing memory'],
      quizSeeds: ['You ask /btw about a file it has not read. What happens?'],
      refs: [{ page: 3 }], parentId: null, requires: [], assumedByDeck: false, order: 2,
    },
    {
      id: 'mock-btw-cost', fileId: '', title: 'Explain what the side channel costs', kind: 'objective',
      statement: 'The private exchange is paid for out of the same window the main work is using.',
      criteria: ['says who pays', 'says what gets less'],
      quizSeeds: ['Where does the cost of a private question land?'],
      refs: [{ page: 5 }], parentId: 'mock-btw-limits', requires: [], assumedByDeck: false, order: 3,
    },
  ];
  const mockStates = new Map<string, LearningObjectiveState>(
    mockObjectives.map((o, i) => [
      o.id,
      {
        objectiveId: o.id, fileId: '',
        level: (i === 0 ? 2 : i === 1 ? 1 : 0) as LearningObjectiveState['level'],
        evidenceMessageIds: [], lastMovedAt: i < 2 ? iso(-600_000) : null, taughtAt: i < 2 ? iso(-900_000) : null,
      },
    ]),
  );

  function mockTree(fileId: string): LearningTree {
    return {
      fileId, contentSha: 'mock-sha', generatedAt: iso(-1_800_000), model: 'mock-sonnet', version: 1,
      status: 'ready',
      objectives: mockObjectives.map((o) => ({ ...o, fileId })),
    };
  }

  function mockStatesFor(fileId: string): LearningObjectiveState[] {
    return [...mockStates.values()].map((s) => ({ ...s, fileId }));
  }

  /** One node moves per learner turn, so the panel's lighting animation is drivable offline. */
  function moveMockObjective(messageId: string): void {
    const next = mockObjectives.find((o) => (mockStates.get(o.id)?.level ?? 0) < 2);
    if (!next) return;
    const before = mockStates.get(next.id)!;
    const state: LearningObjectiveState = {
      ...before,
      level: (before.level + 1) as LearningObjectiveState['level'],
      evidenceMessageIds: [...before.evidenceMessageIds, messageId],
      lastMovedAt: iso(),
    };
    mockStates.set(next.id, state);
    emit({ type: 'objectives.state', roomId: ROOM, fileId: mockFileId, state: { ...state, fileId: mockFileId } });
  }

  /** Whichever file the panel last asked about — the mock has exactly one deck. */
  let mockFileId = 'mock-file-1';

  const REFERENCE_ANSWER = [
    '`/btw` asks a question inside the session you already have open. It reads the conversation',
    'so far and nothing else: it has no tools of its own, no memory between calls, and the',
    'exchange is not appended to the conversation history the main agent goes on to use.',
    '',
    '───',
    "Now say it back in your own words and I'll tell you what's missing.",
  ].join('\n');

  const FLOW_TEACHER = [
    'That is the right half of it. You have said what it reads — now say what it cannot do, because that is where the interesting part is. What happens to the answer afterwards?',
    'Good. So the side channel is read-only *and* the exchange is discarded. Hold on to both halves; they come apart under pressure.',
  ];

  const FLOW_TESTER =
    'You might not like this next question, and that is fine — I am testing the statement, not you. ' +
    'You said the exchange "is not added to the history". The deck has a test where it claimed to write a todo and did not. ' +
    'Is that the same property, or a different one? If it is different, name both.';

  // ── the Tester's own copy, for the loop (issue #47, §2.3 and §3) ─────────
  /**
   * Max's turns, in the five shapes §2.3's table names. They are *mock* text and not a spec — but
   * the **grounds** are load-bearing: §3 asks every point in feedback to say where the deck settles
   * it, as `p. N: "…"`, and the renderer's job (item 4) is to make that `p. N` clickable. A mock
   * that never produced the citation could not be used to look at the thing being built.
   */
  const TRY_HINT =
    'Not yet — the answer is not mine to give before you have tried once. One narrowing: the page ' +
    'lists three things the side channel cannot reach, and two of them are about *state* rather ' +
    'than permission. Name either one and the answer is yours.';

  const TRY_FEEDBACK = [
    'That lands the first half. You have the read-only part, and p. 3: "no tools of its own" is ' +
      'where the deck settles it.',
    'What is missing is the second half. p. 3: "nothing carried between calls" — the exchange is ' +
      'not only unable to act, it is not remembered either, and your sentence only rules out the ' +
      'first. Say what happens to the exchange after the answer and you have the whole of it.',
  ].join('\n\n');

  const TRY_CLARIFY =
    'Fair question, and I will answer it without answering mine. "The history" here means the ' +
    'transcript the main agent goes on to read — not your own scrollback. Now: same question.';

  const TRY_NUDGE = 'Take your time. I am not going anywhere, and a wrong attempt is worth more to me than a right silence.';

  const TRY_ANSWER =
    'Here it is, and it changes nothing on your progress — the ledger only moves on words you ' +
    'wrote yourself.\n\n' +
    'Two properties, not one. p. 3: "no tools of its own" is the read-only half: the side channel ' +
    'cannot act, so a todo it claims to have written was never written. p. 5: "paid for out of the ' +
    'same window" is the other half: the exchange is answered *from* the main context without being ' +
    'added to it, so the cost has moved rather than disappeared.\n\n' +
    'Your attempt had the first. The second is the one the deck spends a page on.';

  /**
   * §2.1's pick, as much of it as a mock deck can have: the lowest ledger level first, deck order
   * as the tie-break. The card's own objectives cannot be honoured here — this file has no deck to
   * resolve a segment against — so it is level-ordered over the whole tree, which is the half of
   * the rule that the **Try another** button is actually about.
   */
  function pickMockObjective(objectiveId?: string): LearningObjective | null {
    if (objectiveId) return mockObjectives.find((o) => o.id === objectiveId) ?? null;
    const ranked = [...mockObjectives]
      .filter((o) => o.refs.length > 0)
      .sort((a, b) => (mockStates.get(a.id)?.level ?? 0) - (mockStates.get(b.id)?.level ?? 0) || a.order - b.order);
    return ranked[0] ?? null;
  }

  /** Max asks one question on an objective, and the quiz opens when the question *lands*. */
  function askMockQuiz(anchorId: string, objective: LearningObjective): void {
    tryCount += 1;
    const seed = objective.quizSeeds[0] ?? `Tell me what "${objective.title}" means in your own words.`;
    const body = tryCount === 1
      ? `One question, then. ${seed}`
      : `Another one, on the part you have shown least of. ${seed}`;
    // The *question* uses the short band (§2.1: the learner asked for it); the feedback keeps the
    // Tester's 9–12 s, which is the considered judgement Tan et al. is about.
    think(max, 4500, body, { anchorId, decidedBy: 'rule:try_here' }, () => {
      flowQuizzes.set(anchorId, {
        quizMessageId: `m${seq + 1}`,
        elementId: objective.id,
        attempts: 0,
        feedbackGiven: false,
        answerShown: false,
      });
    });
  }

  /** One learner turn into an open quiz, by §2.3's table. Every branch is a rule, never a model. */
  function mockQuizTurn(anchorId: string, quiz: FlowQuizView, text: string, messageId: string): void {
    const kind = classifyMockLearnerTurn(text);
    if (kind === 'attempt') {
      quiz.attempts += 1;
      quiz.feedbackGiven = false;
      later(1200, () => {
        // The ledger runs on the attempt, as it does on every learner turn.
        moveLedger([['R1', quiz.attempts > 1 ? 'justified' : 'stated', text.slice(0, 64), null]]);
        moveMockObjective(messageId);
      });
      think(max, 9000, TRY_FEEDBACK, { anchorId, decidedBy: 'rule:quiz_feedback' }, () => {
        quiz.feedbackGiven = true;
      });
      return;
    }
    if (kind === 'answer_request') {
      if (quiz.attempts === 0) {
        // The rule the whole brief is about. No ledger, no attempt, one hint that narrows it.
        think(max, 9000, TRY_HINT, { anchorId, decidedBy: 'rule:answer_withheld' });
        return;
      }
      showMockAnswer(anchorId, quiz);
      return;
    }
    if (kind === 'question') {
      // A clarification is not an attempt: the quiz stays open and `attempts` does not move.
      think(max, 9000, TRY_CLARIFY, { anchorId, decidedBy: 'rule:quiz_clarify' });
      return;
    }
    think(max, 9000, TRY_NUDGE, { anchorId, decidedBy: 'rule:quiz_nudge' });
  }

  /** The `rule:answer_shown` turn. **The ledger is not run on it**, and never is (§2.3). */
  function showMockAnswer(anchorId: string, quiz: FlowQuizView): void {
    think(max, 9000, TRY_ANSWER, { anchorId, decidedBy: 'rule:answer_shown' }, () => {
      quiz.answerShown = true;
      quiz.feedbackGiven = true;
    });
  }

  function flowView() {
    const anchors = [...new Set(messages.filter((m) => m.anchorId).map((m) => m.anchorId!))];
    // The deck thread first, as `flowRoomView()` does in the main process: a deck-level question
    // belongs above the flow, not under whichever slide happens to sit at that index.
    anchors.sort((a, b) => (a === DECK_ANCHOR_ID ? -1 : b === DECK_ANCHOR_ID ? 1 : 0));
    return {
      room: snapshot(),
      threads: anchors.map((anchorId) => ({
        anchorId,
        messageIds: messages.filter((m) => m.anchorId === anchorId).map((m) => m.id),
        lockedByAnswerId: locked.get(anchorId) ?? null,
        quiz: flowQuizzes.get(anchorId) ?? null,
        lastSeenSeq: seen.get(anchorId) ?? 0,
        collapsed: cardState.get(anchorId)?.collapsed ?? false,
        removed: cardState.get(anchorId)?.removed ?? false,
      })),
    };
  }

  /** One "+ Ask here" or "Ask about this deck", with the scope the card will show. */
  async function mockAsk(anchorId: string, question: string, scope?: AskScope) {
    flowRoomOpen = true;
    const resolved = scope ?? guessScope({ question, anchorId }).scope;
    const scopeShown = scopeShownFor({ scope: resolved, page: 3, outline: true });
    const asked = post(question, null, { anchorId });
    await new Promise((r) => setTimeout(r, 2400));
    const answer = post(REFERENCE_ANSWER, null, {
      anchorId,
      speaker: { kind: 'reference', displayName: 'REFERENCE' },
      scopeShown,
    });
    locked.set(anchorId, answer.id);
    return {
      roomId: ROOM, anchorId, questionId: asked.id, answerId: answer.id,
      body: answer.body, truncated: false, scopeShown, flow: flowView(),
    };
  }

  return {
    async bootstrap(): Promise<Bootstrap> {
      return {
        appVersion: '0.1.0-mock', hasApiKey: false, mode: 'scripted',
        backend: 'scripted', backendChoice: 'auto', cli: MOCK_CLI,
        pairing: 'ellie_peer', agents: AGENTS, firstRun: true,
        recentSessions: [
          { roomId: ROOM, conceptTitle: 'Convexity and the Hessian', states: ['defended', 'defended', 'justified'], endedAt: iso(-2 * 864e5), updatedAt: iso(-2 * 864e5) },
          { roomId: 'mock-room-0', conceptTitle: 'Amortised append', states: ['stated', 'not_yet', 'not_yet'], endedAt: iso(-8 * 864e5), updatedAt: iso(-8 * 864e5) },
        ],
      };
    },
    async setApiKey(_key: string) { return { ok: true }; },
    async clearApiKey() { /* no-op */ },
    async completeFirstRun() { /* no-op */ },

    async getSettings(): Promise<SettingsView> { return { ...mockSettings }; },
    async saveSettings(patch: SettingsPatch) {
      Object.assign(mockSettings, patch);
      return { ok: true, settings: { ...mockSettings } };
    },
    async detectCli(): Promise<SettingsView> {
      await new Promise((r) => setTimeout(r, 600));
      return { ...mockSettings };
    },

    async draftConcept(input): Promise<ConceptDraft> {
      await new Promise((r) => setTimeout(r, 1400));
      return {
        conceptId: 'c1', provenance: 'elicited',
        title: input.title || 'Convexity and the Hessian',
        claims: ledger.rows.map((r) => ({ id: r.elementId, label: r.label, learnerLabel: r.learnerLabel, levelThreeCriterion: '' })),
      };
    },
    async createSession() { return { roomId: ROOM }; },

    async openRoom(): Promise<RoomSnapshot> {
      if (messages.length === 0) {
        post("I'm curious how you'd set this one up — what's your first move when you see \"convex\" and \"Hessian\" in the same sentence?", ellie);
        later(400, () => arm(0));
      }
      return snapshot();
    },

    async sendMessage({ text }) {
      if (fireHandle) clearTimeout(fireHandle);
      if (resumeHandle) clearTimeout(resumeHandle);
      timer = { ...timer, deadlineTs: null, paused: false, pausedReason: null };
      pushTimer();
      post(text, null);
      onLearnerTurn();
    },

    async typing() {
      if (fireHandle) clearTimeout(fireHandle);
      if (resumeHandle) clearTimeout(resumeHandle);
      timer = { ...timer, paused: true, pausedReason: 'typing' };
      pushTimer();
      resumeHandle = setTimeout(() => arm(), 2500);
    },
    async holdTimer() {
      if (fireHandle) clearTimeout(fireHandle);
      timer = { ...timer, deadlineTs: iso(60000), epoch: timer.epoch + 1, paused: false, pausedReason: null };
      pushTimer();
      fireHandle = setTimeout(fire, 60000);
    },
    async pauseNudges({ paused }) {
      if (fireHandle) clearTimeout(fireHandle);
      if (paused) { timer = { ...timer, paused: true, pausedReason: 'user', deadlineTs: null }; pushTimer(); }
      else arm();
    },

    async logRendererError(): Promise<void> {
      /* The mock has no main process to forward to. */
    },
    async openLogFolder(): Promise<void> {
      /* No Finder in the mock. */
    },
    async diagnostics(): Promise<string> {
      return 'ChatterED (mock bridge)';
    },
    async retryTurn(): Promise<void> {
      /* The mock never fails a turn, so there is never a card to retry. */
    },
    async wrapUp(): Promise<RecapView> {
      const before = ledger.rows.map((r) => ({ ...r, state: 'not_yet' as LedgerState, level: 0 as const }));
      const recap: RecapView = {
        roomId: ROOM, conceptTitle: 'Convexity and the Hessian', before, after: ledger.rows.map((r) => ({ ...r })),
        bloom: ledger.bloom,
        actProfile: [
          { label: 'causal elaborations', count: 2 }, { label: 'example', count: 1 },
          { label: 'self-correction', count: 1 }, { label: 'self-monitoring', count: 1 },
          { label: 'challenge defended', count: 1 },
        ],
        unaidedMs: 112000,
        corrections: [{ text: 'Earlier you treated the PSD test as something you check at the stationary point. That is the second-order condition for a local minimum, which is a different statement.', caughtByLearner: true }],
        openQuestions: ['You said "open so the second derivative behaves" — Ellie was not sure either. What is openness of S actually doing? Check your slide.'],
        teachbackOffer: { agentKey: 'tutee.theo', displayName: 'Theo', blurb: 'Theo is a first year who has not seen this yet. Want 3 minutes to teach it to him? Ellie and Max will sit it out.' },
      };
      emit({ type: 'session.recap', roomId: ROOM, recap });
      return recap;
    },

    async acceptTeachback({ agentKey }) {
      const agent = AGENTS.find((a) => a.key === agentKey);
      return {
        available: false,
        note: `Noted — ${agent?.displayName ?? 'Theo'}'s round is the next thing being built.`,
      };
    },

    async openWhisper({ agentKey }): Promise<WhisperThreadView> {
      const agent = AGENTS.find((a) => a.key === agentKey) ?? ellie;
      whisperTurns.length = 0;
      return {
        threadId: 'w1', agent, turns: [],
        limitsLine: `I can see the group chat and I can explain background bits. I won't answer ${agent.role === 'peer' ? max.displayName : ellie.displayName}'s question for you, and nothing here reaches the group unless you send it over.`,
      };
    },
    async sendWhisper({ threadId, text }) {
      const mine: WhisperTurnView = { id: `w${whisperTurns.length + 1}`, threadId, seq: whisperTurns.length, sender: 'student', body: text, createdAt: iso(), relayOffer: null };
      whisperTurns.push(mine);
      emit({ type: 'whisper.turn', roomId: ROOM, threadId, turn: mine });
      later(2000, () => {
        const reply: WhisperTurnView = {
          id: `w${whisperTurns.length + 1}`, threadId, seq: whisperTurns.length, sender: 'agent', createdAt: iso(),
          body: 'Not embarrassing, and quick answer: no. Try A = [[1, 2], [2, 1]]. Every entry is positive. Take z = (1, −1)ᵀ: zᵀAz = 1 − 2 − 2 + 1 = −2. So entrywise-positive does not get you PSD. What that means for your R1 claim is still yours to work out.',
          relayOffer: {
            defaultAttribution: 'as_agent',
            draftText: 'Can we pin the definition down before we go further? I want to be sure I have got it: is "PSD" a statement about the entries of the matrix, or about something else entirely?',
          },
        };
        whisperTurns.push(reply);
        emit({ type: 'whisper.turn', roomId: ROOM, threadId, turn: reply });
      });
    },
    async relayWhisper({ threadId, attribution, text }: { roomId: string; threadId: string; whisperId: string; attribution: RelayAttribution; text: string }) {
      const note: WhisperTurnView = { id: `w${whisperTurns.length + 1}`, threadId, seq: whisperTurns.length, sender: 'agent', body: `Sent. ${attribution === 'as_agent' ? ellie.displayName + ' is raising it now.' : 'It is going up as your question now.'}`, createdAt: iso(), relayOffer: null };
      whisperTurns.push(note);
      emit({ type: 'whisper.turn', roomId: ROOM, threadId, turn: note });
      later(5000, () => { post(text, attribution === 'as_agent' ? ellie : null, { promotedFromWhisper: true }); arm(); });
    },
    async closeWhisper({ threadId }) { emit({ type: 'whisper.cleared', roomId: ROOM, threadId }); },

    // The vault needs a filesystem, which `vite dev` does not have. Empty, never fabricated:
    // a mock vault full of invented file names would be a screenshot of a lie.
    getVault: async () => EMPTY_VAULT,
    chooseVault: async () => null,
    rescanVault: async () => EMPTY_VAULT,
    topicCandidates: async () => [],
    promoteTopics: async () => EMPTY_VAULT,
    vaultTree: async () => [],
    findFiles: async () => [],
    searchVault: async () => [],
    openDocument: async ({ fileId }) => ({
      fileId, name: '', relPath: '', absPath: '', kind: 'other' as const, ext: '', size: 0,
      pageCount: null, text: null, bytes: null, error: 'No vault outside Electron.',
    }),
    revealFile: async () => undefined,
    sessionSeed: async ({ fileId }) => ({
      fileId, fileName: '', relPath: '', moduleCode: null, pageFrom: null, pageTo: null,
      text: '', topic: null,
    }),
    showDocument: async () => undefined,

    // Segments need pdf.js, a file and SQLite, none of which `vite dev` has. An empty flow with
    // the honest notice, for the same reason the vault above is empty: a mock deck of invented
    // slide titles would be a screenshot of a lie.
    /**
     * The conversation inside the flow (issue #25).
     *
     * The deck is still not faked — `getSegments` below is empty for the reason it always was —
     * but the *thread* is, because the thread is the thing being built and it has to be drivable
     * without Electron. It replays the shape `flow-build-plan.md` §2 beats 8–12 film, on
     * whichever segment id the caller names: REFERENCE card → (Explain it back) → learner →
     * Ellie → hand-off line → Max, with the ledger moving only on the learner's own words.
     */
    async flowAskHere({ segmentId, question, scope }) {
      return mockAsk(segmentId, question, scope);
    },
    /**
     * "Ask about this deck" (issue #35). Anchored to the synthetic deck anchor, which is what
     * puts the thread at the top of the flow; the mock says `whole deck` in the footer for the
     * same reason the real one does — the card must be able to say what it was shown.
     */
    async flowAskDeck({ question }) {
      return mockAsk(DECK_ANCHOR_ID, question, 'deck');
    },
    async flowExplainBack({ answerId }) {
      for (const [anchorId, id] of locked) {
        if (id !== answerId) continue;
        locked.delete(anchorId);
        return { unlocked: true, anchorId };
      }
      return { unlocked: false, anchorId: null };
    },
    /**
     * **Summarise into the document** (issue #41). Typed stub so the mock satisfies the API; the
     * body it posts is written from the thread's own turns rather than invented, so the card in
     * `vite dev` is at least the right *shape* — and it is inserted only on this call, never on
     * its own. Wire the real copy here when the flow UI lands.
     */
    async flowSummarise({ threadId }) {
      const said = messages.filter((m) => m.anchorId === threadId).map((m) => m.body).join(' ');
      const body = said.trim().split(/\s+/).slice(0, 60).join(' ');
      const card = post(body, null, { anchorId: threadId, kind: 'summary', sourceThreadId: threadId });
      return {
        roomId: ROOM, anchorId: threadId, messageId: card.id, sourceThreadId: threadId,
        body, truncated: false, regenerated: false, flow: flowView(),
      };
    },
    /** The conversation behind a summary card (issue #41). */
    async flowThreadOf({ summaryId }) {
      const card = messages.find((m) => m.id === summaryId);
      if (!card || card.kind !== 'summary' || !card.sourceThreadId) return null;
      const threadId = card.sourceThreadId;
      return {
        summaryId,
        threadId,
        messageIds: messages.filter((m) => m.anchorId === threadId && m.id !== summaryId).map((m) => m.id),
      };
    },
    /**
     * **"+ Try this"** (issue #47, `attempt-first.md` §2.1), driven.
     *
     * Creates the room like `flowAskHere`, picks the objective, and resolves **before** the question
     * exists — which is the real contract: the pick is synchronous, Max's question arrives on the
     * event stream at the short band, and `quiz` appears on the thread when it lands. A mock that
     * returned the quiz immediately would let the renderer get away with reading it from the return
     * value, which the real main process does not offer.
     */
    async flowTryHere({ segmentId, objectiveId }) {
      flowRoomOpen = true;
      const objective = pickMockObjective(objectiveId);
      if (!objective) {
        // §2.1's refusal: nothing to pick from. Inline on the card, never a dialog.
        return {
          roomId: ROOM, anchorId: segmentId, objectiveId: '',
          refused: 'No objectives for this deck yet.', flow: flowView(),
        };
      }
      askMockQuiz(segmentId, objective);
      return {
        roomId: ROOM, anchorId: segmentId, objectiveId: objective.id, refused: null, flow: flowView(),
      };
    },
    /**
     * **Show the answer** (§2.3 `rule:answer_shown`) — and the refusal that is the point of it.
     *
     * Refused before the first attempt even though the renderer does not offer the control then:
     * the lock is the orchestrator's, and a mock that honoured a call the real one rejects would
     * hide exactly the bug worth finding.
     */
    async flowShowAnswer({ threadId }) {
      const quiz = flowQuizzes.get(threadId);
      const no = (refused: string) => ({ roomId: ROOM, anchorId: threadId, shown: false, refused, flow: flowView() });
      if (!quiz) return no('No question is open here.');
      if (quiz.attempts === 0) return no("Try it once first — one attempt unlocks the answer.");
      if (quiz.answerShown) return no('The answer is already on the record here.');
      showMockAnswer(threadId, quiz);
      return { roomId: ROOM, anchorId: threadId, shown: true, refused: null, flow: flowView() };
    },
    async flowSend({ segmentId, text }) {
      const mine = post(text, null, { anchorId: segmentId });
      // "The room has your message", emitted before anything agent-shaped. Neutral, no name.
      emit({ type: 'turn.received', roomId: ROOM, received: {
        turnId: `turn_mock_${mockTurn + 1}`, messageId: mine.id, anchorId: segmentId,
        receivedAt: iso(), yieldMs: 8000, etaMs: null, responder: null,
      } });
      /**
       * **A quiz open here takes the turn** (§2.3): the rules are checked before anything else can
       * answer, because the learner is answering a question rather than starting a conversation.
       * Ellie's own path below is untouched and is what runs when no quiz is open.
       */
      const quiz = flowQuizzes.get(segmentId);
      if (quiz && !quiz.answerShown) {
        mockQuizTurn(segmentId, quiz, text, mine.id);
        return;
      }

      flowTurns += 1;
      const n = flowTurns;
      later(1200, () => {
        moveLedger([['R1', n === 1 ? 'stated' : 'justified', text.slice(0, 64), null]]);
        // The objectives panel moves on the learner's own words, exactly as the ledger does —
        // the same rule, the same turn, so the two surfaces cannot disagree offline either.
        moveMockObjective(mine.id);
      });
      if (n < 2) {
        think(ellie, 4500, FLOW_TEACHER[Math.min(n - 1, FLOW_TEACHER.length - 1)]!, { anchorId: segmentId });
        return;
      }
      // Two concepts in, Ellie hands off — written by the rule, then Max reads for 11 s.
      later(4200, () => {
        post(`You have covered what /btw can see and what it cannot — ${max.displayName}, over to you.`, ellie, {
          anchorId: segmentId, byRule: 'handoff',
        });
        think(max, 11000, FLOW_TESTER, { anchorId: segmentId });
      });
    },
    async flowMessages() {
      return flowRoomOpen ? flowView() : null;
    },

    /**
     * The whisper popover (§3.5), mocked to the same shape the real one has: one thread per
     * **segment sitting**, so ⌘K on a second card opens an empty one, and the turns live here
     * and nowhere the flow can draw them.
     */
    async flowWhisperOpen({ segmentId }) {
      flowRoomOpen = true;
      const existing = flowWhispers.get(segmentId);
      const threadId = existing ?? `wf_${flowWhispers.size + 1}`;
      if (!existing) {
        flowWhispers.set(segmentId, threadId);
        whisperTurns.length = 0;
      }
      return {
        roomId: ROOM,
        whisper: {
          anchorId: segmentId,
          threadId,
          agent: ellie,
          turns: whisperTurns.filter((t) => t.threadId === threadId),
          limitsLine: `I can see the document and this thread, and I can explain background bits. I can't answer this for you, and nothing here reaches ${max.displayName} unless you send it over.`,
        },
      };
    },
    async flowWhisperSend({ threadId, text }) {
      const mine: WhisperTurnView = { id: `wf${whisperTurns.length + 1}`, threadId, seq: whisperTurns.length, sender: 'student', body: text, createdAt: iso(), relayOffer: null };
      whisperTurns.push(mine);
      emit({ type: 'whisper.turn', roomId: ROOM, threadId, turn: mine });
      later(1600, () => {
        const reply: WhisperTurnView = {
          id: `wf${whisperTurns.length + 1}`, threadId, seq: whisperTurns.length, sender: 'agent', createdAt: iso(),
          body:
            "Not embarrassing, and it's the question page 6 is about. Two things first: I can see the flow and I can " +
            "explain background, but I won't answer " + max.displayName + "'s question for you, and nothing here reaches him unless you send it.\n\n" +
            'Short answer: no, not to the main thread. Steering mid-task puts your question and the reply into the main context; the side question is answered from that context without being added to it.',
          relayOffer: {
            defaultAttribution: 'as_me',
            draftText:
              'Can we put the page 6 claim on the record before we go further? If the side question is answered from main context but never added to it, the cost has moved rather than disappeared.',
          },
        };
        whisperTurns.push(reply);
        emit({ type: 'whisper.turn', roomId: ROOM, threadId, turn: reply });
      });
    },
    async flowWhisperRelay({ segmentId, attribution, text }) {
      const row = post(text, attribution === 'as_agent' ? ellie : null, {
        anchorId: segmentId,
        promotedFromWhisper: true,
      });
      return { messageId: row.id, anchorId: segmentId, attribution, flow: flowView() };
    },
    async flowWhisperClose({ threadId }) { emit({ type: 'whisper.cleared', roomId: ROOM, threadId }); },
    async flowSelection() { /* §B8's selection change: the mock has no silence timer to extend. */ },

    /**
     * Stop, with the real refusal: **only after the floor**. Before it the turn is still in the
     * deliberate wait the app exists for, and the renderer should not have offered the button.
     */
    async flowStop({ turnId }) {
      const live = stoppable.get(turnId);
      if (!live) return { stopped: false, refused: 'unknown' };
      if (Date.now() < live.floorAt) return { stopped: false, refused: 'floor' };
      stoppable.delete(turnId);
      emit({ type: 'agent.thinking.cleared', roomId: ROOM });
      const row = post(live.body.slice(0, Math.max(24, Math.floor(live.body.length / 3))), live.agent, {
        ...live.extra, stopped: true, decidedBy: live.extra.decidedBy ?? 'mock:script',
      });
      emit({ type: 'turn.released', roomId: ROOM, turnId, messageId: row.id, stopped: true });
      arm();
      return { stopped: true, turnId };
    },
    async flowTurnTrace({ turnId }) {
      return turnId ? traces.filter((t) => t.turnId === turnId) : [...traces];
    },
    async flowMarkSeen({ anchorId, seq: upTo }) {
      seen.set(anchorId, Math.max(seen.get(anchorId) ?? 0, upTo));
    },
    async flowCardState({ anchorId, collapsed, removed }) {
      const next = { ...(cardState.get(anchorId) ?? {}) };
      if (collapsed !== undefined) next.collapsed = collapsed;
      if (removed !== undefined) next.removed = removed;
      cardState.set(anchorId, next);
    },

    // ── The learning-objective tree (issue #38) ──────────────────────────
    async objectivesTree({ fileId }) {
      mockFileId = fileId;
      return mockTree(fileId);
    },
    async objectivesStates({ fileId }) {
      mockFileId = fileId;
      return mockStatesFor(fileId);
    },
    async objectivesRegenerate({ fileId }) {
      mockFileId = fileId;
      // Status first, then the answer: the real one takes half a minute of Sonnet and the panel
      // has to show "Ellie is reading the deck…" in between.
      emit({ type: 'objectives.tree', roomId: ROOM, fileId, tree: { ...mockTree(fileId), status: 'pending' } });
      later(2000, () => emit({ type: 'objectives.tree', roomId: ROOM, fileId, tree: mockTree(fileId) }));
      return { ...mockTree(fileId), status: 'pending' };
    },
    async objectivesReset({ fileId }) {
      mockFileId = fileId;
      for (const o of mockObjectives) {
        mockStates.set(o.id, {
          objectiveId: o.id, fileId, level: 0, evidenceMessageIds: [], lastMovedAt: null, taughtAt: null,
        });
      }
      return mockStatesFor(fileId);
    },
    async objectivesTeach({ fileId, objectiveId }) {
      mockFileId = fileId;
      const objective = mockObjectives.find((o) => o.id === objectiveId);
      if (!objective) return null;
      const requirer = mockObjectives.find((o) => o.requires.includes(objectiveId));
      const anchorId = String(objective.refs[0]?.segmentId ?? requirer?.refs[0]?.segmentId ?? DECK_ANCHOR_ID);
      flowRoomOpen = true;
      think(ellie, 3000, `Short version of ${objective.title.toLowerCase()}: ${objective.statement}`, { anchorId });
      const state = mockStates.get(objectiveId);
      if (state) {
        const taught = { ...state, taughtAt: iso() };
        mockStates.set(objectiveId, taught);
        emit({ type: 'objectives.state', roomId: ROOM, fileId, state: { ...taught, fileId } });
      }
      return { roomId: ROOM, anchorId, objectiveId };
    },

    getSegments: async ({ fileId }) => emptyFlow(fileId),
    splitSegment: async ({ fileId }) => emptyFlow(fileId, 'no-segment'),
    mergeSegments: async ({ fileId }) => emptyFlow(fileId, 'no-segment'),
    reorderSegments: async ({ fileId }) => emptyFlow(fileId, 'no-segment'),
    renameSegment: async ({ fileId }) => emptyFlow(fileId, 'no-segment'),
    onVaultChanged() { return () => undefined; },

    // The cost ledger, in `vite dev`: plausible numbers on the CLI path so the panel can be
    // looked at, and a `cost.updated` tick that never fires because nothing here calls a model.
    async costSummary(query) {
      const tokens = { input: 58_400, output: 4_120, cacheWrite: 540, cacheRead: 6_140 };
      const scale = query.level === 'app' ? 1 : query.level === 'file' ? 0.6 : 0.2;
      const t = {
        input: Math.round(tokens.input * scale),
        output: Math.round(tokens.output * scale),
        cacheWrite: Math.round(tokens.cacheWrite * scale),
        cacheRead: Math.round(tokens.cacheRead * scale),
      };
      const estimatedUsd = Number(((t.input * 2 + t.output * 10 + t.cacheWrite * 2.5 + t.cacheRead * 0.2) / 1e6).toFixed(6));
      const calls = Math.max(1, Math.round(24 * scale));
      const slice = (key: string) => ({ key, calls, tokens: t, estimatedUsd, reportedUsd: null });
      return {
        level: query.level,
        fileId: query.fileId ?? null,
        anchorId: query.anchorId ?? null,
        tokens: t,
        calls,
        estimatedUsd,
        reportedUsd: null,
        reportedCalls: 0,
        byModel: [slice('claude-sonnet-5')],
        byScope: [slice('group')],
        byBackend: [slice('claude-cli')],
        windowStart: null,
        firstCallAt: iso(),
        lastCallAt: iso(),
        mode: 'subscription',
        rateCardDate: '2026-06-24',
        cliWindow: {
          windowStart: iso(),
          windowEnd: iso(),
          hours: 5,
          tokens: t,
          calls,
          estimatedUsd,
          reportedUsd: null,
        },
        backfilledCalls: 0,
      };
    },
    async costRecent() { return []; },
    async costExport() { return { path: '~/Documents/ChatterED/usage-mock.csv', rows: 0, bytes: 0 }; },
    onCostUpdated() { return () => undefined; },

    onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    // `vite dev` has no window to be fullscreen; the traffic lights are never drawn there.
    onAppCommand() { return () => undefined; },
    onWindowState(listener) { listener({ fullScreen: false }); return () => undefined; },
  };
}
