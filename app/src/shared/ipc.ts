/**
 * The IPC contract. The preload bridge exposes exactly this and nothing else
 * (architecture-mac.md §C.1: "IPC bridge — contextIsolation, preload allowlist").
 */
import type {
  Bootstrap,
  ConceptDraft,
  CreateSessionInput,
  DocumentView,
  FinderHitView,
  RecapView,
  RelayAttribution,
  RoomEvent,
  RoomSnapshot,
  SearchHitView,
  SessionSeed,
  SettingsPatch,
  SettingsView,
  TeachbackResult,
  TopicCandidateView,
  VaultTreeNode,
  VaultView,
  WhisperThreadView,
  AppCommand,
  WindowState,
} from './types.js';
import type { SegmentDocumentView } from './segment/types.js';
import type { FlowAnswerView, FlowRelayView, FlowRoomView, FlowWhisperView } from './types.js';

export const IPC = {
  bootstrap: 'app:bootstrap',
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
  acceptTeachback: 'room:acceptTeachback',
  openWhisper: 'whisper:open',
  sendWhisper: 'whisper:send',
  relayWhisper: 'whisper:relay',
  closeWhisper: 'whisper:close',
  event: 'room:event',
  /** main → renderer: the window entered or left macOS fullscreen (issue #21). */
  windowState: 'app:windowState',
  /** main → renderer: an application-menu item, or a trackpad swipe, was used. */
  appCommand: 'app:command',

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
  vaultSeed: 'vault:seed',
  showDocument: 'room:showDocument',
  /** main → renderer: a scan finished, or the background indexer advanced. */
  vaultChanged: 'vault:changed',

  // The flow's segments (issue #25).
  segmentsGet: 'segments:get',
  segmentsSplit: 'segments:split',
  segmentsMerge: 'segments:merge',
  segmentsReorder: 'segments:reorder',
  segmentsRename: 'segments:rename',

  // The conversation inside the flow (issue #25, flow-build-plan.md §3.3 track B).
  flowAskHere: 'flow:askHere',
  flowExplainBack: 'flow:explainBack',
  flowSend: 'flow:send',
  flowMessages: 'flow:messages',

  // The whisper popover on a segment (issue #16 + flow-build-plan.md §3.5).
  flowWhisperOpen: 'flow:whisperOpen',
  flowWhisperSend: 'flow:whisperSend',
  flowWhisperRelay: 'flow:whisperRelay',
  flowWhisperClose: 'flow:whisperClose',
  flowSelection: 'flow:selection',
} as const;

export interface ChatterEdApi {
  bootstrap(): Promise<Bootstrap>;
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
  /**
   * "Yes, invite Theo" on the recap. Records the acceptance and says what happens next; Theo's
   * round itself is A2 and `available` is false until it exists.
   */
  acceptTeachback(input: { roomId: string; agentKey: string }): Promise<TeachbackResult>;

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
  /**
   * Start session setup from a file and a page range: the extracted text pre-fills the paste
   * box, and the topic comes along for the room's system context (issue #22 decisions 4 and 5).
   */
  sessionSeed(input: { fileId: string; pageFrom: number | null; pageTo: number | null }): Promise<SessionSeed>;
  /**
   * "Show the room": post a reference to the open document into the group chat, as the learner.
   * The main process resolves the page text; the renderer only says which pages and what was
   * highlighted, because the renderer has no authority to decide what the agents are told.
   */
  showDocument(input: {
    roomId: string;
    fileId: string;
    pageFrom: number | null;
    pageTo: number | null;
    selection: string | null;
  }): Promise<void>;
  /** Subscribe to vault changes pushed by the scanner and the background indexer. */
  onVaultChanged(listener: (view: VaultView) => void): () => void;

  // ── The flow's segments (issue #25) ─────────────────────────────────────
  /**
   * The flow for one document: whole-page segments, the candidate ticks inside each, the build
   * chips, and a notice when the document is not a slide deck.
   *
   * Runs stages 0–3 on the first call for these bytes and caches the result against
   * `content_sha`; every later call is a SQLite read. **No model call, ever** (issue #25
   * decision 4), so this works with the network off and costs nothing per page.
   */
  getSegments(input: { fileId: string }): Promise<SegmentDocumentView>;
  /**
   * Split one segment. `at` is normalised — a `y` for a horizontal cut, an `x` for a vertical
   * one. It snaps to a candidate within ~8 pt unless `free` is set, and is **refused** if the
   * resulting line would cross a figure: the view comes back unchanged with `refused` set.
   */
  splitSegment(input: {
    fileId: string;
    segmentId: string;
    at: number;
    axis?: 'horizontal' | 'vertical';
    free?: boolean;
  }): Promise<SegmentDocumentView>;
  /** Same-page merge of two adjacent segments — the undo of a split. */
  mergeSegments(input: { fileId: string; segmentIds: [string, string] }): Promise<SegmentDocumentView>;
  /** Move a card in the flow. Pixels never move. */
  reorderSegments(input: { fileId: string; segmentId: string; toIndex: number }): Promise<SegmentDocumentView>;
  /** Rename a segment. Labels are the learner's, and the text-layer guess is only a default. */
  renameSegment(input: { fileId: string; segmentId: string; label: string }): Promise<SegmentDocumentView>;

  // ── The conversation inside the flow (issue #25) ────────────────────────
  /**
   * "+ Ask here" on one segment.
   *
   * **This call is what creates the document's room**, the first time it is made for a file
   * (`flow-build-plan.md` §3.3): there is no setup screen any more. It resolves in ~2–3 s — the
   * REFERENCE hold, which is deliberately shorter than any agent's, because retrieval is not
   * deliberation (`pivot-spec.md` §B1) — and returns the card that landed plus the room it
   * landed in, so the renderer never has to ask a second question to find out where it is.
   *
   * Four things it is *not*, all enforced in `actor.askHere()` rather than in a prompt: it does
   * not take the turn floor, does not reset the silence timer, can never be ledger evidence, and
   * it **locks Ellie and Max out of that segment's thread** until `explainBack`.
   */
  flowAskHere(input: { fileId: string; segmentId: string; question: string }): Promise<FlowAnswerView>;
  /**
   * "Explain it back →". The card collapses to one line, the composer opens on the same anchor,
   * and Ellie and Max become eligible on it for the first time.
   */
  flowExplainBack(input: { answerId: string }): Promise<{ unlocked: boolean; anchorId: string | null }>;
  /**
   * A learner turn inside one segment's thread. Not awaited for the reply: like `sendMessage`,
   * the agent's answer arrives on the event stream at its latency floor.
   */
  flowSend(input: { roomId: string; segmentId: string; text: string }): Promise<void>;
  /**
   * The document's room and its threads, grouped by segment. `null` when the document has never
   * been asked a question — which is the common case, and is why nothing is created here.
   */
  flowMessages(input: { fileId: string }): Promise<FlowRoomView | null>;

  // ── The whisper popover on a segment (§3.5) ─────────────────────────────
  /**
   * `⌘K` on a focused segment card, or *Ask privately* in its label strip.
   *
   * Like `flowAskHere` it **creates the document's room if there isn't one**: a private question
   * is a learner-authored action on the document, and refusing to open one until a public
   * question had been asked would make the private channel the second-class one — which is the
   * opposite of what `design-brief.md` §D5 is for.
   *
   * The addressee is not a parameter. Ellie is resolved in `actor.openSegmentWhisper()`, so the
   * renderer cannot ask for a private channel to the Tester (#32).
   */
  flowWhisperOpen(input: { fileId: string; segmentId: string }): Promise<{ roomId: string; whisper: FlowWhisperView }>;
  /**
   * A private turn. Not awaited for the reply: Ellie's answer arrives on the `whisper.turn`
   * event stream at her 1–2 s floor, exactly as in the shipped pane.
   *
   * `fileId` + `segmentId` are here so the **main process** resolves the anchored page text —
   * the same text the REFERENCE call sees. The renderer has no authority to decide what any
   * agent is told, private or not.
   */
  flowWhisperSend(input: {
    roomId: string;
    fileId: string;
    segmentId: string;
    threadId: string;
    text: string;
  }): Promise<void>;
  /**
   * **Insert into the document.** The approved relay: a *new shared card* under the segment,
   * authored as the learner or as Ellie, carrying the text the learner edited and approved.
   *
   * It never moves, reveals or links the private turn (`pivot-spec.md` §B5's T4), and it cannot
   * advance the ledger — `actor.relay()` does not call the ledger, and `flow:whisperRelay` is
   * the only path from the popover to the document.
   */
  flowWhisperRelay(input: {
    roomId: string;
    segmentId: string;
    threadId: string;
    whisperId: string;
    attribution: RelayAttribution;
    text: string;
  }): Promise<FlowRelayView>;
  /** `Esc` or click-away. Closes the popover in the main process's model; writes nothing. */
  flowWhisperClose(input: { roomId: string; threadId: string }): Promise<void>;
  /**
   * A **selection change**: the learner focused a segment card (`pivot-spec.md` §B8).
   *
   * The document's analogue of the typing heartbeat, and rate-limited by the renderer the same
   * way. Scroll, zoom and page navigation are deliberately *not* reported — re-reading a slide
   * by scrolling is precisely the behaviour the silence timer must not punish.
   */
  flowSelection(input: { roomId: string; segmentId: string | null }): Promise<void>;

  /**
   * Subscribe to application-menu commands.
   *
   * ⌘+ / ⌘− / ⌘0 are **ChatterED's**, not Chromium's: the default Electron menu bound them to
   * `zoomIn`/`zoomOut`/`resetZoom`, which scale the whole application chrome — sidebar, rail,
   * composer and all — instead of the PDF (ui-review-code.md §4). The menu sends its intent
   * here; the renderer routes it to whichever viewer is open.
   */
  onAppCommand(listener: (command: AppCommand) => void): () => void;

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
