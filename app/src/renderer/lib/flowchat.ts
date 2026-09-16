/**
 * The conversation layer's arithmetic, out of the components and under test
 * (`docs/research/cui-standards-audit.md`).
 *
 * Everything here is a pure function over a snapshot the main process sent plus the renderer's
 * own local send bookkeeping. Nothing in this file reaches the bridge, holds a timer, or knows
 * what a DOM node is — the components do that, and they do nothing else.
 *
 * The audit's three facts are all decisions about *when* something is on screen, so they are all
 * predicates:
 *
 *   - **Fact 1** — a learner turn exists on screen from the keystroke, not from the echo:
 *     `PendingSend` and `ackIndex`.
 *   - **Fact 2** — the wait belongs to the turn's anchor, never to whichever composer happens to
 *     be open: `thinkingAnchor`, and `indicatorMode` / `etaTitle` for Lucas's 2026-09-16 call
 *     (plain dots for the Teacher, elapsed counter for the Tester, the ETA only on hover).
 *   - **Fact 3** — a streamed turn is provisional until `turn.released`: `streamedBody`.
 */
import type { MessageView, ReplySpeed, ThinkingView } from '../../shared/types.js';
import { ts } from './time.js';

/**
 * The floor-yield window, mirrored from `room/actor.ts`. The renderer needs the number only to
 * cap how long the neutral `received` line may sit there if no `agent.thinking` ever arrives —
 * the actor is still the authority, and a `thinking` event always wins.
 */
export const FLOOR_YIELD_MS = 8_000;
/** After a scaffolded fill the actor yields twice as long (`FLOOR_YIELD_AFTER_SCAFFOLD_MS`). */
export const RECEIVED_MAX_MS = 20_000;
/** How close to the bottom of a thread counts as "reading the tail" (`Thread.svelte`'s rule). */
export const TAIL_SLACK_PX = 220;

/**
 * One learner turn between the keystroke and the main process's echo.
 *
 * `id` is a client-side id and never leaves the renderer: the main process assigns the real
 * message id, and matching on *that* is what `ackIndex` is for.
 */
export interface PendingSend {
  id: string;
  anchorId: string;
  body: string;
  state: 'pending' | 'failed';
  at: number;
  error: string | null;
}

let sendSeq = 0;
export function nextSendId(): string {
  sendSeq += 1;
  return `send-${sendSeq}-${Date.now()}`;
}

/**
 * Which pending send this appended message acknowledges, or −1.
 *
 * Matched on the learner's own text under the same anchor rather than on arrival order, because
 * two sends can be in flight at once (the composer does not lock) and acknowledging the wrong
 * one would leave the wrong bubble greyed. Only `pending` entries are eligible: a send the
 * learner has already been told failed must not be silently un-failed by an unrelated echo.
 */
export function ackIndex(pending: readonly PendingSend[], message: MessageView): number {
  if (message.speaker.kind !== 'student') return -1;
  const body = message.body.trim();
  return pending.findIndex(
    (p) => p.state === 'pending' && p.anchorId === (message.anchorId ?? '') && p.body.trim() === body,
  );
}

/** The pending sends belonging to one thread, oldest first. */
export function pendingFor(pending: readonly PendingSend[], anchorId: string): PendingSend[] {
  return pending.filter((p) => p.anchorId === anchorId);
}

/**
 * Where the wait is drawn.
 *
 * The audit's Fact 2: `FlowThread` used to draw it only under `store.composerAt === anchorId`, a
 * single global set by *Explain it back* or *Reply here*, so a nudge landing on another segment
 * rendered the indicator **nowhere at all**. The turn's own anchor is authoritative when the
 * main process ships one; the anchor the learner last sent to is the next best thing, and the
 * open composer is the last resort.
 */
export function thinkingAnchor(
  thinking: (ThinkingView & { anchorId?: string | null }) | null,
  lastSendAnchor: string | null,
  composerAt: string | null,
): string | null {
  if (!thinking) return null;
  return thinking.anchorId ?? lastSendAnchor ?? composerAt;
}

/**
 * Lucas's decision of 2026-09-16, in one function: **plain animated dots for the Teacher, the
 * elapsed counter for the Tester**, and never a countdown. A countdown advertises the delay as
 * scheduled, which is closer to the performative-deliberation line Tan et al. §5.5 warns about
 * than an indicator that simply says something is happening.
 */
export function indicatorMode(thinking: ThinkingView, nowMs: number): 'dots' | 'counter' {
  if (!thinking.showCounter) return 'dots';
  return elapsedMs(thinking, nowMs) >= 3_000 ? 'counter' : 'dots';
}

export function elapsedMs(thinking: ThinkingView, nowMs: number): number {
  return Math.max(0, nowMs - ts(thinking.startedAt));
}

/**
 * The ETA, **on hover only** — `title` text, not a visible countdown. `etaMs` has been computed
 * and shipped since the first build and never read by anything (audit §2).
 */
export function etaTitle(thinking: ThinkingView, nowMs: number): string {
  const left = Math.round((thinking.etaMs - elapsedMs(thinking, nowMs)) / 1000);
  if (left <= 0) return `${thinking.displayName} is past the usual wait`;
  return `${thinking.displayName} usually takes about ${left}s more`;
}

/**
 * **Stop** appears only once the floor has elapsed (Lucas, 2026-09-16): a learner who can cancel
 * every Tester turn can opt out of the retrieval practice the app exists for, but a learner
 * stuck behind a hung backend must be able to get out. `etaMs` is the latency target measured
 * from `startedAt`, so the two are the same clock.
 */
export function stopAllowed(thinking: ThinkingView | null, nowMs: number): boolean {
  if (!thinking) return false;
  return elapsedMs(thinking, nowMs) >= thinking.etaMs;
}

/**
 * Is the neutral, un-attributed **received** line still owed?
 *
 * It answers Nielsen #1 for the window §C3 deliberately leaves empty of *agent* chrome: "the room
 * has your message" is room state, not a claim that anyone is composing. It ends the moment real
 * agent chrome arrives, and it is capped so a turn that dies without a `thinking` event cannot
 * leave a lie on the screen.
 */
export function receivedVisible(
  receivedAt: number | null,
  thinkingHere: boolean,
  nowMs: number,
): boolean {
  if (receivedAt === null || thinkingHere) return false;
  return nowMs - receivedAt < RECEIVED_MAX_MS;
}

/** `Sent · the room has a moment to reply` — deliberately no name and no avatar. */
export const RECEIVED_LINE = 'Sent · the room has it';

/**
 * One sentence per event for the flow's single `aria-live` region (WCAG 4.1.3). Deliberately a
 * whole sentence rather than the message body: a screen reader reading a 200-word turn over the
 * learner's own typing is worse than no announcement at all.
 */
export function announce(
  kind: 'received' | 'replied' | 'failed',
  input: { name?: string; label?: string; words?: number; reason?: string },
): string {
  const where = input.label ? ` under “${input.label}”` : '';
  switch (kind) {
    case 'received':
      return `Your message was received${where}.`;
    case 'replied':
      return `${input.name ?? 'Someone'} replied${where}, ${input.words ?? 0} words.`;
    case 'failed':
      return `${input.name ?? 'A reply'} failed${where}${input.reason ? `: ${input.reason}` : ''}.`;
  }
}

/**
 * **An agent turn that arrived empty (live, 16 Sep 2026).**
 *
 * Two rows on the Critique 1 deck came back from `scripted:sonnet` with `length(body) = 0`, and
 * the flow drew a card with a header, a rule and nothing in it — which reads exactly like the
 * silence issue #34 is about, except now with an avatar on it. Whatever is wrong upstream, the
 * renderer's job is the audit's own rule: *a turn always ends in something the learner can see*.
 * A provisional card is exempt — an empty stream is a stream that has not started.
 */
export function emptyBody(body: string, streaming: boolean): boolean {
  return !streaming && body.trim().length === 0;
}

/** What that card says instead. Names the state, blames nobody, and is not an error colour. */
export const EMPTY_TURN_LINE = 'This reply arrived empty.';

export function wordCount(body: string): number {
  const trimmed = body.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

/**
 * The card's provenance foot: `14:22 · 9.4s · haiku-4-5 · claude-cli`.
 *
 * `PacingStrip`'s own docstring argues that a paced system has to disclose its pacing; a turn
 * that does not say which backend produced it is a claim about a model that never ran. In a
 * research prototype that can silently be answering from `ScriptedClient` this is not a nicety.
 * The pieces that are absent are simply left out — no `null ·` gaps.
 */
export function metaParts(message: MessageView & { model?: string | null; backend?: string | null; totalMs?: number | null }): string[] {
  const parts: string[] = [];
  const ttft = message.ttftActualMs;
  if (typeof ttft === 'number' && ttft > 0) parts.push(`${(ttft / 1000).toFixed(1)}s`);
  const total = message.totalMs;
  if (typeof total === 'number' && total > 0 && total !== ttft) parts.push(`${(total / 1000).toFixed(1)}s total`);
  if (message.model) parts.push(message.model);
  if (message.backend) parts.push(message.backend);
  return parts;
}

/** `scripted` is shown unconditionally; everything else is hover-revealed (audit §6). */
export function metaAlwaysOn(backend: string | null | undefined): boolean {
  return backend === 'scripted';
}

/**
 * Follow the tail, or dock a pill.
 *
 * `Thread.svelte:36–44` has had the right rule since the room shipped and the flow has had
 * nothing: an arriving message scrolls nothing, so a reply to a question asked eight slides ago
 * is never seen. Same rule, one scroller, plus the case the room does not have — the anchor the
 * learner is actually *at* always wins, even when the tail is miles below.
 */
export function scrollDecision(input: {
  /** Distance in px from the anchor's own block to the viewport, or null when it is not mounted. */
  anchorOffset: number | null;
  viewportHeight: number;
  /** Is the learner's composer open on the anchor the message landed under? */
  atAnchor: boolean;
}): 'into-view' | 'pill' | 'none' {
  if (input.atAnchor) return 'into-view';
  const offset = input.anchorOffset;
  if (offset === null) return 'pill';
  // Visible, or just under the fold: bring it the rest of the way.
  if (offset >= -TAIL_SLACK_PX && offset <= input.viewportHeight + TAIL_SLACK_PX) return 'into-view';
  return 'pill';
}

/** `↓ Ellie replied · p.6` / `↑ …` — the pill's own sentence. */
export function pillLabel(input: { name: string; page: number | null; below: boolean }): string {
  const arrow = input.below ? '↓' : '↑';
  const where = input.page === null ? '' : ` · p.${input.page}`;
  return `${arrow} ${input.name} replied${where}`;
}

/**
 * The incremental render (audit §2, P1).
 *
 * The floor is preserved exactly — the main process buffers deltas until `#holdUntil` resolves
 * and only then starts emitting — so this never makes anything visible earlier. It makes a long
 * Tester turn *unroll* instead of thudding. A stream that has been released is final; one that
 * has not is provisional and draws the caret.
 */
export interface StreamState {
  turnId: string;
  anchorId: string | null;
  agentKey: string;
  text: string;
  released: boolean;
  stopped: boolean;
}

export function appendDelta(state: StreamState | null, delta: { turnId: string; anchorId?: string | null; agentKey?: string; text: string }): StreamState {
  if (state && state.turnId === delta.turnId) {
    return { ...state, text: state.text + delta.text };
  }
  return {
    turnId: delta.turnId,
    anchorId: delta.anchorId ?? null,
    agentKey: delta.agentKey ?? '',
    text: delta.text,
    released: false,
    stopped: false,
  };
}

/**
 * Reply speed (audit §9, `design-brief.md` §D4, `product-design.md` §C3).
 *
 * §C3's own closing argument is that **a paced system the learner cannot un-pace is a dark
 * pattern** — and the un-pacing control was the one thing in §C3 that was never built, while
 * `latency_scale` sat plumbed through `latencyTargetMs` the whole time. The hint on each option
 * is the disclosure: an un-paced system that does not say it is un-paced is worse than a paced
 * one, so "not the studied pacing" is in the control itself, not in a footnote.
 */
export const REPLY_SPEEDS: { value: ReplySpeed; label: string; hint: string }[] = [
  {
    value: 'default',
    label: 'Considered (default)',
    hint: 'The researched pacing: Ellie in 4–6 s, Max in 9–12 s.',
  },
  {
    value: 'faster',
    label: 'Faster',
    hint: 'Roughly half the wait. Useful when you are re-reading, not learning.',
  },
  {
    value: 'off',
    label: 'No pacing',
    hint: 'Replies land as soon as they are generated. This is not the studied pacing.',
  },
];

/** The note that has to sit under any non-default choice, verbatim wherever it is shown. */
export const REPLY_SPEED_NOTE = 'Anything but Considered is not the studied pacing.';
