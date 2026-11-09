/**
 * **Does a draft state the open question's answer, in any wording?** (the semantic half of
 * Ellie's open-question guard).
 *
 * `core/answerguard.ts` catches a sentence that repeats most of a key point's content words. A
 * paraphrase, a simplification ("like I'm five"), a worked example or a translation states the
 * same point in other words and passes it. This is the check for those: one structured call, one
 * criterion, given the open question, its hidden key points and the draft, which names the points
 * the draft states in substance. Code decides what happens next (`RoomActor`'s guarded turn), as
 * it does for the lexical check.
 *
 * The model call goes through the actor's own `LLMClient`, so a test drives it with a fake client.
 * A call that fails or a reply that cannot be read counts as no leak found: the lexical check has
 * already run, and a learner's question is not left unanswered because a check could not run.
 */
import type { LLMClient, LlmRequest } from './llm/types.js';

export const LEAK_CHECK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['stated', 'why'],
  properties: {
    stated: { type: 'array', items: { type: 'integer' } },
    why: { type: 'string' },
  },
} as const;

/** Marks the request, so a log line or a fake client can tell it from a turn. */
export const LEAK_CHECK_AGENT_KEY = 'guard.leak_check';

export function leakCheckRequest(input: {
  model: string;
  draft: string;
  question: string;
  keyPoints: readonly string[];
  roomId?: string;
  turnId?: string;
}): LlmRequest {
  const points = input.keyPoints.map((p, i) => `${String(i + 1)}. ${p.replace(/\s+/g, ' ').trim()}`).join('\n');
  const system = [
    'You check one thing about a draft reply in a study app: whether it gives away the answer to a',
    'question the learner has been asked and has not yet tried. You are given the question, the',
    "answer's key points (hidden from the learner), and the draft.",
    '',
    'A key point is STATED when the draft says it in substance, in any wording: a paraphrase, a',
    'simpler or childlike version, an analogy that maps onto it, a worked example that shows it, or',
    'a translation into another language. It is NOT stated when the draft only explains background',
    'the point builds on, names the topic, lists options without saying which one or why, or tells',
    'the learner where to look.',
    '',
    'Reply with JSON {"stated": [the numbers of the key points the draft states], "why": one sentence}.',
    'Use an empty list when it states none.',
  ].join('\n');
  const user = [`THE QUESTION:\n${input.question}`, `THE KEY POINTS:\n${points}`, `THE DRAFT:\n"""\n${input.draft}\n"""`].join('\n\n');
  return {
    model: input.model,
    max_tokens: 400,
    temperature: 0,
    system: [{ type: 'text', text: system }],
    messages: [{ role: 'user', content: user }],
    jsonSchema: LEAK_CHECK_SCHEMA as unknown as Record<string, unknown>,
    meta: {
      scope: 'reference',
      agentKey: LEAK_CHECK_AGENT_KEY,
      ...(input.roomId ? { roomId: input.roomId } : {}),
      ...(input.turnId ? { turnId: input.turnId } : {}),
    },
  };
}

/** The point numbers (from 1) a reply names, in range, once each. Unreadable is none. */
export function parseLeakCheck(text: string, pointCount: number): number[] {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as { stated?: unknown };
    if (!Array.isArray(raw.stated)) return [];
    const ns = raw.stated
      .map((n) => (typeof n === 'number' ? n : typeof n === 'string' ? Number.parseInt(n, 10) : Number.NaN))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= pointCount);
    return [...new Set(ns)].sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/** Run the check. Never throws: a failed call is `{ stated: [], failed: true }`. */
export async function checkLeak(
  llm: LLMClient,
  input: Parameters<typeof leakCheckRequest>[0],
  signal?: AbortSignal,
): Promise<{ stated: number[]; failed: boolean }> {
  if (input.keyPoints.length === 0 || input.draft.trim().length === 0) return { stated: [], failed: false };
  try {
    const result = await llm.complete(leakCheckRequest(input), undefined, signal);
    return { stated: parseLeakCheck(result.text, input.keyPoints.length), failed: false };
  } catch {
    return { stated: [], failed: true };
  }
}

// ── The learner's question, before Ellie answers it ────────────────────────────────────────

/**
 * **Would a direct answer to the learner's question state the open question's key?** The same
 * single-criterion pattern, asked of the question instead of a draft: a question to Ellie whose
 * honest answer is one of Max's key points (a "neighbouring question") is deferred to Max's
 * question rather than answered, while that question has had no attempt.
 */
export function questionLeakRequest(input: {
  model: string;
  learnerQuestion: string;
  question: string;
  keyPoints: readonly string[];
  roomId?: string;
  turnId?: string;
}): LlmRequest {
  const points = input.keyPoints.map((p, i) => `${String(i + 1)}. ${p.replace(/\s+/g, ' ').trim()}`).join('\n');
  const system = [
    'You check one thing in a study app. A tester has asked the learner a question, and its answer has',
    'key points the learner must find themselves. The learner now asks the teacher something else.',
    'Would a direct, correct answer to the learner\'s question state any of the key points in substance',
    '(in any wording, as a reason, an example or a consequence)? A question about a definition or about',
    'background the points build on does not, unless answering it gives a point away.',
    '',
    'Reply with JSON {"stated": [the numbers of the key points a direct answer would state], "why": one sentence}.',
    'Use an empty list when it would state none.',
  ].join('\n');
  const user = [
    `THE TESTER'S QUESTION:\n${input.question}`,
    `ITS KEY POINTS:\n${points}`,
    `THE LEARNER'S QUESTION TO THE TEACHER:\n"""\n${input.learnerQuestion}\n"""`,
  ].join('\n\n');
  return {
    model: input.model,
    max_tokens: 400,
    temperature: 0,
    system: [{ type: 'text', text: system }],
    messages: [{ role: 'user', content: user }],
    jsonSchema: LEAK_CHECK_SCHEMA as unknown as Record<string, unknown>,
    meta: {
      scope: 'reference',
      agentKey: QUESTION_CHECK_AGENT_KEY,
      ...(input.roomId ? { roomId: input.roomId } : {}),
      ...(input.turnId ? { turnId: input.turnId } : {}),
    },
  };
}

export const QUESTION_CHECK_AGENT_KEY = 'guard.question_check';

/** Run the question check. Never throws: a failed call is `{ stated: [], failed: true }`. */
export async function checkQuestionLeak(
  llm: LLMClient,
  input: Parameters<typeof questionLeakRequest>[0],
  signal?: AbortSignal,
): Promise<{ stated: number[]; failed: boolean }> {
  if (input.keyPoints.length === 0 || input.learnerQuestion.trim().length === 0) return { stated: [], failed: false };
  try {
    const result = await llm.complete(questionLeakRequest(input), undefined, signal);
    return { stated: parseLeakCheck(result.text, input.keyPoints.length), failed: false };
  } catch {
    return { stated: [], failed: true };
  }
}

/**
 * **What Ellie says instead of answering a neighbouring question.** Code-written, so it holds no
 * key content, and it names the two ways on: try Max's question, or ask him for a hint.
 */
export const OPEN_QUESTION_DEFER_LINE =
  'That one is close to Max’s open question, so have a go at his first. If you’re stuck, Hint on his question is there.';
