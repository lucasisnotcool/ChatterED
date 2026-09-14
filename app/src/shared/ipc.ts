/**
 * The IPC contract. The preload bridge exposes exactly this and nothing else
 * (architecture-mac.md §C.1: "IPC bridge — contextIsolation, preload allowlist").
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
  WindowState,
} from './types.js';

export const IPC = {
  bootstrap: 'app:bootstrap',
  chooseSlidesFolder: 'app:chooseSlidesFolder',
  setApiKey: 'app:setApiKey',
  clearApiKey: 'app:clearApiKey',
  completeFirstRun: 'app:completeFirstRun',
  getSettings: 'app:getSettings',
  saveSettings: 'app:saveSettings',
  detectCli: 'app:detectCli',
  draftConcept: 'session:draftConcept',
  createSession: 'session:create',
  openRoom: 'room:open',
  sendMessage: 'room:send',
  typing: 'room:typing',
  holdTimer: 'room:hold',
  pauseNudges: 'room:pauseNudges',
  wrapUp: 'room:wrapUp',
  openWhisper: 'whisper:open',
  sendWhisper: 'whisper:send',
  relayWhisper: 'whisper:relay',
  closeWhisper: 'whisper:close',
  event: 'room:event',
  /** main → renderer: the window entered or left macOS fullscreen (issue #21). */
  windowState: 'app:windowState',
} as const;

export interface ChatterEdApi {
  bootstrap(): Promise<Bootstrap>;
  chooseSlidesFolder(): Promise<string | null>;
  /** Stored in <userData>/anthropic-api-key, mode 0600. Never written to SQLite (#15). */
  setApiKey(key: string): Promise<{ ok: boolean; error?: string }>;
  clearApiKey(): Promise<void>;
  completeFirstRun(): Promise<void>;

  getSettings(): Promise<SettingsView>;
  /** Returns the settings as they now are, or the reason the patch was refused. */
  saveSettings(patch: SettingsPatch): Promise<{ ok: boolean; error?: string; settings?: SettingsView }>;
  /**
   * Spawns `claude` once to check the binary and the login. Costs one Haiku round trip, so it
   * is cached — `force` is the "Check again" button (issue #19).
   */
  detectCli(input?: { force?: boolean }): Promise<SettingsView>;

  /** Turns pasted text into a draft concept + 3–5 claim rows the learner then edits. */
  draftConcept(input: { moduleCode: string; title: string; text: string }): Promise<ConceptDraft>;
  createSession(input: CreateSessionInput): Promise<{ roomId: string }>;

  openRoom(roomId: string): Promise<RoomSnapshot>;
  sendMessage(input: { roomId: string; text: string }): Promise<void>;
  /** Typing heartbeat. Rate-limited by the renderer to at most one per 3 s (§C.3). */
  typing(input: { roomId: string; textLen: number }): Promise<void>;
  /** The composer's `Hold` control: +60 s, posts nothing. */
  holdTimer(input: { roomId: string }): Promise<void>;
  /** `Wait for me`: pauses nudges for this round, with an undo. */
  pauseNudges(input: { roomId: string; paused: boolean }): Promise<void>;
  wrapUp(input: { roomId: string }): Promise<RecapView>;

  openWhisper(input: { roomId: string; agentKey: string }): Promise<WhisperThreadView>;
  sendWhisper(input: { roomId: string; threadId: string; text: string }): Promise<void>;
  relayWhisper(input: {
    roomId: string;
    threadId: string;
    whisperId: string;
    attribution: RelayAttribution;
    text: string;
  }): Promise<void>;
  closeWhisper(input: { roomId: string; threadId: string }): Promise<void>;

  /** Subscribe to pushed room events. Returns an unsubscribe function. */
  onEvent(listener: (event: RoomEvent) => void): () => void;

  /**
   * Subscribe to window chrome changes. The only thing the renderer needs from the window is
   * whether macOS is currently drawing the traffic lights over its top-left corner: in
   * fullscreen it is not, and the reserved spacer must collapse (issue #21).
   */
  onWindowState(listener: (state: WindowState) => void): () => void;
}

declare global {
  interface Window {
    chattered: ChatterEdApi;
  }
}
