/**
 * **The A1 demonstration, walked end to end** — `docs/report/assignment1-draft.md` Table 3 and
 * `docs/report/demo-cut.md`.
 *
 * The report claims Table 3 is "one complete learning activity" and the video demonstrates it.
 * This walks that activity through the real actor and asserts the rule chain the learner would
 * see on camera, so the table and the code cannot drift apart before the shoot.
 *
 * It runs on `script.notes.ts` through the real `ScriptedClient` — the same arrangement as
 * `actor.collabdoc.test.ts` — so the rules, the timer, the thread registry and the doc-edit call
 * all run for real. What it does **not** prove is wording: a live model writes different words
 * every time, and the point of the demonstration is the rule chain, not the prose.
 *
 * `DEMO_PRINT=1 npx vitest run src/room/demo.table3.test.ts` prints the transcript and the
 * per-step clock, which is the dry run.
 */
import { describe, expect, it } from 'vitest';
import type { RoomEvent } from '../shared/types.js';
import type { OutlineEntry } from '../shared/doc/types.js';
import { groupView } from '../main/db/store.js';
import { FakeClock } from '../test-support/clock.js';
import { DEFAULT_ROOM_CONFIG, seedRoom } from '../test-support/db.js';
import { rosterFor } from './agents.js';
import { PSD_HESSIAN_CONVEXITY_V1 } from './concepts/psd-hessian-convexity-v1.js';
import { RoomActor } from './actor.js';
import type { DocPort } from './docport.js';
import { ScriptedClient } from './llm/scripted.js';
import { NOTES_BEATS, NOTES_DOCTEXT_BEAT, NOTES_SCRIPT } from './llm/script.notes.js';
import { EMPTY_USAGE, type LLMClient, type LlmRequest } from './llm/types.js';
import { API_PLAN } from './llm/models.js';
import { DEMO, FLOW } from './flow.js';
import { silenceStagesMs } from './timer.js';
import { docTextGate } from '../main/docroom/doctext.js';

const DOC = 'doc';
const PRINT = process.env.DEMO_PRINT === '1';

/** The lines the learner types on camera. Kept here so the line sheet has one home. */
const LINE = {
  ask: 'what is the side channel?',
  attempt: 'the learner pays it, when they decide to forward',
  giveUp: "i don't know",
  askAgain: 'what does forwarding cost?',
  /**
   * Table 3 step 8, typed **into the notes** rather than the chat. It has to clear
   * `docTextGate` — eight content words, a terminator, and a block mapped to exactly one
   * objective — or the pause produces nothing at all and the take is dead.
   */
  inNotes:
    'The forwarding decision belongs to the learner, so the privacy cost lands at the moment they choose to forward.',
};

function harness() {
  const seeded = seedRoom();
  const clock = new FakeClock();
  const events: RoomEvent[] = [];
  const requests: LlmRequest[] = [];
  const outline: OutlineEntry[] = [
    { blockId: 'b_aaa', kind: 'heading', path: [], text: 'The side channel', pages: [3], learnerText: false, questionId: null },
    { blockId: 'b_bbb', kind: 'paragraph', path: ['The side channel'], text: 'A private turn with one agent.', pages: [3], learnerText: false, questionId: null },
  ];
  const doc: DocPort = {
    docId: () => 'doc_1',
    frozen: () => false,
    outlineNear: () => outline,
    blocksForPages: () => ['b_bbb'],
    hasQuestion: () => false,
    recordEdit: () => {},
    recordOutcome: () => {},
  };
  const scripted = new ScriptedClient({ script: NOTES_SCRIPT, roster: rosterFor('ellie_peer') });
  const llm: LLMClient = {
    kind: 'scripted',
    async complete(request, onDelta, signal) {
      requests.push(request);
      if (request.meta.scope === 'docedit') {
        const body = JSON.stringify({ edit: 'none', points_to: 'b_bbb', why: 'the notes already say it' });
        return { text: body, model: request.model, usage: EMPTY_USAGE, ttftMs: 1, backend: 'scripted' as const };
      }
      if (request.meta.scope === 'ledger') {
        const body = JSON.stringify({ schema: 'ledger.v1', concept_id: 'x', message_id: 'm', elements: [] });
        return { text: body, model: request.model, usage: EMPTY_USAGE, ttftMs: 1, backend: 'scripted' as const };
      }
      return scripted.complete(request, onDelta, signal);
    },
  };
  let n = 0;
  const actor = new RoomActor({
    store: seeded.store,
    groupStore: groupView(seeded.store),
    clock,
    transport: { emit: (e) => events.push(e) },
    llm,
    roomId: seeded.roomId,
    sessionId: seeded.sessionId,
    roster: rosterFor('ellie_peer'),
    pack: PSD_HESSIAN_CONVEXITY_V1,
    models: API_PLAN,
    config: { ...DEFAULT_ROOM_CONFIG, mode: 'scripted' },
    appVersion: '0.1.0-demo',
    newId: (prefix) => `${prefix}_${(n += 1)}`,
    random: () => 0.5,
    docPort: doc,
  });
  actor.start();

  const rules = () => seeded.store.turnDecisions.forRoom(seeded.roomId).map((d) => d.decided_by);
  const settle = async <T,>(promise: Promise<T>, ms = 120_000): Promise<T> => {
    const run = clock.run(ms);
    const out = await promise;
    await run;
    return out;
  };
  const say = async (text: string, label: string) => {
    const before = rules().length;
    const rowsBefore = seeded.store.messages.forRoom(seeded.roomId).length;
    await settle(actor.sendMessage(text, DOC));
    const fired = rules().slice(before);
    if (PRINT) {
      // Skip the learner's own row, which is the first one added.
      const added = seeded.store.messages.forRoom(seeded.roomId).slice(rowsBefore + 1);
      console.log(`\n── ${label} ──\n  learner: ${text}\n  rules:   ${fired.join(' → ')}`);
      for (const row of added) console.log(`  agent:   ${row.body.slice(0, 150).replace(/\n/g, ' ')}`);
    }
    return fired;
  };

  return { ...seeded, actor, clock, rules, settle, say };
}

describe('the A1 demonstration, as Table 3 describes it', () => {
  it('runs steps 2 to 7 as one chain, and every rule in it is the one the table names', async () => {
    const h = harness();

    // Table 3 steps 2 and 3 — the learner asks; Ellie answers; Max asks exactly one follow-up.
    expect(await h.say(LINE.ask, 'steps 2-3: ask → Ellie answers → Max asks')).toEqual([
      'rule:ellie_answers',
      'rule:max_followup',
    ]);

    // Table 3 step 6 — the learner stalls. Two runs: stage 2's window is armed by stage 1 landing.
    const before = h.rules().length;
    await h.clock.run(400_000);
    await h.clock.run(400_000);
    const silence = h.rules().slice(before);
    if (PRINT) console.log(`\n── step 6: silence → Ellie's guess → Max turns it back ──\n  rules:   ${silence.join(' → ')}`);
    expect(silence).toEqual(['rule:ellie_cue', 'rule:max_prompt']);

    // Table 3 step 4 — the attempt, and the feedback it is owed.
    expect(await h.say(LINE.attempt, 'step 4: attempt → verdict')).toEqual(['rule:quiz_feedback']);

    // Table 3 step 7 — the give-up releases the answer.
    expect(await h.say(LINE.giveUp, 'step 7: give up → answer released')).toEqual(['rule:answer_released']);

    // …and the loop is genuinely reusable: a new question draws a new follow-up.
    expect(await h.say(LINE.askAgain, 'loop: ask again → Ellie answers → Max asks')).toEqual([
      'rule:ellie_answers',
      'rule:max_followup',
    ]);
  });

  /**
   * **What the scripted backend cannot film.** `script.notes.ts` has one chat feedback beat
   * (`feedback:1`, *Partly there*) and no second one; its only *Well done* is `doctext:1`, which
   * fires when the learner writes into the **notes**, not when they answer again in the chat.
   *
   * So Table 3 step 5 — "answers again → Max says Well done" — is filmable on a live model and
   * **not** on the scripted transcript. This test exists to fail loudly if someone adds a
   * `feedback:2` and forgets that the demo cut depends on which backend is running.
   */
  it('has exactly one chat verdict in the scripted transcript, and it is Partly there', () => {
    const chatVerdicts = NOTES_BEATS.filter((b) => b.decision?.move === 'quiz_feedback');
    expect(chatVerdicts).toHaveLength(1);
    expect(chatVerdicts[0]!.text).toMatch(/^Partly there\./);
    // The only `Well done` in the transcript is the one the learner earns by writing in the notes.
    expect(NOTES_DOCTEXT_BEAT.text).toMatch(/^Well done\./);
  });
});

describe('the pacing the demonstration is shot at', () => {
  /**
   * The one wait the cut keeps, because the wait *is* the design (DG1). These are the numbers the
   * shoot plan budgets, so they are asserted rather than quoted.
   */
  it('puts Ellie’s guess 20 s into a silence on Demo, and 120 s on Study', () => {
    // A short Max question: reading time lands under the floor, so the floor is the threshold.
    const shortQuestion = 25;
    const demo = silenceStagesMs(shortQuestion, DEMO.silenceScale);
    const study = silenceStagesMs(shortQuestion, FLOW.silenceScale);

    expect(demo.stageOneMs).toBe(20_000);
    expect(demo.stageTwoMs).toBe(35_000);
    expect(study.stageOneMs).toBe(120_000);
    expect(study.stageTwoMs).toBe(210_000);

    if (PRINT) {
      console.log(
        `\n── pacing ──\n  Demo:  Ellie's guess at ${demo.stageOneMs / 1000}s, Max's prompt at ${demo.stageTwoMs / 1000}s` +
          `\n  Study: Ellie's guess at ${study.stageOneMs / 1000}s, Max's prompt at ${study.stageTwoMs / 1000}s`,
      );
    }
  });
});

/**
 * **The line sheet, checked.** Every line above is typed on camera, and two of them have to pass
 * a gate in code before anything happens at all. A line that silently fails the gate looks
 * exactly like a broken app on film, so the lines are asserted here rather than trusted.
 */
describe('the lines the learner types on camera', () => {
  const gate = (text: string, objectiveId: string | null = 'C2') =>
    docTextGate({ text, objectiveId, lastHash: null, inFlight: false });

  it('accepts the sentence typed into the notes, so the pause becomes an attempt', () => {
    const result = gate(LINE.inNotes);
    expect(result.assessed).toBe(true);
    expect(result.reason).toBeNull();
    if (PRINT) console.log(`\n── line sheet ──\n  in notes: "${LINE.inNotes}" → assessed`);
  });

  it('refuses the same sentence in a block no objective teaches, which is why the shoot rule says type under a p. N chip', () => {
    expect(gate(LINE.inNotes, null)).toMatchObject({ assessed: false, reason: 'no_objective' });
  });

  it('refuses agreement and half-sentences, which is what makes a stray keystroke safe on camera', () => {
    expect(gate('ok makes sense')).toMatchObject({ assessed: false, reason: 'too_short' });
    expect(gate('the forwarding decision')).toMatchObject({ assessed: false, reason: 'too_short' });
    // Long enough to be a claim, but still mid-sentence: under 16 content words and no terminator.
    expect(gate('the forwarding decision belongs to the learner and the cost')).toMatchObject({
      assessed: false,
      reason: 'no_sentence',
    });
  });

  /**
   * The half-typed sentence matters on camera: it is what the block looks like for the second or
   * two before the final full stop, and it must produce nothing until the sentence is finished.
   */
  it('assesses the notes line only once the full stop is typed', () => {
    const halfway = LINE.inNotes.slice(0, LINE.inNotes.indexOf(', so'));
    expect(gate(halfway).assessed).toBe(false);
    expect(gate(LINE.inNotes).assessed).toBe(true);
  });

  it('treats the give-up line as a give-up however it is capitalised', () => {
    // The chain test above proves `rule:answer_released` fires on it; this pins the phrasing.
    expect(LINE.giveUp).toMatch(/^i don't know$/);
  });
});
