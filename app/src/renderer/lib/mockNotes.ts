/**
 * ────────────────────────────────────────────────────────────────────────────
 *  DEV-ONLY SCAFFOLDING (#48). The fixture lecture-notes document the mock
 *  bridge serves, so the editor, the chats and the progress bar can all be
 *  built and looked at under `vite dev`, with no Electron and no ingest.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * **It is not invented material.** Every block here is written from
 * `Academia/Sources/CS3249+Lecture+4.pdf` — the deck `docs/research/collab-doc.md` §7 names as
 * the demo deck — and carries the page it came from, exactly as a real ingest must (§2:
 * "provenance is mandatory on every block"). A fixture of plausible-sounding invented lecture
 * notes would be a screenshot of a lie, which is the same argument `mockBridge.ts` already makes
 * about the empty vault, and the reason the notes here are shorter than a real refine pass would
 * write rather than longer.
 *
 * **The real functions do the work.** `draftToNodes` (T2) turns the drafts below into
 * ProseMirror nodes with an `author` mark on every span, exactly as the ingest will; the doc is
 * validated by `notesSchema` on the way through, so a fixture that does not satisfy the schema
 * fails here rather than in the editor. Nothing in this file writes ProseMirror JSON by hand.
 *
 * **Why the ids are read back out.** `draftToNodes` mints a fresh `blockId` per block, so the
 * fixture cannot name one in advance. The doc is therefore built **once**, at module load, and
 * the ids are read off it — which is also how `ProgressObjectiveView.blockIds` is filled, by
 * page intersection through T2's own `blocksForPages`, the way the main process will do it.
 */

import { blocksForPages, docFromJson } from '../../shared/doc/schema.js';
import { draftsToDocJson, validateDrafts } from '../../shared/doc/validate.js';
import type { DocBlockDraft, ProgressObjectiveView } from '../../shared/doc/types.js';

export const MOCK_FILE_ID = 'mock-file-1';
export const MOCK_DOC_ID = 'doc_mock_cs3249_l4';
export const MOCK_CONTENT_SHA = 'sha256:mock-cs3249-lecture-4';
export const MOCK_TITLE = 'Prototyping Conversational User Interfaces';
export const MOCK_FILE_NAME = 'CS3249+Lecture+4.pdf';
export const MOCK_PAGE_COUNT = 66;

/** One timestamp for the fixture's own bookkeeping — the objectives' `lastMovedAt`. */
const INGESTED_AT = 1_758_240_000_000;

const p = (text: string, pages: number[], reason: string | null = null): DocBlockDraft => ({
  kind: 'paragraph',
  text,
  prov: { pages, reason },
});
const h = (level: 1 | 2 | 3, text: string, pages: number[], reason: string | null = null): DocBlockDraft => ({
  kind: 'heading',
  level,
  text,
  prov: { pages, reason },
});
const ul = (items: string[], pages: number[], reason: string | null = null): DocBlockDraft => ({
  kind: 'bullets',
  items,
  prov: { pages, reason },
});
const ol = (items: string[], pages: number[], reason: string | null = null): DocBlockDraft => ({
  kind: 'numbers',
  items,
  prov: { pages, reason },
});

/**
 * **Window 1** — the first three sections, which is what the doc opens on (§2: "the doc opens as
 * soon as the first window lands and fills in behind a visible marker").
 */
const WINDOW_1: DocBlockDraft[] = [
  p(
    'This lecture is about the cheapest thing you can build that would tell you your design is ' +
      'wrong. It runs from understanding users, through paper and Wizard of Oz, to prototyping ' +
      'straight from a prompt — and ends on what that speed does not fix.',
    [1, 3],
    'bridges the title slide and the roadmap',
  ),

  h(2, 'Before you prototype', [11]),
  p(
    'Prototyping is **step 2** of the Human-Centred Design loop, and it is the step that only ' +
      'pays off if step 1 was done. You understand context and users, you design and prototype, ' +
      'you build, you evaluate — and the evaluation sends you back round.',
    [12],
  ),
  ul(
    [
      'Understand context and users — observation, contextual inquiry, interviews',
      'Design and prototyping — low fidelity, then Wizard of Oz, then high fidelity',
      'System development',
      'System evaluation — which feeds the next turn of the loop',
    ],
    [12],
  ),
  {
    kind: 'figure',
    page: 12,
    rect: null,
    caption: 'The Human-Centred Design loop, with today sitting in step 2.',
    prov: { pages: [12], reason: null },
  },

  h(3, 'Contextual inquiry', [15]),
  p(
    'Observation plus interview, conducted where the user actually works. It is the only method ' +
      'that reliably catches the things a user would never think to mention: the noise, the ' +
      'interruptions, the bystanders — all of which are decisive for a voice interface.',
    [15],
  ),
  p(
    'The stance is *apprentice, not examiner*: be a keen observer, ask questions, treat the user ' +
      'as the expert, and try to see their world as they see it.',
    [15],
  ),

  h(3, 'Which method, when', [17]),
  p(
    'Each method answers a different question, and the deck is blunt about it: interviews tell ' +
      'you what people **say**, contextual inquiry what they **do**, surveys and diary studies ' +
      'how needs **change**, and participatory design what people **would say to the agent**.',
    [17],
  ),
  p(
    'The rule of thumb is to combine two — one broad and cheap to map the territory, one deep ' +
      'where the risk actually sits.',
    [17],
  ),
  p(
    'Studies also split by what they are *for*. A **formative** study shapes the design: early, ' +
      'repeated, diagnostic, qualitative, small $n$, and the audience is your own team. A ' +
      '**summative** study judges it: late, controlled, quantitative, larger $n$, and the ' +
      'audience is everybody else.',
    [18],
  ),

  h(3, 'From findings to design goals', [20]),
  p(
    'A finding is not yet a design goal. The deck moves across in three columns — observation, ' +
      'then the need behind it, then a goal you could actually falsify.',
    [20],
  ),
  ol(
    [
      '"I skip walks when the neighbourhood feels unsafe" → advice must fit the environment → the coach offers indoor alternatives, tested with a Wizard of Oz script.',
      'Participants ignore messages full of app-jargon → language must match everyday texting → a plain conversational tone, tested with A/B persona prompts.',
      '"I\'d walk more if someone came along" → exercise is social for this group → conversations invite a companion, tested in pilot sessions.',
    ],
    [20],
  ),
  p(
    'Every design goal should name **the cheapest prototype that could falsify it**. That is the ' +
      'sentence the rest of the lecture is an answer to.',
    [20],
  ),

  h(2, 'Why prototype at all', [22]),
  p(
    'A prototype exists to be wrong cheaply. Fidelity is therefore an economic decision, not a ' +
      'craft one: you buy exactly as much realism as the question you are asking needs, and no ' +
      'more, because everything you build is something you will be reluctant to throw away.',
    [22, 23],
    'bridges the fidelity slides',
  ),
  ul(
    [
      'Low fidelity — paper, sketches, scripts. Minutes to change, and nobody mistakes it for a product.',
      'Medium — Wizard of Oz: real interaction, simulated machine.',
      'High fidelity — working code, and the first point at which look, feel and timing can be judged.',
    ],
    [23],
  ),

  h(2, 'The classic toolbox', [26]),
  h(3, 'Paper prototyping', [27]),
  p(
    'Hand-drawn screens, a human "computer" moving the pieces, and a facilitator. The line the ' +
      'deck puts on the slide is the one that makes the session work at all: *it is the design ' +
      'being tested, not you*.',
    [27, 33],
  ),
  p(
    'What paper reveals: the conceptual model, missing functionality, navigation and task flow, ' +
      'terminology and screen contents. What it hides: look, feel, response time, whether subtle ' +
      'feedback is noticed — and exploration, because users on paper are far too careful.',
    [34],
  ),
  p(
    'Show one design and users are polite; show three and they compare, and criticise ' +
      '(Tohidi, Buxton, Baecker and Sellen, CHI 2006).',
    [35],
  ),

  h(2, 'Prototyping a conversation', [37]),
  p(
    'When the interface has no screens, the artefact you sketch changes. GUI work runs ' +
      'wireframes → mockups → interactive demos. CUI work runs **scripts → dialogue maps → ' +
      'Wizard-of-Oz tests**, because the thing being designed is the dialogue, not the layout.',
    [38],
  ),
  p(
    'The dialogue *is* the interface, and it has parts you can name and get wrong one at a ' +
      'time: persona and tone, confirmations (implicit echo, explicit when the stakes rise), ' +
      'conversational markers, turn-taking, timing — too fast is rude, too slow is broken — and ' +
      'repair, which is the make-or-break moment.',
    [39],
  ),
  ul(
    [
      '**Slot-filling** — collect the parameters one at a time, and ask only for what is missing.',
      '**Confirmation** — implicit echo while moving on; explicit stop-and-ask when the stakes decide it.',
      '**Disambiguation** — turn a vague input into a choice instead of a guess.',
      '**Global escapes** — help, start over, talk to a human: reachable from every node, not only where you drew them.',
    ],
    [42],
  ),
  p(
    'The method for getting there is four steps: write the sample dialogue movie-script style, ' +
      'table-read it aloud with a partner, generalise the differing answers into branches and ' +
      'the mishearings into repair loops, and then test it live as Wizard of Oz — before any code.',
    [41],
  ),
];

/** **Window 2** — Wizard of Oz. Arrives on a timer, after the doc is already on screen. */
const WINDOW_2: DocBlockDraft[] = [
  h(2, 'Wizard of Oz', [44]),
  p(
    'A human operator plays the machine while the user believes they are talking to a system. ' +
      'It buys you the one thing paper cannot: a real interaction, at real timing, against ' +
      'responses no model could reliably produce yet.',
    [44],
  ),
  ul(
    [
      'The wizard needs a script and a rule sheet, or the study measures the wizard rather than the design.',
      'Latency has to be simulated deliberately — an instant human answer is not what the system would do.',
      'Debrief afterwards: the deception is the method, and it is disclosed.',
    ],
    [45, 46],
  ),
];

/** **Window 3** — the last section, and the one the lecture ends on. */
const WINDOW_3: DocBlockDraft[] = [
  h(2, 'New power, new pitfalls', [53]),
  p(
    'An LLM turns a prompt into a working CUI prototype in minutes, which collapses the distance ' +
      'between a sketch and something a user can talk to. The pitfall is that it collapses the ' +
      'distance between *a prototype* and *a product* just as fast.',
    [53, 54],
  ),
  ul(
    [
      'A fluent prototype is evaluated as a product — participants stop reporting the seams.',
      'Speed removes the pause in which you would have decided what the prototype was for.',
      'The architecture you reached for in an afternoon is the one you will be asked to ship.',
    ],
    [55, 56],
  ),
];

/**
 * The fixture, built once.
 *
 * Everything downstream — the mock's `notesGet`, the two window events, the progress objectives
 * and the scripted conversation's anchor blocks — reads its block ids off this one document, so
 * there is exactly one fixture and nothing can drift from it.
 */
function build() {
  /**
   * Through the **real ingest gate**, not around it: `validateDrafts` is what rejects a block
   * with no provenance (§2), and a fixture that could not survive it would be a fixture the
   * editor is built against and the ingest could never produce. `issues` is asserted empty in
   * `mockNotes.test.ts`.
   */
  const checked = validateDrafts(WINDOW_1, MOCK_PAGE_COUNT);
  FIXTURE_ISSUES = checked.issues.length;
  const json = draftsToDocJson(MOCK_TITLE, checked.blocks);
  const doc = docFromJson(json);
  const ids: string[] = [];
  const pagesOf = new Map<string, number[]>();
  doc.forEach((node) => {
    const id = (node.attrs as { blockId?: string }).blockId;
    if (!id) return;
    ids.push(id);
    pagesOf.set(id, [...((node.attrs as { pages?: number[] }).pages ?? [])]);
  });
  return { json, ids, pagesOf };
}

/** How many fixture blocks the real validator rejected. Zero, and the test says so. */
let FIXTURE_ISSUES = 0;
export function fixtureIssueCount(): number {
  return FIXTURE_ISSUES;
}

const FIXTURE = build();

/** The fixture document, as ProseMirror JSON for `notesSchema`. */
export function mockNotesJson(): unknown {
  return FIXTURE.json;
}

/** The two windows that arrive after the doc is open, in order. */
export const MOCK_WINDOWS: readonly DocBlockDraft[][] = [WINDOW_2, WINDOW_3];

/** The last block of window 1 — what window 2 appends after (`notes.window.afterBlockId`). */
export function mockLastBlockId(): string {
  return FIXTURE.ids.at(-1) ?? '';
}

/**
 * A named handle on one fixture block, for the scripted conversation.
 *
 * The script needs to name the block Ellie writes her missing answer next to, and the one Max
 * hangs his Q block off. Naming them by the page they are on rather than by index keeps the
 * script readable and survives an edit to the prose above them.
 */
export function mockBlockOnPage(page: number, offset = 0): string {
  const hits = FIXTURE.ids.filter((id) => (FIXTURE.pagesOf.get(id) ?? []).includes(page));
  return hits[Math.min(offset, Math.max(0, hits.length - 1))] ?? FIXTURE.ids[0] ?? '';
}

// ── the objectives the progress bar draws (brief §6) ────────────────────────────────────────

/**
 * Nine objectives and one prerequisite the deck assumes, written from the deck's own **Learning
 * Objectives** slide (p. 2) and its roadmap (p. 3).
 *
 * `fill`, `level` and `evidence` start where a learner mid-way through a sitting would be: two
 * complete, one half, the rest untouched. That is the state worth being able to look at — an
 * empty bar and a full bar are both easy, and the interesting drawing problem is the one in
 * between.
 */
interface ObjectiveSeed {
  objectiveId: string;
  title: string;
  statement: string;
  criteria: string[];
  pages: number[];
  assumedByDeck?: boolean;
  fill?: 0 | 0.5 | 1;
  evidence?: string;
}

const SEEDS: ObjectiveSeed[] = [
  {
    objectiveId: 'obj-hcd-loop',
    title: 'Place prototyping inside the design loop',
    statement:
      'Say where prototyping sits in the Human-Centred Design loop, and what step 1 has to have produced before it is worth doing.',
    criteria: ['names the four steps in order', 'says what prototyping depends on'],
    pages: [11, 12],
    fill: 1,
    evidence:
      'Prototyping is step two, and it only pays off if step one actually produced design goals you could test.',
  },
  {
    objectiveId: 'obj-method-choice',
    title: 'Choose a study method for what it reveals',
    statement:
      'Given a question about users, pick between interviews, contextual inquiry, surveys and participatory design, and say what each one reveals.',
    criteria: ['says what people say vs what people do', 'names the cost of the method it picks'],
    pages: [15, 16, 17],
    fill: 1,
    evidence:
      'Interviews get you what people say they do; you need contextual inquiry to see the interruptions they never mention.',
  },
  {
    objectiveId: 'obj-formative',
    title: 'Tell a formative study from a summative one',
    statement:
      'Say which kind of study you are running, and who its audience is — your own team, or the people judging the result.',
    criteria: ['names the purpose of each', 'names the audience of each'],
    pages: [18],
    fill: 0.5,
    evidence: 'Formative ones are the early ones where you are still finding problems.',
  },
  {
    objectiveId: 'obj-design-goals',
    title: 'Turn a finding into a testable design goal',
    statement:
      'Move an observation to the need behind it and then to a goal, and name the cheapest prototype that could falsify that goal.',
    criteria: ['goes observation → need → goal', 'names a prototype that could falsify it'],
    pages: [20],
  },
  {
    objectiveId: 'obj-fidelity',
    title: 'Explain fidelity as an economic decision',
    statement:
      'Say why you would build the least realistic thing that answers your question, and what you pay for building more.',
    criteria: ['says what fidelity buys', 'says what it costs'],
    pages: [22, 23],
  },
  {
    objectiveId: 'obj-paper',
    title: 'Say what a paper prototype cannot reveal',
    statement:
      'Name what a paper session tests well — model, flow, terminology — and the four things it hides.',
    criteria: ['names two things it reveals', 'names two things it hides'],
    pages: [27, 33, 34],
  },
  {
    objectiveId: 'obj-cui-pipeline',
    title: 'Say why CUIs break the GUI playbook',
    statement:
      'Contrast wireframes → mockups → demos with scripts → dialogue maps → Wizard of Oz, and say what is being designed in each.',
    criteria: ['names both pipelines', 'says what the CUI artefact actually is'],
    pages: [37, 38],
  },
  {
    objectiveId: 'obj-dialogue',
    title: 'Name the parts of a designed dialogue',
    statement:
      'Persona and tone, confirmation, markers, turn-taking, timing and repair — and what going wrong looks like for each.',
    criteria: ['names at least four parts', 'says why repair is the make-or-break one'],
    pages: [39, 41, 42],
  },
  {
    objectiveId: 'obj-woz',
    title: 'Deploy a Wizard of Oz study',
    statement:
      'Say what the wizard needs before the session, and what the study measures if they do not have it.',
    criteria: ['names the script and the rule sheet', 'says why latency is simulated'],
    pages: [44, 45, 46],
  },
  {
    objectiveId: 'obj-usability-basics',
    title: 'What a usability test is',
    statement:
      'A facilitator, a task, a participant thinking aloud, and the design rather than the person under test.',
    criteria: ['says who is being tested'],
    pages: [],
    assumedByDeck: true,
  },
];

/**
 * The objectives, with `blockIds` derived from the document by page intersection — T2's own
 * `blocksForPages`, which is what the main process will use, rather than a second rule here.
 *
 * `doc` is optional: before the learner has saved anything the fixture's own document is the
 * authority, and after a save the mock re-derives from the renderer's copy, so a lesson card's
 * **Start** scrolls to a block that is actually in the editor's document.
 */
export function mockObjectives(docJson: unknown = FIXTURE.json): ProgressObjectiveView[] {
  let doc;
  try {
    doc = docFromJson(docJson);
  } catch {
    doc = docFromJson(FIXTURE.json);
  }
  return SEEDS.map((seed) => {
    const fill = seed.fill ?? 0;
    return {
      objectiveId: seed.objectiveId,
      title: seed.title,
      statement: seed.statement,
      criteria: seed.criteria,
      pages: seed.pages,
      blockIds: seed.pages.length > 0 ? blocksForPages(doc, seed.pages) : [],
      fill,
      level: (fill === 1 ? 3 : fill === 0.5 ? 2 : 0) as 0 | 1 | 2 | 3,
      assumedByDeck: seed.assumedByDeck === true,
      evidence: seed.evidence ?? null,
      lastMovedAt: fill > 0 ? new Date(INGESTED_AT).toISOString() : null,
    };
  });
}
