/**
 * **An LLM judge over exported transcripts** (`sim/README.md`, "Judging transcripts").
 *
 * One criterion per call: a prompt file holds the whole instruction, with `{{TRANSCRIPT}}` where
 * the conversation goes (appended at the end when the placeholder is missing), and the judge
 * answers `{verdict: PASS|FAIL, reason, evidence_turns}`. The transcript it sees is the turns as
 * numbered lines plus Max's hidden key points, and nothing about how the conversation was made
 * (which build, which persona, what was expected), so a verdict cannot lean on that.
 */
import { chat, modelList, parseJsonObject } from './soclaas.js';
import type { TurnEntry } from './export.js';

export interface JudgeVerdict {
  verdict: 'PASS' | 'FAIL';
  reason: string;
  evidence_turns: number[];
}

export interface JudgedRecord extends JudgeVerdict {
  conversation: string;
  criterion: string;
  promptVersion: string;
  model: string;
  requested: string;
  temperature: number;
  at: string;
  ms: number;
  raw: string;
}

interface Question {
  quizMessageId: string;
  questionText: string | null;
  form: string | null;
  keyPoints: string[];
  modelAnswer?: string | null;
}

export const JUDGE_MODELS = (): string[] => modelList(process.env.SIM_JUDGE_MODELS ?? process.env.SIM_JUDGE_MODEL, ['qwen3.8:27b']);
export const JUDGE_TEMPERATURE = (): number => Number(process.env.SIM_JUDGE_TEMPERATURE ?? '0');

/** The conversation as the judge reads it: numbered turns, then the hidden keys. */
export function judgeTranscript(conv: { turns: TurnEntry[]; questions?: Question[] }): string {
  const lines: string[] = [];
  for (const t of conv.turns) {
    const tags: string[] = [t.channel];
    if (t.questionForm) tags.push(`asks a question (${t.questionForm === 'cloze' ? 'fill-in-the-blank' : 'open'})`);
    if (t.verdict) tags.push(`verdict: ${t.verdict}`);
    if (t.released) tags.push('releases the answer');
    if (t.speaker === 'learner' && t.move) tags.push(`learner move: ${t.move}`);
    lines.push(`[${String(t.n)}] ${t.speaker === 'learner' ? 'LEARNER' : t.speaker.toUpperCase()} (${tags.join('; ')}):`);
    lines.push(t.text.trim(), '');
  }
  const questions = conv.questions ?? [];
  if (questions.length > 0) {
    lines.push("MAX'S QUESTIONS AND THEIR HIDDEN KEY POINTS (the learner never saw these):");
    questions.forEach((q, i) => {
      lines.push(`Question ${String(i + 1)} (${q.form === 'cloze' ? 'fill-in-the-blank' : 'open'}): ${q.questionText ?? '(text not stored)'}`);
      if (q.keyPoints.length === 0) lines.push('  - (no key points stored)');
      q.keyPoints.forEach((p, j) => lines.push(`  - key point ${String(j + 1)}: ${p}`));
    });
  }
  return lines.join('\n');
}

export function judgePrompt(template: string, transcript: string): string {
  return template.includes('{{TRANSCRIPT}}') ? template.replace('{{TRANSCRIPT}}', transcript) : `${template}\n\nTRANSCRIPT:\n${transcript}`;
}

export function parseVerdict(text: string): JudgeVerdict {
  const raw = parseJsonObject<{ verdict?: unknown; reason?: unknown; evidence_turns?: unknown }>(text);
  const v = String(raw.verdict ?? '').trim().toUpperCase();
  if (v !== 'PASS' && v !== 'FAIL') throw new Error(`verdict is neither PASS nor FAIL: ${String(raw.verdict)}`);
  const turns = Array.isArray(raw.evidence_turns) ? raw.evidence_turns.map(Number).filter((n) => Number.isFinite(n)) : [];
  return { verdict: v, reason: typeof raw.reason === 'string' ? raw.reason : '', evidence_turns: turns };
}

export async function judgeOne(input: {
  conversation: string;
  criterion: string;
  promptVersion: string;
  template: string;
  conv: { turns: TurnEntry[]; questions?: Question[] };
}): Promise<JudgedRecord> {
  const user = judgePrompt(input.template, judgeTranscript(input.conv));
  const temperature = JUDGE_TEMPERATURE();
  let lastError: unknown = null;
  // A reply that is not a verdict is asked for once more.
  for (let i = 0; i < 2; i += 1) {
    const result = await chat({
      models: JUDGE_MODELS(),
      temperature,
      maxTokens: 8_000,
      json: true,
      timeoutMs: 300_000,
      messages: [
        { role: 'system', content: 'You are a careful evaluator of tutoring conversations. You apply one criterion exactly as written and reply with one JSON object only.' },
        { role: 'user', content: user },
      ],
    });
    try {
      const v = parseVerdict(result.text);
      return { ...v, conversation: input.conversation, criterion: input.criterion, promptVersion: input.promptVersion, model: result.model, requested: result.requested, temperature, at: result.at, ms: result.ms, raw: result.text };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
