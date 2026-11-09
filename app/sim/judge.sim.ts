/**
 * **Judge the exported conversations, or build a blind labelling sheet** (`sim/README.md`,
 * "Judging transcripts").
 *
 *   SIM_TESTS=<dir> JUDGE_VERSION=v1 soclaas run -- npx vitest run --config sim/vitest.config.mts sim/judge.sim.ts
 *   SIM_TESTS=<dir> SIM_MODE=sheet npx vitest run --config sim/vitest.config.mts sim/judge.sim.ts
 *
 * Reads `<dir>/llm_judge/conversations/*.json` and `<dir>/llm_judge/prompts/<version>/<C>.md`.
 * Writes one verdict file per conversation and criterion, and `verdicts.csv`, to
 * `<dir>/llm_judge/verdicts/<version>/`. The sheet mode writes `<dir>/llm_judge/labelling/sheet.html`
 * (every conversation, the criteria, PASS/FAIL boxes; no verdicts) and a `labels.csv` template.
 *
 * | Variable | |
 * |---|---|
 * | `JUDGE_VERSION` | the prompt folder (default `v1`) |
 * | `JUDGE_CRITERIA` | comma-separated criteria (default: every `.md` in the folder) |
 * | `JUDGE_CONVS` | comma-separated conversation ids (default: all) |
 * | `JUDGE_PARALLEL` | calls in flight at once (default 3) |
 * | `SIM_JUDGE_MODELS` | the judge's models (default `qwen3.8:27b`) |
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { judgeOne, judgeTranscript, type JudgedRecord } from './judge.js';
import type { TurnEntry } from './export.js';

const TESTS = process.env.SIM_TESTS ?? '';
const VERSION = process.env.JUDGE_VERSION ?? 'v1';
const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

interface Conv {
  _?: string;
  id: string;
  turns: TurnEntry[];
  questions?: { quizMessageId: string; questionText: string | null; form: string | null; keyPoints: string[] }[];
}

function loadConversations(dir: string): Conv[] {
  const wanted = list(process.env.JUDGE_CONVS);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Conv)
    .filter((c) => wanted.length === 0 || wanted.includes(c.id));
}

/** The marker the test folder carries, from the plan file's first key. */
function markerOf(tests: string): string | null {
  const path = join(tests, 'llm_judge', 'plan.json');
  if (!existsSync(path)) return null;
  return (JSON.parse(readFileSync(path, 'utf8')) as { _?: string })._ ?? null;
}

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.max(1, n) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item);
    }),
  );
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** The criterion's title and rules, for the sheet: the prompt file up to its transcript slot. */
function criterionText(template: string): string {
  // Up to the judge's own output instructions, which are not for a person labelling.
  const body = template.split('{{TRANSCRIPT}}')[0]!.replace(/^<!--.*?-->\s*/s, '');
  const cut = body.search(/\n(In `evidence_turns`|Reply with one JSON object)/);
  return (cut >= 0 ? body.slice(0, cut) : body).trim();
}

function sheetHtml(convs: Conv[], criteria: { id: string; text: string }[], marker: string | null): string {
  const css = `
  @page { size: A4; margin: 14mm 13mm; }
  :root { --ink:#111; --mid:#555; --rule:#bbb; --fill:#eee; }
  body { font: 9.5pt/1.4 "Helvetica Neue", Helvetica, Arial, sans-serif; color: var(--ink); background:#fff; margin: 0 auto; max-width: 190mm; padding: 6mm 16px; }
  h1 { font-size: 15pt; margin: 0 0 2mm; } h2 { font-size: 12pt; border-bottom: 1.5px solid var(--ink); padding-bottom: 1mm; margin: 6mm 0 2mm; }
  .crit { border: 1px solid var(--rule); padding: 2mm 3mm; margin: 2mm 0; white-space: pre-wrap; font-size: 8.8pt; }
  .conv { break-before: page; } .conv:first-of-type { break-before: auto; }
  .turn { margin: 1.5mm 0; padding: 1mm 2mm; border-left: 3px solid var(--rule); break-inside: avoid; }
  .turn.learner { border-left: 3px solid var(--ink); background: var(--fill); }
  .turn.button { border-left: 3px dashed var(--ink); }
  .who { font-weight: 700; } .tags { color: var(--mid); font-size: 8.4pt; }
  .text { white-space: pre-wrap; margin-top: .5mm; }
  .key { border: 1.5px dashed var(--ink); padding: 2mm 3mm; margin: 3mm 0; font-size: 8.8pt; break-inside: avoid; }
  table.label { border-collapse: collapse; width: 100%; margin-top: 3mm; break-inside: avoid; }
  table.label td, table.label th { border: 1px solid var(--ink); padding: 2mm; text-align: left; vertical-align: top; }
  .box { display: inline-block; width: 4mm; height: 4mm; border: 1.5px solid var(--ink); vertical-align: middle; margin: 0 1mm 0 3mm; }
  .note { height: 10mm; }
  `;
  const out: string[] = [];
  if (marker) out.push(`<!-- ${marker} -->`);
  out.push('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">', '<title>Judge Labelling Sheet</title>', `<style>${css}</style></head><body>`);
  out.push('<h1>Labelling sheet: one PASS or FAIL per criterion, per conversation</h1>');
  out.push(`<p>${String(convs.length)} conversations. Label each one on every criterion from the transcript alone, before looking at any judge verdict. Record the labels in <code>labels.csv</code> (conv_id, C1, C2, C3, note).</p>`);
  out.push('<h2>The criteria</h2>');
  for (const c of criteria) out.push(`<div class="crit"><b>${esc(c.id)}</b>\n${esc(c.text)}</div>`);
  for (const conv of convs) {
    out.push(`<section class="conv"><h2>Conversation ${esc(conv.id)}</h2>`);
    for (const t of conv.turns) {
      const tags: string[] = [t.channel];
      if (t.questionForm) tags.push(`asks a question (${t.questionForm === 'cloze' ? 'fill-in-the-blank' : 'open'})`);
      if (t.verdict) tags.push(`verdict: ${t.verdict}`);
      if (t.released) tags.push('releases the answer');
      if (t.speaker === 'learner' && t.move) tags.push(t.move);
      const cls = t.speaker === 'learner' ? (t.kind === 'button' ? 'turn learner button' : 'turn learner') : 'turn';
      out.push(`<div class="${cls}"><span class="who">${String(t.n)}. ${esc(t.speaker === 'learner' ? 'Learner' : t.speaker)}</span> <span class="tags">${esc(tags.join('; '))}</span><div class="text">${esc(t.text)}</div></div>`);
    }
    const qs = conv.questions ?? [];
    out.push('<div class="key"><b>Max\'s questions and their hidden key points</b> (the learner never saw these)<ol>');
    for (const q of qs) out.push(`<li>${esc(q.questionText ?? '(text not stored)')}<ul>${q.keyPoints.map((p) => `<li>${esc(p)}</li>`).join('') || '<li>(no key points stored)</li>'}</ul></li>`);
    out.push('</ol></div>');
    out.push('<table class="label"><tr><th>Criterion</th><th>Your label</th></tr>');
    for (const c of criteria) out.push(`<tr><td>${esc(c.id)}</td><td><span class="box"></span>PASS <span class="box"></span>FAIL</td></tr>`);
    out.push('<tr><td>Note</td><td class="note"></td></tr></table></section>');
  }
  out.push('</body></html>');
  return out.join('\n');
}

describe('judge', () => {
  if (!TESTS) {
    it.skip('needs SIM_TESTS', () => undefined);
    return;
  }
  const convDir = process.env.SIM_CONV_OUT ?? join(TESTS, 'llm_judge', 'conversations');
  const promptDir = join(TESTS, 'llm_judge', 'prompts', VERSION);
  const criteriaWanted = list(process.env.JUDGE_CRITERIA);
  const criteria = readdirSync(promptDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''))
    .filter((c) => criteriaWanted.length === 0 || criteriaWanted.includes(c))
    .sort();
  const marker = markerOf(TESTS);

  if (process.env.SIM_MODE === 'sheet') {
    it('writes the blind labelling sheet', () => {
      const convs = loadConversations(convDir);
      const dir = process.env.SHEET_OUT ?? join(TESTS, 'llm_judge', 'labelling');
      mkdirSync(dir, { recursive: true });
      const defs = criteria.map((id) => ({ id, text: criterionText(readFileSync(join(promptDir, `${id}.md`), 'utf8')) }));
      writeFileSync(join(dir, 'sheet.html'), sheetHtml(convs, defs, marker));
      const csv = [`conv_id,${criteria.join(',')},note`, ...convs.map((c) => `${c.id},${criteria.map(() => '').join(',')},`)];
      if (marker) csv.unshift(`# ${marker}`);
      const labels = join(dir, 'labels.csv');
      if (!existsSync(labels)) writeFileSync(labels, `${csv.join('\n')}\n`);
      console.log(`wrote ${join(dir, 'sheet.html')} (${String(convs.length)} conversations)`);
    });
    return;
  }

  if (process.env.SIM_MODE === 'show') {
    it('prints one transcript as the judge reads it', () => {
      for (const c of loadConversations(convDir)) console.log(judgeTranscript(c));
    });
    return;
  }

  it(`judges every conversation on ${criteria.join(', ')} with prompts ${VERSION}`, async () => {
    const convs = loadConversations(convDir);
    const outDir = process.env.JUDGE_OUT ?? join(TESTS, 'llm_judge', 'verdicts', VERSION);
    mkdirSync(outDir, { recursive: true });
    const templates = new Map(criteria.map((c) => [c, readFileSync(join(promptDir, `${c}.md`), 'utf8')]));
    const jobs = convs.flatMap((conv) => criteria.map((criterion) => ({ conv, criterion })));
    const done: JudgedRecord[] = [];
    const failed: string[] = [];
    await pool(jobs, Number(process.env.JUDGE_PARALLEL ?? '3'), async ({ conv, criterion }) => {
      try {
        const rec = await judgeOne({ conversation: conv.id, criterion, promptVersion: VERSION, template: templates.get(criterion)!, conv });
        done.push(rec);
        const body = marker ? { _: marker, ...rec } : rec;
        writeFileSync(join(outDir, `${conv.id}.${criterion}.json`), `${JSON.stringify(body, null, 2)}\n`);
      } catch (err) {
        failed.push(`${conv.id}.${criterion}: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
    // Every verdict file in the folder, so a partial rerun still leaves a whole table.
    const all = readdirSync(outDir)
      .filter((f) => /^[^.]+\.[^.]+\.json$/.test(f))
      .map((f) => JSON.parse(readFileSync(join(outDir, f), 'utf8')) as JudgedRecord)
      .filter((r) => r.conversation && r.criterion)
      .sort((a, b) => a.conversation.localeCompare(b.conversation) || a.criterion.localeCompare(b.criterion));
    const rows = [
      ...(marker ? [`# ${marker}`] : []),
      'conv_id,criterion,verdict,evidence_turns,model,at,reason',
      ...all.map((r) => [r.conversation, r.criterion, r.verdict, r.evidence_turns.join(' '), r.model, r.at, csvCell(r.reason)].join(',')),
    ];
    writeFileSync(join(outDir, 'verdicts.csv'), `${rows.join('\n')}\n`);
    if (failed.length > 0) writeFileSync(join(outDir, 'errors.log'), `${failed.join('\n')}\n`);
    // Counts only: the verdicts themselves stay in the files.
    console.log(`judged ${String(done.length)} of ${String(jobs.length)} (${String(failed.length)} failed) into ${outDir}`);
  });
});
