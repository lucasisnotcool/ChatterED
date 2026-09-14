/**
 * ────────────────────────────────────────────────────────────────────────────
 *  DEV-ONLY SCAFFOLDING. Not shipped behaviour, not a spec.
 *  Replays design-brief.md §G so `vite dev` alone shows a working UI without
 *  Electron. The real implementation of every call here lives in the main
 *  process; this file exists so the renderer can be built and looked at.
 * ────────────────────────────────────────────────────────────────────────────
 */
import type { ChatterEdApi } from '../../shared/ipc.js';
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
  SettingsPatch,
  SettingsView,
  TimerView,
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

const ROOM = 'mock-room-1';
const SILENCE = 45000;
const iso = (offset = 0) => new Date(Date.now() + offset).toISOString();

const AGENTS: AgentProfile[] = [
  { key: 'peer.ellie', role: 'peer', displayName: 'Ellie', colour: '#0F7B6C', verb: 'typing', model: 'mock', latency: { ttftMinMs: 4000, ttftMaxMs: 6000 } },
  { key: 'challenger.max', role: 'challenger', displayName: 'Max', colour: '#B45309', verb: 'thinking', model: 'mock', latency: { ttftMinMs: 9000, ttftMaxMs: 12000 } },
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
  slidesFolder: null,
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
      promotedFromWhisper: false, disagreement: null, divider: null,
      speaker: from
        ? { kind: 'agent', key: from.key, role: from.role, displayName: from.displayName, colour: from.colour }
        : { kind: 'student', displayName: 'You' },
      ...extra,
    };
    messages.push(m);
    emit({ type: 'message.appended', roomId: ROOM, message: m });
    return m;
  }

  function think(agent: AgentProfile, ms: number, body: string, extra: Partial<MessageView> = {}) {
    emit({ type: 'agent.thinking', roomId: ROOM, thinking: {
      agentKey: agent.key, displayName: agent.displayName, role: agent.role, colour: agent.colour,
      verb: agent.verb, startedAt: iso(), etaMs: ms, showCounter: agent.role === 'challenger',
    } });
    later(ms, () => {
      emit({ type: 'agent.thinking.cleared', roomId: ROOM });
      post(body, agent, extra);
      arm();
    });
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

  const whisperTurns: WhisperTurnView[] = [];

  return {
    async bootstrap(): Promise<Bootstrap> {
      return {
        appVersion: '0.1.0-mock', hasApiKey: false, mode: 'scripted', slidesFolder: null,
        backend: 'scripted', backendChoice: 'auto', cli: MOCK_CLI,
        pairing: 'ellie_peer', agents: AGENTS, firstRun: true,
        recentSessions: [
          { roomId: ROOM, conceptTitle: 'Convexity and the Hessian', moduleCode: 'MA3236', states: ['defended', 'defended', 'justified'], endedAt: iso(-2 * 864e5), updatedAt: iso(-2 * 864e5) },
          { roomId: 'mock-room-0', conceptTitle: 'Amortised append', moduleCode: 'CS2040S', states: ['stated', 'not_yet', 'not_yet'], endedAt: iso(-8 * 864e5), updatedAt: iso(-8 * 864e5) },
        ],
      };
    },
    async chooseSlidesFolder() { return '~/Documents/NUS/MA3236'; },
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
      return {
        roomId: ROOM, sessionId: 's1', moduleCode: 'MA3236', topic: 'Convexity and the Hessian',
        round: 1, state: 'open', startedAt: iso(-60000), agents: AGENTS,
        messages: messages.map((m) => ({ ...m })),
        ledger: { ...ledger, rows: ledger.rows.map((r) => ({ ...r })) },
        timer,
        thinking: null, nudgesPaused: false, mode: 'scripted',
        material: {
          id: 'mat1', moduleCode: 'MA3236', title: 'Second-order condition for convexity',
          sourceKind: 'pdf_pages', fileName: 'Slides_L06_Convexity.pdf', pageFrom: 30, pageTo: 31,
          pageCount: 38, cacheEligible: false, tokenCount: 180,
          extractedText: 'Second-order condition for convexity\n\nA twice-differentiable f is convex on an open convex set S if and only if ∇²f(x) ⪰ 0 for every x ∈ S.\n\nHere ⪰ 0 means positive semidefinite: zᵀ∇²f(x)z ≥ 0 for every z.',
        },
        roundCard: {
          title: 'Round 1 · Explain',
          body: "Your slide: convexity and the Hessian. You'll explain it to Ellie and Max. They won't answer for you, they'll disagree with each other sometimes, and replies here are deliberately paced so you get room to think first. You can whisper to either of them privately. You have the last word.",
        },
      };
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
    onVaultChanged() { return () => undefined; },

    onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    // `vite dev` has no window to be fullscreen; the traffic lights are never drawn there.
    onWindowState(listener) { listener({ fullScreen: false }); return () => undefined; },
  };
}
