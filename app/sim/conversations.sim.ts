/**
 * **Free-form sittings: a simulated learner, a plan, a transcript** (`sim/README.md`, "Free-form
 * runs").
 *
 *   SIM_TESTS=<dir> soclaas run -- npx vitest run --config sim/vitest.config.mts sim/conversations.sim.ts
 *
 * `<dir>` holds `llm_judge/plan.json` (the notebook, its lines, the builds and the conversations)
 * and `llm_judge/personas.json`. Each conversation runs the real app headless (`harness.ts`) under
 * its build's environment, with the free-form learner (`freelearner.ts`) steered by the director
 * (`director.ts`), and is written as `<id>.json` and `<id>.md` to `<dir>/llm_judge/conversations/`
 * (or `SIM_CONV_OUT`). The raw run (every prompt, the events, the room's log) stays under `SIM_OUT`.
 *
 * | Variable | |
 * |---|---|
 * | `SIM_CONVS` | comma-separated conversation ids (default: all) |
 * | `SIM_LEARNER_MODELS` | the learner's models, in order of preference |
 * | `SIM_KEEP_DB` | `1` keeps each run's database copy (hundreds of MB) |
 */
import { homedir, tmpdir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { classifyLearnerTurn } from '../src/core/attempt.js';
import { SimRoom, writeJson } from './harness.js';
import { agentModels, applyBuild, conversationText, costOf, learnerTokens, loadTestFiles, notebookIdFor, notesView } from './runsupport.js';
import { FreeLearner, LEARNER_MODELS, LEARNER_TEMPERATURE, type FreeMove, type FreePersona } from './freelearner.js';
import { Director, type ConversationSpec, type Plan } from './director.js';
import { Sitting, lineOf } from './sitting.js';
import { coverageOf, turnsOf, writeConversation, type ConversationRecord } from './export.js';

const SOURCE_USERDATA = process.env.SIM_USERDATA ?? join(homedir(), 'Library/Application Support/ChatterED');
const SOURCE_DB = process.env.SIM_DB ?? join(SOURCE_USERDATA, 'app.db');
const OUT_ROOT = process.env.SIM_OUT ?? join(tmpdir(), 'chattered-sim');
const STAMP = process.env.SIM_STAMP ?? new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const TESTS = process.env.SIM_TESTS ?? '';
const WANTED = (process.env.SIM_CONVS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const TYPED_GIVE_UP = 'i give up, just tell me the answer';

/** Run one learner move through the sitting. */
async function perform(sitting: Sitting, plan: Plan, spec: ConversationSpec, persona: FreePersona, move: FreeMove, lineKey: string | null, turn: number): Promise<void> {
  const open = await sitting.openQuestion();
  const opts = { why: move.why, by: move.model };
  const lineRef = plan.lines[lineKey ?? spec.lines[0]!] ?? spec.lines[0]!;
  const text = move.text;
  switch (move.action) {
    case 'ask': {
      const pref = spec.askVia ?? (persona.askVia === 'either' || !persona.askVia ? (turn % 2 === 0 ? 'line' : 'chat') : persona.askVia);
      // A question typed into the thread of Max's open question is Max's to answer; to reach
      // Ellie while it is open the learner asks elsewhere.
      const via = open && open.threadId === 'doc' ? 'line' : pref;
      const q = text || `can you explain this: "${lineOf(sitting.sim, lineRef).text.slice(0, 90)}"?`;
      if (via === 'line') await sitting.askLine(lineRef, q, opts);
      else await sitting.ask(q, opts);
      return;
    }
    case 'answer': {
      const a = text || 'not sure';
      const pref = spec.answerVia ?? (persona.answerVia === 'notes' ? 'notes' : persona.answerVia === 'either' ? (turn % 2 === 0 ? 'notes' : 'chat') : 'chat');
      if (!open) return;
      if (pref === 'notes') await sitting.answerInNotes(a, opts);
      else await sitting.say('answer_chat', a, open.threadId, opts);
      return;
    }
    case 'hint':
    case 'show_me':
      await sitting.press(move.action, opts);
      return;
    case 'give_up_typed': {
      if (!open) return;
      // The app reads a give-up off the words; a phrasing it does not recognise is not one.
      const said = text && classifyLearnerTurn(text) === 'give_up' ? text : TYPED_GIVE_UP;
      await sitting.say('give_up_typed', said, open.threadId, opts);
      return;
    }
    case 'dispute': {
      const thread = open?.threadId ?? (await sitting.lastQuestionThread());
      if (!thread) return;
      await sitting.say('dispute', text || 'i think my answer was right though', thread, opts);
      return;
    }
    case 'note':
      await sitting.note(lineRef, text || 'note to self: repair the turn that broke.', opts);
      return;
    case 'quiz_me':
      await sitting.quizMe(lineRef, opts);
      return;
  }
}

describe('free-form conversations', () => {
  if (!TESTS) {
    it.skip('needs SIM_TESTS', () => undefined);
    return;
  }
  const files = loadTestFiles(TESTS);
  const { plan, personas, marker } = files;
  const exportDir = process.env.SIM_CONV_OUT ?? join(TESTS, 'llm_judge', 'conversations');
  const selected = plan.conversations.filter((c) => WANTED.length === 0 || WANTED.includes(c.id));
  const pages = (plan as Plan & { pages?: number[] }).pages ?? [];

  for (const spec of selected) {
    it(`${spec.id}: ${spec.persona} on ${spec.build}, ${spec.situation}`, async () => {
      const persona = personas.get(spec.persona);
      if (!persona) throw new Error(`no persona ${spec.persona}`);
      const env = plan.builds[spec.build];
      if (!env) throw new Error(`no build ${spec.build}`);
      applyBuild(env);
      const outDir = join(OUT_ROOT, STAMP, spec.id);
      mkdirSync(exportDir, { recursive: true });
      const startedAt = new Date().toISOString();
      const started = Date.now();
      const sim = await SimRoom.open({
        sourceDb: SOURCE_DB,
        sourceUserData: SOURCE_USERDATA,
        notebookId: (plan as Plan & { notebookId?: string }).notebookId ?? notebookIdFor(plan.notebook, SOURCE_DB, outDir),
        outDir,
      });
      const sitting = new Sitting(sim);
      const learner = new FreeLearner(persona, outDir);
      const followsUp = env.CHATTERED_MAX_ON_REQUEST !== '1';
      const director = new Director(spec, persona, followsUp);
      let turns = 0;
      let failure: string | null = null;
      try {
        for (;;) {
          const step = await director.next(sitting, turns);
          if (!step) break;
          const open = await sitting.openQuestion();
          const lineRef = step.lineKey ? plan.lines[step.lineKey] : null;
          const move = await learner.move({
            notes: notesView(sim, pages),
            conversation: conversationText(turnsOf(sitting)),
            openQuestion: open?.text ?? null,
            line: lineRef ? lineOf(sim, lineRef).text : null,
            allowed: step.allowed,
            guidance: step.guidance,
          });
          await perform(sitting, plan, spec, persona, move, step.lineKey, turns);
          director.record(move, open);
          turns += 1;
          writeJson(join(outDir, 'moves.json'), sitting.moves);
        }
      } catch (err) {
        failure = err instanceof Error ? err.message : String(err);
        throw err;
      } finally {
        const lt = learnerTokens(outDir);
        const cost = costOf(outDir, startedAt, lt.calls, lt.tokens);
        const all = turnsOf(sitting);
        const rec: ConversationRecord = {
          id: spec.id,
          persona: { id: persona.id, name: persona.name, summary: persona.summary },
          build: spec.build,
          env,
          situation: spec.situation,
          giveUp: spec.giveUp,
          expectFail: spec.expectFail === true,
          purpose: spec.purpose,
          notebook: plan.notebook,
          date: startedAt.slice(0, 10),
          startedAt,
          durationMs: Date.now() - started,
          learnerTurns: turns,
          models: {
            learner: [...learner.models],
            learnerRequested: LEARNER_MODELS(),
            learnerTemperature: LEARNER_TEMPERATURE(),
            agents: agentModels(sim),
          },
          cost,
          failure,
          rawRun: outDir,
          turns: all,
          questions: [...sitting.questions.values()],
          coverage: coverageOf(all),
        };
        writeConversation(exportDir, rec, {
          jsonFirstKey: marker ? ['_', marker] : undefined,
          mdFirstLine: marker ? `<!-- ${marker} -->` : null,
          meta: [
            ['Persona', `${persona.name} (${persona.id}): ${persona.summary}`],
            ['Build', `${spec.build} (${Object.entries(env).map(([k, v]) => `${k}=${v}`).join(', ') || 'default'})`],
            ['Situation', `${spec.situation}; give-up by ${spec.giveUp}`],
            ['Learner turns', String(turns)],
            ['Models', `learner ${[...learner.models].join(', ') || '?'}; agents ${agentModels(sim).join(', ')}; ${startedAt}`],
          ],
        });
        sim.dispose();
        if (process.env.SIM_KEEP_DB !== '1') sim.dropDatabaseCopy();
        applyBuild({});
        console.log(`wrote ${join(exportDir, `${spec.id}.md`)} (${String(turns)} turns, ${String(Math.round((Date.now() - started) / 1000))} s)`);
      }
    });
  }
});
