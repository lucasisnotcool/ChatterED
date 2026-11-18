/**
 * **The updater's engine**: state, launch bookkeeping, check, download, stage, smoke launch, and
 * the hand-off to the swap helper. Node built-ins only: no Electron, and nothing of the app's own,
 * so it runs the same in the stage-0 bootstrap, in the updater's utilityProcess, and under Vitest,
 * and keeps working whatever a future build breaks elsewhere (`bootstrap.ts`).
 *
 * Everything lives in `<userData>/updates.noindex/` (mode 0700; `.noindex` keeps Spotlight out):
 *
 *     state.json         bad builds, key rotation, last check, apply failures (written by checks)
 *     launch.json        this launch's record and each build's health (written by main only)
 *     status-*.json      the last of each update.* event, for the debug report
 *     staged/            ChatterED.app + staged.json: verified, smoke-launched, ready to swap in
 *     previous/          ChatterED.app: the last build that was healthy here (N-1), for rollback
 *     swap-journal(.json) a swap in progress; the next launch finishes or reverts it
 *     result.json        what the last helper did, logged and removed by the next launch
 *     work-<random>/     a download or extraction in progress (removed on failure)
 *
 * The participant's own data (`app.db`, notes, keys) is never written here; the database is only
 * read, to copy it for the smoke launch and to read its schema version from the file header.
 */
import { execFile, execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
  writeFileSync,
  writeSync,
  accessSync,
  constants as fsConstants,
} from 'node:fs';
import { join, sep } from 'node:path';
import { promisify } from 'node:util';
import {
  decide,
  MAX_MANIFEST_BYTES,
  MAX_SIG_BYTES,
  trustedKeys,
  verifyManifest,
  type TrustedKey,
  type UpdateManifest,
} from './manifest.js';
import {
  buildNumber,
  classifyLocation,
  parseSwapResult,
  probationStep,
  recoverJournal,
  SWAP_SCRIPT,
  swapArgs,
  swapPaths,
  type BuildHealth,
  type LaunchRecord,
  type LocationKind,
} from './plan.js';

const execFileP = promisify(execFile);

/** Under userData. `.noindex` keeps Spotlight (and so Launchpad and Open With) away from staged bundles. */
export const UPDATES_DIR = 'updates.noindex';

export interface EngineConfig {
  /** The running bundle: the one a swap replaces. */
  bundlePath: string;
  /** CFBundleIdentifier this build must keep (`sg.nus.chattered`, or `…chattered.test`). */
  appId: string;
  /** `ChatterED` (or `ChatterED Test`): the bundle is `<productName>.app`, its executable `Contents/MacOS/<productName>`. */
  productName: string;
  /** `Contents/Resources/chattered-swap` of the running build, or null. */
  swapTool: string | null;
  /** `<userData>/install-id`, for a manifest's per-install `targets`. */
  installId: string | null;
  /** Which process this engine runs in, for its status file (`status-<role>.json`). */
  role: 'main' | 'worker';
  userDataDir: string;
  currentBuild: number;
  /** The build's git sha (baked), for the log. */
  sha: string;
  channel: string;
  /** The compiled keys (active + cold). */
  keys: readonly TrustedKey[];
  /** The channel's manifest URL, then any mirrors. The `.sig` is at the same URL + `.sig`. */
  manifestUrls: readonly string[];
  /** http:// allowed: a dev run or a test build only. */
  allowHttp: boolean;
  osVersion: string;
  /** `main.log`: the engine appends its own lines in the same JSON format. */
  logFile: string;
  logBase: Record<string, string | number | boolean>;
  pid: number;
  /** Test builds only: the `CHATTERED_HELPER_*` variables handed to the helper. */
  helperEnv?: Record<string, string>;
  /** Replaceable for tests. */
  fetch?: typeof fetch;
  /** Tests only: called instead of spawning the detached helper. */
  spawnHelper?: (script: string, args: string[]) => void;
  now?: () => number;
  /** Test variant only: the first check's delay (default 30 s ± 15 s). */
  firstCheckMs?: number;
  /** Seconds the smoke launch may take. */
  smokeTimeoutSeconds?: number;
}

/** `state.json`: written by checks (the worker) and by the launch's bookkeeping of applies. */
export interface UpdateState {
  badBuilds: number[];
  rotation: { add: string[]; revoke: string[] };
  lastCheckAt: string | null;
  /** Failed applies of the staged build: after two it is discarded and fetched again later. */
  applyFailures: number;
}

/** `launch.json`: written by the main process only, so a check can never overwrite a healthy mark. */
export interface LaunchState {
  launch: LaunchRecord | null;
  health: BuildHealth | null;
  lastLaunchedBuild: number | null;
}

export interface Staged {
  build: number;
  version: string;
  cdhash: string | null;
  downgrade: boolean;
  stagedAt: string;
}

export type EarlyOutcome =
  | { kind: 'continue'; note: { from: number; to: number } | null }
  | { kind: 'exit'; why: 'swap_in_progress' | 'applying' | 'rolling_back' };

function emptyState(): UpdateState {
  return { badBuilds: [], rotation: { add: [], revoke: [] }, lastCheckAt: null, applyFailures: 0 };
}

/** Fields the engine may log: numbers, booleans and short strings. Never a path under home, a key or a code. */
function clean(fields: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === null || v === undefined) out[k] = null;
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else out[k] = String(v).replace(/\/Users\/[^/\s]+/g, '~').slice(0, 200);
  }
  return out;
}

/** One JSON line in `main.log`'s format. Used by the engine and, before an engine exists, the bootstrap. */
export function appendLog(file: string, base: Record<string, unknown>, level: string, event: string, fields: Record<string, unknown> = {}): void {
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...base, ...clean(fields) });
    mkdirSync(join(file, '..'), { recursive: true });
    appendFileSync(file, `${line}\n`, 'utf8');
  } catch {
    /* never fatal */
  }
}

export class UpdateEngine {
  readonly cfg: EngineConfig;
  readonly dir: string;
  #fetch: typeof fetch;
  #now: () => number;
  #staging = false;

  constructor(cfg: EngineConfig) {
    this.cfg = cfg;
    this.dir = join(cfg.userDataDir, UPDATES_DIR);
    this.#fetch = cfg.fetch ?? fetch;
    this.#now = cfg.now ?? Date.now;
  }

  // ── log and state ─────────────────────────────────────────────────────────

  log(level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown> = {}): void {
    const ts = new Date(this.#now()).toISOString();
    const f = clean(fields);
    try {
      const line = JSON.stringify({ ts, level, event, ...this.cfg.logBase, ...f });
      mkdirSync(join(this.cfg.logFile, '..'), { recursive: true });
      appendFileSync(this.cfg.logFile, `${line}\n`, 'utf8');
    } catch {
      /* the log never takes the updater down */
    }
    // The last of each event, for the debug report's `update` section (`status()`).
    try {
      this.#ensureDir();
      const file = join(this.dir, `status-${this.cfg.role}.json`);
      let st: Record<string, unknown> = {};
      try {
        st = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      } catch {
        st = {};
      }
      st[event] = { ts, level, ...f };
      writeFileSync(file, JSON.stringify(st), { mode: 0o600 });
    } catch {
      /* diagnostics only */
    }
  }

  /** Everything the debug report shows about updates, from files only (works when the app is broken). */
  status(): Record<string, unknown> {
    const read = (name: string): unknown => this.#readJson<Record<string, unknown>>(name);
    const staged = this.readStaged();
    const state = this.readState();
    const ls = this.readLaunch();
    return {
      build: this.cfg.currentBuild,
      sha: this.cfg.sha,
      channel: this.cfg.channel,
      install_id: this.cfg.installId,
      location: this.location(),
      bundle: this.cfg.bundlePath.replace(/^\/Users\/[^/]+/, '~'),
      staged: staged ? { build: staged.build, at: staged.stagedAt, downgrade: staged.downgrade } : null,
      previous_build: existsSync(this.previousApp) ? buildNumber(plistValue(this.previousApp, 'CFBundleVersion')) : null,
      bad_builds: state.badBuilds,
      last_check_at: state.lastCheckAt,
      apply_failures: state.applyFailures,
      keys_rotated: { added: state.rotation.add.length, revoked: state.rotation.revoke.length },
      launch: ls.launch,
      health: ls.health,
      journal_pending: existsSync(join(this.dir, 'swap-journal')),
      free_mb: Math.round(this.freeBytes() / 1e6),
      last_events: { main: read('status-main.json'), worker: read('status-worker.json') },
    };
  }

  #ensureDir(): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
  }

  #readJson<T>(name: string): Partial<T> | null {
    try {
      const v = JSON.parse(readFileSync(join(this.dir, name), 'utf8')) as Partial<T>;
      return v && typeof v === 'object' ? v : null;
    } catch {
      return null;
    }
  }

  #writeJson(name: string, value: unknown): void {
    try {
      this.#ensureDir();
      const tmp = join(this.dir, `${name}.${process.pid}.tmp`);
      writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
      renameSync(tmp, join(this.dir, name));
    } catch (err) {
      this.log('warn', 'update.failed', { stage: 'state', cause: shortCause(err) });
    }
  }

  readState(): UpdateState {
    const s = this.#readJson<UpdateState>('state.json') ?? {};
    const e = emptyState();
    return {
      badBuilds: Array.isArray(s.badBuilds) ? s.badBuilds.filter((n) => Number.isInteger(n)) : e.badBuilds,
      rotation: {
        add: Array.isArray(s.rotation?.add) ? s.rotation.add.filter((k) => typeof k === 'string') : [],
        revoke: Array.isArray(s.rotation?.revoke) ? s.rotation.revoke.filter((k) => typeof k === 'string') : [],
      },
      lastCheckAt: typeof s.lastCheckAt === 'string' ? s.lastCheckAt : null,
      applyFailures: Number.isInteger(s.applyFailures) ? (s.applyFailures as number) : 0,
    };
  }

  readLaunch(): LaunchState {
    const s = this.#readJson<LaunchState>('launch.json') ?? {};
    return {
      launch: s.launch && Number.isInteger(s.launch.build) ? s.launch : null,
      health: s.health && Number.isInteger(s.health.build) ? s.health : null,
      lastLaunchedBuild: Number.isInteger(s.lastLaunchedBuild) ? (s.lastLaunchedBuild as number) : null,
    };
  }

  #patch(fn: (s: UpdateState) => void): void {
    const s = this.readState();
    fn(s);
    this.#writeJson('state.json', s);
  }

  #patchLaunch(fn: (s: LaunchState) => void): void {
    const s = this.readLaunch();
    fn(s);
    this.#writeJson('launch.json', s);
  }

  location(): LocationKind {
    return classifyLocation(this.cfg.bundlePath, (p) => {
      try {
        accessSync(p, fsConstants.W_OK);
        return true;
      } catch {
        return false;
      }
    });
  }

  get bundleName(): string {
    return `${this.cfg.productName}.app`;
  }

  get stagedApp(): string {
    return join(this.dir, 'staged', this.bundleName);
  }

  get previousApp(): string {
    return join(this.dir, 'previous', this.bundleName);
  }

  readStaged(): Staged | null {
    try {
      const s = JSON.parse(readFileSync(join(this.dir, 'staged', 'staged.json'), 'utf8')) as Staged;
      if (!Number.isInteger(s.build) || !existsSync(this.stagedApp)) return null;
      return s;
    } catch {
      return null;
    }
  }

  discardStaged(why: string): void {
    if (existsSync(join(this.dir, 'staged'))) {
      rmSync(join(this.dir, 'staged'), { recursive: true, force: true });
      this.log('info', 'update.discarded', { why });
    }
  }

  // ── launch: before any app code runs (bootstrap.ts, synchronous) ─────────

  /**
   * The stage-0 work of every launch, in order: log what the last helper did; finish or revert a
   * swap it left half done; stop if one is still running; swap in a staged update now (the app
   * exits and the helper reopens it); else count this launch toward the build's probation and roll
   * back if it keeps failing. Never throws.
   */
  early(): EarlyOutcome {
    try {
      return this.#early();
    } catch (err) {
      this.log('error', 'update.failed', { stage: 'early', cause: (err as Error).message });
      return { kind: 'continue', note: null };
    }
  }

  #early(): EarlyOutcome {
    this.#ensureDir();
    const paths = swapPaths({ target: this.cfg.bundlePath, updatesDir: this.dir });
    const helperAlive = this.#lockHolderAlive(paths.lock);

    // 1. What the last helper did.
    if (!helperAlive && existsSync(paths.result)) {
      const r = parseSwapResult(readFileSync(paths.result, 'utf8'));
      rmSync(paths.result, { force: true });
      if (r) {
        const fields = { from: r.from, to: r.to, mode: r.mode, at: r.at };
        if (r.status === 'ok') {
          this.log('info', r.mode === 'rollback' ? 'update.rolled_back' : 'update.applied', fields);
          this.#patch((s) => (s.applyFailures = 0));
        } else {
          this.log('warn', 'update.failed', { ...fields, stage: 'swap', cause: `${r.status}:${r.cause}` });
          this.#patch((s) => (s.applyFailures += 1));
        }
      }
    }

    // 2. A swap the helper did not finish.
    if (!helperAlive && existsSync(paths.journal)) {
      let meta: { keepOld?: boolean; to?: number } = {};
      try {
        meta = JSON.parse(readFileSync(`${paths.journal}.json`, 'utf8')) as typeof meta;
      } catch {
        /* without the metadata the old bundle is deleted, never kept as N-1 */
      }
      const done = recoverJournal(
        readFileSync(paths.journal, 'utf8'),
        {
          exists: existsSync,
          rename: renameSync,
          remove: (p) => rmSync(p, { recursive: true, force: true }),
          buildOf: (p) => buildNumber(plistValue(p, 'CFBundleVersion')),
        },
        { target: this.cfg.bundlePath, keep: this.previousApp, keepOld: meta.keepOld === true, aside: paths.aside, near: paths.near, toBuild: Number(meta.to) || 0 },
      );
      rmSync(paths.journal, { force: true });
      rmSync(`${paths.journal}.json`, { force: true });
      this.log('warn', 'update.journal_recovered', { result: done, to: Number(meta.to) || 0 });
    }

    // 3. A helper is still at work: it reopens the app when it is done.
    if (helperAlive) {
      this.log('info', 'update.check', { result: 'swap_in_progress' });
      return { kind: 'exit', why: 'swap_in_progress' };
    }

    const state = this.readState();
    const ls = this.readLaunch();
    const current = this.cfg.currentBuild;

    // 4. A staged update: swap it in now, before the app's code loads.
    const staged = this.readStaged();
    if (staged) {
      if (staged.build === current || (staged.build < current && !staged.downgrade) || state.badBuilds.includes(staged.build)) {
        this.discardStaged(staged.build === current ? 'already_running' : 'stale');
      } else if (state.applyFailures >= 2) {
        this.discardStaged('apply_failed_twice');
        this.#patch((s) => (s.applyFailures = 0));
      } else if (this.location() === 'ok') {
        if (this.spawnSwap({ mode: 'apply', relaunch: 'front' })) return { kind: 'exit', why: 'applying' };
      }
    }

    // 5. Probation: a build that keeps failing to start goes back to the kept previous one.
    const previousBuild = existsSync(this.previousApp) ? buildNumber(plistValue(this.previousApp, 'CFBundleVersion')) : null;
    const step = probationStep(ls.launch, ls.health, current, previousBuild);
    if (step.action === 'rollback' && this.location() === 'ok') {
      this.log('error', 'update.crash_loop', { build: current, crashes: step.health.crashes, to: previousBuild });
      this.#patchLaunch((s) => (s.health = step.health));
      if (this.rollback('crash_loop')) return { kind: 'exit', why: 'rolling_back' };
    }

    // 6. Count this launch; say "Updated to build N" once.
    const note = ls.lastLaunchedBuild !== null && current > ls.lastLaunchedBuild ? { from: ls.lastLaunchedBuild, to: current } : null;
    this.#patchLaunch((s) => {
      s.health = step.health;
      s.launch = { build: current, healthy: false, clean: false };
      s.lastLaunchedBuild = current;
    });
    return { kind: 'continue', note };
  }

  /**
   * Go back to the kept previous bundle (N-1) and never reinstall this build here. The caller must
   * exit. False when there is no previous bundle or this copy cannot replace itself.
   */
  rollback(why: string): boolean {
    if (!existsSync(this.previousApp) || this.location() !== 'ok') return false;
    const bad = this.cfg.currentBuild;
    this.#patch((s) => {
      if (!s.badBuilds.includes(bad)) s.badBuilds.push(bad);
    });
    this.#patchLaunch((s) => (s.launch = null));
    this.discardStaged('rollback');
    this.log('error', 'update.rollback', { why, bad });
    return this.spawnSwap({ mode: 'rollback', relaunch: 'front' });
  }

  /** Crashed launches of this build so far (this one not counted). */
  crashes(): number {
    const h = this.readLaunch().health;
    return h && h.build === this.cfg.currentBuild ? h.crashes : 0;
  }

  /** DB open, the window's bridge up, and still alive a little later: this build works here. */
  markHealthy(): void {
    this.#patchLaunch((s) => {
      if (s.launch && s.launch.build === this.cfg.currentBuild) s.launch.healthy = true;
      if (s.health && s.health.build === this.cfg.currentBuild && !s.health.everHealthy) {
        s.health.everHealthy = true;
        this.log('info', 'update.healthy', { build: this.cfg.currentBuild });
      }
    });
  }

  markCleanExit(): void {
    this.#patchLaunch((s) => {
      if (s.launch && s.launch.build === this.cfg.currentBuild) s.launch.clean = true;
    });
  }

  everHealthy(): boolean {
    const h = this.readLaunch().health;
    return h !== null && h.build === this.cfg.currentBuild && h.everHealthy;
  }

  hasPrevious(): boolean {
    return existsSync(this.previousApp);
  }

  // ── swap ──────────────────────────────────────────────────────────────────

  #lockHolderAlive(lock: string): boolean {
    try {
      const pid = Number(readFileSync(join(lock, 'pid'), 'utf8').trim());
      if (!Number.isInteger(pid) || pid <= 1) return false;
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Hand the swap to the helper, which waits for this process to exit. The caller must then exit.
   * `apply` swaps in the staged build; `rollback` swaps in the kept previous one and deletes the
   * failing build. Returns false (and logs) when there is nothing sound to swap in.
   */
  spawnSwap(o: { mode: 'apply' | 'rollback'; relaunch: 'no' | 'front' | 'background' }): boolean {
    try {
      const staged = o.mode === 'apply' ? this.readStaged() : null;
      const incoming = o.mode === 'apply' ? this.stagedApp : this.previousApp;
      if (!existsSync(incoming) || (o.mode === 'apply' && !staged)) return false;
      const toBuild = o.mode === 'apply' ? staged!.build : buildNumber(plistValue(incoming, 'CFBundleVersion'));
      if (toBuild < 1) return false;
      // Keep the build being replaced as N-1 only if it was healthy here; else the old N-1 stays.
      const keepOld = o.mode === 'apply' && this.everHealthy();
      // The swap tool is copied out of the bundle it is about to swap away.
      let swapTool: string | null = null;
      if (this.cfg.swapTool && existsSync(this.cfg.swapTool)) {
        swapTool = join(this.dir, 'chattered-swap');
        writeFileSync(swapTool, readFileSync(this.cfg.swapTool), { mode: 0o700 });
      }
      const args = swapArgs({
        swapTool,
        pid: this.cfg.pid,
        target: this.cfg.bundlePath,
        incoming,
        keep: this.previousApp,
        keepOld,
        toBuild,
        fromBuild: this.cfg.currentBuild,
        mode: o.mode,
        allowDowngrade: o.mode === 'apply' && staged!.downgrade,
        relaunch: o.relaunch,
        cdhash: o.mode === 'apply' ? staged!.cdhash : null,
        updatesDir: this.dir,
      });
      const paths = swapPaths({ target: this.cfg.bundlePath, updatesDir: this.dir });
      writeFileSync(`${paths.journal}.json`, JSON.stringify({ keepOld, mode: o.mode, from: this.cfg.currentBuild, to: toBuild }), { mode: 0o600 });
      const script = join(this.dir, 'swap-helper.sh');
      writeFileSync(script, SWAP_SCRIPT, { mode: 0o700 });
      if (this.cfg.spawnHelper) this.cfg.spawnHelper(script, args);
      else {
        const child = spawn('/bin/bash', [script, ...args], {
          detached: true,
          stdio: 'ignore',
          env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: process.env.HOME ?? '', ...(this.cfg.helperEnv ?? {}) },
        });
        child.unref();
      }
      this.log('info', o.mode === 'apply' ? 'update.applying' : 'update.rolling_back', {
        from: this.cfg.currentBuild,
        to: toBuild,
        relaunch: o.relaunch,
        keep_old: keepOld,
      });
      return true;
    } catch (err) {
      this.log('error', 'update.failed', { stage: 'spawn', cause: (err as Error).message });
      return false;
    }
  }

  // ── check, download, stage ────────────────────────────────────────────────

  async #fetchCapped(url: string, cap: number, timeoutMs: number): Promise<Buffer> {
    const res = await this.#fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': `ChatterED-Updater/${this.cfg.currentBuild}`, Accept: '*/*' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`http_${res.status}`);
    const reader = res.body?.getReader();
    if (!reader) throw new Error('no_body');
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > cap) {
        await reader.cancel();
        throw new Error('too_large');
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  }

  /** The first manifest that verifies, from the URL list. */
  async fetchManifest(): Promise<{ manifest: UpdateManifest; signer: TrustedKey } | { error: string }> {
    const state = this.readState();
    const keys = trustedKeys(this.cfg.keys, state.rotation);
    let last = 'no_url';
    for (const url of this.cfg.manifestUrls) {
      try {
        const [bytes, sig] = await Promise.all([
          this.#fetchCapped(url, MAX_MANIFEST_BYTES, 30_000),
          this.#fetchCapped(`${url}.sig`, MAX_SIG_BYTES, 30_000),
        ]);
        const v = verifyManifest(bytes, sig, keys, { allowHttp: this.cfg.allowHttp, installId: this.cfg.installId });
        if (v.ok) return { manifest: v.manifest, signer: v.signer };
        last = v.reason;
      } catch (err) {
        last = shortCause(err);
      }
    }
    return { error: last };
  }

  /**
   * One check. Quiet on failure: a Mac that is offline logs one line and tries again later.
   * Returns true when an update is staged and ready.
   */
  async check(reason: string): Promise<boolean> {
    if (this.#staging) return false;
    this.#staging = true;
    try {
      return await this.#check(reason);
    } catch (err) {
      this.log('warn', 'update.failed', { stage: 'check', cause: shortCause(err) });
      return false;
    } finally {
      this.#staging = false;
    }
  }

  async #check(reason: string): Promise<boolean> {
    this.#ensureDir();
    const got = await this.fetchManifest();
    this.#patch((s) => (s.lastCheckAt = new Date(this.#now()).toISOString()));
    if ('error' in got) {
      this.log('info', 'update.check', { reason, result: 'unavailable', cause: got.error, build: this.cfg.currentBuild });
      return false;
    }
    const { manifest: m, signer } = got;
    if (m.keys.add.length || m.keys.revoke.length) {
      this.#patch((s) => {
        s.rotation = { add: [...new Set([...s.rotation.add, ...m.keys.add])], revoke: [...new Set([...s.rotation.revoke, ...m.keys.revoke])] };
      });
      this.log('warn', 'update.keys_rotated', { added: m.keys.add.length, revoked: m.keys.revoke.length });
    }
    const state = this.readState();
    const d = decide({
      manifest: m,
      appId: this.cfg.appId,
      channel: this.cfg.channel,
      currentBuild: this.cfg.currentBuild,
      osVersion: this.cfg.osVersion,
      dbUserVersion: dbUserVersion(join(this.cfg.userDataDir, 'app.db')),
      badBuilds: state.badBuilds,
    });
    const base = { reason, build: this.cfg.currentBuild, offered: m.build, signer: signer.role, targeted: m.targeted, free_mb: Math.round(this.freeBytes() / 1e6) };
    if (d.action === 'skip') {
      this.log('info', 'update.check', { ...base, result: d.reason });
      return false;
    }
    const staged = this.readStaged();
    if (staged && staged.build === m.build) {
      this.log('info', 'update.check', { ...base, result: 'already_staged' });
      return true;
    }
    if (this.location() !== 'ok') {
      this.log('info', 'update.check', { ...base, result: `location_${this.location()}` });
      return false;
    }
    this.log('info', 'update.check', { ...base, result: 'available', downgrade: d.downgrade });
    return this.#stage(m, d.downgrade);
  }

  /** Bytes free where the updates folder is. */
  freeBytes(): number {
    try {
      const s = statfsSync(this.dir);
      return Number(s.bavail) * Number(s.bsize);
    } catch {
      return Number.MAX_SAFE_INTEGER;
    }
  }

  async #stage(m: UpdateManifest, downgrade: boolean): Promise<boolean> {
    const dbBytes = fileSize(join(this.cfg.userDataDir, 'app.db'));
    // The zip, its extraction (about 3x the zip) and a copy of the database for the smoke launch,
    // with room left so the participant's own database is never the thing that runs out.
    const need = m.size * 5 + dbBytes * 2 + 2 * 1024 * 1024 * 1024;
    if (this.freeBytes() < need) {
      this.log('warn', 'update.failed', { stage: 'space', to: m.build, need_mb: Math.round(need / 1e6), free_mb: Math.round(this.freeBytes() / 1e6) });
      return false;
    }
    const work = join(this.dir, `work-${randomBytes(6).toString('hex')}`);
    mkdirSync(work, { mode: 0o700 });
    const started = this.#now();
    try {
      const zip = join(work, 'payload.zip');
      let downloaded = false;
      let cause = 'no_url';
      for (const url of [m.url, ...m.mirrors]) {
        try {
          await this.#download(url, zip, m.size, m.sha256);
          downloaded = true;
          break;
        } catch (err) {
          cause = shortCause(err);
        }
      }
      if (!downloaded) {
        this.log('warn', 'update.failed', { stage: 'download', to: m.build, cause });
        return false;
      }
      this.log('info', 'update.downloaded', { to: m.build, bytes: m.size, ms: this.#now() - started });

      const out = join(work, 'x');
      mkdirSync(out, { mode: 0o700 });
      await execFileP('/usr/bin/ditto', ['-x', '-k', zip, out], { timeout: 10 * 60_000 });
      rmSync(zip, { force: true });
      const app = checkExtracted(out, this.bundleName);
      const problem = await this.#inspect(app, m);
      if (problem) {
        this.log('error', 'update.failed', { stage: 'verify', to: m.build, cause: problem });
        return false;
      }
      const smoke = await this.smoke(app, m.build, work);
      if (smoke !== 'ok') {
        this.log('error', 'update.failed', { stage: 'smoke', to: m.build, cause: smoke });
        return false;
      }
      const stagedDir = join(this.dir, 'staged');
      rmSync(stagedDir, { recursive: true, force: true });
      mkdirSync(stagedDir, { mode: 0o700 });
      renameSync(app, this.stagedApp);
      const meta: Staged = { build: m.build, version: m.version, cdhash: m.cdhash, downgrade, stagedAt: new Date(this.#now()).toISOString() };
      writeFileSync(join(stagedDir, 'staged.json'), JSON.stringify(meta), { mode: 0o600 });
      this.#patch((s) => (s.applyFailures = 0));
      this.log('info', 'update.staged', { from: this.cfg.currentBuild, to: m.build, downgrade, ms: this.#now() - started });
      return true;
    } catch (err) {
      this.log('error', 'update.failed', { stage: 'stage', to: m.build, cause: shortCause(err) });
      return false;
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  async #download(url: string, file: string, size: number, sha256: string): Promise<void> {
    const res = await this.#fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': `ChatterED-Updater/${this.cfg.currentBuild}`, Accept: '*/*' },
      signal: AbortSignal.timeout(60 * 60_000),
    });
    if (!res.ok) throw new Error(`http_${res.status}`);
    const reader = res.body?.getReader();
    if (!reader) throw new Error('no_body');
    const hash = createHash('sha256');
    const fd = openSync(file, 'w', 0o600);
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > size) {
          await reader.cancel();
          throw new Error('too_large');
        }
        hash.update(value);
        writeSync(fd, value);
      }
    } finally {
      closeSync(fd);
    }
    if (total !== size) throw new Error('size_mismatch');
    if (hash.digest('hex') !== sha256) throw new Error('sha_mismatch');
  }

  /** Every check on the extracted bundle, before anything runs it. A string names what failed. */
  async #inspect(app: string, m: UpdateManifest): Promise<string | null> {
    if (plistValue(app, 'CFBundleIdentifier') !== this.cfg.appId) return 'bundle_id';
    if (buildNumber(plistValue(app, 'CFBundleVersion')) !== m.build) return 'plist_build';
    if (existsSync(join(app, 'Contents', 'Resources', 'study'))) return 'payload_has_study';
    try {
      await execFileP('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { timeout: 5 * 60_000 });
    } catch {
      return 'codesign';
    }
    if (m.cdhash && (await cdhashOf(app)) !== m.cdhash) return 'cdhash';
    return null;
  }

  /**
   * **Launch the staged build before it is ever swapped in**, with its own profile on a copy of
   * the real database, and require its explicit ok file: a bare exit 0 proves nothing (a second
   * instance exits 0 too). The new build's bootstrap does the work (`--chattered-smoke`): loads
   * the native modules, copies the database with `VACUUM INTO`, runs migrations on the copy, loads
   * the renderer in a hidden window, and writes the file.
   */
  async smoke(app: string, build: number, work: string): Promise<string> {
    const exe = join(app, 'Contents', 'MacOS', this.cfg.productName);
    if (!existsSync(exe)) return 'no_executable';
    const profile = join(work, 'smoke-profile');
    mkdirSync(profile, { recursive: true, mode: 0o700 });
    const okFile = join(work, 'smoke-ok.json');
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE' && !k.startsWith('CHATTERED_')) env[k] = v;
    }
    const args = [`--chattered-smoke=${okFile}`, `--user-data-dir=${profile}`];
    const db = join(this.cfg.userDataDir, 'app.db');
    if (existsSync(db)) args.push(`--chattered-smoke-db=${db}`);
    const timeout = (this.cfg.smokeTimeoutSeconds ?? 150) * 1000;
    const code = await new Promise<number | string>((resolve) => {
      const child = spawn(exe, args, { stdio: 'ignore', env });
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve('timeout');
      }, timeout);
      child.on('error', (err) => {
        clearTimeout(timer);
        resolve(`spawn:${err.message}`);
      });
      child.on('exit', (c, sig) => {
        clearTimeout(timer);
        resolve(c ?? `signal:${sig ?? '?'}`);
      });
    });
    let ok: { ok?: boolean; build?: number; stage?: string } = {};
    try {
      ok = JSON.parse(readFileSync(okFile, 'utf8')) as typeof ok;
    } catch {
      return `no_ok_file:${String(code)}`;
    }
    if (ok.ok !== true) return `not_ok:${ok.stage ?? '?'}`;
    if (ok.build !== build) return 'wrong_build';
    return code === 0 ? 'ok' : `exit:${String(code)}`;
  }
}

// ── small helpers, exported for the tests ───────────────────────────────────

export function shortCause(err: unknown): string {
  const m = err instanceof Error ? (err.name === 'TimeoutError' ? 'timeout' : err.message) : String(err);
  return m.replace(/\/Users\/[^/\s]+/g, '~').slice(0, 120);
}

function fileSize(p: string): number {
  try {
    return statSync(p).size;
  } catch {
    return 0;
  }
}

/** One Info.plist value with `plutil`, or null. */
export function plistValue(bundle: string, key: string): string | null {
  try {
    return execFileSync('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', join(bundle, 'Contents', 'Info.plist')], {
      encoding: 'utf8',
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

export async function cdhashOf(app: string): Promise<string | null> {
  try {
    const { stderr } = await execFileP('/usr/bin/codesign', ['-dv', '--verbose=4', app], { timeout: 60_000 });
    return /^CDHash=([0-9a-f]+)$/m.exec(stderr)?.[1] ?? null;
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? '';
    return /^CDHash=([0-9a-f]+)$/m.exec(stderr)?.[1] ?? null;
  }
}

/**
 * SQLite keeps `user_version` at byte 60 of the file header (big-endian). Read without opening
 * the database or loading a native module. A WAL not yet checkpointed can hold a newer value, so
 * this is a lower bound; null when there is no database.
 */
export function dbUserVersion(dbFile: string): number | null {
  let fd: number | null = null;
  try {
    fd = openSync(dbFile, 'r');
    const buf = Buffer.alloc(100);
    if (readSync(fd, buf, 0, 100, 0) < 64) return null;
    if (buf.subarray(0, 15).toString('latin1') !== 'SQLite format 3') return null;
    return buf.readUInt32BE(60);
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/**
 * The extraction must hold exactly one `ChatterED.app` and nothing else, and no symlink in it may
 * point outside it (Electron's framework has its own `Versions/Current` links, which stay inside).
 */
export function checkExtracted(dir: string, bundleName: string): string {
  const entries = readdirSync(dir);
  if (entries.length !== 1 || entries[0] !== bundleName) throw new Error('payload_layout');
  const app = join(dir, bundleName);
  if (!lstatSync(app).isDirectory()) throw new Error('payload_layout');
  const root = realpathSync(app);
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = lstatSync(p);
      if (st.isSymbolicLink()) {
        let real: string;
        try {
          real = realpathSync(p);
        } catch {
          throw new Error('payload_dangling_link');
        }
        if (real !== root && !real.startsWith(root + sep)) throw new Error('payload_link_escapes');
      } else if (st.isDirectory()) {
        walk(p);
      }
    }
  };
  walk(app);
  return app;
}
