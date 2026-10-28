/**
 * ────────────────────────────────────────────────────────────────────────────
 *  DEV-ONLY SCAFFOLDING. Not shipped behaviour, not a spec.
 *  Replays design-brief.md §G so `vite dev` alone shows a working UI without
 *  Electron. The real implementation of every call here lives in the main
 *  process; this file exists so the renderer can be built and looked at.
 * ────────────────────────────────────────────────────────────────────────────
 */
import type { ChatterEdApi } from '../../shared/ipc.js';
import type { SlideOverride } from '../../shared/doc/slidegroups.js';
import { createMockTrial } from './mockTrial.js';
import { createMockStudy } from './mockStudy.js';
import {
  contextFingerprint,
  type AddSourcesResult,
  type NotebookChange,
  type NotebookSourceView,
  type NotebookSummary,
} from '../../shared/notebook.js';
import { MockNotebooks } from './mockNotebooks.js';
import type {
  TutorialChange,
  TutorialPartStatus,
  TutorialPartView,
  TutorialView,
  HintLevel,
} from '../../shared/tutorial.js';
import { tutorialContentKey } from '../../shared/tutorial.js';
import { FIXTURE_SHEET } from '../../shared/doc/tutorial.fixture.test-support.js';
import { carryAnswers, partAnswers, tutorialDocJson } from '../../shared/doc/tutorialdoc.js';
import { docFromJson } from '../../shared/doc/schema.js';
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
  DiagramDraft,
  DocEditRecord,
  FlashcardsDraft,
  InfographicDraft,
  QuizDraft,
  DocQuizView,
  NotesDocView,
  PrivateTurnView,
  ProgressObjectiveView,
  ProgressView,
  QResolution,
  Suggestion,
  TableDraft,
  ThreadView,
} from '../../shared/doc/types.js';
import { parseMention } from './chatview.js';
import {
  MOCK_CONTENT_SHA,
  MOCK_DOC_ID,
  MOCK_NOTEBOOK_ID,
  MOCK_PAGE_COUNT,
  MOCK_TITLE,
  MOCK_WINDOWS,
  mockBlockOnPage,
  mockLastBlockId,
  mockNotesJson,
  mockOverviewMeta,
  mockPagesOf,
  mockSectionOf,
  mockSources,
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
    // The notebook's id: the subject of every notes / chat / progress channel (C2).
    fileId: MOCK_NOTEBOOK_ID,
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
    // The overview is already written when the notebook opens: one call, no windows (§3.5).
    status: 'ready' as 'none' | 'pending' | 'streaming' | 'ready' | 'failed',
    /** Written from the sources ticked at the start; the out-of-date banner compares against it. */
    overview: mockOverviewMeta(contextFingerprint(mockSources())),
  };
  /** Objectives, and their fills. The one number the whole progress surface is drawn from. */
  let objectives: ProgressObjectiveView[] = fixtureObjectives();
  /** The learner's slide moves between strips (`notesSetSlideGroup`), in page order. */
  let slideMoves: SlideOverride[] = [];
  let editSeq = 0;
  let questionSeq = 0;
  let docTurns = 0;
  /** Threads by id: the doc chat, and one per span. Private threads are held separately. */
  const chatThreadMap = new Map<string, ThreadView>();
  const privateThreadMap = new Map<AgentAuthor, { threadId: string; turns: PrivateTurnView[] }>();

  const hex12 = () => globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  /** Learner-authored questions whose answer Max is still marking (`notesAnswerQuestion`). */
  const answersInFlight = new Set<string>();
  /** A table or a diagram is being drawn (`notesGenerateBlock`): main allows one per file. */
  let generating = false;

  /** What Insert ▸ Table draws, from pages the fixture document actually carries. */
  const MOCK_TABLE: TableDraft = {
    kind: 'table',
    caption: 'The three relaxed-problem heuristics',
    columns: ['Heuristic', 'How it is computed', 'Admissible?'],
    rows: [
      { cells: ['h_max', 'The cost of the **hardest** subgoal', 'Yes, but weak'], pages: [17] },
      { cells: ['h_add', 'The **sum** of the subgoal costs', 'Not always'], pages: [17] },
      { cells: ['h_FF', 'Actions in a greedily built relaxed plan', 'No'], pages: [18] },
    ],
    prov: { pages: [17, 18], reason: null },
  };

  /** What Insert ▸ Diagram draws: the refinement on p. 28 and p. 32, as a hierarchy. */
  const MOCK_DIAGRAM: DiagramDraft = {
    kind: 'diagram',
    layout: 'hierarchy',
    title: 'Refining Go(Home, SIN)',
    nodes: [
      { id: 'n1', label: 'Go(Home, SIN)', parent: null, pages: [28] },
      { id: 'n2', label: 'Taxi(Home, SIN)', parent: 'n1', pages: [28] },
      { id: 'n3', label: 'Call-Taxi', parent: 'n2', pages: [32] },
      { id: 'n4', label: 'Ride', parent: 'n2', pages: [32] },
      { id: 'n5', label: 'Pay-Taxi', parent: 'n2', pages: [32] },
    ],
    edges: [],
    prov: { pages: [28, 32], reason: null },
  };

  /**
   * What Insert ▸ Flashcards / Quiz / Infographic and a section's recommendation draw (N4's
   * kinds, §5.3), from pages the fixture overview actually cites. The quiz's answers are held
   * back by the node view until the learner answers; the infographic is data, never an image (C9).
   */
  const MOCK_FLASHCARDS: FlashcardsDraft = {
    kind: 'flashcards',
    title: 'Planning heuristics',
    prov: { pages: [16, 17, 18], reason: null },
    cards: [
      { front: 'Delete relaxation', back: 'Ignore delete effects, so facts **never become false**.', pages: [16, 17] },
      { front: 'h_max', back: 'The cost of the hardest subgoal. Admissible, but weak.', pages: [17] },
      { front: 'h_add', back: 'The sum of the subgoal costs. More informed, not always admissible.', pages: [17] },
      { front: 'h_FF', back: 'Actions in a greedily built relaxed plan. Inadmissible; the usual guide for greedy search.', pages: [18] },
    ],
  };

  const MOCK_QUIZ: QuizDraft = {
    kind: 'quiz',
    title: 'Check yourself: relaxed heuristics',
    prov: { pages: [17, 18, 23], reason: null },
    questions: [
      {
        type: 'mc',
        prompt: 'Which of these heuristics is admissible?',
        options: [
          { text: 'h_max', correct: true },
          { text: 'h_FF', correct: false },
          { text: 'h_add, always', correct: false },
        ],
        explain: 'h_max only takes the single hardest subgoal, so it can never overestimate (p. 17).',
        pages: [17],
      },
      {
        type: 'short',
        prompt: 'Why can h_FF overestimate?',
        explain: 'Its relaxed plan is built greedily, so it can be longer than the optimal relaxed plan (p. 18).',
        pages: [18],
      },
      {
        type: 'short',
        prompt: 'When does Sum(Cost) overestimate?',
        explain: 'When subgoals interact positively: work shared by two subgoals is counted twice (p. 23).',
        pages: [23],
      },
    ],
  };

  const MOCK_INFOGRAPHIC: InfographicDraft = {
    kind: 'infographic',
    layout: 'stats',
    title: 'What abstraction buys in air cargo',
    prov: { pages: [22], reason: null },
    panels: [
      { value: '10^405', heading: 'States, as given', body: '10 airports, 50 planes and 200 cargos.', pages: [22] },
      { value: '10^11', heading: 'After abstraction', body: 'Assume 5 airports and drop the irrelevant At fluents.', pages: [22] },
    ],
  };

  /** The draft each generated kind inserts. */
  const MOCK_GENERATED = {
    table: MOCK_TABLE,
    diagram: MOCK_DIAGRAM,
    flashcards: MOCK_FLASHCARDS,
    quiz: MOCK_QUIZ,
    infographic: MOCK_INFOGRAPHIC,
  } as const;

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
      overview: structuredClone(notes.overview),
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

  /**
   * Ellie's doc-chat answers, matched to the three starter questions by a word in them and
   * cycled otherwise. Full length in the chat; the doc gets one line (§4.2, `DOC_LINES`).
   */
  const ELLIE_ANSWERS: { match: RegExp; body: string; line: string; page: number; pages: number[] }[] = [
    {
      match: /delete/i,
      body:
        'Because a fact, once true, stays true. Without delete effects no action can undo another, so the ' +
        'relaxed problem only ever gains facts and you can reach every achievable fact in a few layers, ' +
        'in polynomial time (p. 16).\n\n' +
        'The cost of solving that easier problem is the estimate. On p. 17 the 8-puzzle shows it: ' +
        '**h_max = 1** and **h_add = 3** on the same state. The slide leaves h_FF as a question for you.',
      line: 'Without delete effects facts only accumulate, so the relaxed problem is solved in polynomial time.',
      page: 16,
      pages: [16, 17],
    },
    {
      match: /decompos|HTN/i,
      body:
        'Decomposition splits the **goal**: solve each subgoal on its own and combine the costs, Max or Sum ' +
        '(p. 23). An HTN splits the **actions**: a high-level action like Go(Home, SIN) is refined into ' +
        'smaller ones until they are primitive (p. 28).\n\n' +
        'So decomposition is a way to estimate, and an HTN is a way to plan. The search an HTN saves is on ' +
        'p. 33: r refinements per level instead of b actions per step.',
      line: 'Decomposition splits the goal to estimate cost; an HTN refines high-level actions to build the plan.',
      page: 23,
      pages: [23, 28],
    },
    {
      match: /LLM/i,
      body:
        'Where the planner is weakest: **getting the model in**. Writing PDDL by hand is the bottleneck, so ' +
        'an LLM drafts it from text and a validator sends errors back until it parses (p. 45–46).\n\n' +
        'The other three roles on p. 47–50 are decomposing tasks, writing heuristics as code, and writing ' +
        'generalised planners. In each one the symbolic planner still checks the plan, which is the guarantee ' +
        'the LLM cannot give.',
      line: 'The LLM drafts and decomposes; the symbolic planner still checks the plan, which keeps the guarantees.',
      page: 45,
      pages: [45, 46, 47, 50],
    },
  ];

  /** Ellie's answer when the question matches none of the above. Honest about being the mock. */
  const ELLIE_FALLBACK = {
    body:
      'Good question. In the dev mock I only have scripted answers for the three starters, so here is ' +
      'where to look instead: the overview\'s sections cite their slides, and **Explain** on a line gives ' +
      'you the full version of that line.',
    line: 'Each section of the overview cites its slides; Explain on a line gives its full version.',
    page: 3,
    pages: [3],
  };

  const ELLIE_MENTION =
    'Just me, then. The bit I would hold on to is p. 17: a heuristic from a relaxed problem is only as ' +
    'good as the relaxation, and ignoring delete effects is the one that keeps it cheap.';

  const MAX_MENTION =
    'Directly, then. Here is one to try: on p. 23, when does Sum(Cost) overestimate? Give me the kind ' +
    'of interaction, in your own words.';

  /**
   * Max's question for **Quiz me** (C8: he asks only when asked). The blocks-world one is p. 24's
   * own, for the Max/Sum line; any other line gets the question in its general form.
   */
  const MAX_QUESTION_P24 =
    'Blocks A, B, C and D all start on the table. The goal is A on B and C on D. What do Max(Cost) and ' +
    'Sum(Cost) give, and which one matches the true cost? (p. 24)';
  const MAX_QUESTION_GENERIC = (quote: string, pages: number[]) =>
    `In your own words: what does this line claim, and why does it hold? “${quote.slice(0, 90)}${quote.length > 90 ? '…' : ''}”` +
    (pages.length > 0 ? ` (p. ${pages.join(', ')})` : '');

  const MAX_FEEDBACK_PARTIAL =
    'Partly there. You have one of the two numbers right. Count the moves for each stack separately ' +
    '(p. 24): each needs exactly one move, and the two stacks never touch.\n\n' +
    'So what are Max and Sum, and which matches the true cost?';

  const MAX_FEEDBACK_COMPLETE =
    'Both numbers are right, and so is your reason.\n\n' +
    'The words that make Sum safe here are "don\'t get in each other\'s way": the subgoals are ' +
    'independent. Suppose C started on top of A. Clearing A then becomes part of both plans, which is a ' +
    'positive interaction, and Sum would count that work twice. That is the overestimate case on p. 23.';

  const MAX_CLARIFY =
    'Fair question, and I will answer it without answering mine. Max(Cost) is the cost of the single ' +
    'hardest subgoal; Sum(Cost) adds the subgoals up. So: what are the two numbers here?';

  const MAX_RELEASED =
    'Here it is, and it changes nothing on your progress: that only moves on words you wrote yourself.\n\n' +
    'Each stack takes one move, so **Max(Cost) = 1** and **Sum(Cost) = 2**, and the true cost is 2: ' +
    'Sum is exact because the two stacks are independent (p. 23–24).\n\n' +
    'Next one on this will be smaller.';

  const MAX_NUDGE =
    'Take your time. A wrong attempt is worth more to me than a right silence, and if you would rather ' +
    'have the answer, say so and it is yours.';

  /** Decision 7 (6 Oct): Hint on the open question, one plain hint, no page riddle. */
  const MAX_HINT =
    'One hint: each stack is cleared by a single move, so start by counting moves per stack and ' +
    'then ask what Max and Sum do with those counts.';

  /**
   * **Explain** and **Example** on a block (§4.1, C7): Ellie's full answer for the chat, and the
   * one line (≤ 25 words, `BLOCK_LINE_MAX_WORDS`) that goes under the block. Keyed by a word in the
   * block; a block with no script gets an honest mock line rather than an invented explanation.
   */
  const BLOCK_ACTIONS: { match: RegExp; explain: string; explainLine: string; example: string; exampleLine: string }[] = [
    {
      match: /h_FF counts|greedily built relaxed plan/,
      explain:
        '**Three steps** (Hoffmann & Nebel, 2001). First, drop every delete effect, so facts only ever get ' +
        'added. Then build a relaxed plan greedily: pick actions that achieve the goals you still need. ' +
        'h_FF(s) is the number of actions in that plan.\n\n' +
        '**Why it is inadmissible.** The greedy pick is not optimal, even for the relaxed problem, so it can ' +
        'count more actions than needed. h_max cannot overshoot, because it only takes the single hardest ' +
        'subgoal.\n\n' +
        '**Why people still use it.** In greedy best-first search you want a guide that is well informed, and ' +
        'you do not need a proof of optimality (p. 18).',
      explainLine:
        'Why it is inadmissible: a greedy relaxed plan can be longer than the optimal relaxed plan, so h_FF can overestimate.',
      example:
        'p. 17\'s 8-puzzle state is the slide\'s own example: h_max = 1, h_add = 3, and h_FF is left as the ' +
        'question. Build the relaxed plan greedily and count its actions: that count is h_FF for the state.',
      exampleLine: 'On p. 17\'s 8-puzzle state, h_max = 1 and h_add = 3; h_FF counts the greedy relaxed plan\'s actions.',
    },
    {
      match: /PDDL splits/,
      explain:
        'The **domain** is what stays the same across problems: the predicates (At, In, Cargo…) and the ' +
        'action schemas Load, Unload and Fly with their preconditions and effects (p. 4).\n\n' +
        'The **problem** is one instance: which planes, cargos and airports exist, where they start, and the ' +
        'goal (p. 5). One domain file, many problem files.',
      explainLine: 'The domain is reusable (predicates, action schemas); a problem is one instance (objects, start, goal).',
      example:
        'Air cargo (p. 4–5): the domain defines Load(c, p, a), Unload and Fly. A problem then says C1 is at SFO, ' +
        'P1 at JFK, and the goal is C1 at JFK.',
      exampleLine: 'Air cargo: Load, Unload and Fly live in the domain; "C1 at SFO, goal C1 at JFK" is one problem.',
    },
    {
      match: /REACH/,
      explain:
        'REACH+ is an **optimistic** description: everything the HLA might reach. REACH− is a **pessimistic** ' +
        'one: what it is sure to reach. The true set sits between them (p. 41).\n\n' +
        'So if even the optimistic set misses the goal, no refinement can work, and if the pessimistic set ' +
        'already hits it, some refinement must. In between, you refine and look again (p. 42).',
      explainLine: 'REACH+ is optimistic and REACH− pessimistic; missing with REACH+ proves failure, hitting with REACH− proves success.',
      example:
        'Go(Home, SIN): if REACH− of the taxi refinement already includes At(SIN), the plan works without ' +
        'expanding it. If no refinement\'s REACH+ includes it, stop searching that branch (p. 41–42).',
      exampleLine: 'If REACH− of Taxi(Home, SIN) already contains At(SIN), the high-level plan is proven without expanding it.',
    },
  ];

  // ── the doc chat (§4.1) ──────────────────────────────────────────────────────────────────

  /*
   * §4.3's cue and Max's prompt into the quiet are gone (decision 7, 6 Oct 2026 afternoon): an
   * open question is left alone, and the rail offers Hint and Show me after a few quiet minutes.
   */

  /**
   * Max asks one question — **only when asked** (C8: Quiz me, or a lesson's question): to the
   * block's thread, and into the document as a Q block under the block (§5.2, C7).
   */
  function askDocQuestion(input: {
    threadId: string;
    objectiveId: string;
    anchorBlockId: string;
    body: string;
    question: string;
    pages: number[];
  }): void {
    questionSeq += 1;
    const questionId = `q_mock_${questionSeq}`;
    think(max, 9000, input.body, { anchorId: input.threadId, decidedBy: 'rule:try_here' }, () => later(0, () => {
      // After Max's message and `turn.released` (N3's order): the thread with the quiz open,
      // then the Q block in the doc.
      const t = thread(input.threadId);
      const quiz: DocQuizView = {
        quizMessageId: `m${seq + 1}`,
        elementId: input.objectiveId,
        attempts: 0,
        feedbackGiven: false,
        answerShown: false,
        verdict: null,
        questionId,
        objectiveId: input.objectiveId,
        cueGiven: false,
        resolution: null,
        open: true,
      };
      t.quiz = quiz;
      pushThread(t);
      later(300, () => emitEdit({
        author: 'max',
        cause: 'q_block',
        focusBlockId: input.anchorBlockId,
        why: 'You pressed Quiz me on this line, so the question goes in under it.',
        ops: [
          {
            op: 'insert_q',
            anchorBlockId: input.anchorBlockId,
            questionId,
            objectiveId: input.objectiveId,
            text: input.question,
            prov: { pages: input.pages, reason: input.pages.length > 0 ? null : 'asked on Quiz me' },
          },
        ],
      }));
    }));
  }

  /** The block a question hangs off, by question id, so its resolution lands under it. */
  const questionAnchor = new Map<string, string>();

  /**
   * Resolve the open question in the document (§5.3, amended 2026-10-06, D4). The Q block stays
   * and folds to a self-check chip; **no Max text is written under it**, as main does now: the
   * answer and the grade are the chat's.
   */
  function resolveDocQuestion(threadId: string, resolution: QResolution, learnerAnswer: string | null = null): void {
    const t = chatThreadMap.get(threadId);
    const quiz = t?.quiz;
    if (!t || !quiz) return;
    quiz.open = false;
    quiz.resolution = resolution;
    pushThread(t);
    const anchor = questionAnchor.get(quiz.questionId) ?? mockBlockOnPage(23);
    emitEdit({
      author: 'max',
      cause: 'q_resolved',
      focusBlockId: anchor,
      why: 'The question is closed: it stays in the notes as a self-check.',
      // Only an earned answer is filed under the question, in the learner's own words.
      ops: [
        {
          op: 'resolve_q',
          questionId: quiz.questionId,
          resolution,
          blocks: [],
          learnerAnswer: resolution === 'you_got_this' ? learnerAnswer : null,
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
        fillObjective(quiz.objectiveId ?? 'obj-abstraction', second ? 1 : 0.5, text);
        if (second) resolveDocQuestion(threadId, 'you_got_this', text);
      },
    );
  }

  /** §4.4: the give-up path and the Pass control land in the same place, by design. */
  function releaseDocAnswer(threadId: string, by: 'give_up' | 'pass' | 'closure'): void {
    const t = chatThreadMap.get(threadId);
    const quiz = t?.quiz;
    if (!t || !quiz) return;
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
    const script =
      ELLIE_ANSWERS.find((a) => a.match.test(text)) ?? (docTurns <= 1 ? ELLIE_FALLBACK : ELLIE_ANSWERS[(docTurns - 2) % ELLIE_ANSWERS.length]!);
    const anchor = mockBlockOnPage(script.page);
    emitCursor('ellie', anchor, 'thinking');
    think(ellie, 4500, script.body, { anchorId: threadId, decidedBy: 'rule:ellie_answers' }, () =>
      // §4.2: the full answer stays in the chat; the doc gets one line (≤ 25 words) under the
      // block the question was about, with Keep / Remove, and the answer is re-sent with the
      // same id naming the edit. Max does **not** follow up (C8).
      later(900, () => {
        if (!emitBlockLine(anchor, script.line, script.pages)) return;
        const reply = messages.filter((m) => m.anchorId === threadId && m.speaker.kind === 'agent').at(-1);
        if (!reply) return;
        const section = mockSectionOf(anchor);
        reply.body = `${reply.body}\n\nAdded one line under that bullet${section ? ` in “${section}”` : ''}.`;
        emit({ type: 'message.appended', roomId: ROOM, message: { ...reply } });
      }),
    );
  }

  /** The one-line doc edit of §4.2, under `anchorBlockId`, Ellie's, `cause: 'block_action'`. */
  function emitBlockLine(anchorBlockId: string, line: string, pages: number[]): string | null {
    return emitEdit({
      author: 'ellie',
      cause: 'block_action',
      focusBlockId: anchorBlockId,
      why: 'One line worth keeping, under the block it is about. The full answer is in the chat.',
      ops: [
        {
          op: 'insert_after',
          anchorBlockId,
          blocks: [{ kind: 'paragraph', text: line, prov: { pages, reason: pages.length > 0 ? null : 'added in the conversation' } }],
        },
      ],
    });
  }

  /**
   * **Explain · Example · Quiz me** on one block (§4.1, C7), in the order N3's main emits it, so
   * the editor and the chat are built against the real sequence:
   *
   *  - Explain / Example: the block's span thread (`chat.thread`, first time), the learner's row
   *    (`Explain: «quote»`, `block_action:request`), `turn.received`, the call returns; then
   *    Ellie's stream and message (`rule:block_action`) and `turn.released`; then her cursor and
   *    the one-line `block_action` doc edit under the block; then **the same message id again**
   *    with "Added one line under that bullet in “Section”." appended.
   *  - Quiz me: no learner row; `turn.received`, Max's message (`rule:try_here`) in the block's
   *    thread, `turn.released`, the thread with the quiz open, then the Q block.
   *
   * One action at a time per notebook (`busy`); one open question at a time (`question_open`,
   * with that question's thread).
   */
  let blockActionBusy = false;
  function blockAction(input: { blockId: string; kind: 'explain' | 'example' | 'quiz'; quote: string }): {
    accepted: boolean;
    threadId: string | null;
    reason: 'busy' | 'question_open' | null;
  } {
    if (blockActionBusy) return { accepted: false, threadId: null, reason: 'busy' };
    const openQ = [...chatThreadMap.values()].find((x) => x.quiz?.open);
    if (input.kind === 'quiz' && openQ) return { accepted: false, threadId: openQ.threadId, reason: 'question_open' };
    const pages = mockPagesOf(input.blockId);
    const quote = input.quote.trim();
    const existing = [...chatThreadMap.values()].find((t) => t.kind === 'span' && t.blockId === input.blockId);
    const threadId = existing?.threadId ?? `${SPAN_THREAD_PREFIX}${hex12()}`;
    const t = thread(threadId, { kind: 'span', blockId: input.blockId, quote: quote.slice(0, 120) });
    if (!existing) pushThread(t);
    blockActionBusy = true;
    const received = (messageId: string | null) =>
      emit({
        type: 'turn.received',
        roomId: ROOM,
        received: {
          turnId: `turn_mock_${mockTurn + 1}`,
          messageId: messageId ?? '',
          anchorId: threadId,
          receivedAt: iso(),
          yieldMs: 0,
          etaMs: null,
          responder: null,
        },
      });

    if (input.kind === 'quiz') {
      received(null);
      const p24 = /Max is admissible but weak|Max\(Cost\)/.test(quote);
      const objective = objectives.find((o) => o.blockIds.includes(input.blockId)) ?? objectives[0]!;
      questionAnchor.set(`q_mock_${questionSeq + 1}`, input.blockId);
      const question = p24 ? MAX_QUESTION_P24 : MAX_QUESTION_GENERIC(quote, pages);
      askDocQuestion({
        threadId,
        objectiveId: p24 ? 'obj-abstraction' : objective.objectiveId,
        anchorBlockId: input.blockId,
        body: `I put a question under that line. Answer it there or here, whichever you prefer.\n\n${question}`,
        question,
        pages: p24 ? [23, 24] : pages,
      });
      later(9400, () => (blockActionBusy = false));
      return { accepted: true, threadId, reason: null };
    }

    const capped = quote.length > 160 ? `${quote.slice(0, 159)}…` : quote;
    const ask = input.kind === 'explain' ? `Explain: «${capped}»` : `Give me an example: «${capped}»`;
    const mine = post(ask, null, { anchorId: threadId, decidedBy: 'block_action:request' });
    pushThread(t);
    received(mine.id);

    const script = BLOCK_ACTIONS.find((a) => a.match.test(quote));
    const where = pages.length > 0 ? `p. ${pages.join(', ')}` : 'the slides';
    const body = script
      ? input.kind === 'explain' ? script.explain : script.example
      : `(Dev mock.) Ellie's ${input.kind === 'explain' ? 'full explanation' : 'worked example'} of this line would be here, drawn from ${where}. ` +
        'The scripted ones are on the PDDL, h_FF and REACH lines.';
    const line = script
      ? input.kind === 'explain' ? script.explainLine : script.exampleLine
      : `(Dev mock) One line worth keeping from ${where} would go here.`;
    emitCursor('ellie', input.blockId, 'thinking');
    think(ellie, 4500, body, { anchorId: threadId, decidedBy: 'rule:block_action' }, () =>
      later(700, () => {
        blockActionBusy = false;
        const editId = emitBlockLine(input.blockId, line, pages);
        if (!editId) return;
        // The same message again, now naming the edit (N3 re-sends it with the same id).
        const reply = messages.filter((m) => m.anchorId === threadId && m.speaker.kind === 'agent').at(-1);
        if (!reply) return;
        const section = mockSectionOf(input.blockId);
        reply.body = `${reply.body}\n\nAdded one line under that bullet${section ? ` in “${section}”` : ''}.`;
        emit({ type: 'message.appended', roomId: ROOM, message: { ...reply } });
      }),
    );
    return { accepted: true, threadId, reason: null };
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
      'Not embarrassing, and nothing here reaches Max. Two sentences: **admissible** means the ' +
      'heuristic never overestimates the true cost, which is what A* needs to stay optimal. ' +
      '**Inadmissible** ones like h_FF can overestimate, and greedy search uses them anyway because ' +
      'they guide better (p. 17–18).\n\n' +
      'If it helps, put it in the document and it stops being a thing you have to hold in your head.',
    max:
      "Between us, and Ellie can't see this. You are allowed to ask me what the question is " +
      'asking — that is not the same as asking for the answer, and I will always answer it.\n\n' +
      'What I want from that question is the two numbers and which one matches the true cost. ' +
      'Count each stack on its own first (p. 24). One sentence is enough.',
  };

  // ── the notebooks (#58) ───────────────────────────────────────────────────────────────────

  const notebookListeners = new Set<(change: NotebookChange) => void>();
  /**
   * Three notebooks, as the mockup's home shows them. The first is the fixture: its sources are
   * the overview's, and the notes, the chats and the progress bar are all its. The other two are
   * cards to look at and open; they say plainly that the mock has no overview for them.
   */
  const notebooks = (() => {
    const model = new MockNotebooks({
      push: (change) => notebookListeners.forEach((l) => l(structuredClone(change))),
      later,
      confirm: (text) => (typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(text) : true),
      fillOf: (id) => (id === notes.fileId ? progressView().fraction : null),
    });
    model.seed({
      id: MOCK_NOTEBOOK_ID,
      name: 'CS4246 · Week 2 Planning',
      sources: mockSources(),
      subtitle: MOCK_TITLE,
      fill: 0,
      updatedAt: iso(-40 * 60_000),
    });
    model.seed({
      id: 'nb_cs3249lect4',
      name: 'CS3249 · Lecture 4',
      sources: [
        { fileId: 'f_mock_cs3249', name: 'CS3249+Lecture+4.pdf', kind: 'pdf', pageBase: 0, pageCount: 66, enabled: true, status: 'ready', error: null, addedAt: iso(-3 * 864e5), role: 'lecture', keyFor: null },
      ],
      subtitle: 'Prototyping Conversational User Interfaces',
      fill: 0.4,
      updatedAt: iso(-3 * 864e5),
    });
    model.seed({
      id: 'nb_cs4246week1',
      name: 'CS4246 · Week 1',
      sources: [
        { fileId: 'f_mock_wk1_slides', name: 'Week 1 slides.pdf', kind: 'pdf', pageBase: 0, pageCount: 48, enabled: true, status: 'ready', error: null, addedAt: iso(-9 * 864e5), role: 'lecture', keyFor: null },
        { fileId: 'f_mock_wk1_notes', name: 'Week 1 notes.md', kind: 'text', pageBase: 48, pageCount: 2, enabled: true, status: 'ready', error: null, addedAt: iso(-9 * 864e5), role: 'lecture', keyFor: null },
      ],
      subtitle: 'Classical planning, PDDL',
      fill: 0.75,
      updatedAt: iso(-9 * 864e5),
    });
    /** A source by its file id, in any notebook: what `openDocument` is asked for. */
    const sourceById = (fileId: string): NotebookSourceView | null => {
      for (const summary of model.list()) {
        const hit = model.view(summary.id)?.sources.find((src) => src.fileId === fileId);
        if (hit) return hit;
      }
      return null;
    };
    return { model, sourceById };
  })();

  const OTHER_NOTEBOOK_LINE =
    'The dev mock has a written overview and a conversation for “CS4246 · Week 2 Planning” only.';

  // ── tutorials (`docs/research/tutorials.md`; `TUTORIAL-CONTRACT.md` S2) ────────────────────
  //
  // Every tutorial source, in any notebook, reads as the test fixture's sheet (`FIXTURE_SHEET`),
  // built into a document by the same `tutorialDocJson` main uses. A check says *correct* for
  // anything written (there is no key in the mock); help posts the learner's line and a canned
  // reply in the part's span thread, and a hint writes Max's one line into the sheet.

  interface MockTutorial {
    notebookId: string;
    fileId: string;
    docId: string | null;
    status: TutorialView['status'];
    version: number;
    doc: unknown;
    records: Map<string, { status: TutorialPartStatus; hintLevel: HintLevel; attempts: number; checkedBy: 'simulation' | 'model' | null }>;
    edits: DocEditRecord[];
  }
  const tutorialMap = new Map<string, MockTutorial>();
  const tutorialListeners = new Set<(change: TutorialChange) => void>();

  const tutorialSources = (notebookId: string) =>
    (notebooks.model.view(notebookId)?.sources ?? []).filter((src) => src.role === 'tutorial');

  function tutorialOf(notebookId: string, fileId: string): MockTutorial {
    const key = `${notebookId}:${fileId}`;
    let t = tutorialMap.get(key);
    if (!t) {
      t = { notebookId, fileId, docId: null, status: 'pending', version: 0, doc: null, records: new Map(), edits: [] };
      tutorialMap.set(key, t);
    }
    return t;
  }

  /** Which notes blocks and lecture pages each part draws on: the fixture notes' first sections. */
  function mockLinks(index: number): { notesBlockIds: string[]; pages: number[] } {
    const headings: string[] = [];
    const json = notes.doc as { content?: { type: string; attrs?: { blockId?: string; level?: number } }[] } | null;
    for (const node of json?.content ?? []) {
      if (node.type === 'heading' && node.attrs?.level === 2 && node.attrs.blockId) headings.push(node.attrs.blockId);
    }
    const at = headings.length === 0 ? [] : [headings[index % headings.length]!];
    return { notesBlockIds: at, pages: [3 + index * 4, 4 + index * 4] };
  }

  function tutorialViewOf(t: MockTutorial): TutorialView {
    const source = notebooks.model.view(t.notebookId)?.sources.find((src) => src.fileId === t.fileId);
    const parts: TutorialPartView[] = [];
    if (t.doc) {
      partAnswers(docFromJson(t.doc)).forEach((answer, i) => {
        const record = t.records.get(answer.partId) ?? { status: answer.empty ? 'untried' : 'working', hintLevel: 0 as HintLevel, attempts: 0, checkedBy: null };
        // Every taught objective but the last: the last is the sheet's one gap.
        const taught = objectives.filter((o) => !o.assumedByDeck).slice(0, -1);
        parts.push({
          partId: answer.partId,
          origin: 'sheet',
          blockId: answer.blockId,
          label: answer.label,
          answerKind: answer.kind,
          status: record.status === 'untried' && !answer.empty ? 'working' : record.status,
          hintLevel: record.hintLevel,
          attempts: record.attempts,
          checkedBy: record.checkedBy,
          verifiedSolution: false,
          links: mockLinks(i),
          objectiveIds: taught.length > 0 ? [taught[i % taught.length]!.objectiveId] : [],
        });
      });
    }
    const covered = new Set(parts.flatMap((p) => p.objectiveIds));
    const gap = objectives.filter((o) => !o.assumedByDeck && !covered.has(o.objectiveId)).at(-1);
    return {
      notebookId: t.notebookId,
      fileId: t.fileId,
      docId: t.docId,
      contentKey: tutorialContentKey(t.notebookId, t.fileId),
      title: t.doc ? FIXTURE_SHEET.title : (source?.name ?? 'Tutorial'),
      status: t.status,
      error: null,
      parts,
      hasSolutions: false,
      gaps: t.doc && gap ? [{ objectiveId: gap.objectiveId, title: gap.title, pages: gap.pages.slice(0, 3) }] : [],
    };
  }

  function pushTutorial(t: MockTutorial): void {
    const change: TutorialChange = { notebookId: t.notebookId, fileId: t.fileId, view: tutorialViewOf(t) };
    tutorialListeners.forEach((l) => l(structuredClone(change)));
  }

  function tutorialDocView(t: MockTutorial): NotesDocView | null {
    if (!t.docId || !t.doc) return null;
    return {
      docId: t.docId,
      fileId: t.notebookId,
      contentSha: tutorialContentKey(t.notebookId, t.fileId),
      title: FIXTURE_SHEET.title,
      pageCount: notebooks.model.view(t.notebookId)?.pageCount ?? 0,
      version: t.version,
      doc: t.doc,
      ingest: { status: 'ready', windowsDone: 1, windowsTotal: 1, withImages: true, error: null },
      frozen: false,
      edits: t.edits.filter((e) => e.status === 'applied'),
      suggestions: [],
      overview: null,
    };
  }

  const tutorialByDoc = (docId: string): MockTutorial | null => [...tutorialMap.values()].find((t) => t.docId === docId) ?? null;

  /** The part's span thread, made on first use, as main's `tutorial:help` finds or creates it. */
  function partThread(t: MockTutorial, partId: string): { threadId: string; blockId: string; label: string; lastChild: string | null } | null {
    if (!t.doc) return null;
    const answer = partAnswers(docFromJson(t.doc)).find((a) => a.partId === partId);
    if (!answer) return null;
    const existing = [...chatThreadMap.values()].find((x) => x.kind === 'span' && x.blockId === answer.blockId);
    const threadId = existing?.threadId ?? `${SPAN_THREAD_PREFIX}${hex12()}`;
    if (!existing) pushThread(thread(threadId, { kind: 'span', blockId: answer.blockId, quote: answer.label }));
    let lastChild: string | null = null;
    docFromJson(t.doc).descendants((node) => {
      if (node.type.name !== 'tut_part' || node.attrs.partId !== partId) return true;
      node.forEach((child) => {
        const id = (child.attrs as { blockId?: string }).blockId;
        if (id) lastChild = id;
      });
      return false;
    });
    return { threadId, blockId: answer.blockId, label: answer.label, lastChild };
  }

  /** Max's one line under the part (S5), on the ordinary doc-edit path, with the tutorial's doc id. */
  function tutorialLine(t: MockTutorial, anchorBlockId: string | null, text: string): void {
    if (!t.docId || !anchorBlockId) return;
    editSeq += 1;
    const batch: AgentDocOpBatch = {
      editId: `edit_mock_tut_${editSeq}`,
      author: 'max',
      cause: 'block_action',
      focusBlockId: anchorBlockId,
      why: 'One line under the part, so the sheet records the help you used. The full hint is in the chat.',
      ops: [{ op: 'insert_after', anchorBlockId, blocks: [{ kind: 'paragraph', text, prov: { pages: [], reason: 'tutor_hint' } }] }],
    };
    emit({ type: 'doc.edit', roomId: ROOM, docId: t.docId, batch });
  }

  const HINT_LINES = [
    'Look at the PDDL section of the notes, and the slide with the action schema.',
    'Break it into: the objects, the predicates, then one action with its precondition and effect.',
    'Worked on the lecture example: Move(A, B, Table) needs On(A, B) and Clear(A).',
  ];

  /** Any notebook but the fixture: a doc that failed to write, with the reason in a sentence. */
  function otherNotebookView(fileId: string): NotesDocView {
    const view = notebooks.model.view(fileId);
    return {
      docId: `doc_mock_${fileId}`,
      fileId,
      contentSha: `nb:${fileId}`,
      title: view?.name ?? 'Untitled notebook',
      pageCount: view?.pageCount ?? 0,
      version: 1,
      doc: null,
      ingest: { status: 'failed', windowsDone: 0, windowsTotal: 1, withImages: false, error: OTHER_NOTEBOOK_LINE },
      frozen: false,
      edits: [],
      suggestions: [],
      overview: null,
    };
  }

  return {
    trial: createMockTrial(),
    study: createMockStudy(),
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
     * A **source's** bytes (C2: `openDocument` still takes a source's file id). The parity route
     * supplies a clearly labelled one-page PDF fixture to exercise the new viewer. Other mock
     * routes have no disk or PDF bytes, and slide previews degrade to their captions.
     */
    openDocument: async ({ fileId }) => {
      const source = notebooks.sourceById(fileId);
      const parityPdf = source?.kind === 'pdf' && globalThis.location?.pathname.endsWith('/tutorial-workspace-parity.html')
        ? new Uint8Array(await (await fetch('./tutorial-sample.pdf')).arrayBuffer())
        : null;
      return source
        ? {
            fileId,
            name: `${source.name} (dev fixture)`,
            relPath: source.name,
            absPath: `~/Library/Application Support/ChatterED/notebooks/${source.name}`,
            kind: source.kind === 'pdf' ? ('pdf' as const) : source.kind === 'image' ? ('image' as const) : ('text' as const),
            ext: `.${source.name.split('.').pop() ?? ''}`,
            size: 0,
            pageCount: source.pageCount,
            text: source.kind === 'text' ? '(The dev mock has no file contents.)' : null,
            bytes: parityPdf,
            error: null,
          }
        : {
            fileId, name: '', relPath: '', absPath: '', kind: 'other' as const, ext: '', size: 0,
            pageCount: null, text: null, bytes: null, error: 'No such source in the dev mock.',
          };
    },

    // Segments need pdf.js, a file and SQLite, none of which `vite dev` has. An empty flow with
    // the honest notice, for the same reason as everywhere in this mock: a mock deck of invented
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
    async notesGet({ fileId }) {
      if (fileId !== notes.fileId) return null;
      return notes.status === 'none' ? null : notesView();
    },
    /**
     * The two-pass ingest, in miniature: the doc opens on window 1 and the rest fills in behind
     * the "Ellie is still writing" marker (§2). The windows only ever **append** after the
     * previous window's last block, which is the rule (contract E9) that makes it safe for the
     * learner to be typing while window 3 lands.
     */
    async notesIngest({ fileId, force }) {
      // The dev mock has one written overview. Any other notebook says so rather than showing
      // the fixture's overview under the wrong sources.
      if (fileId !== notes.fileId) return otherNotebookView(fileId);
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
    /** No PDF behind the mock, so no text geometry: the chip previews a whole page, no hotspots. */
    async notesPageLines({ page }) {
      return { page, width: 0, height: 0, lines: [], items: [] };
    },
    /**
     * No text behind the mock deck either: every page is a key with '' for its text, so the slide
     * strips group on the structural rules alone (`shared/doc/slidegroups.ts`), as they would for
     * a scanned deck.
     */
    async notesPageTexts({ fileId }) {
      if (fileId !== notes.fileId) return {};
      return Object.fromEntries(Array.from({ length: notes.pageCount }, (_, i) => [i + 1, '']));
    },
    /** The learner's slide moves, held for the session like everything else here. */
    async notesSlideGroups({ docId }) {
      return docId === notes.docId ? slideMoves.map((m) => ({ ...m })) : [];
    },
    /** One explain on the mock doc's first paragraph, so the badge can be seen without a database. */
    async notesComments({ docId }) {
      if (docId !== notes.docId) return [];
      const first = (notes.doc as { content?: { type?: string; attrs?: { blockId?: string } }[] } | null)?.content?.find((n) => n.type === 'paragraph' && n.attrs?.blockId);
      const blockId = first?.attrs?.blockId;
      return blockId ? [{ blockId, kind: 'explain' as const, body: 'Ellie would say: this line is the **definition** to remember, $h(s) \\le h^*(s)$.', model: 'mock', updatedAt: '2026-10-07T00:00:00.000Z' }] : [];
    },
    async notesSetSlideGroup({ docId, page, key, title }) {
      if (docId !== notes.docId) throw new Error('That document does not exist.');
      slideMoves = slideMoves.filter((m) => m.page !== page);
      if (key !== null) slideMoves = [...slideMoves, { page, key, title }].sort((a, b) => a.page - b.page);
      return slideMoves.map((m) => ({ ...m }));
    },
    /**
     * Optimistic save. The conflict branch is real — pass a stale `baseVersion` and the stored
     * doc comes back — because a renderer that has never met a conflict has never been tested
     * against the one thing that will happen the first time a window lands mid-keystroke (D5).
     */
    async notesSave({ docId, baseVersion, doc }) {
      const tut = tutorialByDoc(docId);
      if (tut) {
        if (baseVersion !== tut.version) return { ok: false as const, conflict: true as const, version: tut.version, doc: tut.doc };
        tut.doc = doc;
        tut.version += 1;
        return { ok: true as const, version: tut.version };
      }
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
     * **Insert ▸ Table / Diagram / Flashcards / Quiz / Infographic** (2026-10-01), with main's
     * refusals: frozen, and one at a time. Otherwise Ellie thinks at the block for a moment and the
     * block arrives as an ordinary `insert_after` batch of the matching draft, so dev mode runs the same
     * apply path, guard and typing animation a real one does. The call resolves after the edit is
     * out, as main's does. An instruction with "nothing" in it declines, so that line can be seen.
     */
    async notesGenerateBlock({ blockId, kind, instruction }) {
      if (notes.frozen) return { inserted: false, editId: null, reason: 'frozen' as const };
      if (generating) return { inserted: false, editId: null, reason: 'in_flight' as const };
      generating = true;
      try {
        emitCursor('ellie', blockId, 'thinking');
        await new Promise((resolve) => setTimeout(resolve, 2_400));
        if (/\bnothing\b/i.test(instruction ?? '')) {
          emitCursor('ellie', null, 'idle');
          return { inserted: false, editId: null, reason: 'declined' as const };
        }
        const editId = emitEdit({
          author: 'ellie',
          cause: 'answer_missing',
          focusBlockId: blockId,
          why: {
            table: 'You asked for a table: the section compares three heuristics on how they are built.',
            diagram: 'You asked for a diagram: p. 28 and p. 32 are a refinement, so it is drawn as a hierarchy.',
            flashcards: 'You asked for flashcards: one card per heuristic, front and back.',
            quiz: 'You asked for a quiz: three questions on the relaxed heuristics, answers held back.',
            infographic: 'You asked for an infographic: p. 22 is two numbers, so it is drawn as stats.',
          }[kind],
          ops: [{ op: 'insert_after', anchorBlockId: blockId, blocks: [structuredClone(MOCK_GENERATED[kind])] }],
        });
        if (!editId) {
          // Frozen while she was thinking: dropped, not queued (contract D4).
          emitCursor('ellie', null, 'idle');
          return { inserted: false, editId: null, reason: 'frozen' as const };
        }
        return { inserted: true, editId, reason: null };
      } finally {
        generating = false;
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
        'Partly there, and this is your own sentence so it counts. p. 17: h_max takes the largest ' +
          'subgoal cost, which is why it never overestimates. If your line says it is *always* the ' +
          'best guide, that is the part the deck contradicts: it is admissible but weak. I have ' +
          'suggested the correction rather than making it; accept or reject it, it is your text.',
        { anchorId: threadId, decidedBy: 'rule:quiz_feedback' },
        () => {
          fillObjective('obj-heuristics', 0.5, text);
          const suggestionId = `sug_mock_${hex12()}`;
          const suggestion: Suggestion = {
            suggestionId,
            docId: notes.docId,
            editId: `edit_mock_${editSeq + 1}`,
            author: 'max',
            blockId,
            status: 'open',
            note: 'p. 17 calls h_max admissible but weak.',
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
              replacement: text.slice(0, 120).replace(/always/i, 'safely, if weakly,'),
              note: suggestion.note ?? '',
              threadId,
            },
          });
          emit({ type: 'doc.suggestion', roomId: ROOM, docId: notes.docId, suggestion });
        },
      );
      return { assessed: true, threadId, reason: null };
    },

    /**
     * **Submit answer on a Q block** (2026-10-01). The two cases main tells apart:
     *
     *  - Max's question: the answer is a turn into the thread he asked it in, so the whole of the
     *    attempt loop runs exactly as it does for a chat answer. Refused when that question is
     *    not the open one.
     *  - The learner's own question: a thread anchored to the Q block, Max's feedback in it, and
     *    an ordinary `resolve_q` batch for that question. No objective moves.
     */
    async notesAnswerQuestion({ questionId, qBlockId, askedBy, question, answer }) {
      if (answer.trim().length === 0) return { accepted: false, threadId: null, reason: 'empty' };
      if (answersInFlight.has(questionId)) return { accepted: false, threadId: null, reason: 'in_flight' };

      if (askedBy === 'max') {
        const asked = [...chatThreadMap.values()].find((t) => t.quiz?.open && t.quiz.questionId === questionId);
        if (!asked) return { accepted: false, threadId: null, reason: 'not_open' };
        docChatTurn(asked.threadId, answer);
        return { accepted: true, threadId: asked.threadId, reason: null };
      }

      if (question.trim().length === 0) return { accepted: false, threadId: null, reason: 'no_question' };
      const threadId = `${SPAN_THREAD_PREFIX}${hex12()}`;
      const t = thread(threadId, { kind: 'span', blockId: qBlockId, quote: question.slice(0, 120) });
      post(answer, null, { anchorId: threadId, kind: 'answer' });
      pushThread(t);
      answersInFlight.add(questionId);
      think(
        max,
        9000,
        'Well done. That answers the question you set yourself, and it is in your own words. ' +
          'It is your question, so it moves no objective; it stays in the notes as yours.',
        { anchorId: threadId, decidedBy: 'rule:quiz_feedback' },
        () => {
          answersInFlight.delete(questionId);
          emitEdit({
            author: 'max',
            cause: 'q_resolved',
            focusBlockId: qBlockId,
            why: 'You answered your own question, so it is closed as yours.',
            ops: [{ op: 'resolve_q', questionId, resolution: 'you_got_this', blocks: [] }],
          });
        },
      );
      return { accepted: true, threadId, reason: null };
    },

    async chatThreads({ fileId }) {
      if (fileId !== notes.fileId) return { roomId: null, fileId, threads: [] };
      return {
        roomId: chatThreadMap.size > 0 ? ROOM : null,
        fileId,
        threads: [...chatThreadMap.values()].map((t) => ({ ...t, quiz: t.quiz ? { ...t.quiz } : null })),
      };
    },
    async chatSend({ fileId, threadId, text }) {
      if (fileId !== notes.fileId) throw new Error(OTHER_NOTEBOOK_LINE);
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
        'About that line specifically: it is close to the deck\'s own wording, and the slide it ' +
          'cites is where to check it. The useful way to hold it is as a claim with a reason: ' +
          'what it says, and which part of the slide makes it true.',
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
      const anchor = anchorBlockId ?? mockBlockOnPage(17);
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
                prov: { pages: [17, 18], reason: 'brought over from a private note' },
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
    /** Decision 7's Hint: one plain hint from Max in the question's thread; the question stays open. */
    async quizHint({ threadId }) {
      const t = chatThreadMap.get(threadId);
      if (!t?.quiz?.open) return { hinted: false, refused: 'No question is open here.' };
      think(max, 4000, MAX_HINT, { anchorId: threadId, decidedBy: 'rule:hint_requested' });
      return { hinted: true, refused: null };
    },

    async progressGet({ fileId }) {
      if (fileId !== notes.fileId) {
        return { fileId, docId: null, status: 'none' as const, completed: 0, total: 0, fraction: 0, objectives: [] };
      }
      return progressView();
    },
    /**
     * A lesson card's **Start** (§6, revised 2026-10-06, D2): Ellie walks the learner through the
     * section and asks nothing; the doc scrolls to the segment that carries it. Max does not ask:
     * the check is offered later ("Ready to check this?"), as in the actor. The scroll target is
     * returned rather than pushed, because the renderer owns where the document goes.
     */
    async progressStart({ objectiveId }) {
      const objective = objectives.find((o) => o.objectiveId === objectiveId) ?? objectives[0]!;
      const t = thread(DOC_ANCHOR_ID);
      const pages = objective.pages.length > 0 ? ` It is on ${objective.pages.map((n) => `p. ${n}`).join(', ')}.` : '';
      const anchorBlockId = objective.blockIds[0] ?? null;
      think(
        ellie,
        3600,
        `Right — **${objective.title.toLowerCase()}**.\n\n` +
          `${objective.statement}${pages} I have scrolled the notes to the part that carries it. ` +
          'Press Explain or Example on any line you want more on.',
        { anchorId: DOC_ANCHOR_ID, decidedBy: 'rule:lesson_start' },
        () => pushThread(t),
      );
      return { roomId: ROOM, threadId: DOC_ANCHOR_ID, blockId: anchorBlockId };
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

    // ── Notebooks (#58): the in-memory model in `mockNotebooks.ts` ──────────────────────────
    async notebookList(): Promise<NotebookSummary[]> {
      return notebooks.model.list();
    },
    async notebookGet({ notebookId }) {
      return notebooks.model.view(notebookId);
    },
    async notebookCreate(input): Promise<AddSourcesResult> {
      return notebooks.model.create(input);
    },
    async notebookRename({ notebookId, name }) {
      return notebooks.model.rename(notebookId, name);
    },
    async notebookDelete({ notebookId }) {
      return { deleted: notebooks.model.delete(notebookId) };
    },
    async notebookOpen({ notebookId }) {
      return notebooks.model.open(notebookId);
    },
    /**
     * The native picker, played by a hidden `<input type="file">`. The learner's click is still the
     * user activation that lets it open; a cancel resolves empty, as main's does.
     */
    async notebookPickFiles() {
      return { paths: await pickInBrowser() };
    },
    async notebookAddSources(input): Promise<AddSourcesResult> {
      return notebooks.model.addSources(input);
    },
    async notebookSetEnabled(input) {
      return notebooks.model.setEnabled(input);
    },
    async notebookSetRole(input) {
      const view = notebooks.model.setRole(input);
      if (input.role === 'tutorial') {
        const t = tutorialOf(input.notebookId, input.fileId);
        pushTutorial(t);
      } else {
        const t = tutorialMap.get(`${input.notebookId}:${input.fileId}`);
        if (t) tutorialListeners.forEach((l) => l({ notebookId: t.notebookId, fileId: t.fileId, view: null }));
      }
      return view;
    },
    async tutorialList({ notebookId }) {
      return tutorialSources(notebookId).map((src) => tutorialViewOf(tutorialOf(notebookId, src.fileId)));
    },
    async tutorialDoc({ notebookId, fileId }) {
      return tutorialDocView(tutorialOf(notebookId, fileId));
    },
    /** Answers at once with `pending`; the sheet is "read" a moment later and pushed. */
    async tutorialIngest({ notebookId, fileId, force }) {
      const t = tutorialOf(notebookId, fileId);
      if (t.docId && t.status === 'ready' && force !== true) return tutorialViewOf(t);
      t.status = 'pending';
      later(2400, () => {
        const source = notebooks.model.view(notebookId)?.sources.find((src) => src.fileId === fileId);
        const fresh = tutorialDocJson(FIXTURE_SHEET, { pageBase: source?.pageBase ?? 0 });
        t.doc = t.doc ? carryAnswers(docFromJson(t.doc), docFromJson(fresh)).doc.toJSON() : fresh;
        t.docId = t.docId ?? `doc_mock_tut_${fileId}`;
        t.version += 1;
        t.status = 'ready';
        pushTutorial(t);
      });
      return tutorialViewOf(t);
    },
    async tutorialCheck({ notebookId, fileId, partId }) {
      const t = tutorialOf(notebookId, fileId);
      if (!t.doc) return { accepted: false, reason: 'no_doc' as const, status: null, threadId: null };
      const answer = partAnswers(docFromJson(t.doc)).find((a) => a.partId === partId);
      if (!answer) return { accepted: false, reason: 'no_doc' as const, status: null, threadId: null };
      if (answer.empty) return { accepted: false, reason: 'empty' as const, status: null, threadId: null };
      const at = partThread(t, partId)!;
      const record = t.records.get(partId) ?? { status: 'untried' as TutorialPartStatus, hintLevel: 0 as HintLevel, attempts: 0, checkedBy: null };
      t.records.set(partId, { ...record, status: 'correct', attempts: record.attempts + 1, checkedBy: 'model' });
      post(`Check ${at.label}`, null, { anchorId: at.threadId });
      think(max, 2200, `That works. ${at.label} has what it needs: the reasoning follows from the lecture's definition, and nothing is missing.`, { anchorId: at.threadId });
      const view = tutorialViewOf(t);
      for (const id of view.parts.find((p) => p.partId === partId)?.objectiveIds ?? []) fillObjective(id, 1, answer.text || 'tutorial answer');
      pushTutorial(t);
      return { accepted: true, reason: null, status: 'correct' as const, threadId: at.threadId };
    },
    async tutorialHelp({ notebookId, fileId, partId, kind }) {
      const t = tutorialOf(notebookId, fileId);
      const at = partThread(t, partId);
      if (!at) return { accepted: false, reason: 'no_doc' as const, level: null, threadId: null };
      const record = t.records.get(partId) ?? { status: 'untried' as TutorialPartStatus, hintLevel: 0 as HintLevel, attempts: 0, checkedBy: null };
      if (kind === 'hint' && record.hintLevel >= 3) return { accepted: false, reason: 'top' as const, level: null, threadId: at.threadId };
      const level = (kind === 'hint' ? record.hintLevel + 1 : record.hintLevel) as HintLevel;
      t.records.set(partId, { ...record, hintLevel: level, status: kind === 'reveal' ? 'revealed' : record.status });
      const ask = kind === 'hint' ? `Hint on ${at.label}` : kind === 'refresher' ? `Refresher for ${at.label}` : `Show the answer to ${at.label}`;
      post(ask, null, { anchorId: at.threadId });
      if (kind === 'refresher') {
        think(ellie, 2400, 'A quick refresher from the lecture: an action schema has a precondition (what must hold) and an effect (what changes). The notes section on PDDL has both written out (p. 7).', { anchorId: at.threadId });
      } else if (kind === 'reveal') {
        think(max, 2400, 'Here is one answer that works: the plan moves X to the Table, then Y onto X. In one line: why does Y have to wait until X is off it?', { anchorId: at.threadId });
      } else {
        const line = HINT_LINES[level - 1] ?? HINT_LINES[0]!;
        think(max, 2400, `${line} Have a go before the next hint.`, { anchorId: at.threadId });
        later(2800, () => tutorialLine(t, at.lastChild ?? at.blockId, line));
      }
      pushTutorial(t);
      return { accepted: true, reason: null, level: kind === 'hint' ? level : null, threadId: at.threadId };
    },
    onTutorialChanged(listener) {
      tutorialListeners.add(listener);
      return () => tutorialListeners.delete(listener);
    },
    async notebookRemoveSource(input) {
      return notebooks.model.removeSource(input);
    },
    async notebookMove({ notebookId, folderId }) {
      return notebooks.model.moveNotebook(notebookId, folderId);
    },
    async folderList() {
      return notebooks.model.folders();
    },
    async folderCreate(input) {
      return notebooks.model.createFolder(input);
    },
    async folderRename({ folderId, name }) {
      return notebooks.model.renameFolder(folderId, name);
    },
    async folderMove({ folderId, parentId }) {
      return notebooks.model.moveFolder(folderId, parentId);
    },
    async folderDelete({ folderId }) {
      return notebooks.model.deleteFolder(folderId);
    },
    async notebookSetResearchExclude({ notebookId, exclude }) {
      return notebooks.model.setNotebookResearchExclude(notebookId, exclude);
    },
    async folderSetResearchExclude({ folderId, exclude }) {
      return notebooks.model.setFolderResearchExclude(folderId, exclude);
    },
    async notebookDuplicate(input) {
      return notebooks.model.duplicateNotebook(input);
    },
    async folderDuplicate(input) {
      return notebooks.model.duplicateFolder(input);
    },
    // Search has no model or index in the dev mock: it says so rather than inventing hits.
    async searchQuery({ query }) {
      return { query: query.trim(), hits: [], mode: 'keyword' as const, pending: 0, ms: 0 };
    },
    async searchStatus({ folderId }) {
      return { notebooks: notebooks.model.scopeNotebookIds(folderId).length, chunks: 0, pending: 0, semantic: false };
    },
    onNotebookChanged(listener) {
      notebookListeners.add(listener);
      return () => notebookListeners.delete(listener);
    },
    /** The browser has no paths; the name is the mock's path, and `baseName` reads it back. */
    pathForFile(file: File) {
      return file.name;
    },
    /** **Update overview** (§2): pending, then ready, written from the sources ticked now. */
    async notesUpdateOverview({ fileId }) {
      if (fileId !== notes.fileId) return { started: false, reason: 'no_doc' as const };
      const view = notebooks.model.view(fileId);
      if (!view || view.contextFingerprint === '') return { started: false, reason: 'no_sources' as const };
      if (notes.status === 'pending' || notes.status === 'streaming') return { started: false, reason: 'in_flight' as const };
      notes.status = 'pending';
      emitNotesStatus();
      later(2600, () => {
        notes.overview = { ...notes.overview, fingerprint: view.contextFingerprint, writtenAt: iso() };
        notes.status = 'ready';
        notes.version += 1;
        emitNotesStatus();
      });
      return { started: true, reason: null };
    },
    async notesSetRecommendation({ fileId, recommendationId, status }) {
      if (fileId !== notes.fileId) return null;
      notes.overview = {
        ...notes.overview,
        recommendations: notes.overview.recommendations.map((r) => (r.id === recommendationId ? { ...r, status } : r)),
      };
      return structuredClone(notes.overview);
    },
    async notesBlockAction({ fileId, blockId, kind, quote }) {
      if (fileId !== notes.fileId || !blockId) return { accepted: false, roomId: null, threadId: null, reason: 'no_doc' as const };
      const out = blockAction({ blockId, kind, quote });
      return { accepted: out.accepted, roomId: out.accepted ? ROOM : null, threadId: out.threadId, reason: out.reason };
    },
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

/**
 * The dev stand-in for main's native multi-file picker: a hidden `<input type="file" multiple>`.
 * Resolves with the chosen files' names (the mock's "paths"), or empty on cancel.
 */
function pickInBrowser(): Promise<string[]> {
  if (typeof document === 'undefined') return Promise.resolve([]);
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.style.display = 'none';
    const done = (paths: string[]) => {
      input.remove();
      resolve(paths);
    };
    input.addEventListener('change', () => done([...(input.files ?? [])].map((f) => f.name)));
    input.addEventListener('cancel', () => done([]));
    document.body.appendChild(input);
    input.click();
  });
}
