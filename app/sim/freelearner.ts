/**
 * **The free-form simulated learner** (`sim/README.md`, "Free-form runs").
 *
 * Unlike `learner.ts`, which answers Max's question on a line a scenario names, this learner
 * plays a whole sitting: on each turn it picks one of the moves the app offers (ask Ellie, ask
 * about a line, answer in the chat or in the notes, Hint, Show me, a typed give-up, dispute a
 * verdict, write a note of its own) from the set the conversation's director allows, and writes
 * what this student would type. It runs on an OpenAI-compatible endpoint (`soclaas.ts`), so it is
 * a different model family from the agents it talks to. It is shown what the app shows: the notes
 * around the lines in play and the conversation, never the agents' prompts or Max's hidden key.
 *
 * Personas live outside this repo, in the JSON file a run is pointed at (`SIM_TESTS`).
 */
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { chat, modelList, parseJsonObject } from './soclaas.js';

export interface FreePersona {
  id: string;
  /** A made-up first name, for the transcript. */
  name: string;
  /** Who they are. */
  summary: string;
  /** What they want from the sitting. */
  wants: string;
  /** How they behave, in the app. */
  behaves: string;
  knows: string[];
  gaps: string[];
  misconceptions: string[];
  /** How they write. */
  style: string;
  /** Where they prefer to answer Max: in the chat, in the notes (Submit), or either. */
  answerVia?: 'chat' | 'notes' | 'either';
  /** Where they prefer to ask: the chat, a line of the notes (Cmd+E), or either. */
  askVia?: 'chat' | 'line' | 'either';
}

export type FreeAction =
  | 'ask'
  | 'answer'
  | 'hint'
  | 'show_me'
  | 'give_up_typed'
  | 'dispute'
  | 'note'
  | 'quiz_me';

export const ACTION_TEXT: Record<FreeAction, string> = {
  ask: 'ask Ellie a question about the material (type the question)',
  answer: "answer Max's open question (type your answer, as this student would, right or wrong)",
  hint: "press Hint on Max's question (text empty)",
  show_me: "press Show me on Max's question, giving up on it (text empty)",
  give_up_typed: "give up on Max's question in words: type that you give up or want to be told the answer",
  dispute: "push back on Max's last verdict: say why you think your answer was right or was marked unfairly",
  note: 'write a sentence or two of your own into your notes (type the note)',
  quiz_me: 'press Quiz me on the line, to be asked a question (text empty)',
};

const TYPED = new Set<FreeAction>(['ask', 'answer', 'give_up_typed', 'dispute', 'note']);

export interface FreeMove {
  action: FreeAction;
  text: string;
  why: string;
  /** The model that answered, as the endpoint reported it. */
  model: string;
}

export const LEARNER_MODELS = (): string[] =>
  modelList(process.env.SIM_LEARNER_MODELS ?? process.env.SIM_LEARNER_MODEL, ['gemma4:26b', 'nemotron3.5:30b', 'qwen3.6:35b']);
export const LEARNER_TEMPERATURE = (): number => Number(process.env.SIM_LEARNER_TEMPERATURE ?? '0.8');

function personaText(p: FreePersona): string {
  const list = (xs: string[]) => (xs.length > 0 ? xs.map((x) => `- ${x}`).join('\n') : '- (none)');
  return [
    `YOUR NAME: ${p.name}`,
    `WHO YOU ARE: ${p.summary}`,
    `WHAT YOU WANT: ${p.wants}`,
    `HOW YOU BEHAVE: ${p.behaves}`,
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
  ].join('\n');
}

const SYSTEM = (p: FreePersona) =>
  [
    'You are role-playing one university student using a study app, for a test of the app. Stay in',
    'character: you are not an assistant, and you know exactly what the profile says, no more. In the',
    'app, Ellie explains the lecture notes and Max asks you questions about them and marks your answers.',
    'Write only what this student would type, in their style. Never mention that you are role-playing.',
    'Reply with one JSON object only.',
    '',
    personaText(p),
  ].join('\n');

export class FreeLearner {
  readonly persona: FreePersona;
  readonly #outDir: string;
  readonly models = new Set<string>();

  constructor(persona: FreePersona, outDir: string) {
    this.persona = persona;
    this.#outDir = outDir;
  }

  /**
   * One turn. `allowed` is what the director lets the learner do now (one entry when it forces a
   * move); `guidance` says what the situation asks of this attempt (for example "a partial
   * answer"). An action outside `allowed` is replaced by the first allowed one.
   */
  async move(input: {
    notes: string;
    conversation: string;
    openQuestion: string | null;
    line: string | null;
    allowed: FreeAction[];
    guidance: string[];
  }): Promise<FreeMove> {
    const user = [
      'THE PART OF THE NOTES ON YOUR SCREEN:',
      '"""',
      input.notes,
      '"""',
      '',
      input.line ? `THE LINE YOU ARE LOOKING AT: "${input.line}"` : '',
      '',
      'THE CONVERSATION SO FAR (oldest first):',
      input.conversation || '(nothing yet)',
      '',
      input.openQuestion ? `MAX'S QUESTION, STILL OPEN: ${input.openQuestion}` : "No question of Max's is open right now.",
      '',
      'WHAT YOU CAN DO NOW (choose exactly one):',
      ...input.allowed.map((a) => `- "${a}": ${ACTION_TEXT[a]}`),
      ...(input.guidance.length > 0 ? ['', 'FOR THIS TURN:', ...input.guidance.map((g) => `- ${g}`)] : []),
      '',
      'Reply with JSON {"action": one of the options above, "text": what you type (empty for a button), "why": one sentence, in terms of your profile}.',
    ]
      .filter((l) => l !== null)
      .join('\n');
    const ask = (extra: string | null) =>
      chat({
        models: LEARNER_MODELS(),
        temperature: LEARNER_TEMPERATURE(),
        maxTokens: 1_500,
        json: true,
        timeoutMs: 120_000,
        messages: [
          { role: 'system', content: SYSTEM(this.persona) },
          { role: 'user', content: extra ? `${user}\n\n${extra}` : user },
        ],
      });
    const read = (text: string): { action?: string; text?: string; why?: string } => {
      try {
        return parseJsonObject(text);
      } catch {
        return { action: input.allowed[0], text: text.trim().slice(0, 600), why: 'reply was not JSON' };
      }
    };
    let result = await ask(null);
    let raw = read(result.text);
    let action = (input.allowed as string[]).includes(raw.action ?? '') ? (raw.action as FreeAction) : input.allowed[0]!;
    // A typed move with nothing typed: asked once more.
    if (TYPED.has(action) && !(typeof raw.text === 'string' && raw.text.trim())) {
      result = await ask(`Your "text" was empty. For "${action}" you must type the words this student sends. Reply with the JSON again.`);
      raw = read(result.text);
      action = (input.allowed as string[]).includes(raw.action ?? '') ? (raw.action as FreeAction) : input.allowed[0]!;
    }
    this.models.add(result.model);
    const move: FreeMove = {
      action,
      text: typeof raw.text === 'string' ? raw.text.trim() : '',
      why: typeof raw.why === 'string' ? raw.why : '',
      model: result.model,
    };
    appendFileSync(
      join(this.#outDir, 'learner.jsonl'),
      `${JSON.stringify({ at: result.at, ms: result.ms, model: result.model, requested: result.requested, usage: result.usage, allowed: input.allowed, guidance: input.guidance, user, reply: result.text, move })}\n`,
    );
    return move;
  }
}
