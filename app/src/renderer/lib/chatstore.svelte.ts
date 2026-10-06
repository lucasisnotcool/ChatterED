/**
 * The chats' renderer state (#48, `docs/research/collab-doc.md` §4). **Track T5 owns this file.**
 *
 * Three channels in one column — the doc chat with its span threads, and one private thread per
 * agent — plus everything a turn needs on its way to the screen: the optimistic block, the
 * thinking indicator, the stream, and the failure card.
 *
 * **It holds nothing authoritative.** Every field is either a snapshot the main process sent or
 * a local view preference, which is `store.svelte.ts`'s own rule and the reason the quiz state
 * lives on `ThreadView` rather than being inferred here: whether Max's question is open is the
 * orchestrator's decision, and a renderer that recomputed it could quietly repeal §4.4.
 *
 * **Why it does not import `store.svelte.ts`.** That module imports this one (it hosts
 * `store.chat`), and a cycle through a `$state` class is a cycle that bites at module-init time.
 * So the turn events this column draws — `message.appended`, `turn.delta`, `agent.thinking`,
 * `turn.failed` — are applied here as well as there, off the one `RoomEvent` stream the frozen
 * store forwards to `apply()`. They are cheap reducers over events this column would otherwise
 * have to reach across a cycle for.
 *
 * The agreed cross-track surface (`app/docs/COLLAB-CONTRACT.md`):
 *   - T4 → here: `openSpanThread({ blockId, quote })` on Ctrl+E, `focusThread(threadId)` on a
 *     highlight click, and `spanThreads` to draw the highlights.
 *   - here → T4: `store.doc.scrollToBlock(blockId)` and `store.doc.caretBlockId()`, both called
 *     from the components rather than from here, because where the document goes is T4's.
 */

import { bridge } from './bridge.js';
import { ackIndex, appendDelta, nextSendId, type PendingSend, type StreamState } from './flowchat.js';
import { mergeThread, type ChatTab } from './chatview.js';
import { DOC_ANCHOR_ID, type AgentAuthor, type DocQuizView, type PrivateTurnView, type ThreadView } from '../../shared/doc/types.js';
import type { MessageView, RoomEvent, ThinkingView, TurnFailureView } from '../../shared/types.js';

/** One agent's private thread, and what the tab needs to know about it (§4.1). */
interface PrivateChannel {
  threadId: string | null;
  turns: PrivateTurnView[];
  /** A turn is in flight — the agent's own latency floor, drawn inside the thread. */
  thinking: boolean;
  /** Agent turns that have arrived while this tab was not the one on screen. */
  unread: number;
  opening: boolean;
}

function emptyChannel(): PrivateChannel {
  return { threadId: null, turns: [], thinking: false, unread: 0, opening: false };
}

/**
 * A span thread the learner has opened but not yet sent into (the contract's Ctrl+E decision).
 *
 * It is a **draft**: the quoted span is in the chat column, focused, with the composer under it,
 * and no thread exists in the main process until the learner sends. That is what keeps a
 * highlight-and-think-better-of-it from leaving an empty conversation in the document's record.
 */
export interface DraftSpan {
  blockId: string;
  quote: string;
  /** A tutorial's content key, when the line is on a tutorial sheet (`tutorialContentKey`). */
  docKey?: string;
}

export class ChatStore {
  fileId: string | null = $state(null);
  roomId: string | null = $state(null);
  /**
   * **The tutorial as the main view** (2026-10-04, `tutorials.md` §2): the tutorial the learner has
   * in the middle column, set by the shell; null with the notes there. Sent with every message and
   * Ask…, so main tells the turn about the sheet and the lecture notes behind it.
   */
  mainTutorial: string | null = $state(null);

  /** The doc chat and its span threads. Private threads are not in here; they are addressed by agent. */
  threads: ThreadView[] = $state([]);
  /** Every message of this file's room, in arrival order. The column filters by anchor. */
  messages: MessageView[] = $state([]);
  failures: TurnFailureView[] = $state([]);
  thinking: ThinkingView | null = $state(null);
  stream: StreamState | null = $state(null);
  /** *The room has your message* — neutral, un-attributed, and capped (`flowchat.ts`). */
  receivedAt: number | null = $state(null);
  receivedAnchor: string | null = $state(null);
  /** The learner's turns between the keystroke and the echo (audit Fact 1). */
  pending: PendingSend[] = $state([]);
  /** The anchor the learner last sent to: where the wait is drawn before a turn has an anchor. */
  lastSendAnchor: string | null = $state(null);

  tab: ChatTab = $state('doc');
  /** The thread to bring into view; cleared by the component once it has scrolled. */
  focusRequest: { threadId: string; token: number } | null = $state(null);
  draft: DraftSpan | null = $state(null);
  /**
   * **The span thread the composer replies in** (2026-10-04), or null for the notebook chat.
   *
   * A span thread had no way to be answered: the one composer sent to the doc chat unless a quiz
   * was open, so when Max ended a tutorial hint with a question ("which actions have their
   * preconditions met?"), the learner's answer went to the notebook chat, away from the part it
   * was about. It is set by a card's **Reply here** and whenever a thread is brought into view
   * (`focusThread`: a tutorial Help or Check landing, a Ctrl+E thread just created, a highlight
   * clicked), and the composer says so with a chip that clears it.
   */
  replyTo: string | null = $state(null);
  draftBusy = $state(false);
  passing = $state(false);
  /** The private turn whose **Insert into the document** is in flight. */
  inserting: string | null = $state(null);

  /** Rooms this window reset (`reset()`); their late events are dropped in `apply`. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a bookkeeping set, never rendered
  #retiredRooms = new Set<string>();

  ellie: PrivateChannel = $state(emptyChannel());
  max: PrivateChannel = $state(emptyChannel());

  /** Local `lastSeenSeq` per thread, ahead of the main process's own record. */
  seen: Record<string, number> = $state({});

  // ── what other tracks read ────────────────────────────────────────────────────────────────

  /** T4 draws a highlight per span thread, and clicking one calls `focusThread`. */
  get spanThreads(): { threadId: string; blockId: string; quote: string }[] {
    return this.threads
      .filter((t) => t.kind === 'span' && t.blockId !== null)
      .map((t) => ({ threadId: t.threadId, blockId: t.blockId!, quote: t.quote ?? '' }));
  }

  get docThreadId(): string {
    return this.threads.find((t) => t.kind === 'doc')?.threadId ?? DOC_ANCHOR_ID;
  }

  /**
   * Max's open question, and the thread it is in. **One per file** (§4.2), so this is a single
   * value rather than a map: two open questions would be a bug in the main process, and the
   * composer would have to pick one anyway.
   */
  get openQuiz(): { threadId: string; quiz: DocQuizView } | null {
    for (const t of this.threads) {
      if (t.quiz?.open) return { threadId: t.threadId, quiz: t.quiz };
    }
    return null;
  }

  channel(agent: AgentAuthor): PrivateChannel {
    return agent === 'ellie' ? this.ellie : this.max;
  }

  // ── opening and closing a file ────────────────────────────────────────────────────────────

  /**
   * Read the file's threads. **Creates nothing**: `chat:threads` never opens a room, so a deck
   * that has never been asked a question comes back `{ roomId: null, threads: [] }` and the
   * column draws an empty composer rather than a spinner.
   */
  async open(fileId: string): Promise<void> {
    if (this.fileId === fileId) return;
    this.close();
    this.fileId = fileId;
    const view = await bridge()
      .chatThreads({ fileId })
      .catch(() => null);
    if (!view || this.fileId !== fileId) return;
    this.roomId = view.roomId;
    this.threads = [...view.threads];
    if (view.roomId) await this.#loadRoom(view.roomId);
  }

  /**
   * The transcript behind the threads.
   *
   * `ThreadView` carries message **ids**, not bodies — the bodies live on the room snapshot, and
   * two copies of a turn could disagree. `openRoom` is the shipped channel that returns them,
   * along with the failures and whatever is thinking right now, so a column opened mid-turn is
   * not blank until the next event.
   */
  async #loadRoom(roomId: string): Promise<void> {
    const snapshot = await bridge()
      .openRoom(roomId)
      .catch(() => null);
    if (!snapshot || this.roomId !== roomId) return;
    this.messages = [...snapshot.messages];
    this.failures = [...snapshot.failures];
    this.thinking = snapshot.thinking;
  }

  /**
   * **New Conversation** (2026-09-23): the doc-chat header button and the File menu item. Main
   * asks the learner to confirm and retires the room; this then reads the file again, which comes
   * back with no room — the empty doc chat — until the next message opens a fresh one.
   * Returns a line for the learner when it failed, or null.
   */
  async reset(): Promise<string | null> {
    const fileId = this.fileId;
    const roomId = this.roomId;
    if (!fileId || !roomId) return null;
    let result;
    try {
      result = await bridge().chatReset({ fileId });
    } catch (err) {
      return message(err);
    }
    if (!result.reset || this.fileId !== fileId) return null;
    this.#retiredRooms.add(roomId);
    this.close();
    await this.open(fileId);
    return null;
  }

  close(): void {
    this.fileId = null;
    this.roomId = null;
    this.threads = [];
    this.messages = [];
    this.failures = [];
    this.thinking = null;
    this.stream = null;
    this.receivedAt = null;
    this.receivedAnchor = null;
    this.pending = [];
    this.lastSendAnchor = null;
    this.tab = 'doc';
    this.draft = null;
    this.replyTo = null;
    this.focusRequest = null;
    this.seen = {};
    // Closing the document ends both private threads. They are not restored on reopen, and the
    // main process has nothing to restore them from — that is the point of a private channel.
    this.ellie = emptyChannel();
    this.max = emptyChannel();
  }

  // ── the doc chat ──────────────────────────────────────────────────────────────────────────

  /**
   * Send into a thread.
   *
   * The optimistic block exists from the keystroke and is dropped by its own echo (`ackIndex`),
   * so a rejected send leaves the learner's words on screen with a Retry rather than in a
   * dismissible banner with no anchor (audit §3). Deliberately not awaited by callers: the call
   * resolves when the room *has* the message, not when anyone has answered it.
   */
  send(threadId: string, text: string): string | null {
    const fileId = this.fileId;
    const body = text.trim();
    if (!fileId || body.length === 0) return null;
    const id = nextSendId();
    this.lastSendAnchor = threadId;
    this.pending = [...this.pending, { id, anchorId: threadId, body, state: 'pending', at: Date.now(), error: null }];
    void bridge()
      .chatSend({ fileId, threadId, text: body, ...this.#main() })
      .then((result) => {
        this.roomId = result.roomId;
      })
      .catch((err: unknown) => this.failSend(id, message(err)));
    return id;
  }

  /** `{ mainTutorial }` while the tutorial is the main view, else nothing (the call is as it was). */
  #main(): { mainTutorial?: string } {
    return this.mainTutorial ? { mainTutorial: this.mainTutorial } : {};
  }

  failSend(id: string, reason: string): void {
    this.pending = this.pending.map((p) => (p.id === id ? { ...p, state: 'failed' as const, error: reason } : p));
  }

  retrySend(id: string): void {
    const entry = this.pending.find((p) => p.id === id);
    if (!entry) return;
    this.pending = this.pending.filter((p) => p.id !== id);
    this.send(entry.anchorId, entry.body);
  }

  dropSend(id: string): void {
    this.pending = this.pending.filter((p) => p.id !== id);
  }

  // ── span threads (Ctrl+E is T4's keybinding; this is the other half) ─────────────────────

  /**
   * **Ctrl+E on a highlighted span.** Opens a *draft* thread in the chat column: the quote as a
   * chip, focused, with the composer under it. No thread is created until the learner sends —
   * `chat:openSpan` takes the question, so there is no such thing as an empty span thread.
   */
  openSpanThread(input: { blockId: string; quote: string; docKey?: string }): void {
    this.tab = 'doc';
    this.replyTo = null;
    // `docKey`: a line of a tutorial sheet, whose thread is on the tutorial's document (S7).
    this.draft = { blockId: input.blockId, quote: input.quote.trim(), ...(input.docKey ? { docKey: input.docKey } : {}) };
  }

  cancelDraft(): void {
    this.draft = null;
  }

  /** The draft's first send: it is what creates the thread. */
  async sendDraft(question: string): Promise<string | null> {
    const fileId = this.fileId;
    const draft = this.draft;
    const body = question.trim();
    if (!fileId || !draft || body.length === 0) return null;
    this.draftBusy = true;
    const result = await bridge()
      .chatOpenSpan({
        fileId,
        blockId: draft.blockId,
        quote: draft.quote,
        question: body,
        ...(draft.docKey ? { docKey: draft.docKey } : {}),
        ...this.#main(),
      })
      .catch(() => null);
    this.draftBusy = false;
    if (!result) return null;
    this.roomId = result.roomId;
    this.draft = null;
    this.lastSendAnchor = result.threadId;
    this.focusThread(result.threadId);
    /**
     * **Read the thread back, because only main knows what it is.**
     *
     * The turn's own messages arrive on the event stream and a thread is synthesised for their
     * anchor, which is enough to draw the conversation and nothing else: `blockId` and `quote`
     * live in the registry row `chat:openSpan` has just written. Without this the span card's
     * header reads "a line in the document" instead of the learner's own words, and — the part
     * that matters — `store.chat.spanThreads` hands T4 an empty quote, so `spanHighlights` skips
     * it and §3's "the span keeps a highlight that jumps to its thread" never happens. Found in
     * the live run of 20 Sep, where the highlight was simply absent.
     */
    await this.#refreshThreads();
    return result.threadId;
  }

  /**
   * The registry's view of every thread on this file, merged over what is already here.
   *
   * Separate from `open()` because `open()` is a *first* load — it clears the column and pulls
   * the room snapshot — and this is a top-up after something created a thread, with the
   * transcript already on screen.
   */
  async #refreshThreads(): Promise<void> {
    const fileId = this.fileId;
    if (!fileId) return;
    const view = await bridge()
      .chatThreads({ fileId })
      .catch(() => null);
    if (!view || this.fileId !== fileId) return;
    this.roomId = view.roomId ?? this.roomId;
    for (const thread of view.threads) this.threads = mergeThread(this.threads, thread);
  }

  /** Bring a thread into view — a highlight click in the document, or a card's own header. */
  focusThread(threadId: string): void {
    this.tab = 'doc';
    // The thread just brought into view is the conversation now: the next words go to it.
    this.replyTo = threadId === this.docThreadId ? null : threadId;
    this.focusRequest = { threadId, token: (this.focusRequest?.token ?? 0) + 1 };
  }

  /** A card's **Reply here**: the composer answers in that thread (and a half-asked draft goes). */
  replyIn(threadId: string): void {
    this.draft = null;
    this.focusThread(threadId);
  }

  /** The chip's ✕, or Esc: back to the notebook chat. */
  clearReply(): void {
    this.replyTo = null;
  }

  focusDocChat(): void {
    this.tab = 'doc';
    this.replyTo = null;
    this.focusRequest = { threadId: this.docThreadId, token: (this.focusRequest?.token ?? 0) + 1 };
  }

  /**
   * Seen. Kept locally: the unread dot has to clear the moment the thread is on screen, and
   * there is no `chat:*` channel that records it — `lastSeenSeq` arrives on `ThreadView` and
   * this is the renderer running ahead of it, never behind.
   */
  markSeen(threadId: string, seq: number): void {
    if ((this.seen[threadId] ?? 0) >= seq) return;
    this.seen = { ...this.seen, [threadId]: seq };
    this.threads = this.threads.map((t) =>
      t.threadId === threadId ? { ...t, lastSeenSeq: Math.max(t.lastSeenSeq, seq) } : t,
    );
  }

  // ── §4.4's Pass ───────────────────────────────────────────────────────────────────────────

  /**
   * **Pass** — the control beside the give-up phrases, and the same release.
   *
   * Refused by the main process if no question is open, and the refusal is shown rather than
   * swallowed: a Pass that silently does nothing is the failure the control exists to avoid.
   */
  async pass(): Promise<string | null> {
    const open = this.openQuiz;
    const roomId = this.roomId;
    if (!open || !roomId) return 'No question is open.';
    this.passing = true;
    const result = await bridge()
      .quizPass({ roomId, threadId: open.threadId })
      .catch(() => ({ released: false, refused: 'The app could not reach the room.' }));
    this.passing = false;
    return result.released ? null : result.refused;
  }

  /**
   * **Hint or Show me on Max's open question, from the rail** (decision 7, 6 Oct 2026 afternoon).
   * Show me is Pass by another name (`quiz:pass`); Hint is `quiz:hint`, one plain hint from Max.
   * Either way the learner is taken to the question's thread, where Max's turn lands.
   */
  async questionHelp(kind: 'hint' | 'show', questionId: string): Promise<string | null> {
    const open = this.openQuiz;
    const roomId = this.roomId;
    if (!open || !roomId || (open.quiz.questionId && open.quiz.questionId !== questionId)) return 'This question is closed.';
    this.focusThread(open.threadId);
    if (kind === 'show') return this.pass();
    const result = await bridge()
      .quizHint({ roomId, threadId: open.threadId })
      .catch(() => ({ hinted: false, refused: 'The app could not reach the room.' }));
    return result.hinted ? null : result.refused;
  }

  // ── private threads (§4.1) ────────────────────────────────────────────────────────────────

  async openPrivate(agent: AgentAuthor): Promise<void> {
    const fileId = this.fileId;
    const channel = this.channel(agent);
    this.tab = agent;
    channel.unread = 0;
    if (!fileId || channel.threadId || channel.opening) return;
    channel.opening = true;
    const result = await bridge()
      .chatPrivateOpen({ fileId, agent })
      .catch(() => null);
    channel.opening = false;
    if (!result) return;
    this.roomId = result.roomId;
    channel.threadId = result.threadId;
    channel.turns = [...result.turns];
  }

  sendPrivate(agent: AgentAuthor, text: string): void {
    const roomId = this.roomId;
    const channel = this.channel(agent);
    const body = text.trim();
    if (!roomId || !channel.threadId || body.length === 0) return;
    channel.thinking = true;
    // Optimistic, like the doc chat's: the learner's words are on screen from the keystroke. The
    // echo arrives as a `chat.private` turn and replaces this one by id.
    channel.turns = [
      ...channel.turns,
      {
        id: `local-${nextSendId()}`,
        role: 'learner',
        agentKey: agent,
        text: body,
        createdAt: nowIso(),
        insertedEditId: null,
      },
    ];
    void bridge()
      .chatPrivateSend({ roomId, threadId: channel.threadId, text: body })
      .catch(() => {
        channel.thinking = false;
      });
  }

  /**
   * **Insert into the document** — the whisper's one path from private to shared, kept (§4.1).
   *
   * `anchorBlockId` is where the learner's caret is, asked of T4 at the moment of the click:
   * the learner is saying *put it here*, and "here" is wherever they were reading.
   */
  async insertIntoDoc(input: { agent: AgentAuthor; turnId: string; anchorBlockId: string | null }): Promise<boolean> {
    const roomId = this.roomId;
    const channel = this.channel(input.agent);
    if (!roomId || !channel.threadId) return false;
    this.inserting = input.turnId;
    const result = await bridge()
      .chatInsertIntoDoc({
        roomId,
        threadId: channel.threadId,
        turnId: input.turnId,
        anchorBlockId: input.anchorBlockId,
      })
      .catch(() => ({ editId: null }));
    this.inserting = null;
    return result.editId !== null;
  }

  // ── the turn in flight ────────────────────────────────────────────────────────────────────

  /** **Stop**, offered only once the floor has elapsed (`stopAllowed`, drawn by the component). */
  async stop(): Promise<void> {
    const roomId = this.roomId;
    const turnId = this.stream?.turnId ?? null;
    if (!roomId || !turnId) return;
    await bridge()
      .flowStop({ roomId, turnId })
      .catch(() => null);
  }

  async retry(failureId: string): Promise<void> {
    const roomId = this.roomId;
    if (!roomId) return;
    await bridge()
      .retryTurn({ roomId, failureId })
      .catch(() => null);
  }

  // ── the event stream ──────────────────────────────────────────────────────────────────────

  /**
   * Every `RoomEvent`, forwarded by the frozen store before its own switch.
   *
   * Guarded on the file, not on the room: `chat.thread` and `progress.updated` can arrive for a
   * document the learner has since closed, and a thread from another deck appearing in this
   * column is the bug `loadFlow` had to be taught to avoid.
   */
  apply(e: RoomEvent): void {
    // A reset room can still emit on its way down (a cancelled turn clearing its indicator, a
    // delta already in the pipe). None of it belongs to the conversation on screen now.
    if ('roomId' in e && typeof e.roomId === 'string' && this.#retiredRooms.has(e.roomId)) return;
    switch (e.type) {
      case 'chat.thread': {
        // A span thread can appear that the learner never opened: `notes:docText` reuses (or
        // creates) the span thread on the block they were writing in, and Max's feedback lands
        // there. An unknown thread is added, never dropped.
        this.threads = mergeThread(this.threads, e.thread);
        this.roomId = e.roomId;
        break;
      }
      case 'chat.private': {
        const agent = this.#agentOfThread(e.threadId);
        if (!agent) break;
        const channel = this.channel(agent);
        const turns = channel.turns.filter(
          // Drop the optimistic copy of the learner's own turn once the real one arrives.
          (t) => !(t.id.startsWith('local-') && t.role === 'learner' && t.text === e.turn.text),
        );
        const at = turns.findIndex((t) => t.id === e.turn.id);
        if (at >= 0) turns[at] = e.turn;
        else turns.push(e.turn);
        channel.turns = turns;
        if (e.turn.role === 'agent') {
          channel.thinking = false;
          if (this.tab !== agent) channel.unread += 1;
        }
        break;
      }
      case 'message.appended': {
        // A repeat of an id **replaces** the message rather than being ignored: a block action
        // re-sends Ellie's turn with the same id once its doc line has landed, with the sentence
        // naming the edit appended (`notebooks.md` §4.2, N3). Span threads read this same list.
        this.messages = this.messages.some((m) => m.id === e.message.id)
          ? this.messages.map((m) => (m.id === e.message.id ? e.message : m))
          : [...this.messages, e.message];
        const acked = ackIndex(this.pending, e.message);
        if (acked >= 0) this.pending = this.pending.filter((_, i) => i !== acked);
        // A landing agent turn ends whatever was streaming: one turn is in flight at a time, and
        // a stream that outlived its own message is a blinking duplicate of the card above it.
        if (e.message.speaker.kind !== 'student' && this.stream) this.stream = null;
        break;
      }
      case 'turn.received':
        this.receivedAt = Date.now();
        this.receivedAnchor = e.received.anchorId ?? this.lastSendAnchor;
        this.stream = null;
        break;
      case 'turn.delta':
        this.stream = appendDelta(this.stream, {
          turnId: e.turnId,
          anchorId: e.anchorId,
          agentKey: e.participant.agentKey,
          text: e.text,
        });
        break;
      case 'turn.released':
        if (this.stream?.turnId === e.turnId) this.stream = null;
        this.receivedAt = null;
        break;
      case 'agent.thinking':
        this.thinking = e.thinking;
        break;
      case 'agent.thinking.cleared':
        this.thinking = null;
        break;
      case 'turn.failed':
        if (!this.failures.some((f) => f.id === e.failure.id)) this.failures = [...this.failures, e.failure];
        this.thinking = null;
        this.stream = null;
        this.receivedAt = null;
        break;
      case 'turn.failed.cleared':
        this.failures = this.failures.filter((f) => f.id !== e.failureId);
        break;
      default:
        break;
    }
  }

  #agentOfThread(threadId: string): AgentAuthor | null {
    if (this.ellie.threadId === threadId) return 'ellie';
    if (this.max.threadId === threadId) return 'max';
    return null;
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * A timestamp for the optimistic private turn. Through `toISOString` on a value, rather than a
 * held `Date`: the lint rule against a mutable `Date` in a rune module is about state that
 * could change under the renderer, and this is a string the moment it is written.
 */
function nowIso(): string {
  return new Date(Date.now()).toISOString();
}
