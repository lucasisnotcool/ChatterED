// node take.mjs <port> <profileDir> <outDir> [--probe]
// The filmed walk-through of the grading copy: first launch to a revealed answer, in one take.
import { ev, W, log, press, pressPart, typeSlot, typeThread, reply, agentCount, status, click, partJs, startRecording, stopRecording } from './film.mjs';

const probe = process.argv.includes('--probe');
const has = (label) => ev(`!![...document.querySelectorAll("button")].find(b=>b.offsetParent&&b.innerText.trim()===${JSON.stringify(label)})`);
const choose = async (n, letter) => {
  const r = await ev(`(()=>{const p=${partJs(n)};const l=[...p.querySelectorAll(".nd-tut-choice")].find(l=>l.querySelector(".nd-tut-choice-id").innerText.trim().startsWith(${JSON.stringify(letter)}));l.scrollIntoView({block:"center"});const q=l.getBoundingClientRect();return {x:q.left+14,y:q.top+q.height/2}})()`);
  await W(300); await click(r.x, r.y); await W(1200);
  log('chose', letter, 'on', n);
};
const act = async (fn, opts) => { const b = agentCount(); await fn(); await reply(b, opts); log('status', await status()); };

await startRecording();

if (probe) {
  if (await has('Got it')) await press('Got it', { exact: true });
  await W(1500);
  log('labels', await status());
  await stopRecording();
  process.exit(0);
}

// ── First launch: the notice, the tour, the sample ──────────────────────────
await W(10000);
await press('Continue', { exact: true });
for (let card = 1; card <= 4; card++) { await W(card === 2 ? 14000 : 10000); await press('Next', { exact: true }); }
await W(9000);
await press('Try the sample tutorial');
// The sample ships already read, so it opens at once. (Without its seed it is read live, the
// lecture first and then the sheet, in about a minute: the loop waits for either.)
for (let i = 0; i < 420; i++) { if ((await ev('document.querySelectorAll(".nd-tut-part").length').catch(() => 0)) >= 6) break; await W(1000); }
log('sheet is in');
await W(7000);
if (await has('Got it')) { await press('Got it', { exact: true }); await W(2500); }

const Q1A = '^(Q|Question )?\\s*1\\W*a', Q3 = '^(Q|Question )?\\s*3', Q4 = '^(Q|Question )?\\s*4', Q5 = '^(Q|Question )?\\s*5';
log('labels', await status());

// ── Q1 (a): a wrong answer (the DFS order), two hints, off-topic and ambiguous messages, the repair ──
await typeSlot(Q1A, 'A, C, B, D, G, F, E');
await act(() => pressPart(Q1A, 'Check answer'), { hold: 11000 });
await act(() => pressPart(Q1A, 'Hint'), { hold: 10000 });
await act(() => pressPart(Q1A, 'Hint'), { hold: 12000 });
await act(() => typeThread('Any good bubble tea near NUS?'), { hold: 7000 });
await act(() => typeThread('this one?'), { hold: 7000 });
await typeSlot(Q1A, 'A, C, E, B, F, D, G');
await act(() => pressPart(Q1A, 'Check answer'), { hold: 10000 });

// ── Q3: a choice part, wrong then right ──
await choose(Q3, 'A');
await act(() => pressPart(Q3, 'Check answer'), { hold: 9000 });
await choose(Q3, 'B');
await act(() => pressPart(Q3, 'Check answer'), { hold: 9000 });

// ── Q4: a Refresher before trying ──
await act(() => pressPart(Q4, 'Refresher'), { hold: 12000 });

// ── Q5: a wrong answer, then Show answer, then a line in the student's own words ──
await typeSlot(Q5, 'O(V^2), because every vertex looks at every other vertex.');
await act(() => pressPart(Q5, 'Check answer'), { hold: 10000 });
await pressPart(Q5, 'Show answer');
await W(3500);
await act(() => pressPart(Q5, 'Show it'), { hold: 13000 });
await act(() => typeThread('Each vertex is visited once and each edge is looked at at most twice, so the work adds up to V + E.'), { hold: 10000 });

await ev('document.querySelector(".nd-tut-part")?.scrollIntoView({block:"start"})');
await W(5000);
const secs = await stopRecording();
log('done', Math.round(secs), 's');
process.exit(0);
