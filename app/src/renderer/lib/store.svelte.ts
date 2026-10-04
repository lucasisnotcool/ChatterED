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
  RecapView,
  RelayAttribution,
  RoomEvent,
  RoomSnapshot,
  SettingsPatch,
  SettingsView,
  TurnTraceView,
  WhisperThreadView,
} from '../../shared/types.js';
import type { ChatterEdApi } from '../../shared/ipc.js';
import { bridge } from './bridge.js';
import { isViewerCommand, runViewerCommand } from './viewer.js';
import { layout } from './layoutstore.svelte.js';
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
import { NotebookStore } from './notebookstore.svelte.js';
import { TutorialStore } from './tutorialstore.svelte.js';
import { SearchStore } from './searchstore.svelte.js';
import type { NotebookView } from '../../shared/notebook.js';
import { regenerateCommand } from './pm/overview.js';

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
 * **`'notebooks'` is home** (`docs/research/notebooks.md` §1, 2026-10-01): the grid of notebooks,
 * the screen the app opens on after first run and consent. `'notebook'` is one notebook open in
 * the shell, *sources · overview · chat* (§8). They replace `'library'`, the folder vault's
 * browser. `'setup'` and `'room'` are the legacy paste-text sessions, reachable from the home's
 * footer as they were from the Library, and not extended.
 *
 * `'usage'` is the Usage page (#42 item D) — a **destination**, not a panel in Settings.
 *
 * Settings ▸ Usage is where the first counters landed, and it was the wrong home for them: a
 * page nobody opens unless something is already wrong, next to the API key and the model
 * dropdowns. What a deck cost, which deck cost the most and how much of the five-hour window is
 * gone are things a learner should be able to look at on the way past, so they get a stop on the
 * nav rail and a reachable indicator in the title bar. The Settings section stays where it is —
 * it is where the rate card is edited, and that genuinely is a setting.
 */
export type Screen = 'loading' | 'firstRun' | 'notebooks' | 'notebook' | 'search' | 'setup' | 'room' | 'settings' | 'usage';

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
  /** The open notebook (`notebooks.md`, 2026-10-01). Owned by track N5. */
  readonly notebook = new NotebookStore();
  /**
   * The open notebook's tutorials (`docs/research/tutorials.md`): the split column, its own
   * `DocStore` on the open tutorial's document, and the sources panel's roles.
   */
  readonly tutorial = new TutorialStore();
  /** The search page (`docs/research/search.md` §5): kept across visits. */
  readonly search = new SearchStore();
  /** Bumped to ask the search page to put the cursor in its box (⇧⌘F, the rail). */
  searchFocus = $state(0);

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
   * than as a paragraph of hyphenated pdf.js output (ui-review-ux.md M11). The legacy room's
   * only; a notebook's sources are opened by the editor's slide previews.
   */
  roomSource: DocumentView | null = $state(null);
  roomSourceFor: string | null = $state(null);

  /** Settings, loaded on demand. Null until the Settings screen has been opened once. */
  settings: SettingsView | null = $state(null);
  settingsBusy = $state(false);
  settingsError: string | null = $state(null);

  unsubscribe: (() => void) | null = null;
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
      // Notebooks (`notebooks.md` §1). File ▸ New Notebook is the home's button; File ▸ Add
      // Sources… is the sources panel's, and with no notebook open it starts a new one, because
      // "add these files" with nowhere to add them to means exactly that.
      case 'notebook.new':
        void this.newNotebook();
        break;
      case 'notebook.addSources':
        if (this.screen === 'notebook' && this.notebook.id) void this.notebook.pickAndAdd();
        else void this.newNotebook();
        break;
      case 'notebook.home':
        this.goHome();
        break;
      case 'search.open':
        void this.openSearch();
        break;
      case 'search.toggleSlides':
        if (this.screen === 'search') this.search.toggle('slides');
        break;
      case 'search.toggleNotes':
        if (this.screen === 'search') this.search.toggle('notes');
        break;
      case 'search.toggleHits':
        if (this.screen === 'search') this.search.toggle('hits');
        break;
      case 'settings.open':
        void this.openSettings();
        break;
      case 'files.toggle':
        layout.toggleFiles();
        break;
      // The same calls the pane buttons make; the confirm is main's either way (2026-09-23).
      // On a notebook it is Update overview, never the destructive regenerate (`regenerateCommand`).
      case 'notes.regenerate': {
        const route = regenerateCommand(this.doc.fileId);
        if (!route) {
          this.notice = { level: 'info', text: 'Open a notebook first.' };
          break;
        }
        void (route === 'update_overview' ? this.doc.updateOverview() : this.doc.regenerate()).then((line) => {
          if (line) this.notice = { level: 'info', text: line };
        });
        break;
      }
      case 'chat.reset':
        if (!this.chat.roomId) {
          this.notice = { level: 'info', text: 'There is no conversation in this notebook to reset yet.' };
          break;
        }
        void this.chat.reset().then((line) => {
          if (line) this.notice = { level: 'error', text: line };
        });
        break;
    }
  }

  async init(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = bridge().onEvent((e) => this.apply(e));
    // A source finishing its read, a checkbox, a rename: main pushes; the renderer never polls.
    if (has('onNotebookChanged')) this.notebook.subscribe();
    this.tutorial.subscribe();
    this.unsubscribeCommands?.();
    this.unsubscribeCommands = bridge().onAppCommand((command) => this.runCommand(command));
    try {
      const boot = await bridge().bootstrap();
      this.boot = boot;
      this.screen = boot.firstRun ? 'firstRun' : 'notebooks';
      await this.notebook.loadList();
    } catch (err) {
      this.notice = { level: 'error', text: message(err) };
      this.screen = 'notebooks';
    }
  }

  apply(e: RoomEvent): void {
    // collab-doc (#48): every event goes to the three sibling stores first. They take what is
    // theirs (`notes.*`, `doc.*`, `chat.*`, `progress.*`, and the message/turn events the chats
    // draw from) and ignore the rest; nothing below depends on what they did with it.
    // A tutorial's document has its own `docId`: its events go to the tutorial's `DocStore`, and
    // never to the notes' (whose `notes.status` matches on the notebook id while it has no doc).
    const docId = (e as { docId?: unknown }).docId;
    if (typeof docId === 'string' && this.tutorial.docIds().includes(docId)) this.tutorial.doc.apply(e);
    else this.doc.apply(e);
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
    this.screen = 'notebooks';
    await this.notebook.loadList();
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

  // ── Notebooks (`docs/research/notebooks.md`, 2026-10-01) ────────────────────
  /**
   * **Open a notebook** into the shell. Main stamps it opened (the home sorts it first) and
   * returns its view; the shell (`ThreeColumn`) then opens the doc, the chats and the progress
   * bar with the notebook's id, which is the subject on all of them (contract C2). Opening a
   * second notebook in place of the first closes the first (§4.7's file close, per notebook).
   */
  async openNotebook(notebookId: string): Promise<void> {
    const leaving = this.notebook.id;
    const view = await this.notebook.open(notebookId);
    if (!view) return;
    if (leaving !== null && leaving !== view.id) this.#leaveFile(leaving);
    this.screen = 'notebook';
  }

  /**
   * **The search page** (`docs/research/search.md` §5): the rail's second item, ⇧⌘F. Its scope
   * starts as the folder the learner came from (the open notebook's, or the home's). Leaving a
   * notebook for it closes the notebook as going home does; the doc saves on the way out.
   * Coming back keeps the query, the picked hit and the columns.
   */
  async openSearch(): Promise<void> {
    this.searchFocus += 1;
    if (this.screen === 'search') return;
    const leaving = this.screen === 'notebook' ? this.notebook.id : null;
    const from = leaving ? (this.notebook.list.find((n) => n.id === leaving)?.folderId ?? null) : this.notebook.folderId;
    if (leaving !== null) this.#leaveFile(leaving);
    this.search.setScope(from);
    this.screen = 'search';
    void this.notebook.loadList();
    void this.search.refreshStatus();
  }

  /** **New notebook**: the picker, then the notebook, open. Cancelling makes nothing. */
  async newNotebook(): Promise<void> {
    const view = await this.notebook.pickAndCreate();
    if (view) await this.openNotebook(view.id);
  }

  /** Files dropped on the home (§1): a new notebook named after the first, open. */
  async createNotebook(paths: string[]): Promise<NotebookView | null> {
    const view = await this.notebook.create(paths);
    if (view) await this.openNotebook(view.id);
    return view;
  }

  /**
   * **Home** — the breadcrumb's *Notebooks*, the rail's home, View ▸ Notebooks. Leaving a notebook
   * closes it (§4.7: main releases Max's open question, without waiting for the turn); the room
   * itself stays alive in main, and its transcript is the notebook's.
   */
  goHome(): void {
    if (this.screen === 'room') {
      this.leaveRoom();
      return;
    }
    const leaving = this.notebook.id;
    if (leaving !== null) this.#leaveFile(leaving);
    this.notebook.close();
    // The notebook's and thread's counters are the notebook's. The app's is not, and survives.
    this.costFile = null;
    this.costThread = {};
    this.#costAsked.clear();
    this.screen = 'notebooks';
    void this.notebook.loadList();
  }

  /**
   * **The learner closed a notebook** (brief §4.7: closure fires on idle *or* file close; #49).
   * Main releases Max's open question on it, if its room is the open one, and the close does not
   * wait for the turn. Only the two gestures that close a notebook call this: going home and
   * opening another notebook. Switching to Settings or Usage is not a close.
   */
  #leaveFile(fileId: string): void {
    if (has('chatCloseFile')) void quiet(() => bridge().chatCloseFile({ fileId }));
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
   * it opens into the three-column shell, which never set `flowFor` at all — so a file counter
   * keyed on the flow's file silently stopped existing on the surface the app now actually has.
   * Since #58 the subject is the open notebook (contract C2): its id is the whole of it, and one
   * getter so no third surface has to remember the rule.
   */
  get costFileId(): string | null {
    return this.notebook.id;
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

  /**
   * The ⌥⌘D drawer's rows (audit §10). No bodies are in them, by construction in the actor.
   *
   * The open **document's** room first, then the room screen's. `this.room` was the only answer
   * while the flow put its `FlowRoomView` there; on the doc surface it is `chat.roomId` that
   * knows which room the conversation is in, and a drawer that only ever found traces on the
   * screen nobody opens is a diagnostic that is never there when it is wanted.
   */
  async loadTurnTraces(): Promise<void> {
    const roomId = this.chat.roomId ?? this.room?.roomId ?? null;
    if (!roomId || !has('flowTurnTrace')) return;
    const rows = await quiet(() => bridge().flowTurnTrace({ roomId, turnId: null }));
    if (rows) this.turnTraces = rows;
  }

  goSetup(seed = ''): void {
    this.setupSeed = seed;
    this.screen = 'setup';
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
    this.room = null;
    this.roomSource = null;
    this.roomSourceFor = null;
    this.recap = null;
    this.whisper = null;
    this.whisperOpen = false;
    this.screen = 'notebooks';
    void this.notebook.loadList();
  }

  // ── Session setup ────────────────────────────────────────────────────────
  draftConcept(input: { moduleCode: string; title: string; text: string }): Promise<ConceptDraft | null> {
    return run(this, () => bridge().draftConcept(input));
  }

  async createSession(input: CreateSessionInput): Promise<void> {
    // Everything on `this` is a $state proxy, and structuredClone — which is what IPC is —
    // refuses a proxy with "An object could not be cloned". Snapshot before it crosses.
    const created = await run(this, () => bridge().createSession($state.snapshot(input) as CreateSessionInput));
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
