/**
 * Renderer state. It holds nothing authoritative: every field here is either a
 * snapshot the main process sent, or a purely local view preference (which pane
 * is collapsed, which row is expanded). The silence deadline in particular is
 * never computed here — see time.ts (product-design.md §C4).
 */
import type {
  Bootstrap,
  ConceptDraft,
  CreateSessionInput,
  RecapView,
  RelayAttribution,
  RoomEvent,
  RoomSnapshot,
  FinderHitView,
  SearchHitView,
  SettingsPatch,
  SettingsView,
  TopicCandidateView,
  VaultTreeNode,
  VaultView,
  WhisperThreadView,
} from '../../shared/types.js';
import { bridge } from './bridge.js';

export type Screen = 'loading' | 'firstRun' | 'library' | 'setup' | 'room' | 'settings';

/** One shared 200 ms tick. The wait-line transitions across it, so it reads as continuous. */
class Clock {
  ms = $state(Date.now());
}
export const clock = new Clock();
setInterval(() => {
  clock.ms = Date.now();
}, 200);

export interface LedgerPulse {
  ids: string[];
  token: number;
}

class Store {
  screen: Screen = $state('loading');
  boot: Bootstrap | null = $state(null);
  room: RoomSnapshot | null = $state(null);
  recap: RecapView | null = $state(null);
  whisper: WhisperThreadView | null = $state(null);
  whisperOpen = $state(false);
  notice: { level: 'info' | 'error'; text: string } | null = $state(null);

  /** Local view preferences. */
  ledgerHidden = $state(false);
  sourceCollapsed = $state(false);
  navCollapsed = $state(false);

  /** Local clock reading at the moment the current TimerView arrived (drift correction). */
  timerReceivedAt = $state(Date.now());
  /** Set when the learner types, so the wait-line retracts before main confirms the pause. */
  lastTypedAt = $state(0);

  ledgerPulse: LedgerPulse = $state({ ids: [], token: 0 });

  /** Seed for the setup screen when the learner arrives via "Paste text instead". */
  setupSeed = $state('');

  // ── The vault (issue #22) ──────────────────────────────────────────────
  vault: VaultView | null = $state(null);
  /** A topic id, 'other' for the unpromoted remainder, or null before anything is picked. */
  selectedTopic: string | null = $state(null);
  vaultTree: VaultTreeNode[] = $state([]);
  vaultBusy = $state(false);
  selectedFileId: string | null = $state(null);
  topicSheetOpen = $state(false);
  topicCandidates: TopicCandidateView[] = $state([]);

  /** The ⌘K palette. Open only outside a room — inside one, ⌘K is the whisper (§C10). */
  finderOpen = $state(false);
  finderQuery = $state('');
  finderHits: FinderHitView[] = $state([]);

  /** The full-text search box in the Library header. */
  searchQuery = $state('');
  searchHits: SearchHitView[] = $state([]);
  searching = $state(false);

  /** Settings, loaded on demand. Null until the Settings screen has been opened once. */
  settings: SettingsView | null = $state(null);
  settingsBusy = $state(false);
  settingsError: string | null = $state(null);

  unsubscribe: (() => void) | null = null;
  unsubscribeVault: (() => void) | null = null;

  async init(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = bridge().onEvent((e) => this.apply(e));
    // The scanner and the background indexer push; the renderer never polls for either.
    this.unsubscribeVault?.();
    this.unsubscribeVault = bridge().onVaultChanged((view) => {
      this.vault = view;
    });
    try {
      const boot = await bridge().bootstrap();
      this.boot = boot;
      this.screen = boot.firstRun ? 'firstRun' : 'library';
      await this.loadVault();
    } catch (err) {
      this.notice = { level: 'error', text: message(err) };
      this.screen = 'library';
    }
  }

  apply(e: RoomEvent): void {
    const room = this.room;
    switch (e.type) {
      case 'message.appended':
        if (room && !room.messages.some((m) => m.id === e.message.id)) room.messages.push(e.message);
        break;
      case 'agent.thinking':
        if (room) room.thinking = e.thinking;
        break;
      case 'agent.thinking.cleared':
        if (room) room.thinking = null;
        break;
      case 'ledger.updated':
        if (room) {
          room.ledger = e.ledger;
          if (!this.ledgerHidden && e.changed.length > 0) {
            this.ledgerPulse = { ids: e.changed, token: this.ledgerPulse.token + 1 };
          }
        }
        break;
      case 'timer.updated':
        if (room) {
          room.timer = e.timer;
          this.timerReceivedAt = Date.now();
        }
        break;
      case 'room.state':
        if (room) room.state = e.state;
        break;
      case 'whisper.turn':
        if (this.whisper && this.whisper.threadId === e.threadId
          && !this.whisper.turns.some((t) => t.id === e.turn.id)) {
          this.whisper.turns.push(e.turn);
        }
        break;
      case 'whisper.cleared':
        if (this.whisper && this.whisper.threadId === e.threadId) this.whisper.turns = [];
        break;
      case 'session.recap':
        this.recap = e.recap;
        break;
      case 'notice':
        this.notice = { level: e.level, text: e.text };
        break;
    }
  }

  // ── Navigation ───────────────────────────────────────────────────────────
  async completeFirstRun(): Promise<void> {
    await run(this, () => bridge().completeFirstRun());
    if (this.boot) this.boot.firstRun = false;
    this.screen = 'library';
  }

  // ── Settings ─────────────────────────────────────────────────────────────
  async openSettings(): Promise<void> {
    this.screen = 'settings';
    this.navCollapsed = false;
    await this.loadSettings();
  }

  async loadSettings(): Promise<void> {
    this.settingsBusy = true;
    const view = await run(this, () => bridge().getSettings());
    this.settingsBusy = false;
    if (view) this.settings = view;
  }

  async saveSettings(patch: SettingsPatch): Promise<void> {
    this.settingsBusy = true;
    this.settingsError = null;
    const result = await run(this, () => bridge().saveSettings(patch));
    this.settingsBusy = false;
    if (!result) return;
    if (!result.ok) {
      this.settingsError = result.error ?? 'That setting could not be saved.';
      return;
    }
    if (result.settings) this.settings = result.settings;
    await this.refreshBoot();
  }

  /** One real `claude` round trip. The button says so, because it costs a model call. */
  async checkCli(force = true): Promise<void> {
    this.settingsBusy = true;
    this.settingsError = null;
    const view = await run(this, () => bridge().detectCli({ force }));
    this.settingsBusy = false;
    if (view) this.settings = view;
    await this.refreshBoot();
  }

  /** Re-reads the bootstrap so the status bar and the roster follow a backend change. */
  async refreshBoot(): Promise<void> {
    const boot = await run(this, () => bridge().bootstrap());
    if (boot) this.boot = { ...boot, firstRun: this.boot?.firstRun ?? boot.firstRun };
  }

  // ── The vault ────────────────────────────────────────────────────────────
  async loadVault(): Promise<void> {
    const view = await run(this, () => bridge().getVault());
    if (!view) return;
    this.vault = view;
    if (this.selectedTopic === null) this.selectedTopic = view.topics[0]?.id ?? (view.rootPath ? 'other' : null);
    if (this.selectedTopic !== null) await this.loadTree();
  }

  async chooseVault(): Promise<void> {
    this.vaultBusy = true;
    const view = await run(this, () => bridge().chooseVault());
    this.vaultBusy = false;
    if (!view) return;
    this.vault = view;
    this.selectedTopic = view.topics[0]?.id ?? 'other';
    await this.loadTree();
    // A brand-new vault has no topics yet, and ticking them is the point of the screen.
    if (view.topics.length === 0) await this.openTopicSheet();
  }

  async rescanVault(): Promise<void> {
    this.vaultBusy = true;
    const view = await run(this, () => bridge().rescanVault());
    this.vaultBusy = false;
    if (view) this.vault = view;
    await this.loadTree();
  }

  async selectTopic(topic: string | null): Promise<void> {
    this.selectedTopic = topic;
    await this.loadTree();
  }

  async loadTree(): Promise<void> {
    if (!this.vault?.rootPath || this.selectedTopic === null) {
      this.vaultTree = [];
      return;
    }
    const topicId = this.selectedTopic === 'other' ? null : this.selectedTopic;
    const tree = await run(this, () => bridge().vaultTree({ topicId }));
    this.vaultTree = tree ?? [];
  }

  async openTopicSheet(): Promise<void> {
    const candidates = await run(this, () => bridge().topicCandidates());
    this.topicCandidates = candidates ?? [];
    this.topicSheetOpen = true;
  }

  async promoteTopics(relPaths: string[]): Promise<void> {
    this.vaultBusy = true;
    const view = await run(this, () => bridge().promoteTopics({ relPaths }));
    this.vaultBusy = false;
    this.topicSheetOpen = false;
    if (!view) return;
    this.vault = view;
    const stillThere = view.topics.some((t) => t.id === this.selectedTopic);
    if (!stillThere && this.selectedTopic !== 'other') this.selectedTopic = view.topics[0]?.id ?? 'other';
    await this.loadTree();
  }

  // ── Finding and searching ────────────────────────────────────────────────
  openFinder(): void {
    this.finderOpen = true;
    this.finderQuery = '';
    this.finderHits = [];
  }

  async runFinder(query: string): Promise<void> {
    this.finderQuery = query;
    if (query.trim().length === 0) {
      this.finderHits = [];
      return;
    }
    const hits = await run(this, () => bridge().findFiles({ query }));
    // A slower keystroke's result must not overwrite a faster later one.
    if (this.finderQuery === query) this.finderHits = hits ?? [];
  }

  async runSearch(query: string): Promise<void> {
    this.searchQuery = query;
    if (query.trim().length < 2) {
      this.searchHits = [];
      this.searching = false;
      return;
    }
    this.searching = true;
    const hits = await run(this, () => bridge().searchVault({ query }));
    if (this.searchQuery !== query) return;
    this.searchHits = hits ?? [];
    this.searching = false;
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.searchHits = [];
    this.searching = false;
  }

  goSetup(seed = ''): void {
    this.setupSeed = seed;
    this.screen = 'setup';
  }

  async openRoom(roomId: string): Promise<void> {
    const snapshot = await run(this, () => bridge().openRoom(roomId));
    if (!snapshot) return;
    this.room = snapshot;
    this.timerReceivedAt = Date.now();
    this.recap = null;
    this.whisper = null;
    this.whisperOpen = false;
    this.navCollapsed = true;
    this.screen = 'room';
  }

  leaveRoom(): void {
    this.room = null;
    this.recap = null;
    this.whisper = null;
    this.whisperOpen = false;
    this.navCollapsed = false;
    this.screen = 'library';
  }

  // ── Session setup ────────────────────────────────────────────────────────
  draftConcept(input: { moduleCode: string; title: string; text: string }): Promise<ConceptDraft | null> {
    return run(this, () => bridge().draftConcept(input));
  }

  async createSession(input: CreateSessionInput): Promise<void> {
    const created = await run(this, () => bridge().createSession(input));
    if (created) await this.openRoom(created.roomId);
  }

  // ── Room actions ─────────────────────────────────────────────────────────
  send(text: string): void {
    const roomId = this.room?.roomId;
    if (!roomId || !text.trim()) return;
    void run(this, () => bridge().sendMessage({ roomId, text: text.trim() }));
  }

  typing(textLen: number): void {
    const roomId = this.room?.roomId;
    if (!roomId) return;
    this.lastTypedAt = Date.now();
    void run(this, () => bridge().typing({ roomId, textLen }));
  }

  hold(): void {
    const roomId = this.room?.roomId;
    if (roomId) void run(this, () => bridge().holdTimer({ roomId }));
  }

  pauseNudges(paused: boolean): void {
    const roomId = this.room?.roomId;
    if (!roomId) return;
    if (this.room) this.room.nudgesPaused = paused;
    void run(this, () => bridge().pauseNudges({ roomId, paused }));
  }

  async wrapUp(): Promise<void> {
    const roomId = this.room?.roomId;
    if (!roomId) return;
    const recap = await run(this, () => bridge().wrapUp({ roomId }));
    if (recap) this.recap = recap;
  }

  // ── Whisper ──────────────────────────────────────────────────────────────
  async openWhisper(agentKey: string): Promise<void> {
    const roomId = this.room?.roomId;
    if (!roomId) return;
    const thread = await run(this, () => bridge().openWhisper({ roomId, agentKey }));
    if (thread) this.whisper = thread;
  }

  sendWhisper(text: string): void {
    const roomId = this.room?.roomId;
    const threadId = this.whisper?.threadId;
    if (!roomId || !threadId || !text.trim()) return;
    void run(this, () => bridge().sendWhisper({ roomId, threadId, text: text.trim() }));
  }

  relay(whisperId: string, attribution: RelayAttribution, text: string): void {
    const roomId = this.room?.roomId;
    const threadId = this.whisper?.threadId;
    if (!roomId || !threadId) return;
    void run(this, () => bridge().relayWhisper({ roomId, threadId, whisperId, attribution, text }));
  }

  closeWhisper(): void {
    const roomId = this.room?.roomId;
    const threadId = this.whisper?.threadId;
    this.whisperOpen = false;
    if (roomId && threadId) void run(this, () => bridge().closeWhisper({ roomId, threadId }));
    this.whisper = null;
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Every bridge call funnels through here so a rejection becomes the notice banner. */
async function run<T>(store: Store, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    store.notice = { level: 'error', text: message(err) };
    return null;
  }
}

export const store = new Store();
