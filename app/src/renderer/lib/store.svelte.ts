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
  SettingsPatch,
  SettingsView,
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

  /** Settings, loaded on demand. Null until the Settings screen has been opened once. */
  settings: SettingsView | null = $state(null);
  settingsBusy = $state(false);
  settingsError: string | null = $state(null);

  unsubscribe: (() => void) | null = null;

  async init(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = bridge().onEvent((e) => this.apply(e));
    try {
      const boot = await bridge().bootstrap();
      this.boot = boot;
      this.screen = boot.firstRun ? 'firstRun' : 'library';
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
