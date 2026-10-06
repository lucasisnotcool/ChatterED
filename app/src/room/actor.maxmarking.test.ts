/**
 * **How Max runs a question, through the actor** (6 Oct afternoon, items 1, 2, 3, 4, 5, 13, 16 and
 * 17; `notebooks.md` §11.10, recorded on #67).
 *
 * The fixtures are the real turns of the two MDP sessions of 6 Oct on build 413, both of which
 * ended in anger: Max's two-part openers with S6's framing (#34, #53), feedback that pointed at a
 * page (#40, #61), five marked tries on one question (#36–#44), a typed "show me" read as a
 * request for background (#64), "fuck just give answer" marked as an attempt (#66), and a release
 * that said "your attempt already had the core idea" about answers marked Partly there (#46).
 *
 * Runs the real actor on `script.notes.ts` through the `ScriptedClient`, with Max's turns replaced
 * per test. No network.
 */
import { describe, expect, it } from 'vitest';
import type { RoomEvent } from '../shared/types.js';
import type { AgentDocOpBatch, OutlineEntry, QuizOutcome } from '../shared/doc/types.js';
import { groupView } from '../main/db/store.js';
import { FakeClock } from '../test-support/clock.js';
import { DEFAULT_ROOM_CONFIG, seedRoom } from '../test-support/db.js';
import { rosterFor } from './agents.js';
import { PSD_HESSIAN_CONVEXITY_V1 } from './concepts/psd-hessian-convexity-v1.js';
import { RoomActor } from './actor.js';
import type { DocPort } from './docport.js';
import { ScriptedClient } from './llm/scripted.js';
import { NOTES_SCRIPT } from './llm/script.notes.js';
import { EMPTY_USAGE, type LLMClient, type LlmRequest } from './llm/types.js';
import { API_PLAN } from './llm/models.js';
import { FEEDBACK_REPLY_SCHEMA, QUESTION_REPLY_SCHEMA } from './prompts.doc.js';
import { FEEDBACK_MAX_WORDS, feedbackWords } from '../core/quizturn.js';

const DOC = 'doc';

type Reply = (request: LlmRequest) => string | null;

function docPort() {
  const edits: { batch: AgentDocOpBatch; objectiveId: string | null }[] = [];
  const outcomes: Omit<QuizOutcome, 'id' | 'contentSha' | 'createdAt'>[] = [];
  const outline: OutlineEntry[] = [
    { blockId: 'b_aaa', kind: 'heading', path: [], text: 'Markov decision processes', pages: [6], learnerText: false, questionId: null },
    { blockId: 'b_bbb', kind: 'paragraph', path: ['Markov decision processes'], text: 'The transition model T.', pages: [6], learnerText: false, questionId: null },
  ];
  const port: DocPort = {
    docId: () => 'doc_1',
    frozen: () => false,
    outlineNear: () => outline,
    blocksForPages: () => ['b_bbb'],
    hasQuestion: () => false,
    recordEdit: (input) => edits.push({ batch: input.batch, objectiveId: input.objectiveId }),
    recordOutcome: (o) => outcomes.push(o),
  };
  return { port, edits, outcomes };
}

function client(reply: Reply): LLMClient & { requests: LlmRequest[] } {
  const scripted = new ScriptedClient({ script: NOTES_SCRIPT, roster: rosterFor('ellie_peer') });
  const requests: LlmRequest[] = [];
  const done = (text: string, model: string) => ({ text, model, usage: EMPTY_USAGE, ttftMs: 1, backend: 'scripted' as const });
  return {
    kind: 'scripted',
    requests,
    async complete(request, onDelta, signal) {
      requests.push(request);
      const own = reply(request);
      if (own !== null) {
        onDelta?.(own);
        return done(own, request.model);
      }
      if (request.meta.scope === 'docedit') {
        return done(JSON.stringify({ edit: 'none', points_to: 'b_bbb', why: 'the notes already say it' }), request.model);
      }
      if (request.meta.scope === 'ledger') {
        return done(JSON.stringify({ schema: 'ledger.v1', concept_id: 'x', message_id: 'm', elements: [] }), request.model);
      }
      return scripted.complete(request, onDelta, signal);
    },
  };
}

function build(reply: Reply) {
  const seeded = seedRoom();
  const clock = new FakeClock();
  const events: RoomEvent[] = [];
  const llm = client(reply);
  const doc = docPort();
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
    appVersion: '0.1.0-test',
    newId: (prefix) => `${prefix}_${(n += 1)}`,
    random: () => 0.5,
    docPort: doc.port,
    // Ellie answers, then Max asks one (#48's loop): the shortest way to an open question.
    maxOnlyOnRequest: false,
  });
  actor.start();
  return { ...seeded, clock, events, actor, llm, doc };
}

async function settle<T>(clock: FakeClock, promise: Promise<T>, ms = 120_000): Promise<T> {
  const run = clock.run(ms);
  const out = await promise;
  await run;
  return out;
}

const last = (request: LlmRequest) => request.messages.at(-1)!.content;
const isQuestion = (r: LlmRequest) => r.jsonSchema === QUESTION_REPLY_SCHEMA;
const isMarking = (r: LlmRequest) => r.meta.scope === 'group' && last(r).includes('WHICH IS WHAT YOU MARK');
const isRelease = (r: LlmRequest) => r.meta.scope === 'group' && last(r).includes('GIVE THE ANSWER');
const maxBodies = (h: ReturnType<typeof build>) => {
  const max = h.store.participants.byAgentKey(h.roomId, 'challenger.max')!.id;
  return h.store.messages.forRoom(h.roomId).filter((m) => m.participant_id === max).map((m) => m.body);
};
const rules = (h: ReturnType<typeof build>) => h.store.turnDecisions.forRoom(h.roomId).map((d) => d.decided_by);
const resolves = (h: ReturnType<typeof build>) => h.doc.edits.flatMap((e) => e.batch.ops).filter((op) => op.op === 'resolve_q');

// ── The real turns ─────────────────────────────────────────────────────────────────────────

/** #34, as Max wrote it: S6's framing, then two asks. */
const Q34 =
  "I'm testing the statement, not you, so take this as a probe of the idea. On p. 7 the grid world's move " +
  "succeeds with probability 0.8 and slips to each side with 0.1, and p. 6 requires $\\sum_{s'} T(s,a,s') = 1$ " +
  'for every state and action. In your own words, why does the MDP need that sum to equal 1, and what would ' +
  'go wrong for the agent if it were, say, 0.9 for some $(s,a)$?';
/** The same question asking one thing, as the regeneration is asked to write it. */
const Q34_ONE =
  "On p. 7 the grid world's move succeeds with probability 0.8 and slips to each side with 0.1, and p. 6 " +
  "requires $\\sum_{s'} T(s,a,s') = 1$ for every state and action. In your own words, why does the MDP need " +
  'that sum to equal 1?';
const MODEL = {
  model_answer:
    "For a fixed $s$ and $a$, $T(s,a,\\cdot)$ is a probability distribution over next states: the action must " +
    'lead somewhere, so the outcomes cover every case and total 1. At 0.9 the expected-utility sum misses mass.',
  key_points: [
    'For a fixed state and action the outcomes cover every possibility, so their probabilities total 1',
    'With a total below 1 the expected utility of that action is undervalued',
  ],
};
const question = (text: string) => JSON.stringify({ text, ...MODEL });
const feedback = (text: string, covered: number[]) => JSON.stringify({ text, covered });

/** The learner's real tries on #34. */
const T35 =
  'MDP uses the expected utility of a action to determine the next action to take. if the sum does not equal to ' +
  'one, then a given utility for a given action cannot be correctly compared with other actions available at the current state';
const T37 = 'computed expected utility will be lower than actual, so it pushes the agent away from that choice';
const T39 =
  'this ensures that the MDP satisfies the markov property that distribution of future state and action outcome ' +
  'depends solely on current state and action taken?';
const T43 = 'Well, the agent must take an action in this model, and an action must have an effect, so all must total 1';

/** #40, a real feedback turn: a page as the only pointer, and over the cap. */
const F40 =
  '**Partly there.**\n\nTaken together, you have two pieces. You say the sum keeps actions comparable at a state, ' +
  "which fits p. 10: \"$\\pi^*(s) = \\arg\\max_{a\\in A(s)} \\sum_{s'} P(s'|s,a)[R(s,a,s') + \\gamma U(s')]$\". You also " +
  'say a sum of 0.9 undervalues that action and pushes the agent away from it.\n\nYour latest line ties the ' +
  "requirement to the Markov property. p. 6 does say $T$ \"satisfies the Markov property\", but the deck doesn't " +
  'tie the sum-to-1 condition to that property. They are separate conditions.\n\nStill open is the first half of ' +
  'the question: what $T(s,a,\\cdot)$ must be, for a given state and action, to be a valid model. p. 6 settles it.';

async function openQuestion(h: ReturnType<typeof build>) {
  await settle(h.clock, h.actor.sendMessage('why does the transition model have to sum to 1?', DOC));
  expect(rules(h)).toEqual(['rule:ellie_answers', 'rule:max_followup']);
}

// ── Items 3, 4 and 5: the question ─────────────────────────────────────────────────────────

describe('Max’s question (items 3, 4, 5)', () => {
  it('writes #34 again asking one thing, without S6, and keeps its model answer hidden', async () => {
    const h = build((r) => {
      if (!isQuestion(r)) return null;
      return last(r).includes('YOUR LAST DRAFT ASKED TWO THINGS') ? question(Q34_ONE) : question(Q34);
    });
    await openQuestion(h);
    const asked = maxBodies(h).at(-1)!;
    expect(asked).toBe(Q34_ONE);
    expect(asked).not.toMatch(/testing the statement|not you/);
    // One regeneration, and the first draft never reached the screen.
    expect(h.llm.requests.filter(isQuestion)).toHaveLength(2);
    expect(h.events.some((e) => e.type === 'turn.delta' && e.text.includes('testing the statement'))).toBe(false);
    // The prompt asked for the hidden half.
    expect(last(h.llm.requests.filter(isQuestion)[0]!)).toContain('WRITE YOUR MODEL ANSWER TOO (PRIVATE)');

    const stored = h.actor.flowSnapshot().pendingQuiz!;
    expect(stored.modelAnswer).toBe(MODEL.model_answer);
    expect(stored.keyPoints).toEqual(MODEL.key_points);
    // Never in a view the renderer gets.
    expect(JSON.stringify(h.actor.docThreads())).not.toContain('probability distribution over next states');
    expect(JSON.stringify(h.actor.pendingQuizView())).not.toContain('probability distribution over next states');
  });

  it('keeps only the first ask when the regeneration still asks two, and drops the model answer', async () => {
    const h = build((r) => (isQuestion(r) ? question(Q34) : null));
    await openQuestion(h);
    const asked = maxBodies(h).at(-1)!;
    expect(asked.endsWith('In your own words, why does the MDP need that sum to equal 1?')).toBe(true);
    expect(asked).not.toContain('testing the statement');
    // Its points were written for both halves, so it is marked by the words, as before.
    expect(h.actor.flowSnapshot().pendingQuiz!.keyPoints ?? null).toBeNull();
  });

  it('asks a plain-words question as before when the reply is not the object', async () => {
    const h = build((r) => (isQuestion(r) ? 'Why must the outcomes of one action total 1?' : null));
    await openQuestion(h);
    expect(maxBodies(h).at(-1)).toBe('Why must the outcomes of one action total 1?');
    expect(h.actor.flowSnapshot().pendingQuiz!.modelAnswer ?? null).toBeNull();
  });
});

// ── Item 3: the idea in your own words earns Well done ────────────────────────────────────

describe('marking by meaning (item 3)', () => {
  /**
   * #37 stated point 2 and #43 stated point 1 in the learner's own words. Max's model, marking by
   * the page's word, still said Partly there; the points, taken together, are all there, so code
   * says Well done.
   */
  it('marks #43 Well done once the answers together state every point, whatever the words said', async () => {
    let tries = 0;
    const h = build((r) => {
      if (isQuestion(r)) return question(Q34_ONE);
      if (!isMarking(r)) return null;
      tries += 1;
      return tries === 1
        ? feedback('**Partly there.** Right: missing mass undervalues the action. What must the outcomes of one action cover?', [2])
        : feedback('**Partly there.** The deck’s word is "probability distribution". What is $T(s,a,\\cdot)$?', [1]);
    });
    await openQuestion(h);
    await settle(h.clock, h.actor.sendMessage(T37, DOC));
    await settle(h.clock, h.actor.sendMessage(T43, DOC));

    // The marking turn was given the hidden answer and asked for the points.
    const marking = h.llm.requests.filter(isMarking);
    expect(marking[0]!.jsonSchema).toBe(FEEDBACK_REPLY_SCHEMA);
    expect(last(marking[1]!)).toContain('Their answers so far, taken together, state point 2.');

    const body = maxBodies(h).at(-1)!;
    expect(body.startsWith('**Well done.**')).toBe(true);
    expect(body).not.toMatch(/Partly there/);
    // A closing turn asks nothing.
    expect(body.trim().endsWith('?')).toBe(false);
    expect(h.doc.outcomes.filter((o) => o.kind === 'verdict').map((o) => o.verdict)).toEqual(['partial', 'complete']);
    expect(resolves(h).at(-1)).toMatchObject({ resolution: 'you_got_this', learnerAnswer: T43 });
    expect(h.actor.flowSnapshot().pendingQuiz!.pointsCovered).toEqual([1, 2]);
  });

  it('never gives Well done on some points, even when the words say so', async () => {
    const h = build((r) => {
      if (isQuestion(r)) return question(Q34_ONE);
      return isMarking(r) ? feedback('**Well done.** Missing mass undervalues the action.', [2]) : null;
    });
    await openQuestion(h);
    await settle(h.clock, h.actor.sendMessage(T37, DOC));
    expect(maxBodies(h).at(-1)!.startsWith('**Partly there.**')).toBe(true);
    expect(h.doc.outcomes.filter((o) => o.kind === 'verdict').map((o) => o.verdict)).toEqual(['partial']);
    expect(h.actor.pendingQuizView()!.quiz.answerShown).toBe(false);
  });
});

// ── Items 1 and 13: no riddles, only what is new ─────────────────────────────────────────

describe('feedback with no riddles, and only what is new (items 1, 13)', () => {
  it('writes #40 again once, then takes the page pointer out and cuts it to the cap', async () => {
    const h = build((r) => (isMarking(r) ? F40 : isQuestion(r) ? 'Why must the outcomes of one action total 1?' : null));
    await openQuestion(h);
    await settle(h.clock, h.actor.sendMessage(T39, DOC));

    const marking = h.llm.requests.filter(isMarking);
    expect(marking).toHaveLength(2);
    const redo = last(marking[1]!);
    expect(redo).toContain('YOUR LAST DRAFT NEEDS WRITING AGAIN');
    expect(redo).toContain('It sent them to a page to find what is missing');
    expect(redo).toContain(`It ran over ${FEEDBACK_MAX_WORDS} words.`);

    const body = maxBodies(h).at(-1)!;
    expect(body.startsWith('**Partly there.**')).toBe(true);
    expect(body).not.toContain('settles it');
    expect(feedbackWords(body)).toBeLessThanOrEqual(FEEDBACK_MAX_WORDS);
  });

  /** X3's `Chip:` line (decision 12) is the notes', not the chat's: never counted, never cut. */
  it('does not count the Chip line against the cap', async () => {
    const wellDone =
      '**Well done.** Taken together you have both halves: the outcomes of one action cover every case, so ' +
      'they total 1, and at 0.9 the expected utility of that action is undervalued. The deck calls ' +
      '$T(s,a,\\cdot)$ a probability distribution over next states.\n\n' +
      'Chip: For a fixed state and action the transition probabilities form a distribution over next states, ' +
      'so they must total 1.';
    const h = build((r) => (isMarking(r) ? wellDone : isQuestion(r) ? 'Why must the outcomes of one action total 1?' : null));
    await openQuestion(h);
    await settle(h.clock, h.actor.sendMessage(T43, DOC));
    expect(h.llm.requests.filter(isMarking)).toHaveLength(1);
    const body = maxBodies(h).at(-1)!;
    expect(body.startsWith('**Well done.** Taken together')).toBe(true);
    expect(body).not.toContain('Chip:');
  });

  it('sends a plain, short follow-up as written, with no second call', async () => {
    const plain =
      '**Partly there.** Missing mass makes the action look worse, yes. The word you need: for fixed $s$ and $a$, ' +
      '$T(s,a,\\cdot)$ is a probability distribution. Why does that make the total 1?';
    const h = build((r) => (isMarking(r) ? plain : isQuestion(r) ? 'Why must the outcomes of one action total 1?' : null));
    await openQuestion(h);
    await settle(h.clock, h.actor.sendMessage(T37, DOC));
    expect(h.llm.requests.filter(isMarking)).toHaveLength(1);
    expect(maxBodies(h).at(-1)).toBe(plain);
  });
});

// ── Item 2: three tries, then the answer ─────────────────────────────────────────────────

describe('three tries, then the answer (item 2)', () => {
  /** #35, #37, #39: three answers short of Well done. The first session went on to #44. */
  it('closes the question on the third try with the answer, crediting what was right, asking nothing', async () => {
    const h = build((r) => {
      if (isQuestion(r)) return question(Q34_ONE);
      if (!isMarking(r)) return null;
      if (last(r).includes('the last')) {
        return feedback(
          '**Partly there.** Here is the answer: for a fixed $s$ and $a$, $T(s,a,\\cdot)$ is a probability ' +
            'distribution, so the outcomes total 1; at 0.9 the action is undervalued. You had the undervaluing. ' +
            'Your attempt already had the core idea. Want to try once more?',
          [2],
        );
      }
      return feedback('**Partly there.** Missing mass undervalues it, yes. What must one action’s outcomes cover?', [2]);
    });
    await openQuestion(h);
    for (const answer of [T35, T37, T39]) await settle(h.clock, h.actor.sendMessage(answer, DOC));

    const third = last(h.llm.requests.filter(isMarking).at(-1)!);
    expect(third).toContain('This is their try 3, the last.');
    expect(third).not.toContain('Show me** button');

    const body = maxBodies(h).at(-1)!;
    expect(body.startsWith('**Partly there.** Here is the answer')).toBe(true);
    expect(body).not.toContain('Want to try once more?');
    // Item 17: never "the core idea" of an answer that was not Well done.
    expect(body).not.toContain('core idea');
    expect(body).toContain('You had the undervaluing.');

    const view = h.actor.pendingQuizView()!.quiz;
    expect(view.answerShown).toBe(true);
    expect(h.actor.flowSnapshot().pendingQuiz!.closedAfterTries).toBe(true);
    expect(h.doc.outcomes.map((o) => [o.kind, o.verdict ?? o.releasedBy])).toEqual([
      ['verdict', 'partial'],
      ['verdict', 'partial'],
      ['verdict', 'partial'],
      ['released', 'closure'],
    ]);
    expect(resolves(h).at(-1)).toMatchObject({ resolution: 'partly_yours', learnerAnswer: null });

    // A fourth answer is not marked: the question is closed.
    await settle(h.clock, h.actor.sendMessage(T43, DOC));
    expect(h.llm.requests.filter(isMarking)).toHaveLength(3);
  });
});

// ── Items 16 and 17: typed requests release, and the release matches the marking ─────────

describe('typed requests release the answer (item 16), and the release matches the marking (item 17)', () => {
  const reply: Reply = (r) => {
    if (isQuestion(r)) return question(Q34_ONE);
    if (isMarking(r)) return feedback('**Partly there.** Missing mass undervalues it, yes. What must one action’s outcomes cover?', [2]);
    if (isRelease(r)) {
      return (
        'For a fixed $s$ and $a$, $T(s,a,\\cdot)$ is a probability distribution over next states, so the outcomes ' +
        'total 1 (p. 6). Your attempt already had the core idea, that an action must have an effect.'
      );
    }
    return null;
  };

  it('releases on #64’s bare "show me", the button’s own label, not a clarification', async () => {
    const h = build(reply);
    await openQuestion(h);
    await settle(h.clock, h.actor.sendMessage(T37, DOC));
    await settle(h.clock, h.actor.sendMessage('show me', DOC));
    expect(rules(h).at(-1)).toBe('rule:answer_released');
    expect(rules(h)).not.toContain('rule:quiz_clarify');
    expect(h.actor.pendingQuizView()!.quiz.answerShown).toBe(true);
  });

  it('releases on #66’s "fuck just give answer", which is never marked', async () => {
    const h = build(reply);
    await openQuestion(h);
    await settle(h.clock, h.actor.sendMessage(T37, DOC));
    await settle(h.clock, h.actor.sendMessage('fuck just give answer', DOC));
    expect(rules(h).at(-1)).toBe('rule:answer_released');
    expect(h.llm.requests.filter(isMarking)).toHaveLength(1);
    expect(h.doc.outcomes.filter((o) => o.kind === 'verdict')).toHaveLength(1);
  });

  it('gives the release the model answer, credits only the points stated, and strips "the core idea"', async () => {
    const h = build(reply);
    await openQuestion(h);
    await settle(h.clock, h.actor.sendMessage(T37, DOC));
    await settle(h.clock, h.actor.sendMessage('GIVE UP', DOC));
    const prompt = last(h.llm.requests.filter(isRelease).at(-1)!);
    expect(prompt).toContain('YOUR MODEL ANSWER, WRITTEN WHEN YOU ASKED');
    expect(prompt).toContain('Credit exactly point 2, in one sentence');
    const body = maxBodies(h).at(-1)!;
    expect(body).toContain('probability distribution over next states');
    expect(body).not.toContain('core idea');
    expect(resolves(h).at(-1)).toMatchObject({ resolution: 'partly_yours' });
  });

  it('reads "huh what do you want" (#58) as a clarification, never a try', async () => {
    const h = build(reply);
    await openQuestion(h);
    await settle(h.clock, h.actor.sendMessage(T37, DOC));
    await settle(h.clock, h.actor.sendMessage('huh what do you want', DOC));
    expect(rules(h).at(-1)).toBe('rule:quiz_clarify');
    expect(h.actor.flowSnapshot().pendingQuiz!.attempts).toBe(1);
  });
});
