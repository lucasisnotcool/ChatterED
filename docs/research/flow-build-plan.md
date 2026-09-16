# The flow — revised build plan for Assignment 1

*2026-09-15, evening. Seven days to the deadline (Mon 22 Sep 23:59).*

**This document replaces `pivot-spec.md` §E (the seven-day plan) and §D (what changes in code).**
Both were written for the margin-thread / box-select design of the morning of 15 Sep. That design has
been superseded three times since, by issues **#25** (geometry-only lazy split, slides only),
**#32** (Teacher + Tester, a neutral REFERENCE voice, the Critique 1 deck as the fixture) and
**#33** (the flow session as the unit, and the hand-off rule). What survives from `pivot-spec.md` is
listed in §0.2; nothing else in §D or §E should be followed.

**Parallel work in flight.** A second agent is building the geometry pipeline right now — Stages 0–3,
the segment types, split/merge, the genre router, migration 009 and the IPC surface — and will publish
its contract as `app/docs/SEGMENTS.md`. **Assume it lands Tue 16.** This plan builds *around* it and
deliberately does not restate it. Everywhere below, "the pipeline" means that work and
`app/docs/SEGMENTS.md` is authoritative over this file for segment shape, split/merge semantics and
the IPC names.

---

## 0. Orientation

### 0.1 What is superseded

| Superseded | By | Why |
|---|---|---|
| `pivot-spec.md` §E Days 1–7 | **§3 of this file** | Days 1–3 were migration/anchors/box-select. Box-select is not the gesture any more; a tick click is. |
| `pivot-spec.md` §D1–D9 | **§4 of this file** | `DocumentCanvas` + `MarginColumn` + `SelectionOverlay` are not built. A flow of crop cards is. |
| `pivot-spec.md` §F1 (16 beats) | **§2 of this file** | The storyboard filmed a box-select on a maths slide. It now films a tick split on the Critique 1 deck. |
| `pivot-spec.md` §B3 "Get challenged", §B6 "Teach this page", §B7 "Coverage map" | — | Out of A1 (§7). The challenge becomes the Tester's hand-off; teach-back folds into the quiz (#32). |
| `pivot-spec.md` §B10 (S2 disagreement quota) | — | Deleted with the group framing (#32, `masg-drop-assessment.md` Option 2). |
| `pdf-fidelity-segmentation.md` §C7 Day 4 (the vision call) | — | Out of A1 (#25, #26). |

### 0.2 What still applies, unchanged

`pivot-spec.md` **§A** (document model: immutable rendered source + inserted blocks; an annotation *is*
a message; `messages.anchor_id`), **§B0** rules R1–R5, **§B1** (the REFERENCE voice and its 120-word
cap), **§B5** (the whisper invariant T4 and the relay), **§B8** (the silence timer's new idle
predicate), **§B9** (latency legibility), **§B11** (the Koala control set), **§C4** (block chrome),
**§F2** (report framing and the three evidence tiers), **§F3** (the participant follow-up).
`pdf-fidelity-segmentation.md` **§C0–C5** and **§C8** are the fidelity contract and are not negotiable.

---

## 1. The A1 product, in one paragraph

**ChatterED opens a lecture deck as a *flow*.** Every page arrives as one whole-page **crop** of the
pdf.js-rendered page — the lecturer's own pixels, never re-typeset — and progressive-reveal builds
collapse to the finished slide behind a *"⏴ N build steps"* chip. Faint **ticks** in the card's gutter
mark where the page's own geometry says a concept boundary could go; clicking one **splits the crop in
place**, with no re-render, which is visible proof that nothing was ever converted. Between any two
cards sits a **"+ Ask here"** line. Asking inserts a **REFERENCE** card — neutral, system-voiced,
capped at 120 words, typeset in the app's UI font so it can never be mistaken for the slide — and
under it opens a thread with **Ellie, the Teacher**, who explains from the slide and tracks what she
has taught in this sitting. When the learner has been in flow long enough and two or more concepts are
fresh, Ellie **hands off to Max, the Tester**, who asks the learner to explain or apply one of them.
Only the learner's own verbatim words move the **Explanation Ledger** from *stated* to *justified* to
*defended*, and *defended* is unreachable without a Tester probe. A **whisper popover** asks Ellie
privately, with an *insert into the document* escape hatch; nothing private ever reaches Max, the
shared flow or the ledger. **Original pages** is one click away and hovering a page chip shows the
source page with the segment outlined on it. The whole conversation is saved with the document.

---

## 2. The video — 16 beats, ≤ 10 minutes

**Deck:** `Academia/Sources/btw interaction/A0282987E_LohZhengLucas_Critique1_slides (1).pdf` (#32) —
7 pages, 16:9, tagged, committed, and it is Lucas's own work, which removes any question about showing
someone else's material on camera. **Backend:** `scripted`. **Network:** off.

**Four filming rules.** (1) One deck, one scroll position per beat, camera still. (2) The first thing
the viewer sees the machine do is *propose*, not *write* — a tick, not a paragraph. (3) Say "scripted"
the first time something is scripted, then stop apologising: `ScriptedClient` replays real turns
through the real actor, the real 45 s timer, the real ledger gates and the real whisper scoping. (4)
Face visible throughout the talking beats — 5 of the 16 marks depend on it.

| # | t | Frame | What happens | What is said |
|---|---|---|---|---|
| 1 | 0:00 | Face | Name, module, the task in one sentence. | "One learning task: reading a lecture deck and being able to defend what it says. Three students, all of whom can get an answer and none of whom can explain it." |
| 2 | 0:35 | Face + quote slide | Step 1 in 40 s: three participants by programme and year, the difficulty, one verbatim quote. | "*[verbatim quote]* — that is uncritical use of AI output, and it is what I designed against." |
| 3 | 1:15 | Two screenshots | Old: PDF left, chat right. New: the flow. | "Everything they showed me was this shape, and the answer ends up in neither half. So I moved the conversation into the deck." |
| 4 | 1:45 | **App, real** | Open the deck from the vault. It appears as seven cards. Point at a build chip. | "Their own file, out of their own folder. No upload, no conversion — each card is a crop of the rendered page, so the maths and the figures are the lecturer's pixels." |
| 5 | 2:10 | **Ticks** | Scroll to page 3. Two faint ticks in the right gutter. Hover one: a dashed guide crosses the crop. | "Nothing has been cut. Those ticks are the page's own geometry saying where a boundary *could* go — computed locally, no model, no network." |
| 6 | 2:30 | **Split in place** | Click the tick. The card divides into two, instantly. | "That was a number changing, not a re-render. Nothing was converted, which is exactly what you just saw." |
| 7 | 2:50 | **+ Ask here** | The faint line under the new card; click it; type a question. | "Every boundary in this document was authored by me. So is every question — no agent writes anywhere I have not asked." |
| 8 | 3:10 | **REFERENCE card** | A neutral grey card inserts into the flow, in the app's font. | "That is not Ellie and not Max. It is a reference voice, capped at 120 words, set in a different typeface on purpose — you can always tell what the machine wrote from what the lecturer wrote." |
| 9 | 3:35 | **Teacher's thread** | *Explain it back →*; the learner types; Ellie replies after 4–6 s and builds on the slide. | "Ellie is a teacher now, not a peer. She explains, and she keeps track of what she has covered in this sitting." |
| 10 | 4:10 | **Hand-off** | Two concepts covered; Ellie: *"You've covered X and Y — Max, over to you."* | "That hand-off is a rule I can see and turn down, not a model's whim. It fires when I've been in flow and something is fresh — minutes old, not seconds." |
| 11 | 4:35 | **Tester's quiz** | Amber ring, `Max is reading…`, counter climbing, then one question. | "Eleven seconds, deliberately. Tan et al. found two-second replies read as less thoughtful; nine got the best usefulness ratings." |
| 12 | 5:05 | **Ledger moves** | Learner answers in their own words. `○ → ◐ → ●` on two rows. | "That moved because *I* wrote it. Agreement is not evidence, and the filled circle is unreachable without a challenge — which is the answer to 'could a quiz do this?'" |
| 13 | 5:35 | **Whisper popover** | `⌘K`; the embarrassing question; Ellie's private answer; **Insert into the document**. | "This is the feature from my Critique 1. `/btw` claimed it could send something back and couldn't. This can — with my permission, and it is the only path from private to shared." |
| 14 | 6:05 | **Original pages** | Toggle on: the flow becomes seven whole pages, instantly. Toggle off. | "One click, and visibly instant — because the toggle only changes which rectangle each card draws." |
| 15 | 6:25 | **Compare-on-hover** + **a scan** | Hover the page chip: the source page with the segment outlined. Then open a scanned PDF: whole pages, with the notice. | "And when it is not a slide deck, it says so and gives you whole pages. It is honest about what it cannot segment, which matters more than pretending." |
| 16 | 6:50 | Face, ~2 min | Division of labour · one design decision · one limitation · real vs scripted. | Decision: *"Segmentation has no model in it at all. The geometry proposes, I decide — so every boundary in the study log is mine."* Limitation: *"The nearest study found in-document notes were preferred and had no measurable comprehension effect at 2 h. My measure is defended explanation, which is a different construct, and it is unvalidated."* |

Budget leaves ~1:45 of slack against the 10-minute cap. **Beats 1–3 and 16 carry 3 of the video's 5
marks** and depend on nothing that is being built this week — record them first, on Sun 21 morning,
before the app is touched.

**Fallback storyboard.** If the Thursday gate (§3.8) falls to F1, beats 5–6 are replaced by one beat:
*"every page is one segment; splitting is specified and is not in this build"*, and the fidelity proof
moves entirely onto beats 14–15, which are stronger anyway. If it falls to F2, beats 4–15 are filmed
on the shipped chat app with the document pane open, and beat 3 becomes *"here is the design response
I specified and the part of it I built"*. Beats 1–3 and 16 are unchanged in all three worlds.

---

## 3. Day by day, Tue 16 → Mon 22

**Conventions.** Paths are relative to `/Users/lohzh/ChatterED/app`. **⇉** marks tasks that are
independent of each other and can run as parallel Opus agents; **→** marks tasks that must follow. Every
day ends with `npm test` green and a scoped commit. Writing slots are non-negotiable: the report is 4
of the 16 marks and none of Steps 1–2 depends on this week's code.

### 3.1 Tonight, Mon 15

Land this plan and the segment-type declaration. Send the `pivot-spec.md` §F3 follow-up to two
participants so it has 48 h to come back — it is what moves the report from tier 3 to tier 1 (§6).
Answer #33's four open questions in a comment, or accept the defaults in §4.2 and say so.

### 3.2 Day 1 — Tue 16 · Crop cards, the roster, the reference voice

| Track | Tasks | Files |
|---|---|---|
| **⇉ A — flow renderer** | The flow screen and the crop card. `PdfViewer` gains `canvasFor(page)` / `ensureRendered(page, scale)` and exports `sizes`/`scale`; it is **modified, not replaced** — it stays the Original-pages renderer. Cards draw with `ctx.drawImage(pageCanvas, sx, sy, sw, sh, 0, 0, dw, dh)`. Label strip above, page chip right, full-bleed crop, hairline border, no radius on the image. | **new** `components/FlowCanvas.svelte`, `components/SegmentCard.svelte`, `lib/flowview.ts` + `lib/flowview.test.ts`; **mod** `components/PdfViewer.svelte`, `App.svelte`, `lib/store.svelte.ts` |
| **⇉ B — Teacher + Tester** | `roleBlock()` rewritten for both roles; the Peer's *"never supply a complete correct explanation"* clause deleted; `ROLE_LABEL` → teacher/tester; Theo out of the standing roster; `DISAGREEMENT_QUOTA` / `mustDisagree` deleted end to end; `PROMPT_VERSION` bumped. **New `src/room/flow.ts`**: session boundary, taught set, freshness, `handOffDue()` — all constants in one file, fake-clock tests in the shape of `timer.test.ts`. | **mod** `src/room/prompts.ts`, `agents.ts`, `orchestrator.ts`, `actor.ts`, `llm/scripted.ts`; **new** `src/room/flow.ts` + `flow.test.ts` |
| **⇉ C — REFERENCE path** | The `reference` participant created with the room; `src/room/reference.ts` with the 120-word hard truncation in code; `prompts.reference.ts` (register, not disguise); `LlmRequest.meta.scope` gains `'reference'`; `actor.askHere()`; the gate that keeps Ellie and Max out of the thread until *Explain it back*. | **new** `src/room/reference.ts` + `reference.test.ts`, `src/room/prompts.reference.ts`; **mod** `actor.ts`, `llm/types.ts`, `llm/scripted.ts` |

A, B and C touch disjoint files and can run as three agents. **Merge order: B → C → A** (B changes
`actor.ts` signatures that C extends; A touches only the renderer).

**Demoable at end of day:** the Critique 1 deck opens as seven crop cards with ticks in the gutter,
scrolls without a blank card, and `npm test` is green with `flow.test.ts` and `reference.test.ts`
added. **Writing slot, 21:00–22:30:** report Step 1 (500 words) from the interview material.

### 3.3 Day 2 — Wed 17 · Split, order, AI cards

| Track | Tasks | Files |
|---|---|---|
| **⇉ A — split and order** | Tick click → split in place; hover draws the dashed guide (the one thing ever drawn over slide pixels); drag for a free cut, snapping within ~8 pt, refusing to cross a figure; same-page merge; drag reorder; an undo stack (split/merge/reorder are all numbers, so it is trivial and must exist today); **Original pages** toggle; page-chip compare-on-hover panel, reusing `loadRoomSource()`'s renderer. | **new** `components/SegmentGutter.svelte`, `components/PageChip.svelte`; **mod** `FlowCanvas.svelte`, `SegmentCard.svelte`, `lib/flowview.ts` |
| **⇉ B — AI cards in the flow** | `AiSegment.svelte`: inset, app UI font, agent hue left rule, name in the header, **never inside a crop's bounds**; the callout rule when a card points at a crop. `AskHereLine.svelte`. `Message.svelte`, `Thread.svelte`, `Composer.svelte`, `ThinkingIndicator.svelte`, `WaitLine.svelte` are **re-slotted, not rewritten**. | **new** `components/AiSegment.svelte`, `AskHereLine.svelte`; **mod** the five components above (props only) |
| **⇉ C — the script** | `script.critique1.ts` — the Critique 1 beat script with cues `open`, `ask:1`, `student:1…4`, `handoff:1`, `silence:1`, `whisper:1`, `insert:1`; `ScriptedBeat` gains `segment?`; `scripted.ts` answers `scope: 'reference'`; `script.critique1.segments.ts` seeds the demo's segment rectangles. **`script.psd-hessian.ts` is kept** — `actor.test.ts` runs on it. | **new** `src/room/llm/script.critique1.ts`, `script.critique1.segments.ts`; **mod** `llm/scripted.ts` |

**Demoable:** a tick click splits, undo restores, Ask here inserts a REFERENCE card in the app's font,
Original pages toggles instantly, and all of it survives quit and relaunch.
**18:00 — the first-impression check (R1).** Look at page 1 of the real deck on a 1320 px window and
answer out loud: does this read as a new kind of document, or as a PDF viewer with ticks? If it reads
as a viewer, the cheapest fix is *not* a model — it is an auto-split at unambiguous title-band gaps
(`segmentation-lazy-split.md` §5), which is still free and local.
**Writing slot, 21:00–22:30:** report Step 2 (550 words).

### 3.4 Day 3 — Thu 18 · Real threads, the hand-off, the ledger · **⟵ FALLBACK GATE**

| Track | Tasks |
|---|---|
| **→ A** | `messages.anchor_id` (segment id) end to end: `actor.ts` writes it, `messages.forAnchor` reads it, the flow renders it. `context.group.ts` gains the segment block — the crop's extracted text plus its neighbours, **after** the cache breakpoint, never in `system[0]`. |
| **→ B** | The hand-off wired: `handOffDue()` consulted in `ruleDecision()` before the model call; Ellie's hand-off line; Max's quiz turn with `targetElementId` from the taught set; the learner's answer through the unchanged ledger. |
| **⇉ C** | Ledger glyphs in the flow gutter, keyed by segment; the 400 ms fill scheduled inside the next hold; bidirectional hover. `LedgerRail.svelte` / `LedgerRow.svelte` retired. |

**HARD GATE, called at 22:00 Thu 18, out loud, in issue #23.** All three must pass:

| | Criterion |
|---|---|
| **G1** | A tick click splits a crop in place and undo restores it — twice in a row, no blank card, no re-render flash, surviving a relaunch. |
| **G2** | A complete Teacher → learner → Tester → learner exchange of **≥ 6 turns** plays inside one segment's thread through the real actor, twice in a row, without a restart. |
| **G3** | *Ask here* inserts a REFERENCE card that provably cannot move a ledger row, and the whisper leak canary still passes over the flow renderer's import graph. |

Pass → Day 4. **Any failure → take the fallback tonight** (§3.8) and do not spend Friday rescuing it.

### 3.5 Day 4 — Fri 19 · Whisper, pacing, honesty

Whisper popover on a segment (`⌘K`), Ellie-only, ephemeral by construction, with **insert into the
document** creating a *new* shared card and never revealing the private one; the leak canary extended
to the flow renderer and to any export path. `timer.ts` gains the `onSelectionChange` hook and the new
idle predicate (`pivot-spec.md` §B8) — the machine and its constants are untouched, only the
predicate. Latency legibility: the ring on the card, the reserved slot with Max's counter, the
off-screen breadcrumb. The genre notice on a non-slide document, and the one-time first-open strip
carrying the **pacing disclosure** rescued from the dead round card — that disclosure is a rubric and
ethics requirement and must not be lost with the card. **Demoable:** beats 10–15 end to end.

### 3.6 Day 5 — Sat 20 · Freeze

Run the §2 storyboard **five times** and fix only what breaks. Write the prototype `README.md`
(method, `npm i && npm run dev`, Settings ▸ Backend = `scripted`, what is real and what is scripted,
where in `src/` each beat lives). Build the ZIP: source, this plan, `pivot-spec.md`, the beat script,
the storyboards, the §F3 follow-up and its answers. **Gate: two clean end-to-end runs, no restart, no
console errors, ZIP opens on another machine. Code freezes at 22:00. No commits on Sunday.**

### 3.7 Day 6 — Sun 21 · Record, and Day 7 — Mon 22 · Report

Sun: record beats 1–3 and 16 first (they need no app), then the demo in one take; re-record once and
keep the better take. **Gate: video under 10 min and under 200 MB.** Mon: finish the report to the §6
budget and **submit by 18:00, six hours early**. Monday is a buffer, not a build day.

### 3.8 The fallback, defined now so it needs no deliberation

Two tiers. Take the highest that passes.

| | **F1 — whole-page segments only** | **F2 — the shipped room over `ScriptedClient`** |
|---|---|---|
| **Trigger** | G1 fails (split is broken or ugly) but G2 and G3 pass. | G2 fails, **or** Friday 12:00 arrives with no clean run of anything. |
| **What ships** | The flow, the build chips, "+ Ask here", the REFERENCE card, the Teacher/Tester thread, the ledger, whisper, Original pages, compare-on-hover — with **one segment per page** and no split, merge or reorder. One constant: `SPLIT_ENABLED = false` in `lib/flowview.ts`. | `Room.svelte` + `DocumentPane` exactly as shipped on 15 Sep, backend `scripted`, plus whatever of the Teacher/Tester roster landed on Tue (it is pure `src/room` and does not depend on the renderer). |
| **Cost** | ~2 hours of flag-and-hide. Nothing built is thrown away. | Zero build hours. ~1 hour to re-storyboard. |
| **Why it is honest** | It is already a shipped code path — it is exactly what the genre router does for every non-slide document (#25), so nothing looks broken, and `segmentation-lazy-split.md` §2.4 argues it is the *normal* starting state of every deck. | The interaction model is unchanged; the surface changed. Steps 1 and 2 of the report are identical either way. |
| **What the report says** | "Splitting is specified in §4 and is the first thing Assignment 2 builds." | `pivot-spec.md` §F2's sentence: *the interaction model is unchanged, the surface changed* — with this plan as the Step 3 implementation plan and two days of it built. |

**The one thing the fallback must not become: a decision deferred to Friday afternoon.**

---

## 4. Code changes, by area

### 4.1 The flow renderer (`src/renderer/`)

| File | State | Responsibility |
|---|---|---|
| `components/FlowCanvas.svelte` | **new** | The screen. Owns the ordered segment list, the scroll container, the Original-pages toggle, the active segment, and the undo stack. Replaces `Room.svelte` as the route target. |
| `components/SegmentCard.svelte` | **new** | One crop. `drawImage` with a source rectangle off the page canvas `PdfViewer` already renders; a small LRU of rendered pages and a placeholder painted in the page's own background colour, never white. Label strip above (editable; slide title from the text layer, first text line after a split), page chip right. Crop full-bleed, hairline border, no radius on the image. |
| `components/SegmentGutter.svelte` | **new** | Drag handle left; ticks and the split affordance right. **Ticks live outside the pixels**; hover draws the dashed guide across the crop, and that guide is the only thing ever drawn over slide pixels. Free-cut drag snaps within ~8 pt, releases on a modifier, refuses to cross a figure. |
| `components/AskHereLine.svelte` | **new** | The faint "+ Ask here" line between cards, and the prompt field it opens. |
| `components/AiSegment.svelte` | **new** | REFERENCE / Teacher / Tester cards. Inset, app UI font on the app background, agent hue as a left rule, name and avatar in the header. **The never-rule, enforced here:** no AI text is ever rendered in a slide's fonts, on a slide's background, or inside a crop's bounds; a card that needs to point at a crop draws a **callout rule** to its edge and lives outside it. Delegates the body to the existing `Message.svelte`. |
| `components/PageChip.svelte` | **new** | Compare-on-hover: a ~280 px panel with the source page rendered and the segment's rectangle outlined on it. Reuses `store.loadRoomSource()`'s renderer path. |
| `components/WhisperPopover.svelte` | **new** | Anchored, ephemeral, Ellie-only, with the self-limits opening line and **Insert into the document** (which creates a new shared card; it never moves or reveals the private one). |
| `lib/flowview.ts` + `.test.ts` | **new** | Every number as a pure function, in the shape of `lib/pdfview.ts`: `cropRect`, `cardHeight`, `tickPositions`, `snapToTick`, `splitAt`, `mergeAdjacent`, `reorder`, the undo stack, `SPLIT_ENABLED`. Unit-tested against the Critique 1 page boxes. |
| `components/PdfViewer.svelte` | **mod** | Gains `canvasFor(page)` / `ensureRendered(page, scale)` and exports `sizes` and `scale`. **Not replaced** — it remains the Original-pages renderer and the compare panel's renderer, and `fitMode`, per-page `sizes`, `release()` and the zoom ladder all stay. Loses the page-range toolbar. |

**Three rules that are bugs if broken.** `devicePixelRatio` never enters a segment rectangle (the
card uses `scale` only). Use the page's own size, never page 1's. Round to CSS pixels at the last
possible moment, and derive the drawn rectangle and the crop's source rectangle from the same rounded
integer.

### 4.2 The actor and orchestrator — Teacher + Tester

| Change | Where |
|---|---|
| **The Teacher contract.** `roleBlock('peer')` is rewritten: Ellie explains, answers, builds on the slide, and tracks what she has taught in this flow session. The clause *"never the claim they are explaining"* and the `design-brief.md` §D1 no-complete-explanation contract are **retired** (#32). | `src/room/prompts.ts` |
| **The Tester contract.** `roleBlock('challenger')`: when handed off to, Max asks the learner to explain or apply **one recently taught concept**. One move per turn, one question per turn, quote the learner's own words — kept, they do the pedagogical work. *"Never supply the answer you are fishing for"* — **kept**; a tester that answers its own quiz is useless. | `src/room/prompts.ts` |
| **Labels and roster.** `ROLE_LABEL` → `teacher` / `tester`. `rosterFor()` returns two profiles; Theo leaves the standing roster. `LATENCY` is **unchanged** — Max still holds 9–12 s (Tan et al.), and that is a report paragraph. `VERB` is per role and the Tester's is **`reading`**, not `thinking`: §B9 and beat 11 both name the act rather than a mental state (*corrected 16 Sep — this row already said Max reads; only the code disagreed*). | `src/room/agents.ts` |
| **Stored role strings are not renamed.** `participants.role` keeps `'peer'` and `'challenger'`; only the display and prompt layers say Teacher and Tester. Renaming the column would need a migration and would touch every historical room for no learner-visible gain — the same reasoning already used for `rooms.module_code`. Add one mapping function and a comment saying why. | `src/room/agents.ts`, `views.ts` |
| **`PROMPT_VERSION` bumped** to `prompts.v0.2`. Check before editing whether `roleBlock()` enters `prefix_sha256`; if it does, bump rather than contort the text to preserve a hash — new documents open new rooms anyway. | `src/room/prompts.ts` |
| **The hand-off rule.** `ruleDecision()` consults `handOffDue(input)` **before** the model call and returns a `challenger` turn with `moveType: 'quiz'` and a `targetElementId` from the taught set. Rules decide first; the model is consulted only when they have not — unchanged architecture, one more rule. | `src/room/orchestrator.ts` |
| **Deleted:** `DISAGREEMENT_QUOTA`, `mustDisagree`, the `disagreement` field's plumbing through `actor.ts` and `prompts.ts`, and the disagreement marker in the script. The group framing is gone (#32); MASG is cited once, as the reason the count stops at two. | `orchestrator.ts`, `actor.ts`, `prompts.ts`, `llm/script.*.ts` |
| **`src/room/flow.ts` — new, and the only place the constants live.** `SESSION_GAP_MS = 20 min`, `FRESH_MIN_MS = 3 min`, `FRESH_HALF_LIFE_MS = 2 h`, `FRESH_HORIZON_MS = 6 h`, `FLOW_TURNS_K = 3`, `FLOW_WINDOW_MS = 10 min`, `MIN_TAUGHT = 2`, plus a **demo profile** (k = 2, window 3 min) selectable in Settings. Functions: `openSession`, `closeSession`, `taughtSet`, `freshness`, `handOffDue`. Pure, fake-clock tested. **The constants are #33's discussion; the mechanism is not blocked on them.** | `src/room/flow.ts` |
| **The ledger is unchanged.** The four hard rules, the verbatim-evidence check, the 0.6 confidence floor, agreement-is-not-evidence and the `defended` gate all stand; they now score quiz answers instead of free-form explanation. Only the key changes, and that key comes from the pipeline's migration. | `src/room/ledger.ts` — **do not open except to change the key** |

### 4.3 The REFERENCE answer path

A **new scope**, not a new agent. `src/room/reference.ts` builds an `LlmRequest` with
`meta.scope = 'reference'` over the segment's extracted text plus the learner's question, and
**hard-truncates at 120 words in code** — not in the prompt. `prompts.reference.ts` states the
register-not-disguise rule: it may adopt the deck's vocabulary, notation and formality; it may not
adopt its appearance, wear a persona, use the first person, or ask a question. One `participants` row
with `role = 'reference'` is created with the room; the orchestrator never selects it.

**Four properties enforced in code, each with a test.** A reference answer (1) does not take the
turn floor and does not increment `consecutiveAgentTurns`; (2) does not reset the silence timer's
stage counter; (3) can never be ledger evidence — trivially true, since evidence must be a learner
message, but assert it anyway; (4) **locks Ellie and Max out of that segment's thread until the
learner presses *Explain it back***. Property (4) is the mechanism that turns "the AI gave me the
answer" from the disease into the hook, and it is the single most important line in this section.

### 4.4 `ScriptedClient` — the whole video path, offline

`script.critique1.ts` is a new beat table over the Critique 1 deck with cues `open`, `ask:1`,
`student:1…4`, `handoff:1`, `silence:1`, `whisper:1`, `insert:1`; `ScriptedBeat` gains an optional
`segment` field; `scripted.ts`'s `#textFor` gains `case 'reference'`;
`script.critique1.segments.ts` seeds the demo's segment rectangles so a fresh install replays with no
hand-made cuts. **`script.psd-hessian.ts` stays** — `actor.test.ts` runs on it and breaking it would
cost a day.

Two things stay live on camera and must be said: the learner's typing is real (the ledger's evidence
is lifted verbatim from what is actually typed, so rule 1 really passes), and **the split is real** —
the tick is clicked, not replayed. Only the *turns* are scripted.

### 4.5 What is deleted

| Deleted | Why | Keep |
|---|---|---|
| **"Show the room · p. N"** — `store.showTheRoom()`, `IPC.showDocument`, its `main/ipc.ts` handler and the `DocumentPane` CTAs | It is what the whole app now does: a segment *is* the room. **This is a feature the pivot removes, which is evidence it is a simplification rather than an addition — say so in the report.** | The `message_refs` table and `referenceBlock()`, so historical transcripts still render; and `loadRoomSource()`'s renderer, which becomes the compare-on-hover panel. |
| **Room presence chips** and the **cast introduction** | The social-group framing is gone (#32). Two named helpers do not need a cast list. | — |
| **The S2 disagreement quota** (§4.2) | Same. | — |
| `RoundCard.svelte`, `src/room/roundcard.ts`, `roundcard.test.ts` | A round card is a system message in a stream that no longer exists. | Its **pacing disclosure** becomes the one-time first-open strip. Non-negotiable: undisclosed pacing is performative deliberation. |
| `RecapCard.svelte` and the recap overlay | The flow *is* the recap. | The **correction block** moves to a close-out sheet on the status bar. A session that ends with a learner confidently wrong is the primary harm this design can cause. |
| `SessionSetup.svelte`, `store.goSetup()`, `setupFrom`, `IPC.draftConcept` as a blocking step | A document opens straight into the flow. | `draftConcept` survives as a lazy per-segment call; `IPC.createSession` is called implicitly on first open. |
| `LedgerRail.svelte`, `LedgerRow.svelte` | Replaced by the gutter glyphs. | Glyphs, wording and the 400 ms animation carried over verbatim. |
| `SourcePane.svelte`; `PdfViewer`'s `locked` / `pageWindow`; the page-range toolbar (`pageFrom`/`pageTo`, `validateRange`, `markStart`) | Superseded by the flow and by "+ Ask here". Deleting the range toolbar also closes `ui-review-code.md` §5.4 by removing the surface that had the bug. | `store.docScroll` / `docPage`. |
| `Room.svelte` | Replaced by `FlowCanvas.svelte`. | `Thread`, `Composer`, `Message`, `ThinkingIndicator`, `WaitLine`, `Divider`, `RelayOffer` — **all re-slotted, none rewritten**. |

### 4.6 What is kept untouched

Do not open these except to add a field: `src/room/timer.ts` (only the idle *predicate* changes, never
the machine or its constants) · `src/room/ledger.ts` · `src/room/context.whisper.ts` and the
`GroupStore` separation **and its leak canary — extend, never relax** · `src/room/mailbox.ts`,
`records.ts`, `views.ts`, the outbox and `events` · `src/main/apikey.ts` · `src/main/llm/claude-cli.ts`,
`backend.ts`, `detect.ts` · `src/main/vault/*` (scan, finder, `pdf.ts`, FTS5) ·
`VaultSidebar`, `VaultBrowser`, `FileTree`, `Finder`, `Library` · `src/main/menu.ts`,
`lib/viewer.ts`, `lib/pdfview.ts` · migrations 001–008, forward-only.

---

## 5. Risks, ranked

| # | Risk | Mitigation | Retire by |
|---|---|---|---|
| **1** | **The flow reads as a PDF viewer with ticks** (`segmentation-lazy-split.md` §3.1). The pivot's visible value evaporates and beat 4 of the video falls flat. | What does the work: build-step chips, the "+ Ask here" lines, the drag handles, and a REFERENCE card plus a live thread visible above the fold on page 1 of the demo. Judge it on the real deck at a real window width, out loud. If it fails, the fix is an auto-split at unambiguous title-band gaps — free, local, no model. | **Wed 17, 18:00** |
| **2** | **The geometry pipeline lands late, or with a contract the renderer cannot consume.** Everything in §4.1 sits on it. | Declare the `Segment` type in `shared/types.ts` **tonight** and code the renderer against it plus a hand-written Critique 1 fixture. If the pipeline slips, the fixture drives the demo and the video is unaffected. Read `app/docs/SEGMENTS.md` the moment it exists and reconcile in one sitting. | **Tue 16, EOD** |
| **3** | **Blank or flickering cards on camera** — a crop drawn off a canvas that `release()` has evicted, or a card rendered before its page is measured. | The flow owns its own render-at-card-scale path with a small LRU; the placeholder is painted in the page's own background colour, never white. Scroll the 7-page fixture end to end ten times and watch. | **Wed 17** |
| **4** | **The Teacher/Tester rewrite breaks the suite or the frozen prefix.** 267 tests and every historical room's `prefix_sha256`. | No DB role rename; display-layer mapping only; bump `PROMPT_VERSION` rather than contorting prompt text; `npm test` before every commit; keep `script.psd-hessian.ts` alive for `actor.test.ts`. | **Tue 16** |
| **5** | **The hand-off never fires on camera.** Flow-state thresholds tuned for a study sitting are far too slow for a six-minute demo. | The demo profile in `flow.ts` (k = 2, window 3 min), selectable in Settings, **disclosed on camera in one clause**. An undisclosed demo profile would cost the ownership mark; a disclosed one costs nothing. | **Thu 18** |
| **6** | **A whisper leaks into the shared flow or an export.** The product's most novel component and its most dangerous failure. | Extend `context.test.ts`'s canary to walk the flow renderer's import graph and to assert no `visibility='private'` row reaches a shared card or any export path. Never relax it to make a build pass. | **Fri 19** |
| **7** | **Recording-day dependency on a model or a network.** | Record on `scripted` with the network off. The whole video path replays offline by construction (§4.4). Rehearse the full storyboard five times on Sat. | **Sat 20** |
| **8** | **The report is unwritten on Monday morning**, or overruns 2,000 words. | Steps 1 and 2 are pivot-independent and are drafted in the Tue and Wed evening slots. Steps 3 and 4 are drafted Thu and Fri. Monday is editing and submission only. | **Thu 18** |
| **9** | **The evidence tier for the pivot is 3, not 1** — no participant ever complained about the split screen. | Send the §F3 follow-up **tonight**. If nothing comes back, write the one honest clause — *"no participant raised the split-screen workflow; this is a design decision, not a finding"* — and carry it on Joshi & Vogel. A stated designer-led decision costs nothing; an undeclared one costs the evidence mark. | **Thu 18** |

---

## 6. Report skeleton — 2,000 words

References and appendices are excluded from the count.

| Section | Words | Marks it serves | What it must contain | Cites |
|---|---|---|---|---|
| **Step 1 — What remains difficult** | 500 | **Learning Problem and User Needs, 4.0** | Three participants by programme, year and gender (never names or IDs); the specific task; how they use generative AI now; the difficulty named as **uncritical use of AI output** with direct quotes or observed behaviours; the user needs, including — at whichever evidence tier the transcripts honestly support — *the answer lives away from the material*. | `interview-guide.md`; #23; `pivot-spec.md` §F2 tiers 1–3 |
| **Step 2 — Learning goal and roles** | 550 | **Learning Design, 4.0** (first half) | The goal: **defend an explanation of one slide concept in your own words**. The progress mechanism: the Explanation Ledger, ○ → ◐ → ●, with *defended* unreachable without a Tester probe. Division of labour: the Teacher explains, the **learner** explains back, the Tester quizzes. Why conversational, and why a quiz alone cannot do it. DG1–DG5, each with a theory and a user need. | #32 (roster); #33 (flow session; testing effect, spacing); Xu et al. CHI '26; MASG (once, as the reason the count stops at two); Tan et al. (latency); Houde et al. IUI '25 (learner-operable rate control) |
| **Step 3 — Implementation plan** | 400, of which **≤ 150** on the document format | **Learning Design, 4.0** (second half) | Electron + Svelte 5 + SQLite; pdf.js crops with **no model anywhere in the segmentation path**; the rules-then-model orchestrator; Claude Haiku 4.5 for turns and Sonnet 5 for orchestration, or the local Claude CLI; what was built by hand versus what leaned on an LLM. The four-approach comparison is **appendix material**, not body text. | #25; `pdf-fidelity-segmentation.md` §C; `segmentation-cost.md` §5; `segmentation-lazy-split.md`; Houde §7.2.6 (external decision logic) |
| **Step 4 — The prototype** | 450 | **CUI Prototype and Interaction, 3.0** | One complete multi-turn interaction, compressed: Ask here → REFERENCE → explain it back → Teacher → hand-off → Tester → ledger. What is real and what is scripted, stated plainly. The §2 beat script as an appendix. | This plan §2 and §4; `pivot-spec.md` §B1, §B5 |
| **Limitations** | 100 | protects all four | Joshi & Vogel's **null result** on delayed comprehension, and why *defended explanation* is a different and unvalidated construct; the flow-session constants are untested; slides only. | `pivot-spec.md` §F2 |
| **Video** | — | **Individual Video and Ownership, 5.0** (2 demo / 2 explanation / 1 ownership) | §2. Beats 1–3 and 16 carry 3 of the 5 marks and need no app. | — |

**Appendices, excluded:** the 16-beat script; the segment schema and migration 009; the safeguards
table; the genre table from `segmentation-genres.md` §H; the four-approach document-format comparison.

---

## 7. What is out of Assignment 1

Named here so the report can say they were **chosen**, not missed.

| Out | Where it lives |
|---|---|
| On-demand vision "suggest cuts" — stronger ticks and proposed names, never an automatic split | **#26** |
| One-column papers and typeset readings (cross-page merge, adaptive gap) | **#27** |
| Two-column research papers (column bands, floats, Docling as a cut proposer) | **#28** |
| Scanned PDFs, with and without an OCR text layer | **#29** |
| Handwritten notes (GoodNotes exports, ink-band cuts) | **#30** |
| The full genre router with per-genre handling — **A1 ships only the ten-line honest labeller** from `segmentation-genres.md` §H, which is what makes video beat 15 true | **#31** |
| **Theo / the Tutee.** Folded into the Tester's quiz: a teach-back *is* a quiz. Not a third agent for A1 | #32 |
| Export — pdf-lib flatten to `~/Documents/ChatterED/<name>-annotated.pdf` | A2 |
| The `.chattered.json` sidecar. SQLite is the source of truth and the demo never needs the mirror | A2 |
| Firestore mirror. The `outbox` table and the interface exist; the drain does not | A2 W5 |
| Cross-page merge; vertical cuts on two-column slides; reflow mode | A2 |
| The coverage-map primitive and "Teach this page" (`pivot-spec.md` §B6, §B7) | A2 |
| Reduced-motion, full keyboard traversal of the flow, and the narrow-window docked layout below 1100 px | A2 |
