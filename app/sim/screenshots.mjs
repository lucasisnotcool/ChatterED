// Screenshots of recorded sittings in the running app (`sim/README.md`, "Screenshots").
//
//   node sim/screenshots.mjs --app <built app dir> --runs <folder of run .json> --out <folder> [--only id,id]
//
// For each run JSON (from conversations.sim.ts or redteam.sim.ts, run with SIM_KEEP_DB=1 so its
// database copy is still there), this copies the run's database and sources into a scratch
// profile, launches the built app on it (`--user-data-dir`), opens the run's notebook, and for
// each of the learner's typed turns finds it on screen (the doc chat, or a line's thread opened
// from its highlight), scrolls it to the top of the chat and saves a PNG of the window. It drives
// the window over the DevTools protocol; nothing in the app is changed for it. The app needs to
// be built first (`npm run build:main && npx vite build` in <built app dir>).
/* global WebSocket */
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const appDir = resolve(args.app ?? '.');
const runsDir = resolve(args.runs);
const outDir = resolve(args.out);
const only = (args.only ?? '').split(',').filter(Boolean);
const port = Number(args.port ?? 9333);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(outDir, { recursive: true });

const electron = (await import(join(appDir, 'node_modules/electron/index.js'))).default;

async function session(profile) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CHATTERED_DEV_SERVER;
  const child = spawn(electron, [appDir, `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`], { env, stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 60 && !target; i += 1) {
    await sleep(1000);
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page');
    } catch {
      /* not up yet */
    }
  }
  if (!target) {
    child.kill();
    throw new Error('the app window did not come up');
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });
  const send = (method, params = {}) =>
    new Promise((r) => {
      id += 1;
      pending.set(id, r);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const ev = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  const shot = async (path) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path, Buffer.from(r.result.data, 'base64'));
  };
  return { child, ws, send, ev, shot };
}

/** Click the leaf element whose text is exactly `text`, or its nearest clickable ancestor. */
const clickText = (text) => `(() => {
  const el = [...document.querySelectorAll('*')].find((n) => n.children.length === 0 && n.textContent.trim() === ${JSON.stringify(text)});
  if (!el) return false;
  let c = el;
  for (let i = 0; i < 6 && c; i++) { if (c.tagName === 'BUTTON' || c.getAttribute('role') === 'button' || c.tagName === 'A') break; c = c.parentElement; }
  (c ?? el).click();
  return true;
})()`;

/** Scroll the smallest element holding `needle` to the top of its scroller. */
const reveal = (needle) => `(() => {
  const all = [...document.querySelectorAll('body *')].filter((n) => n.innerText && n.innerText.includes(${JSON.stringify(needle)}));
  if (all.length === 0) return false;
  const el = all.reduce((a, b) => (a.innerText.length <= b.innerText.length ? a : b));
  el.scrollIntoView({ block: 'start' });
  return true;
})()`;

const spans = `document.querySelectorAll('.nd-threadspan').length`;
const clickSpan = (i) => `(() => { const s = document.querySelectorAll('.nd-threadspan')[${i}]; if (!s) return false; s.click(); return true; })()`;

const files = readdirSync(runsDir).filter((f) => f.endsWith('.json')).sort();
for (const f of files) {
  const run = JSON.parse(readFileSync(join(runsDir, f), 'utf8'));
  if (only.length > 0 && !only.includes(run.id)) continue;
  const raw = run.rawRun;
  if (!raw || !existsSync(join(raw, 'app.db'))) {
    console.log(`${run.id}: no database copy (run with SIM_KEEP_DB=1)`);
    continue;
  }
  const profile = mkdtempSync(join(tmpdir(), 'chattered-shot-'));
  cpSync(join(raw, 'app.db'), join(profile, 'app.db'));
  if (existsSync(join(raw, 'userData', 'notebooks'))) cpSync(join(raw, 'userData', 'notebooks'), join(profile, 'notebooks'), { recursive: true });
  const s = await session(profile);
  try {
    await s.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
    await sleep(3000);
    await s.ev(clickText(run.notebook ?? 'CS3249+Lecture+4'));
    await sleep(5000);
    await s.ev(clickText('Not now'));
    // Typed turns, and the learner's own writing in the notes (found in the notes column).
    const typed = (run.turns ?? []).filter((t) => t.speaker === 'learner' && (t.kind === 'message' || t.kind === 'notes_edit'));
    let n = 0;
    for (const t of typed) {
      const needle = t.text.trim().slice(0, 50);
      let found = await s.ev(reveal(needle));
      for (let i = 0; !found && i < ((await s.ev(spans)) ?? 0); i += 1) {
        await s.ev(clickSpan(i));
        await sleep(1200);
        found = await s.ev(reveal(needle));
      }
      if (!found) {
        console.log(`${run.id}: turn ${t.n} not found on screen`);
        continue;
      }
      await sleep(800);
      n += 1;
      const path = join(outDir, `${run.id}-turn${String(t.n).padStart(2, '0')}.png`);
      await s.shot(path);
      console.log(`${run.id}: ${path}`);
    }
    if (n === 0) await s.shot(join(outDir, `${run.id}-overview.png`));
  } finally {
    s.ws.close();
    s.child.kill();
    await sleep(1500);
    if (!args.keep) rmSync(profile, { recursive: true, force: true });
  }
}
