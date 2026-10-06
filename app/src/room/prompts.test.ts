/**
 * **The Teacher's contract, asserted as text** (#36).
 *
 * The bug these tests exist for is not a crash — it is a prompt that was *correct* about
 * fidelity and read by the model as a fence around its knowledge. On the CS4246 MDP slide Ellie
 * said *"your slide doesn't name other formalisms, so I don't want to invent ones it doesn't
 * mention"*, ended six turns out of six on a Socratic question after the learner had said "no
 * idea" twice, and never answered a direct question before probing.
 *
 * A prompt regression is invisible until a learner hits it, so the two halves are pinned here:
 * the **fencing phrases that must never come back**, and the **three sentences that must always
 * be there**. Both lists are deliberately literal. If a rewrite has to move one of these
 * strings, the test is the place to argue about it.
 */
import { describe, expect, it } from 'vitest';
import { PROMPT_VERSION, quizBlock, roleBlock, sharedBlock, teachObjectiveBlock, turnDirective, whereBlock } from './prompts.js';
import type { AgentProfile } from '../shared/types.js';
import type { ConceptPack, MaterialRow } from './records.js';
import { UNMARKED_OPENER, VERDICT_OPENERS } from './flow.js';
import {
  docTextBlock,
  blockActionBlock,
  ellieAnswersBlock,
  maxFollowupBlock,
  maxPromptBlock,
  mentionReplyBlock,
  releaseBlock,
} from './prompts.doc.js';

const ELLIE: AgentProfile = {
  key: 'peer.ellie',
  role: 'peer',
  displayName: 'Ellie',
  colour: '#2563EB',
  verb: 'thinking',
  model: 'claude-haiku-4-5',
  latency: { ttftMinMs: 3000, ttftMaxMs: 6000 },
};

const MAX: AgentProfile = {
  key: 'challenger.max',
  role: 'challenger',
  displayName: 'Max',
  colour: '#B45309',
  verb: 'reading',
  model: 'claude-haiku-4-5',
  latency: { ttftMinMs: 9000, ttftMaxMs: 12000 },
};

/**
 * Prompt text is hard-wrapped at 96 columns, so a sentence that reads as one line in the source
 * is two in the string. Every assertion below runs on the **flattened** text: what is under test
 * is what the model reads, and the model does not read the newlines.
 */
const flat = (s: string) => s.replace(/\s+/g, ' ').trim();

const teacher = () => flat(roleBlock('peer', ELLIE, MAX));
const tester = () => flat(roleBlock('challenger', MAX, ELLIE));

const MATERIAL = {
  id: 'mat_1',
  module_code: 'CS4246',
  title: 'Lecture — MDP',
  extracted_text: 'Model-free RL. 𝑀 ≜ ⟨𝑆, 𝐴, 𝑇, 𝑅⟩ with 𝑇 and 𝑅 unknown.',
  outline: '',
  topic_context: '',
  padding_text: '',
} as unknown as MaterialRow;

const PACK = {
  concept_id: 'c1',
  elements: [
    {
      id: 'R1',
      label: 'Model-free RL does not know T or R',
      learner_label: 'the agent has to learn from experience',
      criteria: { '1': 'a', '2': 'b', '3': 'c', '4': 'd' },
      misconceptions: [{ id: 'M1', text: 'an MDP is just a state representation' }],
    },
  ],
} as unknown as ConceptPack;

const shared = () =>
  flat(sharedBlock({ material: MATERIAL, pack: PACK, topic: 'model-free RL', roster: [ELLIE, MAX] }));

describe('the Teacher may teach what the slide assumes', () => {
  /**
   * Every phrase here is either a sentence that was *in* v0.2 and produced the refusal, or the
   * retired Peer contract of `design-brief.md` §D1 ("may never supply a complete correct
   * explanation"), which #32 replaced with "the Teacher explains". None may return.
   */
  const FENCES = [
    'do not invent',
    "don't invent",
    'only what the slide',
    'only from the slide',
    'never supply',
    'work from what is actually on the slide',
    'explain from the learner',
    'do not go beyond',
    'the slide is the arbiter of fact',
    'stick to the slide',
    'confine yourself',
    'if the slide does not say',
  ];

  it('contains no phrase that fences the Teacher off from her own knowledge', () => {
    const text = `${shared()}\n${teacher()}`.toLowerCase();
    const found = FENCES.filter((f) => text.includes(f));
    expect(found).toEqual([]);
  });

  it('says in so many words that prerequisites and outside formalisms are in scope', () => {
    const t = teacher().toLowerCase();
    expect(t).toContain('prerequisites the slide assumes');
    expect(t).toContain('equivalent formalisms');
    expect(t).toContain('eli5');
    // The failing turn's exact excuse, inverted.
    expect(t).toContain("\"the slide doesn't mention it\" is never a reason to withhold");
  });

  it('carries the beyond-the-slide clause — the one thing that replaces the fence', () => {
    // Said twice on purpose: once in the shared rules (S5, which every agent reads) and once in
    // the Teacher's own block, because the shared block is the half that is cached and skimmed.
    expect(shared()).toContain("the slide doesn't say this, but…");
    expect(teacher()).toContain("the slide doesn't say this, but…");
    // Fidelity survives, because it is the thing that makes the licence safe.
    expect(teacher()).toContain('pretend the slide says something it does not');
  });
});

describe('answer first, then teach', () => {
  it('puts the answer-first rule in the Teacher block', () => {
    const t = teacher();
    expect(t).toContain('ANSWER FIRST, THEN TEACH.');
    expect(t).toMatch(/direct question gets a direct answer in your first sentence/);
    expect(t).toMatch(/names the thing they asked about/);
  });

  it('restates it in the turn directive, which is the sentence nearest the generation', () => {
    const d = flat(turnDirective({ agentRole: 'peer', move: 'answer_then_teach' }));
    expect(d).toContain('Answer what they asked in your first sentence');
    expect(d).toContain('No opening question.');
    // Not on a nudge, not on a quiz, not on the Tester.
    expect(turnDirective({ agentRole: 'peer', move: 'content_free_nudge' })).not.toContain('Answer what they asked');
    expect(turnDirective({ agentRole: 'challenger', move: 'quiz' })).not.toContain('Answer what they asked');
  });

  it('bans the reflex question and says what to do after a "no idea"', () => {
    const t = teacher();
    expect(t).toContain('A QUESTION IS A TOOL, NOT A REFLEX.');
    expect(t).toContain('At most one question per turn');
    expect(t).toContain('Never two turns running unless they answered the first.');
    expect(t).toMatch(/"no idea"[\s\S]{0,140}NO question of any kind/);
    // The soft check-in is the one the live run of 2026-09-16 still slipped through.
    expect(t).toContain('not a soft check like "does that make sense?"');
  });
});

describe('length fits the job', () => {
  /**
   * **120/180, since #47 §4.** The 200/250 range this replaces was itself a correction of a flat
   * 80-word cap; what moved it again is the measurement: the studied sessions ran 246–1,190 AI words
   * per turn, R2 ran 93 AI words per typed learner word, and the answers were not read in full
   * (`findings.md` RQ5). Xu et al. ran every agent reply near 80. Prompt-level only — #36's argument
   * that a code-side cap re-creates the truncation failure is unchanged.
   */
  it('aims at 120 words with 180 as the ceiling, and sizes the Tester’s two turns', () => {
    const s = shared();
    expect(s).not.toContain('about 80 words');
    expect(s).not.toContain('about 200 words');
    expect(s).toContain('aims at **about 120 words, with 180 as the ceiling**');
    expect(s).toContain('Feedback on an answer is under 100 words; a model answer is under 150.');
    expect(s).toContain('do not compress an explanation into a hint');
  });

  it('keeps the Tester short, since the longer length is the Teacher\'s', () => {
    expect(tester()).toContain("House rule 3's longer lengths are the teacher's.");
  });

  it('asks for typesettable maths', () => {
    expect(shared()).toContain('$…$ inline');
  });

  /**
   * #41: `**Non-negativity**` reached the screen as those characters. The renderer now renders a
   * closed subset (`renderer/lib/aitext.ts`); this is the prompt half, and the two lists have to
   * name the same things or the agreement is a coincidence.
   */
  it('names the formatting subset the renderer implements, and what it is not', () => {
    const s = shared();
    for (const allowed of ['**bold**', '*italics*', 'numbered lists', 'bulleted lists']) {
      expect(s).toContain(allowed);
    }
    for (const banned of ['No headings', 'no tables', 'no links', 'no code fences', 'no HTML']) {
      expect(s).toContain(banned);
    }
    // And it says *why* the list is closed, which is the half a model acts on.
    expect(s).toContain('prints anything else as the literal characters you typed');
  });

  /**
   * **House rule 9 bans backtick code, so no chat-turn prompt may show one** (#49). The grounds
   * format was written as `` `p. N: "…"` `` in the very blocks that ask for it, and a model copies
   * the format it is shown, backticks included.
   */
  it('shows no backtick in any block a chat turn is built from', () => {
    const blocks = [
      roleBlock('peer', ELLIE, MAX),
      roleBlock('challenger', MAX, ELLIE),
      ...(['question', 'feedback', 'answer', 'clarify'] as const).map(
        (turn) => quizBlock({ label: 'x', seeds: ['s'], demonstration: ['c'], turn })!,
      ),
      ...['answer_then_teach', 'quiz', 'quiz_hint', 'quiz_answer', 'quiz_clarify', 'quiz_feedback', 'peer_guess',
        'max_prompt', 'lesson_start', 'mention_reply', 'teach_objective'].map((move) =>
        turnDirective({ agentRole: move === 'answer_then_teach' ? 'peer' : 'challenger', move, byRule: 'rule:max_followup' }),
      ),
      turnDirective({ agentRole: 'peer', move: 'block_explain' }),
      turnDirective({ agentRole: 'peer', move: 'block_example' }),
      turnDirective({ agentRole: 'challenger', move: 'quiz', byRule: 'rule:try_here', cloze: true }),
      ellieAnswersBlock({ page: 4 }),
      ellieAnswersBlock({}),
      ellieAnswersBlock({ maxFollows: true }),
      blockActionBlock({ kind: 'explain', quote: 'A line.', page: 4 }),
      blockActionBlock({ kind: 'example', quote: 'A line.' }),
    ];
    for (const block of blocks) expect(block, block.slice(0, 80)).not.toContain('`');
    // The format itself is still asked for, in plain characters.
    expect(flat(quizBlock({ label: 'x', seeds: [], demonstration: ['c'], turn: 'feedback' })!)).toContain('as p. N: “…”');
    expect(ellieAnswersBlock({ page: 4 })).toContain('name p. 4 in the answer');
  });
});

describe('the safeguards that did not change, restated so the model reads them', () => {
  it('states the evidence rule, the crop rule and who closes a thread, one line each', () => {
    const s = shared();
    // pivot-spec.md §B0 R5 — and the reason the Teacher can now explain freely.
    expect(s).toMatch(/Nothing you write ever counts as the learner's own evidence/);
    // pdf-fidelity-segmentation.md §C4, the never-rule.
    expect(s).toMatch(/nothing you write is ever drawn inside one of the slide's crops/);
    // R3.
    expect(s).toContain('The learner closes a thread.');
  });

  /**
   * `collab-doc.md` §4.2 row 4: *"verdict first (Well done. / Partly there. / Not yet.), grounds as
   * p. N: "…", and a follow-up on the same question unless Well done"*. The role block used to say
   * the feedback turn "carries no new question" (#49), against the feedback block beside it.
   */
  it('keeps the Tester at one question, and gives feedback as verdict, grounds and a follow-up', () => {
    const t = tester();
    expect(t).toContain('One question per turn');
    expect(t).toContain('**Never supply the answer you are fishing for.**');
    expect(t).toContain('feedback on what they actually said');
    expect(t).not.toContain('That turn carries no new question.');
    for (const opener of VERDICT_OPENERS) expect(t).toContain(opener);
    expect(t).toContain('Unless the verdict is Well done, it ends on one follow-up question');
  });

  /** `collab-doc.md` §4.4: *"On give_up, at any time, with or without an attempt: Max gives the full answer with grounds."* */
  it('releases the answer on a give-up or a Pass, with or without a try', () => {
    const t = tester();
    expect(t).toContain('gives up');
    expect(t).toContain('presses Pass');
    expect(t).toContain('with or without a try');
    expect(t).toContain('in full, with its grounds');
  });

  it('lets the verdict mark the answer without the safeguards forbidding it', () => {
    const s = shared();
    expect(s).not.toContain('grade the learner');
    expect(s).toContain('S7 Never rate or score the learner, and never mention the ledger.');
    expect(s).toContain('marks that answer, not the person');
  });
});

/**
 * **No retired rule in any Max prompt** (#49). `collab-doc.md` §4.4 retired the attempt lock
 * (`rule:answer_withheld`), but the Tester's role block still said *"THE ANSWER IS NOT YOURS TO
 * GIVE UNTIL THEY HAVE TRIED … one try unlocks it — the app enforces this"*, and the live run's
 * refusals ("Not yet… One hint, then it's your turn") followed it. Every block Max is built from is
 * checked here; `actor.attempt.test.ts` checks the requests the real actor sends him.
 */
describe('Max’s prompts carry no retired rule', () => {
  const RETIRED = [/one try unlocks/i, /not yours to give/i, /never grade/i, /grade the learner/i, /carries no new question/i];

  it('in the prefix, the role block, every quiz turn and every Tester directive', () => {
    const blocks = [
      shared(),
      tester(),
      ...(['question', 'feedback', 'answer', 'clarify', 'hint_withheld'] as const).map(
        (turn) => quizBlock({ label: 'x', seeds: ['s'], demonstration: ['c'], turn })!,
      ),
      ...['quiz', 'quiz_hint', 'quiz_answer', 'quiz_clarify', 'quiz_feedback', 'max_prompt', 'mention_reply'].flatMap((move) =>
        ['rule:max_followup', 'rule:answer_released', 'rule:quiz_nudge', 'rule:answer_withheld'].map((byRule) =>
          turnDirective({ agentRole: 'challenger', move, byRule }),
        ),
      ),
      maxFollowupBlock({ objectiveLabel: 'x' }),
      maxPromptBlock({ guess: 'maybe', roster: [ELLIE, MAX] }),
      ...(['give_up', 'pass', 'closure'] as const).map((releasedBy) =>
        releaseBlock({ releasedBy, attempts: 1, cueClaim: 'x', roster: [ELLIE, MAX] }),
      ),
      mentionReplyBlock(),
      docTextBlock({ blockQuote: 'x' }),
    ];
    for (const block of blocks) {
      for (const phrase of RETIRED) expect(flat(block), `${phrase} in: ${block.slice(0, 60)}`).not.toMatch(phrase);
    }
  });
});

/**
 * **Issue #41.** v0.3 made her answer first; the learner then had to write the *shape* of the
 * explanation himself — *"explain stochastic as a concept, what it means, then the rigourous
 * version, mathematical properties etc."* — and got a good answer the moment he did. These pin the
 * shape as hers, and the one prohibition #41's first transcript needs beside it.
 */
describe('the default explanation shape', () => {
  it('gives the five steps, in order, in the Teacher block', () => {
    const t = teacher();
    expect(t).toContain('THE SHAPE OF AN EXPLANATION.');
    const shape = t.slice(t.indexOf('THE SHAPE OF AN EXPLANATION.'), t.indexOf('REGISTER.'));
    const order = ['Name it', 'plain language', 'concrete example', 'rigorous version', 'how this slide uses it'];
    let at = -1;
    for (const step of order) {
      const next = shape.indexOf(step);
      expect(next).toBeGreaterThan(at);
      at = next;
    }
  });

  it('forbids opening with a summary of the slide when the question is "what is X"', () => {
    const t = teacher();
    expect(t).toContain('**Never open with a summary of the slide when the question is "what is X".**');
    expect(t).toContain('slide is where the answer lands, not where it starts');
    // The example is never mandatory-in-name-only: "Always one. Never none."
    expect(t).toContain('Always one. Never none.');
  });

  it('does not force the shape onto a question that is not "what is X"', () => {
    expect(teacher()).toContain('"what are some examples of Y" opens with examples');
  });

  it('restates the shape in the answer_then_teach directive, and nowhere else', () => {
    const d = flat(turnDirective({ agentRole: 'peer', move: 'answer_then_teach' }));
    expect(d).toContain('name it, plain meaning with no notation, one concrete example or analogy');
    expect(d).toContain('Do not open with a summary of the slide.');
    expect(turnDirective({ agentRole: 'peer', move: 'reexplain_simpler' })).not.toContain('Do not open with a summary');
    expect(turnDirective({ agentRole: 'challenger', move: 'quiz' })).not.toContain('Do not open with a summary');
  });
});

describe('the version', () => {
  it('is bumped, because the prefix hash moves with the rules', () => {
    // v0.7: #48's six new moves, and the deletion of `rule:answer_withheld`'s unlock clause.
    // v0.8: the same clause out of the Tester's role block, and S7 aligned with the verdict (#49).
    expect(PROMPT_VERSION).toBe('prompts.v0.8');
  });
});

/**
 * Issue #38 §4 and §5: what the Tester is given to ask from, and what the Teacher is given when
 * the learner clicks a prerequisite the deck never teaches.
 */
describe('quizBlock', () => {
  /**
   * **The seeds are ideas, not stems** (sim harness, 2026-10-01): told to "ask one of these", Max
   * followed a section-wide recall seed in 23 of 42 simulated questions.
   */
  it('offers the objective’s seeds as angles, not as questions to copy, and says what a good question is', () => {
    const block = quizBlock({
      label: 'what /btw can see',
      seeds: ['What does /btw promise about the history?', 'Where does its answer come from?'],
      demonstration: ['names both halves'],
    })!;
    expect(block).toContain('what /btw can see');
    expect(block).toContain('What does /btw promise about the history?');
    expect(flat(block)).toContain('for ideas only — do not reuse their wording');
    expect(block).not.toContain('ask one of these');
    expect(flat(block)).toContain('A good question makes them use the idea');
    expect(flat(block)).toContain('not an either/or');
    expect(block).toContain('names both halves');
    // No Quiz me line, no line block: a lesson's question is about the objective.
    expect(block).not.toContain('THE LINE THEY PRESSED QUIZ ME ON');
  });

  /** `notebooks.md` §4.1: Quiz me asks about one line, so the line leads the question turn. */
  it('puts the pressed line in front of the seeds on a Quiz me question', () => {
    const block = quizBlock({
      label: 'Compare soundness, completeness and complexity',
      seeds: ['What is the complexity difference between PlanSAT and Bounded PlanSAT?'],
      line: 'Soundness means valid plans; completeness means a solution is found if it exists.',
    })!;
    const at = block.indexOf('THE LINE THEY PRESSED QUIZ ME ON');
    expect(at).toBeGreaterThan(0);
    expect(block).toContain('"Soundness means valid plans; completeness means a solution is found if it exists."');
    expect(flat(block)).toContain('Your question is about the idea in this line');
    expect(at).toBeLessThan(block.indexOf('PlanSAT and Bounded'));
  });

  /**
   * §2.4, second cut (Lucas's 2026-09-19 run): the feedback turn opens with one of three fixed
   * verdicts, marks the answer to the question asked rather than the objective's whole list, and
   * ends on one follow-up question unless the verdict is "Well done." The seeds are still not
   * offered: the follow-up is about the gap, not a fresh question.
   */
  /**
   * Sim harness, 2026-10-01: with the objective's checklist in view, correct answers were marked
   * *Partly there* for a step the question never asked. The feedback turn now sees the question
   * it marks, and not the checklist.
   */
  it('on the feedback turn demands a verdict first, marks the question asked, and ends on a follow-up', () => {
    const block = quizBlock({
      label: 'what /btw can see',
      seeds: ['A question nobody should ask now.'],
      demonstration: ['names the missing tools'],
      question: 'What two things does /btw leave out of the main thread?',
      feedback: true,
    })!;
    expect(block).not.toContain('names the missing tools');
    expect(block).not.toContain('A correct demonstration contains');
    expect(block).not.toContain('A question nobody should ask now.');
    expect(block).toContain('THE QUESTION YOU ASKED, WHICH IS WHAT YOU MARK:');
    expect(block).toContain('"What two things does /btw leave out of the main thread?"');
    expect(flat(block)).toContain('against **the question you asked**, not against the whole objective');
    expect(flat(block)).toContain('**A step or fact the question did not ask for is never missing**');
    expect(flat(block)).toContain('the verdict is Well done.');
    for (const v of VERDICT_OPENERS) expect(block).toContain(`**${v}**`);
    expect(flat(block)).toContain('Your first line is exactly one of these three verdicts');
    expect(flat(block)).toContain('**end on one follow-up question**');
    // 6 Oct afternoon (item 3): after Well done Max names the deck's term, and asks nothing.
    expect(flat(block)).toContain("After Well done. name the deck's own term for what they said in one sentence, and ask nothing");
    expect(block).not.toContain('No new question this turn.');
  });

  /**
   * 6 Oct afternoon (items 1 and 13, `notebooks.md` §11.10), replacing D3's "name it, never state
   * or quote it": no page as the hint, and only what is new, in two or three sentences.
   */
  it('asks the feedback turn for no riddles and only what is new', () => {
    const block = flat(quizBlock({ label: 'x', seeds: [], demonstration: [], question: 'Why?', turn: 'feedback' })!);
    expect(block).toContain('**No riddles.** If what is missing is a word or a fact, state it plainly and ask them to use it.');
    expect(block).toContain('give one plain hint: an analogy, or the first step');
    expect(block).toContain('Never point to a page as the hint');
    expect(block).toContain('**Only what is new, in two or three sentences**');
    expect(block).toContain('At most 60 words, formulas not counted.');
    expect(block).not.toContain('Do not state or quote what is missing');
    const directive = flat(turnDirective({ move: 'quiz_feedback', agentRole: 'challenger' } as never));
    expect(directive).toContain('Never a page as the hint');
    expect(directive).not.toContain('Do not state or quote what is missing');
  });

  /** Item 3: the model answer reaches the marking turn, with the points and how to report them. */
  it('gives the marking turn the hidden model answer and asks which points are stated', () => {
    const block = flat(
      quizBlock({
        label: 'x',
        seeds: [],
        question: 'Why must the sum be 1?',
        turn: 'feedback',
        model: { answer: 'It is a distribution over next states.', points: ['outcomes cover every case', 'so they total 1'] },
        covered: [2],
      })!,
    );
    expect(block).toContain('(private until the question closes): It is a distribution over next states.');
    expect(block).toContain('1. outcomes cover every case 2. so they total 1');
    expect(block).toContain('Their answers so far, taken together, state point 2.');
    expect(block).toContain('**Mark by meaning.**');
    expect(block).toContain('never hunt for the slide’s exact word');
    expect(block).toContain('lists the numbers');
    // Never on the question turn.
    const asked = flat(quizBlock({ label: 'x', seeds: [], line: 'l', model: { answer: 'A', points: ['p'] } })!);
    expect(asked).not.toContain('YOUR MODEL ANSWER');
  });

  /** Item 2: the third try's directive gives the answer and offers nothing. */
  it('closes on the third try in the directive', () => {
    const directive = flat(turnDirective({ move: 'quiz_feedback', agentRole: 'challenger', close: true } as never));
    expect(directive).toContain('This is their third try. Unless it is Well done, ask **nothing**');
    expect(directive).toContain('No offer to try again.');
    expect(directive).not.toContain('Show me');
  });

  /**
   * **#49's fallback: the one non-verdict exit.** The 2026-09-23 run's request for the CNF format
   * reached the feedback turn and the model, which saw it was a request, could only write *Not
   * yet*. Now it may open `Not marked.`, give the background and re-ask; code un-counts the attempt.
   */
  it('lets the feedback turn open "Not marked." for a request with no answer in it, and says what then', () => {
    const block = flat(quizBlock({ label: 'x', seeds: [], demonstration: ['c'], turn: 'feedback' })!);
    expect(block).toContain(`your first line is exactly **${UNMARKED_OPENER}**`);
    expect(block).toContain('offers no answer to your question');
    expect(block).toContain('at most 80 words');
    // Live check, 2026-09-25: without these the model taught its own question's answer on the
    // question's own case, at 85–103 words.
    expect(block).toContain('never the case your question asks about');
    expect(block).toContain('**Do not answer your question** and give no hint towards it');
    expect(block).toContain('give the general format only and leave applying it to them');
    expect(block).toContain('ask the same question again in one sentence. No verdict.');
    // …and it is not a way out of marking an attempt, however weak.
    expect(block).toContain('Anything that tries an answer, however short, hedged or wrong, is marked');
    const directive = flat(turnDirective({ move: 'quiz_feedback', agentRole: 'challenger' } as never));
    expect(directive).toContain(`first line **${UNMARKED_OPENER}**`);
    expect(directive).toContain('tries no answer at all');
    expect(directive).toContain('no verdict');
    expect(directive).toContain('without answering it');
  });

  it('restates the question on the clarify turn and says it was not a try', () => {
    const block = quizBlock({ label: 'x', seeds: ['s'], demonstration: ['c'], turn: 'clarify' })!;
    expect(flat(block)).toContain('End with the question again, in one sentence');
    expect(flat(block)).toContain('did not count as a try');
    const directive = turnDirective({ move: 'quiz_clarify', agentRole: 'challenger' } as never);
    expect(directive).toContain('did not count as a try');
  });

  it('puts the verdict rule in the feedback directive, where the model reads last', () => {
    const directive = turnDirective({ move: 'quiz_feedback', agentRole: 'challenger' } as never);
    for (const v of VERDICT_OPENERS) expect(directive).toContain(`**${v}**`);
    expect(directive).toContain('not the whole objective');
    expect(directive).toContain('one follow-up question on the gap');
  });

  /**
   * **The grounds clause** (#47 §3): a verdict the learner cannot check is one they have to take on
   * trust, and R6's Tester-style verdicts were wrong 11 times in 21, nine of them marking a correct
   * answer incorrect. Asked for in the prompt, not verified in code — that is A2's first job (§8).
   */
  it('makes the feedback turn cite the deck, and never mark down a learner who argues', () => {
    const block = quizBlock({
      label: 'what /btw can see',
      seeds: [],
      demonstration: ['names the missing tools'],
      turn: 'feedback',
    })!;
    expect(block).toContain('p. N');
    expect(block).toContain('verbatim');
    expect(block).toContain('the deck doesn\u2019t settle this');
    expect(block).toContain('Never call an answer wrong on a rule you cannot ground');
    expect(block).toContain('not a mark against them');
    // 6 Oct afternoon (item 13): the cap is 60 words, formulas not counted, and code holds it too.
    expect(block).toContain('At most 60 words');
  });

  it('gives the whole answer once, with its grounds, on the answer turn', () => {
    const block = quizBlock({
      label: 'what /btw can see',
      seeds: ['A question nobody should ask now.'],
      demonstration: ['names the missing tools'],
      turn: 'answer',
    })!;
    // #48 §4.4: released rather than unlocked, and given whether or not they attempted it.
    expect(block).toContain('is not going to answer this one');
    // 6 Oct afternoon (item 17): credit only what was stated, never "the core idea".
    expect(flat(block)).toContain('one sentence crediting only what their answers actually stated');
    expect(flat(block)).toContain('Never say they had the core idea');
    expect(block).toContain('Under 150 words');
    expect(block).toContain('p. N');
    expect(block).not.toContain('A question nobody should ask now.');
  });

  it('clarifies without answering, and leaves the question standing', () => {
    const block = quizBlock({ label: 'x', seeds: ['s'], demonstration: ['c'], turn: 'clarify' })!;
    expect(block).toContain('**Do not answer the question**');
    expect(block).toContain('leave the question standing');
  });

  /**
   * **`hint_withheld` no longer claims a rule the app does not have** (#48). `collab-doc.md` §4.4
   * retires `rule:answer_withheld`, its only producer, so nothing reaches this branch — and a turn
   * that still said *"one try unlocks it"* would be describing a lock that was taken off.
   */
  it('gives a hint without claiming the answer is locked behind an attempt', () => {
    const block = quizBlock({ label: 'x', seeds: ['s'], demonstration: ['c'], turn: 'hint_withheld' })!;
    // Flattened, because the prompt is hard-wrapped and the model does not read the newlines.
    expect(flat(block)).toContain('Give **one** hint that narrows the question');
    expect(flat(block)).not.toContain('one try unlocks');
    expect(flat(block)).not.toContain('not given before one attempt');
  });

  /** And the directive half of the same deletion (`turnDirective`, `rule:answer_withheld`). */
  it('no longer carries an unlock clause on a hint, whatever rule produced it', () => {
    for (const byRule of ['rule:quiz_nudge', 'rule:silence_hint', 'rule:answer_withheld']) {
      const d = turnDirective({ agentRole: 'challenger', move: 'quiz_hint', byRule });
      expect(d, byRule).toContain('Give one hint that narrows it');
      expect(d, byRule).not.toContain('one try unlocks');
    }
  });

  it('is absent for an element with no seeds and no criteria, so nothing empty is appended', () => {
    expect(quizBlock({ label: 'x', seeds: [], demonstration: [] })).toBeUndefined();
  });
});

describe('teachObjectiveBlock', () => {
  it('says plainly that an assumed prerequisite is not in the deck', () => {
    const block = teachObjectiveBlock({
      title: 'What an MDP is',
      statement: 'States, actions, transitions and a reward.',
      criteria: ['names the four parts'],
      assumedByDeck: true,
      requiring: 'State the Bellman optimality equation',
    });
    expect(block).toContain('What an MDP is');
    expect(block).toContain('assumes');
    expect(block).toContain('general knowledge');
    expect(block).toContain('State the Bellman optimality equation');
    // The learner asked for an explanation, not a conversation.
    expect(block).toContain('End with no question');
  });

  it('does not claim the deck assumes something it teaches', () => {
    const block = teachObjectiveBlock({
      title: 'A taught thing',
      statement: 'It is on page 4.',
      criteria: [],
      assumedByDeck: false,
      requiring: null,
    });
    expect(block).not.toContain('general knowledge');
  });
});

/**
 * **#49: Max's question stays inside the deck.** The page block's *"or your own knowledge of the
 * field, use it"* was written for Ellie's answers and prepended to Max's follow-up too; on
 * 2026-09-23 he asked for a CNF encoding p. 7 only names.
 */
describe('whereBlock', () => {
  const page = { scope: 'segment' as const, page: 7, label: 'Planning approaches', passageText: 'Encode as SAT (CNF)' };

  it('lifts the fence for an answer', () => {
    const block = flat(whereBlock(page));
    expect(block).toContain('your own knowledge of the field');
    expect(block).toContain('It is **not** a limit on what you may use');
  });

  it('makes the page the fence for the Tester’s question', () => {
    const block = flat(whereBlock({ ...page, forTester: true }));
    expect(block).toContain('p. 7');
    expect(block).toContain('Encode as SAT (CNF)');
    expect(block).not.toContain('your own knowledge of the field');
    expect(block).not.toContain('not** a limit');
    expect(block).toContain('your question must be answerable from');
    expect(block).toContain('no method, notation or format the deck only names');
  });
});

/**
 * `notebooks.md` §3.2, amended 2026-10-02: on a paper the agents are told, nearest the generation,
 * that it is "the paper", not "the slide"; and Explain is shorter, its analogy optional.
 */
describe('a paper, not slides', () => {
  it('tells every agent the source is a paper only when it is one', () => {
    const prose = turnDirective({ agentRole: 'peer', move: 'answer_then_teach', sourceGenre: 'prose' });
    expect(prose).toContain('Refer to it as "the paper" or by page (p. N), never as "the slide"');
    expect(turnDirective({ agentRole: 'challenger', move: 'quiz', sourceGenre: 'prose' })).toContain('The source is a paper');
    expect(turnDirective({ agentRole: 'peer', move: 'answer_then_teach' })).not.toContain('The source is a paper');
    expect(turnDirective({ agentRole: 'peer', move: 'answer_then_teach', sourceGenre: 'slides' })).not.toContain('The source is a paper');
  });

  it('holds Explain to 150 words and makes its analogy optional', () => {
    expect(turnDirective({ agentRole: 'peer', move: 'block_explain' })).toContain('**150 at most**');
    const block = flat(blockActionBlock({ kind: 'explain', quote: 'LLMKT fine-tunes an LLM.', page: 5 }));
    expect(block).toContain('An example or analogy only when the line is abstract enough to need one');
    expect(block).toContain('**About 120 words, 150 at most.**');
    expect(block).not.toContain('one concrete example or analogy;');
  });
});
