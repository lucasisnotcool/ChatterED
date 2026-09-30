/**
 * The IPC bridge. Every handler here is reachable from the renderer, and nothing else is
 * (architecture-mac.md §C.1: contextIsolation + a preload allowlist).
 *
 * The renderer holds no authority: it sends intent and renders what comes back. In particular
 * it never owns the silence deadline — it animates against a timestamp the main process wrote
 * to SQLite before arming anything.
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type {
  Bootstrap,
  CreateSessionInput,
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
import type { ConceptPack, LedgerRow, RoomConfig } from '../room/records.js';
import { systemClock } from './clock.js';
import type { SqlDatabase } from './db/driver.js';
import { groupView, type LocalStore } from './db/store.js';
import { looksLikeAnthropicKey, type ApiKeyStore } from './apikey.js';
import { createClient, modeFor, resolveBackend, type ResolvedBackend } from './llm/backend.js';
import { ProviderService, registerProviderIpc } from './llm/providerservice.js';
import { cliOverrideProblem, expandHome } from './llm/claude-cli.js';
import { detectClaudeCli, NOT_FOUND, SETTINGS_KEYS, type CliDetection } from './llm/detect.js';
import { createSession, draftConcept, newId } from './sessions.js';
import { ensurePack } from './pack.js';
import { ensureTree, treeIsCurrent } from './objectives/ingest.js';
import { mirrorLedger, taughtFromStates } from './objectives/states.js';
import { join } from 'node:path';
import { errorClass, log, tailLog, type Logger } from './log.js';
import { RATE_CARD_DATE, RATE_CARD_SETTING, parseRateCardOverride } from './cost/rates.js';
import { CostLedger } from './cost/ledger.js';
import { backfillUsage } from './cost/backfill.js';
import { writeCsv } from './cost/export.js';
import { registerCostIpc } from './cost/ipc.js';
import { emptyTokens, addTokens, type CostSummaryQuery, type CostTokens, type CostUpdate } from '../shared/cost.js';
import type { TurnLog } from '../room/ports.js';
/**
 * The flow's first-open pacing strip is shown once per install and is re-openable from Settings
 * (`flow-build-plan.md` §3.5) — one row, like `first_run_complete` next to it.
 */
const PACING_STRIP_SETTING = 'pacing_strip_seen';
/** Settings ▸ Reply speed (audit §9). See `ReplySpeed` in shared/types.ts. */
const REPLY_SPEED_SETTING = 'reply_speed';
import {
  deckMaterial,
  loadFlowState,
  openOrCreateFlowRoom,
  saveFlowState,
  titleFor,
  type FlowRoomDeps,
} from './flowroom.js';
import type { SegmentDocumentView } from '../shared/segment/types.js';
import type { LearningObjectiveState, LearningTree, ObjectiveRef } from '../shared/objectives.js';
import { DECK_ANCHOR_ID } from '../shared/scope.js';
import { capText } from './vault/extract.js';
import { SELECTION_CAP, VaultService } from './vault/service.js';
import { SegmentService, type SplitInput } from './vault/segments.js';
// collab-doc (#48): the three modules behind the hooks in `register()`, and what they may ask for.
import type { ConfirmRequest, DocHost } from './dochost.js';
import { registerNotesIpc } from './notes/ipc.js';
import { createDocPort } from './notes/docport.js';
import { registerDocRoomIpc } from './docroom/ipc.js';
import { buildProgress, registerProgressIpc } from './docroom/progress.js';
import { outcomesRepo } from './db/repos/outcomes.js';
// The experimental trial: consent gate and research export (src/shared/trial.ts).
import { registerResearchIpc, trialGate } from './research/ipc.js';
import { describeUrl, type IpcSenderLike } from './security.js';

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
  /**
   * True when an IPC call came from the app's own page (`security.ts` `isTrustedSender`, release
   * review P0-3). **Absent means nothing is trusted**: every handler refuses. Production passes
   * it from `index.ts`; the unit tests that build an AppService never invoke a handler.
   */
  isTrustedSender?(event: IpcSenderLike): boolean;
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
  /** BYOK: every provider's key file, views, patch checks and Test connection. */
  readonly #providers: ProviderService;
  readonly #vault: VaultService;
  readonly #segments: SegmentService;
  readonly #cost: CostLedger;
  /** Running app-level totals since launch, so `cost.updated` needs no second query per call. */
  #sessionTokens: CostTokens = emptyTokens();
  #sessionCalls = 0;
  #sessionUsd = 0;
  #actor: RoomActor | null = null;

  constructor(deps: IpcDeps) {
    this.#d = deps;
    this.#providers = new ProviderService({ userDataDir: deps.userDataDir, settings: deps.store.settings });
    // The Anthropic key is the provider service's `anthropic` store — the same file as ever.
    this.#apiKey = this.#providers.store('anthropic');
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
    /**
     * **The cost ledger, constructed here and nowhere else.** It is handed to `createClient()`
     * on every `llm()` call, which is the one place every backend is built, so a call cannot be
     * made through a client that is not counted. `fileForRoom` is the `rooms → materials` hop
     * the ledger needs to file a room's calls under its document; it is injected rather than
     * queried inside the ledger so that module needs no repository of its own.
     */
    this.#cost = new CostLedger({
      db: deps.db,
      readSetting: (key) => deps.store.settings.get(key),
      fileForRoom: (roomId) => {
        const room = deps.store.rooms.get(roomId);
        return room ? (deps.store.materials.get(room.material_id)?.file_id ?? null) : null;
      },
    });
  }

  get cost(): CostLedger {
    return this.#cost;
  }

  /**
   * Reconstruct what the install spent before the ledger existed. Runs once per launch: after
   * the first it finds nothing and costs one indexed scan. Failure is logged and swallowed —
   * an accounting reconstruction must never stop the app from opening.
   */
  backfillCost(): void {
    try {
      const result = backfillUsage(this.#d.db, this.#cost);
      if (result.inserted > 0 || result.candidates > 0) {
        log().info('cost.backfill', {
          inserted: result.inserted,
          candidates: result.candidates,
          by_scope: result.byScope,
          ms: result.ms,
        });
      }
    } catch (err) {
      log().warn('cost.backfill_failed', { class: errorClass(err), cause: (err as Error).message.slice(0, 300) });
    }
  }

  /**
   * The sink the client decorator writes through. It records, then pushes the delta, so a
   * counter in the renderer ticks on the same turn rather than on the next poll.
   */
  #costSink(): { record: (input: Parameters<CostLedger['record']>[0]) => void } {
    return {
      record: (input) => {
        const call = this.#cost.record(input);
        this.#sessionTokens = addTokens(this.#sessionTokens, call.tokens);
        this.#sessionCalls += 1;
        this.#sessionUsd = Math.round((this.#sessionUsd + call.estimatedUsd) * 1e6) / 1e6;
        const update: CostUpdate = {
          call,
          sessionTotals: { tokens: this.#sessionTokens, calls: this.#sessionCalls, estimatedUsd: this.#sessionUsd },
        };
        this.#d.getWindow()?.webContents.send(IPC.costUpdated, update);
        /**
         * **And on the room stream**, because every other per-turn push in the app is there and a
         * renderer holding one `onEvent` subscription should not need a second one to tick a
         * counter. The live run that found this was falling back to `turn.released`, which fires
         * on turns and misses the orchestrator, the ledger, both ingests and the summary calls.
         *
         * Same payload, pushed twice; the union's docstring says to subscribe to one of them.
         */
        this.emit({ type: 'cost.updated', roomId: input.roomId ?? null, update });
      },
    };
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
    return resolveBackend(this.#providers.resolveInput());
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
      keys: this.#providers.keyFlags(),
      resolved,
      apiKey: () => this.#apiKey.get(),
      keyFor: this.#providers.keyFor,
      roster: rosterFor(this.pairing(), resolved.models.agent),
      cost: this.#costSink(),
      ...(material ? { material } : {}),
    });
  }

  cli(): CliDetection {
    return this.backend().detection ?? NOT_FOUND;
  }

  settingsView(): SettingsView {
    const resolved = this.backend();
    const raw = this.#d.store.settings.get(RATE_CARD_SETTING) ?? '';
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
      providers: this.#providers.views(),
      preferredProvider: this.#providers.preferred(),
      vaultRoot: this.#vault.view().rootPath,
      flowProfile: this.flowProfile().name,
      pacingStripSeen: this.#d.store.settings.get(PACING_STRIP_SETTING) === '1',
      replySpeed: this.replySpeed(),
      // The override as typed, and what `parseRateCardOverride` made of it. Both, because a
      // malformed entry is ignored per entry rather than rejected, and the box has to show the
      // learner which one so they can fix it (`src/main/cost/rates.ts`).
      rateCardOverride: raw,
      rateCardErrors: parseRateCardOverride(raw).errors,
      rateCardDate: RATE_CARD_DATE,
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

    const providerProblem = this.#providers.checkPatch(patch);
    if (providerProblem) return { ok: false, error: providerProblem };
    /**
     * **The CLI path is spawned, so it is checked** (release review, 2026-09-25): absolute, an
     * existing regular executable file named `claude` — see `cliOverrideProblem`. A path that
     * fails is refused here, and `resolveClaudeBinary` re-checks on every read.
     */
    if (patch.cliPathOverride !== undefined && patch.cliPathOverride !== null && patch.cliPathOverride.trim() !== '') {
      const problem = cliOverrideProblem(patch.cliPathOverride);
      if (problem) return { ok: false, error: problem };
    }

    if (patch.backendChoice !== undefined) set(SETTINGS_KEYS.backend, patch.backendChoice);
    this.#providers.applyPatch(patch, now());
    if (patch.agentModel !== undefined) set(SETTINGS_KEYS.cliAgentModel, normaliseModelId(patch.agentModel) ?? '');
    if (patch.orchestratorModel !== undefined) {
      set(SETTINGS_KEYS.cliOrchestratorModel, normaliseModelId(patch.orchestratorModel) ?? '');
    }
    if (patch.cliPathOverride !== undefined) set(SETTINGS_KEYS.cliPathOverride, expandHome((patch.cliPathOverride ?? '').trim()));
    // The pacing profile reaches the open room through `rebindActor` (#40): the learner choosing
    // it is not a silent change, and holding it back until the sitting closed meant a switch to
    // Demo did nothing for up to the inactivity gap, reopen or not.
    if (patch.flowProfile !== undefined) set(FLOW_PROFILE_SETTING, patch.flowProfile);
    if (patch.pacingStripSeen !== undefined) set(PACING_STRIP_SETTING, patch.pacingStripSeen ? '1' : '');
    if (patch.replySpeed !== undefined) set(REPLY_SPEED_SETTING, patch.replySpeed);
    /**
     * **Stored as typed, even when it does not parse.** `parseRateCardOverride` already falls
     * back entry by entry and reports what it could not read; rejecting the write here instead
     * would leave the learner's box holding a value the app has thrown away, with no way to edit
     * the one line that is wrong. The errors ride back on `SettingsView` and the panel shows
     * them under the box. Whitespace clears it and returns to the built-in card.
     */
    if (patch.rateCardOverride !== undefined) set(RATE_CARD_SETTING, patch.rateCardOverride.trim());
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
      hasApiKey: this.#providers.anyConfigured(),
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
      flowState: this.#flowStateFor(roomId, material.file_id, pack),
      flowProfile: this.flowProfile(),
      replySpeed: this.replySpeed(),
      newId,
      // The room's half of the log: turn.start / orchestrator.* / ledger.* / timer.* / turn.*,
      // all stamped with the turn id the LLM calls underneath them carry too.
      log: roomLog(roomId),
      // Issue #38 §4. The actor says which rows the ledger's rules moved; this knows which file
      // the room is on, and writes them there.
      onLedgerApplied: ({ rows, changed }) => this.#mirrorObjectives(roomId, rows, changed),
      onTaught: ({ elementId, at }) => this.#noteObjectiveTaught(roomId, elementId, at),
      /**
       * **Issue #41.** The tree already knows which objectives are online and which prerequisites
       * the deck assumes; until now none of it reached the Teacher's prompt, which is why she
       * pitched at the slide. Read per Teacher turn, straight off the repository, so a node that
       * went online two turns ago is known on this one.
       */
      learnerObjectives: () => this.#learnerObjectives(material.file_id),
      // collab-doc (#48): the actor's view of this file's notes doc — an outline to read, block
      // ids to address, and where its edits and Max's verdicts are recorded.
      docPort: createDocPort(this.docHost(), {
        fileId: material.file_id,
        contentSha: material.file_sha256,
        roomId,
      }),
      // collab-doc §4.8: what Ellie's idle recap is read from. The same view the bar draws and
      // the same rows it is drawn from, so the message and the bar cannot disagree.
      fileProgress: async () => {
        if (!material.file_id) return null;
        const host = this.docHost();
        return {
          view: await buildProgress(host, material.file_id),
          outcomes: material.file_sha256 ? outcomesRepo(host.db).forContent(material.file_sha256) : [],
        };
      },
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
   * Push the current Settings into the open actor: backend, models, roster, mode, reply speed,
   * Tester pacing (#40).
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
      flowProfile: this.flowProfile(),
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

  // ── The learning-objective tree (issue #38) ──────────────────────────────

  /**
   * **The ingest, fired on the first open of a PDF in the flow** (§3's trigger — not the first
   * Ask), and not awaited.
   *
   * `segments:get` is where a document becomes a flow: it is the call the renderer makes to draw
   * the cards, it has already resolved the bytes and their `content_sha`, and it is made exactly
   * once per open. Hooking here rather than on `flowAskHere` is §3's own wording and is also the
   * only place the panel can show `pending` *before* the learner has done anything.
   *
   * Everything expensive is behind the cache check: `treeIsCurrent` is a single SQLite read, and
   * only a deck that actually needs a tree pays for `deckMaterial`.
   */
  #ensureTree(fileId: string, view: SegmentDocumentView, opts: { force?: boolean } = {}): void {
    // A document the pipeline refused, or one with no pages, is not a deck to read.
    if (view.refused !== null || view.pageCount < 1) return;
    if (!opts.force && treeIsCurrent(this.#d.store.objectives.tree(fileId), view.contentSha)) return;
    const resolved = this.backend();
    void (async () => {
      const file = this.#vault.fileRow(fileId);
      const { text, outline } = await deckMaterial({ segments: this.#segments, vault: this.#vault }, fileId);
      // An image-only PDF has no text layer and therefore no objectives; the flow still works.
      if (text.trim().length === 0) return;
      await ensureTree(
        {
          store: this.#d.store,
          llm: resolved.kind === 'scripted' ? null : this.llm(resolved),
          models: resolved.models,
          mode: modeFor(resolved.kind),
          onTree: (tree) => this.#onTree(tree),
        },
        {
          fileId,
          contentSha: view.contentSha,
          title: titleFor(file?.name ?? '', view.segments),
          outline,
          text,
          fileName: file?.name ?? null,
          pageCount: view.pageCount,
        },
        opts,
      );
    })().catch(() => undefined);
  }

  /**
   * A status change on a file's tree: told to the renderer, and — when it is `ready` — told to
   * the room, because the tree **is** that room's concept pack (`objectives/pack.ts`).
   */
  #onTree(tree: LearningTree): void {
    const roomId = this.#roomIdForFile(tree.fileId);
    this.emit({ type: 'objectives.tree', roomId, fileId: tree.fileId, tree });
    if (tree.status === 'ready' && roomId !== null) this.#ensurePack(roomId);
  }

  /** The room a file's deck was opened in, or null when nobody has asked it anything yet. */
  #roomIdForFile(fileId: string): string | null {
    const material = this.#d.store.materials.forFileId(fileId);
    if (!material) return null;
    return this.#d.store.rooms.openOrScheduled().find((r) => r.material_id === material.id)?.id ?? null;
  }

  /**
   * The sitting as it was, **plus what this file's objectives say was taught** (§4).
   *
   * The sitting's own taught array is about this sitting; `taughtAt` is about the file, and it is
   * what lets the Tester quiz something the learner was taught before they quit. `flow.ts`'s
   * horizon still governs whether it may actually be asked — an item restored with no session id
   * falls back to the plain six-hour bound.
   */
  #flowStateFor(roomId: string, fileId: string | null, pack: ConceptPack): ReturnType<typeof loadFlowState> {
    const stored = loadFlowState(this.#d.store, roomId);
    if (fileId === null) return stored;
    const existing = stored?.taught ?? [];
    const restored = taughtFromStates(this.#d.store, { fileId, pack, existing });
    if (restored.length === 0) return stored;
    return { ...(stored ?? { session: null, taught: [], pendingQuiz: null, answers: [] }), taught: [...existing, ...restored] };
  }

  /** The file a room's deck is, or null for a pasted-text room. */
  #fileIdForRoom(roomId: string): string | null {
    const room = this.#d.store.rooms.get(roomId);
    if (!room) return null;
    return this.#d.store.materials.get(room.material_id)?.file_id ?? null;
  }

  /** §4: one `objectives.state` per node the ledger's rules actually moved. */
  #mirrorObjectives(roomId: string, rows: LedgerRow[], changed: string[]): void {
    const fileId = this.#fileIdForRoom(roomId);
    if (fileId === null || changed.length === 0) return;
    for (const state of mirrorLedger(this.#d.store, { fileId, rows, changed })) {
      this.emit({ type: 'objectives.state', roomId, fileId, state });
    }
  }

  /** §4: `taughtAt`, written when the Teacher teaches an objective. */
  #noteObjectiveTaught(roomId: string, objectiveId: string, at: string): void {
    const fileId = this.#fileIdForRoom(roomId);
    if (fileId === null) return;
    const tree = this.#d.store.objectives.tree(fileId);
    if (!tree || !tree.objectives.some((o) => o.id === objectiveId)) return;
    const state = this.#d.store.objectives.markTaught({ fileId, objectiveId, at });
    this.emit({ type: 'objectives.state', roomId, fileId, state });
  }

  /** §6's `objectives:tree`. Null when no ingest has ever been asked for this file. */
  objectivesTree(fileId: string): LearningTree | null {
    return this.#d.store.objectives.tree(fileId);
  }

  objectivesStates(fileId: string): LearningObjectiveState[] {
    return this.#d.store.objectives.states(fileId);
  }

  /**
   * **Regenerate** (§3). Re-reads the deck even when the cache is valid, and keeps the states
   * whose objective ids still match — `pruneStates` in the ingest is the half that drops the
   * rest. Returns the `pending` tree at once; the real one arrives on `objectives.tree`.
   */
  async objectivesRegenerate(fileId: string): Promise<LearningTree | null> {
    const view = await this.#segments.document(fileId);
    this.#ensureTree(fileId, view, { force: true });
    return this.#d.store.objectives.tree(fileId);
  }

  /**
   * **Reset** (§4), one confirm on the renderer side: every state to level 0, evidence cleared,
   * `taughtAt` cleared. The tree stays.
   *
   * It resets the **session's ledger rows too**, and that is deliberate rather than overreach.
   * The states are a projection of the ledger (`objectives/pack.ts`), so a reset that left the
   * ledger alone would be undone by the next learner turn — `applyLedgerRules` is monotonic and
   * would re-propose the levels it already holds. The ledger's monotonicity is a rule about what
   * *a model* may do to a learner's record; this is the learner asking, with a confirm in front
   * of it, and `progress-tracking.md` §4.4's rules are about the former.
   */
  objectivesReset(fileId: string): LearningObjectiveState[] {
    const cleared = this.#d.store.objectives.reset(fileId);
    const roomId = this.#roomIdForFile(fileId);
    let ledgerRows = 0;
    if (roomId !== null) {
      const session = this.#d.store.sessions.forRoom(roomId);
      if (session) {
        const now = new Date().toISOString();
        const rows = this.#d.store.ledger.forSession(session.id).map((row) => ({
          ...row,
          level: 0 as const,
          level_proposed: 0 as const,
          confidence: null,
          evidence_text: null,
          evidence_msg_id: null,
          evidence_seq: null,
          defended_against: null,
          revisit: 0,
          updated_at: now,
        }));
        ledgerRows = rows.length;
        this.#d.store.transaction(() => {
          for (const row of rows) this.#d.store.ledger.upsert(row);
        });
        // The taught set goes with it: a Tester that goes on quizzing what the learner has just
        // said they want to start again from would be quizzing a record that no longer exists.
        this.#actor?.resetTaught();
        this.#persistFlow();
        const actor = this.#actor;
        if (actor && actor.snapshot().roomId === roomId) {
          this.emit({ type: 'ledger.updated', roomId, ledger: actor.snapshot().ledger, changed: [] });
        }
      }
    }
    log().info('objectives.reset', { file_id: fileId, states: cleared, ledger_rows: ledgerRows, room_id: roomId });
    return this.#d.store.objectives.states(fileId);
  }

  /**
   * The file's objectives and their levels, for `prompts.learnerBlock()` (#41).
   *
   * Deck order, so the list the Teacher reads is the order the learner meets them in. An empty
   * array is a correct answer — no tree yet, or a tree still ingesting — and the block turns that
   * into *assume less* rather than into silence.
   */
  #learnerObjectives(
    fileId: string | null,
  ): {
    objectiveId: string;
    title: string;
    level: 0 | 1 | 2 | 3;
    assumedByDeck: boolean;
    refs: ObjectiveRef[];
    order: number;
  }[] {
    if (!fileId) return [];
    const tree = this.#d.store.objectives.tree(fileId);
    if (!tree || tree.status !== 'ready') return [];
    const states = new Map(this.#d.store.objectives.states(fileId).map((st) => [st.objectiveId, st]));
    return [...tree.objectives]
      .sort((a, b) => a.order - b.order)
      .map((o) => ({
        // The id as well as the title since #48: the Tester's follow-up picks its target from
        // the concept pack, whose elements carry no `assumedByDeck`, and an objective the deck
        // only assumes must not be quizzed — the bar does not count it, so answering it well
        // moves nothing. `room/actor.ts` `#followupTarget` is the reader.
        objectiveId: o.id,
        title: o.title,
        level: (states.get(o.id)?.level ?? 0) as 0 | 1 | 2 | 3,
        assumedByDeck: o.assumedByDeck,
        // #49: the pages, so the follow-up is filed under the objective of the page the learner
        // asked on rather than under deck order's first objective.
        refs: o.refs,
        order: o.order,
      }));
  }

  /**
   * **Teach me this** (§5): a Teacher turn about one node, anchored where the deck actually
   * talks about it.
   *
   * The anchor, in order: the objective's own first ref; the first ref of the earliest objective
   * that **requires** it (an assumed prerequisite has no ref of its own, and the place it bites
   * is the place to explain it); and the deck anchor when neither exists, because an explanation
   * with nowhere to go still belongs above the flow rather than under an arbitrary slide.
   */
  async objectivesTeach(input: { fileId: string; objectiveId: string }): Promise<{
    roomId: string;
    anchorId: string;
    objectiveId: string;
  } | null> {
    const tree = this.#d.store.objectives.tree(input.fileId);
    const objective = tree?.objectives.find((o) => o.id === input.objectiveId) ?? null;
    if (!tree || !objective) return null;

    const requirer = tree.objectives
      .filter((o) => o.requires.includes(objective.id))
      .sort((a, b) => a.order - b.order)[0] ?? null;
    const anchorId = await this.#anchorForObjective(input.fileId, objective.refs[0] ?? requirer?.refs[0] ?? null);

    const { roomId } = await openOrCreateFlowRoom(this.#flowDeps(), input.fileId);
    this.openRoom(roomId, { opener: false });
    const actor = this.#requireActor(roomId);
    log().info('objectives.teach', {
      file_id: input.fileId,
      objective_id: objective.id,
      assumed: objective.assumedByDeck,
      anchor_id: anchorId,
    });
    try {
      await actor.teachObjective({
        anchorId,
        objectiveId: objective.id,
        title: objective.title,
        statement: objective.statement,
        criteria: objective.criteria,
        assumedByDeck: objective.assumedByDeck,
        requiring: requirer?.title ?? null,
      });
    } finally {
      this.#persistFlow();
    }
    return { roomId, anchorId, objectiveId: objective.id };
  }

  /**
   * A ref is a page (and sometimes a segment id); the flow's threads hang off segments. Resolve
   * the page to the first card on it, which is where the learner's eye is when they click.
   */
  async #anchorForObjective(fileId: string, ref: { page: number; segmentId?: string } | null): Promise<string> {
    if (!ref) return DECK_ANCHOR_ID;
    if (ref.segmentId) return ref.segmentId;
    const view = await this.#segments.document(fileId);
    return view.segments.find((s) => s.page === ref.page)?.id ?? DECK_ANCHOR_ID;
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

  /**
   * **What the collab-doc modules may ask of the app** (#48, `dochost.ts`). One narrow object,
   * so the notes ingest, the chats and the progress bar are three modules beside this file and
   * not three more sections of it.
   */
  docHost(): DocHost {
    const roomFor = async (fileId: string, create: boolean) => {
      if (create) {
        const { roomId, created } = await openOrCreateFlowRoom(this.#flowDeps(), fileId);
        this.openRoom(roomId, { opener: false });
        return { roomId, actor: this.#requireActor(roomId), created };
      }
      const { contentSha } = await this.#segments.document(fileId);
      const material = this.#d.store.materials.forFile(fileId, contentSha);
      if (!material) return null;
      const room = this.#d.store.rooms.openOrScheduled().find((r) => r.material_id === material.id);
      if (!room) return null;
      this.openRoom(room.id, { opener: false });
      return { roomId: room.id, actor: this.#requireActor(room.id), created: false };
    };
    return {
      db: this.#d.db,
      store: this.#d.store,
      vault: this.#vault,
      segments: this.#segments,
      userDataDir: this.#d.userDataDir,
      emit: (event) => this.emit(event),
      backend: () => this.backend(),
      llm: (resolved, material) => this.llm(resolved, material),
      openFlowRoom: async (fileId) => (await roomFor(fileId, true))!,
      roomForFile: async (fileId) => {
        const found = await roomFor(fileId, false);
        return found ? { roomId: found.roomId, actor: found.actor } : null;
      },
      actorFor: (roomId) => this.#requireActor(roomId),
      currentActor: () => this.#actor,
      fileForRoom: (roomId) => this.#fileIdForRoom(roomId),
      persistFlow: () => this.#persistFlow(),
      objectivesTree: (fileId) => this.objectivesTree(fileId),
      objectivesStates: (fileId) => this.objectivesStates(fileId),
      ensureObjectives: (fileId) => {
        void this.#segments
          .document(fileId)
          .then((view) => this.#ensureTree(fileId, view))
          .catch(() => undefined);
      },
      fileBytesKey: async (fileId) => {
        const view = await this.#segments.document(fileId);
        return { contentSha: view.contentSha, pageCount: view.pageCount };
      },
      confirm: (input) => this.#confirm(input),
      retireFlowRoom: (roomId, reason) => this.#retireRoom(roomId, reason),
    };
  }

  /** `DocHost.confirm`: a sheet on the main window, Cancel as the default (Return cancels). */
  async #confirm(input: ConfirmRequest): Promise<boolean> {
    const win = this.#d.getWindow();
    const options = {
      type: 'warning' as const,
      message: input.message,
      detail: input.detail,
      buttons: [input.confirmLabel, 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    };
    const result = await (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options));
    return result.response === 0;
  }

  /** `DocHost.retireFlowRoom`. The rows stay; only the lookup that reopens the room stops finding it. */
  #retireRoom(roomId: string, reason: string): void {
    const now = new Date().toISOString();
    if (this.#actor && this.#actor.snapshot().roomId === roomId) {
      this.#persistFlow();
      this.#actor.retire();
      this.#actor = null;
    }
    this.#d.store.rooms.update(roomId, {
      state: 'closed',
      closed_at: now,
      pending_turn_id: null,
      pending_turn_due_ts: null,
      deadline_ts: null,
    });
    const session = this.#d.store.sessions.forRoom(roomId);
    if (session && !session.ended_at) this.#d.store.sessions.end(session.id, now, reason);
    log().info('room.retired', { room_id: roomId, reason, session_id: session?.id ?? null });
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
    const gate = trialGate(this.#d.store.settings);
    const trusted = (event: IpcSenderLike): boolean => this.#d.isTrustedSender?.(event) ?? false;
    const handle = <T>(channel: string, fn: (payload: T) => unknown) => {
      ipcMain.handle(channel, async (event, payload: T) => {
        try {
          // Who is asking comes before what they may ask: a page that is not the app's own (a
          // dropped file, a foreign URL) gets nothing, not even the consent channels.
          if (!trusted(event)) {
            let from = 'no frame';
            try {
              from = describeUrl(event.senderFrame?.url ?? '');
            } catch {
              /* a disposed frame */
            }
            throw new Error(`Refused: this request did not come from the ChatterED window (${from}).`);
          }
          gate.assert(channel); // nothing but the trial's own channels before consent
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

    // collab-doc (#48). Each module owns its channels; this file only places the hooks.
    const docHost = this.docHost();
    registerNotesIpc(docHost, handle);
    registerDocRoomIpc(docHost, handle);
    registerProgressIpc(docHost, handle);

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

    // BYOK providers (2026-09-25): keys, and Test connection. A key change re-binds the open room
    // the same way a Settings change does, so the next turn runs on what Settings now says.
    registerProviderIpc(this.#providers, handle, () => this.rebindActor());

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
    handle<{ fileId: string }>(IPC.segmentsGet, async (input) => {
      const view = await this.#segments.document(input.fileId);
      // **The learning-objective ingest's trigger** (issue #38 §3): the first open of a PDF in
      // the flow, which is this call. Fired, never awaited — the cards must draw at pipeline
      // speed and the tree arrives on `objectives.tree` when Sonnet has read the deck.
      this.#ensureTree(input.fileId, view);
      return view;
    });
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

    // ── The learning-objective tree (issue #38) ───────────────────────────
    handle<{ fileId: string }>(IPC.objectivesTree, (input) => this.objectivesTree(input.fileId));
    handle<{ fileId: string }>(IPC.objectivesStates, (input) => this.objectivesStates(input.fileId));
    handle<{ fileId: string }>(IPC.objectivesRegenerate, (input) => this.objectivesRegenerate(input.fileId));
    handle<{ fileId: string }>(IPC.objectivesReset, (input) => this.objectivesReset(input.fileId));
    handle<{ fileId: string; objectiveId: string }>(IPC.objectivesTeach, (input) => this.objectivesTeach(input));

    /**
     * What the app has spent. Three read channels and no write ones: the ledger is written only
     * by the client decorator, so nothing the renderer can say changes a number here.
     */
    handle<CostSummaryQuery>(IPC.costSummary, (input) => this.#cost.summary(input));
    handle<{ limit?: number } | undefined>(IPC.costRecent, (input) => this.#cost.recent(input?.limit ?? 50));
    handle<{ since?: string | null } | undefined>(IPC.costExport, (input) => {
      const dir = join(app.getPath('documents'), 'ChatterED');
      const result = writeCsv(dir, this.#cost.rows(input?.since ?? null));
      log().info('cost.export', { rows: result.rows, bytes: result.bytes });
      return result;
    });
    // Per-message cost and the Usage page (#42 items B and D) — `src/main/cost/ipc.ts`.
    registerCostIpc({ db: this.#d.db, sessionStart: () => this.#cost.sessionStart, handle });
    // The experimental trial: consent and File ▸ Export Research Data… (`src/main/research/`).
    registerResearchIpc({
      db: this.#d.db,
      settings: this.#d.store.settings,
      userDataDir: this.#d.userDataDir,
      logDir: this.#d.logDir,
      appVersion: this.#d.appVersion,
      backendInfo: () => {
        const resolved = this.backend();
        return { kind: resolved.kind, models: { ...resolved.models } };
      },
      getWindow: this.#d.getWindow,
      handle,
    });

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
