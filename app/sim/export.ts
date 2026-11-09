/**
 * **A sitting as a transcript** (`sim/README.md`, "Free-form runs"): JSON for a judge, Markdown
 * for a person. One entry per turn, in order: the learner's typed messages and button presses,
 * Ellie's and Max's replies with their channel (the doc chat, a line's thread, the notes), the
 * verdict Max's feedback opened with, whether a turn released the answer, the form of each of
 * Max's questions, and what the agents wrote into the notes. Each of Max's questions is listed
 * with its hidden key points, which the learner never saw.
 *
 * `header` lets the caller put a first line on each file (a marker, a comment) and extra fields
 * at the top of the JSON.
 */
import { writeFileSync } from 'node:fs';
import type { SimMessage } from './harness.js';
import type { MoveLog, QuestionRecord, Sitting } from './sitting.js';

export interface TurnEntry {
  n: number;
  speaker: 'learner' | 'Ellie' | 'Max' | 'app';
  /** Where it happened: the doc chat, a line's thread, the notes, or a button. */
  channel: string;
  kind: 'message' | 'button' | 'notes_edit';
  text: string;
  /** For the learner: which move this was (ask_chat, answer_notes, show_me, …). */
  move?: string;
  /** Max's feedback: the verdict it opened with. */
  verdict?: 'Well done' | 'Partly there' | 'Not yet' | null;
  /** Max's question: open or cloze (fill-in-the-blank). */
  questionForm?: string | null;
  /** The quiz message id of the question this turn asked, answered or released. */
  questionId?: string | null;
  /** This turn gave the answer (a release after a give-up, the three-try cap, or a closure). */
  released?: boolean;
  decidedBy?: string | null;
  seq?: number;
}

export interface Coverage {
  explained: boolean;
  maxAsked: boolean;
  attemptWithFeedback: boolean;
  giveUp: boolean;
  nextQuestionAfterGiveUp: boolean;
  attemptAfterGiveUp: boolean;
}

export function coverageComplete(c: Coverage): boolean {
  return c.explained && c.maxAsked && c.attemptWithFeedback && c.giveUp && c.nextQuestionAfterGiveUp && c.attemptAfterGiveUp;
}

const VERDICTS = [
  ['Well done', /^\W*well done\b/i],
  ['Partly there', /^\W*partly there\b/i],
  ['Not yet', /^\W*not yet\b/i],
] as const;

export function verdictOf(text: string): TurnEntry['verdict'] {
  for (const [v, re] of VERDICTS) if (re.test(text.trim())) return v;
  return null;
}

const RELEASE_RULES = new Set(['rule:answer_released', 'rule:closure']);
const QUESTION_RULES = new Set(['rule:max_followup', 'rule:try_here', 'rule:lesson_start']);

function channelOf(m: SimMessage, threadLines: Map<string, string>): string {
  if (m.threadId === null || m.threadId === 'doc') return 'chat (doc chat)';
  const line = threadLines.get(m.threadId);
  return line ? `chat (thread on the line "${line.slice(0, 80)}")` : `chat (thread ${m.threadId})`;
}

function editText(batch: unknown): string {
  const out: string[] = [];
  const walk = (v: unknown, key = '') => {
    if (typeof v === 'string') {
      if (['text', 'replacement', 'learnerAnswer'].includes(key) && v.trim()) out.push(v.trim());
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk((batch as { ops?: unknown }).ops);
  return out.join(' / ');
}

const BUTTON: Partial<Record<MoveLog['kind'], string>> = {
  hint: 'pressed Hint',
  show_me: 'pressed Show me',
  quiz_me: 'pressed Quiz me',
};

/** Every turn of the sitting, in order. */
export function turnsOf(sitting: Sitting): TurnEntry[] {
  const sim = sitting.sim;
  const messages = sim.messages();
  const questionByMessage = new Map<string, QuestionRecord>([...sitting.questions.values()].map((q) => [q.quizMessageId, q]));
  const threadLines = new Map<string, string>();
  for (const m of sitting.moves) if (m.threadId && m.line) threadLines.set(m.threadId, m.line);
  const turns: TurnEntry[] = [];
  const push = (t: Omit<TurnEntry, 'n'>) => turns.push({ n: turns.length + 1, ...t });
  let currentQuestion: string | null = null;
  const covered = new Set<number>();

  const emitMessage = (m: SimMessage, move: MoveLog | null) => {
    covered.add(m.seq);
    if (m.role === 'learner') {
      // An answer submitted from the notes is shown as the notes move, not again as a message.
      if (move?.kind === 'answer_notes' && !move.refused && m.body.trim() === move.text.trim()) return;
      push({ speaker: 'learner', channel: channelOf(m, threadLines), kind: 'message', text: m.body, move: move?.kind, seq: m.seq, questionId: currentQuestion });
      return;
    }
    const speaker = m.role === 'ellie' ? 'Ellie' : m.role === 'max' ? 'Max' : 'app';
    const asked = questionByMessage.get(m.id);
    if (asked) currentQuestion = asked.quizMessageId;
    const entry: Omit<TurnEntry, 'n'> = {
      speaker,
      channel: channelOf(m, threadLines),
      kind: 'message',
      text: m.body,
      decidedBy: m.decidedBy,
      seq: m.seq,
      questionId: asked ? asked.quizMessageId : currentQuestion,
    };
    if (speaker === 'Max') {
      if (asked || QUESTION_RULES.has(m.decidedBy ?? '')) entry.questionForm = asked?.form ?? 'open';
      if (m.decidedBy === 'rule:quiz_feedback') entry.verdict = verdictOf(m.body);
      entry.released = RELEASE_RULES.has(m.decidedBy ?? '');
    } else {
      entry.released = false;
    }
    push(entry);
  };

  for (const move of sitting.moves) {
    const button = BUTTON[move.kind];
    if (button) {
      push({ speaker: 'learner', channel: 'button', kind: 'button', text: `[${button}]${move.line ? ` on the line "${move.line.slice(0, 80)}"` : ''}`, move: move.kind, questionId: move.questionId });
    } else if (move.kind === 'note') {
      push({ speaker: 'learner', channel: 'notes (own paragraph)', kind: 'notes_edit', text: move.text, move: move.kind });
    } else if (move.kind === 'answer_notes' && !move.refused) {
      push({ speaker: 'learner', channel: "notes (typed in Max's question block, then Submit)", kind: 'notes_edit', text: move.text, move: move.kind, questionId: move.questionId });
    }
    for (const m of messages.filter((x) => x.seq > move.fromSeq && x.seq <= move.toSeq)) emitMessage(m, move);
    for (const e of sim.edits.slice(move.fromEdit, move.toEdit)) {
      const text = editText(e.batch);
      if (!text) continue;
      const who = e.author === 'ellie' ? 'Ellie' : e.author === 'max' ? 'Max' : 'app';
      push({
        speaker: who,
        channel: `notes (${e.cause}${e.status === 'rejected_guard' ? ', refused by the guard' : ''}${e.suggestion ? ', as a suggestion to accept or reject' : ''})`,
        kind: 'notes_edit',
        text,
      });
    }
  }
  for (const m of messages.filter((x) => !covered.has(x.seq))) emitMessage(m, null);
  return turns;
}

/** Which of the plan's four things happened, read off the turns. */
export function coverageOf(turns: TurnEntry[]): Coverage {
  const c: Coverage = { explained: false, maxAsked: false, attemptWithFeedback: false, giveUp: false, nextQuestionAfterGiveUp: false, attemptAfterGiveUp: false };
  let askedEllie = false;
  let attempted = false;
  let gaveUpOn: string | null | undefined;
  for (const t of turns) {
    if (t.speaker === 'learner' && (t.move === 'ask_chat' || t.move === 'ask_line')) askedEllie = true;
    if (t.speaker === 'Ellie' && t.kind === 'message' && askedEllie) c.explained = true;
    if (t.speaker === 'Max' && t.questionForm) {
      c.maxAsked = true;
      if (c.giveUp && t.questionId !== gaveUpOn) c.nextQuestionAfterGiveUp = true;
    }
    if (t.speaker === 'learner' && (t.move === 'answer_chat' || t.move === 'answer_notes')) {
      attempted = true;
      if (c.nextQuestionAfterGiveUp) c.attemptAfterGiveUp = true;
    }
    if (t.speaker === 'Max' && t.decidedBy === 'rule:quiz_feedback' && attempted) c.attemptWithFeedback = true;
    if (t.speaker === 'learner' && (t.move === 'show_me' || t.move === 'give_up_typed') && !c.giveUp) {
      c.giveUp = true;
      gaveUpOn = t.questionId;
    }
  }
  return c;
}

export interface ConversationRecord {
  [key: string]: unknown;
  id: string;
  turns: TurnEntry[];
  questions: QuestionRecord[];
  coverage: Coverage;
}

export function toMarkdown(rec: ConversationRecord, firstLine: string | null, meta: [string, string][]): string {
  const out: string[] = [];
  if (firstLine) out.push(firstLine);
  out.push(`# Conversation ${rec.id}`, '');
  for (const [k, v] of meta) out.push(`- **${k}:** ${v}`);
  out.push('', '## Transcript', '');
  for (const t of rec.turns) {
    const tags: string[] = [t.channel];
    if (t.questionForm) tags.push(`asks a question (${t.questionForm === 'cloze' ? 'fill-in-the-blank' : 'open'})`);
    if (t.verdict) tags.push(`verdict: ${t.verdict}`);
    if (t.released) tags.push('releases the answer');
    if (t.move && t.speaker === 'learner') tags.push(t.move);
    out.push(`**${t.n}. ${t.speaker === 'learner' ? 'Learner' : t.speaker}** _(${tags.join('; ')})_`, '');
    out.push(t.text.replace(/^/gm, '> '), '');
  }
  out.push("## Max's questions and their hidden keys (never shown to the learner)", '');
  rec.questions.forEach((q, i) => {
    out.push(`${String(i + 1)}. **${q.form === 'cloze' ? 'Fill-in-the-blank' : 'Open'} question:** ${q.questionText ?? '(text not stored)'}`);
    if (q.keyPoints.length > 0) for (const [j, p] of q.keyPoints.entries()) out.push(`   - key point ${String(j + 1)}: ${p}`);
    else out.push('   - (no key points stored)');
    if (q.modelAnswer) out.push(`   - model answer: ${q.modelAnswer}`);
    out.push(`   - ended: ${q.releasedBy ? `released (${q.releasedBy})` : q.verdict3 === 'complete' ? 'Well done' : q.answerShown ? 'answer shown' : 'open or partial'}`);
  });
  out.push('');
  return out.join('\n');
}

export function writeConversation(dir: string, rec: ConversationRecord, opts: { jsonFirstKey?: [string, string]; mdFirstLine?: string | null; meta: [string, string][] }): void {
  const json = opts.jsonFirstKey ? { [opts.jsonFirstKey[0]]: opts.jsonFirstKey[1], ...rec } : rec;
  writeFileSync(`${dir}/${rec.id}.json`, `${JSON.stringify(json, null, 2)}\n`);
  writeFileSync(`${dir}/${rec.id}.md`, toMarkdown(rec, opts.mdFirstLine ?? null, opts.meta));
}
