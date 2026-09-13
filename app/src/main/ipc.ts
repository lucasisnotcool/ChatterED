/**
 * The IPC bridge. Every handler here is reachable from the renderer, and nothing else is
 * (architecture-mac.md §C.1: contextIsolation + a preload allowlist).
 *
 * The renderer holds no authority: it sends intent and renders what comes back. In particular
 * it never owns the silence deadline — it animates against a timestamp the main process wrote
 * to SQLite before arming anything.
 */
import { BrowserWindow, dialog, ipcMain } from 'electron';
import type { Bootstrap, CreateSessionInput, RoomEvent, RoomSnapshot } from '../shared/types.js';
import { IPC } from '../shared/ipc.js';
import { rosterFor, randomPairing } from '../room/agents.js';
import { RoomActor } from '../room/actor.js';
import { AnthropicClient } from '../room/llm/anthropic.js';
import { ScriptedClient } from '../room/llm/scripted.js';
import type { LLMClient } from '../room/llm/types.js';
import type { ConceptPack, RoomConfig } from '../room/records.js';
import { systemClock } from './clock.js';
import { groupView, type LocalStore } from './db/store.js';
import { createKeychain, looksLikeAnthropicKey, type Keychain } from './keychain.js';
import { createSession, draftConcept, newId } from './sessions.js';

export interface IpcDeps {
  store: LocalStore;
  appVersion: string;
  osVersion: string;
  getWindow(): BrowserWindow | null;
}

export class AppService {
  readonly #d: IpcDeps;
  readonly #keychain: Keychain;
  #actor: RoomActor | null = null;

  constructor(deps: IpcDeps) {
    this.#d = deps;
    this.#keychain = createKeychain(deps.store.settings, () => new Date().toISOString());
  }

  get keychain(): Keychain {
    return this.#keychain;
  }

  get actor(): RoomActor | null {
    return this.#actor;
  }

  /** Role–name pairing is randomised once, at install, and never changes after (#16). */
  pairing(): 'ellie_peer' | 'ellie_challenger' {
    const stored = this.#d.store.settings.get('role_pairing');
    if (stored === 'ellie_peer' || stored === 'ellie_challenger') return stored;
    const chosen = randomPairing();
    this.#d.store.settings.set('role_pairing', chosen, new Date().toISOString());
    return chosen;
  }

  mode(): 'scripted' | 'live' {
    return this.#keychain.has() ? 'live' : 'scripted';
  }

  llm(): LLMClient {
    const key = this.#keychain.get();
    if (!key) return new ScriptedClient();
    return new AnthropicClient({ apiKey: key });
  }

  emit(event: RoomEvent): void {
    this.#d.getWindow()?.webContents.send(IPC.event, event);
  }

  bootstrap(): Bootstrap {
    const pairing = this.pairing();
    const recent = this.#d.store.sessions.recent(3).map((s) => {
      const room = this.#d.store.rooms.get(s.room_id);
      const ledger = this.#d.store.ledger.forSession(s.id);
      return {
        roomId: s.room_id,
        conceptTitle: room?.topic ?? 'Session',
        moduleCode: room?.module_code ?? '',
        states: ledger.map((r) =>
          r.level >= 3 ? ('defended' as const) : r.level === 2 ? ('justified' as const) : r.level === 1 ? ('stated' as const) : ('not_yet' as const),
        ),
        endedAt: s.ended_at,
        updatedAt: s.ended_at ?? s.started_at,
      };
    });
    return {
      appVersion: this.#d.appVersion,
      hasApiKey: this.#keychain.has(),
      mode: this.mode(),
      slidesFolder: this.#d.store.settings.get('slides_folder') ?? null,
      pairing,
      agents: rosterFor(pairing),
      recentSessions: recent,
      firstRun: this.#d.store.settings.get('first_run_complete') !== '1',
      keychainAvailable: this.#keychain.available(),
    };
  }

  openRoom(roomId: string): RoomSnapshot {
    if (this.#actor && this.#actor.snapshot().roomId === roomId) return this.#actor.snapshot();
    this.#actor?.stop();
    const room = this.#d.store.rooms.get(roomId);
    if (!room) throw new Error(`No such room: ${roomId}`);
    const session = this.#d.store.sessions.forRoom(roomId);
    if (!session) throw new Error(`No session for room: ${roomId}`);
    const material = this.#d.store.materials.get(room.material_id);
    if (!material) throw new Error(`No material for room: ${roomId}`);
    const pack = JSON.parse(material.concept_pack) as ConceptPack;
    const config = JSON.parse(room.config) as RoomConfig;

    this.#actor = new RoomActor({
      store: this.#d.store,
      groupStore: groupView(this.#d.store),
      clock: systemClock,
      transport: { emit: (event) => this.emit(event) },
      llm: this.llm(),
      roomId,
      sessionId: session.id,
      roster: rosterFor(this.pairing()),
      pack,
      config: { ...config, mode: this.mode() },
      appVersion: this.#d.appVersion,
      newId,
    });
    this.#actor.start();
    this.#actor.recover();
    void this.#actor.open();
    return this.#actor.snapshot();
  }

  /** Runs on launch and on every `powerMonitor` resume. Idempotent by timerEpoch. */
  recover(): void {
    this.#actor?.recover();
  }

  dispose(): void {
    this.#actor?.stop();
    this.#actor = null;
  }

  #requireActor(roomId: string): RoomActor {
    if (!this.#actor) throw new Error('No open room');
    if (this.#actor.snapshot().roomId !== roomId) throw new Error('That room is not open');
    return this.#actor;
  }

  register(): void {
    const handle = <T>(channel: string, fn: (payload: T) => unknown) => {
      ipcMain.handle(channel, async (_event, payload: T) => fn(payload));
    };

    handle(IPC.bootstrap, () => this.bootstrap());

    handle(IPC.chooseSlidesFolder, async () => {
      const win = this.#d.getWindow();
      const result = await (win
        ? dialog.showOpenDialog(win, { properties: ['openDirectory'] })
        : dialog.showOpenDialog({ properties: ['openDirectory'] }));
      const folder = result.canceled ? null : (result.filePaths[0] ?? null);
      if (folder) this.#d.store.settings.set('slides_folder', folder, new Date().toISOString());
      return folder;
    });

    handle<string>(IPC.setApiKey, (key) => {
      if (!looksLikeAnthropicKey(key)) {
        return { ok: false, error: "That doesn't look like an Anthropic key — they start with sk-ant-." };
      }
      try {
        this.#keychain.set(key.trim());
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    });

    handle(IPC.clearApiKey, () => {
      this.#keychain.clear();
    });

    handle(IPC.completeFirstRun, () => {
      this.#d.store.settings.set('first_run_complete', '1', new Date().toISOString());
    });

    handle<{ moduleCode: string; title: string; text: string }>(IPC.draftConcept, (input) =>
      draftConcept(this.#keychain.has() ? this.llm() : null, input),
    );

    handle<CreateSessionInput>(IPC.createSession, (input) => {
      const created = createSession(
        {
          store: this.#d.store,
          pairing: this.pairing(),
          appVersion: this.#d.appVersion,
          osVersion: this.#d.osVersion,
          mode: this.mode(),
        },
        input,
      );
      return { roomId: created.roomId };
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
