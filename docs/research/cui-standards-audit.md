# The conversation layer against mature chat UIs — an audit

**16 Sep 2026. Read-only audit**, written against the code as it stands at `e814e73`. Nothing in
`app/` was changed. A second agent is concurrently fixing a silent-failure path and adding
logging; every finding here that touches error handling is written to compose with that, not to
duplicate it.

**Why it was commissioned.** The owner, running the live Claude CLI backend on a real 58-page
deck: *"quite difficult to gauge what is happening, lack of user feedback when a message is sent,
and streaming is not working (I think)."* A screenshot shows a learner turn, then Ellie posting a
**pool nudge** where a reply was expected, and no pending state anywhere on screen.

**Verdict.** All three complaints are real and share one root cause: the flow — now the product —
inherited the conversation's *content* from the chat room but not its *status surfaces*.
`Room.svelte` has a typing indicator, a wait-line, a silence caption, a divider above every nudge,
an elapsed-TTFT stamp and a presence bar; `FlowCanvas` → `FlowThread` has one of those six, and it
is conditioned on local state that is frequently wrong. Separately, **streaming is not implemented
anywhere above the LLM client** — genuinely absent, not broken.

**Standards used.** Nielsen #1 and #9; WCAG 2.2 §4.1.3 and §2.4.3; Apple HIG *Feedback*; and the
repo's own `design-brief.md` §D4, `product-design.md` §C3–C5, `pivot-spec.md` §B9. Where code and
brief disagree, the audit says which is the bug.

---

## 0. Three facts that explain the whole report

**Fact 1 — the learner's message has no acknowledgement of any kind, and the composer discards it
before the send is confirmed.** `FlowThread.svelte:72–77` calls `store.flowSend(...)` and then
`text = ''` synchronously. `store.flowSend` (`store.svelte.ts:611`) is deliberately not awaited,
and returns `void`. The learner's own words reach the screen only when the main process round-trips
`message.appended` back (`store.svelte.ts:270`); if the IPC call rejects, the text is already gone
and all that appears is a dismissible app-level banner. iMessage, Slack and Claude.ai all append
optimistically and mark state on the bubble.

**Fact 2 — for the first 3–8 seconds after a send, the app is deliberately and completely
silent, and then the wait indicator is conditioned on the wrong thing.** `actor.ts:1011–1017`
sleeps `min(FLOOR_YIELD_MS = 8 s, target − 1 s)` *before* `#showThinking()`. For Ellie (4–6 s) the
indicator appears ~1 s before her reply; for Max (9–12 s) it appears at 8 s — the last 1–4 s of a
12-second wait. `product-design.md` §C3 asks for exactly this ("*Floor-yield window … nothing at
all*"), but pays for the silence with two devices the flow lacks: the ghosted micro-prompt
(`Composer.svelte:21–25`, room only) and the ledger animating inside the hold. `design-brief.md`
§D4 states flatly "*A typing indicator runs during the hold*". **The brief is right and the code is
the bug** — but only for the *learner's message*: §C3 governs *agent* chrome, and "the room has
your message" is not agent chrome.
And when the indicator is finally emitted, `FlowThread.svelte:54` draws it only if
`store.composerAt === anchorId` — a single global set by *Explain it back* or *Reply here*. Open
another segment's composer, reopen the document, or let a nudge land on `#lastAnchorId`, and
`room.thinking` renders **nowhere at all**.

**Fact 3 — streaming does not exist above `LLMClient`.** The `RoomEvent` union
(`shared/types.ts:472–482`) has no delta member; there is no `message.delta`, no partial body,
no placeholder row. `actor.ts#generate` ends `return this.#d.llm.complete(request)` — **no
`onDelta` argument**, at any call site in `actor.ts`. Both clients can stream
(`claude-cli.ts:281–290` parses `content_block_delta` and calls `onDelta`;
`anthropic.ts:60–64` likewise) and the deltas are accumulated and thrown away. So the reply
always lands as one block, *after* the floor. The floor is by design — a floor on *visible* TTFT
(`design-brief.md` §D4, Tan et al. §3.2.3) — but it means a 200-word Ellie turn behind a 40 s CLI
cold start shows nothing for 40 s and then everything at once.

---

## 1. Send feedback — **S1**

| What is wrong | Where |
|---|---|
| No optimistic append; the turn appears only on the main-process echo | `FlowThread.svelte:72`, `store.svelte.ts:611` |
| No sent / pending / failed state on the learner's own block | `FlowThread.svelte:84–95` |
| Composer cleared before confirmation — a rejected send loses the text | `FlowThread.svelte:76` |
| No Send button; Enter-only, and nothing is ever disabled | `FlowThread.svelte:118–141` |
| Focus is set once on mount and never restored after a send | `FlowThread.svelte:57–59` |

**Fix.** Make `store.flowSend` return its promise and hold `pendingSends: Record<string,
{anchorId, body, state, at}>` keyed by a client-side id. `FlowThread` renders pending entries as
`.mine` blocks at reduced opacity with a `Sending…` / `Failed · Retry` foot, dropped when a
matching `message.appended` arrives. Keep the text in the box until the promise resolves; restore
focus either way. Add a Send button, disabled while `text.trim()` is empty. ~3 h.

## 2. Generation state and the floor — **S1**

Findings: the 3–8 s dead window (Fact 2); the indicator's `composerAt` condition (Fact 2); no
streaming (Fact 3); **no stop control anywhere** — a held turn can only be cancelled by sending
another message (`actor.ts:277–281`), which is undiscoverable; and `ThinkingView.etaMs` is
*already computed and shipped over IPC* (`actor.ts:1465–1474`) and **never read** —
`ThinkingIndicator.svelte` shows only elapsed seconds, and only for the Tester.

`pivot-spec.md` §B9 asks for three devices. Device 2 (the reserved slot) is built. Device 1 (the
anchor ring + label chip on the crop) is **not built** — nothing in `SegmentCard.svelte` reacts to
`room.thinking`. Device 3 (the off-screen breadcrumb) is built **only for the whisper popover**
(`FlowCanvas.svelte:615–619`), not for a held public turn, which is the case §B9 was written
about.

**Fix, in order.** (a) Emit `agent.thinking` on *accepting* a learner turn, with a
`stage: 'received' | 'composing'` field; `received` renders as neutral, un-attributed room state
(`Sent · the room has 8 s to respond`), satisfying both §C3's "no agent chrome during the yield"
and Nielsen #1. (b) Drop the `composerAt` condition: render under `room.thinking.anchorId` (add it
to `ThinkingView` from `#runAgentTurn`'s `anchorId`, already in scope), falling back to
`#lastAnchorId`. (c) Use `etaMs` — see *decisions*. (d) Port §B9 device 1; generalise device 3 to
public turns. (e) Add **Stop**, wired to a new `room:cancelTurn` setting `pending.cancelled` —
`#cancelTurn` exists, only the button is missing. ~6 h for (a)–(c), ~4 h for (d)–(e).

**Streaming** is a separate, larger change and is deliberately **P1, not P0**: add
`{ type: 'message.delta'; roomId; turnId; text }` to `RoomEvent`, pass an `onDelta` into
`#generate` that buffers until `#holdUntil` resolves and then flushes-and-streams, and render a
provisional block in `FlowThread`. The floor is preserved exactly — nothing becomes visible
earlier — but a long Max turn then *unrolls* instead of thudding. ~6 h. It is P1 because it does
not fix the reported confusion; the dead window does.

## 3. Errors — **S2**

Every failure funnels through `run()` (`store.svelte.ts:977–984`) into one global dismissible
banner (`NoticeBanner.svelte`), with no anchor, no retry, and no relation to the message that
failed. `actor.ts:1034–1038` posts `"<name>'s connection dropped — retrying"`, which is **not true**: the
code clears the turn, arms the timer, and does not retry. There is no offline or backend-down
banner and no surfacing of `ClaudeCliNotLoggedInError` at the point of use — the CLI can be logged
out and the only symptom is turns that never arrive.

**Fix.** Carry `anchorId` on the `notice` event and render it inline in the thread that failed,
with a **Retry** button that re-sends the stored pending body (§1's map). Correct the copy to what
the code does. Add a persistent strip in `FlowCanvas`'s header when `boot.mode === 'scripted'` or
the CLI probe failed — the user should never have to open Settings to learn the backend is dead.
~3 h. *(Overlaps the concurrent silent-failure fix — coordinate before touching `actor.ts`'s
catch blocks.)*

## 4. The silence timer's nudges — **S1**

This is the screenshot. Three separate omissions compound:

1. **`Divider.svelte` is never rendered in the flow.** It is imported by `Message.svelte:7` only.
   `actor.ts:1054` writes `dividerCause` = `"45s quiet · Ellie stepped in"` on every silence turn,
   `views.ts:78` puts it on the `MessageView`, and `AiSegment.svelte` ignores it. So a nudge is
   pixel-identical to a considered reply. That single line of missing markup is most of the
   reported confusion.
2. **`WaitLine.svelte` is never rendered in the flow.** The 45 s countdown, the *"Ellie may chime
   in"* caption and the **Hold** / **Wait for me** controls exist only under the room composer.
   In the flow the timer is completely invisible and uncontrollable.
3. **Nudges are content-free by design** (§C5), so one reads as a vacuous reply to what was just
   said.

Can a nudge appear while a reply is pending? **No** — `sendMessage` calls `#timer.cancel()`, and
`#armTimer()` runs only after the turn resolves; repetition is capped at two fires per round. The
mechanism is sound; only its legibility is missing.

**Fix.** Render `Divider` above any `AiSegment` whose `message.divider` is set (and include
the *don't do this* control it already carries). Put a compact `WaitLine` in the thread that owns
`composerAt`, or as a thin strip docked to the flow header. ~2 h — the highest legibility-per-hour
item in this document.

## 5. Scroll and focus — **S2**

`FlowCanvas`'s scroller manages scroll only for splits and merges. **An arriving message never
scrolls anything**, there is no "new message" pill, and because the reply lands under a crop that
may be several screens up, a reply to a question asked eight slides ago is never seen.
`Thread.svelte:36–44` has the correct tail-following rule; the flow has nothing. Threads do not
collapse (only REFERENCE cards do, via *Explain it back*). Enter/⇧Enter is shown in both
composers; **Esc does nothing in the thread composer** (`AskHereLine` handles it, `FlowThread`
does not), so a composer cannot be closed without the mouse. ⌘K is *Ask privately* on a card.

**Fix.** Scroll a new message into view when its anchor holds `composerAt` or the learner is
within ~220 px of it; otherwise dock a `↓ Ellie replied · p.6` pill, reusing `.crumb` and
`scrollToPrivate()`. Handle Esc in `FlowThread`'s `onkeydown`. ~3 h.

## 6. Message anatomy — **S3**

`AiSegment.svelte` gives author, role word, `by rule` tag, *from a private note* tag, a hover-only
timestamp, and the REFERENCE hand-back with its two buttons — genuinely good, and better than
most. What it omits versus `Message.svelte:74–76`: **the actual TTFT stamp** (`ttftActualMs` is
stored and shipped and shown only in the old room) and any **model or backend disclosure**. In a
research prototype that can silently be answering from `ScriptedClient`, a turn that does not say
which backend produced it is a claim about a model that never ran — `PacingStrip`'s own docstring
makes this argument, and then the cards don't carry it.

**Fix.** Add a hover-revealed meta line to `AiSegment`: `14:22 · 9.4s · haiku-4-5 · claude-cli`,
with `scripted` shown *unconditionally* rather than on hover. ~1.5 h.

## 7. History — **S3**

Reopen fidelity is good: `flowMessages` rebuilds threads per segment and `flowState` persists.
Two gaps. `answersCollapsed` / `answersRemoved` / `composerAt` are renderer-local, so reopening a
deck restores every REFERENCE card expanded and un-removed — a card the learner dismissed comes
back. And there is **no unread affordance**, which matters most for exactly the case in §5.
**Fix:** persist the two maps in the settings row the sitting already uses; add a dot on the
card's label strip for threads with post-last-open messages. ~2.5 h.

## 8. Accessibility — **S2**

`FlowThread` has no live region, so **no new message in the product's main surface is announced**
(WCAG 4.1.3). `ThinkingIndicator` has `aria-live="polite"` on a container whose text changes every
second for the Tester — it will be announced repeatedly. `Thread.svelte:47` puts `aria-live` on the
whole scroller, which re-announces on any subtree change. Timestamps and the meta line are
`aria-hidden`, so a screen-reader user cannot get a turn's time at all. Focus order is otherwise
reasonable and `prefers-reduced-motion` is honoured once, in `styles/app.css:121` — but the
three-dot `pulse` keyframe and the anchor-ring pulse §B9 asks for are not covered by it.

**Fix.** One `aria-live="polite" aria-atomic="true"` visually-hidden region per flow, fed a single
sentence per event (`Ellie replied under "Side channels", 42 words`); `role="status"` +
`aria-live="off"` on the indicator with the counter marked `aria-hidden`; extend the
reduced-motion block to the dots. ~2.5 h.

## 9. Settings discoverability — **S3**

Settings is reachable from `NavRail` on every screen and covers backend, CLI path, per-role models
and Tester pacing; `PacingStrip` does the first-run disclosure well. Missing: the **Reply speed**
control (§D4 and §C3 both promise Quick / Considered / Slow, and `latency_scale` is already plumbed
through `latencyTargetMs` — this is a dropdown, not a feature), **nudges on/off in live mode**, and
any **log folder** (no `app.getPath('logs')` use exists). §C3's own closing argument is that a paced
system the user cannot un-pace is a dark pattern, and the un-pacing control is the one not built.
~2 h, and it retires an ethics risk.

## 10. Instrumentation — **S2 (for the researcher, not the learner)**

`latency_target_ms`, `ttft_actual_ms`, usage and cost are persisted and the event log has the §7.1
vocabulary, but none of it is visible while running — diagnosing "hung or thinking?" means opening
SQLite. **Fix:** a ⌥⌘D debug drawer in `FlowCanvas` reading a `store.turnLog` fed from the existing
events: per turn — trigger, `decidedBy`, decision latency, generation latency, TTFT, floor target,
actual visible latency, backend, model, tokens, cost. ~3 h, and it makes every number above
measurable rather than argued.

---

## What mature chat UIs do vs what ChatterED does vs the fix

| Signal | ChatGPT / Claude.ai / Slack / iMessage | ChatterED flow today | Fix |
|---|---|---|---|
| Message sent | Appears instantly, greyed, tick on ack, red **!** + Retry on failure | Nothing until the main-process echo; text discarded on send | §1 optimistic append + pending map |
| Composer during send | Clears on ack; focus retained; Send disabled when empty | Clears immediately; no Send button; never disabled | §1 |
| Generating | Indicator within ~200 ms, every time | Nothing for 3–8 s, then an indicator that is often not rendered at all | §2(a)(b) |
| Expected wait | Rarely shown (waits are short) | `etaMs` shipped and unused; counter for the Tester only | §2(c) — *decision below* |
| Incremental text | Token-by-token, universal | Not implemented above `LLMClient`; deltas parsed and discarded | §2 streaming, P1 |
| Stop | Always, one click | No control; only by sending another message | §2(e) |
| Errors | Inline, specific, retryable | One global banner, no anchor, no retry, and one message that is untrue | §3 |
| System messages | Visually distinct (Slack's grey italics, iMessage's centred grey) | A nudge is pixel-identical to a reply; `divider` computed and dropped | §4 — 2 h |
| New message off-screen | Jump-to-latest pill | Nothing; a reply eight slides up is never seen | §5 |
| Provenance | Model named in the UI | Author and role only; no model, backend or TTFT | §6 |
| Announcements | `aria-live` on new messages | No live region in the flow | §8 |

---

## Prioritised

**P0 — before anyone else uses it (≈16 h).**

| # | Item | § | Hours |
|---|---|---|---|
| 1 | Nudge legibility: render `Divider` in `AiSegment`; `WaitLine` in the flow | 4 | 2 |
| 2 | Optimistic append + pending/failed state; keep text until ack; Send button | 1 | 3 |
| 3 | `received` state emitted on accept, so the 3–8 s window is never blank | 2a | 2 |
| 4 | Indicator anchored to the turn, not to `composerAt` | 2b | 2 |
| 5 | Errors inline and retryable; fix the untrue "retrying" copy; backend-down strip | 3 | 3 |
| 6 | New-message scroll + jump pill | 5 | 2 |
| 7 | One live region per flow | 8 | 2 |

**P1 — industry-standard (≈17 h).** Incremental streaming render behind the floor (6 h); Stop
generation (2 h); §B9 device 1 (anchor ring) and device 3 generalised to public turns (3 h);
`etaMs` shown on the indicator (1 h); Reply-speed control in Settings (2 h); model/backend/TTFT on
each card (1.5 h); Esc + focus restore in the thread composer (1.5 h).

**P2 — nice (≈8 h).** Debug drawer (3 h); unread dots per thread (1.5 h); persist collapsed and
removed cards (1 h); thread collapse/expand (1.5 h); reduced-motion for the dots (0.5 h);
log-folder button in Settings (0.5 h).

---

## Decisions for Lucas

Only the three that genuinely change the product. Each has a recommendation.

1. **Countdown or plain indicator?** `etaMs` lets the indicator say `Max is reading… ~9s` and
   count down. A countdown is the strongest anti-broken-system device, but it advertises the
   delay as *scheduled*, which is closer to the performative-deliberation line Tan et al. §5.5
   warns about than a plain animated indicator is. **Recommend: plain dots for Ellie, elapsed
   counter for Max as today, and the ETA only in the `title`/tooltip** — legible on demand, not
   advertised. The pacing is already disclosed once, properly, by `PacingStrip`.
2. **Stop during a floor?** Today the only cancel is sending another message. A Stop button is
   universal in chat UIs, but a learner who can cancel every Tester turn can opt out of the
   retrieval practice the app exists for. **Recommend: Stop appears only after the floor has
   elapsed** (i.e. while genuinely generating), so the deliberate wait cannot be skipped but a
   hung backend can be escaped.
3. **Nudges on/off in live mode?** `Wait for me` pauses nudges for a round and is unreachable in
   the flow. **Recommend: ship the `WaitLine` controls in the flow (P0 #1) and do not add a
   global off switch** — a per-round pause is the researched behaviour; a permanent off switch
   removes the mechanism from the study without removing it from the build.

*(Not a decision, a note: `design-brief.md` §D4 says a typing indicator runs during the hold and
`product-design.md` §C3 says the floor-yield window shows nothing at all. They are reconciled by
P0 #3 — the yield window shows that the **room** received the message, and shows no **agent**
chrome. If that reconciliation is wrong, §C3 is the brief that needs editing, not the code.)*
