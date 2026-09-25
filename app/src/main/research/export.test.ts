/**
 * The research export, end to end under plain Node: a seeded database with the learner's home
 * directory and username scattered through known *and unknown* tables, a log directory, and a
 * userData directory holding exactly the things that must never leave — then every byte of the
 * staged export is searched for the identity it was supposed to lose.
 *
 * The identity is a fake one (`/Users/jdoe`, `jdoe`), injected, so the test means the same thing
 * on every machine and never depends on who runs it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { openTestDatabase, type SqlDatabase } from '../db/driver.js';
import { openTestDb, seedRoom } from '../../test-support/db.js';
import { CONSENT_VERSION, TRIAL_CONTACT_EMAIL } from '../../shared/trial.js';
import {
  KEY_REPLACEMENT,
  anonymiseDatabase,
  findLeaks,
  isSecretSettingKey,
  makeScrubber,
  sourceTextMarker,
} from './anonymise.js';
import { exportSummary, stageResearchExport, zipDirectory, type ResearchManifest } from './export.js';
import { docPlainText } from './readable.js';

const HOME = '/Users/jdoe';
const USER = 'jdoe';
const T = '2026-09-25T08:00:00.000Z';
const KEY = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'chattered-research-test-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out.sort();
}

/** A database with the learner's identity in every kind of place a path or a name ends up. */
function seed(): SqlDatabase {
  const { db, store } = openTestDb();
  seedRoom(store, [
    'What does a positive semi-definite Hessian tell us?',
    `I saved my notes in ${HOME}/Documents/CS3249/notes.md — JDoe here`,
    'Good. Now try the second-order condition.',
    `my key is ${KEY} is that ok`,
  ]);
  db.prepare(`UPDATE messages SET anchor_id = 'doc' WHERE seq >= 3`).run();
  db.prepare(
    `INSERT INTO notes_threads (thread_id, room_id, doc_id, kind, created_at) VALUES ('doc', 'room_test', 'doc_1', 'doc', @t)`,
  ).run({ t: T });
  db.prepare(
    `INSERT INTO whispers (id, room_id, thread_id, student_participant_id, agent_participant_id, seq, sender, body, group_seq_snapshot, created_at)
     VALUES ('w1', 'room_test', 'priv_ellie', 'p_student', 'p_peer', 1, 'student', 'private question from jdoe', 0, @t)`,
  ).run({ t: T });

  // The vault: an absolute root, a file row, and the FTS index of every file in it.
  db.prepare(
    `INSERT INTO vaults (id, root_path, display_name, created_at) VALUES ('v1', @p, 'CS3249', @t)`,
  ).run({ p: `${HOME}/Documents/CS3249`, t: T });
  db.prepare(
    `INSERT INTO files (id, vault_id, rel_path, name, ext, kind, size, mtime_ms)
     VALUES ('f1', 'v1', 'Lecture 4.pdf', 'Lecture 4.pdf', 'pdf', 'pdf', 1000, 1)`,
  ).run();
  db.prepare(`INSERT INTO file_text (body, name, file_id, page) VALUES (@b, 'Lecture 4.pdf', 'f1', 1)`).run({
    b: 'SLIDE TEXT OF THE LECTURER — jdoe private diary.txt contents',
  });
  db.prepare(`UPDATE materials SET file_path = @p`).run({ p: `${HOME}/Documents/CS3249/Lecture 4.pdf` });

  // A notes document, with the learner's own span.
  const doc = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Convexity' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Ingested. ', marks: [{ type: 'author', attrs: { by: 'ingest' } }] },
          { type: 'text', text: 'My own words.', marks: [{ type: 'author', attrs: { by: 'user' } }] },
        ],
      },
    ],
  };
  db.prepare(
    `INSERT INTO notes_docs (id, content_sha, file_id, title, doc_json, ingest_status, ingest_version, created_at, updated_at)
     VALUES ('doc_1', 'sha1', 'f1', 'Lecture 4', @d, 'ready', 1, @t, @t)`,
  ).run({ d: JSON.stringify(doc), t: T });

  // Usage, events, settings (secrets among them).
  db.prepare(
    `INSERT INTO llm_usage (id, created_at, scope, model, backend, input_tokens, output_tokens, room_id)
     VALUES ('u1', @t, 'turn', 'claude-sonnet-5', 'claude_cli', 100, 20, 'room_test')`,
  ).run({ t: T });
  db.prepare(
    `INSERT INTO events (room_id, session_id, seq, actor, type, envelope, payload, server_ts)
     VALUES ('room_test', 'sess_test', 1, 'student', 'message.sent', '{}', @p, @t)`,
  ).run({ p: JSON.stringify({ cwd: `${HOME}/Library/Application Support/ChatterED` }), t: T });
  store.settings.set('llm_backend', 'claude_cli', T);
  store.settings.set('claude_cli_detection', JSON.stringify({ found: true, path: `${HOME}/.local/bin/claude` }), T);
  store.settings.set('openai_api_key', 'sk-proj-abcdefghijklmnopqrstuvwx', T);
  store.settings.set('custom_endpoint_token', 'opaque-token-value', T);
  store.settings.set('trial_participant_id', 'P-1a2b3c4d', T);

  // Tables this code has never heard of — one with a rowid, one without.
  db.exec(`CREATE TABLE future_notes (id TEXT PRIMARY KEY, body TEXT, meta TEXT)`);
  db.prepare(`INSERT INTO future_notes VALUES ('n1', @b, @m)`).run({
    b: `opened ${HOME}/Desktop/x.pdf as jdoe`,
    m: JSON.stringify({ user: 'JDOE', dir: `${HOME.toUpperCase()}/tmp` }),
  });
  db.exec(`CREATE TABLE future_kv (k TEXT PRIMARY KEY, v TEXT) WITHOUT ROWID`);
  db.prepare(`INSERT INTO future_kv VALUES (@k, 'last opened')`).run({ k: `${HOME}/Documents/a.pdf` });
  return db;
}

function fixtureDirs(): { logDir: string; userDataDir: string; workDir: string } {
  const logDir = join(tmp, 'Logs', 'ChatterED');
  const userDataDir = join(tmp, 'Application Support', 'ChatterED');
  const workDir = join(tmp, 'work');
  mkdirSync(logDir, { recursive: true });
  mkdirSync(join(userDataDir, 'notes-pages', 'sha1'), { recursive: true });
  mkdirSync(workDir, { recursive: true });
  writeFileSync(
    join(logDir, 'main.log'),
    `${JSON.stringify({ ts: T, event: 'app.start', path: `${HOME}/Library/Logs/ChatterED`, who: 'jdoe' })}\n`,
  );
  writeFileSync(join(logDir, 'main.1.log'), `${JSON.stringify({ ts: T, event: 'llm.error', cause: `${KEY} rejected` })}\n`);
  writeFileSync(join(logDir, 'notes.txt'), 'not a log file');
  // The things that must never be exported.
  writeFileSync(join(userDataDir, 'anthropic-api-key'), KEY);
  writeFileSync(join(userDataDir, 'notes-pages', 'sha1', 'p-1.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
  writeFileSync(join(userDataDir, 'Lecture 4.pdf'), '%PDF-1.7 lecturer content');
  writeFileSync(join(userDataDir, 'app.db'), 'the live database is not copied from disk');
  // The one allowlisted file.
  writeFileSync(join(userDataDir, 'ui-text-scale.json'), '1.25');
  return { logDir, userDataDir, workDir };
}

async function stage(db: SqlDatabase) {
  const dirs = fixtureDirs();
  const staged = await stageResearchExport({
    db,
    openCopy: (file) => openTestDatabase(file),
    workDir: dirs.workDir,
    logDir: dirs.logDir,
    userDataDir: dirs.userDataDir,
    home: HOME,
    username: USER,
    participantId: 'P-1a2b3c4d',
    consentVersion: CONSENT_VERSION,
    consentedAt: T,
    appVersion: '0.1.0-test',
    platform: { os: 'darwin', arch: 'arm64', osVersion: 'macOS 26.0' },
    backend: { kind: 'claude_cli', models: { agent: 'claude-sonnet-5', orchestrator: 'claude-haiku-4-5' } },
    now: new Date(2026, 8, 25, 16, 0),
  });
  return { staged, dirs };
}

describe('the scrubber', () => {
  const scrub = makeScrubber({ home: HOME, username: USER });

  it('replaces the home directory (any case) and the username as a whole word (any case)', () => {
    expect(scrub(`${HOME}/Documents/a.pdf`)).toBe('~/Documents/a.pdf');
    expect(scrub('/users/JDOE/x')).toBe('~/x');
    expect(scrub('by JDoe, jdoe_notes, jdoe.pdf')).toBe('by <user>, <user>_notes, <user>.pdf');
    // Not inside a longer word.
    expect(scrub('jdoes and ajdoe')).toBe('jdoes and ajdoe');
  });

  it('redacts key-shaped strings', () => {
    expect(scrub(`key ${KEY}.`)).toBe(`key ${KEY_REPLACEMENT}.`);
    expect(scrub('sk-proj-abcdefghijklmnopqrstuvwx')).toBe(KEY_REPLACEMENT);
  });

  it('is idempotent, even for an account named "user"', () => {
    const s = makeScrubber({ home: '/Users/user', username: 'user' });
    const once = s('/Users/user/a and user b');
    expect(once).toBe('~/a and <user> b');
    expect(s(once)).toBe(once);
  });

  it('knows a secret settings key when it sees one', () => {
    for (const k of ['api_key', 'openai_api_key', 'gemini.apiKey', 'custom_endpoint_token', 'secret', 'db_password']) {
      expect(isSecretSettingKey(k)).toBe(true);
    }
    for (const k of ['llm_backend', 'claude_cli_path', 'cli_model_agents', 'rate_card_override', 'trial_participant_id', 'max_tokens']) {
      expect(isSecretSettingKey(k)).toBe(false);
    }
  });
});

describe('anonymiseDatabase', () => {
  it('scrubs every table — including ones it did not know about — and drops secrets and the FTS index', () => {
    const db = seed();
    const scrub = makeScrubber({ home: HOME, username: USER });
    const report = anonymiseDatabase(db, scrub);
    expect(findLeaks(db, scrub)).toEqual([]);
    expect(report.droppedTables).toEqual(['file_text']);
    expect(report.droppedSettings).toBe(2);
    expect(report.excludedColumns).toContain('materials.extracted_text');

    expect(db.prepare(`SELECT body, meta FROM future_notes`).get()).toEqual({
      body: 'opened ~/Desktop/x.pdf as <user>',
      meta: JSON.stringify({ user: '<user>', dir: '~/tmp' }),
    });
    expect(db.prepare(`SELECT k FROM future_kv`).get()).toEqual({ k: '~/Documents/a.pdf' });
    expect(db.prepare(`SELECT root_path FROM vaults`).get()).toEqual({ root_path: '~/Documents/CS3249' });
    // File names are kept.
    expect(db.prepare(`SELECT name FROM files`).get()).toEqual({ name: 'Lecture 4.pdf' });
    expect(db.prepare(`SELECT key FROM settings ORDER BY key`).all().map((r) => (r as { key: string }).key)).toEqual([
      'claude_cli_detection',
      'llm_backend',
      'trial_participant_id',
    ]);
    const body = db.prepare(`SELECT body FROM messages WHERE seq = 4`).get<{ body: string }>()!.body;
    expect(body).toBe(`my key is ${KEY_REPLACEMENT} is that ok`);
    const text = db.prepare(`SELECT extracted_text FROM materials`).get<{ extracted_text: string }>()!.extracted_text;
    expect(text).toMatch(/^\[excluded from the research export: \d+ characters/);
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE name LIKE 'file_text%'`).all()).toEqual([]);
  });
});

describe('stageResearchExport', () => {
  it('leaves no trace of the home directory, the username or the key in any byte of any file', async () => {
    const { staged } = await stage(seed());
    const files = walk(staged.dir);
    expect(files.length).toBeGreaterThan(8);
    for (const file of files) {
      const bytes = readFileSync(file).toString('latin1').toLowerCase();
      expect(bytes.includes('jdoe'), relative(staged.dir, file)).toBe(false);
      expect(bytes.includes('sk-ant-api03'), relative(staged.dir, file)).toBe(false);
      expect(bytes.includes('sk-proj-'), relative(staged.dir, file)).toBe(false);
      expect(bytes.includes('opaque-token-value'), relative(staged.dir, file)).toBe(false);
      // The FTS index and the extracted text are gone from the database's pages, not just its rows.
      expect(bytes.includes('slide text of the lecturer'), relative(staged.dir, file)).toBe(false);
    }
  });

  it('exports the content, and none of the PDFs, page images, key files or other userData', async () => {
    const { staged } = await stage(seed());
    const rel = walk(staged.dir).map((f) => relative(staged.dir, f).split(sep).join('/'));
    expect(rel).toEqual([
      'README.txt',
      'consent-notice.txt',
      'database/chattered.db',
      'logs/main.1.log',
      'logs/main.log',
      'manifest.json',
      'readable/events.jsonl',
      'readable/files.json',
      'readable/notes/doc_1.json',
      'readable/progress.json',
      'readable/settings.json',
      'readable/transcripts/room_test.json',
      'readable/usage.csv',
      'settings/ui-text-scale.json',
    ]);
    expect(rel.some((p) => /\.(pdf|jpe?g|png)$/i.test(p))).toBe(false);
    expect(rel.some((p) => /api-key|notes-pages/.test(p))).toBe(false);

    const transcript = JSON.parse(readFileSync(join(staged.dir, 'readable/transcripts/room_test.json'), 'utf8')) as {
      threads: { threadId: string | null; kind: string; turns: { text: string; authorKind: string }[] }[];
      privateThreads: { threadId: string; turns: { text: string }[] }[];
    };
    const doc = transcript.threads.find((t) => t.threadId === 'doc')!;
    expect(doc.kind).toBe('doc');
    expect(doc.turns.map((t) => t.text)).toEqual([
      'Good. Now try the second-order condition.',
      `my key is ${KEY_REPLACEMENT} is that ok`,
    ]);
    const loose = transcript.threads.find((t) => t.threadId === null)!;
    expect(loose.turns[1]!.text).toBe('I saved my notes in ~/Documents/CS3249/notes.md — <user> here');
    expect(loose.turns[1]!.authorKind).toBe('student');
    expect(transcript.privateThreads[0]!.turns[0]!.text).toBe('private question from <user>');

    const notes = JSON.parse(readFileSync(join(staged.dir, 'readable/notes/doc_1.json'), 'utf8')) as {
      text: string;
      charsByAuthor: Record<string, number>;
    };
    expect(notes.text).toBe('# Convexity\n\nIngested. My own words.');
    expect(notes.charsByAuthor.user).toBe('My own words.'.length);

    const csv = readFileSync(join(staged.dir, 'readable/usage.csv'), 'utf8').trim().split('\n');
    expect(csv).toHaveLength(2);
    expect(csv[1]).toContain('claude-sonnet-5');
    const events = readFileSync(join(staged.dir, 'readable/events.jsonl'), 'utf8').trim().split('\n');
    expect(JSON.parse(events[0]!)).toMatchObject({ type: 'message.sent', payload: { cwd: '~/Library/Application Support/ChatterED' } });
    const settings = JSON.parse(readFileSync(join(staged.dir, 'readable/settings.json'), 'utf8')) as Record<string, string>;
    expect(Object.keys(settings).sort()).toEqual(['claude_cli_detection', 'llm_backend', 'trial_participant_id']);
    expect(readFileSync(join(staged.dir, 'settings/ui-text-scale.json'), 'utf8')).toBe('1.25');
  });

  it('writes a manifest that describes the export and hashes every other file', async () => {
    const { staged } = await stage(seed());
    const manifest = JSON.parse(readFileSync(join(staged.dir, 'manifest.json'), 'utf8')) as ResearchManifest;
    expect(manifest).toMatchObject({
      format: 'chattered-research-export',
      formatVersion: 1,
      participantId: 'P-1a2b3c4d',
      consent: { version: CONSENT_VERSION, consentedAt: T, currentVersion: CONSENT_VERSION },
      app: { version: '0.1.0-test' },
      platform: { os: 'darwin', arch: 'arm64', osVersion: 'macOS 26.0' },
      backend: { kind: 'claude_cli', models: { agent: 'claude-sonnet-5', orchestrator: 'claude-haiku-4-5' } },
      anonymisation: { homeDirectoryReplacedWith: '~', usernameReplacedWith: '<user>', droppedTables: ['file_text'], droppedSettings: 2 },
      contents: { transcripts: 1, notesDocs: 1, usageRows: 1, events: 1, logFiles: 2 },
      contact: TRIAL_CONTACT_EMAIL,
    });
    expect(manifest.app.schemaVersion).toBeGreaterThanOrEqual(22);
    expect(Number.isNaN(Date.parse(manifest.exportedAt))).toBe(false);
    expect(manifest.files.map((f) => f.path)).not.toContain('manifest.json');
    expect(manifest.files).toHaveLength(walk(staged.dir).length - 1);
    for (const f of manifest.files) {
      const full = join(staged.dir, f.path);
      expect(statSync(full).size).toBe(f.bytes);
      expect(createHash('sha256').update(readFileSync(full)).digest('hex')).toBe(f.sha256);
    }
    expect(staged.name).toBe('ChatterED-research-P-1a2b3c4d-20260925');
  });

  it('leaves the live database untouched', async () => {
    const db = seed();
    await stage(db);
    expect(db.prepare(`SELECT root_path FROM vaults`).get()).toEqual({ root_path: `${HOME}/Documents/CS3249` });
    expect(db.prepare(`SELECT value FROM settings WHERE key = 'openai_api_key'`).get()).toBeDefined();
    expect(db.prepare(`SELECT count(*) AS n FROM file_text`).get()).toEqual({ n: 1 });
  });

  it.runIf(existsSync('/usr/bin/ditto'))('zips to a single top-level folder with ditto', async () => {
    const { staged } = await stage(seed());
    const zip = join(tmp, 'out.zip');
    await zipDirectory(staged.dir, zip);
    const entries = execFileSync('/usr/bin/unzip', ['-Z1', zip], { encoding: 'utf8' }).trim().split('\n');
    expect(entries.every((e) => e.startsWith(`${staged.name}/`))).toBe(true); // no __MACOSX/ tree
    expect(entries).toContain(`${staged.name}/manifest.json`);
    expect(entries).toContain(`${staged.name}/database/chattered.db`);
  });
});

describe('exportSummary and docPlainText', () => {
  it('counts what an export would contain', () => {
    const db = seed();
    const { logDir } = fixtureDirs();
    expect(exportSummary(db, logDir)).toMatchObject({
      rooms: 1,
      messages: 4,
      privateTurns: 1,
      notesDocs: 1,
      usageRows: 1,
      events: 1,
      logFiles: 2,
    });
    expect(exportSummary(db, join(tmp, 'nope')).logFiles).toBe(0);
  });

  it('reads a document it cannot parse as empty rather than failing', () => {
    expect(docPlainText(null)).toEqual({ text: '', charsByAuthor: {} });
    expect(docPlainText('not a doc')).toEqual({ text: '', charsByAuthor: {} });
  });

  it('marks excluded source text with its length', () => {
    expect(sourceTextMarker(12)).toBe('[excluded from the research export: 12 characters of source-document text]');
  });
});
