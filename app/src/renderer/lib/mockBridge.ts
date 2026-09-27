/**
 * ────────────────────────────────────────────────────────────────────────────
 *  DEV-ONLY SCAFFOLDING. Not shipped behaviour, not a spec.
 *  Replays design-brief.md §G so `vite dev` alone shows a working UI without
 *  Electron. The real implementation of every call here lives in the main
 *  process; this file exists so the renderer can be built and looked at.
 * ────────────────────────────────────────────────────────────────────────────
 */
import type { ChatterEdApi } from '../../shared/ipc.js';
import { createMockTrial } from './mockTrial.js';
/**
 * **The real classifier, imported and not copied** (issue #47, `attempt-first.md` §2.2).
 *
 * `src/core/attempt.ts` is where the rule lives, because the orchestrator's answer-withholding
 * rules read it. It is pure and imports nothing (the core's lint boundary, SCOPE.md), so there is
 * no main-process module graph to pull into `vite dev`, and a local copy would only be a second
 * rule to drift from. The mock classifies a
 * learner turn with exactly the function the real loop classifies it with; `labels.test.ts` has
 * reached across the same seam, for the same reason, since the room shipped.
 */
import { classifyLearnerTurn } from '../../core/attempt.js';
import { DECK_ANCHOR_ID } from '../../shared/scope.js';
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
  LedgerRowView,
  LedgerState,
  LedgerView,
  MessageView,
  RecapView,
  RelayAttribution,
  RoomEvent,
  RoomSnapshot,
  ApiProvider,
  ProviderTestResult,
  ProviderView,
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
import {
  addTokens,
  emptyTokens,
  totalTokens,
  type CostAnalytics,
  type CostAnalyticsQuery,
  type CostCallView,
  type CostDayRow,
  type CostDocumentRow,
  type CostMessageCost,
  type CostScope,
  type CostSlice,
  type CostTokens,
} from '../../shared/cost.js';

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

function mockProvider(id: ApiProvider, label: string, agent: string, orchestrator: string, suggestions: string[]): ProviderView {
  return {
    id, label, hasKey: false, keyHint: null, keyRequired: id !== 'openai_compatible',
    keyFile: id === 'openai_compatible' ? 'openai-compatible-api-key' : `${id}-api-key`,
    configured: false, agentModel: agent, orchestratorModel: orchestrator,
    defaultAgentModel: agent, defaultOrchestratorModel: orchestrator, suggestions, baseUrl: null,
  };
}

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
  // BYOK: every provider unconfigured, so the Settings section opens in its empty state.
  providers: [
    mockProvider('anthropic', 'Anthropic', 'claude-haiku-4-5', 'claude-sonnet-5', ['claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5']),
    mockProvider('openai', 'OpenAI', 'gpt-6-sol', 'gpt-6-sol', ['gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra']),
    mockProvider('gemini', 'Google Gemini', 'gemini-3.8-flash', 'gemini-3.8-flash', ['gemini-3.5-flash-lite', 'gemini-3.8-flash']),
    mockProvider('openai_compatible', 'OpenAI-compatible endpoint', '', '', []),
  ],
  preferredProvider: null,
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
  /**
   * **The per-call tick, in `vite dev`.**
   *
   * `cost.updated` is not a `RoomEvent` — it rides the same channel and the store picks it out
   * before the switch — so the cast is the shape of the seam, not a shortcut. Without it the
   * per-message meters are invisible under the mock: the map is read once when the chat column
   * opens, which is before any reply exists, and nothing ever asks again. A fixture that cannot
   * show the feature is a fixture that cannot be used to design it.
   */
  const emitCostTick = (messageId: string): void => {
    const cost = mockMessageCost(messageId, 'message', null);
    emit({
      type: 'cost.updated',
      roomId: ROOM,
      update: {
        call: {
          id: `use_${messageId}`,
          createdAt: iso(),
          scope: 'group',
          model: 'claude-sonnet-5',
          backend: 'claude-cli',
          tokens: cost.tokens,
          estimatedUsd: cost.estimatedUsd,
          reportedUsd: cost.reportedUsd,
          durationMs: cost.ms,
          roomId: ROOM,
          fileId: null,
          anchorId: cost.anchorId,
          turnId: cost.turnId,
          backfilled: false,
          outcome: 'ok',
        },
        sessionTotals: { tokens: cost.tokens, calls: cost.calls, estimatedUsd: cost.estimatedUsd },
      },
    } as unknown as RoomEvent);
  };
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
    // Only an agent turn costs anything. A learner block must stay meterless, here too.
    if (from) emitCostTick(m.id);
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
    trial: createMockTrial(),
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
    async setProviderKey(input: { provider: ApiProvider; key: string }) {
      const p = mockSettings.providers.find((x) => x.id === input.provider);
      if (p) Object.assign(p, { hasKey: true, configured: true, keyHint: `••••${input.key.slice(-4)}` });
      return { ok: true };
    },
    async clearProviderKey(input: { provider: ApiProvider }) {
      const p = mockSettings.providers.find((x) => x.id === input.provider);
      if (p) Object.assign(p, { hasKey: false, configured: false, keyHint: null });
    },
    async testProvider(input: { provider: ApiProvider }): Promise<ProviderTestResult> {
      return { ok: false, provider: input.provider, model: '', ms: 0, error: 'The mock bridge makes no network calls.' };
    },
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
    /** The browser's own confirm stands in for main's native sheet in the dev harness. */
    async notesRegenerate({ fileId }) {
      void fileId;
      const confirmed = typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm('Regenerate these notes?') : true;
      return { confirmed, refused: null, view: null };
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
        emitCostTick(reply.id);
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
    async chatReset({ fileId }) {
      void fileId;
      const confirmed = typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm('Start a new conversation?') : true;
      return { confirmed, reset: confirmed };
    },
    /** §4.7's file close. The mock has no idle clock and no closure turn, so nothing is released. */
    async chatCloseFile({ fileId }) {
      void fileId;
      return { closing: false };
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
      return mockTree(fileId);
    },
    async objectivesStates({ fileId }) {
      return mockStatesFor(fileId);
    },
    async objectivesRegenerate({ fileId }) {
      // Status first, then the answer: the real one takes half a minute of Sonnet and the panel
      // has to show "Ellie is reading the deck…" in between.
      emit({ type: 'objectives.tree', roomId: ROOM, fileId, tree: { ...mockTree(fileId), status: 'pending' } });
      later(2000, () => emit({ type: 'objectives.tree', roomId: ROOM, fileId, tree: mockTree(fileId) }));
      return { ...mockTree(fileId), status: 'pending' };
    },
    async objectivesReset({ fileId }) {
      for (const o of mockObjectives) {
        mockStates.set(o.id, {
          objectiveId: o.id, fileId, level: 0, evidenceMessageIds: [], lastMovedAt: null, taughtAt: null,
        });
      }
      return mockStatesFor(fileId);
    },
    async objectivesTeach({ fileId, objectiveId }) {
      const objective = mockObjectives.find((o) => o.id === objectiveId);
      if (!objective) return null;
      const requirer = mockObjectives.find((o) => o.requires.includes(objectiveId));
      const anchorId = String(objective.refs[0]?.segmentId ?? requirer?.refs[0]?.segmentId ?? DECK_ANCHOR_ID);
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
      /**
       * **The scope breakdown is lopsided on purpose.**
       *
       * It used to be a single `group` row, which meant the one thing the document counter exists
       * to show — that reading the deck cost more than every conversation on it put together —
       * was invisible in the fixture and could only be checked by unit test. `notes` and
       * `objectives` are `isIngestScope`; the rest is conversation.
       */
      const part = (key: string, fraction: number, take: number) => ({
        key,
        calls: take,
        tokens: {
          input: Math.round(t.input * fraction),
          output: Math.round(t.output * fraction),
          cacheWrite: Math.round(t.cacheWrite * fraction),
          cacheRead: Math.round(t.cacheRead * fraction),
        },
        estimatedUsd: Number((estimatedUsd * fraction).toFixed(6)),
        reportedUsd: null,
      });
      /**
       * **The parts sum to the whole, exactly.**
       *
       * Rounding each slice independently let the breakdown come to fifteen calls under a header
       * that said fourteen — which real data cannot do, because the summary and the slices are the
       * same rows counted twice in SQL. A fixture that can disagree with itself teaches whoever is
       * looking at it to distrust the number, so the last slice takes the remainder.
       */
      const split = (shares: [string, number][]) => {
        let left = calls;
        return shares.map(([key, fraction], i) => {
          const take = i === shares.length - 1 ? left : Math.max(1, Math.round(calls * fraction));
          left -= take;
          return part(key, fraction, Math.max(0, take));
        });
      };
      const byScope =
        query.level === 'thread'
          ? split([['group', 0.78], ['orchestrator', 0.14], ['ledger', 0.08]])
          : split([
              ['notes', 0.58],
              ['group', 0.19],
              ['docedit', 0.08],
              ['objectives', 0.07],
              ['orchestrator', 0.05],
              ['ledger', 0.03],
            ]);
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
        byScope,
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
    async costRecent() { return mockCalls(); },
    async costExport() { return { path: '~/Documents/ChatterED/usage-mock.csv', rows: 0, bytes: 0 }; },
    onCostUpdated() { return () => undefined; },

    /**
     * **Per-message cost in `vite dev`** (#42 item B).
     *
     * Derived from the message id rather than random, so the same card shows the same number on
     * every reload and a screenshot can be compared with the one before it. The shape is the one
     * the real join produces: an agent turn carries `group` plus the `orchestrator` decision that
     * chose the speaker, roughly every third one also carries the `ledger` coding and the
     * `docedit` planner, and a learner message carries nothing at all — which is what makes the
     * meter's *absence* under a learner block something a designer can look at here.
     */
    async costMessages({ threadId }) {
      const out: CostMessageCost[] = [];
      for (const m of messages) {
        if (m.speaker.kind === 'student') continue;
        if (threadId && (m.anchorId ?? 'doc') !== threadId) continue;
        out.push(mockMessageCost(m.id, 'message', m.anchorId));
      }
      for (const w of whisperTurns) {
        if (w.sender !== 'agent') continue;
        if (threadId && w.threadId !== threadId) continue;
        out.push(mockMessageCost(w.id, 'whisper', w.threadId));
      }
      /**
       * The #48 private threads, which are the ones the shell actually renders. The contract says
       * they join through `whispers.turn_id` like any other whisper, so the fixture has to price
       * them or the meter in `PrivateThread.svelte` is dead under `vite dev` while being alive in
       * the app — the worst of the two ways a fixture can be wrong.
       */
      for (const [, thread] of privateThreadMap) {
        if (threadId && thread.threadId !== threadId) continue;
        for (const t of thread.turns) {
          if (t.role !== 'agent') continue;
          out.push(mockMessageCost(t.id, 'whisper', thread.threadId));
        }
      }
      return out;
    },

    /**
     * **The Usage page's fixture** (#42 item D).
     *
     * Deliberately *lopsided*: one deck whose notes ingest is four-fifths of its cost, one that
     * has barely been opened, and a day-by-day series with a quiet weekend in it. A fixture with
     * five equal bars makes every chart look fine and hides exactly the failures the page exists
     * to show — a ranked list that does not rank, a stacked bar whose segments are all the same
     * size, an axis that never has to round.
     */
    async costAnalytics(query) {
      return mockAnalytics(query ?? {});
    },

    onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    // `vite dev` has no window to be fullscreen; the traffic lights are never drawn there.
    onAppCommand() { return () => undefined; },
    onWindowState(listener) { listener({ fullScreen: false }); return () => undefined; },
  };
}

// ── The cost fixtures (#42 item E) ──────────────────────────────────────────
//
// Everything below is deterministic. `vite dev` is where the cost surfaces are designed and
// screenshotted, and a fixture that moves between reloads makes a before/after comparison
// worthless — so every number here is a pure function of an id or an index, and the same page
// renders identically on every run.

/** A small stable hash, so `m7` always costs what `m7` cost last time. */
function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function usdFor(tokens: CostTokens): number {
  // Sonnet 5's card rate, the same arithmetic `rates.ts` does: $2 / $10 per MTok, cache write
  // 1.25× input and cache read 0.1×.
  const usd = (tokens.input * 2 + tokens.output * 10 + tokens.cacheWrite * 2.5 + tokens.cacheRead * 0.2) / 1e6;
  return Number(usd.toFixed(6));
}

function scopeSlice(key: CostScope, tokens: CostTokens, calls = 1): CostSlice {
  return { key, calls, tokens, estimatedUsd: usdFor(tokens), reportedUsd: null };
}

function mockMessageCost(id: string, kind: 'message' | 'whisper', anchorId: string | null): CostMessageCost {
  const seed = seedOf(id);
  const generation: CostTokens = {
    input: 380 + (seed % 900),
    output: 160 + (seed % 420),
    cacheWrite: seed % 3 === 0 ? 1_800 : 0,
    cacheRead: 4_200 + (seed % 7_000),
  };
  const slices: CostSlice[] = [scopeSlice(kind === 'whisper' ? 'whisper' : 'group', generation)];
  if (kind === 'message') {
    slices.push(scopeSlice('orchestrator', { input: 120, output: 90, cacheWrite: 0, cacheRead: 2_400 }));
    if (seed % 3 === 0) slices.push(scopeSlice('ledger', { input: 90, output: 70, cacheWrite: 0, cacheRead: 1_100 }));
    if (seed % 4 === 0) slices.push(scopeSlice('docedit', { input: 210, output: 260, cacheWrite: 0, cacheRead: 1_900 }));
  }
  const tokens = slices.reduce<CostTokens>((acc, s) => addTokens(acc, s.tokens), emptyTokens());
  return {
    messageId: id,
    kind,
    turnId: `turn_${id}`,
    anchorId,
    calls: slices.length,
    tokens,
    estimatedUsd: usdFor(tokens),
    // The CLI reports its own figure on most calls and it runs high against the card — the ~1.7×
    // of `segmentation-cost.md` §UNVERIFIED 6, reproduced here so the two-figure layout is
    // exercised rather than only the one-figure one.
    reportedUsd: seed % 5 === 0 ? null : Number((usdFor(tokens) * 1.7).toFixed(6)),
    ms: 1_400 + (seed % 5_200),
    models: ['claude-sonnet-5'],
    byScope: slices.sort((a, b) => totalTokens(b.tokens) - totalTokens(a.tokens)),
    mode: 'subscription',
    failedCalls: seed % 11 === 0 ? 1 : 0,
  };
}

const MOCK_FILES = [
  { fileId: 'file_btw', title: 'Critique 1 — the /btw side channel.pdf' },
  { fileId: 'file_psd', title: 'CS3249 Lecture 4 — convexity.pdf' },
  { fileId: 'file_hci', title: 'Interaction design reader.pdf' },
];

function mockCalls(): CostCallView[] {
  const scopes: CostScope[] = ['notes', 'group', 'orchestrator', 'docedit', 'ledger', 'objectives', 'whisper'];
  return Array.from({ length: 14 }, (_, i) => {
    const seed = seedOf(`call${i}`);
    const scope = scopes[i % scopes.length]!;
    const tokens: CostTokens = {
      input: 200 + (seed % 2_400),
      output: 120 + (seed % 900),
      cacheWrite: i % 4 === 0 ? 2_400 : 0,
      cacheRead: 3_000 + (seed % 12_000),
    };
    return {
      id: `use_${i}`,
      createdAt: new Date(Date.now() - i * 7 * 60_000).toISOString(),
      scope,
      model: i % 3 === 0 ? 'claude-haiku-4-5' : 'claude-sonnet-5',
      backend: 'claude-cli',
      tokens,
      estimatedUsd: usdFor(tokens),
      reportedUsd: Number((usdFor(tokens) * 1.7).toFixed(6)),
      durationMs: scope === 'notes' ? 42_000 + (seed % 38_000) : 1_200 + (seed % 9_000),
      roomId: 'room_mock',
      fileId: MOCK_FILES[i % MOCK_FILES.length]!.fileId,
      anchorId: i % 2 === 0 ? 'doc' : `span_${(seed % 0xffffff).toString(16).padStart(6, '0')}`,
      turnId: `turn_m${i}`,
      backfilled: false,
      outcome: i === 5 ? 'preempted' : i === 9 ? 'error' : 'ok',
    } satisfies CostCallView;
  });
}

function mockAnalytics(query: CostAnalyticsQuery): CostAnalytics {
  /**
   * The lopsided fixture. `file_btw` is a deck that has been worked through — a big ingest and a
   * lot of conversation on top; `file_psd` has been ingested and barely opened, which is the
   * shape that makes the ingest/conversation split worth drawing; `file_hci` is a deck somebody
   * scrolled once.
   */
  const shape = [
    { ingest: 340_000, talk: 210_000, calls: 186 },
    { ingest: 288_000, talk: 24_000, calls: 61 },
    { ingest: 96_000, talk: 3_400, calls: 14 },
  ];
  const all = MOCK_FILES.map((file, i) => {
    const s = shape[i]!;
    const split = (n: number): CostTokens => ({
      input: Math.round(n * 0.04),
      output: Math.round(n * 0.07),
      cacheWrite: Math.round(n * 0.24),
      cacheRead: Math.round(n * 0.65),
    });
    const ingestTokens = split(s.ingest);
    const talkTokens = split(s.talk);
    const tokens = addTokens(ingestTokens, talkTokens);
    return {
      fileId: file.fileId,
      title: file.title,
      calls: s.calls,
      tokens,
      estimatedUsd: usdFor(tokens),
      reportedUsd: Number((usdFor(tokens) * 1.7).toFixed(6)),
      ingest: { calls: Math.round(s.calls * 0.2), tokens: ingestTokens, estimatedUsd: usdFor(ingestTokens) },
      conversation: { calls: Math.round(s.calls * 0.8), tokens: talkTokens, estimatedUsd: usdFor(talkTokens) },
      firstCallAt: new Date(Date.now() - (9 - i) * 86_400_000).toISOString(),
      lastCallAt: new Date(Date.now() - i * 3_600_000).toISOString(),
    } satisfies CostDocumentRow;
  });
  const documents = query.fileId ? all.filter((d) => d.fileId === query.fileId) : all;

  const tokens = documents.reduce<CostTokens>((acc, d) => addTokens(acc, d.tokens), emptyTokens());
  const calls = documents.reduce((n, d) => n + d.calls, 0);
  const share = (fraction: number, key: CostScope | string): CostSlice => ({
    key,
    calls: Math.max(1, Math.round(calls * fraction)),
    tokens: {
      input: Math.round(tokens.input * fraction),
      output: Math.round(tokens.output * fraction),
      cacheWrite: Math.round(tokens.cacheWrite * fraction),
      cacheRead: Math.round(tokens.cacheRead * fraction),
    },
    estimatedUsd: usdFor({
      input: Math.round(tokens.input * fraction),
      output: Math.round(tokens.output * fraction),
      cacheWrite: Math.round(tokens.cacheWrite * fraction),
      cacheRead: Math.round(tokens.cacheRead * fraction),
    }),
    reportedUsd: null,
  });

  // Fourteen days, with a quiet weekend and one day the deck was ingested.
  const byDay: CostDayRow[] = Array.from({ length: 14 }, (_, i) => {
    const date = new Date(Date.now() - (13 - i) * 86_400_000);
    const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
    const weight = i === 3 ? 3.4 : i === 11 ? 1.9 : weekend ? 0.08 : 0.4 + ((i * 7) % 5) / 10;
    const t: CostTokens = {
      input: Math.round(tokens.input * weight * 0.07),
      output: Math.round(tokens.output * weight * 0.07),
      cacheWrite: Math.round(tokens.cacheWrite * weight * 0.07),
      cacheRead: Math.round(tokens.cacheRead * weight * 0.07),
    };
    return { day: date.toISOString().slice(0, 10), calls: Math.round(calls * weight * 0.07), tokens: t, estimatedUsd: usdFor(t) };
  });

  const recent = mockCalls();
  const session: CostTokens = { input: 3_400, output: 1_900, cacheWrite: 12_000, cacheRead: 68_000 };
  return {
    windowStart: query.since === 'session' ? new Date(Date.now() - 2 * 3_600_000).toISOString() : (query.since ?? null),
    windowEnd: query.until ?? null,
    fileId: query.fileId ?? null,
    backend: query.backend ?? null,
    total: {
      calls,
      tokens,
      estimatedUsd: usdFor(tokens),
      reportedUsd: Number((usdFor(tokens) * 1.7).toFixed(6)),
      reportedCalls: Math.round(calls * 0.82),
    },
    session: { calls: 19, tokens: session, estimatedUsd: usdFor(session) },
    documents,
    byScope: [
      share(0.52, 'notes'),
      share(0.21, 'group'),
      share(0.09, 'docedit'),
      share(0.07, 'orchestrator'),
      share(0.05, 'objectives'),
      share(0.04, 'ledger'),
      share(0.02, 'whisper'),
    ],
    byModel: [share(0.74, 'claude-sonnet-5'), share(0.26, 'claude-haiku-4-5')],
    byBackend: [share(1, 'claude-cli')],
    byDay,
    outcomes: [
      { outcome: 'ok', calls: Math.max(0, calls - 7), tokens, estimatedUsd: usdFor(tokens) },
      { outcome: 'error', calls: 2, tokens: emptyTokens(), estimatedUsd: 0 },
      { outcome: 'aborted', calls: 1, tokens: emptyTokens(), estimatedUsd: 0 },
      { outcome: 'preempted', calls: 4, tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 2_100 }, estimatedUsd: 0.00042 },
    ],
    cache: {
      freshInput: tokens.input,
      cacheRead: tokens.cacheRead,
      cacheWrite: tokens.cacheWrite,
      hitShare: tokens.cacheRead / Math.max(1, tokens.cacheRead + tokens.input),
    },
    perMessage: {
      learnerMessages: 48,
      agentMessages: 62,
      meanUsdPerLearnerMessage: Number((usdFor(tokens) / 48).toFixed(6)),
      meanTokensPerLearnerMessage: Math.round(totalTokens(tokens) / 48),
      medianUsdPerAgentMessage: 0.0091,
      medianTokensPerAgentMessage: 9_400,
    },
    slowest: [...recent].sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0)).slice(0, 10),
    priciest: [...recent].sort((a, b) => b.estimatedUsd - a.estimatedUsd).slice(0, 10),
    cliWindow: {
      windowStart: new Date(Date.now() - 5 * 3_600_000).toISOString(),
      windowEnd: new Date().toISOString(),
      hours: 5,
      tokens: { input: 6_200, output: 3_100, cacheWrite: 41_000, cacheRead: 302_000 },
      calls: 38,
      estimatedUsd: usdFor({ input: 6_200, output: 3_100, cacheWrite: 41_000, cacheRead: 302_000 }),
      reportedUsd: 0.212,
    },
    mode: 'subscription',
    rateCardDate: '2026-06-24',
    knownFiles: MOCK_FILES,
    generatedAt: new Date().toISOString(),
  };
}
