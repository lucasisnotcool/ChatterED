// One continuous take of the grading copy, recorded from the app's own window through the
// DevTools protocol (Page.startScreencast), while this script drives the real interface.
//
//   node film.mjs <port> <profileDir> <outDir> [--dry]
//
// Frames are saved with their real timestamps; ffmpeg joins them afterwards at their real
// durations. Nothing is cut, sped up or reordered.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const [port, profile, outDir] = process.argv.slice(2);
const DB = `${profile}/app.db`;
fs.mkdirSync(`${outDir}/frames`, { recursive: true });

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((t) => t.type === 'page' && t.url.includes('index.html')) ?? targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const frames = [];
let recording = false;
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Page.screencastFrame') {
    const { data, metadata, sessionId } = m.params;
    ws.send(JSON.stringify({ id: ++id, method: 'Page.screencastFrameAck', params: { sessionId } }));
    if (!recording) return;
    const n = String(frames.length).padStart(6, '0');
    fs.writeFileSync(`${outDir}/frames/f${n}.jpg`, Buffer.from(data, 'base64'));
    frames.push({ file: `frames/f${n}.jpg`, t: metadata.timestamp });
  }
};
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'eval failed');
  return r.result?.result?.value;
};
const W = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const click = async (x, y) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); };
const key = async (k, code, text) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: code, ...(text ? { text } : {}) });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code });
};
/** Type at a human pace, so the viewer can see what is being typed. */
const typeOut = async (text) => {
  for (const word of text.match(/\S+\s*/g) ?? []) { await send('Input.insertText', { text: word }); await W(90); }
};
const rows = (sql) => { const s = execFileSync('sqlite3', ['-readonly', '-json', DB, sql], { encoding: 'utf8' }).trim(); return s ? JSON.parse(s) : []; };
const agentCount = () => rows("select count(*) c from messages m join participants p on p.id=m.participant_id where p.display_name<>'You'")[0]?.c ?? 0;

/** Press a visible button by its text, anywhere on the page. */
const press = async (label, { within = 'document', exact = false } = {}) => {
  const r = await ev(`(()=>{const root=${within};const b=[...root.querySelectorAll("button")].find(b=>b.offsetParent&&(${exact}?b.innerText.trim()===${JSON.stringify(label)}:b.innerText.trim().startsWith(${JSON.stringify(label)}))&&!b.disabled);if(!b)return {missing:[...root.querySelectorAll("button")].filter(b=>b.offsetParent).map(b=>b.innerText.trim()).slice(0,30)};b.scrollIntoView({block:"center"});const q=b.getBoundingClientRect();return {x:q.left+q.width/2,y:q.top+q.height/2}})()`);
  if (r.missing) throw new Error(`no button "${label}"; visible: ${JSON.stringify(r.missing)}`);
  await W(250);
  await click(r.x, r.y);
  log('pressed', label);
};
// A part is addressed by a regular expression on its label (data-label), e.g. "1.*a" for Q1 (a).
const partJs = (rx) => `([...document.querySelectorAll(".nd-tut-part")].find(p=>new RegExp(${JSON.stringify(rx)},"i").test(p.dataset.label||"")))`;
const pressPart = (n, label) => press(label, { within: partJs(n) });
const typeSlot = async (n, text) => {
  const r = await ev(`(()=>{const p=${partJs(n)};const s=p.querySelector(".nd-tut-slot");s.scrollIntoView({block:"center"});const q=s.getBoundingClientRect();return {x:q.left+30,y:q.top+q.height/2}})()`);
  await W(300);
  await click(r.x, r.y); await W(200);
  await ev(`(()=>{const s=${partJs(n)}.querySelector(".nd-tut-slot");const rg=document.createRange();rg.selectNodeContents(s);const sel=getSelection();sel.removeAllRanges();sel.addRange(rg);document.dispatchEvent(new Event("selectionchange"))})()`);
  await W(150);
  await key('Backspace', 8);
  await typeOut(text);
  await W(1600); // the slot saves on a short pause
  log('slot', n, JSON.stringify(await ev(`${partJs(n)}.querySelector(".nd-tut-slot").innerText`)));
};
const typeThread = async (text) => {
  const r = await ev(`(()=>{const t=[...document.querySelectorAll("textarea")].find(e=>e.offsetParent);t.scrollIntoView({block:"center"});const q=t.getBoundingClientRect();return {x:q.left+20,y:q.top+15}})()`);
  await click(r.x, r.y); await W(200);
  await typeOut(text); await W(500);
  await key('Enter', 13, '\r');
  log('sent', JSON.stringify(text));
};
/** Wait for `n` more agent messages, then for the text to stop growing, then hold so it can be read. */
const reply = async (before, { n = 1, hold = 9000, timeout = 120000 } = {}) => {
  const start = Date.now();
  while (agentCount() < before + n) { if (Date.now() - start > timeout) throw new Error('no reply in time'); await W(1000); }
  let last = '', still = 0;
  while (still < 3) { await W(1000); const now = await ev('document.body.innerText.length'); still = now === last ? still + 1 : 0; last = now; }
  log('reply after', Math.round((Date.now() - start) / 1000), 's');
  await W(hold);
};
const status = () => ev(`[...document.querySelectorAll(".nd-tut-part")].map(p=>(p.dataset.label||"?")+":"+(p.querySelector(".nd-tut-status")?.innerText||"?")).join(" | ")`).catch(() => '?');

export { ev, send, W, log, press, pressPart, typeSlot, typeThread, reply, agentCount, status, click, key, partJs };

export async function startRecording() {
  await send('Page.enable');
  recording = true;
  await send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });
  log('recording');
}
export async function stopRecording() {
  await W(2500);
  await send('Page.stopScreencast');
  recording = false;
  // Join the frames at their real durations.
  const lines = ['ffconcat version 1.0'];
  for (let i = 0; i < frames.length; i++) {
    const d = i + 1 < frames.length ? Math.max(0.001, frames[i + 1].t - frames[i].t) : 2;
    lines.push(`file '${frames[i].file}'`, `duration ${d.toFixed(4)}`);
  }
  lines.push(`file '${frames[frames.length - 1].file}'`);
  fs.writeFileSync(`${outDir}/frames.ffconcat`, lines.join('\n') + '\n');
  const secs = frames.length ? frames[frames.length - 1].t - frames[0].t + 2 : 0;
  log('frames', frames.length, 'length', Math.round(secs), 's');
  ws.close();
  return secs;
}
