/**
 * **The scripted backend's notes doc** (#48).
 *
 * Every test in this repo runs the `ScriptedClient` and no test makes a network call, and
 * `vite dev` runs against a mock bridge — so the ingest needs an answer for "there is no live
 * backend" that is a *document*, not an error. This is it: a short, real-looking set of notes
 * with real provenance, for the deck the video is filmed on, and a two-block stand-in for
 * anything else.
 *
 * It is small on purpose. It exists so the editor, the provenance chips, the figures and the
 * agents' edits can all be exercised without a model; it is not a sample of what the ingest
 * produces, and nothing should judge the prompt by it.
 */
import type { DocBlockDraft } from '../../shared/doc/types.js';

/**
 * The Critique 1 deck (`Academia/Sources/btw interaction/…Critique1_slides (1).pdf`), seven
 * pages — the fixture every other scripted path in the app is keyed to.
 */
export function critique1Notes(): DocBlockDraft[] {
  return [
    {
      kind: 'heading',
      level: 2,
      text: 'What `/btw` is',
      prov: { pages: [1, 2], reason: null },
    },
    {
      kind: 'paragraph',
      text:
        '`/btw` is a side channel into an agent that is already working. The learner types a question ' +
        'with `/btw` in front of it, and the agent answers **from the context of the main session ' +
        'only** — no tools, no memory, and nothing the question added is written back into the ' +
        'conversation history.',
      prov: { pages: [2], reason: null },
    },
    {
      kind: 'paragraph',
      text:
        'The point of keeping it out of the history is that the main task is not disturbed. The agent ' +
        'keeps doing what it was told to do, and the side question does not steer it.',
      prov: { pages: [2], reason: 'states the goal the slide only lists' },
    },
    {
      kind: 'heading',
      level: 2,
      text: 'Whispering, as people already do it',
      prov: { pages: [3], reason: null },
    },
    {
      kind: 'paragraph',
      text:
        'The analogy the deck builds is a meeting. Someone notices a problem with a slide, leans over ' +
        'to a neighbour rather than interrupting the speaker, and the correction reaches the room ' +
        'anyway. `/btw` is the same move with an agent in the neighbour\'s seat.',
      prov: { pages: [3], reason: null },
    },
    {
      kind: 'figure',
      page: 3,
      rect: null,
      caption: 'The human-to-human and human-to-AI whisper, drawn as the same four steps.',
      prov: { pages: [3], reason: null },
    },
    {
      kind: 'heading',
      level: 2,
      text: 'Why a side channel helps',
      prov: { pages: [6, 7], reason: null },
    },
    {
      kind: 'bullets',
      items: [
        'It removes the context penalty: asking does not cost the main session anything.',
        'It lowers the cost of participating, so more of the questions people have get asked.',
        'What starts as a whisper can be brought into the room when it turns out to matter.',
      ],
      prov: { pages: [6, 7], reason: null },
    },
  ];
}

/** Anything the scripted backend has no fixture for: honest, short, and provenance-clean. */
export function placeholderNotes(title: string): DocBlockDraft[] {
  return [
    {
      kind: 'paragraph',
      text: `These are placeholder notes for **${title}**.`,
      prov: { pages: [], reason: 'written without a model: no live backend is configured' },
    },
    {
      kind: 'paragraph',
      text:
        'Writing the real notes from the slides needs a model. Set one up in Settings (Claude Code, ' +
        'or an API key), then press **Regenerate** above. They are also written by themselves the ' +
        'next time you open this document with a model set up.',
      prov: { pages: [], reason: 'written without a model: no live backend is configured' },
    },
  ];
}

// ── the learning overview's fixtures (`notebooks.md` §3, #58) ─────────────────────────────────

/**
 * **What the overview call would return for the Critique 1 deck**, as raw model JSON, so the
 * scripted backend runs it through the same `validateOverview` and C6 builder as a live answer.
 * `base` is the source's `pageBase` in its notebook: the deck's page `n` is notebook page
 * `base + n`. Written from `CRITIQUE1_PAGE_TEXT` (`room/concepts/btw-side-channel-v1.ts`); every
 * page cited is the page that says it. The deck leaves no blank, so the overview carries none.
 */
export function critique1OverviewRaw(base = 0): Record<string, unknown> {
  const p = (...pages: number[]): number[] => pages.map((n) => base + n);
  return {
    title: '/btw: whispering with your agent',
    lede: {
      text:
        '`/btw` is a side channel into a coding agent that is already working: a question about the current work that never enters the conversation history. ' +
        'The deck reads it as a silent whisper, tests what it can and cannot do, and proposes letting it speak back to the main agent.',
      pages: p(1, 2, 7),
    },
    objectives: [
      {
        title: 'State what /btw promises to do',
        statement: 'Say what /btw is for and what it leaves untouched.',
        criteria: ['names both halves: ask about the current work, leave the history untouched', 'says the answer comes from the main session context only'],
        quizSeeds: ['What does /btw promise about the conversation history?'],
        pages: p(2),
      },
      {
        title: 'Explain /btw as a silent whisper',
        statement: 'Map the meeting whisper onto the human–AI side channel.',
        criteria: ['names interactivity, polychronicity or ephemerality', 'maps the human row onto the AI row'],
        quizSeeds: ['Which property of a whisper does /btw keep, and what does it buy?'],
        pages: p(3, 4),
      },
      {
        title: 'Describe what the limit tests showed about /btw',
        statement: 'Say what /btw could and could not do in the three tests.',
        criteria: ['context is a subset of the main session', 'no tools and no memory'],
        quizSeeds: ['Why did /btw decline to answer about an unopened file?'],
        pages: p(5),
      },
      {
        title: 'Explain why a side channel avoids the context penalty',
        statement: 'Contrast steering in the main thread with asking on /btw.',
        criteria: ['steering in the main thread clutters context', 'the gap: decisions on /btw cannot reach the agent'],
        quizSeeds: ['What does a side question cost the main session, and what does /btw change?'],
        pages: p(6, 7),
      },
    ],
    sections: [
      {
        heading: 'What /btw is',
        pages: p(1, 2),
        takeaway: 'A question about the current work that leaves the conversation history alone.',
        ideas: [
          { text: 'The documentation\'s promise: ask about your current work without adding to the history.', pages: p(2) },
          { text: 'The answer is built from the main session\'s context only, with no tools or memory.', pages: p(2) },
        ],
        recommendation: null,
      },
      {
        heading: 'Whispering, as people already do it',
        pages: p(3),
        takeaway: 'Leaning over to a neighbour instead of interrupting the speaker.',
        ideas: [
          { text: 'The human–human and human–AI whisper are drawn as the same four steps.', pages: p(3) },
          { text: 'The aside reaches the room without stopping the main conversation.', pages: p(3) },
        ],
        recommendation: { kind: 'diagram', title: 'The whisper, human and AI', description: 'The four steps of each whisper, side by side.' },
      },
      {
        heading: 'Silent whispering in meetings',
        pages: p(4),
        takeaway: 'Dennis et al. name three properties of a whisper and four benefits.',
        ideas: [
          { text: 'Interactivity, polychronicity and ephemerality: the three properties.', pages: p(4) },
          { text: 'Participation, satisfaction, efficiency and politeness: the four benefits.', pages: p(4) },
        ],
        recommendation: { kind: 'flashcards', title: 'Properties and benefits of whispering', description: 'One card per property and per benefit, with its meaning.' },
      },
      {
        heading: 'Limit tests',
        pages: p(5),
        takeaway: '/btw sees what the agent sees, and can do nothing to it.',
        ideas: [
          { text: 'It declined to answer about a file the main task never opened.', pages: p(5) },
          { text: 'It claimed to add a memory item and did not: it has no memory.', pages: p(5) },
        ],
        recommendation: null,
      },
      {
        heading: 'Why a side channel helps',
        pages: p(6),
        takeaway: 'Asking on the side costs the main session nothing.',
        ideas: [
          { text: 'Steering in the main thread clutters the context the agent works from.', pages: p(6) },
          { text: 'The gap: what is decided on /btw cannot be forwarded to the agent.', pages: p(6) },
        ],
        recommendation: null,
      },
    ],
    next: {
      heading: 'What comes next',
      pages: p(7),
      takeaway: 'Letting /btw relay decisions back to the main agent.',
      ideas: [{ text: 'The user moves from director to directed: the agent offers to relay what was decided.', pages: p(7) }],
    },
    greeting: 'I have read the /btw slides too. Want to start with what it promises, or with the tests?',
    starterQuestions: [
      'What does /btw leave out of the conversation history?',
      'Which three properties make a whisper useful in a meeting?',
      'Why did /btw refuse to answer about an unopened file?',
    ],
  };
}

/**
 * **Any notebook the scripted backend has no fixture for**, or a live notebook while no model is
 * set up: honest, short and cited. One section per ticked source, citing its first page, so the
 * C6 shape, the chips, the slots and the tree are all exercised. The objective is one per source,
 * which is below the four the brief asks for, and says so in the log rather than inventing more.
 */
export function placeholderOverviewRaw(input: {
  notebookName: string;
  sources: readonly { name: string; firstPage: number }[];
}): Record<string, unknown> {
  const short = (name: string): string => name.replace(/\.[^.]+$/, '').trim() || name;
  return {
    title: input.notebookName,
    lede: {
      text: 'This is a placeholder overview, written without a model. Set one up in Settings (Claude Code, or an API key), then press **Update overview**.',
      pages: [],
    },
    objectives: input.sources.map((s) => ({
      title: `Explain the main idea of ${short(s.name)}`,
      statement: `Say in your own words what ${short(s.name)} is about.`,
      criteria: ['names the main idea', 'says where in the source it is'],
      quizSeeds: [`What is ${short(s.name)} mostly about?`],
      pages: [s.firstPage],
    })),
    sections: input.sources.map((s, i) => ({
      heading: short(s.name),
      pages: [s.firstPage],
      takeaway: 'The overview of this source is written once a model is set up.',
      ideas: [{ text: `It starts on this page.`, pages: [s.firstPage] }],
      recommendation: i === 0 ? { kind: 'flashcards', title: `Key terms in ${short(s.name)}`.split(' ').slice(0, 8).join(' '), description: 'Front and back cards for the terms this source defines.' } : null,
    })),
    next: null,
    greeting: 'I can read these sources with you once a model is set up in Settings.',
    starterQuestions: input.sources.flatMap((s) => [
      `What is ${short(s.name)} about?`,
      `Which terms does ${short(s.name)} define?`,
      `Where should I start in ${short(s.name)}?`,
    ]),
  };
}
