/**
 * **The tutorial turn's code-side decisions** (2026-10-03, `docs/research/tutorials.md` §4,
 * `app/docs/TUTORIAL-CONTRACT.md` S5): who speaks, the learner's request row, and the one line
 * written into the tutorial under the part. Pure: the actor calls these and does the I/O.
 *
 * Every one of them is code, not a model, for the reason `rule:block_action` is: the button named
 * the move, so there is nothing left to decide, and the doc line is derived from what is already
 * known (the rung, the linked pages, the verdict) rather than bought with a second call.
 */
import type { AgentDocOpBatch, AgentAuthor, OutlineEntry, QuizVerdict3 } from '../shared/doc/types.js';
import { BLOCK_LINE_MAX_WORDS } from '../shared/doc/types.js';
import { TUTOR_HELPER, type HintLevel } from '../shared/tutorial.js';
import type { TurnDecision } from './orchestrator.js';
import { HINT_RUNG_NAMES, hintRung, type TutorKind } from './prompts.tutor.js';

/** `decided_by` on the learner's request row: a button, never their words (the ledger skips it). */
export const TUTORIAL_REQUEST = 'tutorial:request';

/** `prov.reason` on the line written under a part (`TUTORIAL-CONTRACT.md` S5). */
export const TUTOR_HINT_REASON = 'tutor_hint';

/** The four rules, by kind. */
export const TUTOR_RULES: Record<TutorKind, string> = {
  hint: 'rule:tutor_hint',
  refresher: 'rule:tutor_refresher',
  feedback: 'rule:tutor_feedback',
  reveal: 'rule:tutor_reveal',
  reply: 'rule:tutor_reply',
};

export function isTutorRule(decidedBy: string | null | undefined): boolean {
  return typeof decidedBy === 'string' && decidedBy.startsWith('rule:tutor_');
}

/** The move each kind is, as `turn_decisions.move_type` records it. */
export function tutorMove(kind: TutorKind): string {
  return `tutor_${kind}`;
}

export function tutorKindOfMove(move: string | null | undefined): TutorKind | null {
  switch (move) {
    case 'tutor_hint':
      return 'hint';
    case 'tutor_refresher':
      return 'refresher';
    case 'tutor_feedback':
      return 'feedback';
    case 'tutor_reveal':
      return 'reveal';
    case 'tutor_reply':
      return 'reply';
    default:
      return null;
  }
}

/**
 * **Who answers a tutorial button.** Max hints, checks and releases; Ellie gives a refresher.
 * `TUTOR_HELPER === 'ellie'` moves Max's three to her (Lucas, 3 Oct: *"keep this a possible
 * decision point"*). `challenges` is empty: help puts nothing under the ledger's test, and main
 * records the part's outcome itself.
 */
export function tutorDecision(kind: TutorKind, helper: 'max' | 'ellie' = TUTOR_HELPER): TurnDecision {
  const role = kind === 'refresher' || helper === 'ellie' ? 'peer' : 'challenger';
  const why: Record<TutorKind, string> = {
    hint: 'The learner pressed Hint on a tutorial part: the next rung of help, grounded in the notes and slides.',
    refresher: 'The learner pressed Refresher on a tutorial part: Ellie explains the prerequisite from the lecture.',
    feedback: 'The learner pressed Check on a tutorial part: the verdict is decided in main; this turn voices it.',
    reveal: 'The learner pressed Show answer on a tutorial part: the key is released, then one line on why.',
    reply: 'The learner replied in a tutorial part’s thread: the tutor answers with the part, their answer slot and the guard.',
  };
  return {
    speak: true,
    role,
    moveType: tutorMove(kind),
    probeType: null,
    targetElementId: null,
    challenges: [],
    rationale: why[kind],
    decidedBy: TUTOR_RULES[kind],
    handOffLine: null,
    failure: null,
  };
}

/** **The learner's row**: what they asked for, so the thread reads as a request and its answer. */
export function tutorialRequestLine(kind: TutorKind, label: string, level: HintLevel = 1): string {
  const part = label.trim() || 'this part';
  switch (kind) {
    case 'hint':
      return `Hint, please: ${part} (${HINT_RUNG_NAMES[hintRung(level)].toLowerCase()})`;
    case 'refresher':
      return `A refresher for ${part}`;
    case 'feedback':
      return `Check my answer to ${part}`;
    case 'reveal':
      return `Show me the answer to ${part}`;
    case 'reply':
      return part;
  }
}

// ── the line under the part ───────────────────────────────────────────────

/** The lines this module writes start with these, which is how a later one finds the last. */
const TUTOR_LINE = /^(Hint [123]\b|Refresher\b|Checked\b|Answer shown\b)/;

export function isTutorLineText(text: string): boolean {
  return TUTOR_LINE.test(text.trim());
}

/** At most `max` words, with an ellipsis when cut. */
export function capWords(text: string, max = BLOCK_LINE_MAX_WORDS): string {
  const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length <= max) return words.join(' ');
  return `${words.slice(0, max).join(' ').replace(/[,;:.—-]+$/, '')}…`;
}

function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const match = /^(.+?[.!?])(\s|$)/.exec(flat);
  return (match ? match[1]! : flat).trim();
}

/** The first question a reply asks, stripped of list markers and emphasis. */
function firstQuestion(text: string): string | null {
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^\s*(\d+[.)]|[-*•])\s*/, '').replace(/\*\*/g, '').trim();
    const q = /([^.!?]*\?)/.exec(line);
    if (q && q[1]!.trim().length > 3) return q[1]!.trim();
  }
  return null;
}

const VERDICT_WORDS: Record<QuizVerdict3, string> = { complete: 'correct', partial: 'partly there', not_yet: 'not yet' };

/**
 * **The one line under the part** (`tutorials.md` §4: *"one short line in the tutorial under the
 * part … so the sheet records what help was used"*), at most 25 words, derived in code:
 *
 * - hint 1: where to look — the notes heading and the lecture pages;
 * - hint 2: the first sub-goal question of the reply (a question, never a result);
 * - hint 3: that a step was worked on the lecture's example, and where;
 * - refresher: the prerequisite, and where;
 * - feedback: the verdict, who decided it, and the check's own first sentence (which, by S4, never
 *   holds the missing piece);
 * - reveal: that the answer was shown. Never the answer itself: the chat has it, and a line in
 *   the sheet would put it beside the slot for good.
 */
export function tutorDocLine(input: {
  kind: TutorKind;
  level: HintLevel;
  reply: string;
  notesHeading: string | null;
  pages: readonly number[];
  prerequisite: string | null;
  verdict?: { verdict: QuizVerdict3; checkedBy: 'simulation' | 'model'; detail: string };
}): string {
  const pages = [...new Set(input.pages)].sort((a, b) => a - b).slice(0, 3);
  const where = [
    input.notesHeading?.trim() ? `“${input.notesHeading.trim()}” in the notes` : null,
    pages.length > 0 ? pages.map((p) => `p. ${p}`).join(', ') : null,
  ]
    .filter((x): x is string => x !== null)
    .join(' and ');
  switch (input.kind) {
    case 'hint': {
      const rung = hintRung(input.level);
      if (rung === 1) return capWords(where ? `Hint 1: look at ${where}.` : 'Hint 1: where to look is in the chat.');
      if (rung === 2) {
        const q = firstQuestion(input.reply);
        return capWords(q ? `Hint 2: start from — ${q}` : 'Hint 2: the part broken into sub-steps, in the chat.');
      }
      return capWords(`Hint 3: one step worked on the lecture’s example${pages.length > 0 ? ` (${pages.map((p) => `p. ${p}`).join(', ')})` : ''}; the same step is yours.`);
    }
    case 'refresher': {
      const what = input.prerequisite?.trim() ? firstSentence(input.prerequisite).replace(/[.!?]$/, '') : 'the background this part needs';
      return capWords(`Refresher: ${what}${where ? `, see ${where}` : ''}.`);
    }
    case 'feedback': {
      const v = input.verdict;
      if (!v) return 'Checked: no verdict yet; try Check again.';
      const by = v.checkedBy === 'simulation' ? ' (run by the app)' : '';
      const detail = v.detail.trim() ? ` ${firstSentence(v.detail)}` : '';
      return capWords(`Checked${by}: ${VERDICT_WORDS[v.verdict]}.${detail}`);
    }
    case 'reveal':
      return 'Answer shown in the chat.';
    case 'reply':
      // A reply writes nothing into the sheet (`actor.#tutorDocLine`); the line is never used.
      return '';
  }
}

/**
 * **The part's last child, from the outline** (`tut_part` is a container, so its children are
 * addressable blocks listed straight after it). The outline carries no nesting, so the run is
 * read from what the part's own children are: its prompt blocks, then its answer slot
 * (`tut_answer` / `tut_choices`), then any lines this module wrote under it before. A `blanks`
 * part has no slot; its run ends at the next part or heading, or at the first block after a
 * tutor line that is not one. Null when the part is not in the outline.
 */
export function partLastChild(outline: readonly OutlineEntry[], partBlockId: string): string | null {
  const at = outline.findIndex((e) => e.blockId === partBlockId);
  if (at < 0) return null;
  let last: string | null = null;
  let closed = false;
  for (let i = at + 1; i < outline.length; i++) {
    const e = outline[i]!;
    if (e.kind === 'tut_part' || e.kind === 'heading') break;
    const tutorLine = !e.learnerText && isTutorLineText(e.text);
    if (closed && !tutorLine) break;
    last = e.blockId;
    if (e.kind === 'tut_answer' || e.kind === 'tut_choices' || tutorLine) closed = true;
  }
  return last;
}

/** The batch that writes the line: an agent insert, pending Remove · Keep like every agent line. */
export function tutorLineBatch(input: {
  editId: string;
  author: AgentAuthor;
  anchorBlockId: string;
  partBlockId: string;
  line: string;
  pages: readonly number[];
  label: string;
  kind: TutorKind;
}): AgentDocOpBatch {
  return {
    editId: input.editId,
    author: input.author,
    // The `block_action` cause is the one-line-under-a-block edit (migration 024's CHECK); the
    // tutorial's own mark is the block's `reason`.
    cause: 'block_action',
    ops: [
      {
        op: 'insert_after',
        anchorBlockId: input.anchorBlockId,
        blocks: [{ kind: 'paragraph', text: input.line, prov: { pages: [...input.pages], reason: TUTOR_HINT_REASON } }],
      },
    ],
    focusBlockId: input.partBlockId,
    why: `${input.kind === 'feedback' ? 'Check' : input.kind === 'reveal' ? 'Answer shown' : input.kind === 'refresher' ? 'Refresher' : 'Hint'} on ${input.label}`,
  };
}
