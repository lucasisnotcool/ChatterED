/**
 * **Run the simulation scenarios** (`sim/README.md`).
 *
 *   SIM_SCENARIOS=s1,s2 SIM_REPEATS=2 npx vitest run --config sim/vitest.config.mts
 *   SIM_MODE=outline npx vitest run --config sim/vitest.config.mts    # print the notes' blocks
 *
 * Each run writes into `$SIM_OUT/<stamp>/<scenario>-<n>/`: `transcript.md` (what the learner saw,
 * with each learner move's reason and the mechanical checks), `calls.jsonl` (every prompt and
 * reply), `prompts/` (the directive each Max question and marking turn read last), `events.jsonl`,
 * `main.log` (the room's own log), and `checks.json`.
 */
import { execFileSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { ClaudeCliClient, resolveClaudeBinary } from '../src/main/llm/claude-cli.js';
import type { NotesAnswerQuestionResult, NotesBlockActionResult } from '../src/shared/ipc.js';
import { checkMarks, checkQuestions, directiveOf, isMaxQuestion } from './checks.js';
import { openTestDatabase } from '../src/main/db/driver.js';
import { RATE_CARD, estimateUsd } from '../src/main/cost/rates.js';
import { SimRoom, usageIn, writeJson, type SimMessage } from './harness.js';
import { SimLearner, type LearnerMove } from './learner.js';
import { SCENARIOS, type Scenario, type Step } from './scenarios.js';

const SOURCE_USERDATA = process.env.SIM_USERDATA ?? join(homedir(), 'Library/Application Support/ChatterED');
const SOURCE_DB = process.env.SIM_DB ?? join(SOURCE_USERDATA, 'app.db');
const OUT_ROOT = process.env.SIM_OUT ?? join(tmpdir(), 'chattered-sim');
const STAMP = process.env.SIM_STAMP ?? new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const REPEATS = Number(process.env.SIM_REPEATS ?? '1');
const LEARNER_MODEL = process.env.SIM_LEARNER_MODEL ?? 'sonnet';
const WANTED = (process.env.SIM_SCENARIOS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

interface StepLog {
  step: number;
  do: string;
  line: string;
  threadId: string | null;
  refused: string | null;
  /** The messages this step added: seq in (fromSeq, toSeq]. */
  fromSeq: number;
  toSeq: number;
  moves: (LearnerMove & { via: string; refused: string | null })[];
}

function notebookIdFor(title: string, db: string): string {
  const out = execFileSync('sqlite3', [db, `SELECT file_id FROM notes_docs WHERE title = '${title.replace(/'/g, "''")}' LIMIT 1;`])
    .toString()
    .trim();
  if (!out) throw new Error(`no notebook titled "${title}"`);
  return out;
}

async function runStep(sim: SimRoom, learner: SimLearner, step: Step, index: number): Promise<StepLog> {
  const block =
    step.do === 'lesson'
      ? { blockId: '', text: `lesson: ${step.objective}` }
      : step.do === 'overview'
        ? { blockId: '', text: 'Update overview' }
        : sim.findBlock(step.line);
  const fromSeq = Math.max(0, ...sim.messages().map((m) => m.seq));
  const log: StepLog = { step: index, do: step.do, line: block.text, threadId: null, refused: null, fromSeq, toSeq: fromSeq, moves: [] };
  try {
    await stepBody(sim, learner, step, block, log);
  } finally {
    log.toSeq = Math.max(fromSeq, ...sim.messages().map((m) => m.seq));
  }
  return log;
}

async function stepBody(
  sim: SimRoom,
  learner: SimLearner,
  step: Step,
  block: { blockId: string; text: string },
  log: StepLog,
): Promise<void> {
  const { docId } = sim.doc();

  if (step.do === 'overview') {
    const before = sim.overviewMeta();
    const done = await sim.updateOverview();
    const after = sim.overviewMeta();
    log.refused = done.reason;
    log.line = `Update overview: ${before?.words ?? '?'} of ${before?.wordBudget ?? '?'} words (${before?.genre ?? 'slides, before 2 Oct'}) → ${after?.words ?? '?'} of ${after?.wordBudget ?? '?'} (${after?.genre ?? '?'})`;
    await sim.idle();
    return;
  }

  if (step.do === 'lesson') {
    const objective = (await sim.objectives()).find((o) => o.title.toLowerCase().includes(step.objective.toLowerCase()));
    if (!objective) {
      log.refused = `no objective titled like "${step.objective}"`;
      return;
    }
    log.line = `lesson: ${objective.title}`;
    const started = await sim.call<{ threadId: string }>('progress:start', { fileId: sim.notebookId, objectiveId: objective.objectiveId });
    log.threadId = started.threadId;
    await sim.idle();
    await respondLoop(sim, learner, started.threadId, log.line, step.rounds ?? 3, docId, log);
    return;
  }

  if (step.do === 'ask') {
    const threads = await sim.threads();
    const existing = threads.find((t) => t.blockId === block.blockId);
    if (existing) {
      await sim.call('chat:send', { fileId: sim.notebookId, threadId: existing.threadId, text: step.text });
      log.threadId = existing.threadId;
    } else {
      const opened = await sim.call<{ threadId: string }>('chat:openSpan', {
        fileId: sim.notebookId,
        blockId: block.blockId,
        quote: block.text,
        question: step.text,
      });
      log.threadId = opened.threadId;
    }
    await sim.idle();
    return;
  }

  const started = await sim.call<NotesBlockActionResult>('notes:blockAction', {
    fileId: sim.notebookId,
    docId,
    blockId: block.blockId,
    kind: step.do,
    quote: block.text,
  });
  log.threadId = started.threadId;
  if (!started.accepted) {
    log.refused = started.reason ?? 'refused';
    return;
  }
  await sim.idle();
  if (step.do !== 'quiz') return;

  await respondLoop(sim, learner, started.threadId!, block.text, step.rounds ?? 3, docId, log);
}

/** The learner's moves on Max's open question in `threadId`, until it closes or `rounds` run out. */
async function respondLoop(
  sim: SimRoom,
  learner: SimLearner,
  threadId: string,
  line: string,
  rounds: number,
  docId: string,
  log: StepLog,
): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    const thread = await sim.thread(threadId);
    const quiz = thread?.quiz ?? null;
    if (!quiz || !quiz.open) break;
    const q = sim.qBlockFor(quiz.questionId);
    const messages = sim.messages(threadId);
    const lastMax = [...messages].reverse().find((m) => isMaxQuestion(m));
    const question = q?.question || lastMax?.body || '';
    const move = await learner.respond({ notes: sim.docText(), line, question, thread: messages });
    let via = move.action as string;
    let refused: string | null = null;
    if (move.action === 'pass') {
      const roomId = sim.roomId();
      await sim.call('quiz:pass', { roomId, threadId });
    } else if (move.action === 'ask') {
      await sim.call('chat:send', { fileId: sim.notebookId, threadId, text: move.text });
      via = 'chat';
    } else if (q) {
      const result = await sim.call<NotesAnswerQuestionResult>('notes:answerQuestion', {
        fileId: sim.notebookId,
        docId,
        questionId: quiz.questionId,
        qBlockId: q.blockId,
        askedBy: 'max',
        question: q.question,
        answerBlockId: q.blockId,
        answer: move.text,
      });
      via = 'q_block';
      if (!result.accepted) {
        refused = result.reason ?? 'refused';
        await sim.call('chat:send', { fileId: sim.notebookId, threadId, text: move.text });
        via = 'chat (q_block refused)';
      }
    } else {
      await sim.call('chat:send', { fileId: sim.notebookId, threadId, text: move.text });
      via = 'chat (no q_block)';
    }
    log.moves.push({ ...move, via, refused });
    await sim.idle();
  }
}

function transcript(scenario: Scenario, sim: SimRoom, steps: StepLog[], learner: SimLearner): string {
  const messages = sim.messages();
  const lines = new Map(steps.filter((s) => s.threadId).map((s) => [s.threadId!, s.line]));
  const questions = checkQuestions(messages, lines);
  const marks = checkMarks(messages);
  const flagsAt = new Map<number, string[]>();
  for (const c of [...questions, ...marks]) if (c.flags.length > 0) flagsAt.set(c.seq, c.flags);
  const whyFor = new Map<string, string>();
  for (const s of steps) for (const m of s.moves) if (m.text) whyFor.set(m.text.trim(), `${m.action} via ${m.via}: ${m.why}`);

  const out: string[] = [
    `# ${scenario.id}: ${scenario.title}`,
    '',
    scenario.purpose,
    '',
    `Persona **${learner.persona.id}**: ${learner.persona.summary}`,
    '',
  ];
  for (const s of steps) {
    out.push(`## Step ${s.step + 1}: ${s.do} on "${s.line}"`, '');
    if (s.refused) out.push(`**Refused:** ${s.refused}`, '');
    for (const m of messages.filter((x) => x.seq > s.fromSeq && x.seq <= s.toSeq)) {
      const tag = m.decidedBy ? ` _(${m.decidedBy}${m.kind ? `, ${m.kind}` : ''})_` : '';
      const where = m.threadId !== s.threadId ? ` [in ${m.threadId ?? 'room'}]` : '';
      out.push(`**${m.who}** #${m.seq}${tag}${where}`);
      out.push('', m.body.replace(/^/gm, '> '), '');
      const why = m.role === 'learner' ? whyFor.get(m.body.trim()) : undefined;
      if (why) out.push(`_learner: ${why}_`, '');
      const flags = flagsAt.get(m.seq);
      if (flags) out.push(`**checks:** ${flags.join(', ')}`, '');
    }
    for (const m of s.moves.filter((x) => x.action === 'pass')) out.push(`_learner pressed Pass: ${m.why}_`, '');
  }
  const elsewhere = messages.filter((m) => !steps.some((s) => m.seq > s.fromSeq && m.seq <= s.toSeq));
  if (elsewhere.length > 0) {
    out.push('## Messages outside any step', '');
    for (const m of elsewhere) out.push(`**${m.who}** #${m.seq} (${m.threadId ?? 'room'}, ${m.decidedBy ?? ''}): ${m.body}`, '');
  }
  out.push('## Mechanical checks', '', '| seq | words | ? | line overlap | like earlier | flags | question |', '|---|---|---|---|---|---|---|');
  for (const q of questions) {
    out.push(
      `| ${q.seq} | ${q.words} | ${q.questionMarks} | ${q.lineOverlap.toFixed(2)} | ${q.priorOverlap.toFixed(2)}${q.priorSeq ? ` (#${q.priorSeq})` : ''} | ${q.flags.join(' ')} | ${q.question.replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 140)} |`,
    );
  }
  out.push('', '| seq | verdict | words | flags |', '|---|---|---|---|');
  for (const m of marks) out.push(`| ${m.seq} | ${m.verdict ?? `(${m.opener})`} | ${m.words} | ${m.flags.join(' ')} |`);
  const errors = sim.calls.filter((c) => c.error);
  out.push('', `LLM calls: ${sim.calls.length} (${errors.length} failed).`);
  writeJson(join(sim.outDir, 'checks.json'), { questions, marks });
  return out.join('\n');
}

/** The directive each Max question and marking turn read last, one file per message. */
function writePrompts(sim: SimRoom, messages: SimMessage[]): void {
  const dir = join(sim.outDir, 'prompts');
  mkdirSync(dir, { recursive: true });
  const turns = new Map<string, string>();
  const roomId = sim.roomId();
  if (!roomId) return;
  for (const m of messages.filter((x) => x.role === 'max' || x.role === 'ellie')) {
    const call = [...sim.calls].reverse().find((c) => c.scope === 'group' && c.reply !== null && m.body.startsWith(c.reply.trim().slice(0, 40)));
    if (!call) continue;
    turns.set(`${String(m.seq).padStart(3, '0')}-${m.role}`, `${call.system.slice(-6000)}\n\n=====DIRECTIVE=====\n\n${directiveOf(call)}`);
  }
  for (const [name, text] of turns) writeFileSync(join(dir, `${name}.txt`), text);
}

const selected = SCENARIOS.filter((s) => WANTED.length === 0 || WANTED.includes(s.id));

interface Cost {
  agentCalls: number;
  agentUsd: number;
  learnerCalls: number;
  learnerUsd: number;
  /** Learner calls from runs before usage was recorded, priced from their prompt length instead. */
  learnerEstimatedFromLength: number;
  tokens: { input: number; output: number; cacheWrite: number; cacheRead: number };
}

/**
 * **What one sitting cost**, as API-equivalent dollars. The agents' calls are the app's own
 * `llm_usage` rows in the run's database copy (its rate card, `cost/rates.ts`); the learner's are
 * priced on the same card. A learner call from before its usage was logged is priced from its
 * prompt and reply length (4 characters a token, all input uncached), and counted as such.
 */
function sittingCost(dir: string): Cost | null {
  const callsPath = join(dir, 'calls.jsonl');
  if (!existsSync(callsPath) || !existsSync(join(dir, 'app.db'))) return null;
  const first = readFileSync(callsPath, 'utf8').split('\n').find(Boolean);
  if (!first) return null;
  const since = new Date(Date.parse((JSON.parse(first) as { at: string }).at) - 60_000).toISOString();
  const db = openTestDatabase(join(dir, 'app.db'));
  const agents = usageIn(db, since);
  db.close();
  const cost: Cost = {
    agentCalls: agents.calls,
    agentUsd: agents.estUsd,
    learnerCalls: 0,
    learnerUsd: 0,
    learnerEstimatedFromLength: 0,
    tokens: { input: agents.inputTokens, output: agents.outputTokens, cacheWrite: agents.cacheWriteTokens, cacheRead: agents.cacheReadTokens },
  };
  const learnerPath = join(dir, 'learner.jsonl');
  if (existsSync(learnerPath)) {
    for (const line of readFileSync(learnerPath, 'utf8').split('\n').filter(Boolean)) {
      const row = JSON.parse(line) as { estUsd?: number; usage?: Record<string, number>; user: string; reply: string };
      cost.learnerCalls += 1;
      if (typeof row.estUsd === 'number' && row.usage) {
        cost.learnerUsd += row.estUsd;
        cost.tokens.input += row.usage.input_tokens ?? 0;
        cost.tokens.output += row.usage.output_tokens ?? 0;
        cost.tokens.cacheWrite += row.usage.cache_creation_input_tokens ?? 0;
        cost.tokens.cacheRead += row.usage.cache_read_input_tokens ?? 0;
      } else {
        const input = Math.round((row.user.length + 2_000) / 4);
        const output = Math.round(row.reply.length / 4);
        cost.learnerUsd += estimateUsd('claude-sonnet-5', { input, output, cacheWrite: 0, cacheRead: 0 }, RATE_CARD, 'claude-cli').usd;
        cost.learnerEstimatedFromLength += 1;
        cost.tokens.input += input;
        cost.tokens.output += output;
      }
    }
  }
  return cost;
}

function addCost(a: Cost, b: Cost): Cost {
  return {
    agentCalls: a.agentCalls + b.agentCalls,
    agentUsd: a.agentUsd + b.agentUsd,
    learnerCalls: a.learnerCalls + b.learnerCalls,
    learnerUsd: a.learnerUsd + b.learnerUsd,
    learnerEstimatedFromLength: a.learnerEstimatedFromLength + b.learnerEstimatedFromLength,
    tokens: {
      input: a.tokens.input + b.tokens.input,
      output: a.tokens.output + b.tokens.output,
      cacheWrite: a.tokens.cacheWrite + b.tokens.cacheWrite,
      cacheRead: a.tokens.cacheRead + b.tokens.cacheRead,
    },
  };
}

const ZERO: Cost = { agentCalls: 0, agentUsd: 0, learnerCalls: 0, learnerUsd: 0, learnerEstimatedFromLength: 0, tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 } };

describe('simulation', () => {
  if (process.env.SIM_MODE === 'cost') {
    it('totals what every run under SIM_OUT cost', () => {
      const batches: Record<string, Cost & { sittings: number }> = {};
      const dirs = (path: string) => readdirSync(path, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
      for (const stamp of dirs(OUT_ROOT)) {
        for (const sitting of dirs(join(OUT_ROOT, stamp))) {
          const cost = sittingCost(join(OUT_ROOT, stamp, sitting));
          if (!cost) continue;
          const prev = batches[stamp] ?? { ...ZERO, sittings: 0 };
          batches[stamp] = { ...addCost(prev, cost), sittings: prev.sittings + 1 };
        }
      }
      const total = Object.values(batches).reduce((a, b) => ({ ...addCost(a, b), sittings: a.sittings + b.sittings }), { ...ZERO, sittings: 0 });
      writeJson(join(OUT_ROOT, 'cost-summary.json'), { batches, total });
    });
    return;
  }

  if (process.env.SIM_MODE === 'outline') {
    it('prints the notes outline', async () => {
      const title = SCENARIOS[0]!.notebook;
      const sim = await SimRoom.open({
        sourceDb: SOURCE_DB,
        sourceUserData: SOURCE_USERDATA,
        notebookId: notebookIdFor(title, SOURCE_DB),
        outDir: join(OUT_ROOT, STAMP, 'outline'),
      });
      const rows = sim.outline().map((e) => `${e.blockId}\t${e.kind}\tp.${e.pages.join(',')}\t${e.text.slice(0, 160)}`);
      writeFileSync(join(sim.outDir, 'outline.tsv'), `${rows.join('\n')}\n`);
      sim.dispose();
    });
    return;
  }

  for (const scenario of selected) {
    for (let n = 1; n <= REPEATS; n += 1) {
      it(`${scenario.id} #${n}: ${scenario.title}`, async () => {
        const outDir = join(OUT_ROOT, STAMP, `${scenario.id}-${n}`);
        const sim = await SimRoom.open({
          sourceDb: SOURCE_DB,
          sourceUserData: SOURCE_USERDATA,
          notebookId: notebookIdFor(scenario.notebook, SOURCE_DB),
          outDir,
        });
        const binary = resolveClaudeBinary();
        if (!binary) throw new Error('the Claude CLI was not found');
        const learner = new SimLearner(scenario.persona, new ClaudeCliClient({ binary }), outDir, LEARNER_MODEL);
        const steps: StepLog[] = [];
        writeFileSync(join(outDir, 'notes-before.md'), sim.docText());
        try {
          for (const [i, step] of scenario.steps.entries()) {
            const log = await runStep(sim, learner, step, i);
            steps.push(log);
            writeJson(join(outDir, 'steps.json'), steps);
          }
        } finally {
          writeFileSync(join(outDir, 'transcript.md'), transcript(scenario, sim, steps, learner));
          writePrompts(sim, sim.messages());
          writeFileSync(join(outDir, 'notes-after.md'), sim.docText());
          const cost = sittingCost(outDir);
          if (cost) writeJson(join(outDir, 'cost.json'), cost);
          sim.dispose();
          console.log(`wrote ${outDir}`);
        }
      });
    }
  }
});
