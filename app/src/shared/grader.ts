/**
 * **The grader copy** (2026-11-23): a preloaded study build made with `release.sh --grader`, for
 * the CS3249 teaching team. Everything here is gated on one flag, `TrialStatus.grader`, which only
 * a grader copy sets (`src/main/study/grader.ts`); every other build shows exactly what it showed
 * before.
 *
 * What differs in a grader copy, and nothing else:
 *  - the consent gate shows `GRADER_NOTICE_*` instead of the participant notice, and needs one
 *    click (consent is still recorded, so nothing behind the gate changes);
 *  - first run opens on the short tour below, before the "Start with a tutorial" card;
 *  - that card offers the bundled sample sheet (`GRADER_SAMPLE_FILE`) above the drop slots;
 *  - Help ▸ Show the Grader Tour opens the tour again.
 *
 * Shared by main, preload and renderer, so it imports nothing.
 */
import type { NoticeSection } from './trial.js';

// ── The consent gate's wording ─────────────────────────────────────────────────────────────

export const GRADER_KICKER = 'CS3249 grading copy';

export const GRADER_NOTICE_TITLE = 'This copy of ChatterED is for grading';

export const GRADER_NOTICE_INTRO =
  'This copy was prepared for grading CS3249. ChatterED is a research prototype from a CS3249 project at ' +
  'the National University of Singapore (NUS).';

export const GRADER_NOTICE_SECTIONS: readonly NoticeSection[] = [
  {
    heading: 'Nothing to set up',
    paragraphs: ['It comes with an API credit already set up, so you need no API key and no account.'],
  },
  {
    heading: 'What is sent to Anthropic',
    paragraphs: [
      'What you type, and the tutorial sheets and slides you open, are sent to Anthropic’s API so that ' +
        'Ellie and Max can reply. ChatterED itself has no server.',
    ],
  },
  {
    heading: 'What stays on this Mac',
    paragraphs: [
      'Usage is logged on this Mac only, in ~/Library/Application Support/ChatterED and ' +
        '~/Library/Logs/ChatterED. Nothing is sent to the team. The File menu has an Export Research Data ' +
        'item: it saves a file only if you choose to, and the app never sends it anywhere.',
    ],
  },
];

export const GRADER_CONTINUE = 'Continue';

/** The title bar's label in a grader copy (the participant build's says "Experimental trial"). */
export const GRADER_BADGE = 'Grading copy';

// ── The first-run tour ─────────────────────────────────────────────────────────────────────

export interface TourCard {
  title: string;
  /** Paragraphs before the list. */
  paragraphs: string[];
  /** A plain bulleted list, drawn after the paragraphs. */
  bullets?: string[];
  /** One quieter line at the end. */
  note?: string;
}

export const GRADER_TOUR: readonly TourCard[] = [
  {
    title: 'What ChatterED is',
    paragraphs: [
      'ChatterED is a tutorial workspace where the student’s own attempt comes first. You add a tutorial ' +
        'sheet, ChatterED reads it into parts, and you work through it part by part.',
    ],
    note: 'Four short cards. You can skip them, and open them again from Help ▸ Show the Grader Tour.',
  },
  {
    title: 'An answer slot, and four buttons',
    paragraphs: ['Every part of the sheet has an answer slot under it, where you type your attempt. Beside it:'],
    bullets: [
      'Check answer: Max judges your attempt (complete, partly there, or not yet) and names one flaw, with one question about it.',
      'Hint: three levels, one per press: Point, then Break it down, then A worked step.',
      'Refresher: Ellie explains the background the part needs, without giving the answer.',
      'Show answer: there once you have checked an attempt. The part is marked revealed and does not count towards progress.',
    ],
  },
  {
    title: 'Max, Ellie, and who decides',
    paragraphs: ['Two AI partners work beside you:'],
    bullets: [
      'Max checks your answers and gives the hints.',
      'Ellie explains background, in a Refresher and in her own private chat.',
      'Each part has its own thread, where you can reply to them in your own words.',
    ],
    note: 'The design rule: code decides how much help you get, and the model only words it.',
  },
  {
    title: 'What to try',
    paragraphs: ['Next, open the sample tutorial (four questions on graph search). Then:'],
    bullets: [
      'type a wrong answer, then press Check answer;',
      'press Hint twice, then Refresher;',
      'send an off-topic or ambiguous message in a part’s thread;',
      'press Show answer after a check;',
      'later, add your own tutorial PDF from the notebook.',
    ],
  },
];

export type TourMove = 'next' | 'back';

/**
 * The tour's next card, or `'done'` past the last one. Back on the first card stays there, and a
 * step that is out of range (a shorter tour after an edit) is pulled back in.
 */
export function tourStep(current: number, move: TourMove, count: number = GRADER_TOUR.length): number | 'done' {
  const last = Math.max(0, count - 1);
  const at = Math.min(Math.max(0, Math.trunc(Number.isFinite(current) ? current : 0)), last);
  if (move === 'back') return Math.max(0, at - 1);
  return at >= last ? 'done' : at + 1;
}

// ── The sample tutorial ────────────────────────────────────────────────────────────────────

/** In `Contents/Resources/samples/` (and `app/samples/` in dev): `electron-builder.yml`. */
export const GRADER_SAMPLE_FILE = 'graph-search-tutorial.pdf';

/** The name of the copy the app hands to the tutorial flow; the notebook is named after it. */
export const GRADER_SAMPLE_COPY_NAME = 'Graph search tutorial.pdf';

/** What `study:graderSample` answers: a readable copy of the sample, or why there is none. */
export type GraderSampleResult = { ok: true; path: string } | { ok: false; error: string };

export const GRADER_SAMPLE_MISSING = 'The sample tutorial is not in this copy. Add a tutorial sheet below instead.';
