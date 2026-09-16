/**
 * **The committed fixture tree for the Critique 1 deck** (`learning-objectives.md` §3: "the
 * fixture deck gets a committed fixture tree; other decks get `pending` with a 'needs a live
 * backend' note").
 *
 * Two reasons, and neither is decoration. A scripted sitting is the A1 video's fallback and has
 * no network and no key, so a panel that is empty on the one deck the demo opens makes the
 * feature unshowable. And a fixture is the only place a *known-correct* tree exists to test the
 * click path against — refs that point at real pages of a real deck, so a bug in "scroll to the
 * first ref" shows up here rather than on camera.
 *
 * **Written from the deck, not invented.** Every node below is traceable to a page of
 * `Academia/Sources/btw interaction/…Critique1_slides (1).pdf`, whose text is committed verbatim
 * in `room/concepts/btw-side-channel-v1.ts` as `CRITIQUE1_PAGE_TEXT`; the page in each `refs` is
 * the page that teaches it. Six objectives and **two prerequisites the deck assumes and never
 * teaches** — a session's context, and what steering a coding agent means. The deck leans on both
 * (page 2's "without affecting main session context", page 6's "steering pollutes context") and
 * defines neither, which is exactly #36's "what is an MDP" case and the reason `assumedByDeck`
 * exists at all.
 *
 * The ids are **minted here the way the live ingest mints them** — `sha1(content_sha + title)`,
 * against this file's own bytes — so the fixture exercises the real id path rather than a set of
 * hand-written strings that could not collide with anything.
 */
import type { LearningObjective } from '../../shared/objectives.js';
import { objectiveIdFor } from './repair.js';

interface FixtureNode {
  key: string;
  title: string;
  kind: 'objective' | 'prerequisite';
  statement: string;
  criteria: string[];
  quizSeeds: string[];
  pages: number[];
  parent?: string;
  requires?: string[];
}

const NODES: FixtureNode[] = [
  {
    key: 'session-context',
    title: 'What a session’s context is',
    kind: 'prerequisite',
    statement:
      'The running conversation and tool output a coding agent can see in one session — bounded, shared by everything in the session, and spent by whatever is added to it.',
    criteria: [
      'says it is what the agent can see, not what it can do',
      'says that everything added to it competes with the work in progress',
    ],
    quizSeeds: ['Why does an extra question in the main thread cost the coding task anything?'],
    pages: [],
  },
  {
    key: 'btw-promise',
    title: 'State what /btw promises to do',
    kind: 'objective',
    statement:
      'Say, from the documentation quoted on page 2, what /btw is for: a question about the current work that is not added to the conversation history.',
    criteria: [
      'names both halves — ask about the current work, and leave the history untouched',
      'says the answer is built from the main session’s context and nothing else',
    ],
    quizSeeds: [
      'What does /btw promise about the conversation history?',
      'Where does /btw’s answer come from, if not from tools?',
    ],
    pages: [2],
    requires: ['session-context'],
  },
  {
    key: 'whisper-analogy',
    title: 'Explain /btw as a silent whisper',
    kind: 'objective',
    statement:
      'Dennis et al. (2010) on instant messaging at a meeting: interactivity, polychronicity and ephemerality, mapped onto the human–AI row of page 3.',
    criteria: [
      'names at least one of the three properties and what it buys',
      'maps the human–human row onto the human–AI row rather than restating both',
    ],
    quizSeeds: [
      'Which of Dennis’s three properties is doing the work in the page 3 example?',
      'Whispering to whom, in the bottom row of page 3?',
    ],
    pages: [3, 4],
  },
  {
    key: 'btw-limits',
    title: 'Name what /btw cannot do',
    kind: 'objective',
    statement:
      'No tools of its own, no memory between calls, and no effect on the main agent — its context is a strict subset of the main session.',
    criteria: [
      'names the missing tools and the missing memory separately',
      'says "strict subset" or its equivalent: it can see the session and cannot add to it',
    ],
    quizSeeds: [
      'You ask /btw about a file the main session never opened. What happens, and why?',
      'What does "a strictly tool-less version of the agent" rule out?',
    ],
    pages: [5],
    requires: ['btw-promise'],
  },
  {
    key: 'limit-tests',
    title: 'Read the three limit tests',
    kind: 'objective',
    statement:
      'Page 5 runs three tests — a file never opened, a mid-task test state, and a todo it was asked to write — and says which result is the bug.',
    criteria: [
      'names at least two of the three tests and what each returned',
      'says the third is a bug: it claimed to write the todo and did not',
      'says memory being protected is the right outcome even so',
    ],
    quizSeeds: [
      'Which of the three limit tests is the bug, and what makes it one rather than a limitation?',
      'The mid-task test answered accurately. What does that tell you about what /btw can see?',
    ],
    pages: [5],
    parent: 'btw-limits',
  },
  {
    key: 'steering',
    title: 'What steering a coding agent means',
    kind: 'prerequisite',
    statement:
      'Interrupting an agent mid-task with a correction or a new direction, which the agent then folds into what it is doing.',
    criteria: [
      'distinguishes steering from starting a new prompt',
      'says the steering turn itself lands in the session',
    ],
    quizSeeds: ['What is the difference between steering an agent and prompting it again?'],
    pages: [],
  },
  {
    key: 'context-penalty',
    title: 'Explain what the side channel costs',
    kind: 'objective',
    statement:
      'Normal steering clutters the session; asking the same thing in /btw keeps it out, which is what page 6 means by removing the context penalty.',
    criteria: [
      'says what normal steering leaves behind in the session',
      'says what the learner gets instead, and that the agent keeps working through it',
    ],
    quizSeeds: [
      'What does an ordinary "why can’t we…" cost, and where does the cost land?',
      'The agent keeps coding through a /btw exchange. Why does that matter?',
    ],
    pages: [6],
    requires: ['session-context', 'steering'],
  },
  {
    key: 'forwarding-gap',
    title: 'State the forwarding gap and the proposed fix',
    kind: 'objective',
    statement:
      'Nothing decided inside /btw reaches the main agent by itself; the proposal is that the agent offers to relay the decision points and the user approves the relay.',
    criteria: [
      'says the decision, not the answer, is what cannot be forwarded',
      'names the cost: the user re-parses the side conversation into a steering prompt',
      'describes the fix as an offered relay the user approves, not as tools or memory',
    ],
    quizSeeds: [
      'Why is the fix a relay the user approves rather than giving /btw write access?',
      'If the relay existed, what would the user still have to do?',
    ],
    pages: [6, 7],
    requires: ['steering'],
  },
];

/** The sha the fixture's ids are minted against. Stable, because the fixture is committed. */
export const CRITIQUE1_TREE_SHA = 'critique1-objectives-v1';

/**
 * The fixture, bound to whichever `fileId` the learner opened the deck under.
 *
 * The **ids do not depend on the file** — only on the fixture sha and the title — so a learner
 * who has two copies of the deck in their vault gets two files' worth of state under one set of
 * node ids, which is the same thing §2 promises for a live tree whose bytes are unchanged.
 */
export function critique1Tree(fileId: string): LearningObjective[] {
  const idFor = (key: string): string => {
    const node = NODES.find((n) => n.key === key);
    return node ? objectiveIdFor(CRITIQUE1_TREE_SHA, node.title) : '';
  };
  return NODES.map((node, i) => ({
    id: idFor(node.key),
    fileId,
    title: node.title,
    kind: node.kind,
    statement: node.statement,
    criteria: node.criteria,
    quizSeeds: node.quizSeeds,
    refs: node.pages.map((page) => ({ page })),
    parentId: node.parent ? idFor(node.parent) : null,
    requires: (node.requires ?? []).map(idFor).filter((id) => id.length > 0),
    assumedByDeck: node.kind === 'prerequisite' && node.pages.length === 0,
    // The declaration order above is already deck order with the two prerequisites in front of
    // what needs them, which is what `repairTree`'s ordering pass would compute anyway.
    order: i + 1,
  }));
}
