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
  realTargetOf,
  recoverJournal,
  SWAP_SCRIPT,
  swapArgs,
  swapPaths,
  type BuildHealth,
  type LaunchRecord,
  type LocationKind,
  type SwapResult,
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

/** `state.json`: what checks learn (written by the worker, and by repair mode under the same lock). */
export interface UpdateState {
  rotation: { add: string[]; revoke: string[] };
  lastCheckAt: string | null;
  /** The last time staging was skipped for space: shown in the debug report until a stage succeeds. */
  spaceShort: { needMb: number; freeMb: number; build: number; at: string } | null;
  /** The highest manifest `seq` verified here: an older manifest is a replay and is refused. */
  maxSeq: number;
  /** Failed checks in a row (unreachable, download): sets the retry backoff (`worker.ts`). */
  failStreak: number;
}

/**
 * `launch.json`: the main process's bookkeeping, so a check can never overwrite a healthy mark,
 * a bad build or a swap attempt (review #12). Every field is checked on read; junk reads as empty.
 */
export interface LaunchState {
  launch: LaunchRecord | null;
  health: BuildHealth | null;
  lastLaunchedBuild: number | null;
  /** Builds that failed to start here and were rolled back from: never reinstalled. */
  badBuilds: number[];
  /** Builds the swap could not install here (App Management, or two failed tries): skipped until a newer one. */
  cannotApply: { build: number; cause: string; at: string }[];
  /** The swap being tried, counted before the helper is spawned, cleared by its `ok` result. */
  pending: { build: number; mode: 'apply' | 'rollback'; attempts: number } | null;
  /** What the last helper reported. */
  lastResult: { mode: 'apply' | 'rollback'; status: string; cause: string; to: number } | null;
  /** Launches in a row that exited before the app's code (a swap, a rollback, a running helper). */
  exitStreak: number;
  /** The build whose "could not update itself" dialog was shown. */
  manualNoticeShown: number | null;
  /** The build a rollback was given up for (its helper failed): not tried again. */
  cannotRollback: number | null;
  /** Every build that was healthy here once: a return to one of them (a rollback) is not on probation (D-7). */
  knownGood: number[];
  /** Builds whose payload failed verification or its smoke launch: never downloaded again (D-8). */
  rejected: { build: number; cause: string }[];
}

/** Launches in a row that may exit before the app's code; the next one always opens it. */
export const MAX_EXIT_STREAK = 2;
/** Tries of one swap (a build and a mode) before it is given up. */
export const MAX_SWAP_ATTEMPTS = 2;
/** A swap lock older than this is stale, whoever holds it. */
export const LOCK_MAX_AGE_MS = 10 * 60_000;

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

const int = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const ints = (v: unknown): number[] => (Array.isArray(v) ? v.filter(int) : []);

/** A small blocking sleep for the state lock (no event loop needed). */
function pause(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    /* no wait available: spin once */
  }
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
    // Timestamps without milliseconds: `…54.608Z` reads as a file name to the debug report's scrubber.
    return JSON.parse(JSON.stringify(this.#status()).replace(/(\d{2}:\d{2}:\d{2})\.\d{1,3}Z/g, '$1Z')) as Record<string, unknown>;
  }

  #status(): Record<string, unknown> {
    const read = (name: string): unknown => this.#readJson<Record<string, unknown>>(name);
    const lm = this.lastManifest();
    const where = this.location();
    const staged = this.readStaged();
    const state = this.readState();
    const ls = this.readLaunch();
    return {
      build: this.cfg.currentBuild,
      sha: this.cfg.sha,
      channel: this.cfg.channel,
      install_id: this.cfg.installId,
      // `self_update`, not `location`: the report's own `app.location` says where the bundle is.
      self_update: where === 'ok' ? 'yes' : `no: ${where}`,
      last_manifest: lm ? { seq: lm.seq, build: lm.build, targeted: lm.targeted, pin: lm.pin, paused: lm.paused } : lm === null ? 'does not verify' : null,
      bundle: this.cfg.bundlePath.replace(/^\/Users\/[^/]+/, '~'),
      staged: staged ? { build: staged.build, at: staged.stagedAt, downgrade: staged.downgrade } : null,
      previous_build: existsSync(this.previousApp) ? buildNumber(plistValue(this.previousApp, 'CFBundleVersion')) : null,
      bad_builds: ls.badBuilds,
      cannot_apply: ls.cannotApply,
      rejected: ls.rejected,
      known_good: ls.knownGood,
      fail_streak: state.failStreak,
      max_seq: state.maxSeq,
      cannot_rollback: ls.cannotRollback,
      pending_swap: ls.pending,
      last_swap_result: ls.lastResult,
      exit_streak: ls.exitStreak,
      last_check_at: state.lastCheckAt,
      keys_rotated: { added: state.rotation.add.length, revoked: state.rotation.revoke.length },
      launch: ls.launch,
      health: ls.health,
      journal_pending: existsSync(join(this.dir, 'swap-journal')),
      swap_lock: existsSync(join(this.dir, 'swap.lock')),
      free_mb: Math.round(this.freeBytes() / 1e6),
      // Below this, updates stop (statfs does not count APFS purgeable space): say so plainly.
      space_short: state.spaceShort,
      work_dirs: (() => {
        try {
          return readdirSync(this.dir).filter((n) => n.startsWith('work-')).length;
        } catch {
          return 0;
        }
      })(),
      last_events: { main: read('status-main.json'), worker: read('status-worker.json') },
    };
  }

  #ensureDir(): void {
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    } catch {
      /* a read-only home: every write below fails soft */
    }
  }

  #readJson<T>(name: string): Partial<T> | null {
    try {
      const v = JSON.parse(readFileSync(join(this.dir, name), 'utf8')) as Partial<T>;
      return v && typeof v === 'object' ? v : null;
    } catch {
      return null;
    }
  }

  #writeJson(name: string, value: unknown): boolean {
    try {
      this.#ensureDir();
      const tmp = join(this.dir, `${name}.${process.pid}.tmp`);
      writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
      renameSync(tmp, join(this.dir, name));
      return true;
    } catch (err) {
      this.log('warn', 'update.failed', { stage: 'state', cause: shortCause(err) });
      return false;
    }
  }

  readState(): UpdateState {
    const s = this.#readJson<UpdateState>('state.json') ?? {};
    const sp = s.spaceShort as UpdateState['spaceShort'] | undefined;
    return {
      rotation: {
        add: Array.isArray(s.rotation?.add) ? s.rotation.add.filter((k) => typeof k === 'string') : [],
        revoke: Array.isArray(s.rotation?.revoke) ? s.rotation.revoke.filter((k) => typeof k === 'string') : [],
      },
      lastCheckAt: typeof s.lastCheckAt === 'string' ? s.lastCheckAt : null,
      spaceShort: sp && int(sp.needMb) && int(sp.freeMb) && int(sp.build) ? sp : null,
      maxSeq: int(s.maxSeq) && s.maxSeq > 0 ? s.maxSeq : 0,
      failStreak: int(s.failStreak) && s.failStreak > 0 ? s.failStreak : 0,
    };
  }

  readLaunch(): LaunchState {
    const s = this.#readJson<LaunchState>('launch.json') ?? {};
    // Bad builds written by an older build into state.json still count.
    const legacy = ints((this.#readJson<{ badBuilds: unknown }>('state.json') ?? {}).badBuilds);
    const l = s.launch;
    const h = s.health;
    const p = s.pending;
    const r = s.lastResult;
    return {
      launch: l && int(l.build) ? { build: l.build, healthy: l.healthy === true, clean: l.clean === true } : null,
      health: h && int(h.build) ? { build: h.build, everHealthy: h.everHealthy === true, crashes: int(h.crashes) && h.crashes > 0 ? h.crashes : 0 } : null,
      lastLaunchedBuild: int(s.lastLaunchedBuild) ? s.lastLaunchedBuild : null,
      badBuilds: [...new Set([...ints(s.badBuilds), ...legacy])],
      cannotApply: Array.isArray(s.cannotApply)
        ? s.cannotApply.filter((c) => c && int(c.build)).map((c) => ({ build: c.build, cause: String(c.cause ?? '').slice(0, 40), at: String(c.at ?? '') }))
        : [],
      pending:
        p && int(p.build) && (p.mode === 'apply' || p.mode === 'rollback') && int(p.attempts) && p.attempts >= 0 ? { build: p.build, mode: p.mode, attempts: p.attempts } : null,
      lastResult:
        r && (r.mode === 'apply' || r.mode === 'rollback') ? { mode: r.mode, status: String(r.status), cause: String(r.cause ?? '').slice(0, 40), to: int(r.to) ? r.to : 0 } : null,
      exitStreak: int(s.exitStreak) && s.exitStreak > 0 ? s.exitStreak : 0,
      manualNoticeShown: int(s.manualNoticeShown) ? s.manualNoticeShown : null,
      cannotRollback: int(s.cannotRollback) ? s.cannotRollback : null,
      knownGood: ints(s.knownGood).slice(-50),
      rejected: Array.isArray(s.rejected) ? s.rejected.filter((r) => r && int(r.build)).map((r) => ({ build: r.build, cause: String(r.cause ?? '').slice(0, 60) })).slice(-50) : [],
    };
  }

  /**
   * Read-modify-write under a lock (`state.lock`, mkdir): the worker and main never lose each
   * other's writes (review #12). A lock older than 10 s is stale. Returns whether the write landed.
   */
  #locked(name: string, fn: () => unknown): boolean {
    const lock = join(this.dir, `${name}.lock`);
    let held = false;
    for (let i = 0; i < 100 && !held; i += 1) {
      try {
        mkdirSync(lock);
        held = true;
      } catch {
        try {
          if (Date.now() - statSync(lock).mtimeMs > 10_000) rmSync(lock, { recursive: true, force: true });
        } catch {
          /* gone */
        }
        pause(10);
      }
    }
    try {
      const value = fn();
      return this.#writeJson(name, value);
    } finally {
      if (held) rmSync(lock, { recursive: true, force: true });
    }
  }

  #patch(fn: (s: UpdateState) => void): boolean {
    return this.#locked('state.json', () => {
      const s = this.readState();
      fn(s);
      return s;
    });
  }

  #patchLaunch(fn: (s: LaunchState) => void): boolean {
    return this.#locked('launch.json', () => {
      const s = this.readLaunch();
      fn(s);
      return s;
    });
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
    // A staging the worker did not finish (a quit, a crash): up to ~1 GB and a copy of the
    // database each. No worker runs yet in this process, and the single-instance lock is held.
    this.#sweepWork();
    const helperAlive = this.#lockHolderAlive(paths.lock);
    const current = this.cfg.currentBuild;

    // 1. What the last helper did.
    if (!helperAlive && existsSync(paths.result)) {
      let text = '';
      try {
        text = readFileSync(paths.result, 'utf8');
      } catch {
        text = '';
      }
      rmSync(paths.result, { force: true });
      const r = parseSwapResult(text);
      if (r) this.#recordResult(r);
    }

    // 2. A swap the helper did not finish.
    if (!helperAlive && existsSync(paths.journal)) {
      let meta: { keepOld?: boolean; to?: number; target?: string } = {};
      try {
        meta = JSON.parse(readFileSync(`${paths.journal}.json`, 'utf8')) as typeof meta;
      } catch {
        /* without the metadata the old bundle is deleted, never kept as N-1 */
      }
      let journal = '';
      try {
        journal = readFileSync(paths.journal, 'utf8');
      } catch {
        journal = '';
      }
      let done: string = 'none';
      try {
        done = recoverJournal(
          journal,
          {
            exists: existsSync,
            rename: renameSync,
            remove: (p) => rmSync(p, { recursive: true, force: true }),
            buildOf: (p) => buildNumber(plistValue(p, 'CFBundleVersion')),
          },
          // The journal's own target: never whatever path this copy happens to run from (D-5).
          { target: journalTarget(meta?.target, this.cfg.bundlePath, this.cfg.productName), keep: this.previousApp, keepOld: meta?.keepOld === true, aside: paths.aside, near: paths.near, toBuild: Number(meta?.to) || 0 },
        );
      } catch (err) {
        done = `error:${shortCause(err)}`;
      }
      rmSync(paths.journal, { force: true });
      rmSync(`${paths.journal}.json`, { force: true });
      this.log('warn', 'update.journal_recovered', { result: done, to: Number(meta?.to) || 0 });
    }

    // 0. However the files read, the app opens after MAX_EXIT_STREAK launches that did not.
    let ls = this.readLaunch();
    if (ls.exitStreak >= MAX_EXIT_STREAK) {
      this.log('warn', 'update.exit_streak', { streak: ls.exitStreak, build: current });
      return this.#continue(ls, null);
    }

    // 3. A helper is still at work: it reopens the app when it is done.
    if (helperAlive) {
      if (this.#countExit()) {
        this.log('info', 'update.check', { result: 'swap_in_progress' });
        return { kind: 'exit', why: 'swap_in_progress' };
      }
      return this.#continue(this.readLaunch(), null);
    }

    // 4. A staged update: swap it in now, before the app's code loads.
    const staged = this.readStaged();
    if (staged) {
      ls = this.readLaunch();
      const cannot = ls.cannotApply.some((c) => c.build === staged.build);
      const superseded = !cannot && !this.#stillAllowed(staged.build);
      if (staged.build === current || (staged.build < current && !staged.downgrade) || ls.badBuilds.includes(staged.build) || cannot || superseded) {
        this.discardStaged(staged.build === current ? 'already_running' : cannot ? 'cannot_apply' : superseded ? 'superseded' : 'stale');
      } else if (this.location() === 'ok') {
        if (this.spawnSwap({ mode: 'apply', relaunch: 'front' })) return { kind: 'exit', why: 'applying' };
      }
    }

    // 5. Probation: a build that keeps failing to start goes back to the kept previous one,
    // unless a rollback to it already failed (it would fail again, at every launch).
    ls = this.readLaunch();
    const previousBuild = existsSync(this.previousApp) ? buildNumber(plistValue(this.previousApp, 'CFBundleVersion')) : null;
    const health = ls.health && ls.health.build === current ? ls.health : { build: current, everHealthy: ls.knownGood.includes(current), crashes: 0 };
    const step = probationStep(ls.launch, { ...health, everHealthy: health.everHealthy || ls.knownGood.includes(current) }, current, previousBuild);
    if (step.action === 'rollback' && this.location() === 'ok') {
      const failedBefore = ls.cannotRollback === current || (ls.lastResult?.mode === 'rollback' && ls.lastResult.status !== 'ok');
      if (failedBefore) {
        if (ls.cannotRollback !== current) {
          this.#patchLaunch((s) => (s.cannotRollback = current));
          this.log('error', 'update.gave_up', { mode: 'rollback', build: current, why: 'last_rollback_failed' });
        }
      } else {
        this.log('error', 'update.crash_loop', { build: current, crashes: step.health.crashes, to: previousBuild });
        this.#patchLaunch((s) => (s.health = step.health));
        if (this.rollback('crash_loop')) return { kind: 'exit', why: 'rolling_back' };
      }
    }

    // 6. Count this launch; say "Updated to build N" once.
    return this.#continue(this.readLaunch(), step.health);
  }

  /** The app opens: reset the exit streak, record the launch, and the note if this is a new build. */
  #continue(ls: LaunchState, health: BuildHealth | null): EarlyOutcome {
    const current = this.cfg.currentBuild;
    const note = ls.lastLaunchedBuild !== null && current > ls.lastLaunchedBuild ? { from: ls.lastLaunchedBuild, to: current } : null;
    this.#patchLaunch((s) => {
      if (health) s.health = health;
      else if (!s.health || s.health.build !== current) s.health = { build: current, everHealthy: s.knownGood.includes(current), crashes: 0 };
      s.launch = { build: current, healthy: false, clean: false };
      s.lastLaunchedBuild = current;
      s.exitStreak = 0;
    });
    return { kind: 'continue', note };
  }

  /**
   * Count a launch that exits before the app's code, and say whether it may: only if the count
   * landed on disk (a full or read-only disk must not turn into exiting forever).
   */
  #countExit(): boolean {
    const before = this.readLaunch().exitStreak;
    if (before >= MAX_EXIT_STREAK) return false;
    return this.#patchLaunch((s) => (s.exitStreak = before + 1)) && this.readLaunch().exitStreak === before + 1;
  }

  #recordResult(r: SwapResult): void {
    const fields = { from: r.from, to: r.to, mode: r.mode, at: r.at, via: r.via };
    if (r.status === 'ok') this.log('info', r.mode === 'rollback' ? 'update.rolled_back' : 'update.applied', fields);
    else this.log('warn', 'update.failed', { ...fields, stage: 'swap', cause: `${r.status}:${r.cause}` });
    this.#patchLaunch((s) => {
      s.lastResult = { mode: r.mode, status: r.status, cause: r.cause, to: r.to };
      if (r.status === 'ok') {
        if (s.pending && s.pending.mode === r.mode) s.pending = null;
        return;
      }
      if (r.mode === 'rollback') s.cannotRollback = this.cfg.currentBuild;
      // App Management will refuse again; two failures of one build will fail again (review #1).
      const tries = s.pending && s.pending.build === r.to && s.pending.mode === r.mode ? s.pending.attempts : 1;
      if (r.mode === 'apply' && (r.cause === 'app_management' || tries >= MAX_SWAP_ATTEMPTS) && !s.cannotApply.some((c) => c.build === r.to)) {
        s.cannotApply.push({ build: r.to, cause: r.cause || r.status, at: new Date(this.#now()).toISOString() });
        s.pending = null;
      }
    });
    if (r.mode === 'rollback' && r.status !== 'ok') this.log('error', 'update.gave_up', { mode: 'rollback', build: this.cfg.currentBuild, why: 'rollback_failed' });
    if (r.mode === 'apply' && this.readLaunch().cannotApply.some((c) => c.build === r.to)) this.discardStaged('cannot_apply');
    // The helper cleared its journal; its metadata goes too (E2E D-8).
    const paths = swapPaths({ target: this.cfg.bundlePath, updatesDir: this.dir });
    if (!existsSync(paths.journal)) rmSync(`${paths.journal}.json`, { force: true });
  }

  /**
   * Is `build` still what the newest verified manifest says to install? A rollback, pin, block or
   * pause published after the build was staged must win over it (review D-6). With no stored
   * manifest (a layout before seq), yes.
   */
  #stillAllowed(build: number): boolean {
    const m = this.lastManifest();
    if (m === undefined) return true;
    if (m === null) return false;
    const d = decide({
      manifest: m,
      appId: this.cfg.appId,
      channel: this.cfg.channel,
      currentBuild: this.cfg.currentBuild,
      osVersion: this.cfg.osVersion,
      dbUserVersion: dbUserVersion(join(this.cfg.userDataDir, 'app.db')),
      badBuilds: this.readLaunch().badBuilds,
    });
    return d.action === 'install' && m.build === build;
  }

  /** The newest verified manifest, re-verified from disk: undefined if none was stored, null if it no longer verifies. */
  lastManifest(): UpdateManifest | null | undefined {
    const file = join(this.dir, 'last-manifest.json');
    if (!existsSync(file)) return undefined;
    try {
      const v = verifyManifest(readFileSync(file), readFileSync(`${file}.sig`), trustedKeys(this.cfg.keys, this.readState().rotation), {
        allowHttp: this.cfg.allowHttp,
        installId: this.cfg.installId,
      });
      return v.ok ? v.manifest : null;
    } catch {
      return null;
    }
  }

  #storeManifest(bytes: Buffer, sig: Buffer, seq: number): void {
    try {
      const file = join(this.dir, 'last-manifest.json');
      writeFileSync(`${file}.tmp`, bytes, { mode: 0o600 });
      writeFileSync(`${file}.sig.tmp`, sig, { mode: 0o600 });
      renameSync(`${file}.sig.tmp`, `${file}.sig`);
      renameSync(`${file}.tmp`, file);
      this.#patch((s) => (s.maxSeq = Math.max(s.maxSeq, seq)));
    } catch (err) {
      this.log('warn', 'update.failed', { stage: 'store_manifest', cause: shortCause(err) });
    }
  }

  #sweepWork(): void {
    try {
      for (const name of readdirSync(this.dir)) {
        if (!name.startsWith('work-')) continue;
        rmSync(join(this.dir, name), { recursive: true, force: true });
        this.log('info', 'update.swept', { what: 'work' });
      }
    } catch {
      /* nothing to sweep */
    }
  }

  /** The build the participant should be told about once: the swap could not install it here. */
  manualInstallNotice(): { build: number; cause: string } | null {
    const ls = this.readLaunch();
    const last = ls.cannotApply[ls.cannotApply.length - 1];
    if (!last || ls.manualNoticeShown === last.build) return null;
    return { build: last.build, cause: last.cause };
  }

  markManualInstallNoticeShown(build: number): void {
    this.#patchLaunch((s) => (s.manualNoticeShown = build));
  }

  /** After the participant allowed App Management: try that build again. */
  forgetCannotApply(build: number): void {
    this.#patchLaunch((s) => {
      s.cannotApply = s.cannotApply.filter((c) => c.build !== build);
      if (s.pending?.build === build) s.pending = null;
    });
    this.log('info', 'update.retry_allowed', { build });
  }

  /**
   * Go back to the kept previous bundle (N-1) and never reinstall this build here. The caller must
   * exit. False when there is no previous bundle or this copy cannot replace itself.
   */
  rollback(why: string): boolean {
    if (!existsSync(this.previousApp) || this.location() !== 'ok') return false;
    const bad = this.cfg.currentBuild;
    this.#patchLaunch((s) => {
      if (!s.badBuilds.includes(bad)) s.badBuilds.push(bad);
      s.launch = null;
    });
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
      if (!s.knownGood.includes(this.cfg.currentBuild)) s.knownGood.push(this.cfg.currentBuild);
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

  /** This build was healthy here at least once: kept as N-1 when replaced, never on probation again. */
  everHealthy(): boolean {
    const ls = this.readLaunch();
    return ls.knownGood.includes(this.cfg.currentBuild) || (ls.health !== null && ls.health.build === this.cfg.currentBuild && ls.health.everHealthy);
  }

  hasPrevious(): boolean {
    return existsSync(this.previousApp);
  }

  // ── swap ──────────────────────────────────────────────────────────────────

  /**
   * A lock counts only if its PID is alive, is running `swap-helper.sh`, and the lock is younger
   * than ten minutes (review #3). Anything else (a reused PID, a hung or killed helper, junk) is
   * removed, so it can never keep the app closed.
   */
  #lockHolderAlive(lock: string): boolean {
    if (!existsSync(lock)) return false;
    let alive = false;
    try {
      const pidFile = join(lock, 'pid');
      const pid = Number(readFileSync(pidFile, 'utf8').trim());
      const fresh = Date.now() - statSync(pidFile).mtimeMs < LOCK_MAX_AGE_MS;
      if (Number.isInteger(pid) && pid > 1 && fresh) {
        process.kill(pid, 0);
        const command = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
        alive = command.includes('swap-helper.sh');
      }
    } catch {
      alive = false;
    }
    if (!alive) {
      try {
        rmSync(lock, { recursive: true, force: true });
        this.log('warn', 'update.stale_lock', {});
      } catch {
        /* read-only: it is ignored all the same */
      }
    }
    return alive;
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
      if (!this.#reserve(toBuild, o.mode)) return false;
      // Keep the build being replaced as N-1 only if it was healthy here; else the old N-1 stays.
      const keepOld = o.mode === 'apply' && this.everHealthy();
      // The swap tool is copied out of the bundle it is about to swap away.
      let swapTool: string | null = null;
      if (this.cfg.swapTool && existsSync(this.cfg.swapTool)) {
        // A new file, renamed into place: rewriting an executed binary in place can trip the
        // kernel's signature cache (review #14).
        swapTool = join(this.dir, 'chattered-swap');
        const tmpTool = `${swapTool}.${process.pid}.tmp`;
        writeFileSync(tmpTool, readFileSync(this.cfg.swapTool), { mode: 0o700 });
        renameSync(tmpTool, swapTool);
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
      writeFileSync(`${paths.journal}.json`, JSON.stringify({ keepOld, mode: o.mode, from: this.cfg.currentBuild, to: toBuild, target: this.cfg.bundlePath }), { mode: 0o600 });
      const script = join(this.dir, 'swap-helper.sh');
      const tmpScript = `${script}.${process.pid}.tmp`;
      writeFileSync(tmpScript, SWAP_SCRIPT, { mode: 0o700 });
      renameSync(tmpScript, script);
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

  /**
   * Count one try of this swap before the helper is spawned (review #2), and the exit it causes.
   * After MAX_SWAP_ATTEMPTS tries with no `ok`, give it up: an apply's build is recorded as one
   * this Mac cannot install, a rollback is not tried again. False when the count cannot be written.
   */
  #reserve(build: number, mode: 'apply' | 'rollback'): boolean {
    const ls = this.readLaunch();
    const tries = ls.pending && ls.pending.build === build && ls.pending.mode === mode ? ls.pending.attempts : 0;
    if (tries >= MAX_SWAP_ATTEMPTS) {
      this.log('error', 'update.gave_up', { mode, build, tries });
      this.#patchLaunch((s) => {
        s.pending = null;
        if (mode === 'apply' && !s.cannotApply.some((c) => c.build === build)) {
          s.cannotApply.push({ build, cause: s.lastResult?.to === build && s.lastResult.cause ? s.lastResult.cause : 'no_result', at: new Date(this.#now()).toISOString() });
        }
        if (mode === 'rollback') s.cannotRollback = this.cfg.currentBuild;
      });
      if (mode === 'apply') this.discardStaged('cannot_apply');
      return false;
    }
    if (ls.exitStreak >= MAX_EXIT_STREAK) return false;
    const wrote = this.#patchLaunch((s) => {
      s.pending = { build, mode, attempts: tries + 1 };
      s.exitStreak = ls.exitStreak + 1;
    });
    const back = this.readLaunch();
    return wrote && back.pending?.attempts === tries + 1 && back.exitStreak === ls.exitStreak + 1;
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
  async fetchManifest(): Promise<{ manifest: UpdateManifest; signer: TrustedKey; bytes: Buffer; sig: Buffer } | { error: string }> {
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
        if (v.ok) return { manifest: v.manifest, signer: v.signer, bytes, sig };
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
      this.#outcome('retry');
      return false;
    }
    this.#outcome('ok');
    const { manifest: m, signer } = got;
    const maxSeq = this.readState().maxSeq;
    if (m.seq < maxSeq) {
      this.log('warn', 'update.check', { reason, build: this.cfg.currentBuild, offered: m.build, result: 'stale_seq', seq: m.seq, max_seq: maxSeq });
      return false;
    }
    this.#storeManifest(got.bytes, got.sig, m.seq);
    // A staged build this manifest no longer offers (a rollback, pin, block or pause) goes now.
    const stagedNow = this.readStaged();
    if (stagedNow && !this.#stillAllowed(stagedNow.build)) this.discardStaged('superseded');
    if (m.keys.add.length || m.keys.revoke.length) {
      this.#patch((s) => {
        s.rotation = { add: [...new Set([...s.rotation.add, ...m.keys.add])], revoke: [...new Set([...s.rotation.revoke, ...m.keys.revoke])] };
      });
      this.log('warn', 'update.keys_rotated', { added: m.keys.add.length, revoked: m.keys.revoke.length });
    }
    const ls = this.readLaunch();
    const rejected = ls.rejected.find((r) => r.build === m.build);
    if (rejected) {
      this.log('info', 'update.check', { reason, build: this.cfg.currentBuild, offered: m.build, result: 'rejected', cause: rejected.cause });
      this.#outcome('ok');
      return false;
    }
    const cannot = ls.cannotApply.find((c) => c.build === m.build);
    if (cannot) {
      this.log('info', 'update.check', { reason, build: this.cfg.currentBuild, offered: m.build, result: 'cannot_apply', cause: cannot.cause });
      return false;
    }
    const d = decide({
      manifest: m,
      appId: this.cfg.appId,
      channel: this.cfg.channel,
      currentBuild: this.cfg.currentBuild,
      osVersion: this.cfg.osVersion,
      dbUserVersion: dbUserVersion(join(this.cfg.userDataDir, 'app.db')),
      badBuilds: ls.badBuilds,
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
    return this.#stage(m, d.downgrade, { bytes: got.bytes, sig: got.sig });
  }

  /** A payload that failed its checks or its smoke launch is never fetched again (a newer build is). */
  #reject(build: number, cause: string): void {
    this.#patchLaunch((s) => {
      if (!s.rejected.some((r) => r.build === build)) s.rejected.push({ build, cause: cause.slice(0, 60) });
    });
  }

  #outcome(kind: 'ok' | 'retry'): void {
    this.#patch((s) => (s.failStreak = kind === 'retry' ? s.failStreak + 1 : 0));
  }

  /**
   * When to check next (`worker.ts`): every ~4 h normally; after a failed check or download,
   * 15 min, then 30, 60, 120, capped at 4 h (review D-9).
   */
  nextCheckMs(base: number): number {
    const f = this.readState().failStreak;
    if (f <= 0) return base;
    return Math.min(base, 15 * 60_000 * 2 ** Math.min(f - 1, 8));
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

  /** The free space staging `m` needs: the zip, its extraction, a database copy, and 2 GB to spare. */
  spaceNeeded(size: number): number {
    return size * 5 + fileSize(join(this.cfg.userDataDir, 'app.db')) * 2 + 2 * 1024 * 1024 * 1024;
  }

  async #stage(m: UpdateManifest, downgrade: boolean, signed: { bytes: Buffer; sig: Buffer }): Promise<boolean> {
    // The zip, its extraction (about 3x the zip) and a copy of the database for the smoke launch,
    // with room left so the participant's own database is never the thing that runs out. A staged
    // build that this one replaces is reclaimed first; N-1 is not.
    const need = this.spaceNeeded(m.size);
    if (this.freeBytes() < need && this.readStaged()) this.discardStaged('space');
    if (this.freeBytes() < need) {
      const short = { needMb: Math.round(need / 1e6), freeMb: Math.round(this.freeBytes() / 1e6), build: m.build, at: new Date(this.#now()).toISOString() };
      this.#patch((s) => (s.spaceShort = short));
      this.log('warn', 'update.failed', { stage: 'space', to: m.build, need_mb: short.needMb, free_mb: short.freeMb });
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
        this.#outcome('retry');
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
        this.#reject(m.build, `verify:${problem}`);
        return false;
      }
      // The staged build checks its own updater against the manifest that brought it (review #6).
      const manifestFile = join(work, 'manifest.json');
      writeFileSync(manifestFile, signed.bytes, { mode: 0o600 });
      writeFileSync(`${manifestFile}.sig`, signed.sig, { mode: 0o600 });
      writeFileSync(join(work, 'rotation.json'), JSON.stringify(this.readState().rotation), { mode: 0o600 });
      const smoke = await this.smoke(app, m.build, work, manifestFile);
      if (smoke !== 'ok') {
        this.log('error', 'update.failed', { stage: 'smoke', to: m.build, cause: smoke });
        this.#reject(m.build, `smoke:${smoke}`);
        return false;
      }
      const stagedDir = join(this.dir, 'staged');
      rmSync(stagedDir, { recursive: true, force: true });
      mkdirSync(stagedDir, { mode: 0o700 });
      renameSync(app, this.stagedApp);
      const meta: Staged = { build: m.build, version: m.version, cdhash: m.cdhash, downgrade, stagedAt: new Date(this.#now()).toISOString() };
      writeFileSync(join(stagedDir, 'staged.json'), JSON.stringify(meta), { mode: 0o600 });
      this.#patch((s) => (s.spaceShort = null));
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
  async smoke(app: string, build: number, work: string, manifestFile?: string): Promise<string> {
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
    if (manifestFile) args.push(`--chattered-smoke-manifest=${manifestFile}`);
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

/** The bundle a journal recovers: its recorded target if that is a real one, else the app's own name beside this copy. */
export function journalTarget(recorded: unknown, running: string, productName: string): string {
  const ok = (p: unknown): p is string => typeof p === 'string' && p.startsWith('/') && p.endsWith(`/${productName}.app`);
  if (ok(recorded)) return recorded;
  return realTargetOf(running, productName) ?? `${running.slice(0, running.lastIndexOf('/'))}/${productName}.app`;
}

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
