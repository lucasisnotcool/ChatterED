/**
 * **The chat column's arithmetic** (#48, `docs/research/collab-doc.md` §4), out of the components
 * and under test — `flowchat.ts`'s argument, applied to the collab doc's three channels.
 *
 * Everything here is a pure function over a snapshot the main process sent. Nothing reaches the
 * bridge, holds a timer or knows what a DOM node is: `chatstore.svelte.ts` does the first two and
 * the components do the third.
 *
 * The three things worth testing without a browser, and the reason each is here rather than in
 * markup:
 *
 *  - **which thread a `chat.thread` event replaces** — the doc chat, a span thread and two
 *    private threads all ride one event, and merging on the wrong key silently duplicates a
 *    conversation;
 *  - **what the composer is asking for** — §4.4's Pass control and the "say I don't know"
 *    line appear exactly when Max has an open question, and a composer that goes on asking for
 *    an attempt after the answer was released has quietly repealed the rule;
 *  - **which turns are tagged**, including *Ellie's guess* (§4.3), which is the one turn in the
 *    app that may contain a mistake on purpose and must never be read as an answer.
 */
import type { AgentAuthor, DocQuizView, ThreadKind, ThreadView } from '../../shared/doc/types.js';
import { DOC_ANCHOR_ID } from '../../shared/doc/types.js';
import { parseMention } from '../../shared/doc/mention.js';
import type { MessageView } from '../../shared/types.js';

// ── who is speaking ─────────────────────────────────────────────────────────────────────────

/**
 * The two agents' hues, and the only place the collab doc names them.
 *
 * They are the tokens `styles/app.css` already defines for the Teacher and the Tester, so the
 * chat column, the doc's agent cursors and the agent's own edits are the same green and the same
 * red — brief §0 ("Ellie (green) and Max (red)") is one colour per agent across two surfaces, not
 * two surfaces that happen to agree.
 */
export const AGENT_HUE: Record<AgentAuthor, string> = {
  ellie: 'var(--peer)',
  max: 'var(--challenger)',
};

export const AGENT_NAME: Record<AgentAuthor, string> = { ellie: 'Ellie', max: 'Max' };
export const AGENT_ROLE_WORD: Record<AgentAuthor, string> = { ellie: 'teacher', max: 'tester' };

/**
 * Which agent wrote a message, or null for the learner and the REFERENCE voice.
 *
 * Read off the **role**, not the name: #32 pinned the pairing (one Teacher, one Tester) and left
 * the names as data, and `labels.ts` has made the same argument since the room shipped.
 */
export function agentOf(message: MessageView): AgentAuthor | null {
  if (message.speaker.kind !== 'agent') return null;
  if (message.speaker.role === 'peer') return 'ellie';
  if (message.speaker.role === 'challenger') return 'max';
  return null;
}

// ── mentions (§4.2) ─────────────────────────────────────────────────────────────────────────

/**
 * `@Ellie …` / `@Max …` — **the real rule, re-exported, never a second copy of it.**
 *
 * The mention that matters is the one the actor parses in the main process, and `parseMention`
 * is `shared/doc/mention.ts`'s: it is what decides whether Max gets a follow-up. The composer
 * needs the same answer *before* the round trip — to say "Ellie only" under the box — and two
 * regexes that agree today would not agree in a month. There is one, and this is a door to it.
 */
export { parseMention };

export type MentionPiece = { kind: 'text'; text: string } | { kind: 'mention'; text: string; agent: AgentAuthor };

/**
 * The composer's text, split so a recognised mention can be drawn as a coloured token.
 *
 * Every mention is tokenised, not only the first: the rule is that the first one wins, and a
 * composer that coloured only the first would be telling the learner the second was not a
 * mention at all, which is a different and untrue statement.
 */
export function mentionPieces(text: string): MentionPiece[] {
  const out: MentionPiece[] = [];
  const re = /@(ellie|max)\b/gi;
  let last = 0;
  for (const match of text.matchAll(re)) {
    const at = match.index;
    if (at > last) out.push({ kind: 'text', text: text.slice(last, at) });
    out.push({ kind: 'mention', text: match[0], agent: match[1]!.toLowerCase() as AgentAuthor });
    last = at + match[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

/** The `@` autocomplete: is the caret sitting in a half-typed mention, and on what? */
export function mentionQuery(text: string, caret: number): { from: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  const query = before.slice(at + 1);
  if (/[^a-z]/i.test(query)) return null;
  // A mention starts a word: `me@you` is an address, not a mention.
  const prev = at === 0 ? ' ' : before[at - 1]!;
  if (!/\s/.test(prev)) return null;
  return { from: at, query: query.toLowerCase() };
}

export function mentionMatches(query: string): AgentAuthor[] {
  return (['ellie', 'max'] as AgentAuthor[]).filter((a) => a.startsWith(query));
}

// ── threads ─────────────────────────────────────────────────────────────────────────────────

/**
 * Take one `chat.thread` into the list, replacing the thread with the same id and keeping deck
 * order otherwise (the doc chat first, then span threads oldest first, then the private ones —
 * which are never in this list; they are addressed by agent).
 *
 * Replaces rather than merges: the event carries the whole `ThreadView`, and a renderer that
 * merged fields would have to decide which of its own it trusted more than the main process's.
 */
export function mergeThread(threads: readonly ThreadView[], next: ThreadView): ThreadView[] {
  const at = threads.findIndex((t) => t.threadId === next.threadId);
  if (at < 0) return [...threads, next];
  const out = [...threads];
  out[at] = next;
  return out;
}

export function threadsOfKind(threads: readonly ThreadView[], kind: ThreadKind): ThreadView[] {
  return threads.filter((t) => t.kind === kind);
}

export function findThread(threads: readonly ThreadView[], threadId: string): ThreadView | null {
  return threads.find((t) => t.threadId === threadId) ?? null;
}

/** The doc chat, which always exists once the room does. */
export function docThread(threads: readonly ThreadView[]): ThreadView | null {
  return threads.find((t) => t.threadId === DOC_ANCHOR_ID || t.kind === 'doc') ?? null;
}

/**
 * How many turns in this thread the learner has not seen.
 *
 * The learner's own turns never count — an unread badge on your own sentence is noise — and
 * neither does anything at or below `lastSeenSeq`, which is the main process's record of what
 * was on screen. Same rule as the flow's card strip (audit §7), on a thread instead of a card.
 */
export function unreadCount(thread: ThreadView, messages: readonly MessageView[]): number {
  let n = 0;
  for (const m of messages) {
    if (m.anchorId !== thread.threadId) continue;
    if (m.speaker.kind === 'student') continue;
    if (m.seq > thread.lastSeenSeq) n += 1;
  }
  return n;
}

/**
 * The messages of one thread, in order.
 *
 * Matched on the anchor **exactly**, with no fallback for a message that carries none: an
 * un-anchored message belongs to some other room's stream (the shipped chat room, a nudge on a
 * session that is not this document), and letting those fall through to the doc chat is how a
 * conversation about another deck ends up under this one.
 */
export function messagesOf(threadId: string, messages: readonly MessageView[]): MessageView[] {
  return messages.filter((m) => m.anchorId === threadId);
}

// ── the composer, while a question is open (§4.2, §4.4) ─────────────────────────────────────

export const ASK_PLACEHOLDER = 'Ask about this document…';
export const ATTEMPT_PLACEHOLDER = 'Your answer…';
export const NEXT_ATTEMPT_PLACEHOLDER = 'Your next attempt…';

export interface ChatComposer {
  placeholder: string;
  /** The quiet line under the box, or null. */
  note: string | null;
  /** §4.4's control. Offered exactly while a question is open and unreleased. */
  pass: boolean;
  /** True while Max's question is open: the box is answering, not asking. */
  answering: boolean;
  /**
   * **Pass reads "Show me"**, emphasised (2026-10-06, D3; `FlowQuizView.showMe`): Max has offered
   * the answer, after a second answer that was not *Well done* or after a guess. The same control
   * and the same release; only its words and weight change, because now it is the way on.
   */
  showMe: boolean;
}

/**
 * What the composer is asking for, from the thread's quiz alone.
 *
 * Four states, and the line under the box is the whole of §4.4's disclosure: the learner is told
 * *before* they are stuck that saying "I don't know" is a way out, because the rule that a
 * give-up releases the answer and lowers the next question is a design decision they should be
 * able to use on purpose rather than discover by frustration.
 */
export function chatComposer(quiz: DocQuizView | null | undefined, testerName = 'Max'): ChatComposer {
  if (!quiz || !quiz.open) {
    return { placeholder: ASK_PLACEHOLDER, note: null, pass: false, answering: false, showMe: false };
  }
  const verdict = quiz.feedbackGiven ? (quiz.verdict ?? null) : null;
  if (quiz.showMe === true) {
    // Max has stopped asking smaller (D3): the way on is his answer, so Pass says so.
    return {
      placeholder: verdict === 'partial' ? NEXT_ATTEMPT_PLACEHOLDER : ATTEMPT_PLACEHOLDER,
      note: `Press Show me and ${testerName} will give the answer, or have one more go here.`,
      pass: true,
      answering: true,
      showMe: true,
    };
  }
  if (verdict === 'partial') {
    return {
      placeholder: NEXT_ATTEMPT_PLACEHOLDER,
      note: `${testerName} asked a follow-up on the same question. Answer it here.`,
      pass: true,
      answering: true,
      showMe: false,
    };
  }
  return {
    placeholder: ATTEMPT_PLACEHOLDER,
    note: `Say *I don't know* or press Pass and ${testerName} will give the answer.`,
    pass: true,
    answering: true,
    showMe: false,
  };
}

/**
 * **Where the composer sends** (2026-10-04). The span thread the learner is replying in, while it
 * still exists; else Max's open question; else the notebook chat. `answering` is true only when
 * the words go to the thread whose question is open, so the composer turns into *Your answer…*
 * with **Pass** there and nowhere else.
 */
export function composeTarget(input: {
  replyTo: string | null;
  spanThreadIds: readonly string[];
  openQuizThreadId: string | null;
  docThreadId: string;
}): { threadId: string; replying: boolean; answering: boolean } {
  const replying = input.replyTo !== null && input.spanThreadIds.includes(input.replyTo);
  const threadId = replying ? input.replyTo! : (input.openQuizThreadId ?? input.docThreadId);
  return { threadId, replying, answering: input.openQuizThreadId !== null && threadId === input.openQuizThreadId };
}

/** The composer's placeholder while it replies in a span thread that has no question open. */
export const REPLY_PLACEHOLDER = 'Reply in this thread…';

// ── the tags on a turn (§4.2's rule column, §4.3's cue) ─────────────────────────────────────

export interface ChatTag {
  label: string;
  title: string;
  /** `guess` is drawn differently: it is the one turn that may be wrong on purpose. */
  kind: 'rule' | 'guess';
}

/**
 * **Which rule decided this turn** (§4.2: "all of the above are rules in the orchestrator,
 * decided in code before any model is consulted").
 *
 * The brief's whole claim about the conversation is that the app's behaviour is a rule the
 * learner can see, so the tag is not decoration: it is the evidence for the claim. `quiz.ts`'s
 * `ruleTag()` made the same argument for the two decisions #47 nominated, and deliberately left
 * the ordinary course of the loop untagged; the same restraint applies here, which is why
 * `rule:ellie_answers` and `rule:quiz_feedback` are **not** in this table. A tag on every turn
 * is a tag on nothing.
 */
const TAGS: Record<string, ChatTag> = {
  'rule:ellie_cue': {
    label: "Ellie's guess — she might be wrong",
    title:
      "A rule fired because the question had waited: Ellie offers a partial, unsure take as a peer. It is not the answer, it is not checked, and it is never written into the document.",
    kind: 'guess',
  },
  'rule:max_prompt': {
    label: 'by rule · prompt',
    title:
      "Max neither confirms nor corrects Ellie's guess yet — the rule asks him to name the part worth looking at and hand it back to you.",
    kind: 'rule',
  },
  'rule:answer_released': {
    label: 'answer released · fills nothing',
    title:
      'You said you were stuck, so the rule released the full answer. It is logged, it moves nothing on your progress, and the next question on this objective is pitched lower.',
    kind: 'rule',
  },
  'rule:closure': {
    label: 'closed out · nothing left hanging',
    title:
      '§4.7: no question Max asked is left without its answer. The session went idle, so he answered his own question.',
    kind: 'rule',
  },
  'rule:max_followup': {
    label: 'by rule · follow-up',
    title:
      "Ellie answered, so the rule gives Max the floor for one question. It is not a model deciding to quiz you.",
    kind: 'rule',
  },
  'rule:hint_requested': {
    label: 'hint you asked for · not a try',
    title:
      'You pressed Hint on the question, so Max gave one hint. It is not counted as a try, and the question is still yours to answer.',
    kind: 'rule',
  },
  'rule:mention': {
    label: 'by rule · you asked them',
    title: 'You named one of them, so only that one answered and no follow-up was scheduled.',
    kind: 'rule',
  },
};

export function chatTag(decidedBy: string | null | undefined): ChatTag | null {
  if (!decidedBy) return null;
  return TAGS[decidedBy] ?? null;
}

/** §4.3's cue, which gets a treatment of its own rather than a tag beside the body. */
export function isEllieGuess(message: Pick<MessageView, 'decidedBy'>): boolean {
  return message.decidedBy === 'rule:ellie_cue';
}

// ── the tab strip ───────────────────────────────────────────────────────────────────────────

export type ChatTab = 'doc' | 'ellie' | 'max';

export interface TabView {
  key: ChatTab;
  label: string;
  /** Unread turns behind this tab. The dot is drawn from it; the number is its `title`. */
  unread: number;
  hue: string | null;
}

export function tabs(input: {
  threads: readonly ThreadView[];
  messages: readonly MessageView[];
  privateUnread: Record<string, number>;
}): TabView[] {
  const shared = input.threads
    .filter((t) => t.kind === 'doc' || t.kind === 'span')
    .reduce((n, t) => n + unreadCount(t, input.messages), 0);
  return [
    { key: 'doc', label: 'Doc chat', unread: shared, hue: null },
    { key: 'ellie', label: 'Ellie', unread: input.privateUnread.ellie ?? 0, hue: AGENT_HUE.ellie },
    { key: 'max', label: 'Max', unread: input.privateUnread.max ?? 0, hue: AGENT_HUE.max },
  ];
}
