/**
 * **The debug report's contents**, gathered in the main process from files, the OS and a
 * read-only connection of its own to `app.db`. Nothing here needs the renderer, the app's open
 * database connection or a booted `AppService`, so it works from the startup-failure dialog too
 * (`update/failure.ts` requires `debug/index.js` and calls `buildDebugReport()`).
 *
 * **Every section is its own try/catch.** A section that throws prints `error: <short cause>` and
 * the report carries on; so does a single line. A broken install is exactly when this runs.
 *
 * **What it never contains** (`report.test.ts` seeds each one and checks): an API key, the study
 * code or `preload.txt`'s contents, names, e-mail addresses, the learner's file or notebook names,
 * and any learner or model text. Paths are scrubbed with the research export's anonymiser
 * (`research/anonymise.ts`: the home folder becomes `~`, the username `<user>`), and the one free
 * text that ships, a log line's `cause`, is scrubbed, stripped of paths and file names, and cut to
 * 100 characters. The participant id (`P-…`) is left out on purpose: the study keeps it apart from
 * the slot, and this report names the slot.
 */
import { execFileSync } from 'node:child_process';
import { accessSync, constants as fsConstants, existsSync, readdirSync, readFileSync, statfsSync, statSync } from 'node:fs';
import { homedir, release, totalmem, userInfo } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { app } from 'electron';
import { makeScrubber, type Scrub } from '../research/anonymise.js';
import { scrub as scrubKeys, defaultLogDir } from '../log.js';
import { PROVIDER_KEY_FILES } from '../apikey.js';
import { STUDY_SETTINGS } from '../../shared/study.js';
import { CONSENT_VERSION, TRIAL_SETTINGS } from '../../shared/trial.js';
import { KEEP, renderReport, type ReportLine, type ReportSection } from './wire.js';

// ── the update section's provider ─────────────────────────────────────────────────────────

/**
 * Synchronous and quick (read a state file, no network): it runs when the participant presses the
 * key. Each key becomes a line; arrays are joined, objects written as compact JSON, and every value
 * is scrubbed like free text and cut to 140 characters.
 */
export type DebugSectionFn = () => Record<string, unknown>;

const registry = new Map<string, DebugSectionFn>();

/**
 * Add a section to every report from now on, e.g. the updater's
 * `registerDebugSection('update', () => engine.status())`. Keys become kebab-case; values are
 * scrubbed like any free text. Returns a function that removes it again.
 */
export function registerDebugSection(name: string, fn: DebugSectionFn): () => void {
  const key = kebab(name).slice(0, 24) || 'section';
  registry.set(key, fn);
  return () => {
    if (registry.get(key) === fn) registry.delete(key);
  };
}

// ── the environment, injectable for the tests ─────────────────────────────────────────────

/** The slice of a SQLite connection the report reads through. */
export interface MiniDb {
  get(sql: string, params?: Record<string, unknown>): Record<string, unknown> | undefined;
  all(sql: string, params?: Record<string, unknown>): Array<Record<string, unknown>>;
  close(): void;
}

export interface DebugEnv {
  now: Date;
  userDataDir: string;
  logDir: string;
  home: string;
  username: string;
  version: string;
  packaged: boolean;
  /** `app.getPath('exe')`: `<bundle>.app/Contents/MacOS/ChatterED`. */
  exePath: string;
  resourcesPath: string;
  appPath: string;
  locale: string;
  timeZone: string;
  arch: string;
  versions: { electron?: string; chrome?: string; node?: string };
  macosVersion: string;
  darwin: string;
  totalMem: number;
  /** `/Applications/ChatterED.app`: the copy an update replaces. */
  applicationsBundle: string;
  /** The study key bundle may be in Resources (older builds) or userData (with the updater). */
  studyBundlePaths: string[];
  /** `dist/main/update/baked.json`: the build number and commit a release bakes in. */
  bakedPath: string;
  /** A database larger than this is not quick-checked (it would take more than about a second). */
  quickCheckMaxBytes: number;
  run(cmd: string, args: string[]): string;
  openDb(path: string): MiniDb;
  sections: ReadonlyMap<string, DebugSectionFn>;
  /** Set by the startup-failure dialog: why the app did not start. */
  bootError?: unknown;
}

function tryOr<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/**
 * A read-only connection on better-sqlite3, opened and closed per report. `readonly` first; if
 * SQLite refuses that (a WAL database with no `-shm` yet), an ordinary connection with
 * `query_only`, which still cannot write.
 */
export function sqliteOpener(specifier = 'better-sqlite3'): (path: string) => MiniDb {
  return (path) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Ctor = require(specifier) as new (f: string, o: Record<string, unknown>) => {
      prepare(sql: string): { get(p?: unknown): unknown; all(p?: unknown): unknown[] };
      pragma(s: string): unknown;
      close(): void;
    };
    let db;
    try {
      db = new Ctor(path, { readonly: true, fileMustExist: true, timeout: 300 });
      db.prepare('SELECT 1').get();
    } catch {
      db = new Ctor(path, { fileMustExist: true, timeout: 300 });
      db.pragma('query_only = ON');
    }
    const conn = db;
    return {
      get: (sql, params) => (params ? conn.prepare(sql).get(params) : conn.prepare(sql).get()) as Record<string, unknown> | undefined,
      all: (sql, params) => (params ? conn.prepare(sql).all(params) : conn.prepare(sql).all()) as Array<Record<string, unknown>>,
      close: () => conn.close(),
    };
  };
}

export function defaultEnv(): DebugEnv {
  // Outside Electron (a unit test that forgot to pass paths) there is no userData and no log
  // folder: the sections say so, and nothing is read from or written to the real ones.
  const p = (name: Parameters<typeof app.getPath>[0]) => tryOr(() => app.getPath(name), '');
  const home = tryOr(() => homedir(), '');
  const userDataDir = p('userData');
  const resourcesPath = tryOr(() => process.resourcesPath ?? '', '');
  return {
    now: new Date(),
    userDataDir,
    logDir: p('logs') || (tryOr(() => typeof app.getPath === 'function', false) ? defaultLogDir() : ''),
    home,
    username: tryOr(() => userInfo().username, basename(home)),
    version: tryOr(() => app.getVersion(), 'unknown'),
    packaged: tryOr(() => app.isPackaged === true, false),
    exePath: p('exe') || process.execPath,
    resourcesPath,
    appPath: tryOr(() => app.getAppPath(), ''),
    locale: tryOr(() => app.getSystemLocale?.() || app.getLocale(), Intl.DateTimeFormat().resolvedOptions().locale),
    timeZone: tryOr(() => Intl.DateTimeFormat().resolvedOptions().timeZone, 'unknown'),
    arch: process.arch,
    versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
    macosVersion: tryOr(() => (process as unknown as { getSystemVersion?: () => string }).getSystemVersion?.() ?? '', ''),
    darwin: tryOr(() => release(), ''),
    totalMem: tryOr(() => totalmem(), 0),
    applicationsBundle: '/Applications/ChatterED.app',
    studyBundlePaths: [
      join(resourcesPath, 'study', 'keys.json'),
      join(userDataDir, 'study', 'keys.json'),
      // `npm run dev` reads `app/study/keys.json` (`study/ipc.ts` `resolveBundlePath`).
      ...tryOr(() => (app.isPackaged ? [] : [join(app.getAppPath(), 'study', 'keys.json')]), [] as string[]),
    ],
    bakedPath: join(__dirname, '..', 'update', 'baked.json'),
    quickCheckMaxBytes: 256 * 1024 * 1024,
    run: (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(),
    openDb: sqliteOpener(),
    sections: registry,
  };
}

// ── scrubbing ─────────────────────────────────────────────────────────────────────────────

const STUDY_CODE = /\b[A-Z0-9]{3}(?:-[A-Z0-9]{4}){3}\b/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const QUOTED_FILE = /(["'\u2018\u201C])[^"'\u2019\u201D]{0,200}\.[A-Za-z0-9]{1,5}\1?["'\u2019\u201D]/g;
const FILE_NAME = /[^\s/\\"'():,]+\.(?:pdf|pptx?|key|docx?|pages|txt|md|rtf|png|jpe?g|heic|gif|csv|xlsx?|numbers|zip|tex|ipynb)\b/gi;
const PATH = /(?:~|\/Users|\/Volumes|\/private|\/var|\/tmp|\/Applications)\/[^\s"'),;]*/g;

export interface Cleaners {
  /** For a path the report shows on purpose (the app bundle): home and username out, keys out. */
  path: (s: string) => string;
  /** For free text from a log or a provider: also no paths, no file names, no study codes. */
  text: (s: string, max?: number) => string;
}

export function cleaners(env: Pick<DebugEnv, 'home' | 'username'>): Cleaners {
  const anon: Scrub = makeScrubber({ home: env.home, username: env.username });
  // Codes and addresses first: the username pass would otherwise turn `jdoe@…` into `<user>@…`,
  // which no longer looks like an address.
  const base = (s: string) => anon(scrubKeys(s.replace(STUDY_CODE, '[study-code]').replace(EMAIL, '[redacted-email]')));
  return {
    path: (s) => base(s),
    text: (s, max = 100) => {
      const t = base(s)
        .replace(QUOTED_FILE, '<file>')
        .replace(PATH, '<path>')
        .replace(FILE_NAME, '<file>')
        .replace(/\s+/g, ' ')
        .trim();
      return t.length > max ? `${t.slice(0, max - 1)}…` : t;
    },
  };
}

/** The last guard over the finished text: things that are never in a report, wherever they came from. */
function finalScrub(text: string, env: Pick<DebugEnv, 'home'>): string {
  let out = scrubKeys(text.replace(STUDY_CODE, '[study-code]').replace(EMAIL, '[redacted-email]'));
  const home = env.home.replace(/\/+$/, '');
  if (home.length > 1) out = out.split(home).join('~');
  return out;
}

// ── helpers ───────────────────────────────────────────────────────────────────────────────

function kebab(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function shortCause(err: unknown): string {
  const raw = err instanceof Error ? `${err.name !== 'Error' ? `${err.name}: ` : ''}${err.message}` : String(err);
  return raw.split('\n')[0] ?? raw;
}

function bytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '?';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} KB`;
  return `${n} B`;
}

function yn(b: boolean): string {
  return b ? 'yes' : 'no';
}

function writable(path: string): boolean {
  try {
    accessSync(path, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** `2026-11-18T15:20:05Z | SGT 2026-11-18 23:20`. */
export function generatedLine(now: Date): string {
  const utc = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const sgt = new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');
  return `${utc} | SGT ${sgt}`;
}

/** `<bundle>.app` from `<bundle>.app/Contents/MacOS/<exe>`, or null outside a bundle. */
export function bundleOf(exePath: string): string | null {
  const m = /^(.*?\.app)\/Contents\/MacOS\/[^/]+$/.exec(exePath);
  return m ? m[1]! : null;
}

export type BundleLocation = 'applications' | 'user-applications' | 'dmg' | 'translocated' | 'dev' | 'other';

export function classifyBundle(bundle: string | null, packaged: boolean, home: string): BundleLocation {
  if (!packaged) return 'dev';
  if (!bundle) return 'other';
  if (bundle.startsWith('/Volumes/')) return 'dmg';
  if (bundle.includes('/AppTranslocation/')) return 'translocated';
  if (bundle.startsWith('/Applications/')) return 'applications';
  if (home && bundle.startsWith(`${home.replace(/\/+$/, '')}/Applications/`)) return 'user-applications';
  return 'other';
}

/** CFBundleVersion from `Contents/Info.plist`: an XML plist by regex, a binary one by `plutil`. */
function bundleVersion(env: DebugEnv, bundle: string): string {
  const plist = join(bundle, 'Contents', 'Info.plist');
  const text = readFileSync(plist, 'utf8');
  const m = /<key>CFBundleVersion<\/key>\s*<string>([^<]*)<\/string>/.exec(text);
  if (m) return m[1]!.trim();
  return env.run('/usr/bin/plutil', ['-extract', 'CFBundleVersion', 'raw', '-o', '-', plist]);
}

// ── the sections ──────────────────────────────────────────────────────────────────────────

type Add = (key: string, value: () => string, prio?: number) => void;

/** A section whose lines each fail on their own; the whole section failing prints one `error:`. */
function section(name: string, group: string, fill: (add: Add) => void, defaultPrio = 60): ReportSection {
  const lines: ReportLine[] = [];
  const add: Add = (key, value, prio = defaultPrio) => {
    let text: string;
    try {
      text = `${key}: ${value()}`;
    } catch (err) {
      text = `${key}: error: ${shortCause(err).slice(0, 80)}`;
    }
    lines.push({ text, prio, group });
  };
  try {
    fill(add);
  } catch (err) {
    lines.push({ text: `error: ${shortCause(err).slice(0, 100)}`, prio: 90, group });
  }
  return { name, lines };
}

function appSection(env: DebugEnv, c: Cleaners): ReportSection {
  return section('app', 'app', (add) => {
    const bundle = bundleOf(env.exePath);
    const baked = tryOr(() => JSON.parse(readFileSync(env.bakedPath, 'utf8')) as { build?: unknown; sha?: unknown; channel?: unknown }, null);
    add('version', () => env.version, KEEP);
    add('build', () => (bundle ? c.path(bundleVersion(env, bundle)) : 'no bundle'), KEEP);
    add(
      'sha',
      () => {
        const sha = typeof baked?.sha === 'string' && /^[0-9a-f]{7,40}$/.test(baked.sha) ? baked.sha.slice(0, 12) : 'unknown';
        const channel = typeof baked?.channel === 'string' && /^[a-z0-9-]{1,32}$/.test(baked.channel) ? ` channel ${baked.channel}` : '';
        return `${sha}${channel}`;
      },
      70,
    );
    add('bundle', () => (bundle ? c.path(bundle) : c.path(env.exePath)), 60);
    add('location', () => classifyBundle(bundle, env.packaged, env.home), KEEP);
    add('packaged', () => yn(env.packaged), 70);
    add('arch', () => env.arch, 50);
    add('runtime', () => `electron ${env.versions.electron ?? '?'}, chrome ${env.versions.chrome ?? '?'}, node ${env.versions.node ?? '?'}`, 20);
  });
}

function macSection(env: DebugEnv): ReportSection {
  return section('mac', 'mac', (add) => {
    add('macos', () => `${env.macosVersion || '?'} (darwin ${env.darwin || '?'})`, 90);
    add('model', () => env.run('/usr/sbin/sysctl', ['-n', 'hw.model']).replace(/[^A-Za-z0-9,._-]/g, '').slice(0, 32), 50);
    add('ram', () => `${Math.round(env.totalMem / 2 ** 30)} GB`, 40);
    add(
      'disk-free',
      () => {
        const s = statfsSync(existsSync(env.userDataDir) ? env.userDataDir : env.home || '/');
        return bytes(Number(s.bavail) * Number(s.bsize));
      },
      90,
    );
    add('locale', () => `${env.locale.replace(/[^A-Za-z0-9_-]/g, '')}, tz ${env.timeZone.replace(/[^A-Za-z0-9/_+-]/g, '')}`, 25);
    add('admin', () => yn(/(^|\s)admin(\s|$)/.test(env.run('/usr/bin/id', ['-Gn']))), 90);
    add(
      'apps-writable',
      () => {
        const folder = `Applications folder ${writable(dirname(env.applicationsBundle)) ? 'writable' : 'read-only'}`;
        if (!existsSync(env.applicationsBundle)) return `no app in Applications; ${folder}`;
        const app = writable(env.applicationsBundle) && writable(join(env.applicationsBundle, 'Contents'));
        return `app in Applications ${app ? 'writable' : 'read-only'}; ${folder}`;
      },
      90,
    );
  });
}

/** `<userData>/install-id`: one implementation, the updater's (the bootstrap reads it without app imports). */
export { INSTALL_ID_FILE, ensureInstallIdDetailed as ensureInstallId } from '../update/installid.js';
import { ensureInstallIdDetailed as ensureInstallId } from '../update/installid.js';

interface DbHandle {
  db: MiniDb | null;
  error: string | null;
  path: string;
}

function settingsOf(h: DbHandle, keys: readonly string[]): Map<string, { value: string; at: string }> {
  if (!h.db) throw new Error(h.error ?? 'no database');
  const names = keys.map((_, i) => `@k${i}`).join(', ');
  const params = Object.fromEntries(keys.map((k, i) => [`k${i}`, k]));
  const rows = h.db.all(`SELECT key, value, updated_at FROM settings WHERE key IN (${names})`, params);
  return new Map(rows.map((r) => [String(r.key), { value: String(r.value ?? ''), at: String(r.updated_at ?? '') }]));
}

function installSection(env: DebugEnv, h: DbHandle): ReportSection {
  return section('install', 'install', (add) => {
    add(
      'id',
      () => {
        const { id, note } = ensureInstallId(env.userDataDir);
        return id ?? `none (${note ?? 'unknown'})`;
      },
      KEEP,
    );
    add(
      'first-run',
      () => {
        const created = tryOr(() => statSync(h.path).birthtime.toISOString().slice(0, 10), '?');
        const done = tryOr(() => settingsOf(h, ['first_run_complete']).get('first_run_complete')?.at.slice(0, 10) ?? 'not done', '?');
        return `${done} (db ${created})`;
      },
      70,
    );
    add(
      'consent',
      () => {
        const v = settingsOf(h, [TRIAL_SETTINGS.consentVersion]).get(TRIAL_SETTINGS.consentVersion)?.value;
        return `${v && /^\d+$/.test(v) ? `v${v}` : 'none'} (this build v${CONSENT_VERSION})`;
      },
      70,
    );
  });
}

const BACKEND_KEYS = {
  backend: 'llm_backend',
  preferred: 'llm_preferred_provider',
  cliAgent: 'cli_model_agents',
  cliOrch: 'cli_model_orchestrator',
  detection: 'claude_cli_detection',
} as const;

/** A model id or a backend name: short, and nothing that is not an identifier. */
function ident(s: string | undefined): string {
  const t = (s ?? '').trim();
  return /^[A-Za-z0-9._:@/-]{1,64}$/.test(t) ? t : t ? 'set' : 'default';
}

function studySection(env: DebugEnv, h: DbHandle): ReportSection {
  return section('study', 'study', (add) => {
    const providers = Object.keys(PROVIDER_KEY_FILES);
    const keys = [
      ...Object.values(STUDY_SETTINGS),
      ...Object.values(BACKEND_KEYS),
      ...providers.flatMap((p) => [`api_model_agent_${p}`, `api_model_orchestrator_${p}`]),
    ];
    const s = h.db ? tryOr(() => settingsOf(h, keys), null) : null;
    const v = (k: string) => s?.get(k)?.value ?? '';
    const slot = v(STUDY_SETTINGS.slot);
    add('slot', () => (s === null ? `error: ${h.error ?? 'settings unreadable'}` : slot ? `S${slot.replace(/^S/i, '').replace(/[^0-9]/g, '').padStart(2, '0')}` : 'none'), KEEP);
    if (slot) {
      const budget = Number(v(STUDY_SETTINGS.budgetUsd)) || 0;
      let spent = 0;
      add(
        'spent',
        () => {
          const from = v(STUDY_SETTINGS.unlockedAt);
          const until = v(STUDY_SETTINGS.endedAt) || null;
          const row = from
            ? h.db!.get(
                `SELECT COALESCE(SUM(estimated_cost_usd), 0) AS usd FROM llm_usage
                  WHERE backend = 'anthropic' AND created_at >= @from AND (@until IS NULL OR created_at < @until)`,
                { from, until },
              )
            : undefined;
          spent = Number(row?.usd ?? 0);
          return `$${spent.toFixed(2)} of $${budget.toFixed(2)}`;
        },
        85,
      );
      add('cap-hit', () => {
        const server = Boolean(v(STUDY_SETTINGS.serverCappedAt));
        const local = budget > 0 && spent >= budget;
        return server ? 'yes (Anthropic refused)' : local ? 'yes (local count)' : 'no';
      }, 90);
      add('study-key', () => {
        const reason = v(STUDY_SETTINGS.endedReason);
        return reason ? `ended ${ident(reason)} ${v(STUDY_SETTINGS.endedAt).slice(0, 10)}` : 'active';
      }, 70);
    }
    add('bundle', () => {
      const where = env.studyBundlePaths.filter((p) => p && existsSync(p)).map((p) => (p.startsWith(env.userDataDir) ? 'userData' : 'resources'));
      // Only whether the preloaded code is there, never what it says.
      const preload = env.studyBundlePaths.some((p) => p && existsSync(join(dirname(p), 'preload.txt')));
      return `${where.length ? `present (${where.join(', ')})` : 'absent'}, preload ${preload ? 'present' : 'absent'}`;
    }, 60);
    add('key-files', () => providers.filter((p) => existsSync(join(env.userDataDir, PROVIDER_KEY_FILES[p as keyof typeof PROVIDER_KEY_FILES]))).join(', ') || 'none', 80);
    add('backend', () => {
      if (s === null) throw new Error(h.error ?? 'settings unreadable');
      const choice = ident(v(BACKEND_KEYS.backend) || 'auto');
      const pref = v(BACKEND_KEYS.preferred);
      return `${choice}${pref ? `, preferred ${ident(pref)}` : ''}`;
    }, 90);
    add('models', () => {
      if (s === null) throw new Error(h.error ?? 'settings unreadable');
      const choice = v(BACKEND_KEYS.backend) || 'auto';
      const parts: string[] = [];
      if (choice === 'auto' || choice === 'claude_cli') parts.push(`cli ${ident(v(BACKEND_KEYS.cliAgent))}/${ident(v(BACKEND_KEYS.cliOrch))}`);
      const ps = choice === 'auto' ? providers.filter((p) => v(`api_model_agent_${p}`) || p === v(BACKEND_KEYS.preferred)) : providers.filter((p) => p === choice);
      for (const p of ps) parts.push(`${p} ${ident(v(`api_model_agent_${p}`))}/${ident(v(`api_model_orchestrator_${p}`))}`);
      return parts.join('; ') || 'none';
    }, 60);
    add('cli', () => {
      const raw = v(BACKEND_KEYS.detection);
      if (!raw) return 'not checked';
      const d = JSON.parse(raw) as { found?: boolean; loggedIn?: boolean; version?: unknown };
      const ver = typeof d.version === 'string' ? ` ${ident(d.version)}` : '';
      return d.found ? `found${ver}${d.loggedIn ? ', logged in' : ', not logged in'}` : 'not found';
    }, 35);
  });
}

function hasTable(db: MiniDb, name: string): boolean {
  return db.get(`SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = @n`, { n: name }) !== undefined;
}

function byStatus(db: MiniDb, sql: string, statuses: readonly string[]): string {
  const rows = db.all(sql);
  const n = new Map(rows.map((r) => [String(r.s), Number(r.n)]));
  const known = statuses.map((s) => `${s} ${n.get(s) ?? 0}`);
  const other = [...n].filter(([s]) => !statuses.includes(s)).reduce((a, [, k]) => a + k, 0);
  return [...known, ...(other ? [`other ${other}`] : [])].join(', ');
}

function dataSection(env: DebugEnv, h: DbHandle): ReportSection {
  return section('data', 'data', (add) => {
    add('db-size', () => {
      const main = statSync(h.path).size;
      const wal = tryOr(() => statSync(`${h.path}-wal`).size, 0);
      return `${bytes(main)}${wal ? ` + wal ${bytes(wal)}` : ''}`;
    }, 60);
    if (!h.db) {
      add('schema', () => `error: ${h.error ?? 'no database'}`, 90);
      return;
    }
    const db = h.db;
    add('schema', () => String(Number(db.get('PRAGMA user_version')?.user_version ?? 0)), 90);
    add('quick-check', () => {
      const size = statSync(h.path).size;
      if (size > env.quickCheckMaxBytes) return `skipped (${bytes(size)} is over ${bytes(env.quickCheckMaxBytes)})`;
      const t0 = Date.now();
      const rows = db.all('PRAGMA quick_check(3)');
      const ms = Date.now() - t0;
      const vals = rows.map((r) => String(Object.values(r)[0] ?? ''));
      return vals.length === 1 && vals[0] === 'ok' ? `ok (${ms} ms)` : `FAILED ${vals.length} (${ms} ms): ${vals[0]?.replace(/[^A-Za-z0-9 _.:-]/g, '').slice(0, 60) ?? ''}`;
    }, 90);
    add('notebooks', () => String(Number(db.get('SELECT COUNT(*) AS n FROM notebooks')?.n ?? 0)), 50);
    add('sources', () => byStatus(db, 'SELECT status AS s, COUNT(*) AS n FROM notebook_sources GROUP BY status', ['ready', 'reading', 'failed']), 70);
    const docs = (tut: boolean) =>
      byStatus(
        db,
        `SELECT CASE WHEN ingest_status = 'streaming' THEN 'pending' ELSE ingest_status END AS s, COUNT(*) AS n
           FROM notes_docs WHERE content_sha ${tut ? '' : 'NOT '}LIKE 'nb:%:tut:%' GROUP BY 1`,
        ['ready', 'pending', 'failed'],
      );
    add('notes', () => docs(false), 45);
    add('tutorials', () => {
      if (!hasTable(db, 'tutorial_parts')) return 'none (no tutorial table)';
      return docs(true);
    }, 70);
    add('backup', () => {
      const dir = join(env.userDataDir, 'backups');
      if (!existsSync(dir)) return 'none';
      const newest = readdirSync(dir)
        .filter((f) => f.endsWith('.db'))
        .map((f) => statSync(join(dir, f)).mtimeMs)
        .sort((a, b) => b - a)[0];
      return newest ? new Date(newest).toISOString().slice(0, 16).replace('T', ' ') + 'Z' : 'none';
    }, 40);
  });
}

function registeredSections(env: DebugEnv, c: Cleaners): ReportSection[] {
  const out: ReportSection[] = [];
  if (!env.sections.has('update')) {
    out.push({ name: 'update', lines: [{ text: 'update: not available in this build', prio: KEEP, group: 'update' }] });
  }
  for (const [name, fn] of env.sections) {
    out.push(
      section(name, name, (add) => {
        const values = fn();
        for (const [k, raw] of Object.entries(values ?? {})) {
          const key = kebab(k).slice(0, 32) || 'value';
          add(key, () => {
            const value =
              raw === null || raw === undefined
                ? '-'
                : Array.isArray(raw)
                  ? raw.length === 0
                    ? 'none'
                    : raw.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ')
                  : typeof raw === 'object'
                    ? JSON.stringify(raw)
                    : typeof raw === 'boolean'
                      ? yn(raw)
                      : String(raw);
            return c.text(value, 140);
          }, 85);
        }
      }),
    );
  }
  return out;
}

// ── the log ───────────────────────────────────────────────────────────────────────────────

const LINE_HEAD = /^\{"ts":"([^"]+)","level":"(\w+)","event":"([^"]+)"/;
export const COUNTED = ['app.start', 'tutorial.ingest', 'tutorial.ingest.failed', 'llm.error'] as const;
const CRASHES = new Set(['renderer.gone', 'renderer.gave_up', 'process.uncaught', 'child.gone', 'boot.failed']);
export const RECENT_PROBLEMS = 20;

/** Rotated logs, newest first: `main.log`, `main.1.log` … `main.4.log`. */
function logFiles(dir: string): string[] {
  if (!dir || !existsSync(dir)) throw new Error('no log folder');
  const names = tryOr(() => readdirSync(dir), [] as string[]).filter((f) => /^main(\.\d+)?\.log$/.test(f));
  const rank = (f: string) => Number(/^main\.(\d+)\.log$/.exec(f)?.[1] ?? 0);
  return names.sort((a, b) => rank(a) - rank(b)).map((f) => join(dir, f));
}

const SAFE_FIELDS: Array<[string, RegExp]> = [
  ['class', /^[A-Za-z][A-Za-z0-9]{0,40}$/],
  ['scope', /^[a-z][a-z0-9._-]{0,40}$/],
  ['channel', /^[a-z]+:[A-Za-z]{1,40}$/],
  ['reason', /^[a-z][a-z0-9_-]{0,40}$/],
  ['code', /^-?\d{1,6}$|^[A-Z][A-Z0-9_]{1,30}$/],
  ['status', /^\d{3}$/],
  ['exit_code', /^-?\d{1,6}$/],
];

/** One problem line: `MM-DD HH:MMZ level event [fields] cause`. Only the fields above, and the cause scrubbed. */
function problemLine(obj: Record<string, unknown>, c: Cleaners): string {
  const ts = String(obj.ts ?? '');
  const when = /^\d{4}-(\d\d-\d\d)T(\d\d:\d\d)/.exec(ts);
  const parts = [when ? `${when[1]} ${when[2]}Z` : '??-?? ??:??Z', String(obj.level), String(obj.event)];
  for (const [k, re] of SAFE_FIELDS) {
    const v = obj[k];
    if ((typeof v === 'string' || typeof v === 'number') && re.test(String(v))) parts.push(k === 'class' || k === 'scope' || k === 'channel' ? String(v) : `${k.replace('_', '-')} ${v}`);
  }
  if (obj.too_long) parts.push('too-long');
  if (typeof obj.cause === 'string' && obj.cause) parts.push(c.text(obj.cause, 100));
  return parts.join(' ');
}

function problemsSection(env: DebugEnv, c: Cleaners): ReportSection {
  const lines: ReportLine[] = [];
  try {
    const since = env.now.getTime() - 7 * 24 * 3600_000;
    const counts = new Map<string, number>([...COUNTED, 'llm.cut', 'crash'].map((k) => [k, 0]));
    const recent: Record<string, unknown>[] = []; // newest first
    for (const file of logFiles(env.logDir)) {
      if (recent.length >= RECENT_PROBLEMS && tryOr(() => statSync(file).mtimeMs, 0) < since) break;
      const text = tryOr(() => readFileSync(file, 'utf8'), '');
      const rows = text.split('\n');
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        const row = rows[i]!;
        const m = LINE_HEAD.exec(row);
        if (!m) continue;
        const [, ts, level, event] = m;
        const t = Date.parse(ts!);
        if (t >= since) {
          if (counts.has(event!)) counts.set(event!, counts.get(event!)! + 1);
          if (event === 'llm.complete' && row.includes('"truncated":true')) counts.set('llm.cut', counts.get('llm.cut')! + 1);
          if (CRASHES.has(event!)) counts.set('crash', counts.get('crash')! + 1);
        }
        if ((level === 'error' || level === 'warn') && recent.length < RECENT_PROBLEMS) {
          const obj = tryOr(() => JSON.parse(row) as Record<string, unknown>, null);
          if (obj) recent.push(obj);
        }
      }
    }
    lines.push({ text: `7d: ${[...counts].map(([k, n]) => `${k} ${n}`).join(', ')}`, prio: 95, group: 'problems' });
    if (recent.length === 0) lines.push({ text: 'recent: none', prio: 60, group: 'problems' });
    // Oldest first on the page, so the newest is last and the oldest is dropped first.
    recent.reverse().forEach((obj, i) => {
      const age = recent.length - 1 - i; // 0 = newest
      lines.push({ text: `- ${problemLine(obj, c)}`, prio: age < 5 ? 65 : 10, group: 'problems' });
    });
  } catch (err) {
    lines.push({ text: `error: ${shortCause(err).slice(0, 100)}`, prio: 90, group: 'problems' });
  }
  return { name: 'problems', lines };
}

// ── the report ────────────────────────────────────────────────────────────────────────────

export interface BuildOptions extends Partial<DebugEnv> {
  bootError?: unknown;
}

/**
 * **The report, as one string of at most `DEBUG_MAX_CHARS`.** Never throws: the worst case is a
 * header, a line per failed section, and the sum.
 */
export function buildDebugReport(opts: BuildOptions = {}): string {
  // `defaultEnv` reads every value through `tryOr`, so it cannot throw.
  const given = Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined)) as Partial<DebugEnv>;
  const env: DebugEnv = { ...defaultEnv(), ...given };
  const c = cleaners(env);
  const dbPath = env.userDataDir ? join(env.userDataDir, 'app.db') : '';
  const h: DbHandle = { db: null, error: null, path: dbPath };
  try {
    if (!dbPath) throw new Error('no userData');
    if (!existsSync(dbPath)) throw new Error('no app.db yet');
    h.db = env.openDb(dbPath);
  } catch (err) {
    h.error = c.text(shortCause(err), 80);
  }
  try {
    const sections: ReportSection[] = [
      { name: '', lines: [{ text: `generated: ${generatedLine(env.now)}`, prio: KEEP, group: 'head' }] },
    ];
    if (opts.bootError !== undefined) {
      const e = opts.bootError;
      const cls = e instanceof Error && e.name ? e.name : 'Error';
      sections.push({
        name: 'boot',
        lines: [{ text: `failed: ${cls}: ${c.text(e instanceof Error ? e.message : String(e), 140)}`, prio: KEEP, group: 'boot' }],
      });
    }
    const pieces: Array<() => ReportSection | ReportSection[]> = [
      () => appSection(env, c),
      () => installSection(env, h),
      () => studySection(env, h),
      () => registeredSections(env, c),
      () => macSection(env),
      () => dataSection(env, h),
      () => problemsSection(env, c),
    ];
    for (const piece of pieces) {
      try {
        const got = piece();
        sections.push(...(Array.isArray(got) ? got : [got]));
      } catch (err) {
        sections.push({ name: 'error', lines: [{ text: `error: ${c.text(shortCause(err), 100)}`, prio: 90, group: 'error' }] });
      }
    }
    // The final scrub runs on every line before the sum is taken, so the sum is of what is sent.
    for (const s of sections) for (const l of s.lines) l.text = finalScrub(l.text, env);
    return renderReport(sections);
  } finally {
    try {
      h.db?.close();
    } catch {
      /* closing a read-only connection cannot lose anything */
    }
  }
}
