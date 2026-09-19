<!-- Extracted verbatim from docs/research/flow-build-plan.md §2 by tools/make-submission-zip.sh.
     The plan is the source of truth; edit it there, not here. -->

## 2. The video — 16 beats, ≤ 10 minutes

**Re-cut 19 Sep 2026 for #47**, against `attempt-first.md` §6, which supersedes the version of this
section that filmed the time-based hand-off as the Tester's only door. The hero interaction is now
the **attempt loop**: ~5½ of the 10 minutes on it, document machinery compressed into one beat, and
the whisper down to a sentence.

**Deck:** `Academia/Sources/btw interaction/A0282987E_LohZhengLucas_Critique1_slides (1).pdf` (#32) —
7 pages, 16:9, tagged, committed, and it is Lucas's own work, which removes any question about showing
someone else's material on camera. **Backend:** `scripted`. **Network:** off. The learner's lines are
typed live and are `CRITIQUE1_LEARNER_LINES` in `app/src/room/llm/script.critique1.ts`.

**Four filming rules.** (1) One deck, one scroll position per beat, camera still. (2) The first thing
the viewer sees the machine do is *propose*, not *write* — a tick, not a paragraph. (3) Say "scripted"
the first time something is scripted, then stop apologising: `ScriptedClient` replays real turns
through the real actor, the real rules, the real ledger gates and the real whisper scoping. (4) Face
visible throughout the talking beats — 5 of the 16 marks depend on it.

**One deviation from the brief, stated here rather than discovered in the edit.** §6 says the loop
runs on *one* slide. It runs on **two cards**: the lower half of page 3 and page 5. The "+ Try this"
pick is scoped to the objectives the card teaches (§2.1), and page 3's lower card teaches exactly one,
so a second question on a row still at ○ has to come from another card. One scroll, and beat 9 says
why out loud — which is a better demonstration of *"questions based on my weaknesses"* than a second
question on the objective just answered would have been.

| # | t | Frame | What happens | What is said |
|---|---|---|---|---|
| 1 | 0:00 | Face | Name, module, the task in one sentence. | "One learning task: reading a lecture deck and being able to defend what it says — in your own words, not the machine's." |
| 2 | 0:25 | Face + quote slide | Step 1 in 40 s: the coded study of six real AI study sessions, the difficulty, one verbatim quote. | "In five of six sessions, not one learner turn contained the learner's own attempt — and the AI never asked for one. Every offer to quiz was declined. The difficulty is **reduced persistence**: *[verbatim quote]*. The one session that worked, worked because the learner typed *'I will attempt the question'* and *'do not send the answer'*." |
| 3 | 1:05 | Two screenshots | Old: PDF left, chat right. New: the flow. | "Everything they showed me was this shape, and the attempt ends up in neither half. So I moved the conversation into the deck — and made the learner go first." |
| 4 | 1:25 | **App, real** — the whole document machinery, one beat | Open the deck from the vault: seven crop cards, a build-steps chip. Scroll to page 3, hover a tick, click it — the card divides in place. Toggle **Original pages** on and off. | "Their own file, out of their own folder — each card is a crop of the rendered page, so the maths and the figures are the lecturer's pixels. Those ticks are the page's own geometry saying where a boundary *could* go: local, no model, no network. That split was a number changing, not a re-render, and the toggle proves it — nothing was ever converted." |
| 5 | 2:05 | **+ Try this** | The second faint line under the new card. Click it. The thread opens and the Tester asks **one** question, back in 4 s. | "Two lines under every card. *Ask here* gets me an explanation. *Try this* gets me a question — and it is a button, not an offer I can decline, because a declinable offer is exactly what all six of those sessions declined. It came back in four seconds, not eleven: I asked for it." |
| 6 | 2:35 | **The attempt, typed** | The learner types the attempt in full, on camera. Nothing else speaks. | "This is the turn that did not exist in five of six transcripts. Nobody is talking over me while I write it, and the app will not answer its own question while it waits." |
| 7 | 3:15 | **Grounded feedback** | Amber ring, `Max is reading…`, the counter climbing 9–12 s. Then feedback: **Partly there** first, then what landed, what was missing, the correction — each with a `p. 3: "…"` quote of the page's own words — and one follow-up question at the end; the composer now reads *Your next attempt…* | "Eleven seconds, deliberately: Tan et al. found two-second replies read as less thoughtful, and nine got the best usefulness ratings. And every judgement in there cites the slide. In the session I coded, the AI's verdict on the learner's answer was wrong 11 times out of 21 — nine of them calling a correct answer wrong — and the learner replied 'ok'. You cannot say 'ok' to a quote you can read." |
| 8 | 4:05 | **The ledger moves** | `○ → ◐` on the whisper-analogy row, with the learner's own sentence quoted under it. The limit-tests row does not move. | "That moved because *I* wrote it — the rail quotes my sentence, and rule one is that the evidence has to be a verbatim substring of something I typed. Agreement moves nothing. And notice what stayed at ○." |
| 9 | 4:35 | **Try another** | The control under the feedback. On the page 5 card, **+ Try this** again; the question is on the row still at ○. | "The next question is picked by level, lowest first. One of my participants wrote that she could not track her own progress, so she prompted it to ask questions about her weaknesses — that is this button." |
| 10 | 5:00 | **The answer, withheld** | The learner types *"what's the answer?"* — R6's own words. One narrowing hint comes back, one clause saying a single try unlocks the answer, and **no answer**. Under the composer: *"Max won't give the answer until you've tried once."* | "This is the design decision I most want to be judged on. In the session I coded, that question was asked five times before the learner imposed attempt-first by hand — and answered five times. Here it is refused, and it is refused by a rule in the orchestrator that runs before any model is consulted. The model is never asked whether to answer its own question." |
| 11 | 5:45 | **+ Ask here**, mid-quiz | On the same card, the Ask line. The Teacher answers the *prerequisite* — what "a strict subset of the main session" means — and says she will not answer the Tester's question. | "The explain path never goes away; it is one click, and it answers first. What it will not do is do the quiz for me. The deck assumes I know what a session's context is and never defines it — so the thing I was actually missing was never the answer." |
| 12 | 6:25 | **Second attempt, second feedback** | The learner types the second attempt. *Partly there* again, grounded on page 5, ending on a follow-up, and `○ → ◐` on the limit-tests row. | "Same loop, harder question, and the same two quotes underneath it. Both rows are at ◐ now. Neither is at ● — that one needs a challenge I have survived, and I have not." |
| 13 | 7:05 | **Show the answer** | The control is visible now, and was not before. Click it: the model answer, with its grounds, and a line naming what the attempt already had. The rail does not move. | "Available now, because I have tried once. Watch the rail while it arrives: nothing moves. I read this, I did not write it — so it is logged, and it earns me nothing." |
| 14 | 7:35 | **Whisper popover** | `⌘K`; the embarrassing question; a private answer; **Insert into the document**. | "One sentence on this: `/btw` from my Critique 1 claimed it could send something back and couldn't — this can, with my permission, and that is the only path from private to shared." |
| 15 | 7:50 | **Compare-on-hover** + **a scan** | Hover the page chip: the source page with the segment outlined. Then open a scanned PDF: whole pages, with the notice. | "When it is not a slide deck it says so and gives you whole pages. It is honest about what it cannot segment, which matters more than pretending." |
| 16 | 8:05 | Face, 1:30 | Division of labour · one design decision · one limitation · real vs scripted. | Decision: *"The answer is withheld until the learner has typed one attempt — and that is a rule in the orchestrator, not a line in a prompt. `classifyLearnerTurn` reads the turn, `rule:answer_withheld` fires, and the model is never asked whether to answer its own question. It is the protocol one of my six learners built by hand, made the default."* Limitation: *"Feedback grounds are asked for, not verified. The prompt requires a `p. N` quote; nothing in the code checks it against the page — the scripted path is checked in a test, a live model is not. The SQL session is exactly why that is A2's first job: 11 wrong verdicts out of 21, and the learner accepted them."* |

Budget lands at **9:35**, 25 s under the cap, with the attempt loop (beats 5–13) at **5:30**. **Beats
1–3 and 16 carry 3 of the video's 5 marks** and depend on nothing in the app — record them first, on
Sun 21 morning.

**Fallback storyboard.** If the attempt loop's actor side (#47 Tracks A and B: `flow:tryHere`,
`classifyLearnerTurn`, `rule:answer_withheld`, `rule:answer_shown`) is not green by Saturday, beats
5–13 are filmed on the **secondary door** instead: the learner keeps the thread going, the time-based
hand-off fires by rule, and the same two questions and the same two grounded feedback turns arrive in
the same order — `script.critique1.ts` asks C2 then C1 at *both* doors for exactly this reason. What is
lost is beat 10, the withheld answer, which is the one important design decision; so beat 16 says
instead that the rule is specified, tested at the script level, and not in this build, and beat 5
becomes *"this door is the design and here is the door that shipped"*. If segmentation falls over,
beat 4 collapses to *"every page is one segment; splitting is specified and is not in this build"* and
the fidelity proof moves onto beat 15, which is stronger anyway. Beats 1–3 and 16 are unchanged in all
three worlds.
