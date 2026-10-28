/**
 * **The tutorial turns' prompt** (`prompts.tutor.ts`, `TUTORIAL-CONTRACT.md` S5): what each kind
 * and rung asks for, the key's guard on every kind but a release, the answer only on a release,
 * and the grounding in the linked notes and lecture pages.
 */
import { describe, expect, it } from 'vitest';
import { FIXTURE_KEYS } from '../shared/doc/tutorial.fixture.test-support.js';
import type { PartKey } from '../shared/tutorial.js';
import {
  TUTORIAL_FOCUS_HEADER,
  TUTOR_ANSWER_HEADER,
  TUTOR_KEY_GUARD_HEADER,
  hintRung,
  tutorialFocusBlock,
  tutorBlock,
  tutorMaxWordCeiling,
  tutorWordCeiling,
  type TutorPromptInput,
} from './prompts.tutor.js';

const KEY: PartKey = FIXTURE_KEYS[0]!; // P1b: answer 'Move(X, Y, Table), Move(Y, Table, X)'

function input(over: Partial<TutorPromptInput> = {}): TutorPromptInput {
  return {
    kind: 'hint',
    level: 1,
    label: 'Problem 1 b.',
    prompt: 'Give a valid plan.',
    answer: '',
    key: KEY,
    notes: [{ blockId: 'b_strips', heading: 'STRIPS actions', text: 'An action has a precondition and an effect.' }],
    slides: [{ page: 14, label: 'Lecture 4, slide 5', text: 'Action(Move(b, x, y), PRECOND: On(b, x) ∧ Clear(b) ∧ Clear(y))' }],
    ...over,
  };
}

const flat = (s: string) => s.replace(/\s+/g, ' ');

describe('tutorBlock: what every kind carries', () => {
  it('names the part, quotes the sheet and the learner’s answer', () => {
    const block = tutorBlock(input({ answer: 'Move(Y, Table, X)' }));
    expect(block).toContain('THE LEARNER IS WORKING ON A TUTORIAL PART: Problem 1 b.');
    expect(block).toContain('Give a valid plan.');
    expect(block).toContain('Move(Y, Table, X)');
    expect(tutorBlock(input())).toContain('They have not written anything in its answer slot yet.');
  });

  it('grounds the help in the linked notes (by heading) and lecture pages (as p. N)', () => {
    const block = flat(tutorBlock(input()));
    expect(block).toContain('“STRIPS actions”');
    expect(block).toContain('An action has a precondition and an effect.');
    expect(block).toContain('Lecture p. 14 (Lecture 4, slide 5) reads:');
    expect(block).toContain('PRECOND: On(b, x)');
    expect(block).toContain('Ground every point of your reply in these');
    expect(block).toContain('(p. 14)');
  });

  it('says so when nothing is linked, and still asks for pages', () => {
    const block = flat(tutorBlock(input({ notes: [], slides: [] })));
    expect(block).toContain('Nothing in the notes or the lecture was linked to this part.');
    expect(block).toContain('p. N');
  });

  it('carries the key guard and never the model answer on hint, refresher and feedback', () => {
    for (const over of [
      { kind: 'hint' as const, level: 1 as const },
      { kind: 'hint' as const, level: 2 as const },
      { kind: 'hint' as const, level: 3 as const },
      { kind: 'refresher' as const },
      { kind: 'feedback' as const, verdict: { verdict: 'partial' as const, checkedBy: 'model' as const, detail: 'The first move is right.' } },
    ]) {
      const block = flat(tutorBlock(input(over)));
      expect(block).toContain(TUTOR_KEY_GUARD_HEADER);
      expect(block).toContain('Never state the answer to this part, or any piece of it that their answer is missing');
      expect(block).not.toContain(TUTOR_ANSWER_HEADER);
      expect(block).not.toContain(KEY.answer);
    }
  });

  it('never leaks a blank’s term or the correct options before a release', () => {
    const blanksKey = FIXTURE_KEYS[1]!;
    const choiceKey = FIXTURE_KEYS[2]!;
    const b = tutorBlock(input({ key: blanksKey }));
    expect(b).not.toContain(blanksKey.blanks!.eff![0]!);
    expect(b).not.toContain(blanksKey.answer);
    const c = tutorBlock(input({ key: choiceKey, kind: 'feedback', verdict: { verdict: 'not_yet', checkedBy: 'simulation', detail: 'Option ii does not reach G.' } }));
    expect(c).not.toContain('The correct options');
  });

  it('gives choice feedback the computed option classifications while leaving the explanation to Max', () => {
    const block = flat(tutorBlock(input({
      kind: 'feedback',
      choice: { picked: ['A', 'D', 'E', 'F', 'G'], correct: ['A', 'D', 'G'] },
      verdict: { verdict: 'not_yet', checkedBy: 'simulation', detail: '3 right, 2 wrong.' },
    })));
    expect(block).toContain('A, D, G are correct; E, F are incorrect.');
    expect(block).toContain('These classifications are authoritative.');
    expect(block).toContain('Explain the underlying concept');
  });

  it('gives the answer, the blanks and the options on a release, and asks for one line on why', () => {
    const block = flat(tutorBlock(input({ kind: 'reveal', key: FIXTURE_KEYS[1]! })));
    expect(block).toContain(TUTOR_ANSWER_HEADER);
    expect(block).toContain(FIXTURE_KEYS[1]!.answer);
    expect(block).toContain('The blanks: eff = F ∧ ∼±G.');
    expect(block).not.toContain(TUTOR_KEY_GUARD_HEADER);
    expect(block).toContain('a single line, in their own words, on why it works');
    const choice = flat(tutorBlock(input({ kind: 'reveal', key: FIXTURE_KEYS[2]! })));
    expect(choice).toContain('The correct options: i.');
  });

  it('asks for a collegial, brief tone and no mention of writing into the tutorial', () => {
    const block = flat(tutorBlock(input()));
    expect(block).toContain('not an examiner');
    expect(block).toContain('Do not say that you are writing anything into the tutorial');
  });
});

describe('tutorBlock: the hint ladder', () => {
  it('hint 1 points: where, what to look at, one guiding question, no steps', () => {
    const block = flat(tutorBlock(input({ level: 1 })));
    expect(block).toContain('THIS IS HINT 1 OF 3: POINT');
    expect(block).toContain('**where** the material for this part is');
    expect(block).toContain('**one** guiding question');
    expect(block).toContain('No steps');
    expect(block).toContain(`At most ${tutorWordCeiling('hint', 1)} words`);
  });

  it('hint 2 breaks it into 2–4 sub-goals as questions, solving none, from the key’s steps', () => {
    const block = flat(tutorBlock(input({ level: 2 })));
    expect(block).toContain('THIS IS HINT 2 OF 3: BREAK IT DOWN');
    expect(block).toContain('**two to four sub-goals**');
    expect(block).toContain('**Do not solve any of them**');
    for (const step of KEY.steps) expect(block).toContain(`- ${step}`);
  });

  it('hint 3 works one step on the lecture’s analogous case, never this part’s data, then hands back', () => {
    const block = flat(tutorBlock(input({ level: 3 })));
    expect(block).toContain('THIS IS HINT 3 OF 3: A WORKED STEP');
    expect(block).toContain('**analogous case from the lecture**');
    expect(block).toContain('**never this part’s own data**');
    expect(block).toContain('hand it back');
  });

  it('holds the rung to 1–3', () => {
    expect(hintRung(0)).toBe(1);
    expect(hintRung(3)).toBe(3);
    expect(tutorMaxWordCeiling('hint')).toBe(tutorWordCeiling('hint', 3));
  });
});

describe('tutorBlock: refresher and feedback', () => {
  it('refresher explains the prerequisite from the key and offers to go back', () => {
    const block = flat(tutorBlock(input({ kind: 'refresher' })));
    expect(block).toContain('THE LEARNER ASKED FOR A REFRESHER');
    expect(block).toContain('- Preconditions must hold before an action');
    expect(block).toContain('offering, in one short sentence, to go back to the part');
  });

  it('a hint does not carry the prerequisites (they are the refresher’s)', () => {
    expect(tutorBlock(input())).not.toContain('Preconditions must hold before an action');
  });

  it('feedback opens with the decided verdict and says what is right, the gap as a question, never the fix', () => {
    const block = flat(
      tutorBlock(input({ kind: 'feedback', answer: 'Move(Y, Table, X)', verdict: { verdict: 'partial', checkedBy: 'model', detail: 'Y is not clear at step 1.' } })),
    );
    expect(block).toContain('Your first line is exactly **Partly there.**');
    expect(block).toContain('Y is not clear at step 1.');
    expect(block).toContain('**what is right**');
    expect(block).toContain('never as the fix');
    expect(block).not.toContain('verified by code');
  });

  it('says plainly when code verified it (“I ran your plan…”)', () => {
    const block = flat(tutorBlock(input({ kind: 'feedback', verdict: { verdict: 'not_yet', checkedBy: 'simulation', detail: 'Step 1 fails: Y is not clear.' } })));
    expect(block).toContain('Your first line is exactly **Not yet.**');
    expect(block).toContain('**verified by code**');
    expect(block).toContain('I ran your plan');
  });

  it('confirms a complete answer briefly with at most one why-probe', () => {
    const block = flat(tutorBlock(input({ kind: 'feedback', verdict: { verdict: 'complete', checkedBy: 'simulation', detail: 'The plan reaches the goal.' } })));
    expect(block).toContain('**Well done.**');
    expect(block).toContain('At most **one** "why" question');
  });

  it('hedges a model judgement against a low-confidence key, and not a simulated one', () => {
    const low: PartKey = { ...KEY, confidence: 'low', from: 'model' };
    const judged = flat(tutorBlock(input({ kind: 'feedback', key: low, verdict: { verdict: 'partial', checkedBy: 'model', detail: 'x.' } })));
    expect(judged).toContain('the official solution may differ');
    const ran = flat(tutorBlock(input({ kind: 'feedback', key: low, verdict: { verdict: 'partial', checkedBy: 'simulation', detail: 'x.' } })));
    expect(ran).not.toContain('the official solution may differ');
  });
});

describe('the tutorial as the main view: what every turn reads about the sheet (2026-10-04)', () => {
  const parts = [
    { label: 'Problem 1 a.', prompt: 'Write the domain.', solved: true, notesHeadings: ['PDDL'], pages: [5, 3, 5] },
    { label: 'Problem 1 b.', prompt: 'Give a valid plan.', solved: false, notesHeadings: [], pages: [] },
  ];
  const notes = [{ blockId: 'b_n1', heading: 'STRIPS actions', text: 'An action has a precondition and an effect.' }];

  it('names the sheet, lists its parts with what is done and where their lecture is, and the notes behind it', () => {
    const block = flat(tutorialFocusBlock({ title: 'Tutorial 1', parts, current: null, notes }));
    expect(block).toContain(`${TUTORIAL_FOCUS_HEADER}: Tutorial 1`);
    expect(block).toContain('- Problem 1 a. (done): "Write the domain." · notes: “PDDL” · lecture p. 3, p. 5');
    expect(block).toContain('- Problem 1 b. (still theirs to solve): "Give a valid plan."');
    expect(block).toContain('THE LECTURE NOTES THE SHEET DRAWS ON');
    expect(block).toContain('under “STRIPS actions”: An action has a precondition and an effect.');
    // Help on a part stays Max's: the turn sends them to the part's own buttons.
    expect(block).toContain('**Check** or **Help** on that part');
  });

  it('puts the part a line is in first, with its problem, its notes and its lecture pages quoted', () => {
    const block = flat(
      tutorialFocusBlock({
        title: 'Tutorial 1',
        parts,
        current: {
          label: 'Problem 1 b.',
          prompt: 'THE PROBLEM: blocks on a table.\n\nTHIS PART: Give a valid plan.',
          notes,
          slides: [{ page: 5, label: 'Lecture 4 p. 5', text: 'Action(Move(b, x, y))' }],
        },
        notes: [],
      }),
    );
    expect(block).toContain('THE LINE THEY ASKED ABOUT IS IN Problem 1 b.');
    expect(block).toContain('THIS PART: Give a valid plan.');
    expect(block).toContain('Lecture p. 5 (Lecture 4 p. 5) reads: """ Action(Move(b, x, y)) """');
    expect(block).toContain('under “STRIPS actions”');
    expect(block).not.toContain('THE LECTURE NOTES THE SHEET DRAWS ON');
  });

  it('never carries a key: it has no field for one, and says nothing of an answer', () => {
    const block = tutorialFocusBlock({ title: '', parts, current: null, notes: [] });
    expect(block).toContain(`${TUTORIAL_FOCUS_HEADER}: Tutorial`);
    expect(block).not.toContain(TUTOR_KEY_GUARD_HEADER);
    expect(block).not.toContain(TUTOR_ANSWER_HEADER);
    expect(block).not.toContain(KEY.answer);
  });

  it('caps a long sheet', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ label: `P${i}`, prompt: 'x'.repeat(500), solved: false, notesHeadings: [], pages: [] }));
    const block = tutorialFocusBlock({ title: 'T', parts: many, current: null, notes: [] });
    expect(block).toContain('…and 6 more parts.');
    expect(block).not.toContain('x'.repeat(300));
  });
});
