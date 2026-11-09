/**
 * **One sitting, driven move by move** (`sim/README.md`, "Free-form runs").
 *
 * The learner's moves as the renderer makes them, over `SimRoom`'s IPC: a question in the doc
 * chat or on a line (Cmd+E, `chat:openSpan`), an answer in the question's thread or typed into
 * its Q block and submitted (`notes:answerQuestion`), Hint (`quiz:hint`), Show me (`quiz:pass`),
 * a typed give-up or dispute, a note of the learner's own, and Quiz me on a line. Each move is
 * logged with the message range and the doc edits it led to, and after each one the room's
 * stored question (with its hidden key) is captured, so a transcript can show the key the
 * verdict was decided from. Both the free-form learner and the scripted red-team turns use it.
 */
import type { NotesAnswerQuestionResult, NotesBlockActionResult } from '../src/shared/ipc.js';
import { DOC_ANCHOR_ID, type DocQuizView, type ThreadView } from '../src/shared/doc/types.js';
import type { SimMessage, SimRoom } from './harness.js';

export type MoveKind =
  | 'ask_chat'
  | 'ask_line'
  | 'answer_chat'
  | 'answer_notes'
  | 'hint'
  | 'show_me'
  | 'give_up_typed'
  | 'dispute'
  | 'note'
  | 'quiz_me'
  | 'chat';

export interface MoveLog {
  n: number;
  kind: MoveKind;
  text: string;
  /** The line it was made on, if any (its block id and text). */
  blockId: string | null;
  line: string | null;
  threadId: string | null;
  /** The question open when the move was made. */
  questionId: string | null;
  refused: string | null;
  why: string | null;
  /** Messages this move led to: seq in (fromSeq, toSeq]. */
  fromSeq: number;
  toSeq: number;
  /** Agent doc edits this move led to: `SimRoom.edits` indexes [fromEdit, toEdit). */
  fromEdit: number;
  toEdit: number;
  at: string;
  ms: number;
  /** The learner model that wrote it, or `scripted`. */
  by: string;
}

export interface QuestionRecord {
  questionId: string | null;
  quizMessageId: string;
  questionText: string | null;
  form: string | null;
  keyPoints: string[];
  modelAnswer: string | null;
  objectiveId: string | null;
  anchorId: string | null;
  attempts: number | null;
  verdict3: string | null;
  releasedBy: string | null;
  answerShown: boolean;
  pointsCovered: number[] | null;
}

export interface OpenQuestion {
  threadId: string;
  quiz: DocQuizView;
  text: string;
}

const maxSeq = (messages: SimMessage[]) => Math.max(0, ...messages.map((m) => m.seq));

/** A line by its block id (`b_…`), or the first block whose text contains the words. */
export function lineOf(sim: SimRoom, ref: string): { blockId: string; text: string } {
  if (/^b_[0-9a-f]{12}$/.test(ref)) {
    const text = sim.blockText(ref);
    if (text === null) throw new Error(`no block ${ref} in the notes`);
    return { blockId: ref, text };
  }
  return sim.findBlock(ref);
}

export class Sitting {
  readonly sim: SimRoom;
  readonly moves: MoveLog[] = [];
  readonly questions = new Map<string, QuestionRecord>();
  readonly #idleMs: number;

  constructor(sim: SimRoom, opts: { idleTimeoutMs?: number } = {}) {
    this.sim = sim;
    this.#idleMs = opts.idleTimeoutMs ?? 480_000;
  }

  /** Max's open question, if one is open in any thread. */
  async openQuestion(): Promise<OpenQuestion | null> {
    const threads: ThreadView[] = await this.sim.threads().catch(() => []);
    const t = threads.find((x) => x.quiz?.open === true);
    if (!t?.quiz) return null;
    const q = this.sim.qBlockFor(t.quiz.questionId);
    const lastMax = [...this.sim.messages(t.threadId)].reverse().find((m) => m.role === 'max');
    return { threadId: t.threadId, quiz: t.quiz, text: q?.question || lastMax?.body || '' };
  }

  /** The thread of the last question asked, open or not (for a dispute after it closed). */
  async lastQuestionThread(): Promise<string | null> {
    const pq = this.sim.pendingQuiz();
    if (pq && typeof pq.anchorId === 'string') return pq.anchorId;
    const lastMax = [...this.sim.messages()].reverse().find((m) => m.role === 'max');
    return lastMax?.threadId ?? null;
  }

  #capture(): void {
    const pq = this.sim.pendingQuiz();
    if (!pq) return;
    const str = (v: unknown) => (typeof v === 'string' ? v : null);
    const record: QuestionRecord = {
      questionId: str(pq.questionId),
      quizMessageId: pq.quizMessageId,
      questionText: str(pq.questionText),
      form: str(pq.form) ?? 'open',
      keyPoints: Array.isArray(pq.keyPoints) ? (pq.keyPoints as unknown[]).filter((p): p is string => typeof p === 'string') : [],
      modelAnswer: str(pq.modelAnswer),
      objectiveId: str(pq.objectiveId),
      anchorId: str(pq.anchorId),
      attempts: typeof pq.attempts === 'number' ? pq.attempts : null,
      verdict3: str(pq.verdict3),
      releasedBy: str(pq.releasedBy),
      answerShown: pq.answerShown === true,
      pointsCovered: Array.isArray(pq.pointsCovered) ? (pq.pointsCovered as number[]) : null,
    };
    this.questions.set(record.quizMessageId, record);
  }

  /** Run one move: log it, wait for the room to go quiet, capture the question state. */
  async #run(
    kind: MoveKind,
    input: { text?: string; blockId?: string | null; line?: string | null; why?: string | null; by?: string },
    body: (log: MoveLog) => Promise<void>,
  ): Promise<MoveLog> {
    const open = await this.openQuestion();
    const started = Date.now();
    const log: MoveLog = {
      n: this.moves.length + 1,
      kind,
      text: input.text ?? '',
      blockId: input.blockId ?? null,
      line: input.line ?? null,
      threadId: null,
      // The quiz message id, the one key `QuestionRecord` and the transcript share.
      questionId: open?.quiz.quizMessageId ?? null,
      refused: null,
      why: input.why ?? null,
      fromSeq: maxSeq(this.sim.messages()),
      toSeq: 0,
      fromEdit: this.sim.edits.length,
      toEdit: 0,
      at: new Date(started).toISOString(),
      ms: 0,
      by: input.by ?? 'scripted',
    };
    this.moves.push(log);
    try {
      await body(log);
      await this.sim.idle({ timeoutMs: this.#idleMs });
    } catch (err) {
      log.refused = log.refused ?? `error: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      log.toSeq = maxSeq(this.sim.messages());
      log.toEdit = this.sim.edits.length;
      log.ms = Date.now() - started;
      this.#capture();
    }
    return log;
  }

  /** A question in the doc chat (or in `threadId`). */
  ask(text: string, opts: { threadId?: string; why?: string; by?: string } = {}): Promise<MoveLog> {
    return this.#run('ask_chat', { text, why: opts.why, by: opts.by }, async (log) => {
      log.threadId = opts.threadId ?? DOC_ANCHOR_ID;
      await this.sim.call('chat:send', { fileId: this.sim.notebookId, threadId: log.threadId, text });
    });
  }

  /** Cmd+E on a line: a new thread on that block, with the question. */
  askLine(needle: string, text: string, opts: { why?: string; by?: string } = {}): Promise<MoveLog> {
    const block = lineOf(this.sim, needle);
    return this.#run('ask_line', { text, blockId: block.blockId, line: block.text, why: opts.why, by: opts.by }, async (log) => {
      const opened = await this.sim.call<{ threadId: string }>('chat:openSpan', {
        fileId: this.sim.notebookId,
        blockId: block.blockId,
        quote: block.text,
        question: text,
      });
      log.threadId = opened.threadId;
    });
  }

  /** Any typed message in a thread, classified by the app as it would be (attempt, give-up, …). */
  say(kind: 'answer_chat' | 'give_up_typed' | 'dispute' | 'chat', text: string, threadId: string, opts: { why?: string; by?: string } = {}): Promise<MoveLog> {
    return this.#run(kind, { text, why: opts.why, by: opts.by }, async (log) => {
      log.threadId = threadId;
      await this.sim.call('chat:send', { fileId: this.sim.notebookId, threadId, text });
    });
  }

  /** The answer typed into the open question's Q block, then Submit. Falls back to the chat. */
  answerInNotes(text: string, opts: { why?: string; by?: string } = {}): Promise<MoveLog> {
    return this.#run('answer_notes', { text, why: opts.why, by: opts.by }, async (log) => {
      const open = await this.openQuestion();
      if (!open) {
        log.refused = 'no open question';
        return;
      }
      log.threadId = open.threadId;
      const q = this.sim.qBlockFor(open.quiz.questionId);
      if (!q) {
        log.refused = 'no Q block in the notes: answered in the chat';
        log.kind = 'answer_chat';
        await this.sim.call('chat:send', { fileId: this.sim.notebookId, threadId: open.threadId, text });
        return;
      }
      log.blockId = q.blockId;
      const answerBlockId = await this.sim.typeParagraph({ insideQBlock: q.blockId, text });
      const { docId } = this.sim.doc();
      const result = await this.sim.call<NotesAnswerQuestionResult>('notes:answerQuestion', {
        fileId: this.sim.notebookId,
        docId,
        questionId: open.quiz.questionId,
        qBlockId: q.blockId,
        askedBy: 'max',
        question: q.question,
        answerBlockId,
        answer: text,
      });
      if (!result.accepted) {
        log.refused = `Submit refused (${result.reason ?? 'refused'}): answered in the chat`;
        log.kind = 'answer_chat';
        await this.sim.call('chat:send', { fileId: this.sim.notebookId, threadId: open.threadId, text });
      }
    });
  }

  /** Hint or Show me on the open question, as the rail's buttons send them. */
  press(kind: 'hint' | 'show_me', opts: { why?: string; by?: string } = {}): Promise<MoveLog> {
    return this.#run(kind, { why: opts.why, by: opts.by }, async (log) => {
      const open = await this.openQuestion();
      const roomId = this.sim.roomId();
      if (!open || !roomId) {
        log.refused = 'no open question';
        return;
      }
      log.threadId = open.threadId;
      const result = await this.sim.call<{ hinted?: boolean; released?: boolean; refused?: string | null }>(
        kind === 'hint' ? 'quiz:hint' : 'quiz:pass',
        { roomId, threadId: open.threadId },
      );
      if (result && (result.hinted === false || result.released === false)) log.refused = result.refused ?? 'refused';
    });
  }

  /** Quiz me on a line. */
  quizMe(needle: string, opts: { why?: string; by?: string } = {}): Promise<MoveLog> {
    const block = lineOf(this.sim, needle);
    return this.#run('quiz_me', { blockId: block.blockId, line: block.text, why: opts.why, by: opts.by }, async (log) => {
      const { docId } = this.sim.doc();
      const started = await this.sim.call<NotesBlockActionResult>('notes:blockAction', {
        fileId: this.sim.notebookId,
        docId,
        blockId: block.blockId,
        kind: 'quiz',
        quote: block.text,
      });
      log.threadId = started.threadId ?? null;
      if (!started.accepted) log.refused = started.reason ?? 'refused';
    });
  }

  /** The learner types a paragraph of their own into the notes, after a line. Returns its block id. */
  async note(needle: string, text: string, opts: { why?: string; by?: string } = {}): Promise<{ log: MoveLog; blockId: string | null }> {
    const block = lineOf(this.sim, needle);
    let written: string | null = null;
    const log = await this.#run('note', { text, blockId: block.blockId, line: block.text, why: opts.why, by: opts.by }, async () => {
      written = await this.sim.typeParagraph({ afterBlockId: block.blockId, text });
    });
    if (written) log.blockId = written;
    return { log, blockId: written };
  }
}
