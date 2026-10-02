/**
 * **The scenarios** (`sim/README.md`). Each is one sitting: a persona, and the buttons they press
 * in order. The persona's words are the simulated learner's; which buttons, on which lines, is
 * fixed here so that runs can be compared.
 *
 * Lines are found by a substring of the block's text, so a scenario is tied to one notebook's
 * notes (`notebook`, by title). These are written against the "Classical Planning" notebook.
 */
import type { Persona } from './learner.js';

export type Step =
  /** Quiz me on a line, then up to `rounds` learner moves on Max's question (answer, ask, Pass). */
  | { do: 'quiz'; line: string; rounds?: number }
  | { do: 'explain' | 'example'; line: string }
  /** Start on a lesson card (the objective whose title contains `objective`), then up to `rounds` moves. */
  | { do: 'lesson'; objective: string; rounds?: number }
  /** A typed question in the line's thread (a new span thread if it has none). */
  | { do: 'ask'; line: string; text: string }
  /** **Update overview**: the overview rewritten from the sources, its words and budget recorded. */
  | { do: 'overview' };

export interface Scenario {
  id: string;
  title: string;
  /** What this scenario is checking for, in one or two sentences. Printed at the top of the report. */
  purpose: string;
  notebook: string;
  persona: Persona;
  steps: Step[];
}

const PLANNING = 'Classical Planning';

/** Knows the PDDL basics, holds one classic misconception, and is unsure of search. */
const MID: Persona = {
  id: 'mid',
  summary: 'A second-year CS student who attended the lecture and skimmed the notes once.',
  knows: [
    'A state is a set of ground fluents that are true; anything not listed is false (the closed-world assumption).',
    'An action has preconditions and effects; applying it removes the DEL list and adds the ADD list.',
    'Forward search starts from the initial state and applies actions until the goal holds.',
  ],
  gaps: [
    'What "regression" or "relevant action" means in backward search.',
    'How SAT-based planning encodes a plan (CNF, time steps, frame axioms).',
  ],
  misconceptions: [
    'Believes a variable in a goal such as At(p, SFO) means EVERY plane must be at SFO (thinks goal variables are universally quantified).',
    'Believes an action schema like Fly(p, from, to) refers to one particular plane rather than any plane.',
  ],
  style: 'Short answers, one to three sentences, lower case, sometimes hedged ("i think..."). Never writes a formal proof.',
  giveUp: 'Asks what a term means when a question uses one they do not know; presses Pass after two failed tries.',
  readsNotes: true,
};

/** Knows the material well: the case where a nitpicking tester shows up most plainly. */
const STRONG: Persona = {
  id: 'strong',
  summary: 'A strong final-year student who has done planning before and read the notes carefully.',
  knows: [
    'Everything in the notes, and can apply it: compute a successor state, check applicability, regress a goal through an action.',
    'Goal variables are existential; action-schema variables are universal over objects.',
    'Forward vs backward search, relevant actions, why backward search has a smaller branching factor on some problems.',
    'SATPlan: fluents and actions indexed by time step, successor-state axioms, increasing the bound T.',
    'Soundness, completeness and optimality of planners.',
  ],
  gaps: [],
  misconceptions: [],
  style: 'Precise, two to four sentences, uses the notation correctly. Answers what was asked.',
  giveUp: 'Never gives up. If a question is ambiguous, says how they read it and answers that.',
  readsNotes: true,
};

/** Has not met SAT at all: the #49 case, where the learner needs background to try. */
const NO_SAT: Persona = {
  id: 'no-sat',
  summary: 'A student who understands search-based planning but has never seen SAT, CNF or propositional encodings.',
  knows: [
    'States, actions, preconditions and effects in PDDL.',
    'Forward and backward state-space search.',
  ],
  gaps: [
    'What CNF is, what a clause or a literal is, what a SAT solver does.',
    'Anything about encoding plans as propositional formulas, time steps, or frame/successor-state axioms.',
  ],
  misconceptions: [],
  style: 'Polite and direct, one to three sentences.',
  giveUp: 'When a question needs SAT or CNF, first asks for the background (what the format looks like, an example), then tries once with what they were given, then presses Pass if still stuck.',
  readsNotes: false,
};

/** Gives up early: exercises the release and the easier question after it. */
const NOVICE: Persona = {
  id: 'novice',
  summary: 'A first-year student auditing the module who has only read the headings.',
  knows: ['Planning means finding a sequence of actions to reach a goal.'],
  gaps: ['PDDL, fluents, CWA, ADD/DEL lists, forward or backward search, SAT encodings: all of it.'],
  misconceptions: ['Thinks backward search means undoing actions from the goal state one at a time, like an undo button.'],
  style: 'Very short. Often "idk" or a one-line guess.',
  giveUp: 'Presses Pass on any question that needs more than one remembered fact. Answers a fill-in-the-blank if the word is right there in the notes.',
  readsNotes: false,
};

/** Knows ML basics, not LLM fine-tuning or knowledge tracing: the reader the paper assumes away. */
const ML_READER: Persona = {
  id: 'ml-reader',
  summary: 'A third-year CS student who has taken an introductory machine-learning course and is reading this paper for a seminar.',
  knows: [
    'Neural networks are trained by gradient descent on a loss such as cross entropy.',
    'What a pretrained language model like GPT or Llama is, as a user of one.',
    'What accuracy, F1 and AUC measure.',
  ],
  gaps: [
    'How fine-tuning an LLM works, and what LoRA is.',
    'What knowledge tracing is, and what DKT or BKT are.',
    'What a knowledge component (KC) is.',
  ],
  misconceptions: ['Believes fine-tuning means training a new model from scratch on the task data.'],
  style: 'Two or three sentences, casual but careful.',
  giveUp: 'Asks what a term means when a question depends on one they do not know; presses Pass after two failed tries.',
  readsNotes: true,
};

const PAPER = 'Knowledge Tracing in Tutor-Student Dialogues Using LLMs';

export const SCENARIOS: Scenario[] = [
  {
    id: 's1-sequence',
    title: 'Three Quiz me presses in a row, one misconception',
    purpose:
      'The reported case. After the first question is settled, does each later question ask about the line it was pressed on, and avoid re-testing what was settled? Does Max catch and correct the goal-variable misconception with grounds?',
    notebook: PLANNING,
    persona: MID,
    steps: [
      { do: 'quiz', line: 'States are conjunctions of ground fluents', rounds: 3 },
      { do: 'quiz', line: 'Forward search starts at the initial state', rounds: 3 },
      { do: 'quiz', line: "a applies in s if s entails Precond(a)", rounds: 3 },
    ],
  },
  {
    id: 's2-background',
    title: 'A question that needs background the learner lacks',
    purpose:
      'The #49 case. When the learner asks for the background a question assumes, does Max give it (Not marked, a toy example, the question again) rather than refuse, and is the question itself answerable from the page?',
    notebook: PLANNING,
    persona: NO_SAT,
    steps: [{ do: 'quiz', line: 'Planning problem becomes a propositional CNF formula', rounds: 4 }],
  },
  {
    id: 's3-strong',
    title: 'A strong learner across three sections',
    purpose:
      'Point 1. With a learner who gets everything right, do the questions test using the idea (apply, compare, predict) or recall of a printed fact or an either/or? Does a second question after Well done go deeper rather than sideways?',
    notebook: PLANNING,
    persona: STRONG,
    steps: [
      { do: 'quiz', line: "a applies in s if s entails Precond(a)", rounds: 2 },
      { do: 'quiz', line: 'Air cargo domain models Load, Unload, Fly', rounds: 2 },
      { do: 'quiz', line: 'Backward search regresses the goal', rounds: 2 },
      { do: 'quiz', line: 'Soundness means valid plans', rounds: 2 },
    ],
  },
  {
    id: 's4-giveup',
    title: 'Give up, then ask again nearby',
    purpose:
      'After a Pass, is the answer released in full with grounds, and is the next question on that objective easier (a fill-in-the-blank), on the new line, and not the old question reworded?',
    notebook: PLANNING,
    persona: NOVICE,
    steps: [
      { do: 'quiz', line: 'Backward search regresses the goal', rounds: 2 },
      { do: 'quiz', line: 'Forward search starts at the initial state', rounds: 2 },
    ],
  },
  {
    id: 's6-settled-point',
    title: 'Your 1 Oct sequence: the goal line, then the action-schema line',
    purpose:
      'Lucas\'s live case. The first question is likely to be on goal variables and to meet the misconception; once it is settled, does the question on the action-schema line test that line, and test it differently, rather than re-asking the same quantifier distinction from the other side?',
    notebook: PLANNING,
    persona: MID,
    steps: [
      { do: 'quiz', line: 'A goal is a partial state', rounds: 3 },
      { do: 'quiz', line: 'Air cargo domain models Load, Unload, Fly', rounds: 3 },
      { do: 'quiz', line: 'Forward search starts at the initial state', rounds: 3 },
    ],
  },
  {
    id: 's7-lesson',
    title: 'Start a lesson',
    purpose:
      'The 1 Oct change to Start. Does Ellie say what the lesson is without teaching it or asking anything, does Max then ask one question on that objective after a reading pause, and is the question one that clears the objective?',
    notebook: PLANNING,
    persona: MID,
    steps: [{ do: 'lesson', objective: "ADD/DEL", rounds: 3 }],
  },
  {
    id: 'p1-paper-gaps',
    title: 'A research paper read by someone missing its background',
    purpose:
      'notebooks.md 3.2 and 4.2, amended 2 Oct. When a question uncovers background the notes assume (fine-tuning, LoRA, knowledge tracing, KCs), does the doc get a background note under the line asked about, labelled as background, rather than a one-line restatement? Is the paper\'s overview, rewritten under the prose policy, a map with its method, data and results?',
    notebook: PAPER,
    persona: ML_READER,
    steps: [
      { do: 'ask', line: 'LLMKT fine-tunes Llama-3.1-8B-Instruct', text: 'how is LLM finetuning done in general, then specifically for this paper?' },
      { do: 'explain', line: 'Multi-KC turns lead to a compensatory' },
      { do: 'ask', line: 'Three stages: identify KCs', text: 'what is a knowledge component, and what is knowledge tracing actually predicting?' },
      { do: 'quiz', line: 'LLMKT fine-tunes Llama-3.1-8B-Instruct', rounds: 2 },
      { do: 'overview' },
    ],
  },
  {
    id: 's5-explain-then-quiz',
    title: 'Explain a line, then Quiz me on it',
    purpose:
      'Does the question after Explain test what Ellie just explained on that line, rather than a neighbouring fact, and avoid asking the learner to repeat her sentence back?',
    notebook: PLANNING,
    persona: MID,
    steps: [
      { do: 'explain', line: "a applies in s if s entails Precond(a)" },
      { do: 'quiz', line: "a applies in s if s entails Precond(a)", rounds: 3 },
    ],
  },
];
