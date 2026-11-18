/**
 * Read a pasted ChatterED debug report (⇧⌘D, Help ▸ Copy Debug Info for the Team) and say what
 * to do about it.
 *
 *   pbpaste | npm run -s debug:read                 the paste, from the clipboard
 *   npm run -s debug:read                           the same: with no stdin it runs pbpaste itself
 *   npm run -s debug:read -- --file paste.txt       from a file
 *        [--published 61]                           the newest build on their channel, to compare
 *        [--manifest <path-or-https-url>]           …or read it from a channel manifest (`.build`)
 *        [--json]                                   the parsed report and findings, as JSON
 *
 * It validates the header and the checksum (a paste that lost its end, or was edited, is said to
 * be), prints a short summary, then a diagnosis list: each finding with the action, and where
 * there is one, the exact command, e.g. the release tool targeting this install id.
 *
 * The format and the rules are the app's own (`src/main/debug/wire.ts`), loaded from source with
 * the TypeScript compiler already in devDependencies, so there is no build step and the tool and
 * the app cannot drift apart. Nothing is written anywhere; the only network access is an
 * explicit `--manifest https://…`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

async function loadWire() {
  const ts = require('typescript');
  const source = readFileSync(join(appDir, 'src/main/debug/wire.ts'), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

function args(argv) {
  const out = { file: null, published: null, manifest: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--file') out.file = argv[++i];
    else if (a === '--published') out.published = Number(argv[++i]);
    else if (a === '--manifest') out.manifest = argv[++i];
    else if (a === '--json') out.json = true;
    else if (a === '-h' || a === '--help') {
      process.stdout.write(`${readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]}*/\n`);
      process.exit(0);
    } else {
      console.error(`debug-read: unknown argument ${a}`);
      process.exit(2);
    }
  }
  return out;
}

function readPaste(file) {
  if (file) return readFileSync(file, 'utf8');
  if (!process.stdin.isTTY) {
    try {
      return readFileSync(0, 'utf8');
    } catch {
      /* no stdin: fall through to the clipboard */
    }
  }
  return execFileSync('pbpaste', { encoding: 'utf8' });
}

async function publishedBuild(o) {
  if (Number.isInteger(o.published)) return o.published;
  if (!o.manifest) return null;
  let text;
  if (/^https:\/\//.test(o.manifest)) {
    const res = await fetch(o.manifest, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`${o.manifest}: HTTP ${res.status}`);
    text = await res.text();
  } else {
    text = readFileSync(o.manifest, 'utf8');
  }
  const build = JSON.parse(text).build;
  return Number.isInteger(build) ? build : null;
}

/**
 * The release tool's own usage lines, so the commands printed are the ones that exist today: a
 * line naming `--target` (per-install rollout, from the updater work) and one naming `--publish`.
 */
function releaseUsage() {
  const tools = join(appDir, 'tools');
  const scripts = readdirSync(tools).filter((f) => /^release.*\.sh$/.test(f));
  let target = null;
  let publish = null;
  for (const f of scripts) {
    const lines = readFileSync(join(tools, f), 'utf8').split('\n');
    const supportsTarget = lines.some((l) => /^\s*--target\)/.test(l) || /\s--target\)\s/.test(l));
    for (const l of lines) {
      if (!l.startsWith('#')) continue;
      const m = /(tools\/release[\w-]*\.sh\s[^#]*?)(?:\s{2,}|$)/.exec(l.replace(/^#\s*/, ''));
      if (!m) continue;
      const cmd = m[1].trim();
      const t = /\[?--target[\s=]+(?:<[^>]+>|[A-Z][A-Z_-]*)\]?/;
      if (supportsTarget && !target && t.test(cmd)) target = cmd.replace(t, '--target <id>').replace(/\s+\[[^\]]*\]/g, '');
      if (!publish && /--publish[\w-]*\s/.test(cmd)) publish = cmd;
    }
  }
  // While release.sh has no --target, the manifest tool's per-install entry is the way to one Mac.
  let manifestTarget = null;
  try {
    const ut = readFileSync(join(tools, 'update-tool.mjs'), 'utf8');
    if (/--target ID=ENTRY/.test(ut)) {
      manifestTarget =
        'cd app && node tools/update-tool.mjs manifest --app-id sg.nus.chattered --channel study --base <published-manifest.json> --out study-manifest-v1.json --target <id>=<entry.json>';
    }
  } catch {
    /* no update tool in this checkout */
  }
  return {
    targetUsage: target ? `cd app && ${target}` : null,
    publishUsage: publish ? `cd app && ${publish}` : null,
    manifestTargetUsage: manifestTarget,
  };
}

const BOLD = process.stdout.isTTY ? (s) => `\x1b[1m${s}\x1b[0m` : (s) => s;
const MARK = { act: 'ACT ', warn: 'WARN', info: 'info' };

async function main() {
  const o = args(process.argv.slice(2));
  const wire = await loadWire();
  const raw = readPaste(o.file);
  const r = wire.parseReport(raw);
  const usage = releaseUsage();
  let published = null;
  try {
    published = await publishedBuild(o);
  } catch (err) {
    console.error(`debug-read: could not read the published build: ${err.message}`);
  }
  const findings = wire.diagnose(r, { ...usage, publishedBuild: published });

  if (o.json) {
    process.stdout.write(`${JSON.stringify({ report: r, findings, published, usage }, null, 2)}\n`);
    process.exit(r.integrity === 'missing' ? 1 : 0);
  }

  const g = (s, k) => r.sections[s]?.[k] ?? '?';
  const integrity = {
    complete: `complete (sum ${r.sumActual} ok)`,
    altered: `ALTERED (sum ${r.sumExpected} expected, ${r.sumActual} computed)`,
    cut: 'CUT OFF (no sum line)',
    missing: 'NOT A REPORT',
  }[r.integrity];
  console.log(BOLD('ChatterED debug report'));
  console.log(`  paste      ${integrity}${r.truncated ? `; shortened on the Mac: ${r.truncated}` : ''}`);
  if (r.integrity !== 'missing') {
    console.log(`  generated  ${g('', 'generated')}`);
    console.log(`  install    ${g('install', 'id')}   first run ${g('install', 'first-run')}   consent ${g('install', 'consent')}`);
    console.log(`  app        ${g('app', 'version')} build ${g('app', 'build')} sha ${g('app', 'sha')}   ${g('app', 'location')}  ${g('app', 'bundle')}`);
    console.log(`  mac        macOS ${g('mac', 'macos')}  ${g('mac', 'model')}  ${g('mac', 'ram')}  free ${g('mac', 'disk-free')}  admin ${g('mac', 'admin')}  apps-writable ${g('mac', 'apps-writable')}`);
    console.log(`  study      ${g('study', 'slot')}  ${g('study', 'spent')}  cap-hit ${g('study', 'cap-hit')}  key ${g('study', 'study-key')}  backend ${g('study', 'backend')}`);
    console.log(`  data       schema ${g('data', 'schema')}  ${g('data', 'db-size')}  quick-check ${g('data', 'quick-check')}  tutorials ${g('data', 'tutorials')}`);
    const update = Object.entries(r.sections.update ?? {}).map(([k, v]) => `${k} ${v}`).join('; ');
    console.log(`  update     ${update || '?'}${published !== null ? `   (published: ${published})` : ''}`);
    console.log(`  last 7d    ${g('problems', '7d')}`);
    if (r.problems.length) {
      console.log(`  recent     ${r.problems.length} warn/error line(s), newest last:`);
      for (const p of r.problems.slice(-8)) console.log(`             ${p.ts} ${p.level} ${p.event} ${p.rest}`);
    }
  }
  console.log('');
  console.log(BOLD(findings.length ? `Diagnosis (${findings.length})` : 'Diagnosis: nothing to act on'));
  for (const f of findings) {
    console.log(`  [${MARK[f.severity]}] ${BOLD(f.title)}`);
    console.log(`         ${f.detail}`);
    console.log(`         -> ${f.action}`);
    if (f.command) console.log(`         $ ${f.command}`);
  }
  if (!usage.targetUsage) {
    console.log('');
    console.log(
      usage.manifestTargetUsage
        ? '  note: tools/release.sh has no per-install --target yet; the commands above write a targeted manifest with tools/update-tool.mjs (then sign and upload it).'
        : '  note: tools/release.sh has no per-install --target yet; rollout commands above publish to everyone.',
    );
  }
  if (published === null) console.log('  note: pass --published <build> (or --manifest <url>) to compare with the newest published build.');
  process.exit(r.integrity === 'missing' ? 1 : 0);
}

main().catch((err) => {
  console.error(`debug-read: ${err.stack ?? err}`);
  process.exit(1);
});
