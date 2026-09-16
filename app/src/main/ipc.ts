/**
 * The IPC bridge. Every handler here is reachable from the renderer, and nothing else is
 * (architecture-mac.md §C.1: contextIsolation + a preload allowlist).
 *
 * The renderer holds no authority: it sends intent and renders what comes back. In particular
 * it never owns the silence deadline — it animates against a timestamp the main process wrote
 * to SQLite before arming anything.
 */
import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type {
  Bootstrap,
  CreateSessionInput,
  FlowAnswerView,
  FlowRelayView,
  FlowRoomView,
  FlowWhisperView,
  RelayAttribution,
  RoomEvent,
  RolePairing,
  RoomSnapshot,
  SessionSeed,
  ReplySpeed,
  SettingsPatch,
  SettingsView,
} from '../shared/types.js';
import { IPC } from '../shared/ipc.js';
import { rosterFor, PINNED_PAIRING } from '../room/agents.js';
import { RoomActor } from '../room/actor.js';
import { FLOW_PROFILE_SETTING, flowProfileFor, type FlowProfile } from '../room/flow.js';
import type { LLMClient } from '../room/llm/types.js';
import { CLI_MODEL_CHOICES, isBlockedModelId, normaliseModelId } from '../room/llm/models.js';
import type { ConceptPack, RoomConfig } from '../room/records.js';
import { systemClock } from './clock.js';
import type { SqlDatabase } from './db/driver.js';
import { groupView, type LocalStore } from './db/store.js';
import { createApiKeyStore, looksLikeAnthropicKey, type ApiKeyStore } from './apikey.js';
import { createClient, modeFor, resolveBackend, type ResolvedBackend } from './llm/backend.js';
import { detectClaudeCli, NOT_FOUND, SETTINGS_KEYS, type CliDetection } from './llm/detect.js';
import { createSession, draftConcept, newId } from './sessions.js';
import { ensurePack } from './pack.js';
import { errorClass, log, tailLog, type Logger } from './log.js';
import type { TurnLog } from '../room/ports.js';
/**
 * The flow's first-open pacing strip is shown once per install and is re-openable from Settings
 * (`flow-build-plan.md` §3.5) — one row, like `first_run_complete` next to it.
 */
const PACING_STRIP_SETTING = 'pacing_strip_seen';
/** Settings ▸ Reply speed (audit §9). See `ReplySpeed` in shared/types.ts. */
const REPLY_SPEED_SETTING = 'reply_speed';
import {
  flowRoomView,
  loadFlowState,
  openOrCreateFlowRoom,
  saveFlowState,
  segmentText,
  type FlowRoomDeps,
} from './flowroom.js';
import { capText } from './vault/extract.js';
import { SELECTION_CAP, VaultService } from './vault/service.js';
import { SegmentService, type SplitInput } from './vault/segments.js';

export interface IpcDeps {
  store: LocalStore;
  /** The same SqlDatabase the store was built on — the vault's tables live in it (issue #22). */
  db: SqlDatabase;
  appVersion: string;
  osVersion: string;
  /** `app.getPath('userData')`. The API key file lives directly inside it (#15). */
  userDataDir: string;
  /** `~/Library/Logs/ChatterED`. Behind **Open log folder** and **Copy diagnostics**. */
  logDir: string;
  getWindow(): BrowserWindow | null;
}

/**
 * The `TurnLog` port, over the process-wide logger, stamped with the room id.
 *
 * `src/room` must not import `src/main`, so the actor takes the port and this is the adapter —
 * the same shape as the `Clock` and `Transport` ports beside it.
 */
function roomLog(roomId: string): TurnLog {
  const wrap = (logger: Logger): TurnLog => ({
    event: (level, name, fields) => logger.event(level, name, { room_id: roomId, ...fields }),
    child: (turnId) => wrap(logger.child(turnId)),
  });
  return wrap(log());
}

export class AppService {
  readonly #d: IpcDeps;
  readonly #apiKey: ApiKeyStore;
  readonly #vault: VaultService;
  readonly #segments: SegmentService;
  #actor: RoomActor | null = null;

  constructor(deps: IpcDeps) {
    this.#d = deps;
    this.#apiKey = createApiKeyStore(deps.userDataDir);
    this.#vault = new VaultService({
      db: deps.db,
      settings: deps.store.settings,
      onChanged: (view) => this.#d.getWindow()?.webContents.send(IPC.vaultChanged, view),
    });
    // The segmentation pipeline gets the vault's id→path resolver and nothing else: it can read
    // a file the renderer already has an id for, and no other file (issue #22's rule, unchanged).
    this.#segments = new SegmentService({
      db: deps.db,
      sourcePath: (fileId) => this.#vault.sourcePath(fileId),
    });
  }

  get segments(): SegmentService {
    return this.#segments;
  }

  get vault(): VaultService {
    return this.#vault;
  }

  get apiKeyStore(): ApiKeyStore {
    return this.#apiKey;
  }

  get actor(): RoomActor | null {
    return this.#actor;
  }

  /**
   * Ellie is the Teacher, Max is the Tester — **pinned**, not drawn (#32; `agents.ts` says why
   * the #16 randomisation went). An install that stored the swapped pairing corrects itself
   * here, on the next launch: the row is rewritten rather than read. Safe because the names are
   * in no frozen `prefix_sha256`, and a historical room still renders under the names it was
   * played on (`views.messageView()`).
   */
  pairing(): RolePairing {
    if (this.#d.store.settings.get('role_pairing') !== PINNED_PAIRING) {
      this.#d.store.settings.set('role_pairing', PINNED_PAIRING, new Date().toISOString());
    }
    return PINNED_PAIRING;
  }

  /**
   * Which backend the next call will use. Recomputed rather than cached: the learner can change
   * it in Settings between two rooms, and the cached CLI detection can go stale under it.
   */
  backend(): ResolvedBackend {
    return resolveBackend({ settings: this.#d.store.settings, hasApiKey: this.#apiKey.has() });
  }

  mode(): 'scripted' | 'live' {
    return modeFor(this.backend().kind);
  }

  /**
   * `material` pins the scripted client to the right script instead of leaving it to sniff the
   * deck out of a request (`llm/backend.ts`). Every caller that knows which document it is
   * opening should pass it; `openRoom` does.
   */
  llm(
    resolved: ResolvedBackend = this.backend(),
    material?: { fileName?: string | null; contentSha?: string | null },
  ): LLMClient {
    return createClient({
      settings: this.#d.store.settings,
      hasApiKey: this.#apiKey.has(),
      resolved,
      apiKey: () => this.#apiKey.get(),
      roster: rosterFor(this.pairing(), resolved.models.agent),
      ...(material ? { material } : {}),
    });
  }

  cli(): CliDetection {
    return this.backend().detection ?? NOT_FOUND;
  }

  settingsView(): SettingsView {
    const resolved = this.backend();
    return {
      appVersion: this.#d.appVersion,
      backendChoice: resolved.choice,
      resolvedBackend: resolved.kind,
      fellBackBecause: resolved.fellBackBecause,
      cli: resolved.detection ?? NOT_FOUND,
      cliPathOverride: this.#d.store.settings.get(SETTINGS_KEYS.cliPathOverride) ?? null,
      agentModel: resolved.models.agent,
      orchestratorModel: resolved.models.orchestrator,
      modelChoices: [...CLI_MODEL_CHOICES],
      hasApiKey: this.#apiKey.has(),
      vaultRoot: this.#vault.view().rootPath,
      flowProfile: this.flowProfile().name,
      pacingStripSeen: this.#d.store.settings.get(PACING_STRIP_SETTING) === '1',
      replySpeed: this.replySpeed(),
    };
  }

  /**
   * Tester pacing, as a setting (`flow-build-plan.md` §4.2: *"plus a demo profile … selectable
   * in Settings"*). Default Study: an install never falls into the demo pace, and `flow.ts`
   * treats any row it does not recognise as Study for the same reason.
   */
  flowProfile(): FlowProfile {
    return flowProfileFor(this.#d.store.settings.get(FLOW_PROFILE_SETTING));
  }

  /**
   * Settings ▸ Reply speed. An unrecognised row reads as `'default'` for the same reason
   * `flowProfileFor` does: an install must never fall into an un-paced mode by accident.
   */
  replySpeed(): ReplySpeed {
    const raw = this.#d.store.settings.get(REPLY_SPEED_SETTING);
    return raw === 'faster' || raw === 'off' ? raw : 'default';
  }

  /**
   * Writes the Settings patch. Rejects a model id that names Fable rather than quietly
   * substituting one — the ban is a hard invariant, and a silent substitution would hide a
   * violation instead of surfacing it (CLAUDE.md).
   */
  saveSettings(patch: SettingsPatch): { ok: boolean; error?: string } {
    const now = () => new Date().toISOString();
    const set = (key: string, value: string) => this.#d.store.settings.set(key, value, now());

    for (const candidate of [patch.agentModel, patch.orchestratorModel]) {
      if (candidate !== undefined && isBlockedModelId(candidate)) {
        return { ok: false, error: 'That model is not available in ChatterED. Choose haiku, sonnet or opus.' };
      }
      if (candidate !== undefined && candidate.trim().length > 0 && normaliseModelId(candidate) === null) {
        return { ok: false, error: `"${candidate.trim()}" is not a usable model id.` };
      }
    }

    if (patch.backendChoice !== undefined) set(SETTINGS_KEYS.backend, patch.backendChoice);
    if (patch.agentModel !== undefined) set(SETTINGS_KEYS.cliAgentModel, normaliseModelId(patch.agentModel) ?? '');
    if (patch.orchestratorModel !== undefined) {
      set(SETTINGS_KEYS.cliOrchestratorModel, normaliseModelId(patch.orchestratorModel) ?? '');
    }
    if (patch.cliPathOverride !== undefined) set(SETTINGS_KEYS.cliPathOverride, (patch.cliPathOverride ?? '').trim());
    // The pacing profile takes effect on the **next** room: the actor is handed its profile at
    // construction, and swapping the rules under a sitting that has already counted turns
    // against them would be the kind of silent change the pacing strip promises not to make.
    if (patch.flowProfile !== undefined) set(FLOW_PROFILE_SETTING, patch.flowProfile);
    if (patch.pacingStripSeen !== undefined) set(PACING_STRIP_SETTING, patch.pacingStripSeen ? '1' : '');
    if (patch.replySpeed !== undefined) set(REPLY_SPEED_SETTING, patch.replySpeed);
    return { ok: true };
  }

  /**
   * The one place that actually spawns `claude` to check the login. Runs at most once per
   * launch unless the learner presses "Check again" (`force`).
   */
  detectCli(force = false): Promise<CliDetection> {
    return detectClaudeCli({ settings: this.#d.store.settings, now: () => new Date().toISOString() }, force);
  }

  emit(event: RoomEvent): void {
    this.#d.getWindow()?.webContents.send(IPC.event, event);
  }

  bootstrap(): Bootstrap {
    const pairing = this.pairing();
    const resolved = this.backend();
    const recent = this.#d.store.sessions.recent(3).map((s) => {
      const room = this.#d.store.rooms.get(s.room_id);
      const ledger = this.#d.store.ledger.forSession(s.id);
      return {
        roomId: s.room_id,
        conceptTitle: room?.topic ?? 'Session',
        states: ledger.map((r) =>
          r.level >= 3 ? ('defended' as const) : r.level === 2 ? ('justified' as const) : r.level === 1 ? ('stated' as const) : ('not_yet' as const),
        ),
        endedAt: s.ended_at,
        updatedAt: s.ended_at ?? s.started_at,
      };
    });
    return {
      appVersion: this.#d.appVersion,
      hasApiKey: this.#apiKey.has(),
      mode: modeFor(resolved.kind),
      backend: resolved.kind,
      backendChoice: resolved.choice,
      cli: resolved.detection ?? NOT_FOUND,
      pairing,
      agents: rosterFor(pairing, resolved.models.agent),
      recentSessions: recent,
      firstRun: this.#d.store.settings.get('first_run_complete') !== '1',
    };
  }

  /**
   * `opener` is false for a flow room (issue #25).
   *
   * `RoomActor.open()` posts Ellie's opening question into an empty room. That is right for the
   * chat, where the opener is the first thing at the top of the one column the learner is
   * reading; it is wrong for a flow, where a message with no anchor belongs to no thread and is
   * therefore drawn nowhere. The flow's opening move is the learner's own question, which is
   * also the better opening — beat 7: "no agent writes anywhere I have not asked".
   */
  openRoom(roomId: string, opts: { opener?: boolean } = {}): RoomSnapshot {
    if (this.#actor && this.#actor.snapshot().roomId === roomId) {
      // The room is already open, so nothing below runs — and until this line the client it was
      // constructed with was the client it kept for the rest of the sitting. Settings changes
      // reached SQLite and never reached the actor. Re-bind before handing it back.
      this.rebindActor();
      this.#ensurePack(roomId);
      return this.#actor.snapshot();
    }
    this.#actor?.stop();
    const room = this.#d.store.rooms.get(roomId);
    if (!room) throw new Error(`No such room: ${roomId}`);
    const session = this.#d.store.sessions.forRoom(roomId);
    if (!session) throw new Error(`No session for room: ${roomId}`);
    const material = this.#d.store.materials.get(room.material_id);
    if (!material) throw new Error(`No material for room: ${roomId}`);
    const pack = JSON.parse(material.concept_pack) as ConceptPack;
    const config = JSON.parse(room.config) as RoomConfig;
    const resolved = this.backend();

    this.#actor = new RoomActor({
      store: this.#d.store,
      groupStore: groupView(this.#d.store),
      clock: systemClock,
      transport: { emit: (event) => this.emit(event) },
      llm: this.llm(resolved, { fileName: material.file_path, contentSha: material.file_sha256 }),
      roomId,
      sessionId: session.id,
      roster: rosterFor(this.pairing(), resolved.models.agent),
      pack,
      models: resolved.models,
      config: { ...config, mode: modeFor(resolved.kind) },
      appVersion: this.#d.appVersion,
      // The sitting as it stood when the app last ran (#33). A flow session is bounded by an
      // absolute deadline, so it has to survive a quit the way the silence timer does; without
      // it, every relaunch would look to `handOffDue` like a learner who has just arrived.
      flowState: loadFlowState(this.#d.store, roomId),
      flowProfile: this.flowProfile(),
      replySpeed: this.replySpeed(),
      newId,
      // The room's half of the log: turn.start / orchestrator.* / ledger.* / timer.* / turn.*,
      // all stamped with the turn id the LLM calls underneath them carry too.
      log: roomLog(roomId),
    });
    this.#actor.start();
    this.#actor.recover();
    if (opts.opener !== false) void this.#actor.open();
    // A room opened on a pack that is not this deck's — `pending`, or a fixture's on a deck that
    // is not the fixture — re-drafts here, in the background, and swaps in at the next turn.
    this.#ensurePack(roomId);
    return this.#actor.snapshot();
  }

  /**
   * Push the current Settings into the open actor: backend, models, roster, mode, reply speed.
   *
   * Called from `openRoom`'s reuse path and straight after a successful `saveSettings`, so a
   * backend or model change takes effect on the **next turn** rather than on the next reopen.
   * No-op when no room is open.
   */
  rebindActor(): void {
    const actor = this.#actor;
    if (!actor) return;
    const resolved = this.backend();
    const material = this.#d.store.materials.get(this.#d.store.rooms.get(actor.snapshot().roomId)?.material_id ?? '');
    actor.rebind({
      llm: this.llm(resolved, { fileName: material?.file_path ?? null, contentSha: material?.file_sha256 ?? null }),
      models: resolved.models,
      roster: rosterFor(this.pairing(), resolved.models.agent),
      mode: modeFor(resolved.kind),
      replySpeed: this.replySpeed(),
    });
    // Switching to a live backend on an open room is the moment a `pending` pack becomes
    // draftable — and the moment a wrong `fixed` one can finally be replaced.
    this.#ensurePack(actor.snapshot().roomId);
  }

  /** Runs on launch and on every `powerMonitor` resume. Idempotent by timerEpoch. */
  recover(): void {
    this.#actor?.recover();
  }

  dispose(): void {
    this.#persistFlow();
    this.#actor?.stop();
    this.#actor = null;
    this.#vault.dispose();
  }

  // ── The conversation inside the flow (issue #25, §3.3 track B) ───────────

  /**
   * **The background concept-ingest, fired and not awaited** (issue #35, `src/main/pack.ts`).
   *
   * Called from the three places a room's pack can become wrong or become draftable: the room
   * opening, the first "+ Ask here" creating it, and a Settings change that puts a live backend
   * under a room that was opened on the scripted one. `ensurePack` is a no-op for a room whose
   * pack is already its own and is single-flight per material, so calling it on every one of
   * those is cheaper than working out which of them mattered.
   */
  #ensurePack(roomId: string): void {
    const resolved = this.backend();
    void ensurePack(
      {
        store: this.#d.store,
        pairing: this.pairing(),
        models: resolved.models,
        mode: modeFor(resolved.kind),
        llm: resolved.kind === 'scripted' ? null : this.llm(resolved),
        onReady: ({ pack }) => {
          const actor = this.#actor;
          if (!actor || actor.snapshot().roomId !== roomId) return;
          // The swap itself. Every read of the pack in the actor goes through `#d.pack`, so the
          // next turn's prompt, the next ledger call and the rail all move together.
          actor.rebind({ pack });
          const snapshot = actor.snapshot();
          this.emit({ type: 'ledger.updated', roomId, ledger: snapshot.ledger, changed: [] });
          this.emit({
            type: 'pack.ready',
            roomId,
            conceptTitle: pack.title,
            elements: pack.elements.length,
            ledger: snapshot.ledger,
          });
        },
      },
      roomId,
    ).catch(() => undefined);
  }

  #flowDeps(): FlowRoomDeps {
    const resolved = this.backend();
    return {
      store: this.#d.store,
      segments: this.#segments,
      vault: this.#vault,
      pairing: this.pairing(),
      appVersion: this.#d.appVersion,
      osVersion: this.#d.osVersion,
      mode: modeFor(resolved.kind),
      backend: resolved.kind,
      models: resolved.models,
      llm: resolved.kind === 'scripted' ? null : this.llm(resolved),
    };
  }

  /**
   * The sitting, written back to SQLite.
   *
   * Called after every learner-authored action rather than on a timer: the actions are seconds
   * apart at their fastest, the payload is a few hundred bytes, and a sitting that is lost
   * because the app was force-quit between two writes is a sitting the A1 log has a hole in.
   */
  #persistFlow(): void {
    const actor = this.#actor;
    if (!actor) return;
    saveFlowState(this.#d.store, actor.snapshot().roomId, actor.flowSnapshot());
  }

  /** The room behind a document, and its threads. Opens the actor on it if it is not already. */
  async flowMessages(fileId: string): Promise<FlowRoomView | null> {
    // Keyed on the same `content_sha` the segment cache uses, and computed from the cache: after
    // the first open this is a SQLite read, never a second pdf.js pass.
    const { contentSha } = await this.#segments.document(fileId);
    const material = this.#d.store.materials.forFile(fileId, contentSha);
    if (!material) return null;
    const room = this.#d.store.rooms.openOrScheduled().find((r) => r.material_id === material.id);
    if (!room) return null;
    // Nothing is *created* here — a document with no room returns null above. This only brings
    // the actor back onto a room that already exists, which is what reopening a deck is.
    this.openRoom(room.id, { opener: false });
    const actor = this.#requireActor(room.id);
    return flowRoomView(actor, actor.lockedAnchors());
  }

  /**
   * "+ Ask here". Creates the document's room on the first question, then inserts one REFERENCE
   * card on that segment. The room is opened through the same `openRoom` every other path uses,
   * so the actor, the timer and the event stream are the shipped ones.
   */
  async flowAskHere(input: { fileId: string; segmentId: string; question: string }): Promise<FlowAnswerView> {
    const { roomId } = await openOrCreateFlowRoom(this.#flowDeps(), input.fileId);
    // `opener: false` — see `openRoom`. A flow room has no bottom of the page for an opener to
    // land at, and the learner has just asked a question, which is a better opening than any.
    this.openRoom(roomId, { opener: false });
    const actor = this.#requireActor(roomId);
    const { text } = await segmentText({ segments: this.#segments, vault: this.#vault }, input.fileId, input.segmentId);
    const answer = await actor.askHere({
      anchorId: input.segmentId,
      question: input.question,
      segmentText: text,
    });
    this.#persistFlow();
    return {
      roomId,
      anchorId: input.segmentId,
      questionId: answer.questionId,
      answerId: answer.answerId,
      body: answer.body,
      truncated: answer.truncated,
      flow: flowRoomView(actor, actor.lockedAnchors()),
    };
  }

  flowExplainBack(answerId: string): { unlocked: boolean; anchorId: string | null } {
    if (!this.#actor) throw new Error('No open room');
    const result = this.#actor.explainBack(answerId);
    this.#persistFlow();
    return result;
  }

  async flowSend(input: { roomId: string; segmentId: string; text: string }): Promise<void> {
    const actor = this.#requireActor(input.roomId);
    try {
      await actor.sendMessage(input.text, input.segmentId);
    } finally {
      this.#persistFlow();
    }
  }

  // ── The whisper popover on a segment (§3.5) ──────────────────────────────

  /**
   * The anchored context a private question is answered against: the **same** page text
   * `flowAskHere` hands the REFERENCE call, plus the segment's label so Ellie can name where
   * she is. One resolver, so a private answer and a public one can never be looking at
   * different slides.
   */
  async #segmentContext(
    fileId: string,
    segmentId: string,
  ): Promise<{ label: string; page: number | null; text: string }> {
    const [{ text, page }, view] = await Promise.all([
      segmentText({ segments: this.#segments, vault: this.#vault }, fileId, segmentId),
      this.#segments.document(fileId),
    ]);
    const label = view.segments.find((s) => s.id === segmentId)?.label ?? '';
    return { label: label.trim() || 'this part of the document', page, text };
  }

  /** ⌘K. Opens (or creates) the document's room, then the segment's private thread. */
  async flowWhisperOpen(input: {
    fileId: string;
    segmentId: string;
  }): Promise<{ roomId: string; whisper: FlowWhisperView }> {
    const { roomId } = await openOrCreateFlowRoom(this.#flowDeps(), input.fileId);
    this.openRoom(roomId, { opener: false });
    const whisper = this.#requireActor(roomId).openSegmentWhisper(input.segmentId);
    this.#persistFlow();
    return { roomId, whisper };
  }

  async flowWhisperSend(input: {
    roomId: string;
    fileId: string;
    segmentId: string;
    threadId: string;
    text: string;
  }): Promise<void> {
    const actor = this.#requireActor(input.roomId);
    const segment = await this.#segmentContext(input.fileId, input.segmentId);
    try {
      await actor.sendSegmentWhisper({
        threadId: input.threadId,
        anchorId: input.segmentId,
        text: input.text,
        segment,
      });
    } finally {
      this.#persistFlow();
    }
  }

  /** **Insert into the document**: the approved relay, as a new shared card on the segment. */
  async flowWhisperRelay(input: {
    roomId: string;
    segmentId: string;
    threadId: string;
    whisperId: string;
    attribution: RelayAttribution;
    text: string;
  }): Promise<FlowRelayView> {
    const actor = this.#requireActor(input.roomId);
    let messageId = '';
    try {
      ({ messageId } = await actor.relay({
        threadId: input.threadId,
        whisperId: input.whisperId,
        attribution: input.attribution,
        text: input.text,
        anchorId: input.segmentId,
      }));
    } finally {
      this.#persistFlow();
    }
    return {
      messageId,
      anchorId: input.segmentId,
      attribution: input.attribution,
      flow: flowRoomView(actor, actor.lockedAnchors()),
    };
  }

  /**
   * Session setup from a file and a page range (issue #22 decision 4). Not a second ingest
   * path: it pre-fills the paste box that already exists, and everything after that is the
   * concept-pack flow `createSession` has always run.
   */
  async sessionSeed(input: { fileId: string; pageFrom: number | null; pageTo: number | null }): Promise<SessionSeed> {
    const file = this.#vault.fileRow(input.fileId);
    if (!file) throw new Error('That file is not in the vault any more.');
    const text = await this.#vault.textFor(input);
    const topic = this.#vault.topicContext(file.topic_id);
    return {
      fileId: file.id,
      fileName: file.name,
      relPath: file.rel_path,
      moduleCode: this.#vault.moduleCodeFor(file.topic_id),
      pageFrom: input.pageFrom,
      pageTo: input.pageTo,
      text,
      topic,
    };
  }

  /**
   * Re-walk the vault. Called on window focus (issue #22 decision 1) and swallowed rather than
   * surfaced: a rescan the learner did not ask for must never put a banner in front of them.
   */
  refreshVault(): void {
    try {
      if (this.#vault.activeVaultId()) this.#vault.rescan();
    } catch {
      /* the folder has gone away, or is not readable; the Library says so on its own. */
    }
  }

  /**
   * The **Copy diagnostics** payload: what the app is, which backend and models are live, and
   * the last 50 log lines. Assembled here rather than in the renderer because the renderer has
   * no business reading a file, and because these are the four questions every bug report on
   * this app has needed answering first.
   */
  diagnostics(limit = 50): string {
    const resolved = this.backend();
    const lines = tailLog(this.#d.logDir, limit);
    return [
      `ChatterED ${this.#d.appVersion}`,
      `os: ${this.#d.osVersion}`,
      `backend: ${resolved.kind}${resolved.fellBackBecause ? ` (fell back: ${resolved.fellBackBecause})` : ''}`,
      `choice: ${resolved.choice}`,
      `models: agent=${resolved.models.agent} orchestrator=${resolved.models.orchestrator}`,
      `cli: ${resolved.detection?.path ?? 'not found'}${resolved.detection?.loggedIn ? ' (logged in)' : ''}`,
      `log: ${this.#d.logDir}/main.log`,
      '',
      `last ${lines.length} log lines:`,
      ...lines,
    ].join('\n');
  }

  #requireActor(roomId: string): RoomActor {
    if (!this.#actor) throw new Error('No open room');
    if (this.#actor.snapshot().roomId !== roomId) throw new Error('That room is not open');
    return this.#actor;
  }

  register(): void {
    /**
     * Every handler is wrapped: an IPC call that throws crosses the bridge as a rejected
     * promise and the renderer turns it into a one-line banner, which loses the channel, the
     * class and the stack. `ipc.error` keeps all three on this side. The error is still
     * re-thrown — the renderer's banner is a separate promise to the learner.
     */
    const handle = <T>(channel: string, fn: (payload: T) => unknown) => {
      ipcMain.handle(channel, async (_event, payload: T) => {
        try {
          return await fn(payload);
        } catch (err) {
          log().error('ipc.error', {
            channel,
            class: errorClass(err),
            cause: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }
      });
    };

    handle(IPC.bootstrap, () => this.bootstrap());

    handle<string>(IPC.setApiKey, (key) => {
      if (!looksLikeAnthropicKey(key)) {
        return { ok: false, error: "That doesn't look like an Anthropic key — they start with sk-ant-." };
      }
      try {
        this.#apiKey.set(key.trim());
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    });

    handle(IPC.clearApiKey, () => {
      this.#apiKey.clear();
    });

    handle(IPC.completeFirstRun, () => {
      this.#d.store.settings.set('first_run_complete', '1', new Date().toISOString());
    });

    handle(IPC.getSettings, () => this.settingsView());

    handle<SettingsPatch>(IPC.saveSettings, (patch) => {
      const result = this.saveSettings(patch);
      // Settings ▸ backend / model / reply speed reach the room that is already open, now, and
      // apply to its next turn. Before this they waited for a reopen (STATUS, 16 Sep).
      if (result.ok) this.rebindActor();
      if (!result.ok) return result;
      return { ok: true, settings: this.settingsView() };
    });

    handle<{ force?: boolean } | undefined>(IPC.detectCli, async (input) => {
      await this.detectCli(input?.force === true);
      return this.settingsView();
    });

    handle<{ moduleCode: string; title: string; text: string }>(IPC.draftConcept, (input) => {
      const resolved = this.backend();
      return draftConcept(resolved.kind === 'scripted' ? null : this.llm(resolved), input, resolved.models);
    });

    handle<CreateSessionInput>(IPC.createSession, (input) => {
      const resolved = this.backend();
      const created = createSession(
        {
          store: this.#d.store,
          pairing: this.pairing(),
          appVersion: this.#d.appVersion,
          osVersion: this.#d.osVersion,
          mode: modeFor(resolved.kind),
          backend: resolved.kind,
          models: resolved.models,
        },
        input,
      );
      return { roomId: created.roomId };
    });

    // ── The vault (issue #22) ──────────────────────────────────────────────
    handle(IPC.vaultGet, () => this.#vault.view());

    handle(IPC.vaultChoose, async () => {
      const win = this.#d.getWindow();
      const result = await (win
        ? dialog.showOpenDialog(win, { properties: ['openDirectory'], buttonLabel: 'Open vault' })
        : dialog.showOpenDialog({ properties: ['openDirectory'] }));
      const folder = result.canceled ? null : (result.filePaths[0] ?? null);
      return folder ? this.#vault.open(folder) : null;
    });

    handle(IPC.vaultRescan, () => this.#vault.rescan());
    handle(IPC.vaultCandidates, () => this.#vault.candidates());
    handle<{ relPaths: string[] }>(IPC.vaultPromote, (input) => this.#vault.promote(input.relPaths));
    handle<{ topicId: string | null }>(IPC.vaultTree, (input) => this.#vault.tree(input.topicId));
    handle<{ query: string }>(IPC.vaultFind, (input) => this.#vault.find(input.query));
    handle<{ query: string }>(IPC.vaultSearch, (input) => this.#vault.search(input.query));
    handle<{ fileId: string }>(IPC.vaultDocument, (input) => this.#vault.document(input.fileId));
    handle<{ fileId: string }>(IPC.vaultReveal, (input) => {
      shell.showItemInFolder(this.#vault.revealPath(input.fileId));
    });

    handle<{ fileId: string; pageFrom: number | null; pageTo: number | null }>(IPC.vaultSeed, (input) =>
      this.sessionSeed(input),
    );

    handle<{
      roomId: string;
      fileId: string;
      pageFrom: number | null;
      pageTo: number | null;
      selection: string | null;
    }>(IPC.showDocument, async (input) => {
      const actor = this.#requireActor(input.roomId);
      const file = this.#vault.fileRow(input.fileId);
      if (!file) throw new Error('That file is not in the vault any more.');
      const pageText = await this.#vault.textFor({
        fileId: input.fileId,
        pageFrom: input.pageFrom,
        pageTo: input.pageTo,
      });
      await actor.showDocument({
        fileId: file.id,
        fileName: file.name,
        relPath: file.rel_path,
        kind: file.kind,
        pageFrom: input.pageFrom,
        pageTo: input.pageTo,
        // The cap is enforced here, in the main process. The renderer proposes a selection;
        // it does not get to decide how much of a document reaches the model.
        selection: input.selection ? capText(input.selection, SELECTION_CAP) : null,
        pageText,
      });
    });

    // ── The flow's segments (issue #25) ───────────────────────────────────
    handle<{ fileId: string }>(IPC.segmentsGet, (input) => this.#segments.document(input.fileId));
    handle<SplitInput>(IPC.segmentsSplit, (input) => this.#segments.split(input));
    handle<{ fileId: string; segmentIds: [string, string] }>(IPC.segmentsMerge, (input) =>
      this.#segments.merge(input),
    );
    handle<{ fileId: string; segmentId: string; toIndex: number }>(IPC.segmentsReorder, (input) =>
      this.#segments.reorder(input),
    );
    handle<{ fileId: string; segmentId: string; label: string }>(IPC.segmentsRename, (input) =>
      this.#segments.rename(input),
    );

    handle<{ fileId: string }>(IPC.flowMessages, (input) => this.flowMessages(input.fileId));
    handle<{ fileId: string; segmentId: string; question: string }>(IPC.flowAskHere, (input) =>
      this.flowAskHere(input),
    );
    handle<{ answerId: string }>(IPC.flowExplainBack, (input) => this.flowExplainBack(input.answerId));
    handle<{ roomId: string; segmentId: string; text: string }>(IPC.flowSend, (input) => this.flowSend(input));
    handle<{ fileId: string; segmentId: string }>(IPC.flowWhisperOpen, (input) => this.flowWhisperOpen(input));
    handle<{ roomId: string; fileId: string; segmentId: string; threadId: string; text: string }>(
      IPC.flowWhisperSend,
      (input) => this.flowWhisperSend(input),
    );
    handle<{
      roomId: string;
      segmentId: string;
      threadId: string;
      whisperId: string;
      attribution: RelayAttribution;
      text: string;
    }>(IPC.flowWhisperRelay, (input) => this.flowWhisperRelay(input));
    /**
     * Stop. The refusal is the product decision, so it is decided in the actor — which is the
     * only thing that knows whether this turn's floor has elapsed — and not here.
     */
    handle<{ roomId: string; turnId: string }>(IPC.flowStop, (input) =>
      this.#requireActor(input.roomId).stopTurn(input.turnId),
    );
    handle<{ roomId: string; turnId?: string | null }>(IPC.flowTurnTrace, (input) =>
      this.#requireActor(input.roomId).turnTrace(input.turnId ?? null),
    );
    /**
     * The unread dot and the per-card state. Both are written straight through to the sitting's
     * settings row — they are cheap, they are the learner's own reading, and a sitting that loses
     * them because the app was force-quit between two writes is a card that comes back.
     */
    handle<{ roomId: string; anchorId: string; seq: number }>(IPC.flowMarkSeen, (input) => {
      this.#requireActor(input.roomId).markSeen(input.anchorId, input.seq);
      this.#persistFlow();
    });
    handle<{ roomId: string; anchorId: string; collapsed?: boolean; removed?: boolean }>(
      IPC.flowCardState,
      (input) => {
        const patch: { collapsed?: boolean; removed?: boolean } = {};
        if (input.collapsed !== undefined) patch.collapsed = input.collapsed;
        if (input.removed !== undefined) patch.removed = input.removed;
        this.#requireActor(input.roomId).setCardState(input.anchorId, patch);
        this.#persistFlow();
      },
    );
    handle<{ roomId: string; segmentId: string | null }>(IPC.flowSelection, (input) => {
      // No room, no timer to extend: a document nobody has spoken to has no silence window.
      this.#actor?.noteSelection(input.segmentId);
      void input;
    });
    handle<{ roomId: string; threadId: string }>(IPC.flowWhisperClose, (input) => {
      // The popover's turns are dropped by the renderer on this event, exactly as the shipped
      // pane's "clears at the end of the round" always did. Nothing is deleted: the rows stay
      // for the research export, and the sitting's thread id is what becomes unreachable.
      this.#actor?.closeSegmentWhisper();
      this.emit({ type: 'whisper.cleared', roomId: input.roomId, threadId: input.threadId });
    });

    handle<string>(IPC.openRoom, (roomId) => this.openRoom(roomId));
    handle<{ roomId: string; text: string }>(IPC.sendMessage, (input) =>
      this.#requireActor(input.roomId).sendMessage(input.text),
    );
    handle<{ roomId: string }>(IPC.typing, (input) => this.#requireActor(input.roomId).typing());
    handle<{ roomId: string }>(IPC.holdTimer, (input) => this.#requireActor(input.roomId).hold());
    handle<{ roomId: string; paused: boolean }>(IPC.pauseNudges, (input) =>
      this.#requireActor(input.roomId).pauseNudges(input.paused),
    );
    handle<{ roomId: string }>(IPC.wrapUp, (input) => this.#requireActor(input.roomId).wrapUp());
    handle<{ roomId: string; failureId: string }>(IPC.retryTurn, (input) =>
      this.#requireActor(input.roomId).retryTurn(input.failureId),
    );

    /**
     * **Renderer failures, in the same file as everything else.** A `window.onerror` in the
     * webview is invisible to the main process and disappears with the window; forwarded here it
     * lands in `main.log` next to the turn it broke. The renderer sends a class, a message and a
     * source location — never a DOM node and never page text.
     */
    handle<{ kind: 'error' | 'unhandledrejection'; name: string; message: string; source?: string; line?: number }>(
      IPC.logRendererError,
      (input) => {
        log().error('renderer.error', {
          kind: input.kind,
          class: input.name,
          cause: input.message,
          source: input.source ?? null,
          line: input.line ?? null,
        });
      },
    );

    /** Settings ▸ **Open log folder**. Reveals `~/Library/Logs/ChatterED` in Finder. */
    handle(IPC.openLogFolder, () => {
      shell.openPath(this.#d.logDir);
    });

    /**
     * Settings ▸ **Copy diagnostics**: what a bug report needs and nothing a learner would mind
     * pasting. The log lines were redacted on the way *in* (`log.redact`), so this cannot leak
     * what the log does not already hold.
     */
    handle(IPC.diagnostics, () => this.diagnostics());
    handle<{ roomId: string; agentKey: string }>(IPC.acceptTeachback, (input) =>
      this.#requireActor(input.roomId).acceptTeachback(input.agentKey),
    );
    handle<{ roomId: string; agentKey: string }>(IPC.openWhisper, (input) =>
      this.#requireActor(input.roomId).openWhisper(input.agentKey),
    );
    handle<{ roomId: string; threadId: string; text: string }>(IPC.sendWhisper, (input) =>
      this.#requireActor(input.roomId).sendWhisper(input.threadId, input.text),
    );
    handle<{ roomId: string; threadId: string; whisperId: string; attribution: 'as_me' | 'as_agent'; text: string }>(
      IPC.relayWhisper,
      (input) =>
        this.#requireActor(input.roomId).relay({
          threadId: input.threadId,
          whisperId: input.whisperId,
          attribution: input.attribution,
          text: input.text,
        }),
    );
    handle<{ roomId: string; threadId: string }>(IPC.closeWhisper, (input) => {
      this.emit({ type: 'whisper.cleared', roomId: input.roomId, threadId: input.threadId });
    });
  }
}
