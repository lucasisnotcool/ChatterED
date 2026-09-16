<!-- Extracted verbatim from docs/research/flow-build-plan.md §2 by tools/make-submission-zip.sh.
     The plan is the source of truth; edit it there, not here. -->

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
