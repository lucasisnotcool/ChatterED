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
  RecapView,
  RelayAttribution,
  RoomEvent,
  RoomSnapshot,
  SearchHitView,
  SessionSeed,
  SettingsPatch,
  SettingsView,
  TopicCandidateView,
  TurnTraceView,
  VaultTreeNode,
  VaultView,
  WhisperThreadView,
} from '../../shared/types.js';
import type { ChatterEdApi } from '../../shared/ipc.js';
import { bridge } from './bridge.js';
import { validateRange } from './pdfview.js';
import { isViewerCommand, runViewerCommand } from './viewer.js';
import {
  SESSION_WINDOW,
  type CostAnalytics,
  type CostAnalyticsQuery,
  type CostCallView,
  type CostMessageCost,
  type CostMessageQuery,
  type CostSummary,
  type CostSummaryQuery,
  type CostUpdate,
} from '../../shared/cost.js';
import { applyDelta, updateBelongs } from './cost.js';
// collab-doc (#48): three sibling stores, each owned by one track. This file only hosts them.
import { DocStore } from './docstore.svelte.js';
import { ChatStore } from './chatstore.svelte.js';
import { ProgressStore } from './progressstore.svelte.js';

/**
 * Is a channel actually on the bridge?
 *
 * The check is on the preload object, so it is true exactly when the channel is reachable — a
 * build (or the dev mock) whose preload predates a channel degrades to doing nothing rather than
 * throwing an "unknown channel" into the notice banner.
 */
function has(name: keyof ChatterEdApi): boolean {
  return typeof (bridge() as unknown as Record<string, unknown>)[name] === 'function';
}

/**
 * Fire a bookkeeping call and swallow whatever comes back.
 *
 * `has()` proves the *channel* is on the preload object; it does not prove the main process has
 * registered a handler for it yet. An unhandled channel rejects with `No handler registered for
 * …`, and routing that through `run()` would put a banner on screen for a call that has nothing
 * to report to the learner. Bookkeeping that is not possible is not an error.
 */
function quiet<T>(fn: () => Promise<T>): Promise<T | null> {
  return fn().catch(() => null);
}

/**
 * **The cost channels, before they are on `ChatterEdApi`.**
 *
 * `src/shared/cost.ts` landed with the shapes; `cost:summary`, `cost:recent` and `cost:export`
 * are on the main-process track and are not on the preload interface yet. `has()` takes a
 * `keyof ChatterEdApi` and therefore cannot be asked about them, so this is the same question in
 * the same place — a lookup on the preload object — typed against the documented shapes rather
 * than against an interface that has not caught up.
 *
 * It is a cast and it is the only one: when the contract lands, these three lines and `costApi()`
 * go, and every call site below is already written against the real types.
 */
interface CostApi {
  costSummary(input: CostSummaryQuery): Promise<CostSummary>;
  costRecent(input: { limit?: number; fileId?: string | null }): Promise<CostCallView[]>;
  costExport(input: { since?: string | null }): Promise<{ csv: string } | string | null>;
  costMessages(input: CostMessageQuery): Promise<CostMessageCost[]>;
  costAnalytics(input: CostAnalyticsQuery): Promise<CostAnalytics>;
}

function costApi(): Partial<CostApi> {
  return bridge() as unknown as Partial<CostApi>;
}

function hasCost(name: keyof CostApi): boolean {
  return typeof costApi()[name] === 'function';
}

/**
 * A pure view preference, kept in `localStorage` rather than in the settings database:
 * `SettingsView` is `src/shared`'s, with the main process's schema behind it, and nothing
 * outside the meter reads this. In an Electron renderer `localStorage` is a file in the same
 * `userData` directory the settings database is in, so "per install, survives a relaunch" is
 * the same promise either way.
 */
/** Per-message meters, on by default (#42 item C). */
const MESSAGE_COST_KEY = 'chattered.cost.perMessage';

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : raw === 'true';
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // A denied or full store is not worth failing a toggle over.
  }
}

/**
 * `'usage'` is the Usage page (#42 item D) — a **destination**, not a panel in Settings.
 *
 * Settings ▸ Usage is where the first counters landed, and it was the wrong home for them: a
 * page nobody opens unless something is already wrong, next to the API key and the model
 * dropdowns. What a deck cost, which deck cost the most and how much of the five-hour window is
 * gone are things a learner should be able to look at on the way past, so they get a stop on the
 * nav rail and a reachable indicator in the title bar. The Settings section stays where it is —
 * it is where the rate card is edited, and that genuinely is a setting.
 */
export type Screen = 'loading' | 'firstRun' | 'library' | 'setup' | 'room' | 'settings' | 'usage';

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
  /** collab-doc (#48). The notes doc, the chats and the progress bar keep their own state. */
  readonly doc = new DocStore();
  readonly chat = new ChatStore();
  readonly progress = new ProgressStore();

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

  /**
   * How an open PDF is shown (#48).
   *
   * `'notes'` is the default and is the product: the three-column shell, *file panel · doc ·
   * chats* (`collab-doc.md` §0). `'viewer'` is the page viewer — the document pane exactly as it
   * shipped on 15 Sep, one click away in the doc header and not regressed, because a learner has
   * to be able to look at the slide itself.
   */
  docView: 'notes' | 'viewer' = $state('notes');

  /** The ⌥⌘D debug drawer (audit §10). Closed, and empty, until it is opened. */
  debugOpen = $state(false);
  turnTraces: TurnTraceView[] = $state([]);

  // ── What this has cost (issue #41 item 4) ───────────────────────────────
  /**
   * Three counters that nest — `thread ⊆ file ⊆ app` — held separately because they are shown in
   * three places and a learner who can see all three at once must be able to add them up.
   *
   * Each is `cost:summary`'s own answer, ticked in place by `cost.updated` between round trips.
   * Null means *not asked yet or not available*, which is not the same as zero and is why the
   * counters render nothing at all rather than `0 tokens` on a build without the channel.
   */
  costThread: Record<string, CostSummary> = $state({});
  costFile: CostSummary | null = $state(null);
  /** All time, every call, including the ones that belong to no document. */
  costApp: CostSummary | null = $state(null);
  /** Since this launch. `SESSION_WINDOW` asks for it without the renderer knowing when that was. */
  costSession: CostSummary | null = $state(null);
  /** The last calls, for Settings ▸ Usage and the ⌥⌘D drawer. Sizes and counts; no bodies. */
  costRecent: CostCallView[] = $state([]);
  costBusy = $state(false);

  /**
   * **What each message on screen cost** (#42 item B), keyed by message id.
   *
   * One map for the whole room rather than one fetch per card: a chat column has twenty cards in
   * it and twenty round trips to draw twenty meters would put the ledger in front of the
   * conversation. A message that is not in here has no meter — which is every learner block,
   * every rule-written line, and every row recorded before migration 021.
   */
  costMessages: Record<string, CostMessageCost> = $state({});
  /** The Usage page's whole payload. Null until it has been opened once. */
  costAnalytics: CostAnalytics | null = $state(null);
  costAnalyticsBusy = $state(false);
  /**
   * The filters the page is currently showing, held here rather than in the component so that a
   * live `cost.updated` re-reads *what the learner is looking at* and not an unfiltered page.
   */
  costAnalyticsQuery: CostAnalyticsQuery = $state({});
  /**
   * **Per-message meters, on by default** (#42 item C, the Settings toggle).
   *
   * Default *shown*, because the brief's ask is that the cost be visible at every level and a
   * number nobody has found is not visible. It is small, low-contrast and under the card, so the
   * cost of being wrong about the default is a line of grey text; the cost of defaulting it off
   * is a feature that ships dark.
   */
  showMessageCost = $state(readFlag(MESSAGE_COST_KEY, true));

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
    // collab-doc (#48): every event goes to the three sibling stores first. They take what is
    // theirs (`notes.*`, `doc.*`, `chat.*`, `progress.*`, and the message/turn events the chats
    // draw from) and ignore the rest; nothing below depends on what they did with it.
    this.doc.apply(e);
    this.chat.apply(e);
    this.progress.apply(e);
    const room = this.room;
    /**
     * **`cost.updated`, handled before the switch** (issue #41 item 4).
     *
     * It is not in `RoomEvent` yet — the cost ledger is on the main-process track — so it cannot
     * be a `case` without breaking the build of everyone who pulls this first. Read structurally
     * instead: an event with this type and an `update` on it is the one, and every other event
     * falls through to the switch untouched. The `case` replaces this when the union lands.
     */
    const maybeCost = e as unknown as { type: string; update?: CostUpdate };
    if (maybeCost.type === 'cost.updated') {
      if (maybeCost.update) this.#takeCostUpdate(maybeCost.update);
      return;
    }
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
      /** The provisional block for this turn is now a real message; drop it and keep the row. */
      case 'turn.released':
        // The counters, while the push side is not live yet — see `#costLive`.
        this.#recountAfterTurn();
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
      /**
       * A turn that failed. It lands in the thread it failed in, as a card with a Retry — the
       * one state the app used to render as an empty thread followed by a nudge.
       */
      case 'turn.failed':
        if (room && !room.failures.some((f) => f.id === e.failure.id)) room.failures.push(e.failure);
        break;
      case 'turn.failed.cleared':
        if (room) room.failures = room.failures.filter((f) => f.id !== e.failureId);
        break;
      /**
       * **The concept pack finished ingesting** (issue #35, `main/pack.ts`).
       *
       * A room can exist before its pack does: the first Ask creates the room immediately and
       * the deck's concepts are drafted in the background, so until this arrives the ledger is
       * genuinely empty and the rail says so rather than showing a blank list. `pack.ready`
       * carries the rebuilt ledger, so the rail is redrawn from the event itself and never has
       * to ask for it.
       */
      case 'pack.ready':
        if (room) room.ledger = e.ledger;
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
    // Usage is a panel in Settings, so it is loaded with Settings. It is the one place that
    // shows slices, and the one place that can afford the round trip.
    void this.loadUsage();
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
    // The file and thread counters are the document's. The app's is not, and survives.
    this.costFile = null;
    this.costThread = {};
    this.#costAsked.clear();
    // The room itself is *not* closed: the actor stays on it in the main process, and the
    // transcript is the document's. Only this renderer's view of it is dropped.
    if (this.screen !== 'room') this.room = null;
  }

  revealFile(fileId: string): Promise<void | null> {
    return run(this, () => bridge().revealFile({ fileId }));
  }

  /**
   * The Teacher, by name — for the Ask line's *"Asking Ellie…"* and the summary card's chrome.
   *
   * `'peer'` is the Teacher's role key; the rename in #32 changed the word on screen and not the
   * enum. Falls back to the persona's shipped name rather than to "the teacher", because a build
   * with no room open yet still has to put something in a label.
   */
  get teacherName(): string {
    return this.room?.agents.find((a) => a.role === 'peer')?.displayName ?? 'Ellie';
  }

  /**
   * The Tester, by name — for *"Max is reading…"* and for the composer's one quiet line, which
   * has to name the agent whose rule it is stating. `'challenger'` is the Tester's role key, for
   * the same reason `'peer'` is the Teacher's: #32 renamed the words on screen, not the enum.
   */
  get testerName(): string {
    return this.room?.agents.find((a) => a.role === 'challenger')?.displayName ?? 'Max';
  }

  // ── What this has cost (issue #41 item 4) ─────────────────────────────────

  /** Is the cost ledger reachable? Every counter renders nothing at all when it is not. */
  get costOn(): boolean {
    return hasCost('costSummary');
  }

  get canExportCost(): boolean {
    return hasCost('costRecent');
  }

  /**
   * One counter, fetched.
   *
   * Level-addressed rather than one omnibus call, because the three counters have three
   * different lifetimes: the thread's dies with the thread, the file's with the document, and
   * the app's outlives both. Failures are swallowed — `quiet()`, not `run()` — for the reason
   * the turn-status calls give: a learner who cannot be told what a thread cost has not lost
   * anything they came here for, and a banner over the document would be the actual harm.
   */
  async loadCost(query: CostSummaryQuery): Promise<CostSummary | null> {
    if (!this.costOn) return null;
    const summary = await quiet(() => costApi().costSummary!(query));
    if (!summary) return null;
    switch (query.level) {
      case 'thread':
        if (summary.anchorId) this.costThread = { ...this.costThread, [summary.anchorId]: summary };
        break;
      case 'file':
        this.costFile = summary;
        break;
      case 'app':
        if (query.since === SESSION_WINDOW) this.costSession = summary;
        else this.costApp = summary;
        break;
    }
    return summary;
  }

  /**
   * The counters are **pulled by the surfaces that show them**, once each, rather than pushed
   * from here on every room change.
   *
   * A forty-slide deck has forty threads, and eagerly summarising all of them would put forty
   * sqlite reads behind one IPC lane in front of the learner's first question. A thread footer
   * that is on screen asks for its own number; after that `cost.updated` keeps it current and
   * nothing round-trips again. `#costAsked` is what makes the ask idempotent — a Svelte effect
   * re-runs whenever anything it read changes, and this must not re-fetch when it does.
   */
  #costAsked = new Set<string>();
  /**
   * Has a `cost.updated` ever arrived?
   *
   * The push side lands after the query side — on the live build of 2026-09-16 `cost:summary`
   * answered and no event ever came — and a file counter that was read before the first call and
   * never ticked shows `this file · 0 tokens` **under** a thread showing two. A visible violation
   * of the one invariant the three counters exist to let a learner check (`thread ≤ file ≤ app`)
   * is worse than a query per turn, so until the first event proves the push side is live, the
   * end of a turn re-asks. After it, this never runs again.
   */
  #costLive = false;

  /**
   * **Which document the counters are about.**
   *
   * The old flow's `flowFor` was the only answer while a PDF opened into `FlowCanvas`. Since #48
   * it opens into the three-column shell, which sets `openDoc` and never set `flowFor` at all —
   * so a file counter keyed on the flow's file silently stopped existing on the surface the app
   * now actually has. `openDoc` is the whole of it, and one getter so no third surface has to
   * remember the rule.
   */
  get costFileId(): string | null {
    return this.openDoc?.fileId ?? null;
  }

  /**
   * The app-level pair the title-bar indicator needs: everything, and this session. Asked once
   * — after that `cost.updated` ticks both without a round trip.
   */
  ensureAppCost(): void {
    if (!this.costOn || this.#costAsked.has('app')) return;
    this.#costAsked.add('app');
    void this.loadCost({ level: 'app' });
    void this.loadCost({ level: 'app', since: SESSION_WINDOW });
  }

  ensureThreadCost(anchorId: string): void {
    const fileId = this.costFileId;
    if (!this.costOn || !fileId) return;
    const key = `thread:${fileId}:${anchorId}`;
    if (this.#costAsked.has(key)) return;
    this.#costAsked.add(key);
    void this.loadCost({ level: 'thread', fileId, anchorId });
  }

  /**
   * Re-ask for the counters that are on screen, at the end of a turn, **only** while no
   * `cost.updated` has ever arrived. One query for the file and one for each thread that already
   * has a counter; nothing for the other thirty-nine threads of a deck, which have never been
   * asked about and will ask for themselves when they are.
   */
  #recountAfterTurn(): void {
    if (this.#costLive || !this.costOn) return;
    const fileId = this.costFileId;
    if (!fileId) return;
    void this.loadCost({ level: 'file', fileId });
    for (const anchorId of Object.keys(this.costThread)) {
      void this.loadCost({ level: 'thread', fileId, anchorId });
    }
  }

  ensureFileCost(): void {
    const fileId = this.costFileId;
    if (!this.costOn || !fileId) return;
    const key = `file:${fileId}`;
    if (this.#costAsked.has(key)) return;
    this.#costAsked.add(key);
    void this.loadCost({ level: 'file', fileId });
  }

  /**
   * **The per-message meters for one room** (#42 item B).
   *
   * Idempotent per room *and* re-askable: `force` is what the `cost.updated` handler passes,
   * because a turn that just finished has changed exactly one message's number and the cheapest
   * correct thing to do is re-read the room's map. One query, not twenty.
   */
  async loadMessageCosts(roomId: string, threadId: string | null = null): Promise<void> {
    if (!hasCost('costMessages')) return;
    const rows = await quiet(() => costApi().costMessages!({ roomId, threadId }));
    if (!rows) return;
    const next: Record<string, CostMessageCost> = threadId ? { ...this.costMessages } : {};
    for (const row of rows) next[row.messageId] = row;
    this.costMessages = next;
  }

  /** Is this room's map loaded? Asked once by the chat column, on open. */
  #messageCostRoom: string | null = null;

  ensureMessageCosts(roomId: string | null): void {
    if (!roomId || !this.costOn || this.#messageCostRoom === roomId) return;
    this.#messageCostRoom = roomId;
    void this.loadMessageCosts(roomId);
  }

  setShowMessageCost(on: boolean): void {
    this.showMessageCost = on;
    writeFlag(MESSAGE_COST_KEY, on);
  }

  /** **The Usage page** (#42 item D). One call; every panel on the page is a field of it. */
  async loadAnalytics(query: CostAnalyticsQuery = {}): Promise<void> {
    if (!hasCost('costAnalytics')) return;
    this.costAnalyticsQuery = query;
    this.costAnalyticsBusy = true;
    const result = await quiet(() => costApi().costAnalytics!(query));
    if (result) this.costAnalytics = result;
    this.costAnalyticsBusy = false;
  }

  get analyticsOn(): boolean {
    return hasCost('costAnalytics');
  }

  /** The nav rail's and the title-bar indicator's door onto it. */
  async openUsage(): Promise<void> {
    this.screen = 'usage';
    await this.loadAnalytics();
  }

  /** Settings ▸ Usage: all time, this session, and the calls behind them. */
  async loadUsage(): Promise<void> {
    if (!this.costOn) return;
    this.costBusy = true;
    await this.loadCost({ level: 'app' });
    await this.loadCost({ level: 'app', since: SESSION_WINDOW });
    await this.loadRecentCalls();
    this.costBusy = false;
  }

  /** The last calls. `limit` is small on purpose: this is a drawer, not an audit log viewer. */
  async loadRecentCalls(limit = 40): Promise<void> {
    if (!hasCost('costRecent')) return;
    const rows = await quiet(() => costApi().costRecent!({ limit }));
    if (rows) this.costRecent = rows;
  }

  /**
   * **Export CSV.**
   *
   * Prefers `cost:export` when the main side offers it — that one can write the whole ledger,
   * and a save dialog belongs in the main process. Without it the renderer exports what it has
   * (`cost:recent`), which is honest about being a page rather than the whole history, and hands
   * it over as a Blob. Returns the CSV either way so the caller can say what happened.
   */
  async exportCost(): Promise<string | null> {
    if (hasCost('costExport')) {
      const result = await quiet(() => costApi().costExport!({}));
      if (typeof result === 'string') return result;
      if (result && typeof result.csv === 'string') return result.csv;
    }
    if (!hasCost('costRecent')) return null;
    await this.loadRecentCalls(1000);
    const { toCsv } = await import('./cost.js');
    return toCsv(this.costRecent);
  }

  /**
   * **A `cost.updated` delta, added to whichever counters it is inside** (`lib/cost.ts`).
   *
   * The event carries the call, not a new total, precisely so three counters can tick without
   * three round trips — and the nesting rule (`thread ⊆ file ⊆ app`) is `updateBelongs()`'s, in
   * one place, rather than restated in three components.
   *
   * The slices are not patched here; Settings ▸ Usage re-asks while it is open, because a
   * by-model table grown from deltas is a table that can quietly disagree with the ledger.
   */
  #takeCostUpdate(update: CostUpdate): void {
    this.#costLive = true;
    const anchorId = update.call.anchorId;
    if (anchorId) {
      const held = this.costThread[anchorId];
      if (held) this.costThread = { ...this.costThread, [anchorId]: applyDelta(held, update) };
    }
    if (this.costFile && updateBelongs(this.costFile, update)) {
      this.costFile = applyDelta(this.costFile, update);
    }
    if (this.costApp) this.costApp = applyDelta(this.costApp, update);
    if (this.costSession) this.costSession = applyDelta(this.costSession, update);
    this.costRecent = [update.call, ...this.costRecent].slice(0, 40);
    /**
     * **The per-message map, re-read rather than patched** (#42 item B).
     *
     * The event carries the call's `turnId`, which is the join key — but the message that turn
     * wrote may not exist yet when the first call of it lands (the decision fires before the
     * reply is inserted), so patching by id would drop the decision's tokens on every turn. One
     * query per turn, only while a room is open, is the correct trade: `cost:messages` is a
     * grouped read over one room's rows, and it is what makes the meter agree with the ledger.
     */
    if (update.call.turnId && this.#messageCostRoom) void this.loadMessageCosts(this.#messageCostRoom);
    // The tables and the window burn are re-read, but only where they are actually on screen.
    if (this.screen === 'settings') void this.loadUsage();
    if (this.screen === 'usage') void this.loadAnalytics(this.costAnalyticsQuery);
  }

  /** The ⌥⌘D drawer's rows (audit §10). No bodies are in them, by construction in the actor. */
  async loadTurnTraces(): Promise<void> {
    const roomId = this.room?.roomId;
    if (!roomId || !has('flowTurnTrace')) return;
    const rows = await quiet(() => bridge().flowTurnTrace({ roomId, turnId: null }));
    if (rows) this.turnTraces = rows;
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
