/**
 * **The tutorial turns' prompt blocks** (2026-10-03, `docs/research/tutorials.md` §4,
 * `app/docs/TUTORIAL-CONTRACT.md` S5).
 *
 * The learner pressed **Hint**, **Refresher**, **Check** or **Show answer** on one part of a
 * tutorial sheet. The move was decided in code (`tutor.ts` `tutorDecision`); what is assembled
 * here is the one block the turn reads: the part, the learner's answer, the hidden key with its
 * guard, the notes blocks and lecture pages the part is linked to, and the shape of this kind of
 * help. It lives beside `prompts.doc.ts` for the reason that file does: these are the words of
 * turns one brief invented, and they read best against it.
 *
 * Two things are non-negotiable and stated in hard terms:
 *
 * - **The key is never said before a release** (Bastani et al. 2025: a tutor given the answer and
 *   the common mistakes, and told to hint, removed most of the harm unguarded help did). The model
 *   answer itself is only in the block on `reveal`; on every other kind the turn gets the steps,
 *   the likely mistakes and the prerequisites, and a guard against stating any piece of the answer.
 * - **The help is grounded in the notes and the lecture**, cited as `p. N` the way every chat
 *   reply cites, so the chat's page links open the slide.
 *
 * Tone (Lucas, 3 Oct: the sheet's pressure plus Max's may read as hostile): collegial and brief.
 */
import type { QuizVerdict3 } from '../shared/doc/types.js';
import type { HintLevel, PartKey } from '../shared/tutorial.js';
import { VERDICT_OPENERS } from './flow.js';

/**
 * `reply` (2026-10-04): the learner typed in a part's thread, answering Max's question or pushing
 * back on a check. Before it, a typed reply fell to `rule:ellie_answers`, which knew nothing of the
 * part, their answer slot or the key's guard, and answered in full.
 */
export type TutorKind = 'hint' | 'refresher' | 'feedback' | 'reveal' | 'reply';

/** Everything a tutorial turn's prompt is built from (the S5 input, minus the addressing). */
export interface TutorPromptInput {
  kind: TutorKind;
  level: HintLevel;
  label: string;
  prompt: string;
  answer: string;
  key: PartKey;
  verdict?: { verdict: QuizVerdict3; checkedBy: 'simulation' | 'model'; detail: string };
  /** The part was released (Show answer): a reply may then talk about the answer itself. */
  revealed?: boolean;
  notes: readonly { blockId: string; heading: string | null; text: string }[];
  slides: readonly { page: number; label: string; text: string }[];
}

/** The header of the one block that carries the model answer. Only `reveal` has it. */
export const TUTOR_ANSWER_HEADER = 'THE ANSWER, WHICH YOU NOW GIVE';
/** The header of the guard every other kind carries. */
export const TUTOR_KEY_GUARD_HEADER = 'THE HIDDEN KEY: FOR YOU ALONE';

/** The rung names the part's chrome shows (`tutorials.md` §4). */
export const HINT_RUNG_NAMES: Record<1 | 2 | 3, string> = { 1: 'Point', 2: 'Break it down', 3: 'A worked step' };

/** The rung a hint turn is on: the level given, held to 1–3. */
export function hintRung(level: HintLevel): 1 | 2 | 3 {
  return level <= 1 ? 1 : level >= 3 ? 3 : 2;
}

/**
 * **The word ceiling each kind is given in its prompt**, also read by the actor's over-length log
 * (`wordCeilingOf`). A point is short; a worked step needs room for the step.
 */
export function tutorWordCeiling(kind: TutorKind, level: HintLevel = 1): number {
  switch (kind) {
    case 'hint':
      return { 1: 70, 2: 90, 3: 130 }[hintRung(level)];
    case 'refresher':
      return 130;
    case 'feedback':
      return 100;
    case 'reveal':
      return 150;
    case 'reply':
      return 100;
  }
}

/** The largest ceiling of a kind, whatever the rung: what the over-length log measures against. */
export function tutorMaxWordCeiling(kind: TutorKind): number {
  return kind === 'hint' ? tutorWordCeiling('hint', 3) : tutorWordCeiling(kind);
}

const SLIDE_CHARS = 1_500;
const NOTE_CHARS = 600;
const MAX_SLIDES = 4;
const MAX_NOTES = 4;

function clip(text: string, max: number): string {
  const flat = text.trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** The lecture pages, as `p. N`: the chat's own citation form. */
export function pagesCited(slides: TutorPromptInput['slides']): string {
  const pages = [...new Set(slides.map((s) => s.page))].sort((a, b) => a - b);
  return pages.map((p) => `p. ${p}`).join(', ');
}

/** The notes blocks and the lecture pages the part is linked to, and the instruction to use them. */
function groundingBlock(input: TutorPromptInput): string[] {
  const notes = input.notes.filter((n) => n.text.trim().length > 0 || (n.heading ?? '').trim().length > 0).slice(0, MAX_NOTES);
  const slides = input.slides.slice(0, MAX_SLIDES);
  const lines = ['WHERE THIS PART’S MATERIAL IS'];
  if (notes.length === 0 && slides.length === 0) {
    lines.push(
      'Nothing in the notes or the lecture was linked to this part. Use the lecture in the document',
      'above and cite its pages as p. N; say plainly if the lecture does not cover something.',
    );
    return lines;
  }
  if (notes.length > 0) {
    lines.push('In the learner’s lecture notes:');
    for (const n of notes) {
      const heading = n.heading?.trim() ? `under “${n.heading.trim()}”` : 'a block of the notes';
      lines.push(`- ${heading}: ${clip(n.text, NOTE_CHARS) || '(a heading)'}`);
    }
  }
  for (const s of slides) {
    const label = s.label.trim() ? ` (${s.label.trim()})` : '';
    lines.push(`Lecture p. ${s.page}${label} reads:`, '"""', clip(s.text, SLIDE_CHARS) || '(almost no text on this page)', '"""');
  }
  lines.push(
    '**Ground every point of your reply in these**, and cite the lecture as p. N with the page',
    `numbers above (${pagesCited(slides) || 'the pages of the document above'}), as you do in every reply; the chat links`,
    'them to the slide. Name a notes section by its heading in quotes. Do not cite the tutorial sheet’s',
    'own pages as the source of an idea: the sheet asks, the lecture teaches.',
  );
  return lines;
}

/** The guard, and the parts of the key a non-release turn may use. */
function keyBlock(input: TutorPromptInput): string[] {
  const { key } = input;
  const lines = [
    TUTOR_KEY_GUARD_HEADER,
    '**Never state the answer to this part, or any piece of it that their answer is missing** — not',
    'a blank’s term, not which options are correct, not the next line of their plan, not "for',
    'example, it could be …" with the real thing in it. Not in part, not as a hint, not if they ask',
    'for it in the chat. Only **Show answer** releases it, and the app tells you when it does.',
    'The same holds for **every other part of the sheet** they have not been shown: do not solve',
    'another part either, not even as an aside or "that is also your answer to the next part".',
  ];
  if (key.steps.length > 0) {
    lines.push('The steps a learner takes here (for you to point at, never to carry out for them):');
    for (const s of key.steps) lines.push(`- ${s}`);
  }
  if (key.mistakes.length > 0) {
    lines.push('Mistakes learners often make here:');
    for (const m of key.mistakes) lines.push(`- ${m}`);
  }
  if (input.kind === 'refresher' && key.prerequisites.length > 0) {
    lines.push('What a learner must already know for it:');
    for (const p of key.prerequisites) lines.push(`- ${p}`);
  }
  return lines;
}

/** The release: the model answer itself, and only here. */
function answerBlock(input: TutorPromptInput): string[] {
  const { key } = input;
  const lines = [TUTOR_ANSWER_HEADER, '"""', key.answer.trim(), '"""'];
  if (key.blanks && Object.keys(key.blanks).length > 0) {
    lines.push(
      `The blanks: ${Object.entries(key.blanks)
        .map(([id, accepted]) => `${id} = ${accepted[0] ?? ''}`)
        .join('; ')}.`,
    );
  }
  if (key.correct && key.correct.length > 0) lines.push(`The correct options: ${key.correct.join(', ')}.`);
  if (key.confidence === 'low' && key.from === 'model') {
    lines.push('This key was worked out by the app and a second pass disagreed with it: say once that the official solution may differ.');
  }
  return lines;
}

/** Per kind: what this turn does. */
function kindBlock(input: TutorPromptInput): string[] {
  const ceiling = tutorWordCeiling(input.kind, input.level);
  switch (input.kind) {
    case 'hint': {
      const rung = hintRung(input.level);
      const head = `THIS IS HINT ${rung} OF 3: ${HINT_RUNG_NAMES[rung].toUpperCase()}`;
      if (rung === 1) {
        return [
          head,
          'Say **where** the material for this part is: the notes section (by its heading) and the',
          'lecture page(s) as p. N, and **what to look at there** — the definition, the table, the',
          'example. Then **one** guiding question that turns them towards it. No steps, no method, and',
          'nothing of the answer: do not tell them what to scan, compare or check, or in what order —',
          'that is hint 2, and they have not asked for it (live run, 3 Oct 2026: a first hint that set',
          `out the method left the second nothing to add). **At most ${ceiling} words.**`,
        ];
      }
      if (rung === 2) {
        return [
          head,
          'Break the part into **two to four sub-goals**, from the steps in the key, each phrased as a',
          'question they can answer for themselves ("What does the action need to be true before it',
          'runs?"). A short numbered list. **Do not solve any of them**, and do not give a sub-goal’s',
          'result inside its question. Point each at its p. N where you can.',
          `**At most ${ceiling} words.**`,
        ];
      }
      return [
        head,
        'Work **one step** of this kind of problem on an **analogous case from the lecture** — the',
        'lecture’s own example on the pages above, cited as p. N — **never this part’s own data**,',
        'names or numbers. Show the step and why it is done that way. Then hand it back in one',
        'sentence: the same step is now theirs to do on the part. Do not do it for them.',
        `**At most ${ceiling} words.**`,
      ];
    }
    case 'refresher':
      return [
        'THE LEARNER ASKED FOR A REFRESHER',
        'Explain the **prerequisite** this part rests on (the list in the key, and the notes and lecture',
        'pages above): what it is in your first sentence, then the plain meaning and one small example',
        'from the lecture, cited as p. N. Keep it about the background, not about this part: do not',
        'start the part for them. End by offering, in one short sentence, to go back to the part.',
        `**At most ${ceiling} words.**`,
      ];
    case 'feedback': {
      const v = input.verdict;
      if (!v) {
        return [
          'THE LEARNER PRESSED CHECK, BUT NO VERDICT CAME BACK',
          'Say that the check could not be run just now, and suggest pressing Check again. Nothing else.',
          'At most 30 words.',
        ];
      }
      const opener = v.verdict === 'complete' ? VERDICT_OPENERS[0] : v.verdict === 'partial' ? VERDICT_OPENERS[1] : VERDICT_OPENERS[2];
      const lines = [
        'THE LEARNER PRESSED CHECK ON THEIR ANSWER',
        `The verdict is decided: **${v.verdict.replace('_', ' ')}**. Your first line is exactly **${opener}**`,
        `What the check found: ${v.detail.trim() || '(no detail given)'}`,
      ];
      if (v.checkedBy === 'simulation') {
        lines.push(
          'This was **verified by code**, not judged: the app ran their answer (simulated the plan, or',
          'derived the result) and the verdict is a fact. Say so plainly, in their terms: "I ran your',
          'plan…", "Checked by running it…".',
        );
      } else if (input.key.confidence === 'low' && input.key.from === 'model') {
        lines.push(
          'This was judged against a key the app worked out itself, and a second pass disagreed with',
          'it. Hedge once: say the official solution may differ.',
        );
      }
      if (v.verdict === 'complete') {
        lines.push(
          'Confirm it briefly and say what made it right, with its p. N. At most **one** "why" question',
          'that asks them to say why it works; no new task.',
        );
      } else {
        lines.push(
          'Say **what is right** in it first, specifically. Then what is missing or wrong, **as a',
          'question** that points at it (which part of the lecture, which condition to check), never',
          'as the fix: do not give the missing piece, the corrected line or the term. One question',
          'only, and no second task.',
        );
      }
      lines.push(`**At most ${ceiling} words.**`);
      return lines;
    }
    case 'reply':
      return [
        'THE LEARNER REPLIED TO YOU IN THIS PART’S THREAD',
        'Their message is the last one in the conversation. It may answer the question you asked,',
        'push back on a check or a hint, or ask something new about this part. Read it **against their',
        'answer slot above**, which you now see as it is: never say you cannot see their answer.',
        input.revealed
          ? 'The answer to this part has been shown, so you may discuss it freely and say why it works.'
          : [
              'If it answers your question: say what in it is right, specifically; if something is still',
              'missing, point at it as **one** question (which condition, which lecture page), never as the fix.',
              'If they disagree with a verdict or your reading, take it seriously: if they are right, say so',
              'plainly; if the key may be wrong, say the official solution may differ. Never settle it by',
              'stating the answer. If they ask for the answer or a step, do not give it: say that the next',
              'Hint, or Show answer, on the part will give it.',
            ].join('\n'),
        `**At most ${ceiling} words.**`,
      ];
    case 'reveal':
      return [
        'THE LEARNER PRESSED SHOW ANSWER',
        'They gave up on this part, and that is fine: give the answer above **clearly and in full**, in',
        'the notes’ inline style ($\\TeX$ for formulas, `code` for code). If they wrote something, one',
        'sentence on what their attempt already had. Ground it in the lecture as p. N. Then end with',
        '**one** request: a single line, in their own words, on why it works.',
        `**At most ${ceiling} words**, the answer itself not counted when it is code.`,
      ];
  }
}

/**
 * **The block a tutorial turn reads.** Data first (the part, their answer), then the key or the
 * release, then where the material is, then what this turn does, then the tone, so the
 * instruction is the last thing before the generation.
 */
export function tutorBlock(input: TutorPromptInput): string {
  const answer = input.answer.trim();
  const sections: string[][] = [
    [
      `THE LEARNER IS WORKING ON A TUTORIAL PART: ${input.label.trim()}`,
      'The sheet asks:',
      '"""',
      input.prompt.trim() || '(the part has no words of its own; see the sheet in the document above)',
      '"""',
    ],
    answer.length > 0
      ? ['What they have written in its answer slot so far:', '"""', answer, '"""']
      : ['They have not written anything in its answer slot yet.'],
    input.kind === 'reveal' || (input.kind === 'reply' && input.revealed) ? answerBlock(input) : keyBlock(input),
    groundingBlock(input),
    kindBlock(input),
    [
      'Be a collegial tutor working through the sheet beside them, not an examiner: warm, brief and',
      'specific. No "Great question", no remarks on how they asked, no pressure. Start with the',
      'substance. Do not say that you are writing anything into the tutorial; the app does that.',
    ],
  ];
  return sections.map((s) => s.join('\n')).join('\n\n');
}

/**
 * **The sheet's guard on every other turn** (2026-10-04, Lucas: "explain, never solve"). A
 * notebook's tutorial pages are in every agent's context, so a question in the notebook chat, or
 * on a line of the sheet, could be answered with a part's solution: Ellie did exactly that, in
 * full, on Tutorial 1. Appended to every turn that is not a tutorial turn of its own while any
 * part is still the learner's to solve.
 */
export function sheetGuardBlock(unsolved: readonly string[]): string {
  const labels = unsolved.map((l) => l.trim()).filter((l) => l.length > 0);
  const list = labels.length > 6 ? `${labels.slice(0, 6).join(', ')} and ${labels.length - 6} more` : labels.join(', ');
  return [
    'TUTORIAL PARTS THE LEARNER HAS NOT SOLVED YET',
    `A tutorial sheet in this notebook is the learner’s to work through. Still theirs to solve: ${list || 'its parts'}.`,
    'You may explain the lecture ideas a part uses, on the lecture’s own examples, cited as p. N. **Never**',
    'give the answer to any of these parts, or any piece of one: not a step of its solution, not a term',
    'for a blank, not which options are correct, not a plan, tree or definition built on the part’s own',
    'data, not "for example" with the real thing in it. If they ask for it, explain the idea on the',
    'lecture’s example and say that Hint, or Show answer, on the part will help with the part itself.',
  ].join('\n');
}

/**
 * **The same rule for Max's open notebook question** (2026-10-06 afternoon, decision 6;
 * `notebooks.md` §11.10). The sheet's guard above, with the question in place of the parts: while
 * the learner owes Max an answer, Ellie (in the chat, a span thread, a block action or privately)
 * explains the ideas the question uses and does not answer it. Code checks the reply against the
 * question's hidden key when it has one (`core/answerguard.ts`). The sheet's own guard is
 * unchanged.
 */
export const OPEN_QUESTION_GUARD_HEADER = 'MAX’S OPEN QUESTION IS THE LEARNER’S TO ANSWER';

export function openQuestionGuardBlock(question: string): string {
  const q = question.replace(/\s+/g, ' ').trim();
  return [
    OPEN_QUESTION_GUARD_HEADER,
    q.length > 0 ? `Max has asked the learner, and it is still open: "${q.slice(0, 600)}"` : 'Max has a question open for the learner.',
    'You may explain the lecture ideas it uses, on the lecture’s own examples, cited as p. N. **Never**',
    'give the answer to it, or any piece of one: not a step of the answer, not the term for a blank, not',
    'the reason it asks for, not "for example" with the real thing in it. If they ask for it, explain the',
    'idea on the lecture’s example and say that the question is theirs to try, and that Pass on it shows',
    'the answer whenever they want it.',
  ].join('\n');
}

/** What the reply is told when its first draft stated part of the open question's answer. */
export function openQuestionLeakBlock(points: readonly string[]): string {
  return [
    'YOUR LAST DRAFT ANSWERED MAX’S OPEN QUESTION',
    'It stated this part of the answer, which is the learner’s to find:',
    ...points.map((p) => `- ${p.replace(/\s+/g, ' ').trim()}`),
    'Write the reply again. Explain the idea the question uses on the lecture’s own example, and leave',
    'that part out entirely, in any wording.',
  ].join('\n');
}

/** What Ellie says in place of a reply that was all answer (decision 6). Code-written. */
export const OPEN_QUESTION_HELD_LINE =
  'That part is what Max’s open question asks you for, so I’ll leave it to you. Pass on the question shows the answer whenever you want it.';

// ── The tutorial as the main view (2026-10-04, Lucas: "make the tutorial the main view") ───────

/** The header of the block a turn reads while the sheet is the learner's main view. */
export const TUTORIAL_FOCUS_HEADER = 'THE LEARNER IS WORKING ON A TUTORIAL SHEET';

/** One part of the sheet, as the focus block lists it. Never its key. */
export interface FocusPart {
  label: string;
  /** The sheet's words for the part. */
  prompt: string;
  /** Checked correct, or shown: no longer the learner's to solve. */
  solved: boolean;
  /** The headings of the notes sections it is linked to. */
  notesHeadings: readonly string[];
  /** The lecture pages it is linked to (notebook pages). */
  pages: readonly number[];
}

/**
 * **What a turn is told while the tutorial is the main view** (`docs/research/tutorials.md` §2,
 * 2026-10-04). The sheet fills the middle of the screen and the lecture notes are a click away, so
 * a question in the notebook chat, or on a line of the sheet, is about the sheet. Built by main
 * (`tutorial/focus.ts`) from the saved sheet, the parts' records and their links; never the key.
 *
 * - `parts`: the sheet's parts, in order, each with its status and where its material is.
 * - `current`: the part the line asked about is in, with its problem and its linked notes blocks
 *   and lecture pages (as a tutor turn gets them); null for the notebook chat or a line outside
 *   every part.
 * - `notes`: the lecture notes blocks the sheet's parts link to, for the notebook chat: the notes
 *   the agents would otherwise only reach with the notes on screen.
 *
 * The slides' own text is in every turn already (the room's material is the notebook's lecture and
 * tutorial sources); this block names the pages, and quotes them for the current part.
 */
export interface TutorialFocusInput {
  title: string;
  parts: readonly FocusPart[];
  current: {
    label: string;
    prompt: string;
    notes: readonly { blockId: string; heading: string | null; text: string }[];
    slides: readonly { page: number; label: string; text: string }[];
  } | null;
  notes: readonly { blockId: string; heading: string | null; text: string }[];
}

const FOCUS_MAX_PARTS = 24;
const FOCUS_PROMPT_CHARS = 280;
const FOCUS_MAX_NOTES = 8;

function pagesLine(pages: readonly number[]): string {
  return [...new Set(pages)]
    .sort((a, b) => a - b)
    .map((p) => `p. ${p}`)
    .join(', ');
}

function notesLines(notes: TutorialFocusInput['notes'], max: number): string[] {
  return notes
    .filter((n) => n.text.trim().length > 0 || (n.heading ?? '').trim().length > 0)
    .slice(0, max)
    .map((n) => {
      const heading = n.heading?.trim() ? `under “${n.heading.trim()}”` : 'a block of the notes';
      return `- ${heading}: ${clip(n.text, NOTE_CHARS) || '(a heading)'}`;
    });
}

export function tutorialFocusBlock(input: TutorialFocusInput): string {
  const sections: string[][] = [
    [
      `${TUTORIAL_FOCUS_HEADER}: ${input.title.trim() || 'Tutorial'}`,
      'The sheet is the main view on their screen; the lecture notes are one click away. Read a question',
      'as being about the sheet unless it is plainly about something else, and teach from the lecture:',
      'the notes below and the slides in the course material above, cited as p. N. The sheet asks; the',
      'lecture teaches. Max checks a part and gives its hints: for a verdict on their answer, or help',
      'with a part itself, point them to **Check** or **Help** on that part.',
    ],
  ];

  const parts = input.parts.slice(0, FOCUS_MAX_PARTS);
  if (parts.length > 0) {
    const lines = ['ITS PARTS'];
    for (const p of parts) {
      const where = [
        p.notesHeadings.length > 0 ? `notes: ${p.notesHeadings.map((h) => `“${h}”`).join(', ')}` : '',
        p.pages.length > 0 ? `lecture ${pagesLine(p.pages)}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      const prompt = clip(p.prompt.replace(/\s+/g, ' '), FOCUS_PROMPT_CHARS);
      lines.push(`- ${p.label.trim()} (${p.solved ? 'done' : 'still theirs to solve'}): "${prompt}"${where ? ` · ${where}` : ''}`);
    }
    if (input.parts.length > parts.length) lines.push(`…and ${input.parts.length - parts.length} more parts.`);
    sections.push(lines);
  }

  const current = input.current;
  if (current) {
    const lines = [
      `THE LINE THEY ASKED ABOUT IS IN ${current.label.trim()}`,
      'The sheet asks:',
      '"""',
      current.prompt.trim() || '(the part has no words of its own)',
      '"""',
    ];
    const notes = notesLines(current.notes, MAX_NOTES);
    const slides = current.slides.slice(0, MAX_SLIDES);
    if (notes.length > 0 || slides.length > 0) {
      lines.push('Where the lecture teaches what it uses:', ...notes);
      for (const s of slides) {
        const label = s.label.trim() ? ` (${s.label.trim()})` : '';
        lines.push(`Lecture p. ${s.page}${label} reads:`, '"""', clip(s.text, SLIDE_CHARS) || '(almost no text on this page)', '"""');
      }
    }
    sections.push(lines);
  }

  const notes = notesLines(input.notes, FOCUS_MAX_NOTES);
  if (notes.length > 0) {
    sections.push(['THE LECTURE NOTES THE SHEET DRAWS ON (the learner’s notes, a click away behind the sheet)', ...notes]);
  }
  return sections.map((s) => s.join('\n')).join('\n\n');
}
