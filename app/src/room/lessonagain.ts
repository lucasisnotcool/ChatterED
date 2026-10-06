/**
 * **Start again picks up where the learner left off** (2026-10-06 afternoon, decision 15;
 * `notebooks.md` §11.10 (6 Oct afternoon)).
 *
 * On the Lecture-sdm run the learner pressed Start on "Formulate a problem as an MDP" at 07:28:50
 * (#33, a 150-word walkthrough), worked one question on it, gave up on it (#45, "fuck i give up"),
 * and pressed Start again at 07:36:33: #49 was the whole walkthrough a second time, reworded, with
 * the sum-to-1 point he had just been given folded in as if new. Lucas: a second Start gives a
 * one-line recap, then only what is not yet covered or was got wrong.
 *
 * This reads, in code, what that turn needs to know: the earlier walkthrough (what was covered),
 * and each question asked on the objective with how it ended (what was got, what was got wrong),
 * from the room's own messages, plus the durable outcome rows and the Explain/Example count, which
 * outlive a New Conversation. Null when there is nothing to pick up: then Start is the first one.
 *
 * Pure: messages and outcomes in, a summary out.
 */
import { questionLine } from '../core/quizturn.js';
import { feedbackVerdict3 } from './flow.js';

/** The fields of a stored message this reads. */
export interface LessonMessage {
  seq: number;
  anchorId: string | null;
  objectiveId: string | null;
  decidedBy: string | null;
  body: string;
}

/** The fields of an outcome row this reads (`QuizOutcome`). */
export interface LessonOutcome {
  objectiveId: string | null;
  questionId: string;
  kind: 'verdict' | 'released';
  verdict: 'complete' | 'partial' | 'not_yet' | null;
}

export type QuestionResult = 'well_done' | 'partly' | 'not_yet' | 'released' | 'open';

export interface LessonQuestion {
  /** The question, in one line. */
  question: string;
  result: QuestionResult;
  /** Max's last words on it (the released answer, or what was still open), trimmed. Empty on well_done. */
  said: string;
}

export interface LessonAgain {
  /** The earlier walkthrough, trimmed: what has been covered. Null after a New Conversation. */
  walkthrough: string | null;
  questions: LessonQuestion[];
  /** From the outcome rows, when the room's messages no longer hold the questions. */
  outcomes: { wellDone: number; partly: number; released: number };
  activity: { explains: number; examples: number } | null;
}

/** Rules that ask a question on an objective. */
const ASKS = new Set(['rule:try_here', 'rule:max_followup', 'rule:handoff']);
/** Rules that answer or close one. */
const CLOSES = new Set(['rule:quiz_feedback', 'rule:answer_released', 'rule:closure']);

/** Words kept of the walkthrough and of what Max said: enough to say what was covered, no more. */
export const WALKTHROUGH_WORDS = 220;
export const SAID_WORDS = 80;

function clip(text: string, words: number): string {
  const tokens = text.replace(/\s+/g, ' ').trim().split(' ');
  return tokens.length <= words ? tokens.join(' ') : `${tokens.slice(0, words).join(' ')}…`;
}

export function lessonAgain(input: {
  objectiveId: string;
  messages: readonly LessonMessage[];
  outcomes?: readonly LessonOutcome[];
  activity?: { explains: number; examples: number } | null;
}): LessonAgain | null {
  const ordered = [...input.messages].sort((a, b) => a.seq - b.seq);
  const walkthroughs = ordered.filter((m) => m.decidedBy === 'rule:lesson_start' && m.objectiveId === input.objectiveId);
  const questions: (LessonQuestion & { anchorId: string | null })[] = [];
  for (const m of ordered) {
    if (m.decidedBy !== null && ASKS.has(m.decidedBy) && m.objectiveId === input.objectiveId) {
      questions.push({ question: questionLine(m.body), result: 'open', said: '', anchorId: m.anchorId });
      continue;
    }
    if (m.decidedBy === null || !CLOSES.has(m.decidedBy)) continue;
    // The latest question in this thread is the one this turn is about.
    const q = [...questions].reverse().find((x) => x.anchorId === m.anchorId);
    if (!q || q.result === 'well_done' || q.result === 'released') continue;
    if (m.decidedBy === 'rule:quiz_feedback') {
      const verdict = feedbackVerdict3(m.body);
      q.result = verdict === 'complete' ? 'well_done' : verdict === 'not_yet' ? 'not_yet' : 'partly';
      q.said = q.result === 'well_done' ? '' : clip(m.body, SAID_WORDS);
    } else {
      q.result = 'released';
      q.said = clip(m.body, SAID_WORDS);
    }
  }
  const mine = (input.outcomes ?? []).filter((o) => o.objectiveId === input.objectiveId);
  // The last row per question says how it stands.
  const last = new Map<string, LessonOutcome>();
  for (const o of mine) last.set(o.questionId, o);
  const outcomes = { wellDone: 0, partly: 0, released: 0 };
  for (const o of last.values()) {
    if (o.kind === 'released') outcomes.released += 1;
    else if (o.verdict === 'complete') outcomes.wellDone += 1;
    else outcomes.partly += 1;
  }
  if (walkthroughs.length === 0 && questions.length === 0 && last.size === 0) return null;
  const latest = walkthroughs.at(-1);
  return {
    walkthrough: latest ? clip(latest.body, WALKTHROUGH_WORDS) : null,
    questions: questions.map(({ question, result, said }) => ({ question, result, said })),
    outcomes,
    activity: input.activity ?? null,
  };
}

const RESULT_LINE: Record<QuestionResult, string> = {
  well_done: 'Well done: they have this',
  partly: 'Partly there, never finished',
  not_yet: 'Not yet, never finished',
  released: 'they gave up and were shown the answer',
  open: 'still open, unanswered',
};

/** The block a second Start reads, after the lesson's own (`prompts.doc.lessonStartBlock`). */
export function lessonAgainBlock(again: LessonAgain): string {
  const lines = ['THEY HAVE PRESSED START ON THIS BEFORE. Do not walk them through it again.'];
  if (again.walkthrough) {
    lines.push('What the earlier walkthrough covered:', '"""', again.walkthrough, '"""');
  }
  if (again.questions.length > 0) {
    lines.push('Max’s questions on it since, and how each ended:');
    for (const q of again.questions) {
      lines.push(`- "${q.question}": ${RESULT_LINE[q.result]}.`);
      if (q.said) lines.push(`  What Max said last: "${q.said}"`);
    }
  } else {
    const { wellDone, partly, released } = again.outcomes;
    if (wellDone + partly + released > 0) {
      lines.push(
        `Questions on it so far: ${wellDone} answered well, ${partly} partly answered, ${released} given up on and shown.`,
      );
    }
  }
  if (again.activity && again.activity.explains + again.activity.examples > 0) {
    lines.push(
      `Since its last question closed they pressed Explain ${again.activity.explains} and Example ${again.activity.examples} times on its lines.`,
    );
  }
  lines.push(
    '',
    '**Pick up where they left off.** Open with ONE line recapping where they stand: what they have,',
    'and what is left. Then cover only what is not yet covered or was got wrong: the part of a question',
    'they missed or were shown, said plainly, and any idea in the notes the earlier walkthrough did',
    'not reach. Do not repeat what the walkthrough said or what they already got. About 100 words,',
    '150 at most. Ask them nothing.',
  );
  return lines.join('\n');
}
