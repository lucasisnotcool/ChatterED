/**
 * The debug report (`report.ts`): what it says about a real install, that it fits one Telegram
 * message, that a broken source costs one line rather than the report, and that none of the
 * secrets an install holds can reach it.
 *
 * Everything runs against a temp "userData", a temp log folder and a migrated database on a file,
 * through the injected environment: no real path on this Mac is read or written.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openTestDatabase, type SqlDatabase } from '../db/driver.js';
import { runMigrations } from '../db/migrations.js';
import { seedNotebook } from '../../test-support/notebookseed.js';
import { STUDY_SETTINGS } from '../../shared/study.js';
import { TRIAL_SETTINGS } from '../../shared/trial.js';
import {
  buildDebugReport,
  bundleOf,
  classifyBundle,
  cleaners,
  ensureInstallId,
  generatedLine,
  registerDebugSection,
  sqliteOpener,
  type DebugEnv,
  type DebugSectionFn,
} from './report.js';
import { DEBUG_HEADER, DEBUG_MAX_CHARS, diagnose, parseReport } from './wire.js';

const MIGRATIONS = fileURLToPath(new URL('../db/migrations', import.meta.url));
const NOW = new Date('2026-11-18T15:20:05.000Z');

// The secrets an install can hold, each seeded into every place it could come from.
const KEY = 'sk-ant-api03-SECRETSECRETSECRETSECRET0123456789abcdef';
const CODE = 'S07-K3QX-9MZT-4HRA';
const EMAIL = 'jane.tan@u.nus.edu';
const USER = 'janetan';
const LEARNER_FILE = 'JaneTan_CS3249_Tutorial3_answers.pdf';
const NOTEBOOK = 'Jane private revision';

let tmp: string;
let home: string;
let userData: string;
let logs: string;
let bundle: string;
let calls: string[];

function line(ts: string, level: string, event: string, fields: Record<string, unknown> = {}): string {
  return `${JSON.stringify({ ts, level, event, v: '0.1.0', packaged: true, ...fields })}\n`;
}

function seedDb(path: string): SqlDatabase {
  const db = openTestDatabase(path);
  runMigrations(db, MIGRATIONS);
  seedNotebook(db, 'a');
  const set = (key: string, value: string, at = '2026-11-10T02:00:00.000Z') =>
    db.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (@key, @value, @at)`).run({ key, value, at });
  set('first_run_complete', '1');
  set(TRIAL_SETTINGS.consentVersion, '1');
  set(TRIAL_SETTINGS.consentedAt, '2026-11-10T02:00:00.000Z');
  set(TRIAL_SETTINGS.participantId, 'P-7Q2XK9');
  set(STUDY_SETTINGS.slot, '04');
  set(STUDY_SETTINGS.budgetUsd, '50');
  set(STUDY_SETTINGS.unlockedAt, '2026-11-10T02:00:00.000Z');
  set(STUDY_SETTINGS.keyFingerprint, 'abcdef0123456789');
  set('llm_backend', 'anthropic');
  set('api_model_agent_anthropic', 'claude-sonnet-5-5');
  set('api_model_orchestrator_anthropic', 'claude-sonnet-5-5');
  // Secrets in settings rows the report must never print.
  set('openai_compatible_base_url', `https://${EMAIL}:${KEY}@example.com/v1`);
  set('study_code_last_typed', CODE);
  set('claude_cli_detection', JSON.stringify({ found: true, loggedIn: true, path: `/Users/${USER}/.local/bin/claude`, version: '3.1.0' }));
  db.prepare(`UPDATE notebook_sources SET display_name = @n`).run({ n: LEARNER_FILE });
  db.prepare(`UPDATE notebook_sources SET status = 'failed' WHERE role = 'tutorial'`).run();
  db.prepare(`UPDATE notebooks SET name = @n`).run({ n: NOTEBOOK });
  db.prepare(
    `INSERT INTO llm_usage (id, created_at, scope, model, backend, estimated_cost_usd) VALUES ('u1', '2026-11-12T00:00:00.000Z', 'ask', 'claude-sonnet-5-5', 'anthropic', 12.345)`,
  ).run();
  return db;
}

function env(over: Partial<DebugEnv> = {}): Partial<DebugEnv> {
  return {
    now: NOW,
    userDataDir: userData,
    logDir: logs,
    home,
    username: USER,
    version: '0.1.0',
    packaged: true,
    exePath: join(bundle, 'Contents', 'MacOS', 'ChatterED'),
    resourcesPath: join(bundle, 'Contents', 'Resources'),
    appPath: join(bundle, 'Contents', 'Resources', 'app.asar'),
    locale: 'en-SG',
    timeZone: 'Asia/Singapore',
    arch: 'arm64',
    versions: { electron: '44.3.0', chrome: '152.0.7000.1', node: '24.3.0' },
    macosVersion: '26.1',
    darwin: '27.0.0',
    totalMem: 16 * 2 ** 30,
    applicationsBundle: join(tmp, 'Applications', 'ChatterED.app'),
    studyBundlePaths: [join(bundle, 'Contents', 'Resources', 'study', 'keys.json'), join(userData, 'study', 'keys.json')],
    bakedPath: join(tmp, 'baked.json'),
    quickCheckMaxBytes: 256 * 1024 * 1024,
    run: (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      if (cmd.endsWith('sysctl')) return 'Mac15,6';
      if (cmd.endsWith('id')) return 'staff everyone admin _appserveradm';
      throw new Error(`unexpected ${cmd}`);
    },
    openDb: sqliteOpener('better-sqlite3-node'),
    sections: new Map(),
    ...over,
  };
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'chattered-debug-'));
  home = join(tmp, 'Users', USER);
  userData = join(home, 'Library', 'Application Support', 'ChatterED');
  logs = join(home, 'Library', 'Logs', 'ChatterED');
  bundle = join(home, 'Downloads', 'ChatterED.app');
  calls = [];
  mkdirSync(userData, { recursive: true });
  mkdirSync(logs, { recursive: true });
  mkdirSync(join(bundle, 'Contents', 'MacOS'), { recursive: true });
  mkdirSync(join(bundle, 'Contents', 'Resources', 'study'), { recursive: true });
  mkdirSync(join(tmp, 'Applications'), { recursive: true });
  writeFileSync(
    join(bundle, 'Contents', 'Info.plist'),
    '<?xml version="1.0"?><plist><dict><key>CFBundleVersion</key><string>0.1.0</string></dict></plist>',
  );
  writeFileSync(join(bundle, 'Contents', 'Resources', 'study', 'keys.json'), '{"format":"chattered-study-keys"}');
  writeFileSync(join(bundle, 'Contents', 'Resources', 'study', 'preload.txt'), `${CODE}\n`);
  writeFileSync(join(userData, 'anthropic-api-key'), KEY);
  seedDb(join(userData, 'app.db')).close();
  mkdirSync(join(userData, 'backups'));
  writeFileSync(join(userData, 'backups', 'app-before-v033-2026-11-15T10-00-00-000Z.db'), 'x');
  utimesSync(join(userData, 'backups', 'app-before-v033-2026-11-15T10-00-00-000Z.db'), new Date('2026-11-15T10:00:00Z'), new Date('2026-11-15T10:00:00Z'));
  writeFileSync(
    join(logs, 'main.log'),
    [
      line('2026-11-17T09:00:00.000Z', 'info', 'app.start', { electron: '44.3.0' }),
      line('2026-11-17T09:05:00.000Z', 'info', 'tutorial.ingest', { parts: 8 }),
      line('2026-11-17T09:10:00.000Z', 'error', 'llm.error', {
        scope: 'tutorial.read',
        class: 'APIError',
        status: 429,
        cause: `429 rate_limit_error for key ${KEY} (account ${EMAIL})`,
      }),
      line('2026-11-17T09:12:00.000Z', 'error', 'tutorial.ingest.failed', {
        cause: `Could not read "${LEARNER_FILE}" at /Users/${USER}/Documents/${LEARNER_FILE}`,
        too_long: { from: 1, to: 4, reason: 'max_tokens' },
      }),
      line('2026-11-17T09:13:00.000Z', 'warn', 'study.unlock_failed', { cause: `code ${CODE} did not open a slot` }),
      line('2026-11-17T09:14:00.000Z', 'error', 'renderer.error', { class: 'TypeError', cause: `undefined at file:///Users/${USER}/app.js`, message_chars: 40 }),
      line('2026-11-17T09:15:00.000Z', 'info', 'llm.complete', { truncated: true }),
      // Older than seven days: listed if recent enough to be among the last 20, never counted.
      line('2026-11-01T09:00:00.000Z', 'info', 'app.start'),
    ].join(''),
  );
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('buildDebugReport', () => {
  it('reports a real install, section by section, under the Telegram cap', () => {
    const text = buildDebugReport(env());
    if (process.env.DEBUG_PEEK) writeFileSync(process.env.DEBUG_PEEK, text);
    expect(text.startsWith(`${DEBUG_HEADER}\ngenerated: 2026-11-18T15:20:05Z | SGT 2026-11-18 23:20\n`)).toBe(true);
    expect(text.length).toBeLessThanOrEqual(DEBUG_MAX_CHARS);
    const r = parseReport(text);
    expect(r.integrity).toBe('complete');
    expect(r.sections.app).toMatchObject({ version: '0.1.0', build: '0.1.0', location: 'other', packaged: 'yes', arch: 'arm64' });
    expect(r.sections.app!.bundle).toBe('~/Downloads/ChatterED.app');
    expect(r.sections.mac).toMatchObject({ macos: '26.1 (darwin 27.0.0)', model: 'Mac15,6', ram: '16 GB', admin: 'yes' });
    expect(r.sections.mac!['apps-writable']).toBe('absent (folder yes)');
    expect(r.sections.install!.id).toMatch(/^[0-9a-f]{20}$/);
    expect(r.sections.install!['first-run']).toMatch(/^2026-11-10 \(db \d{4}-\d\d-\d\d\)$/);
    expect(r.sections.install!.consent).toBe('v1 (this build v1)');
    expect(r.sections.study).toMatchObject({
      slot: 'S04',
      spent: '$12.35 of $50.00',
      'cap-hit': 'no',
      'study-key': 'active',
      bundle: 'present (resources), preload present',
      'key-files': 'anthropic',
      backend: 'anthropic',
      models: 'anthropic claude-sonnet-5-5/claude-sonnet-5-5',
      cli: 'found 3.1.0, logged in',
    });
    expect(r.sections.data).toMatchObject({
      notebooks: '1',
      sources: 'ready 1, reading 0, failed 1',
      backup: '2026-11-15 10:00Z',
    });
    expect(Number(r.sections.data!.schema)).toBeGreaterThanOrEqual(34);
    expect(r.sections.data!['quick-check']).toMatch(/^ok \(\d+ ms\)$/);
    expect(r.sections.data!.tutorials).toMatch(/^ready \d+, pending \d+, failed \d+$/);
    expect(r.sections.update).toEqual({ update: 'not available in this build' });
    expect(r.sections.problems!['7d']).toBe('app.start 1, tutorial.ingest 1, tutorial.ingest.failed 1, llm.error 1, llm.cut 1, crash 0');
    expect(r.problems.map((p) => p.event)).toEqual(['llm.error', 'tutorial.ingest.failed', 'study.unlock_failed', 'renderer.error']);
    expect(r.problems[0]).toMatchObject({ ts: '11-17 09:10Z', level: 'error' });
    expect(r.problems[0]!.rest).toContain('status 429');
    expect(r.problems[1]!.rest).toContain('too-long');
    // Only the install id file is written, and only into userData.
    expect(readFileSync(join(userData, 'install-id'), 'utf8').trim()).toBe(r.sections.install!.id);
    expect(calls).toEqual(['/usr/sbin/sysctl -n hw.model', '/usr/bin/id -Gn']);
  });

  it('keeps one install id across reports', () => {
    const a = parseReport(buildDebugReport(env())).sections.install!.id;
    const b = parseReport(buildDebugReport(env())).sections.install!.id;
    expect(a).toBe(b);
    expect(ensureInstallId(userData).id).toBe(a);
  });

  it('never contains a key, a study code, an e-mail, a username, a learner file or notebook name', () => {
    // And a registered section that hands back secrets of its own.
    const sections = new Map<string, DebugSectionFn>([
      ['update', () => ({ lastCheck: `failed: GET /Users/${USER}/x ${KEY}`, staged: LEARNER_FILE, note: `${EMAIL} ${CODE}` })],
    ]);
    const text = buildDebugReport(env({ sections, bootError: new Error(`SQLITE_CORRUPT in /Users/${USER}/Library/app.db for ${EMAIL}`) }));
    for (const secret of [KEY, 'SECRETSECRET', CODE, '9MZT', EMAIL, 'jane.tan', USER, LEARNER_FILE, 'Tutorial3', NOTEBOOK, 'P-7Q2XK9', home]) {
      expect(text, secret).not.toContain(secret);
    }
    expect(text).toContain('[boot]');
    expect(text.length).toBeLessThanOrEqual(DEBUG_MAX_CHARS);
    expect(parseReport(text).integrity).toBe('complete');
  });

  it('prints error: for a broken source and carries on', () => {
    writeFileSync(join(userData, 'app.db'), 'this is not a database');
    rmSync(join(userData, 'app.db-wal'), { force: true });
    rmSync(join(userData, 'app.db-shm'), { force: true });
    const text = buildDebugReport(
      env({
        run: () => {
          throw new Error('spawn ENOENT');
        },
      }),
    );
    const r = parseReport(text);
    expect(r.integrity).toBe('complete');
    expect(r.sections.mac!.model).toBe('error: spawn ENOENT');
    expect(r.sections.data!.schema).toMatch(/^error: /);
    expect(r.sections.study!.slot).toMatch(/^error: /);
    expect(r.sections.app!.version).toBe('0.1.0');
    expect(r.sections.problems!['7d']).toContain('llm.error 1');
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });

  it('works with no database, no log folder and nothing registered (a first launch that failed)', () => {
    rmSync(userData, { recursive: true, force: true });
    rmSync(logs, { recursive: true, force: true });
    const text = buildDebugReport(env({ bootError: new Error('Cannot find module better_sqlite3.node') }));
    const r = parseReport(text);
    expect(r.integrity).toBe('complete');
    expect(r.sections.boot!.failed).toBe('Error: Cannot find module better_sqlite3.node');
    expect(r.sections.data!.schema).toBe('error: no app.db yet');
    expect(r.sections.problems!.error).toBe('no log folder');
    expect(diagnose(r).map((f) => f.title)).toContain('ChatterED cannot start');
  });

  it('with no userData at all (outside Electron) reads and writes nothing', () => {
    const text = buildDebugReport(env({ userDataDir: '', logDir: '' }));
    const r = parseReport(text);
    expect(r.sections.install!.id).toBe('none (no userData)');
    expect(r.sections.problems!.error).toBe('no log folder');
  });

  it('skips the integrity check on a database too large to check in about a second', () => {
    const r = parseReport(buildDebugReport(env({ quickCheckMaxBytes: 10 })));
    expect(r.sections.data!['quick-check']).toMatch(/^skipped \(/);
  });

  it('shows a registered section, kebab-cased, and drops it again', () => {
    const off = registerDebugSection('update', () => ({ lastCheck: '2026-11-18 ok', staged: null, badBuilds: [], previous: true }));
    try {
      const r = parseReport(buildDebugReport(env({ sections: undefined })));
      expect(r.sections.update).toEqual({ 'last-check': '2026-11-18 ok', staged: '-', 'bad-builds': 'none', previous: 'yes' });
    } finally {
      off();
    }
    const after = { ...env() };
    delete after.sections;
    expect(parseReport(buildDebugReport(after)).sections.update).toEqual({ update: 'not available in this build' });
  });

  it('a registered section that throws costs one line', () => {
    const sections = new Map<string, DebugSectionFn>([
      [
        'update',
        () => {
          throw new Error('state.json: Unexpected token');
        },
      ],
    ]);
    const r = parseReport(buildDebugReport(env({ sections })));
    expect(r.sections.update).toEqual({ error: 'state.json: Unexpected token' });
  });

  it('drops the oldest problem lines first when there are many, and says so', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      line(`2026-11-18T0${Math.floor(i / 10)}:${String((i % 10) * 5).padStart(2, '0')}:00.000Z`, 'error', 'llm.error', {
        class: 'CliExitError',
        cause: `the Claude CLI exited 1: a long stderr tail that goes on and on about nothing in particular #${i}`,
      }),
    ).join('');
    writeFileSync(join(logs, 'main.1.log'), readFileSync(join(logs, 'main.log'), 'utf8'));
    writeFileSync(join(logs, 'main.log'), many);
    const text = buildDebugReport(env());
    expect(text.length).toBeLessThanOrEqual(DEBUG_MAX_CHARS);
    const r = parseReport(text);
    expect(r.integrity).toBe('complete');
    expect(r.truncated).toMatch(/^\d+ lines \(problems \d+/);
    // The newest is always kept; the last 20 are what was read.
    expect(r.problems.at(-1)!.rest).toContain('#39');
    expect(r.problems.some((p) => p.rest.includes('#20'))).toBe(false);
    expect(r.sections.problems!['7d']).toContain('llm.error 41');
  });
});

describe('the pieces', () => {
  it('finds the bundle from the executable, and where it runs from', () => {
    expect(bundleOf('/Applications/ChatterED.app/Contents/MacOS/ChatterED')).toBe('/Applications/ChatterED.app');
    expect(bundleOf('/usr/local/bin/node')).toBeNull();
    const h = '/Users/x';
    expect(classifyBundle('/Applications/ChatterED.app', true, h)).toBe('applications');
    expect(classifyBundle('/Users/x/Applications/ChatterED.app', true, h)).toBe('user-applications');
    expect(classifyBundle('/Volumes/ChatterED 0.1.0/ChatterED.app', true, h)).toBe('dmg');
    expect(classifyBundle('/private/var/folders/ab/T/AppTranslocation/1234/d/ChatterED.app', true, h)).toBe('translocated');
    expect(classifyBundle('/Users/x/Downloads/ChatterED.app', true, h)).toBe('other');
    expect(classifyBundle('/whatever', false, h)).toBe('dev');
  });

  it('writes the time in UTC and in Singapore', () => {
    expect(generatedLine(new Date('2026-11-18T20:05:00.000Z'))).toBe('2026-11-18T20:05:00Z | SGT 2026-11-19 04:05');
  });

  it('strips paths, file names and codes from free text', () => {
    const c = cleaners({ home: '/Users/jdoe', username: 'jdoe' });
    expect(c.text('could not open ‘Week 3 notes.pdf’ in /Users/jdoe/Desktop/x y.pptx')).toBe('could not open <file> in <path> <file>');
    expect(c.text(`code ${CODE} for jdoe@u.nus.edu`)).toBe('code [study-code] for [redacted-email]');
    expect(c.path('/Users/jdoe/Applications/ChatterED.app')).toBe('~/Applications/ChatterED.app');
    expect(c.text('x'.repeat(300)).length).toBe(100);
  });
});
