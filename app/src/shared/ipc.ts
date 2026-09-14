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
  DocumentView,
  FinderHitView,
  SearchHitView,
  SettingsView,
  TopicCandidateView,
  VaultTreeNode,
  VaultView,
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

  // The vault (issue #22).
  vaultGet: 'vault:get',
  vaultChoose: 'vault:choose',
  vaultRescan: 'vault:rescan',
  vaultCandidates: 'vault:candidates',
  vaultPromote: 'vault:promote',
  vaultTree: 'vault:tree',
  vaultFind: 'vault:find',
  vaultSearch: 'vault:search',
  vaultDocument: 'vault:document',
  vaultReveal: 'vault:reveal',
  /** main → renderer: a scan finished, or the background indexer advanced. */
  vaultChanged: 'vault:changed',
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

  // ── The vault (issue #22) ───────────────────────────────────────────────
  /** The Library's whole left-hand state: root, topics with counts, index progress. */
  getVault(): Promise<VaultView>;
  /** Opens the folder picker. Null when the learner cancelled. Scans before it returns. */
  chooseVault(): Promise<VaultView | null>;
  /** Re-walk the vault and reconcile by mtime. Cheap; called on window focus. */
  rescanVault(): Promise<VaultView>;
  /** The depth-1 folders on offer as topics, with the promoted ones ticked. */
  topicCandidates(): Promise<TopicCandidateView[]>;
  /** Sets the promoted set exactly. Anything omitted is demoted back to "Other". */
  promoteTopics(input: { relPaths: string[] }): Promise<VaultView>;
  /** The file tree for one topic, or for "Other" when topicId is null. */
  vaultTree(input: { topicId: string | null }): Promise<VaultTreeNode[]>;
  /**
   * The ⌘K finder: fuzzy filename and path matching, no index needed, instant.
   * ⌘K is the whisper key *inside a room* (§C10 L1004) and the finder key everywhere else —
   * §B1's own header already reads `[ Search ⌘K ]` (L186). Scope decides, and the two scopes
   * never overlap because the room owns the keydown while it is open.
   */
  findFiles(input: { query: string }): Promise<FinderHitView[]>;
  /** Full text, over the FTS5 index: snippets, and a page number for a PDF hit. */
  searchVault(input: { query: string }): Promise<SearchHitView[]>;
  /**
   * Everything the document pane needs for one file. PDF and image bytes come back over IPC as
   * a Uint8Array rather than through a custom protocol: the renderer then holds no URL it could
   * re-request, and a file it was never handed stays unreachable.
   */
  openDocument(input: { fileId: string }): Promise<DocumentView>;
  /** Reveal in Finder — the one action the "no viewer" card offers (issue #22 decision 3). */
  revealFile(input: { fileId: string }): Promise<void>;
  /** Subscribe to vault changes pushed by the scanner and the background indexer. */
  onVaultChanged(listener: (view: VaultView) => void): () => void;

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
