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
import { PROMPT_VERSION, quizBlock, roleBlock, sharedBlock, teachObjectiveBlock, turnDirective } from './prompts.js';
import type { AgentProfile } from '../shared/types.js';
import type { ConceptPack, MaterialRow } from './records.js';

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
  it('replaces the flat 80-word cap with a range that can teach a prerequisite', () => {
    const s = shared();
    expect(s).not.toContain('about 80 words');
    expect(s).toContain('aims at about 200 words, with 250 as the ceiling');
    expect(s).toContain('do not compress an explanation into a hint');
  });

  it('keeps the Tester short, since the longer length is the Teacher\'s', () => {
    expect(tester()).toContain("House rule 3's longer lengths are the teacher's.");
  });

  it('asks for typesettable maths', () => {
    expect(shared()).toContain('$…$ inline');
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

  it('keeps the Tester at exactly one question, with feedback owed after the answer', () => {
    const t = tester();
    expect(t).toContain('One question per turn');
    expect(t).toContain('**Never supply the answer you are fishing for.**');
    expect(t).toContain('feedback on what they actually said');
    expect(t).toContain('That turn carries no new question.');
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
    expect(PROMPT_VERSION).toBe('prompts.v0.4');
  });
});

/**
 * Issue #38 §4 and §5: what the Tester is given to ask from, and what the Teacher is given when
 * the learner clicks a prerequisite the deck never teaches.
 */
describe('quizBlock', () => {
  it('offers the objective’s own stems rather than dictating one', () => {
    const block = quizBlock({
      label: 'what /btw can see',
      seeds: ['What does /btw promise about the history?', 'Where does its answer come from?'],
      demonstration: ['names both halves'],
    })!;
    expect(block).toContain('what /btw can see');
    expect(block).toContain('What does /btw promise about the history?');
    expect(block).toContain('or one of your own');
    expect(block).toContain('names both halves');
  });

  /** Rowland 2014's constraint: the feedback turn carries no new question. */
  it('on the feedback turn says what a correct answer contains and asks nothing', () => {
    const block = quizBlock({
      label: 'what /btw can see',
      seeds: ['A question nobody should ask now.'],
      demonstration: ['names the missing tools'],
      feedback: true,
    })!;
    expect(block).toContain('names the missing tools');
    expect(block).toContain('No new question this turn.');
    expect(block).not.toContain('A question nobody should ask now.');
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
