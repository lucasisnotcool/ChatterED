/**
 * **What the free-form and red-team runners share** (`sim/README.md`): the test folder's files,
 * a build's environment, the learner's view of the notes and of the conversation, and a
 * sitting's cost and models.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openTestDatabase } from '../src/main/db/driver.js';
import { usageIn, type SimRoom } from './harness.js';
import type { FreePersona } from './freelearner.js';
import type { Plan } from './director.js';
import type { TurnEntry } from './export.js';

/** Environment variables a build may set; cleared before each sitting so builds never leak. */
export const BUILD_VARS = ['CHATTERED_MAX_ON_REQUEST', 'CHATTERED_LEGACY_GUARDS_OFF'];

export interface TestFiles {
  plan: Plan & { _?: string };
  personas: Map<string, FreePersona>;
  /** The plan file's first key, written as the first key of every JSON and line of every page. */
  marker: string | null;
}

export function loadTestFiles(dir: string): TestFiles {
  if (!dir) throw new Error('SIM_TESTS is not set: point it at the folder holding llm_judge/plan.json');
  const plan = JSON.parse(readFileSync(join(dir, 'llm_judge', 'plan.json'), 'utf8')) as Plan & { _?: string };
  const raw = JSON.parse(readFileSync(join(dir, 'llm_judge', 'personas.json'), 'utf8')) as { personas: FreePersona[] };
  return { plan, personas: new Map(raw.personas.map((p) => [p.id, p])), marker: plan._ ?? null };
}

export function notebookIdFor(title: string, db: string, outDir: string): string {
  const lookup = (path: string) =>
    execFileSync('sqlite3', [path, `SELECT file_id FROM notes_docs WHERE title = '${title.replace(/'/g, "''")}' LIMIT 1;`], { stdio: 'pipe' })
      .toString()
      .trim();
  try {
    const out = lookup(db);
    if (out) return out;
  } catch {
    /* a sandbox that cannot open the live file: ask the plan to name the id instead */
  }
  const fromEnv = process.env.SIM_NOTEBOOK_ID;
  if (fromEnv) return fromEnv;
  throw new Error(`no notebook titled "${title}" (set SIM_NOTEBOOK_ID); looked in ${db} for ${outDir}`);
}

/** Apply a build's environment, clearing every other build variable. */
export function applyBuild(env: Record<string, string>): void {
  for (const k of BUILD_VARS) delete process.env[k];
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
}

/** The part of the notes the learner has on screen: the lines on the plan's pages, their Q blocks, their own writing. */
export function notesView(sim: SimRoom, pages: number[], cap = 6_000): string {
  const seen = new Set<string>();
  const mine = sim.learnerBlocks();
  const lines: string[] = [];
  for (const e of sim.outline()) {
    const onPage = e.pages.some((p) => pages.includes(p));
    if (!onPage && e.kind !== 'q_block' && !mine.has(e.blockId)) continue;
    const text = e.text.replace(/\s+/g, ' ').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    lines.push(e.kind === 'heading' ? `\n## ${text}` : e.kind === 'q_block' ? `[Max's question in the notes] ${text}` : mine.has(e.blockId) ? `[your note] ${text}` : text);
  }
  const out = lines.join('\n');
  return out.length > cap ? `${out.slice(0, cap)}\n…` : out;
}

/** The conversation as the learner remembers it: who said what, newest last. */
export function conversationText(turns: TurnEntry[], keep = 24): string {
  return turns
    .filter((t) => t.kind !== 'notes_edit' || t.speaker === 'learner')
    .slice(-keep)
    .map((t) => {
      const who = t.speaker === 'learner' ? 'You' : t.speaker;
      if (t.kind === 'button') return `${who}: ${t.text}`;
      const where = t.channel.startsWith('notes') ? ' (in the notes)' : '';
      return `${who}${where}: ${t.text}`;
    })
    .join('\n\n');
}

export interface SittingCost {
  agentCalls: number;
  agentEstUsd: number;
  inputTokens: number;
  outputTokens: number;
  learnerCalls: number;
  learnerTokens: number;
}

export function costOf(outDir: string, since: string, learnerCalls: number, learnerTokens: number): SittingCost | null {
  const path = join(outDir, 'app.db');
  if (!existsSync(path)) return null;
  const db = openTestDatabase(path);
  const u = usageIn(db, since);
  db.close();
  return { agentCalls: u.calls, agentEstUsd: u.estUsd, inputTokens: u.inputTokens, outputTokens: u.outputTokens, learnerCalls, learnerTokens };
}

export function learnerTokens(outDir: string): { calls: number; tokens: number } {
  const path = join(outDir, 'learner.jsonl');
  if (!existsSync(path)) return { calls: 0, tokens: 0 };
  let calls = 0;
  let tokens = 0;
  for (const line of readFileSync(path, 'utf8').split('\n').filter(Boolean)) {
    const row = JSON.parse(line) as { usage?: { promptTokens?: number; completionTokens?: number } };
    calls += 1;
    tokens += (row.usage?.promptTokens ?? 0) + (row.usage?.completionTokens ?? 0);
  }
  return { calls, tokens };
}

export function agentModels(sim: SimRoom): string[] {
  return [...new Set(sim.calls.map((c) => c.model))];
}

