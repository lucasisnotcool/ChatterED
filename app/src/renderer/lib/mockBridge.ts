/**
 * ────────────────────────────────────────────────────────────────────────────
 *  DEV-ONLY SCAFFOLDING. Not shipped behaviour, not a spec.
 *  Replays design-brief.md §G so `vite dev` alone shows a working UI without
 *  Electron. The real implementation of every call here lives in the main
 *  process; this file exists so the renderer can be built and looked at.
 * ────────────────────────────────────────────────────────────────────────────
 */
import type { ChatterEdApi } from '../../shared/ipc.js';
/**
 * **The real classifier, imported and not copied** (issue #47, `attempt-first.md` §2.2).
 *
 * `src/room/attempt.ts` is where the rule lives, because the orchestrator's answer-withholding
 * rules read it. It is pure and its only import is `room/ledger.ts`'s `isAgreementPhrase`, which
 * itself imports nothing but types — so there is no main-process module graph to pull into
 * `vite dev`, and a local copy would only be a second rule to drift from. The mock classifies a
 * learner turn with exactly the function the real loop classifies it with; `labels.test.ts` has
 * reached across the same seam, for the same reason, since the room shipped.
 */
import { classifyLearnerTurn } from '../../room/attempt.js';
import { DECK_ANCHOR_ID, guessScope, scopeShownFor, type AskScope } from '../../shared/scope.js';
import { refusalMessage, type SegmentDocumentView, type SegmentRefusal } from '../../shared/segment/index.js';
import type { LearningObjective, LearningObjectiveState, LearningTree } from '../../shared/objectives.js';
import { DOC_ANCHOR_ID, SPAN_THREAD_PREFIX } from '../../shared/doc/types.js';
import type {
  AgentAuthor,
  AgentDocOpBatch,
  DocEditRecord,
  DocQuizView,
  NotesDocView,
  PrivateTurnView,
  ProgressObjectiveView,
  ProgressView,
  QResolution,
  Suggestion,
  ThreadView,
} from '../../shared/doc/types.js';
import { parseMention } from './chatview.js';
import {
  MOCK_CONTENT_SHA,
  MOCK_DOC_ID,
  MOCK_FILE_ID,
  MOCK_FILE_NAME,
  MOCK_PAGE_COUNT,
  MOCK_TITLE,
  MOCK_WINDOWS,
  mockBlockOnPage,
  mockLastBlockId,
  mockNotesJson,
  // Renamed on the way in: this file already has a `mockObjectives`, and it is the *other* kind
  // — the learning-objective tree the retired panel drew (#38).
  mockObjectives as fixtureObjectives,
} from './mockNotes.js';
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
  VaultFileView,
  VaultView,
  WhisperThreadView,
  WhisperTurnView,
} from '../../shared/types.js';

/**
 * The dev vault: one topic, one file, and the file is the demo deck the brief names (§7).
 *
 * See `openDocument` below for why this is no longer empty. The display name carries
 * `(dev fixture)` wherever it is shown, so nothing on screen claims a file was read from disk.
 */
const MOCK_VAULT_FILE: VaultFileView = {
  id: MOCK_FILE_ID,
  name: `${MOCK_FILE_NAME} (dev fixture)`,
  relPath: `CS3249/${MOCK_FILE_NAME}`,
  kind: 'pdf',
  size: 2_525_927,
  mtimeMs: 1_758_240_000_000,
  topicId: 'cs3249',
  pageCount: MOCK_PAGE_COUNT,
  indexed: true,
  indexError: null,
};

const MOCK_VAULT: VaultView = {
  rootPath: '~/vault (dev fixture)',
  displayName: 'Dev fixture vault',
  topics: [
    {
      id: 'cs3249',
      name: 'CS3249',
      relPath: 'CS3249',
      colour: '#2f6f8f',
      moduleCode: 'CS3249',
      fileCount: 1,
    },
  ],
  otherCount: 0,
  totalFiles: 1,
  lastScanAt: new Date(1_758_240_000_000).toISOString(),
  index: { total: 1, done: 1, failed: 0, running: false, current: null },
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
  const TRY_FEEDBACK = [
    'Partly there. That lands the first half: you have the read-only part, and p. 3: "no tools of ' +
      'its own" is where the deck settles it.',
    'What is missing is the second half. p. 3: "nothing carried between calls" — the exchange is ' +
      'not only unable to act, it is not remembered either, and your sentence only rules out the ' +
      'first. So, in your own words: what happens to the exchange after the answer comes back?',
  ].join('\n\n');

  const TRY_CLARIFY =
    'Fair question, and I will answer it without answering mine. "The history" here means the ' +
    'transcript the main agent goes on to read — not your own scrollback. So, once more: which two ' +
    'things can the side channel not reach? That did not count as a try.';

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
        verdict: null,
      });
    });
  }

  /** One learner turn into an open quiz, by §2.3's table. Every branch is a rule, never a model. */
  function mockQuizTurn(anchorId: string, quiz: FlowQuizView, text: string, messageId: string): void {
    const kind = classifyLearnerTurn(text);
    if (kind === 'attempt') {
      quiz.attempts += 1;
      quiz.feedbackGiven = false;
      quiz.verdict = null;
      later(1200, () => {
        // The ledger runs on the attempt, as it does on every learner turn.
        moveLedger([['R1', quiz.attempts > 1 ? 'justified' : 'stated', text.slice(0, 64), null]]);
        moveMockObjective(messageId);
      });
      think(max, 9000, TRY_FEEDBACK, { anchorId, decidedBy: 'rule:quiz_feedback' }, () => {
        quiz.feedbackGiven = true;
        // The fixed text opens "Partly there." and ends on a follow-up, as the prompt requires.
        quiz.verdict = 'partial';
      });
      return;
    }
    if (kind === 'give_up') {
      /**
       * **`rule:answer_withheld` is retired** (#48, `collab-doc.md` §4.4 and §9).
       *
       * #47 held the answer back until one attempt and answered an early request with a hint.
       * The collab-doc brief reverses that on Lucas's reason: a learner must never see a question
       * they never get the answer to, and a refused answer teaches less than a lowered question.
       * So a give-up releases at once, with or without an attempt — and it still fills nothing,
       * which is the half of #47 that survives. `TRY_HINT` goes with the rule that used it.
       */
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

  // ══ the collaborative notes doc (#48, `docs/research/collab-doc.md`) ════════════════════════
  /**
   * Everything below replays the brief's own beats so the three renderer tracks can be built and
   * looked at under `vite dev`. It is scaffolding and not a spec — but the **shapes** are the
   * contract's, the **rules** are the brief's, and the two things a mock can get wrong in a way
   * that hides a real bug are deliberately honest here:
   *
   *  1. every decision is a rule, named on the turn (`decidedBy`), decided before any "model"
   *     is consulted — §4.2's table, in code, exactly as the orchestrator does it;
   *  2. progress moves **only** on the learner's own words. A released answer, Ellie's cue and
   *     an agreement fill nothing, and there is no branch here that could make them.
   *
   * The conversation's words are fixed text. The grounds in them are not decoration: they cite
   * pages the fixture document actually carries, so a `p. N` in the chat is clickable and lands
   * on a block that exists.
   */
  const notes = {
    docId: MOCK_DOC_ID,
    fileId: MOCK_FILE_ID,
    contentSha: MOCK_CONTENT_SHA,
    title: MOCK_TITLE,
    pageCount: MOCK_PAGE_COUNT,
    version: 1,
    doc: mockNotesJson(),
    frozen: false,
    edits: [] as DocEditRecord[],
    suggestions: [] as Suggestion[],
    windowsDone: 1,
    windowsTotal: 1 + MOCK_WINDOWS.length,
    status: 'none' as 'none' | 'pending' | 'streaming' | 'ready' | 'failed',
  };
  /** Objectives, and their fills. The one number the whole progress surface is drawn from. */
  let objectives: ProgressObjectiveView[] = fixtureObjectives();
  let editSeq = 0;
  let questionSeq = 0;
  let docTurns = 0;
  /** Threads by id: the doc chat, and one per span. Private threads are held separately. */
  const chatThreadMap = new Map<string, ThreadView>();
  const privateThreadMap = new Map<AgentAuthor, { threadId: string; turns: PrivateTurnView[] }>();
  /** §4.3 fires **once per question**; this is that latch, plus the timer it is armed on. */
  let cueHandle: ReturnType<typeof setTimeout> | null = null;
  /**
   * The silence threshold, shortened. `attempt-first.md` §5 scales it to reading time and floors
   * it at 120 s; the Demo pacing profile shortens it, and a mock nobody can sit through is a mock
   * nobody drives. 18 s is long enough to read Max's question and short enough to film.
   */
  const MOCK_SILENCE_MS = 18_000;

  const hex12 = () => globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12);

  function notesIngestView() {
    return {
      status: notes.status,
      windowsDone: notes.windowsDone,
      windowsTotal: notes.windowsTotal,
      // §2's refine pass runs on structured text + geometry on the default backend (contract E1).
      withImages: false,
      error: null,
    };
  }

  function notesView(): NotesDocView {
    return {
      docId: notes.docId,
      fileId: notes.fileId,
      contentSha: notes.contentSha,
      title: notes.title,
      pageCount: notes.pageCount,
      version: notes.version,
      doc: notes.doc,
      ingest: notesIngestView(),
      frozen: notes.frozen,
      edits: notes.edits.filter((e) => e.status === 'applied'),
      suggestions: notes.suggestions.filter((s) => s.status === 'open'),
    };
  }

  function emitNotesStatus(): void {
    emit({
      type: 'notes.status',
      roomId: ROOM,
      fileId: notes.fileId,
      docId: notes.docId,
      ingest: notesIngestView(),
    });
  }

  /** A thread, created on demand. The id **is** the anchor: there is no second key (§types). */
  function thread(threadId: string, seed: Partial<ThreadView> = {}): ThreadView {
    const found = chatThreadMap.get(threadId);
    if (found) return found;
    const made: ThreadView = {
      threadId,
      kind: threadId.startsWith(SPAN_THREAD_PREFIX) ? 'span' : 'doc',
      blockId: null,
      quote: null,
      agentKey: null,
      messageIds: [],
      lastSeenSeq: 0,
      quiz: null,
      createdAt: iso(),
      ...seed,
    };
    chatThreadMap.set(threadId, made);
    return made;
  }

  /** Push a thread's current state. Replaces the `refreshFlowQuiz` poll (contract D10). */
  function pushThread(t: ThreadView): void {
    t.messageIds = messages.filter((m) => m.anchorId === t.threadId).map((m) => m.id);
    emit({ type: 'chat.thread', roomId: ROOM, thread: { ...t, quiz: t.quiz ? { ...t.quiz } : null } });
  }

  function progressView(): ProgressView {
    const taught = objectives.filter((o) => !o.assumedByDeck);
    return {
      fileId: notes.fileId,
      docId: notes.docId,
      status: 'ready',
      completed: taught.filter((o) => o.fill === 1).length,
      total: taught.length,
      fraction: taught.length === 0 ? 0 : taught.reduce((s, o) => s + o.fill, 0) / taught.length,
      objectives: objectives.map((o) => ({ ...o })),
    };
  }

  function emitProgress(): void {
    emit({ type: 'progress.updated', roomId: ROOM, fileId: notes.fileId, progress: progressView() });
  }

  /**
   * Move one objective — **only ever from the learner's own words**, which is why every call site
   * below sits on an attempt and none sits on a release, a cue or an agreement (§6).
   */
  function fillObjective(objectiveId: string, fill: 0 | 0.5 | 1, evidence: string): void {
    objectives = objectives.map((o) =>
      o.objectiveId === objectiveId
        ? {
            ...o,
            fill,
            level: fill === 1 ? 3 : fill === 0.5 ? 2 : 0,
            evidence: evidence.slice(0, 160),
            lastMovedAt: iso(),
          }
        : o,
    );
    emitProgress();
  }

  function emitCursor(author: AgentAuthor, blockId: string | null, state: 'idle' | 'thinking' | 'typing'): void {
    emit({ type: 'doc.cursor', roomId: ROOM, docId: notes.docId, author, blockId, state });
  }

  /**
   * An agent edit, on its way to the renderer to be typed in behind the cursor.
   *
   * **Freeze is honoured here as well as in the renderer** (contract D4): the brief says an edit
   * that would have happened while frozen is *dropped, not queued*, and a mock that queued would
   * hide the one bug that rule exists to prevent.
   */
  function emitEdit(batch: Omit<AgentDocOpBatch, 'editId'>): string | null {
    if (notes.frozen) return null;
    editSeq += 1;
    const editId = `edit_mock_${editSeq}`;
    const full: AgentDocOpBatch = { ...batch, editId };
    emitCursor(batch.author, batch.focusBlockId, 'typing');
    emit({ type: 'doc.edit', roomId: ROOM, docId: notes.docId, batch: full });
    notes.edits.push({
      editId,
      docId: notes.docId,
      author: batch.author,
      cause: batch.cause,
      ops: batch.ops,
      status: 'applied',
      blockIds: [],
      why: batch.why,
      turnId: null,
      messageId: messages.at(-1)?.id ?? null,
      objectiveId: null,
      docVersion: notes.version,
      createdAt: iso(),
      resolvedAt: null,
    });
    later(1600, () => emitCursor(batch.author, null, 'idle'));
    return editId;
  }

  // ── the words ────────────────────────────────────────────────────────────────────────────
  // Fixed text, grounded in pages the fixture document actually carries.

  const ELLIE_ANSWERS = [
    'The short version is that a prototype exists **to be wrong cheaply**. So fidelity is an ' +
      'economic decision, not a craft one — p. 22 puts it as buying exactly as much realism as ' +
      'the question you are asking needs.\n\n' +
      'For a conversational interface that lands differently from a GUI: there are no screens to ' +
      'wireframe, so the pipeline is scripts → dialogue maps → Wizard of Oz (p. 38). What you are ' +
      'prototyping is the dialogue itself.',
    'Because the thing that breaks is almost never the wording — it is the **repair**. p. 39 ' +
      'lists the parts of a designed dialogue, and repair is the one it calls make-or-break: ' +
      'every other part can be mediocre and the system still works, but a conversation that ' +
      'cannot recover from a misunderstanding is over.\n\n' +
      'That is also why paper runs out so fast here. p. 34: paper hides feel and response time, ' +
      'and a repair turn is mostly timing.',
  ];

  const ELLIE_MENTION =
    'Just me, then. The bit I would hold on to is p. 20: every design goal should name the ' +
      'cheapest prototype that could falsify it. If you cannot name one, what you have written ' +
      'down is a hope rather than a goal.';

  const MAX_MENTION =
    'Directly, then. Name one design goal from your own project and the prototype that could ' +
      'falsify it. If the prototype you name is "build it and see", the goal is not testable yet.';

  const MAX_QUESTIONS = [
    'One question, then. You are building a coach that nags people to go for a walk. Which ' +
      'prototype would you build **first** to find out whether people would actually answer it — ' +
      'and name one thing that prototype could not tell you.',
    'Smaller one, since that landed. p. 34 splits what a paper session reveals from what it ' +
      'hides. Name one thing on the *hidden* side, in your own words.',
  ];

  const MAX_FEEDBACK_PARTIAL =
    'Partly there. You have the cheap-first half, and p. 22: "a prototype exists to be wrong ' +
      'cheaply" is where the deck settles it.\n\n' +
      'What is missing is the second half of my question. p. 34 lists four things a paper ' +
      'session hides, and one of them is exactly what a nagging coach lives or dies on. Which ' +
      'one, and why does it matter here?';

  const MAX_FEEDBACK_COMPLETE =
    'Well done. Timing is the one — p. 34: "feel — efficiency, response time" — and you said why ' +
      'it bites here rather than just naming it. A reminder that arrives at the wrong moment is ' +
      'not a wording problem and paper will never show it to you.\n\n' +
      'That is this objective done.';

  const MAX_CLARIFY =
    'Fair question, and I will answer it without answering mine. "Prototype" here means anything ' +
      'you could put in front of a person — a script read aloud counts. So: which one would you ' +
      'build first, and what would it fail to tell you?';

  const MAX_RELEASED =
    'Here it is, and it changes nothing on your progress — that only moves on words you wrote ' +
      'yourself.\n\n' +
      'Build the **paper prototype or the sample dialogue** first: p. 22, be wrong cheaply. What ' +
      'it cannot tell you is on p. 34 — look, feel, response time, and whether subtle feedback is ' +
      'noticed. For a nagging coach the fatal one is **timing**: the message that arrives at the ' +
      'wrong moment reads as nagging however well it is worded.\n\n' +
      'Next one on this will be smaller.';

  const MAX_NUDGE =
    'Take your time. A wrong attempt is worth more to me than a right silence — and if you would ' +
      'rather have the answer, say so and it is yours.';

  /** §4.3: unsure, partial, at most 60 words, and with one plausible student mistake in it. */
  const ELLIE_CUE =
    'I will go first, and I am genuinely not sure. I think you build the paper version — it is ' +
      'the cheapest thing that could be wrong. And I *think* paper would also show you whether ' +
      'the reminder lands at a good moment, because the timings are written on the script. Knock ' +
      'that second bit down if it is wrong.';

  /** §4.3: Max neither confirms nor corrects — he names the part worth improving. At most 50. */
  const MAX_PROMPT =
    'Ellie has the cheap-first half right. Look at her second sentence, about the script carrying ' +
      'the timing. p. 34 has a column for what a paper session hides. Improve on it, or tell me ' +
      'whether she is right.';

  // ── the doc chat (§4.1) ──────────────────────────────────────────────────────────────────

  /** Arm §4.3's cue on the open question. Fires once, then silence is left alone until closure. */
  function armCue(threadId: string): void {
    if (cueHandle) clearTimeout(cueHandle);
    cueHandle = setTimeout(() => {
      const t = chatThreadMap.get(threadId);
      if (!t?.quiz?.open || t.quiz.cueGiven || t.quiz.attempts > 0) return;
      t.quiz.cueGiven = true;
      pushThread(t);
      think(ellie, 4500, ELLIE_CUE, { anchorId: threadId, decidedBy: 'rule:ellie_cue' }, () => {
        // Max answers *her*, aimed at the learner. Two agent turns back to back is the cap
        // (MASG §5.4.4) and the silence rules are checked before it, which is contract E5.
        later(2600, () => {
          think(max, 6000, MAX_PROMPT, { anchorId: threadId, decidedBy: 'rule:max_prompt' });
        });
      });
    }, MOCK_SILENCE_MS);
  }

  /** Max asks one question: to the chat, and into the document as a Q block (§5.2). */
  function askDocQuestion(threadId: string, objectiveId: string, n = 0): void {
    questionSeq += 1;
    const questionId = `q_mock_${questionSeq}`;
    const body = MAX_QUESTIONS[Math.min(n, MAX_QUESTIONS.length - 1)]!;
    think(max, 9000, body, { anchorId: threadId, decidedBy: 'rule:max_followup' }, () => {
      const t = thread(threadId);
      const quiz: DocQuizView = {
        quizMessageId: `m${seq + 1}`,
        elementId: objectiveId,
        attempts: 0,
        feedbackGiven: false,
        answerShown: false,
        verdict: null,
        questionId,
        objectiveId,
        cueGiven: false,
        resolution: null,
        open: true,
      };
      t.quiz = quiz;
      pushThread(t);
      emitEdit({
        author: 'max',
        cause: 'q_block',
        focusBlockId: mockBlockOnPage(34),
        why: 'The document did not already ask this, so the question goes in where it is about.',
        ops: [
          {
            op: 'insert_q',
            anchorBlockId: mockBlockOnPage(34),
            questionId,
            objectiveId,
            text: 'Which prototype would you build first to find out whether people answer a nagging coach — and what could it not tell you?',
            prov: { pages: [22, 34], reason: 'asked in the conversation' },
          },
        ],
      });
      armCue(threadId);
    });
  }

  /** Resolve the open question in the document (§5.3). The Q block stays; the answer goes under it. */
  function resolveDocQuestion(threadId: string, resolution: QResolution): void {
    const t = chatThreadMap.get(threadId);
    const quiz = t?.quiz;
    if (!t || !quiz) return;
    quiz.open = false;
    quiz.resolution = resolution;
    pushThread(t);
    if (cueHandle) clearTimeout(cueHandle);
    emitEdit({
      author: 'max',
      cause: 'q_resolved',
      focusBlockId: mockBlockOnPage(34),
      why: `The question is resolved (${resolution}), so the correct version goes under it.`,
      ops: [
        {
          op: 'resolve_q',
          questionId: quiz.questionId,
          resolution,
          blocks: [
            {
              kind: 'paragraph',
              text:
                'Build the cheapest thing that could be wrong — a sample dialogue or a paper ' +
                'prototype. What it cannot show you is **feel and response time** (p. 34), and ' +
                'for a reminder that is the property the whole design rests on.',
              prov: { pages: [22, 34], reason: null },
            },
          ],
        },
      ],
    });
  }

  /** One learner turn into an open question — §4.2's table, as branches, before any "model". */
  function docQuizTurn(threadId: string, quiz: DocQuizView, text: string): void {
    const kind = classifyLearnerTurn(text);
    const t = thread(threadId);
    if (kind === 'give_up') {
      releaseDocAnswer(threadId, 'give_up');
      return;
    }
    if (kind === 'question') {
      think(max, 7000, MAX_CLARIFY, { anchorId: threadId, decidedBy: 'rule:quiz_clarify' });
      return;
    }
    if (kind !== 'attempt') {
      think(max, 7000, MAX_NUDGE, { anchorId: threadId, decidedBy: 'rule:quiz_nudge' });
      return;
    }
    quiz.attempts += 1;
    quiz.feedbackGiven = false;
    quiz.verdict = null;
    pushThread(t);
    if (cueHandle) clearTimeout(cueHandle);
    const second = quiz.attempts > 1;
    think(
      max,
      9000,
      second ? MAX_FEEDBACK_COMPLETE : MAX_FEEDBACK_PARTIAL,
      { anchorId: threadId, decidedBy: 'rule:quiz_feedback' },
      () => {
        quiz.feedbackGiven = true;
        quiz.verdict = second ? 'complete' : 'partial';
        pushThread(t);
        // The learner's own words, and only those, move the bar.
        fillObjective(quiz.objectiveId ?? 'obj-fidelity', second ? 1 : 0.5, text);
        if (second) resolveDocQuestion(threadId, 'you_got_this');
      },
    );
  }

  /** §4.4: the give-up path and the Pass control land in the same place, by design. */
  function releaseDocAnswer(threadId: string, by: 'give_up' | 'pass' | 'closure'): void {
    const t = chatThreadMap.get(threadId);
    const quiz = t?.quiz;
    if (!t || !quiz) return;
    if (cueHandle) clearTimeout(cueHandle);
    think(
      max,
      9000,
      MAX_RELEASED,
      { anchorId: threadId, decidedBy: by === 'closure' ? 'rule:closure' : 'rule:answer_released' },
      () => {
        quiz.answerShown = true;
        quiz.feedbackGiven = true;
        resolveDocQuestion(threadId, 'released');
      },
    );
  }

  /** One learner turn in the doc chat or a span thread. Every branch is §4.2's table. */
  function docChatTurn(threadId: string, text: string): void {
    const t = thread(threadId);
    const mine = post(text, null, { anchorId: threadId });
    pushThread(t);
    emit({
      type: 'turn.received',
      roomId: ROOM,
      received: {
        turnId: `turn_mock_${mockTurn + 1}`,
        messageId: mine.id,
        anchorId: threadId,
        receivedAt: iso(),
        yieldMs: 8000,
        etaMs: null,
        responder: null,
      },
    });

    // An open question takes the turn: the learner is answering, not starting a conversation.
    if (t.quiz?.open) {
      docQuizTurn(threadId, t.quiz, text);
      return;
    }

    const mention = parseMention(text);
    if (mention?.agent === 'max') {
      think(max, 9000, MAX_MENTION, { anchorId: threadId, decidedBy: 'rule:mention' });
      return;
    }
    if (mention?.agent === 'ellie') {
      think(ellie, 4500, ELLIE_MENTION, { anchorId: threadId, decidedBy: 'rule:mention' });
      return;
    }

    docTurns += 1;
    const n = docTurns;
    const answer = ELLIE_ANSWERS[Math.min(n - 1, ELLIE_ANSWERS.length - 1)]!;
    emitCursor('ellie', mockBlockOnPage(22), 'thinking');
    think(ellie, 4500, answer, { anchorId: threadId, decidedBy: 'rule:ellie_answers' }, () => {
      // §5.1: what she answered was not in the document, so she writes it in where it belongs.
      later(900, () =>
        emitEdit({
          author: 'ellie',
          cause: 'answer_missing',
          focusBlockId: mockBlockOnPage(22),
          why: 'Asked in the chat and the notes did not say it, so it goes in at the segment it belongs to.',
          ops: [
            {
              op: 'insert_after',
              anchorBlockId: mockBlockOnPage(22),
              blocks: [
                {
                  kind: 'paragraph',
                  text:
                    'Name the question before you choose the fidelity: the prototype you want is ' +
                    'the cheapest one that could **falsify** the design goal you wrote down.',
                  prov: { pages: [20, 22], reason: 'asked in the conversation' },
                },
              ],
            },
          ],
        }),
      );
      // Ellie answered in full, so the rule gives Max the floor for one question — and only
      // while nothing is already open (§4.2: one open Max question at a time per file).
      const open = [...chatThreadMap.values()].some((x) => x.quiz?.open);
      if (!open && n === 1) later(3200, () => askDocQuestion(threadId, 'obj-fidelity', 0));
    });
  }

  // ── private threads (§4.1) ───────────────────────────────────────────────────────────────

  function privateThread(agent: AgentAuthor) {
    const found = privateThreadMap.get(agent);
    if (found) return found;
    const made = { threadId: `priv_${agent}_${hex12()}`, turns: [] as PrivateTurnView[] };
    privateThreadMap.set(agent, made);
    return made;
  }

  const PRIVATE_REPLY: Record<AgentAuthor, string> = {
    ellie:
      'Not embarrassing, and nothing here reaches Max. Two sentences: **formative** studies are ' +
      'the ones you run while the design is still moving — small, quick, and the audience is ' +
      'your own team (p. 18). **Summative** ones are the ones you run when there is something to ' +
      'judge, and the audience is everybody else.\n\n' +
      'If it helps, put it in the document and it stops being a thing you have to hold in your head.',
    max:
      "Between us, and Ellie can't see this. You are allowed to ask me what the question is " +
      'asking — that is not the same as asking for the answer, and I will always answer it.\n\n' +
      'What I want from that question is one item from the *hidden* column of p. 34 and a reason ' +
      'it matters for a reminder specifically. One sentence is enough.',
  };

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

    /**
     * The vault needs a filesystem, which `vite dev` does not have — so it holds **exactly one
     * file, labelled as the fixture it is** (#48).
     *
     * This is a deliberate change from "empty, never fabricated". The argument for the empty
     * vault was that invented file names would be a screenshot of a lie; the argument for this
     * one row is that the collab doc's whole surface hangs off an open document, and a shell
     * that cannot be opened at all cannot be built or reviewed without Electron. The row names
     * the real deck, says `(dev fixture)` in its own display name, and opens the fixture notes —
     * which are themselves written from that deck, page by page. Nothing here claims to have
     * read a file it has not.
     */
    getVault: async () => MOCK_VAULT,
    chooseVault: async () => MOCK_VAULT,
    rescanVault: async () => MOCK_VAULT,
    topicCandidates: async () => [{ relPath: 'CS3249', name: 'CS3249', fileCount: 1, promoted: true }],
    promoteTopics: async () => MOCK_VAULT,
    vaultTree: async () => [
      { name: MOCK_FILE_NAME, relPath: `CS3249/${MOCK_FILE_NAME}`, dir: false, children: [], file: MOCK_VAULT_FILE },
    ],
    findFiles: async () => [],
    searchVault: async () => [],
    openDocument: async ({ fileId }) =>
      fileId === MOCK_FILE_ID
        ? {
            fileId,
            name: `${MOCK_FILE_NAME} (dev fixture)`,
            relPath: `CS3249/${MOCK_FILE_NAME}`,
            absPath: `~/vault/CS3249/${MOCK_FILE_NAME}`,
            kind: 'pdf' as const,
            ext: '.pdf',
            size: 2_525_927,
            pageCount: MOCK_PAGE_COUNT,
            text: null,
            // No pdf.js bytes outside Electron: the carousel, the modal and the inline figures
            // degrade to their captions, and everything else is real.
            bytes: null,
            error: null,
          }
        : {
            fileId, name: '', relPath: '', absPath: '', kind: 'other' as const, ext: '', size: 0,
            pageCount: null, text: null, bytes: null, error: 'No vault outside Electron.',
          },
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

    // ── collab-doc (#48) ────────────────────────────────────────────────────────────────────

    /** Null until the deck has been ingested once — and it never starts one, as the channel says. */
    async notesGet() {
      return notes.status === 'none' ? null : notesView();
    },
    /**
     * The two-pass ingest, in miniature: the doc opens on window 1 and the rest fills in behind
     * the "Ellie is still writing" marker (§2). The windows only ever **append** after the
     * previous window's last block, which is the rule (contract E9) that makes it safe for the
     * learner to be typing while window 3 lands.
     */
    async notesIngest({ force }) {
      if (notes.status === 'ready' && force !== true) return notesView();
      notes.status = 'streaming';
      notes.windowsDone = 1;
      emitNotesStatus();
      MOCK_WINDOWS.forEach((blocks, i) => {
        later(1400 + i * 2600, () => {
          emit({
            type: 'notes.window',
            roomId: ROOM,
            fileId: notes.fileId,
            docId: notes.docId,
            /**
             * Window 2 names the last block of window 1; window 3 names nothing.
             *
             * The renderer mints the ids for a window's own blocks (`ops.appendWindow`), so the
             * mock cannot name the block window 2 ended on — and `appendWindow` treats a null
             * anchor as *the end of the document*, which is exactly right for the window after
             * one whose ids it does not know. Either way a window only ever **adds**, which is
             * the rule that makes it safe while the learner is already typing (contract E9).
             */
            afterBlockId: i === 0 ? mockLastBlockId() : null,
            blocks,
          });
          notes.windowsDone = i + 2;
          if (notes.windowsDone >= notes.windowsTotal) notes.status = 'ready';
          emitNotesStatus();
        });
      });
      return notesView();
    },
    /** No canvas in `vite dev` either; the fixture's one figure renders as its caption. */
    async notesPageImages({ images }) {
      return { stored: images.length };
    },
    /**
     * Optimistic save. The conflict branch is real — pass a stale `baseVersion` and the stored
     * doc comes back — because a renderer that has never met a conflict has never been tested
     * against the one thing that will happen the first time a window lands mid-keystroke (D5).
     */
    async notesSave({ baseVersion, doc }) {
      if (baseVersion !== notes.version) {
        return { ok: false as const, conflict: true as const, version: notes.version, doc: notes.doc };
      }
      notes.doc = doc;
      notes.version += 1;
      // The blocks moved, so the objectives' own block ids are re-derived from the saved doc —
      // by page intersection, through T2's `blocksForPages`, as the main process will.
      const fills = new Map(objectives.map((o) => [o.objectiveId, o]));
      objectives = fixtureObjectives(doc).map((o) => ({ ...(fills.get(o.objectiveId) ?? o), blockIds: o.blockIds }));
      return { ok: true as const, version: notes.version };
    },
    async notesFreeze({ frozen }) {
      notes.frozen = frozen;
      return { frozen };
    },
    async notesEditResolved({ editId, status, blockIds, suggestion }) {
      const edit = notes.edits.find((e) => e.editId === editId);
      if (edit) {
        edit.status = status;
        edit.blockIds = blockIds;
        edit.resolvedAt = status === 'applied' ? null : iso();
      }
      if (suggestion) notes.suggestions.push(suggestion);
    },
    async notesSuggestionResolved({ suggestionId, status }) {
      const found = notes.suggestions.find((s) => s.suggestionId === suggestionId);
      if (found) {
        found.status = status;
        found.resolvedAt = iso();
      }
    },
    /**
     * **The learner wrote in the document and paused** (§6). Main decides whether it is an
     * attempt; here it always is, and the whole of §6's path runs: a span thread, Max's feedback
     * in it, the objective moving on the learner's own words, and — because a correction to
     * learner text may never be applied over it — a **suggestion** rather than an edit (§5.4).
     */
    async notesDocText({ blockId, text }) {
      const threadId = `${SPAN_THREAD_PREFIX}${hex12()}`;
      const t = thread(threadId, { kind: 'span', blockId, quote: text.slice(0, 120) });
      post(text, null, { anchorId: threadId, kind: 'answer' });
      pushThread(t);
      think(
        max,
        9000,
        'Partly there, and this is your own sentence so it counts. p. 34: paper hides feel and ' +
          'response time — your line says "paper shows you the flow", which is right, but the ' +
          'word *and timing* in it is the part the deck contradicts. I have suggested the ' +
          'correction rather than making it; accept or reject it, it is your text.',
        { anchorId: threadId, decidedBy: 'rule:quiz_feedback' },
        () => {
          fillObjective('obj-paper', 0.5, text);
          const suggestionId = `sug_mock_${hex12()}`;
          const suggestion: Suggestion = {
            suggestionId,
            docId: notes.docId,
            editId: `edit_mock_${editSeq + 1}`,
            author: 'max',
            blockId,
            status: 'open',
            note: 'p. 34 lists response time under what paper hides.',
            threadId,
            createdAt: iso(),
            resolvedAt: null,
          };
          notes.suggestions.push(suggestion);
          emitEdit({
            author: 'max',
            cause: 'suggestion',
            focusBlockId: blockId,
            why: 'A correction to your own sentence is a suggestion, never an edit.',
            ops: [],
            suggestion: {
              blockId,
              quote: text.slice(0, 120),
              replacement: text.slice(0, 120).replace(/and timing/i, 'but not timing'),
              note: suggestion.note ?? '',
              threadId,
            },
          });
          emit({ type: 'doc.suggestion', roomId: ROOM, docId: notes.docId, suggestion });
        },
      );
      return { assessed: true, threadId, reason: null };
    },

    async chatThreads({ fileId }) {
      return {
        roomId: chatThreadMap.size > 0 ? ROOM : null,
        fileId,
        threads: [...chatThreadMap.values()].map((t) => ({ ...t, quiz: t.quiz ? { ...t.quiz } : null })),
      };
    },
    async chatSend({ fileId, threadId, text }) {
      const id = threadId ?? DOC_ANCHOR_ID;
      docChatTurn(id, text);
      void fileId;
      return { roomId: ROOM, threadId: id };
    },
    /** Highlight + Ctrl+E: the span's own thread, with the learner's question already in it. */
    async chatOpenSpan({ blockId, quote, question }) {
      const threadId = `${SPAN_THREAD_PREFIX}${hex12()}`;
      const t = thread(threadId, { kind: 'span', blockId, quote });
      post(question, null, { anchorId: threadId });
      pushThread(t);
      think(
        ellie,
        4500,
        'About that line specifically: it is the deck\'s own wording from p. 34, and the column ' +
          'it sits in is *hidden*, not *revealed*. The useful way to hold it is that paper tests ' +
          'the **structure** of the conversation and nothing about its **timing**.',
        { anchorId: threadId, decidedBy: 'rule:ellie_answers' },
      );
      return { roomId: ROOM, threadId };
    },
    async chatPrivateOpen({ agent }) {
      const t = privateThread(agent);
      return { roomId: ROOM, threadId: t.threadId, turns: t.turns.map((x) => ({ ...x })) };
    },
    async chatPrivateSend({ threadId, text }) {
      const entry = [...privateThreadMap.entries()].find(([, v]) => v.threadId === threadId);
      if (!entry) return;
      const [agent, held] = entry;
      const mine: PrivateTurnView = {
        id: `pt_${hex12()}`,
        role: 'learner',
        agentKey: agent,
        text,
        createdAt: iso(),
        insertedEditId: null,
      };
      held.turns.push(mine);
      emit({ type: 'chat.private', roomId: ROOM, threadId, turn: { ...mine } });
      later(agent === 'ellie' ? 2600 : 4200, () => {
        const reply: PrivateTurnView = {
          id: `pt_${hex12()}`,
          role: 'agent',
          agentKey: agent,
          text: PRIVATE_REPLY[agent],
          createdAt: iso(),
          insertedEditId: null,
        };
        held.turns.push(reply);
        emit({ type: 'chat.private', roomId: ROOM, threadId, turn: { ...reply } });
      });
    },
    /** The one path from private to shared (§4.1). It is the learner's click, never the agent's. */
    async chatInsertIntoDoc({ threadId, turnId, anchorBlockId }) {
      const entry = [...privateThreadMap.entries()].find(([, v]) => v.threadId === threadId);
      if (!entry) return { editId: null };
      const [agent, held] = entry;
      const turn = held.turns.find((t) => t.id === turnId);
      if (!turn) return { editId: null };
      const anchor = anchorBlockId ?? mockBlockOnPage(18);
      const editId = emitEdit({
        author: agent,
        cause: 'whisper_insert',
        focusBlockId: anchor,
        why: 'You asked for this privately and then asked for it in the document.',
        ops: [
          {
            op: 'insert_after',
            anchorBlockId: anchor,
            blocks: [
              {
                kind: 'paragraph',
                text: turn.text.split('\n\n')[0] ?? turn.text,
                prov: { pages: [18], reason: 'brought over from a private note' },
              },
            ],
          },
        ],
      });
      if (editId) {
        turn.insertedEditId = editId;
        emit({ type: 'chat.private', roomId: ROOM, threadId, turn: { ...turn } });
      }
      return { editId };
    },
    /** §4.4's Pass. The same release the give-up phrases get, and it fills nothing either. */
    async quizPass({ threadId }) {
      const t = chatThreadMap.get(threadId);
      if (!t?.quiz?.open) return { released: false, refused: 'No question is open here.' };
      releaseDocAnswer(threadId, 'pass');
      return { released: true, refused: null };
    },

    async progressGet({ fileId }) {
      void fileId;
      return progressView();
    },
    /**
     * A lesson card's **Start** (§6): Ellie says what we need to understand, the doc scrolls to
     * the segment that carries it, and she ends by asking the learner for a question. The scroll
     * target is returned rather than pushed, because the renderer owns where the document goes.
     */
    async progressStart({ objectiveId }) {
      const objective = objectives.find((o) => o.objectiveId === objectiveId) ?? objectives[0]!;
      const t = thread(DOC_ANCHOR_ID);
      const pages = objective.pages.length > 0 ? ` It is on ${objective.pages.map((n) => `p. ${n}`).join(', ')}.` : '';
      think(
        ellie,
        3600,
        `Right — **${objective.title.toLowerCase()}**.\n\n` +
          `What we need is this: ${objective.statement}${pages} I have scrolled the notes to the ` +
          'part that carries it.\n\n' +
          'Ask me something about it to begin — "I do not know where to start" is a perfectly ' +
          'good first question.',
        { anchorId: DOC_ANCHOR_ID, decidedBy: 'rule:lesson_start' },
        () => pushThread(t),
      );
      return { roomId: ROOM, threadId: DOC_ANCHOR_ID, blockId: objective.blockIds[0] ?? null };
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
