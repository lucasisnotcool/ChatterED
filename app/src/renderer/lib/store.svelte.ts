/**
 * Renderer state. It holds nothing authoritative: every field here is either a
 * snapshot the main process sent, or a purely local view preference (which pane
 * is collapsed, which row is expanded). The silence deadline in particular is
 * never computed here — see time.ts (product-design.md §C4).
 */
import type {
  AppCommand,
  Bootstrap,
  ConceptDraft,
  CreateSessionInput,
  DocumentView,
  FinderHitView,
  FlowWhisperView,
  RecapView,
  RelayAttribution,
  RoomEvent,
  RoomSnapshot,
  SearchHitView,
  SessionSeed,
  SettingsPatch,
  SettingsView,
  TopicCandidateView,
  TurnReceivedView,
  TurnTraceView,
  VaultTreeNode,
  VaultView,
  WhisperThreadView,
} from '../../shared/types.js';
import type { SegmentDocumentView } from '../../shared/segment/index.js';
import type { ChatterEdApi } from '../../shared/ipc.js';
import { bridge } from './bridge.js';
import {
  ackIndex,
  announce,
  appendDelta,
  nextSendId,
  wordCount,
  type PendingSend,
  type StreamState,
} from './flowchat.js';
import { validateRange } from './pdfview.js';
import { isViewerCommand, runViewerCommand } from './viewer.js';

/**
 * Is a `flow:*` turn-status call actually on the bridge?
 *
 * The turn-status surface (`flow:stop`, `flow:turnTrace`, `flow:markSeen`, `flow:cardState`)
 * lands on the main-process track; this one builds against the documented shape and degrades to
 * nothing until it does, rather than throwing an "unknown channel" into the notice banner. The
 * check is on the preload object, so it is true exactly when the channel is reachable.
 */
function has(name: keyof ChatterEdApi): boolean {
  return typeof (bridge() as unknown as Record<string, unknown>)[name] === 'function';
}

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
  /** Set once the learner has accepted the teach-back invitation; the card then says so. */
  teachbackNote: string | null = $state(null);
  whisper: WhisperThreadView | null = $state(null);
  whisperOpen = $state(false);
  notice: { level: 'info' | 'error'; text: string } | null = $state(null);

  /** Local view preferences. */
  ledgerHidden = $state(false);
  sourceCollapsed = $state(false);

  /** Local clock reading at the moment the current TimerView arrived (drift correction). */
  timerReceivedAt = $state(Date.now());
  /** Set when the learner types, so the wait-line retracts before main confirms the pause. */
  lastTypedAt = $state(0);

  ledgerPulse: LedgerPulse = $state({ ids: [], token: 0 });

  /** Seed for the setup screen when the learner arrives via "Paste text instead". */
  setupSeed = $state('');
  /**
   * Set when setup was reached from a file and a page range instead (issue #22 decision 4).
   * It carries the provenance the material row wants and the topic the prefix wants; the text
   * itself still lands in the same textarea, because paste is the flow and this pre-fills it.
   */
  setupFrom: SessionSeed | null = $state(null);

  // ── The vault (issue #22) ──────────────────────────────────────────────
  vault: VaultView | null = $state(null);
  /** A topic id, 'other' for the unpromoted remainder, or null before anything is picked. */
  selectedTopic: string | null = $state(null);
  vaultTree: VaultTreeNode[] = $state([]);
  vaultBusy = $state(false);
  selectedFileId: string | null = $state(null);

  /**
   * The open document and the state a reference reads off it: which page is on screen, which
   * range the learner marked, and what they last selected (issue #22 decisions 3 and 4).
   */
  openDoc: DocumentView | null = $state(null);
  docBusy = $state(false);
  docPage = $state(1);
  docFrom: number | null = $state(null);
  docTo: number | null = $state(null);
  docSelection = $state('');
  /** How many pages the open PDF has, bound out of the viewer so a range can be validated. */
  docPageCount = $state(0);
  /**
   * Where each file was last scrolled to, by file id. VaultBrowser's docstring already promised
   * that "the page they were on" survives closing a document; it only ever did while the pane
   * stayed mounted (ui-review-code.md §5.5). Per-app-session and in memory: it is a convenience,
   * not something worth a row in SQLite.
   */
  docScroll: Record<string, number> = $state({});
  /** Set by a search hit so the PDF jumps to the page the snippet came from. */
  pendingPage: number | null = $state(null);

  // ── The flow (issue #25) ───────────────────────────────────────────────
  /**
   * How an open PDF is shown. `'flow'` is the default and is the product
   * (`flow-build-plan.md` §1: "ChatterED opens a lecture deck as a *flow*"); `'viewer'` is the
   * document pane exactly as it shipped on 15 Sep, one click away and not regressed.
   */
  docView: 'flow' | 'viewer' = $state('flow');
  /**
   * The open document's segments. Everything about them is decided in the main process — the
   * renderer only draws what `segments:*` returns, and never patches this optimistically, so a
   * refused gesture cannot leave the flow showing something SQLite does not agree with.
   */
  flow: SegmentDocumentView | null = $state(null);
  flowBusy = $state(false);
  flowFor: string | null = $state(null);
  /**
   * The last refusal, addressed to the card that caused it. `FlowCanvas` shows it inline for
   * ~2 s and clears it; the sentence is `refusalMessage()`'s, verbatim (SEGMENTS.md §3).
   */
  flowRefusal: { segmentId: string; message: string } | null = $state(null);
  // ── The conversation inside the flow (issue #25, §3.3 track B) ─────────
  /**
   * Which segment's "+ Ask here" prompt is open. One at a time, by construction: a second
   * open closes the first, because two prompts in a document are two places the next keystroke
   * could go.
   */
  askingAt: string | null = $state(null);
  /** The segment whose question is in flight. The card shows the 2–3 s retrieval hold on it. */
  askBusy: string | null = $state(null);
  /** The segment whose thread composer is open — set by **Explain it back →**. */
  composerAt: string | null = $state(null);
  /**
   * Which segment threads are locked to Ellie and Max, and by which REFERENCE card
   * (`reference.ts` property 4). The main process is the authority; this is its projection, and
   * it is patched locally on the two actions that change it so the buttons do not lag the fact.
   */
  flowLocks: Record<string, string> = $state({});
  /** Answer cards collapsed to one line by **Explain it back →** (`pivot-spec.md` §B1). */
  answersCollapsed: Record<string, boolean> = $state({});
  /** Answer cards the learner dismissed with **✕ Remove**. Local: the transcript is not edited. */
  answersRemoved: Record<string, boolean> = $state({});

  // ── Send feedback and turn status (cui-standards-audit.md §1–§3, issue #34) ─────────────
  /**
   * The learner's turns between the keystroke and the main process's echo (audit Fact 1).
   *
   * `flowSend` used to clear the composer synchronously and return `void`, so the learner's own
   * words reached the screen only when `message.appended` came back — and if the IPC call
   * rejected, the text was already gone and all that appeared was a dismissible app-level
   * banner. iMessage, Slack and Claude.ai all append optimistically and mark state on the block.
   */
  pendingSends: PendingSend[] = $state([]);
  /**
   * The anchor the learner last sent to. `ThinkingView` carries no anchor of its own, so this is
   * the fallback `thinkingAnchor()` uses between the send and the first `turn.received` — it is
   * never allowed to override a turn's real anchor.
   */
  lastSendAnchor: string | null = $state(null);
  /**
   * The live turn, from `turn.received` — *the room has your message*, emitted before the
   * floor-yield sleep and before any model call. It is what keeps §C3's deliberately
   * agent-chrome-free window from being a blank screen.
   */
  turnReceived: TurnReceivedView | null = $state(null);
  /** Local clock at the moment that event arrived, so the neutral line can time out. */
  turnReceivedAt: number | null = $state(null);
  /**
   * The provisional body of the turn currently streaming (audit §2, P1). One at a time by
   * construction — `pivot-spec.md` §B10 R2 allows one agent turn in flight document-wide.
   */
  stream: StreamState | null = $state(null);
  /** Turn ids the learner stopped, so the finished card can say so. */
  stoppedTurns: Record<string, boolean> = $state({});
  /** The single sentence the flow's `aria-live` region is currently announcing (WCAG 4.1.3). */
  liveMessage = $state('');
  /** `lastSeenSeq` per thread, from `FlowRoomView.threads`; the unread dot reads it. */
  threadSeen: Record<string, number> = $state({});
  /** Threads the learner collapsed, persisted through `flow:cardState`. */
  threadCollapsed: Record<string, boolean> = $state({});
  /** The ⌥⌘D debug drawer (audit §10). Closed, and empty, until it is opened. */
  debugOpen = $state(false);
  turnTraces: TurnTraceView[] = $state([]);

  // ── The whisper popover on a segment (§3.5, issue #16) ─────────────────
  /**
   * The segment card that currently has focus. Two jobs, both of them about ⌘K:
   *
   *  1. it is what ⌘K acts on — `App.svelte` stands its finder binding down while it is set,
   *     the same way it already stands down inside a room (product-design.md §C10);
   *  2. it is the document's analogue of a keystroke (`pivot-spec.md` §B8), which is why
   *     focusing a card calls `flow:noteSelection`.
   */
  flowFocus: string | null = $state(null);
  /**
   * The open private thread, or null. **The only place a private turn lives in the renderer**,
   * and `WhisperPopover.svelte` is the only component that reads it — `context.test.ts`'s walk
   * over the flow's component graph holds an allowlist of exactly that one file.
   *
   * It is not `this.whisper`: that is the shipped room's pane, keyed on the room, and the two
   * must not be able to show each other's turns.
   */
  flowWhisper: FlowWhisperView | null = $state(null);
  /** A private turn is in flight — Ellie's 1–2 s floor, drawn inside the popover. */
  flowWhisperThinking = $state(false);
  /** An approved **Insert into the document** is in flight. */
  flowWhisperInserting = $state(false);
  /** Rate limiter for `flow:selection`. Plain, not `$state`: nothing renders off it. */
  #lastSelectionSent = 0;

  /**
   * The document behind the room's source pane — the slide being explained, as a page rather
   * than as a paragraph of hyphenated pdf.js output (ui-review-ux.md M11).
   *
   * Held separately from `openDoc` on purpose: `openDoc` is what the learner is browsing, and
   * bringing a second document over must not replace the slide the room is about.
   */
  roomSource: DocumentView | null = $state(null);
  roomSourceFor: string | null = $state(null);

  /**
   * The vault browser as an overlay over a live room (issue #22 decision 4). The learner goes
   * and fetches something and comes back, which is what "bringing a document over" is; the
   * room's three columns are not re-laid-out around a PDF.
   */
  browserOpen = $state(false);
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
  unsubscribeCommands: (() => void) | null = null;

  /**
   * Application-menu items (and the macOS swipe) arrive here. Zoom, fit and page turns go to
   * whichever viewer is open — ⌘+ scales the PDF, never the app chrome — and the rest are the
   * same calls the buttons make, so there is one implementation of each intention.
   */
  runCommand(command: AppCommand): void {
    if (isViewerCommand(command)) {
      runViewerCommand(command);
      return;
    }
    switch (command) {
      case 'vault.open':
        void this.chooseVault();
        break;
      case 'vault.rescan':
        if (this.vault?.rootPath) void this.rescanVault();
        break;
      case 'topics.edit':
        if (this.vault?.rootPath) void this.openTopicSheet();
        break;
      case 'search.files':
        // ⌘K is the whisper inside a room (§C10); the finder is not reachable from there.
        if (this.screen !== 'room' && this.vault?.rootPath) this.openFinder();
        break;
      case 'settings.open':
        void this.openSettings();
        break;
    }
  }

  async init(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = bridge().onEvent((e) => this.apply(e));
    // The scanner and the background indexer push; the renderer never polls for either.
    this.unsubscribeVault?.();
    this.unsubscribeVault = bridge().onVaultChanged((view) => {
      this.vault = view;
    });
    this.unsubscribeCommands?.();
    this.unsubscribeCommands = bridge().onAppCommand((command) => this.runCommand(command));
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
      case 'message.appended': {
        if (room && !room.messages.some((m) => m.id === e.message.id)) room.messages.push(e.message);
        /**
         * The ack (audit §1). The optimistic block is dropped the moment its own echo arrives —
         * matched on the learner's text under the same anchor, not on arrival order, because two
         * sends can be in flight and greying the wrong bubble is worse than greying none.
         */
        const acked = ackIndex(this.pendingSends, e.message);
        if (acked >= 0) this.pendingSends = this.pendingSends.filter((_, i) => i !== acked);
        if (e.message.speaker.kind !== 'student') {
          const name = e.message.speaker.kind === 'agent' ? e.message.speaker.displayName : 'The reference';
          this.liveMessage = announce('replied', {
            name,
            label: this.#anchorLabel(e.message.anchorId),
            words: wordCount(e.message.body),
          });
        }
        break;
      }
      case 'agent.thinking':
        if (room) room.thinking = e.thinking;
        break;
      case 'agent.thinking.cleared':
        if (room) room.thinking = null;
        break;
      /**
       * *The room has your message.* Neutral and un-attributed on screen: `product-design.md`
       * §C3 keeps **agent** chrome out of the floor-yield window, and "the room received this"
       * is not agent chrome — which is the reconciliation the audit proposes for §C3 against
       * `design-brief.md` §D4.
       */
      case 'turn.received':
        this.turnReceived = e.received;
        this.turnReceivedAt = Date.now();
        this.stream = null;
        this.liveMessage = announce('received', { label: this.#anchorLabel(e.received.anchorId) });
        break;
      /**
       * One chunk of a reply that is **already past the floor** — the main process buffers
       * everything the model produced during the hold and flushes it as the first delta, so
       * nothing here can make a turn visible earlier than the floor allows.
       */
      case 'turn.delta':
        this.stream = appendDelta(this.stream, {
          turnId: e.turnId,
          anchorId: e.anchorId,
          agentKey: e.participant.agentKey,
          text: e.text,
        });
        break;
      /** The provisional block for this turn is now a real message; drop it and keep the row. */
      case 'turn.released':
        if (e.stopped) this.stoppedTurns = { ...this.stoppedTurns, [e.turnId]: true };
        if (this.stream?.turnId === e.turnId) this.stream = null;
        if (this.turnReceived?.turnId === e.turnId) {
          this.turnReceived = null;
          this.turnReceivedAt = null;
        }
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
        // The flow's popover. Guarded on the thread id, so the room's pane and the popover can
        // never draw each other's turns even if both happen to be open.
        if (this.flowWhisper && this.flowWhisper.threadId === e.threadId
          && !this.flowWhisper.turns.some((t) => t.id === e.turn.id)) {
          this.flowWhisper.turns.push(e.turn);
          if (e.turn.sender === 'agent') this.flowWhisperThinking = false;
        }
        break;
      case 'whisper.cleared':
        if (this.whisper && this.whisper.threadId === e.threadId) this.whisper.turns = [];
        if (this.flowWhisper && this.flowWhisper.threadId === e.threadId) this.flowWhisper.turns = [];
        break;
      case 'session.recap':
        this.recap = e.recap;
        break;
      case 'notice':
        this.notice = { level: e.level, text: e.text };
        break;
      /**
       * A turn that failed. It lands in the thread it failed in, as a card with a Retry — the
       * one state the app used to render as an empty thread followed by a nudge.
       */
      case 'turn.failed':
        if (room && !room.failures.some((f) => f.id === e.failure.id)) room.failures.push(e.failure);
        // A failed turn ends the exchange, so the neutral "the room has it" line must go with it.
        this.turnReceived = null;
        this.turnReceivedAt = null;
        this.stream = null;
        this.liveMessage = announce('failed', {
          name: e.failure.displayName ?? 'A reply',
          label: this.#anchorLabel(e.failure.anchorId),
          reason: e.failure.reason,
        });
        break;
      case 'turn.failed.cleared':
        if (room) room.failures = room.failures.filter((f) => f.id !== e.failureId);
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

  // ── One document ─────────────────────────────────────────────────────────
  async openFile(fileId: string, page: number | null = null): Promise<void> {
    if (this.openDoc?.fileId === fileId) {
      if (page !== null) this.pendingPage = page;
      return;
    }
    this.docBusy = true;
    this.selectedFileId = fileId;
    this.pendingPage = page;
    const doc = await run(this, () => bridge().openDocument({ fileId }));
    this.docBusy = false;
    if (!doc) return;
    this.openDoc = doc;
  }

  closeDoc(): void {
    this.openDoc = null;
    this.selectedFileId = null;
    this.docSelection = '';
    this.docFrom = null;
    this.docTo = null;
    this.docPageCount = 0;
    this.pendingPage = null;
    this.clearFlow();
  }

  revealFile(fileId: string): Promise<void | null> {
    return run(this, () => bridge().revealFile({ fileId }));
  }

  // ── The flow (issue #25) ─────────────────────────────────────────────────
  /**
   * Open a document's flow. The first call for these bytes runs stages 0–3 in the main process;
   * every later one is a SQLite read. **No model call, ever** — so this is fast, free, offline,
   * and cannot fail on camera.
   */
  async loadFlow(fileId: string): Promise<void> {
    if (this.flowFor === fileId && this.flow) return;
    this.flowFor = fileId;
    this.flow = null;
    this.flowBusy = true;
    const view = await run(this, () => bridge().getSegments({ fileId }));
    this.flowBusy = false;
    // A second document opened while this one was loading wins.
    if (this.flowFor !== fileId) return;
    if (view) this.flow = view;
    // The conversation this document already has, if any. Separate call, and it creates nothing:
    // most documents have never been asked a question, and opening one must cost no room.
    await this.loadFlowRoom(fileId);
  }

  clearFlow(): void {
    this.flow = null;
    this.flowFor = null;
    this.flowRefusal = null;
    this.askingAt = null;
    this.askBusy = null;
    this.composerAt = null;
    this.flowLocks = {};
    this.answersCollapsed = {};
    // Closing the document ends every private thread on it. The popover is not restored on
    // reopen, and `flow:messages` has nothing to restore it from — that is the point of §3.5.
    this.flowWhisper = null;
    this.flowWhisperThinking = false;
    this.flowWhisperInserting = false;
    this.flowFocus = null;
    this.answersRemoved = {};
    // The room itself is *not* closed: the actor stays on it in the main process, and the
    // transcript is the document's. Only this renderer's view of it is dropped.
    if (this.screen !== 'room') this.room = null;
  }

  /**
   * The one place a `SegmentDocumentView` is taken in.
   *
   * All five channels return a complete view, and a refused operation returns it **unchanged**
   * with `refused` set rather than throwing (SEGMENTS.md §3) — so there is no try/catch around a
   * gesture, and the refusal becomes an inline sentence on the card instead of a banner.
   * Returns true when the view actually changed, which is what the undo stack records.
   */
  #applyFlow(view: SegmentDocumentView | null, segmentId: string): boolean {
    if (!view) return false;
    this.flow = view;
    if (view.refused) {
      this.flowRefusal = { segmentId, message: view.refused.message };
      return false;
    }
    this.flowRefusal = null;
    return true;
  }

  async splitSegment(input: {
    segmentId: string;
    at: number;
    axis?: 'horizontal' | 'vertical';
    free?: boolean;
  }): Promise<boolean> {
    const fileId = this.flowFor;
    if (!fileId) return false;
    const view = await run(this, () => bridge().splitSegment({ fileId, ...input }));
    return this.#applyFlow(view, input.segmentId);
  }

  async mergeSegments(ids: [string, string]): Promise<boolean> {
    const fileId = this.flowFor;
    if (!fileId) return false;
    const view = await run(this, () => bridge().mergeSegments({ fileId, segmentIds: ids }));
    return this.#applyFlow(view, ids[0]);
  }

  async reorderSegment(segmentId: string, toIndex: number): Promise<boolean> {
    const fileId = this.flowFor;
    if (!fileId) return false;
    const view = await run(this, () => bridge().reorderSegments({ fileId, segmentId, toIndex }));
    return this.#applyFlow(view, segmentId);
  }

  async renameSegment(segmentId: string, label: string): Promise<boolean> {
    const fileId = this.flowFor;
    if (!fileId) return false;
    const view = await run(this, () => bridge().renameSegment({ fileId, segmentId, label }));
    return this.#applyFlow(view, segmentId);
  }

  /**
   * "+ Ask here" opens the prompt at the card. Pre-focused, `Esc` cancels — the Cursor ⌘K
   * gesture `pivot-spec.md` §B1 asks for, moved from a box-select to a card.
   */
  openAsk(segmentId: string): void {
    this.askingAt = segmentId;
  }

  cancelAsk(): void {
    this.askingAt = null;
  }

  /**
   * Ask. **This is what creates the document's room**, the first time (§3.3) — there is no setup
   * screen. The answer is held 2–3 s in the main process, so the card appears with the question
   * still on screen and the learner has not been asked to wait for anything.
   */
  async askHere(segmentId: string, question: string): Promise<void> {
    const fileId = this.flowFor;
    if (!fileId || question.trim().length === 0) return;
    this.askingAt = null;
    this.askBusy = segmentId;
    const answer = await run(this, () => bridge().flowAskHere({ fileId, segmentId, question: question.trim() }));
    this.askBusy = null;
    if (!answer) return;
    this.#takeFlowRoom(answer.flow);
  }

  /**
   * "Explain it back →": the card collapses to one line, the composer opens on the same anchor,
   * and Ellie and Max become eligible on it for the first time. The order matters — the lock is
   * released by the main process, and the composer only opens if it said so.
   */
  async explainBack(answerId: string): Promise<void> {
    const result = await run(this, () => bridge().flowExplainBack({ answerId }));
    if (!result?.unlocked || result.anchorId === null) return;
    this.answersCollapsed = { ...this.answersCollapsed, [answerId]: true };
    const { [result.anchorId]: _gone, ...rest } = this.flowLocks;
    this.flowLocks = rest;
    this.composerAt = result.anchorId;
  }

  /**
   * **✕ Remove**: the card goes off this learner's screen. The transcript is never edited.
   *
   * Persisted through `flow:cardState` on the card's anchor (audit §7): reopening a deck used to
   * bring back every card the learner had dismissed, which reads as the app overruling them.
   */
  removeAnswer(answerId: string, anchorId: string | null = null): void {
    this.answersRemoved = { ...this.answersRemoved, [answerId]: true };
    const roomId = this.room?.roomId;
    const anchor = anchorId ?? this.room?.messages.find((m) => m.id === answerId)?.anchorId ?? null;
    if (roomId && anchor && has('flowCardState')) {
      void run(this, () => bridge().flowCardState({ roomId, anchorId: anchor, removed: true }));
    }
  }

  /** The label of the segment a turn landed under, for the live region's one sentence. */
  #anchorLabel(anchorId: string | null): string {
    if (!anchorId) return '';
    return this.flow?.segments.find((seg) => seg.id === anchorId)?.label ?? '';
  }

  /**
   * A learner turn inside one segment's thread.
   *
   * Deliberately not awaited, for the reason `showTheRoom()` gives: the call does not resolve
   * until the agent that answers has finished its latency floor, which is 9–12 s for the Tester.
   */
  flowSend(segmentId: string, text: string): string | null {
    const roomId = this.room?.roomId;
    const body = text.trim();
    if (!roomId || !body) return null;
    this.lastTypedAt = 0;
    this.lastSendAnchor = segmentId;
    const id = nextSendId();
    this.pendingSends = [
      ...this.pendingSends,
      { id, anchorId: segmentId, body, state: 'pending', at: Date.now(), error: null },
    ];
    /**
     * Deliberately **not** funnelled through `run()`: a rejection here belongs on the block the
     * learner is looking at, not in a global dismissible banner with no anchor and no retry
     * (audit §3). By the time this promise settles the echo has long since acked and removed the
     * pending entry, so a late rejection — a turn that failed after the message was accepted —
     * finds nothing to fail and is left to the failure card, which is where it belongs.
     */
    void bridge()
      .flowSend({ roomId, segmentId, text: body })
      .catch((err: unknown) => this.failSend(id, message(err)));
    return id;
  }

  /** Mark one optimistic block failed, in place, with the sentence that actually broke. */
  failSend(id: string, reason: string): void {
    this.pendingSends = this.pendingSends.map((p) =>
      p.id === id ? { ...p, state: 'failed' as const, error: reason } : p,
    );
  }

  /** **Retry** on a failed block: the stored body, re-sent, in the thread it was written in. */
  retrySend(id: string): void {
    const entry = this.pendingSends.find((p) => p.id === id);
    if (!entry) return;
    this.pendingSends = this.pendingSends.filter((p) => p.id !== id);
    this.flowSend(entry.anchorId, entry.body);
  }

  /** **Discard** on a failed block. The text is gone only once the learner says so. */
  dropSend(id: string): void {
    this.pendingSends = this.pendingSends.filter((p) => p.id !== id);
  }

  /**
   * **Stop** a generating turn (audit §2e, Lucas's 2026-09-16 decision).
   *
   * The button is only offered once the floor has elapsed, so a refusal here means the two
   * clocks disagreed; it is reported as a refusal rather than swallowed, because a Stop that
   * silently does nothing is the failure mode the button exists to avoid.
   */
  async stopTurn(): Promise<void> {
    const roomId = this.room?.roomId;
    const turnId = this.stream?.turnId ?? this.turnReceived?.turnId ?? null;
    if (!roomId || !turnId || !has('flowStop')) return;
    const result = await run(this, () => bridge().flowStop({ roomId, turnId }));
    if (result && !result.stopped && result.refused === 'floor') {
      this.notice = { level: 'info', text: 'The deliberate wait has not finished yet.' };
    }
  }

  /** The ⌥⌘D drawer's rows (audit §10). No bodies are in them, by construction in the actor. */
  async loadTurnTraces(): Promise<void> {
    const roomId = this.room?.roomId;
    if (!roomId || !has('flowTurnTrace')) return;
    const rows = await run(this, () => bridge().flowTurnTrace({ roomId, turnId: null }));
    if (rows) this.turnTraces = rows;
  }

  /** The learner has this thread on screen. Clears its unread dot, in main and here. */
  markSeen(anchorId: string, seq: number): void {
    const roomId = this.room?.roomId;
    if (!roomId || seq <= (this.threadSeen[anchorId] ?? 0)) return;
    this.threadSeen = { ...this.threadSeen, [anchorId]: seq };
    if (has('flowMarkSeen')) void run(this, () => bridge().flowMarkSeen({ roomId, anchorId, seq }));
  }

  /** Thread collapse, persisted — a thread the learner folded away stays folded (audit §7). */
  setThreadCollapsed(anchorId: string, collapsed: boolean): void {
    this.threadCollapsed = { ...this.threadCollapsed, [anchorId]: collapsed };
    const roomId = this.room?.roomId;
    if (roomId && has('flowCardState')) {
      void run(this, () => bridge().flowCardState({ roomId, anchorId, collapsed }));
    }
  }

  /**
   * A segment card took focus. `pivot-spec.md` §B8's selection change, reported to the silence
   * timer, and rate-limited to one call per 3 s exactly as the typing heartbeat is — tabbing
   * through eight cards is one gesture, not eight.
   */
  noteFlowSelection(segmentId: string): void {
    this.flowFocus = segmentId;
    const roomId = this.room?.roomId;
    if (!roomId) return;
    const now = Date.now();
    if (now - this.#lastSelectionSent < 3_000) return;
    this.#lastSelectionSent = now;
    void run(this, () => bridge().flowSelection({ roomId, segmentId }));
  }

  // ── The whisper popover on a segment (§3.5, issue #16) ──────────────────

  /**
   * ⌘K, or **Ask privately** in the card's label strip.
   *
   * Opening it on a second card closes the first, for the same reason two "+ Ask here" prompts
   * cannot be open at once: two composers in a document are two places the next keystroke could
   * go. The main process decides whether that is the same private thread or a fresh one — the
   * key is the **segment sitting** (`actor.openSegmentWhisper`), and the renderer never guesses.
   */
  async openFlowWhisper(segmentId: string): Promise<void> {
    const fileId = this.flowFor;
    if (!fileId) return;
    if (this.flowWhisper && this.flowWhisper.anchorId !== segmentId) this.closeFlowWhisper();
    const opened = await run(this, () => bridge().flowWhisperOpen({ fileId, segmentId }));
    if (!opened || this.flowFor !== fileId) return;
    this.flowWhisper = opened.whisper;
    // `flow:whisperOpen` creates the room on a document whose first act was a private question,
    // so pick the transcript up the same way "+ Ask here" does.
    if (!this.room || this.room.roomId !== opened.roomId) await this.loadFlowRoom(fileId);
  }

  /**
   * A private turn. Not awaited for the reply: Ellie is held 1–2 s in the main process and her
   * answer arrives on the `whisper.turn` stream, which is where every whisper turn has always
   * arrived from.
   */
  sendFlowWhisper(text: string): void {
    const fileId = this.flowFor;
    const thread = this.flowWhisper;
    const roomId = this.room?.roomId;
    if (!fileId || !thread || !roomId || !text.trim()) return;
    this.flowWhisperThinking = true;
    void run(this, () =>
      bridge().flowWhisperSend({
        roomId,
        fileId,
        segmentId: thread.anchorId,
        threadId: thread.threadId,
        text: text.trim(),
      }),
    ).then((ok) => {
      if (ok === null) this.flowWhisperThinking = false;
    });
  }

  /**
   * **Insert into the document.** The approved relay: a new *shared* card under the segment.
   *
   * The private thread is neither moved nor revealed — `actor.relay()` inserts a new row and
   * `markPromoted` records the provenance for the export, and that is the whole of the crossing.
   * The popover stays open, because the learner may well have another private question about the
   * card they just wrote on.
   */
  async insertFlowWhisper(input: { whisperId: string; attribution: RelayAttribution; text: string }): Promise<void> {
    const thread = this.flowWhisper;
    const roomId = this.room?.roomId;
    if (!thread || !roomId || input.text.trim().length === 0) return;
    this.flowWhisperInserting = true;
    const result = await run(this, () =>
      bridge().flowWhisperRelay({
        roomId,
        segmentId: thread.anchorId,
        threadId: thread.threadId,
        whisperId: input.whisperId,
        attribution: input.attribution,
        text: input.text.trim(),
      }),
    );
    this.flowWhisperInserting = false;
    if (result) this.#takeFlowRoom(result.flow);
  }

  /** `Esc`, click-away, or leaving the card. Nothing is posted and nothing is kept. */
  closeFlowWhisper(): void {
    const thread = this.flowWhisper;
    const roomId = this.room?.roomId;
    this.flowWhisper = null;
    this.flowWhisperThinking = false;
    this.flowWhisperInserting = false;
    if (roomId && thread) void run(this, () => bridge().flowWhisperClose({ roomId, threadId: thread.threadId }));
  }

  /** The document's room, if it has one. Called when a flow opens; creates nothing. */
  async loadFlowRoom(fileId: string): Promise<void> {
    const view = await run(this, () => bridge().flowMessages({ fileId }));
    if (!view || this.flowFor !== fileId) return;
    this.#takeFlowRoom(view);
  }

  /**
   * The one place a `FlowRoomView` is taken in.
   *
   * `room` is an ordinary `RoomSnapshot`, and it goes in `this.room` on purpose: every event the
   * flow needs — `message.appended`, `agent.thinking`, `ledger.updated`, `timer.updated` — is
   * already applied there by `apply()`, so the flow's threads stay live without a second
   * subscription and without a second copy of the transcript to keep in step. The screen is not
   * changed: the flow is the screen.
   */
  #takeFlowRoom(view: {
    room: RoomSnapshot;
    threads: {
      anchorId: string;
      lockedByAnswerId: string | null;
      lastSeenSeq?: number;
      collapsed?: boolean;
      removed?: boolean;
    }[];
  }): void {
    this.room = view.room;
    this.timerReceivedAt = Date.now();
    const locks: Record<string, string> = {};
    const seen: Record<string, number> = {};
    const collapsed: Record<string, boolean> = {};
    // Plain, not reactive: it is a local index built and consumed inside this one call.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const removedAnchors = new Set<string>();
    for (const t of view.threads) {
      if (t.lockedByAnswerId) locks[t.anchorId] = t.lockedByAnswerId;
      if (typeof t.lastSeenSeq === 'number') seen[t.anchorId] = t.lastSeenSeq;
      if (t.collapsed) collapsed[t.anchorId] = true;
      if (t.removed) removedAnchors.add(t.anchorId);
    }
    this.flowLocks = locks;
    this.threadSeen = seen;
    this.threadCollapsed = collapsed;
    /**
     * `removed` is persisted per **anchor**, which is the grain `flow:cardState` offers; a
     * thread holds at most one REFERENCE answer awaiting hand-back at a time, so re-applying it
     * to the thread's reference cards restores exactly what the learner dismissed. Agent turns
     * are never removable, so nothing the agents said can be hidden by this.
     */
    if (removedAnchors.size > 0) {
      const removed: Record<string, boolean> = { ...this.answersRemoved };
      for (const m of view.room.messages) {
        if (m.speaker.kind === 'reference' && m.anchorId && removedAnchors.has(m.anchorId)) {
          removed[m.id] = true;
        }
      }
      this.answersRemoved = removed;
    }
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
    this.setupFrom = null;
    this.screen = 'setup';
  }

  /**
   * Session setup from the open document and its marked page range. Paste stays the fallback:
   * this fills the same box, and nothing downstream knows the difference except the material
   * row's provenance and the topic block in the prefix.
   */
  async setupFromFile(fileId: string, pageFrom: number | null, pageTo: number | null): Promise<void> {
    const seed = await run(this, () => bridge().sessionSeed({ fileId, pageFrom, pageTo }));
    if (!seed) return;
    this.setupSeed = seed.text;
    this.setupFrom = seed;
    this.screen = 'setup';
  }

  /**
   * "Show the room" — post the open document into the group chat as the learner.
   *
   * Deliberately not awaited. The main-process call does not resolve until the agent that
   * answers has finished its latency floor and its generation, which is 9–12 s for the
   * Challenger; waiting for that would leave the learner staring at the file they just showed
   * with a spinner on the button. It is the same shape as `send()`: fire it, go back to the
   * room, and let the reply arrive as an event. A failure still lands in the notice banner.
   */
  showTheRoom(): boolean {
    const roomId = this.room?.roomId;
    const doc = this.openDoc;
    if (!roomId || !doc) return false;
    // An inverted range resolves to no page text at all, so it never leaves the renderer.
    const range = validateRange(this.docFrom, this.docTo, this.docPageCount);
    if (!range.valid) {
      this.notice = { level: 'error', text: range.error ?? 'That page range runs backwards.' };
      return false;
    }
    const selection = this.docSelection.trim();
    const payload = {
      roomId,
      fileId: doc.fileId,
      pageFrom: doc.kind === 'pdf' ? (range.from ?? this.docPage) : null,
      pageTo: doc.kind === 'pdf' ? (range.to ?? this.docPage) : null,
      selection: selection.length > 0 ? selection : null,
    };
    this.browserOpen = false;
    this.docSelection = '';
    void run(this, () => bridge().showDocument(payload));
    return true;
  }

  /**
   * Fetch the material's own file once per room. Failure is silent: the pane falls back to the
   * extracted text, which is what a pasted-text session and every pre-migration room show.
   */
  async loadRoomSource(fileId: string | null): Promise<void> {
    if (fileId === null) {
      this.roomSource = null;
      this.roomSourceFor = null;
      return;
    }
    if (this.roomSourceFor === fileId) return;
    this.roomSourceFor = fileId;
    try {
      this.roomSource = await bridge().openDocument({ fileId });
    } catch {
      this.roomSource = null;
    }
  }

  async openRoom(roomId: string): Promise<void> {
    const snapshot = await run(this, () => bridge().openRoom(roomId));
    if (!snapshot) return;
    this.room = snapshot;
    this.timerReceivedAt = Date.now();
    this.recap = null;
    this.whisper = null;
    this.whisperOpen = false;
    this.screen = 'room';
    void this.loadRoomSource(snapshot.material.fileId);
  }

  leaveRoom(): void {
    this.browserOpen = false;
    this.room = null;
    this.roomSource = null;
    this.roomSourceFor = null;
    this.recap = null;
    this.whisper = null;
    this.whisperOpen = false;
    this.screen = 'library';
  }

  // ── Session setup ────────────────────────────────────────────────────────
  draftConcept(input: { moduleCode: string; title: string; text: string }): Promise<ConceptDraft | null> {
    return run(this, () => bridge().draftConcept(input));
  }

  async createSession(input: CreateSessionInput): Promise<void> {
    const from = this.setupFrom;
    const full: CreateSessionInput = from
      ? {
          ...input,
          sourceKind: 'pdf_pages',
          fileId: from.fileId,
          fileName: from.fileName,
          ...(from.pageFrom !== null ? { pageFrom: from.pageFrom } : {}),
          ...(from.pageTo !== null ? { pageTo: from.pageTo } : {}),
          ...(from.topic ? { topic: from.topic } : {}),
        }
      : input;
    // Everything on `this` is a $state proxy, and structuredClone — which is what IPC is —
    // refuses a proxy with "An object could not be cloned". Snapshot before it crosses.
    const created = await run(this, () => bridge().createSession($state.snapshot(full) as CreateSessionInput));
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

  /** Settings ▸ Diagnostics: transient "Copied" confirmation on the button. */
  diagnosticsCopied = $state(false);

  openLogFolder(): void {
    void run(this, () => bridge().openLogFolder());
  }

  /**
   * Version, build, backend, models and the last 50 log lines, on the clipboard. The main
   * process assembles it — the renderer has no business reading a file — and the lines were
   * redacted when they were written, so there is nothing here to review before pasting.
   */
  async copyDiagnostics(): Promise<void> {
    const text = await run(this, () => bridge().diagnostics());
    if (typeof text !== 'string') return;
    try {
      await navigator.clipboard.writeText(text);
      this.diagnosticsCopied = true;
      setTimeout(() => (this.diagnosticsCopied = false), 1600);
    } catch {
      this.notice = { level: 'error', text: 'Could not reach the clipboard.' };
    }
  }

  /** The card's button. The main process owns what "the same turn" means; this only names it. */
  retryTurn(failureId: string): void {
    const roomId = this.room?.roomId;
    if (roomId) void run(this, () => bridge().retryTurn({ roomId, failureId }));
  }

  pauseNudges(paused: boolean): void {
    const roomId = this.room?.roomId;
    if (!roomId) return;
    if (this.room) this.room.nudgesPaused = paused;
    void run(this, () => bridge().pauseNudges({ roomId, paused }));
  }

  /**
   * "Yes, invite Theo." The teach-back round itself is A2; this records the acceptance and
   * brings back the line the card shows in place of the two buttons, so the primary button on
   * the payoff screen is no longer a button with no handler (ui-review-ux.md M9).
   */
  async acceptTeachback(agentKey: string): Promise<void> {
    const roomId = this.room?.roomId;
    if (!roomId) return;
    const result = await run(this, () => bridge().acceptTeachback({ roomId, agentKey }));
    this.teachbackNote = result?.note ?? null;
  }

  async wrapUp(): Promise<void> {
    const roomId = this.room?.roomId;
    if (!roomId) return;
    this.teachbackNote = null;
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
