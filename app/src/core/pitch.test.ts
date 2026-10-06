/**
 * **How hard the next question is** (#48, `docs/research/collab-doc.md` §4.5).
 *
 * The brief asks for exactly this shape and says so: *"The pitch inputs are a pure function
 * (`room/pitch.ts`), unit-tested; the wording is the model's."* So these tests pin the two hard
 * instructions and nothing about the prose — after a give-up the next question on that objective
 * is **easier**, after a *Well done* it may be **harder**, and there are no fixed rungs in
 * between.
 *
 * The evidence, for the record: R6 L20 lowered the difficulty in the same message that set
 * attempt-first, and L34 read *"this query seems too complex"* (`convergence.md`). A give-up is a
 * statement about the question, not about the learner.
 */
import { describe, expect, it } from 'vitest';
import {
  CLOZE_BLANK,
  DEFAULT_PITCH,
  followUpPlan,
  hasBlank,
  isGuess,
  PARTIALS_BEFORE_SHOW_ME,
  notePitch,
  pitchBlock,
  pitchInputs,
  pitchLine,
  pitchSignal,
  questionForm,
  type PitchOutcome,
} from './pitch.js';

const verdict = (v: 'complete' | 'partial' | 'not_yet', objectiveId: string | null = 'obj_1'): PitchOutcome => ({
  objectiveId,
  kind: 'verdict',
  verdict: v,
  releasedBy: null,
});

const released = (
  by: 'give_up' | 'pass' | 'closure' = 'give_up',
  objectiveId: string | null = 'obj_1',
): PitchOutcome => ({ objectiveId, kind: 'released', verdict: null, releasedBy: by });

describe('pitchInputs', () => {
  it('pitches level when nothing has been asked on this objective yet', () => {
    const p = pitchInputs({ objectiveId: 'obj_1', outcomes: [], fill: 0 });
    expect(p.pitch).toBe('level');
    expect(p.recent).toEqual([]);
    expect(p.reason).toContain('nothing has been asked');
  });

  /** §4.5, hard instruction one. */
  it('pitches easier after a give-up on this objective', () => {
    const p = pitchInputs({ objectiveId: 'obj_1', outcomes: [verdict('partial'), released('give_up')], fill: 0 });
    expect(p.pitch).toBe('easier');
    expect(p.lastWasRelease).toBe(true);
    expect(p.reason).toContain('give-up');
  });

  it('pitches easier after a Pass and after a closure release too — all three are releases', () => {
    for (const by of ['pass', 'closure'] as const) {
      const p = pitchInputs({ objectiveId: 'obj_1', outcomes: [released(by)], fill: 0 });
      expect(p.pitch, by).toBe('easier');
    }
  });

  /** §4.5, hard instruction two. */
  it('allows harder after a Well done', () => {
    const p = pitchInputs({ objectiveId: 'obj_1', outcomes: [verdict('complete')], fill: 1 });
    expect(p.pitch).toBe('harder');
    expect(p.lastWasComplete).toBe(true);
  });

  it('stays level after a Partly there or a Not yet', () => {
    expect(pitchInputs({ objectiveId: 'obj_1', outcomes: [verdict('partial')], fill: 0.5 }).pitch).toBe('level');
    expect(pitchInputs({ objectiveId: 'obj_1', outcomes: [verdict('not_yet')], fill: 0 }).pitch).toBe('level');
  });

  /**
   * The one ordering decision in the function, and the one §4.5's evidence is about: the pitch is
   * about the question being asked *now*, so the most recent result wins.
   */
  it('lets a give-up beat an earlier Well done on the same objective', () => {
    const p = pitchInputs({ objectiveId: 'obj_1', outcomes: [verdict('complete'), released('give_up')], fill: 1 });
    expect(p.pitch).toBe('easier');
  });

  it('ignores results on a different objective', () => {
    const p = pitchInputs({ objectiveId: 'obj_1', outcomes: [released('give_up', 'obj_2')], fill: 0 });
    expect(p.pitch).toBe('level');
  });

  it('carries the objective’s fill and the last few results, newest first', () => {
    const p = pitchInputs({
      objectiveId: 'obj_1',
      outcomes: [verdict('not_yet'), verdict('partial'), verdict('complete')],
      fill: 1,
    });
    expect(p.fill).toBe(1);
    expect(p.recent[0]!.verdict).toBe('complete');
    expect(p.recent).toHaveLength(3);
  });

  it('caps the history it carries, so the block cannot become a wall', () => {
    const many = Array.from({ length: 12 }, () => verdict('partial'));
    expect(pitchInputs({ objectiveId: 'obj_1', outcomes: many, fill: 0.5 }).recent).toHaveLength(4);
  });
});

describe('pitchBlock', () => {
  it('tells Max to go easier, and does not tell him to say so', () => {
    const text = pitchBlock(pitchInputs({ objectiveId: 'obj_1', outcomes: [released('give_up')], fill: 0 }));
    expect(text).toContain('Ask an easier question');
    expect(text).toContain('recall');
    expect(text).toContain('do not say it is easier');
    expect(text).toContain('fills nothing');
  });

  /**
   * **The easier question is a fill-in-the-blank** (`collab-doc.md` §4.5, amended 2026-10-01).
   * One sentence from the page with one term blanked, which is the smallest thing that can be asked.
   */
  it('asks for the easier question as a fill-in-the-blank, with one blank', () => {
    const text = pitchBlock(pitchInputs({ objectiveId: 'obj_1', outcomes: [released('give_up')], fill: 0 }));
    expect(text).toContain('fill-in-the-blank');
    expect(text).toContain(CLOZE_BLANK);
    expect(text).toContain('One blank only');
  });

  it('asks for own words after a filled blank, not another blank and not a harder case', () => {
    const cloze: PitchOutcome = { ...verdict('complete'), form: 'cloze' };
    const text = pitchBlock(pitchInputs({ objectiveId: 'obj_1', outcomes: [released('give_up'), cloze], fill: 0 }));
    expect(text).toContain('in their own words');
    expect(text).toContain('Not another blank');
    expect(text).not.toContain('You may go harder');
    expect(text).toContain('on a fill-in-the-blank — fills nothing');
  });

  it('permits harder after a Well done', () => {
    const text = pitchBlock(pitchInputs({ objectiveId: 'obj_1', outcomes: [verdict('complete')], fill: 1 }));
    expect(text).toContain('You may go harder');
    expect(text).toContain('apply it to another case');
    // Sim harness, 2026-10-01: "another case" is not the settled distinction on another symbol.
    expect(text.replace(/\s+/g, ' ')).toContain('Take a different angle from the last question');
  });

  /**
   * **#49: "harder" stays inside the deck.** It used to read *"a case the slide does not work
   * through"*, and on 2026-09-23 that licensed a CNF encoding p. 7 only names.
   */
  it('keeps a harder question to what the deck or Ellie’s answer equips them for', () => {
    const text = pitchBlock(pitchInputs({ objectiveId: 'obj_1', outcomes: [verdict('complete')], fill: 1 }));
    expect(text).toContain('equip them');
    expect(text).toContain('no method, notation or format the deck only names');
    expect(text).not.toContain('does not work through');
  });

  it('says there are no fixed rungs, which is §4.5’s own first sentence', () => {
    const text = pitchBlock(pitchInputs({ objectiveId: 'obj_1', outcomes: [], fill: 0 }));
    expect(text).toContain('no fixed difficulty rungs');
  });

  /**
   * **#49.** The first question on p. 7's objective asked the learner to build a CNF encoding the
   * deck only names. The first question on an objective is the easy end, and a result on
   * *another* objective does not make this one's first question a second.
   */
  it('keeps the first question on an objective to own words, not a construction', () => {
    const elsewhere: PitchOutcome = { objectiveId: 'obj_other', kind: 'verdict', verdict: 'complete', releasedBy: null };
    const inputs = pitchInputs({ objectiveId: 'obj_1', outcomes: [elsewhere], fill: 0 });
    expect(inputs.firstOnObjective).toBe(true);
    expect(inputs.pitch).toBe('level');
    const text = pitchBlock(inputs);
    expect(text).toContain('first question on this objective');
    expect(text).toContain('Not a construction');
    // Sim harness, 2026-10-01: use the idea on the page's own case, not name or tell apart.
    expect(text.replace(/\s+/g, ' ')).toContain('apply it to a case the page itself works through');
    expect(text).not.toContain('name or tell apart');
    expect(text).toContain('not filled yet');

    const again = pitchInputs({ objectiveId: 'obj_1', outcomes: [{ ...elsewhere, objectiveId: 'obj_1', verdict: 'partial' }], fill: 0.5 });
    expect(again.firstOnObjective).toBe(false);
    expect(pitchBlock(again)).not.toContain('first question on this objective');
  });
});

/**
 * The older half of this file is untouched by #48 and is asserted here so the two stay separate:
 * `pitchLine` is about **how an explanation is written** (the learner asked for it simpler), and
 * `pitchBlock` is about **how hard the next question is**. Merging them would have a learner who
 * asked for the rigorous version handed a harder quiz they never asked for.
 */
describe('the two pitches are not the same pitch', () => {
  it('keeps the learner’s stated level out of the question’s difficulty', () => {
    const lowered = notePitch(DEFAULT_PITCH, 'can you explain it simpler', 1_000);
    expect(lowered.level).toBe(-1);
    expect(pitchLine(lowered)).toContain('lower than the slide');
    // …and the next question is still pitched by the results, not by that phrase.
    expect(pitchInputs({ objectiveId: 'obj_1', outcomes: [verdict('complete')], fill: 1 }).pitch).toBe('harder');
  });
});

/**
 * **Only a request is a signal** (#49). In Lucas's 2026-09-23 run an answer to Max, *"Oh it can
 * simplify the reduce degrees of freedom of CNF formula"*, matched a bare `simplify` and lowered
 * the pitch for the rest of the file. Nothing had been asked for: *simplify* was the content of
 * the answer. So each lowering pattern needs the form of a request (*"simpler please"*, *"can you
 * simplify"*, *"explain it more simply"*, *"ELI5"*, *"too complex"*), and a content word on its own
 * is not one.
 */
describe('pitchSignal', () => {
  it('ignores simpl-, basic and the other content words when nothing is being asked for', () => {
    for (const line of [
      'Oh it can simplify the reduce degrees of freedom of CNF formula',
      'Simply put, the agent picks the action with the highest value',
      'Relaxation gives a simpler problem, so the heuristic is cheap to compute',
      'is A* simpler than BFS here?',
      'the basic idea is that the heuristic never overestimates',
      'what are the basic operators in STRIPS?',
      'it rebuilds the plan from scratch every time the goal changes',
      'a concrete example is the air cargo problem on p. 12',
      'it will slow down the search because the branching factor is large',
      'it uses too much memory on large grids',
      'the planner did not get stuck because the heuristic is admissible',
    ]) {
      expect(pitchSignal(line), line).toBeNull();
    }
  });

  it('still reads a request for a lower pitch, in the forms learners use', () => {
    for (const line of [
      'hmm can you explain it simpler',
      'simpler please',
      'simpler?',
      'can you simplify that?',
      'could you please simplify',
      'explain it more simply',
      'say that a bit more simply please',
      'in simpler terms please',
      'can you make it simpler, like for a kid',
      'ELI5',
      'explain like I am five',
      'this is too complex',
      'that is too much',
      'can we go back to basics',
      'explain it from scratch',
      'slow down please',
      "I don't get it",
      'no idea what that means',
      'can you give me a concrete example?',
      'you are just reading the slides back to me',
    ]) {
      expect(pitchSignal(line)?.direction, line).toBe(-1);
    }
  });

  it('quotes the word the learner used for it', () => {
    expect(pitchSignal('hmm can you explain it simpler')).toEqual({ direction: -1, phrase: 'simpler' });
    expect(pitchSignal('could you simplify that?')).toEqual({ direction: -1, phrase: 'simplify' });
  });

  it('reads a raise, and lets a lower win when one message says both', () => {
    expect(pitchSignal('give me the rigorous version')?.direction).toBe(1);
    expect(pitchSignal('too complicated, can you explain it as a concept, then the rigorous version')?.direction).toBe(-1);
    expect(pitchSignal('what is stochastic?')).toBeNull();
    expect(pitchSignal('   ')).toBeNull();
  });
});

describe('notePitch', () => {
  it('returns the same object when nothing was asked for, so an answer costs no write', () => {
    const state = notePitch(DEFAULT_PITCH, 'Oh it can simplify the reduce degrees of freedom of CNF formula', 1_000);
    expect(state).toBe(DEFAULT_PITCH);
  });

  it('moves one level on a request and records the phrase and the time', () => {
    expect(notePitch(DEFAULT_PITCH, 'simpler please', 1_000)).toEqual({
      level: -1,
      signals: ['simpler'],
      updatedAt: 1_000,
    });
  });
});

/**
 * **The cloze form** (`collab-doc.md` §4.5, amended 2026-10-01). After a release the next question
 * is a fill-in-the-blank; a correct one fills nothing and does not license a harder question.
 */
describe('the cloze form', () => {
  it('asks for a cloze exactly when the pitch is easier', () => {
    expect(pitchInputs({ objectiveId: 'obj_1', outcomes: [released('give_up')], fill: 0 }).form).toBe('cloze');
    expect(pitchInputs({ objectiveId: 'obj_1', outcomes: [], fill: 0 }).form).toBe('open');
    expect(pitchInputs({ objectiveId: 'obj_1', outcomes: [verdict('complete')], fill: 1 }).form).toBe('open');
    expect(pitchInputs({ objectiveId: 'obj_1', outcomes: [verdict('partial')], fill: 0.5 }).form).toBe('open');
  });

  it('does not go harder on a filled blank: the learner is back at the start of the objective', () => {
    const cloze: PitchOutcome = { ...verdict('complete'), form: 'cloze' };
    const p = pitchInputs({ objectiveId: 'obj_1', outcomes: [released('give_up'), cloze], fill: 0 });
    expect(p.pitch).toBe('level');
    expect(p.lastWasComplete).toBe(false);
    expect(p.lastWasCloze).toBe(true);
    expect(p.form).toBe('open');
    expect(p.reason).toContain('filled a blank');
  });

  it('asks for another blank after a give-up on a blank', () => {
    const p = pitchInputs({ objectiveId: 'obj_1', outcomes: [released('give_up'), released('give_up')], fill: 0 });
    expect(p.form).toBe('cloze');
  });

  it('still goes harder on an open Well done, with or without the field', () => {
    const open: PitchOutcome = { ...verdict('complete'), form: 'open' };
    expect(pitchInputs({ objectiveId: 'obj_1', outcomes: [open], fill: 1 }).pitch).toBe('harder');
    expect(pitchInputs({ objectiveId: 'obj_1', outcomes: [{ ...verdict('complete'), form: null }], fill: 1 }).pitch).toBe('harder');
  });

  it('reads a blank off the question, three underscores or more', () => {
    expect(hasBlank('Fill in the blank: a ____ is admissible.')).toBe(true);
    expect(hasBlank('a ___ is admissible')).toBe(true);
    expect(hasBlank('a _______ is admissible')).toBe(true);
    expect(hasBlank('snake_case and __init__ are not blanks')).toBe(false);
  });

  /** A question with no blank is an open question, whatever it was asked to be. */
  it('takes the form from what was actually asked', () => {
    expect(questionForm('cloze', 'Fill in the blank: a ____ never overestimates.')).toBe('cloze');
    expect(questionForm('cloze', 'In one sentence, what is a heuristic?')).toBe('open');
    expect(questionForm('open', 'What goes in ____ here?')).toBe('open');
  });
});

/**
 * **The follow-up after a Partly there** (live run, 2026-10-03): six verdicts on one question, the
 * last follow-up asking for a keyword, and `:action ?` answered with another open question.
 */
describe('isGuess', () => {
  it('reads a few words ending in a question mark as a guess', () => {
    expect(isGuess(':action ?')).toBe(true);
    expect(isGuess('is it parameters?')).toBe(true);
    expect(isGuess('  the domain?  ')).toBe(true);
  });

  it('does not read an answer, or a long hedged one, as a guess', () => {
    expect(isGuess('It comes from p.5 under init')).toBe(false);
    expect(isGuess('is it an action, or a series of actions that lead to the goal?')).toBe(false);
    expect(isGuess('?')).toBe(false);
    expect(isGuess('')).toBe(false);
    expect(isGuess(null)).toBe(false);
  });
});

describe('followUpPlan', () => {
  /** 2026-10-06 (D3): after two answers that are not Well done, Show me — never a blank. */
  it('asks one open follow-up, then offers Show me from the second try', () => {
    expect(PARTIALS_BEFORE_SHOW_ME).toBe(2);
    expect(followUpPlan({ attempts: 1, answer: 'preconditions are At, Plane and Airport' }).next).toBe('open');
    expect(followUpPlan({ attempts: 2, answer: 'false: At(P1 SFO), true: At(P1 SIN)' }).next).toBe('show_me');
    expect(followUpPlan({ attempts: 3, answer: 'It comes from p.5 under init' }).next).toBe('show_me');
  });

  it('answers a guess with the offer of Show me, on any try', () => {
    expect(followUpPlan({ attempts: 1, answer: ':action ?' })).toEqual({ next: 'show_me', together: false, guess: true });
  });

  it('never plans a blank', () => {
    for (let attempts = 1; attempts <= 6; attempts += 1) {
      expect(Object.keys(followUpPlan({ attempts, answer: 'x' }))).not.toContain('form');
    }
  });

  it('marks the answers together from the second try', () => {
    expect(followUpPlan({ attempts: 1, answer: 'x' }).together).toBe(false);
    expect(followUpPlan({ attempts: 2, answer: 'x' }).together).toBe(true);
  });
});
