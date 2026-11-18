/**
 * The debug report's wire format (`wire.ts`): writing, truncating, reading back a paste in the
 * shapes a chat app delivers it, and the researcher's diagnosis rules.
 *
 * The fixtures are written by `renderReport` itself, so their sums are real; each mangling is
 * then applied to the text the way a paste would be.
 */
import { describe, expect, it } from 'vitest';
import {
  DEBUG_HEADER,
  DEBUG_MAX_CHARS,
  canonical,
  checksum,
  diagnose,
  parseCounts,
  parseReport,
  parseSize,
  renderReport,
  telegramSafe,
  type ReportSection,
} from './wire.js';

const ID = '3f9a2c1d8e7b6a50c4d2';

function sec(name: string, lines: Record<string, string>, prio = 80): ReportSection {
  return { name, lines: Object.entries(lines).map(([k, v]) => ({ text: `${k}: ${v}`, prio, group: name })) };
}

function fixture(over: { app?: Record<string, string>; mac?: Record<string, string>; study?: Record<string, string>; data?: Record<string, string>; update?: Record<string, string> | null; problems?: string[]; seven?: string; boot?: string } = {}): string {
  const sections: ReportSection[] = [
    { name: '', lines: [{ text: 'generated: 2026-11-18T15:20:05Z | SGT 2026-11-18 23:20', prio: 100, group: 'head' }] },
    ...(over.boot ? [sec('boot', { failed: over.boot }, 100)] : []),
    sec('app', { version: '0.1.0', build: '57', sha: 'abc1234def56 channel study', bundle: '/Applications/ChatterED.app', location: 'applications', packaged: 'yes', arch: 'arm64', runtime: 'electron 44.3.0, chrome 152.0.7000.1, node 24.3.0', ...over.app }),
    sec('install', { id: ID, 'first-run': '2026-11-10 (db 2026-11-09)', consent: 'v1 (this build v1)' }),
    sec('study', { slot: 'S04', spent: '$12.35 of $50.00', 'cap-hit': 'no', 'study-key': 'active', bundle: 'present (userData), preload absent', 'key-files': 'anthropic', backend: 'anthropic', models: 'anthropic claude-sonnet-5-5/claude-sonnet-5-5', ...over.study }),
    ...(over.update === null ? [sec('update', { update: 'not available in this build' })] : [sec('update', { 'last-check': '2026-11-18 14:00Z ok', staged: '-', 'bad-builds': 'none', 'last-applied': '56', previous: 'yes', ...over.update })]),
    sec('mac', { macos: '26.1 (darwin 27.0.0)', model: 'Mac15,6', ram: '16 GB', 'disk-free': '69.3 GB', locale: 'en-SG, tz Asia/Singapore', admin: 'yes', 'apps-writable': 'yes (folder yes)', ...over.mac }),
    sec('data', { 'db-size': '12.3 MB', schema: '34', 'quick-check': 'ok (41 ms)', notebooks: '3', sources: 'ready 7, reading 0, failed 1', tutorials: 'ready 2, pending 0, failed 1', backup: '2026-11-15 10:00Z', ...over.data }),
    {
      name: 'problems',
      lines: [
        { text: `7d: ${over.seven ?? 'app.start 12, tutorial.ingest 4, tutorial.ingest.failed 0, llm.error 0, llm.cut 0, crash 0'}`, prio: 95, group: 'problems' },
        ...(over.problems ?? []).map((p, i, all) => ({ text: `- ${p}`, prio: all.length - i <= 5 ? 65 : 10, group: 'problems' })),
      ],
    },
  ];
  return renderReport(sections);
}

const titles = (text: string, ctx = {}) => diagnose(parseReport(text), ctx).map((f) => f.title);

describe('renderReport', () => {
  it('ends with a sum over the canonical body, and checks itself', () => {
    const text = fixture();
    const body = text.slice(0, text.lastIndexOf('\nsum: '));
    expect(text.split('\n').at(-1)).toBe(`sum: ${checksum(body)} len ${canonical(body).length}`);
    expect(text.startsWith(`${DEBUG_HEADER}\n`)).toBe(true);
    expect(parseReport(text).integrity).toBe('complete');
  });

  it('drops the least important lines first, the oldest problems before anything else', () => {
    const problems = Array.from({ length: 60 }, (_, i) => `11-18 0${i % 10}:00Z error llm.error CliExitError the CLI exited 1 with a long tail number ${i}`);
    const text = fixture({ problems });
    expect(text.length).toBeLessThanOrEqual(DEBUG_MAX_CHARS);
    const r = parseReport(text);
    expect(r.integrity).toBe('complete');
    expect(r.truncated).toMatch(/^\d+ lines \(problems \d+\)$/);
    expect(r.problems.at(-1)!.rest).toContain('number 59');
    expect(r.sections.app!.runtime).toBeDefined();
    expect(r.sections.install!.id).toBe(ID);
  });

  it('cuts never-dropped lines shorter rather than go over the cap', () => {
    const huge: ReportSection = { name: 'x', lines: Array.from({ length: 40 }, (_, i) => ({ text: `k${i}: ${'v'.repeat(190)}`, prio: 100, group: 'x' })) };
    const text = renderReport([huge]);
    expect(text.length).toBeLessThanOrEqual(DEBUG_MAX_CHARS);
    expect(parseReport(text).integrity).toBe('complete');
  });

  it('removes what Telegram would turn into formatting', () => {
    expect(telegramSafe('a **b** __c__ `d` ~~e~~ ||f||\nnext')).toBe("a *b* _c_ 'd' ~e~ |f| next");
  });
});

describe('parseReport', () => {
  it('reads a complete paste', () => {
    const r = parseReport(fixture({ problems: ['11-17 09:10Z error llm.error APIError status 429 rate limited'] }));
    expect(r.integrity).toBe('complete');
    expect(r.sections.app!.build).toBe('57');
    expect(r.sections.study!.slot).toBe('S04');
    expect(r.problems).toEqual([{ ts: '11-17 09:10Z', level: 'error', event: 'llm.error', rest: 'APIError status 429 rate limited' }]);
  });

  it('reads a report that was truncated on the Mac, and says so', () => {
    const problems = Array.from({ length: 50 }, (_, i) => `11-18 01:${String(i).padStart(2, '0')}Z warn x.y ${'long cause '.repeat(8)}${i}`);
    const r = parseReport(fixture({ problems }));
    expect(r.integrity).toBe('complete');
    expect(r.truncated).not.toBeNull();
    expect(titles(fixture({ problems }))).toContain('Shortened on their Mac to fit one message');
  });

  it('knows a paste that was cut off mid-way', () => {
    const text = fixture();
    const cut = text.slice(0, Math.floor(text.length * 0.6));
    const r = parseReport(`hey here it is\n${cut}`);
    expect(r.integrity).toBe('cut');
    expect(r.sections.app!.version).toBe('0.1.0');
    expect(titles(cut)[0]).toBe('The paste is cut off');
  });

  it('knows a paste whose values were changed', () => {
    const r = parseReport(fixture().replace('slot: S04', 'slot: S05'));
    expect(r.integrity).toBe('altered');
    expect(titles(fixture().replace('slot: S04', 'slot: S05'))).toContain('The checksum does not match');
  });

  it('reads a Telegram-mangled paste: forwarded header, smart quotes, CRLF, wrapped lines, trailing spaces', () => {
    const text = fixture({
      problems: [
        "11-17 09:12Z error tutorial.ingest.failed too-long the sheet's answers were cut off at window 3 of 4 because the model's reply hit max_tokens",
      ],
    });
    const mangled =
      'Jane, [18/11/2026 23:21]\n' +
      text
        .replace(/'/g, '’')
        .split('\n')
        // A client that wraps at 48 columns, breaking at a space.
        .flatMap((l) => {
          const out: string[] = [];
          let rest = l;
          while (rest.length > 48) {
            const at = rest.lastIndexOf(' ', 48);
            const cut = at > 10 ? at : 48;
            out.push(`${rest.slice(0, cut)}   `);
            rest = rest.slice(cut).trimStart();
          }
          out.push(rest);
          return out;
        })
        .join('\r\n');
    const r = parseReport(mangled);
    expect(r.integrity).toBe('complete');
    expect(r.sections.app!.runtime).toBe('electron 44.3.0, chrome 152.0.7000.1, node 24.3.0');
    expect(r.sections.install!.id).toBe(ID);
    expect(r.problems[0]!.event).toBe('tutorial.ingest.failed');
    expect(r.problems[0]!.rest).toContain("the sheet's answers were cut off");
  });

  it('reads a broken-boot report, with the startup error the dialog appends after it', () => {
    const text = `${fixture({ boot: 'Error: Cannot find module better_sqlite3.node', data: { schema: 'error: no app.db yet' } })}\n\nstartup error: Cannot find module`;
    const r = parseReport(text);
    expect(r.integrity).toBe('complete');
    expect(r.sections.boot!.failed).toContain('better_sqlite3');
    expect(r.errors).toEqual([{ section: 'data', key: 'schema', cause: 'no app.db yet' }]);
  });

  it('says when there is no report in the paste at all', () => {
    expect(parseReport('hi, the app is broken').integrity).toBe('missing');
    expect(titles('hi')).toEqual(['Not a ChatterED debug report']);
  });

  it('parses sizes and counts', () => {
    expect(parseSize('1.5 GB')).toBe(1.5e9);
    expect(parseSize('582 KB + wal 4 MB')).toBe(582e3);
    expect(parseCounts('app.start 12, llm.error 3')).toEqual({ 'app.start': 12, 'llm.error': 3 });
  });
});

describe('diagnose', () => {
  const ctx = {
    targetUsage: 'tools/release.sh --channel study --target <id>',
    rollbackUsage: 'tools/release.sh --rollback-to <N-1> --target <id> --publish-update',
    publishUsage: 'tools/release.sh --publish v<version>',
  };

  it('a healthy install on the newest build has nothing to act on', () => {
    expect(diagnose(parseReport(fixture()), { ...ctx, publishedBuild: 57 })).toEqual([]);
  });

  it('running from the DMG: not installed', () => {
    const f = diagnose(parseReport(fixture({ app: { location: 'dmg', bundle: '/Volumes/ChatterED/ChatterED.app' } })));
    expect(f[0]).toMatchObject({ severity: 'act', title: 'Running from the disk image: not installed' });
    expect(f[0]!.action).toContain('drag it from the DMG onto Applications');
  });

  it('translocated', () => {
    expect(titles(fixture({ app: { location: 'translocated' } }))).toContain('macOS is running a translocated copy');
  });

  it('not admin, and the copy in Applications cannot be replaced', () => {
    expect(titles(fixture({ mac: { admin: 'no', 'apps-writable': 'yes (folder no)' } }))).toContain('Updates cannot be applied on this Mac');
    expect(titles(fixture({ mac: { admin: 'yes', 'apps-writable': 'no (folder yes)' } }))).toContain('/Applications/ChatterED.app is not writable');
  });

  it('a copy outside Applications', () => {
    expect(titles(fixture({ app: { location: 'other', bundle: '~/Downloads/ChatterED.app' } }))).toContain('Not installed in Applications');
  });

  it('low disk', () => {
    expect(titles(fixture({ mac: { 'disk-free': '1.2 GB' } }))).toContain('Low disk space');
  });

  it('behind the published build: the targeted rollout command for this install', () => {
    const f = diagnose(parseReport(fixture()), { ...ctx, publishedBuild: 60 }).find((x) => x.title.startsWith('Behind'));
    expect(f?.command).toBe(`tools/release.sh --channel study --target ${ID}`);
  });

  it('without per-install targeting: the general publish, and says targeting is pending', () => {
    const f = diagnose(parseReport(fixture()), { publishedBuild: 60, publishUsage: 'tools/release.sh --publish v<version>', targetUsage: null }).find((x) => x.title.startsWith('Behind'));
    expect(f?.command).toBe('tools/release.sh --publish v<version>');
    expect(f?.action).toContain('per-install targeting is not in tools/release.sh yet');
  });

  it('an old build without the updater needs one manual DMG', () => {
    const f = diagnose(parseReport(fixture({ app: { build: '0.1.0' }, update: null })), ctx).find((x) => x.title === 'An old build without the updater');
    expect(f?.command).toBe('cd app && tools/release.sh --study ~/.config/chattered-study/keys.json --preload 4');
  });

  it('repeated tutorial read failures with cut-off answers', () => {
    const text = fixture({
      seven: 'app.start 3, tutorial.ingest 1, tutorial.ingest.failed 3, llm.error 0, llm.cut 2, crash 0',
      problems: ['11-17 09:12Z error tutorial.ingest.failed too-long the reply was cut off'],
    });
    const f = diagnose(parseReport(text), ctx).find((x) => x.title.startsWith('Tutorial sheets'));
    expect(f?.title).toBe('Tutorial sheets fail to read: answers cut off');
    expect(f?.command).toBe(`tools/release.sh --channel study --target ${ID}`);
  });

  it('llm.error 429 and credit', () => {
    expect(titles(fixture({ problems: ['11-17 09:10Z error llm.error APIError status 429 rate_limit_error'] }))).toContain('Rate-limited or overloaded');
    expect(titles(fixture({ problems: ['11-17 09:10Z error llm.error APIError status 400 Your credit balance is too low'] }))).toContain(
      'The model provider refuses for credit or a spend limit',
    );
    expect(titles(fixture({ study: { 'cap-hit': 'yes (local count)' } }))).toContain('The study credit is used up');
  });

  it('a database that fails its quick check', () => {
    expect(titles(fixture({ data: { 'quick-check': 'FAILED 3 (80 ms): row 12 missing from index' } }))).toContain('The database failed its integrity check');
    expect(titles(fixture({ data: { 'quick-check': 'skipped (300 MB is over 268 MB)' } }))).not.toContain('The database failed its integrity check');
  });

  it('update failures and bad builds', () => {
    const t = titles(fixture({ update: { 'last-check': '2026-11-18 failed: signature invalid', 'bad-builds': '58' } }), ctx);
    expect(t).toContain('Update problem: last-check');
    expect(t).toContain('Builds failed to start here');
  });

  it("the updater's own section: switched off, failing to apply, an interrupted swap", () => {
    const t = titles(fixture({ update: { enabled: 'no', 'disabled-reason': 'not_in_applications', 'apply-failures': '2', 'journal-pending': 'yes' } }), ctx);
    expect(t).toEqual(expect.arrayContaining(['Updates are switched off on this copy', 'Updates fail to apply', 'An update swap was interrupted']));
    expect(titles(fixture({ update: { 'apply-failures': '0', 'bad-builds': 'none' } }), ctx)).toEqual([]);
  });

  it('without release.sh --target, a targeted manifest from the update tool', () => {
    const f = diagnose(parseReport(fixture()), {
      publishedBuild: 60,
      targetUsage: null,
      manifestTargetUsage: 'node tools/update-tool.mjs manifest --channel study --target <id>=<entry.json>',
    }).find((x) => x.title.startsWith('Behind'));
    expect(f?.command).toBe(`node tools/update-tool.mjs manifest --channel study --target ${ID}=<entry.json>`);
  });

  it('a boot failure, with the rollback for this install', () => {
    const f = diagnose(parseReport(fixture({ boot: 'Error: test fault: a migration failed' })), ctx).find((x) => x.title === 'ChatterED cannot start');
    expect(f?.command).toBe(`tools/release.sh --rollback-to <N-1> --target ${ID} --publish-update`);
  });

  it('orders what to act on first', () => {
    const f = diagnose(parseReport(fixture({ app: { location: 'dmg' }, study: { 'study-key': 'ended key_replaced 2026-11-12' } })));
    expect(f.map((x) => x.severity)).toEqual([...f.map((x) => x.severity)].sort((a, b) => ['act', 'warn', 'info'].indexOf(a) - ['act', 'warn', 'info'].indexOf(b)));
    expect(f.at(-1)!.title).toBe('They left the study key');
  });
});

describe('npm run debug:read (tools/debug-read.mjs)', () => {
  it('reads a paste from a file and prints the findings as JSON, loading this format from source', async () => {
    const { execFileSync } = await import('node:child_process');
    const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'chattered-debug-read-'));
    try {
      const file = join(dir, 'paste.txt');
      writeFileSync(file, fixture({ app: { location: 'dmg' } }).replace(/'/g, '’'));
      const out = JSON.parse(execFileSync(process.execPath, ['tools/debug-read.mjs', '--json', '--file', file, '--published', '57'], { encoding: 'utf8' })) as {
        report: { integrity: string };
        findings: Array<{ title: string }>;
      };
      expect(out.report.integrity).toBe('complete');
      expect(out.findings.map((f) => f.title)).toContain('Running from the disk image: not installed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
