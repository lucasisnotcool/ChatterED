/**
 * The fixture tree — one worked example, committed, for the deck the scripted backend demos
 * (`learning-objectives.md` §3: "the fixture deck gets a committed fixture tree; other decks get
 * `pending` with a 'needs a live backend' note").
 *
 * It exists for two reasons and neither is decoration:
 *
 *  1. **The panel is buildable before the ingest is.** `objectives:tree` is the main side's, and
 *     this renderer track is not allowed to wait for it. Everything the panel does — nesting,
 *     counting, scrolling, the Ask chip, the keyboard — is exercised against a tree of exactly
 *     the §2 shape, so the swap to the real IPC changes where the tree comes from and nothing
 *     else.
 *  2. **A scripted sitting is a demo, and a demo needs content.** The whole point of the
 *     scripted backend is that it can be shown with no network and no key; a panel that is empty
 *     on the one deck the demo opens would make the feature unshowable.
 *
 * The objectives are the real ones for that deck (Critique 1, "/btw — whispering with your
 * agent", 7 pages) and the refs are its real pages, because a fixture whose refs point nowhere
 * would hide exactly the bug the click path is most likely to have.
 */
import type {
  LearningObjective,
  LearningObjectiveState,
  LearningTree,
  ObjectiveLevel,
} from '../../shared/objectives.js';

/** Is this the deck the fixture is about? Matched on the file name, not on an id we cannot know. */
export function isFixtureDeck(input: { name?: string; relPath?: string }): boolean {
  const hay = `${input.name ?? ''} ${input.relPath ?? ''}`;
  return /critique\s*1/i.test(hay);
}

function node(
  id: string,
  title: string,
  order: number,
  over: Partial<LearningObjective> & { fileId?: string } = {},
): Omit<LearningObjective, 'fileId'> {
  const { fileId: _ignored, ...rest } = over;
  return {
    id,
    title,
    kind: 'objective',
    statement: '',
    criteria: [],
    quizSeeds: [],
    refs: [],
    parentId: null,
    requires: [],
    assumedByDeck: false,
    order,
    ...rest,
  };
}

const CRITIQUE1: Omit<LearningObjective, 'fileId'>[] = [
  node('btw-spec', 'State what /btw promises to do', 1, {
    statement:
      'Say, from the documentation, what /btw is for: a question about the current work that does not enter the conversation history.',
    criteria: [
      'names the two halves — ask about current work, and leave the history untouched',
      'says the answer comes from main-session context, with no tools and no memory',
    ],
    quizSeeds: ['What does /btw promise about the conversation history?'],
    refs: [{ page: 2 }],
    requires: ['pre-context'],
  }),
  node('pre-context', "What a coding agent's context window holds", 1, {
    kind: 'prerequisite',
    assumedByDeck: true,
    statement:
      'Explain what sits in an agent session’s context — the prompts, the tool output and the history — and why adding to it has a cost.',
    criteria: [
      'says context is finite and shared across the whole session',
      'says every turn added to it is carried into every later turn',
    ],
    quizSeeds: ['Why does an extra question in the main thread cost anything at all?'],
  }),
  node('btw-goal', 'Give the two goals the feature serves', 2, {
    statement:
      'State both goals together: help the user understand what the agent is doing, without interrupting it or affecting the main session context.',
    criteria: ['names understanding as the first goal', 'names non-interruption and context isolation as the second'],
    quizSeeds: ['Which of the two goals would be broken if /btw wrote to the main history?'],
    refs: [{ page: 2 }],
    parentId: 'btw-spec',
  }),
  node('side-channel', 'Frame /btw as a side channel, not a second chat', 3, {
    statement:
      'Explain the analogy the deck runs on: a quiet aside to a colleague during a meeting, which the meeting neither hears nor has to stop for.',
    criteria: [
      'names the human-to-human case the analogy comes from',
      'says what carries across to the agent case and what does not',
    ],
    quizSeeds: ['What is the human-collaboration move /btw is modelled on?'],
    refs: [{ page: 3 }],
  }),
  node('silent-properties', 'Name what silent asides buy a meeting', 4, {
    statement:
      'Give the properties Dennis et al. (2010) attribute to instant messaging during a meeting — interactivity, and being able to engage without taking the floor.',
    criteria: ['names at least two properties', 'ties each one to something the main channel cannot do'],
    quizSeeds: ['Which property of a silent aside does /btw actually implement?'],
    refs: [{ page: 4 }],
    parentId: 'side-channel',
  }),
  node('limit-tests', 'Report what the limit tests established', 5, {
    statement:
      'Say what the tests showed about how strictly /btw is bounded: it declines what it cannot see, and its context is a strict subset of the main session.',
    criteria: ['describes one test and its finding', 'draws the conclusion about the boundary being real'],
    quizSeeds: ['What happened when /btw was asked about a file the session never opened?'],
    refs: [{ page: 5 }],
  }),
  node('context-penalty', 'Explain the context penalty /btw removes', 6, {
    statement:
      'Contrast steering the agent in the main thread with asking the same thing under /btw, and say what the first one costs.',
    criteria: [
      'describes the clutter normal steering leaves behind',
      'says why removing that cost changes how often a user asks',
    ],
    quizSeeds: ['Why would a user not ask the question at all, without /btw?'],
    refs: [{ page: 6 }],
    requires: ['pre-context'],
  }),
  node('the-gap', 'State the gap the critique identifies', 7, {
    statement:
      'Say what cannot happen today: a decision reached under /btw has no route back to the main agent, so the user has to re-author it as a steering prompt.',
    criteria: ['names the missing route', 'says what the user is left doing by hand'],
    quizSeeds: ['What does the user have to do with a decision they reached under /btw?'],
    refs: [{ page: 6 }, { page: 7 }],
    requires: ['pre-steering'],
  }),
  node('pre-steering', 'What steering a running agent means', 7, {
    kind: 'prerequisite',
    assumedByDeck: true,
    statement:
      'Explain what it is to steer an agent mid-task — an interjection that changes what it is doing, and lands in the main history.',
    criteria: ['says steering happens while the agent is working', 'says the interjection is itself context'],
    quizSeeds: ['What is the difference between steering an agent and starting a new task?'],
  }),
  node('the-proposal', 'Describe the relay the critique proposes', 8, {
    statement:
      'Describe the proposed feature: the side channel offers to carry a decision back to the main agent as a steering prompt the user approves.',
    criteria: [
      'says the relay is offered, not automatic',
      'names one benefit and one risk of letting the two agents talk',
    ],
    quizSeeds: ['Who approves the relay, and why does that matter?'],
    refs: [{ page: 7 }],
    parentId: 'the-gap',
  }),
];

/** What a fixture tree carries instead of a content hash — the one way to tell it apart. */
export const FIXTURE_SHA = 'fixture';

/**
 * The fixture tree for a file, or null when this deck is not the one it is about.
 *
 * `status: 'ready'` is the truth here: nothing is being ingested, the tree simply exists.
 */
export function fixtureTree(input: { fileId: string; name?: string; relPath?: string }): LearningTree | null {
  if (!isFixtureDeck(input)) return null;
  return {
    fileId: input.fileId,
    contentSha: FIXTURE_SHA,
    generatedAt: '2026-09-16T00:00:00.000Z',
    model: 'fixture',
    version: 1,
    status: 'ready',
    objectives: CRITIQUE1.map((o) => ({ ...o, fileId: input.fileId })),
  };
}

/**
 * Where the fixture's **states** live until the ledger writes real ones.
 *
 * The ledger's evaluator is the main process's and it moves states for the *file's* objectives —
 * which do not exist there yet. So on the fixture path a level move has nowhere to be recorded,
 * and a panel whose glyphs can never move is a panel whose live half is untestable: the just-lit
 * animation, the "n of m online" count, the announcement and **Reset** would all be unreachable
 * on screen before the ingest lands.
 *
 * One JSON blob per file in `localStorage`, therefore, written only on this path and read only
 * by it. It disappears the moment `store.objectivesLive` is true, and nothing else in the app
 * ever looks at it.
 */
const FIXTURE_STATES = 'chattered.objectives.fixtureStates';

function keyFor(fileId: string): string {
  return `${FIXTURE_STATES}.${fileId}`;
}

export function loadFixtureStates(fileId: string): LearningObjectiveState[] {
  try {
    const raw = window.localStorage.getItem(keyFor(fileId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((row): LearningObjectiveState[] => {
      if (typeof row !== 'object' || row === null) return [];
      const r = row as Partial<LearningObjectiveState>;
      if (typeof r.objectiveId !== 'string') return [];
      const level = Number(r.level);
      if (!Number.isInteger(level) || level < 0 || level > 3) return [];
      return [
        {
          objectiveId: r.objectiveId,
          fileId,
          level: level as ObjectiveLevel,
          evidenceMessageIds: Array.isArray(r.evidenceMessageIds) ? r.evidenceMessageIds.filter((m) => typeof m === 'string') : [],
          lastMovedAt: typeof r.lastMovedAt === 'string' ? r.lastMovedAt : null,
          taughtAt: typeof r.taughtAt === 'string' ? r.taughtAt : null,
        },
      ];
    });
  } catch {
    return [];
  }
}

export function clearFixtureStates(fileId: string): void {
  try {
    window.localStorage.removeItem(keyFor(fileId));
  } catch {
    // A denied store is not worth failing a reset over.
  }
}
