/**
 * **The mechanical half of the judging** (`sim/README.md`, `sim/RUBRIC.md`).
 *
 * What code can decide without reading for meaning: the shape of each question (one question,
 * its length), whether a marking turn opens on a verdict, and two overlap scores that flag a
 * question for a closer look: how much of the pressed line it shares, and how much of an earlier
 * question. A flag is a pointer for the judge, never a verdict on its own.
 */
import { UNMARKED_OPENER, VERDICT_OPENERS } from '../src/room/flow.js';
import type { RecordedCall, SimMessage } from './harness.js';

export interface QuestionCheck {
  seq: number;
  threadId: string | null;
  line: string;
  question: string;
  words: number;
  questionMarks: number;
  /** Content-word overlap with the line the learner pressed Quiz me on (0–1). */
  lineOverlap: number;
  /** The highest content-word overlap with any earlier Max question in the sitting (0–1). */
  priorOverlap: number;
  priorSeq: number | null;
  flags: string[];
}

export interface MarkCheck {
  seq: number;
  threadId: string | null;
  opener: string;
  verdict: string | null;
  words: number;
  flags: string[];
}

const STOP = new Set(
  'a an the and or of to in on for is are be it this that what which how why when with as by at from its your you they them their does do did can could would should one some any each there these those into than then so if not no'.split(
    ' ',
  ),
);

/**
 * Content words, crudely stemmed to their first five letters so "applies" meets "applicable" and
 * "precond" meets "precondition". TeX commands and delimiters are dropped first, so `$s \models
 * g$` and "s entails g" are compared on their words.
 */
export function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/\\[a-z]+/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map((w) => w.slice(0, 5)),
  );
}

/** Overlap as a share of the smaller set, so a short question inside a long line still scores. */
export function overlap(a: string, b: string): number {
  const x = contentWords(a);
  const y = contentWords(b);
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared += 1;
  return shared / Math.min(x.size, y.size);
}

const QUESTION_RULES = new Set(['rule:try_here', 'rule:max_followup', 'rule:handoff']);

export function isMaxQuestion(m: SimMessage): boolean {
  return m.role === 'max' && m.decidedBy !== null && QUESTION_RULES.has(m.decidedBy);
}

export function checkQuestions(messages: SimMessage[], lines: Map<string, string>): QuestionCheck[] {
  const asked: SimMessage[] = [];
  const out: QuestionCheck[] = [];
  for (const m of messages) {
    if (!isMaxQuestion(m)) continue;
    const line = (m.threadId && lines.get(m.threadId)) || '';
    let priorOverlap = 0;
    let priorSeq: number | null = null;
    for (const p of asked) {
      const o = overlap(m.body, p.body);
      if (o > priorOverlap) {
        priorOverlap = o;
        priorSeq = p.seq;
      }
    }
    const lineOverlap = line ? overlap(m.body, line) : 0;
    const words = m.body.split(/\s+/).filter(Boolean).length;
    const questionMarks = (m.body.match(/\?/g) ?? []).length;
    const flags: string[] = [];
    if (questionMarks > 1) flags.push('MULTI_Q');
    if (words > 60) flags.push('LONG');
    if (priorOverlap >= 0.5) flags.push('LIKE_EARLIER');
    if (line && lineOverlap < 0.15) flags.push('OFF_LINE');
    if (line && priorSeq !== null && priorOverlap > lineOverlap) flags.push('CLOSER_TO_EARLIER_THAN_LINE');
    if (/\bor\b[^?]{0,60}\?/i.test(m.body) && /\b(universal|existential|true or false|which of|is it)\b/i.test(m.body))
      flags.push('EITHER_OR');
    out.push({ seq: m.seq, threadId: m.threadId, line, question: m.body, words, questionMarks, lineOverlap, priorOverlap, priorSeq, flags });
    asked.push(m);
  }
  return out;
}

/** Max's turns after a learner's answer in the same thread: each should open on a verdict. */
export function checkMarks(messages: SimMessage[]): MarkCheck[] {
  const out: MarkCheck[] = [];
  for (let i = 1; i < messages.length; i += 1) {
    const m = messages[i]!;
    if (m.role !== 'max' || isMaxQuestion(m)) continue;
    const before = [...messages.slice(0, i)].reverse().find((x) => x.threadId === m.threadId);
    if (!before || before.role !== 'learner') continue;
    const opener = (m.body.split('\n')[0] ?? '').replace(/[*_"“”]/g, '').trim();
    const verdict = [...VERDICT_OPENERS, UNMARKED_OPENER].find((v) => opener.startsWith(v)) ?? null;
    const words = m.body.split(/\s+/).filter(Boolean).length;
    const flags: string[] = [];
    if (verdict === null && m.decidedBy !== 'rule:answer_released') flags.push('NO_VERDICT');
    if (words > 130) flags.push('LONG');
    out.push({ seq: m.seq, threadId: m.threadId, opener: opener.slice(0, 60), verdict, words, flags });
  }
  return out;
}

/** The turn directive and notes the model actually read last: the tail of the final user turn. */
export function directiveOf(call: RecordedCall): string {
  const last = [...call.messages].reverse().find((m) => m.role === 'user');
  if (!last) return '';
  const at = last.content.lastIndexOf('\n\n[');
  return at >= 0 ? last.content.slice(at + 2) : last.content.slice(-4000);
}
