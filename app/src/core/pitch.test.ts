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
import { pitchBlock, pitchInputs, pitchLine, notePitch, DEFAULT_PITCH, type PitchOutcome } from './pitch.js';

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

  it('permits harder after a Well done', () => {
    const text = pitchBlock(pitchInputs({ objectiveId: 'obj_1', outcomes: [verdict('complete')], fill: 1 }));
    expect(text).toContain('You may go harder');
    expect(text).toContain('apply it to another case');
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
