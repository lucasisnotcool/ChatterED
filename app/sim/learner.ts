/**
 * **The simulated learner** (`sim/README.md`).
 *
 * A separate model, playing one student whose knowledge is fixed by a persona: what they know,
 * what they do not, what they believe wrongly, how they write and when they give up. It is shown
 * only what the app would show them: the notes, the line they pressed a button on, and the
 * thread. It never sees the agents' prompts, the deck's raw text or the objective list.
 *
 * Its choice on each turn is one of the three things the learner can do with Max's question in
 * the app: answer it in the Q block, ask something in the thread (a term, the background, a
 * hint), or press Pass.
 */
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { RATE_CARD, estimateUsd } from '../src/main/cost/rates.js';
import type { LLMClient } from '../src/room/llm/types.js';
import type { SimMessage } from './harness.js';

export interface Persona {
  id: string;
  /** One or two sentences: who this student is. */
  summary: string;
  /** What they understand and can say correctly. */
  knows: string[];
  /** What they do not know at all. Asked about it, they cannot produce it from memory. */
  gaps: string[];
  /** What they believe that is wrong. Asked about it, they say the wrong thing with confidence. */
  misconceptions: string[];
  /** How they write: length, register, hedging. */
  style: string;
  /** When they ask for background, and when they press Pass. */
  giveUp: string;
  /** Whether they read the notes for an answer, or answer from memory only. */
  readsNotes: boolean;
}

export interface LearnerMove {
  action: 'answer' | 'ask' | 'pass';
  /** The words they type. Empty for `pass`. */
  text: string;
  /** For the report only: why this student did this, in the persona's terms. */
  why: string;
}

const MOVE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['action', 'text', 'why'],
  properties: {
    action: { type: 'string', enum: ['answer', 'ask', 'pass'] },
    text: { type: 'string' },
    why: { type: 'string' },
  },
};

export function personaBlock(p: Persona): string {
  const list = (xs: string[]) => (xs.length > 0 ? xs.map((x) => `- ${x}`).join('\n') : '- (none)');
  return [
    `WHO YOU ARE: ${p.summary}`,
    '',
    'WHAT YOU KNOW AND CAN SAY CORRECTLY:',
    list(p.knows),
    '',
    'WHAT YOU DO NOT KNOW (you cannot produce these from memory; do not guess them correctly):',
    list(p.gaps),
    '',
    'WHAT YOU BELIEVE THAT IS WRONG (say these with confidence when they come up):',
    list(p.misconceptions),
    '',
    `HOW YOU WRITE: ${p.style}`,
    `WHEN YOU ASK OR GIVE UP: ${p.giveUp}`,
    p.readsNotes
      ? 'You read the notes in front of you and may use what they say, the way a student re-reads them before answering.'
      : 'You answer from memory. You do not scroll back through the notes for the answer.',
  ].join('\n');
}

const SYSTEM = (p: Persona) =>
  [
    'You are role-playing one university student using a study app, for a test of the app. Stay in',
    'character. You are not an assistant and you are not helpful beyond what this student would be.',
    'Your knowledge is exactly what the profile below says: you never know more than it says, and',
    'what it lists as a misconception you believe. A tester called Max asks you questions about the',
    'notes; a teacher called Ellie explains. Reply with JSON only.',
    '',
    personaBlock(p),
  ].join('\n');

export class SimLearner {
  readonly persona: Persona;
  readonly #client: LLMClient;
  readonly #model: string;
  readonly #outDir: string;

  constructor(persona: Persona, client: LLMClient, outDir: string, model = 'sonnet') {
    this.persona = persona;
    this.#client = client;
    this.#model = model;
    this.#outDir = outDir;
  }

  /** Max has asked (or answered, or marked): what does this student do next? */
  async respond(input: { notes: string; line: string; question: string; thread: SimMessage[] }): Promise<LearnerMove> {
    const thread = input.thread
      .map((m) => `${m.role === 'learner' ? 'You' : m.who}: ${m.body}`)
      .join('\n\n');
    const user = [
      'THE NOTES ON YOUR SCREEN:',
      '"""',
      input.notes,
      '"""',
      '',
      `YOU PRESSED "Quiz me" ON THIS LINE: "${input.line}"`,
      '',
      'THE CONVERSATION ABOUT IT SO FAR:',
      thread || '(nothing yet)',
      '',
      `MAX'S QUESTION, STILL OPEN: ${input.question}`,
      '',
      'What do you do now? Choose one:',
      '- "answer": type your answer to Max\'s question (as this student would, right or wrong);',
      '- "ask": type a question back instead (a term you do not know, the background, a hint);',
      '- "pass": give up and press Pass (text empty).',
      'Reply with JSON {"action": ..., "text": ..., "why": ...}. "why" is one sentence, in terms of your profile.',
    ].join('\n');
    const started = Date.now();
    const result = await this.#client.complete({
      model: this.#model,
      max_tokens: 600,
      system: [{ type: 'text', text: SYSTEM(this.persona) }],
      messages: [{ role: 'user', content: user }],
      jsonSchema: MOVE_SCHEMA,
      meta: { scope: 'reference', agentKey: `sim.learner.${this.persona.id}` },
    });
    const move = parseMove(result.text);
    const u = result.usage;
    // Priced on the app's own rate card, as the agents' calls are (`cost/rates.ts`).
    const estUsd = estimateUsd(
      result.model,
      { input: u.input_tokens, output: u.output_tokens, cacheWrite: u.cache_creation_input_tokens, cacheRead: u.cache_read_input_tokens },
      RATE_CARD,
      'claude-cli',
    ).usd;
    appendFileSync(
      join(this.#outDir, 'learner.jsonl'),
      `${JSON.stringify({ at: new Date(started).toISOString(), ms: Date.now() - started, model: result.model, usage: u, estUsd, user, reply: result.text, move })}\n`,
    );
    return move;
  }
}

export function parseMove(text: string): LearnerMove {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error(`learner reply is not JSON: ${text.slice(0, 200)}`);
  const raw = JSON.parse(text.slice(start, end + 1)) as Partial<LearnerMove>;
  const action = raw.action === 'ask' || raw.action === 'pass' ? raw.action : 'answer';
  return { action, text: typeof raw.text === 'string' ? raw.text : '', why: typeof raw.why === 'string' ? raw.why : '' };
}
