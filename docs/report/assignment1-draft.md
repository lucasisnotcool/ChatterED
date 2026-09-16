# Assignment 1 — ChatterED: putting the conversation inside the lecture deck

**Body word count: 1,870 / 2,000** as drafted — Steps 1–4 and Limitations only. The title block,
references, appendices and *Notes for Lucas* are excluded, as the brief allows ("the 2,000-word
limit covers the core text only, excluding references and optional appendices"). The `[LUCAS: …]`
brackets are instructions to you, not submission text; replacing them with your participant
details and quotes will add roughly 150 words, so there is about 130 words of headroom. Re-count
before you export.

Section budget against `flow-build-plan.md` §6: Step 1 = 340 + your quotes (budget 500),
Step 2 = 684 (550), Step 3 = 376 (400), Step 4 = 369 (450), Limitations = 101 (100). Step 2 runs
long and Step 4 short; if you need room, the easiest cut is DG5 or the division-of-labour table.

*Draft for Lucas to edit. Every `[LUCAS: …]` marks content only I can supply.*

---

## Step 1 — What remains difficult after AI assistance

### 1.1 Learner and task

I interviewed three NUS undergraduates who already use generative AI weekly or more for one
task: **[LUCAS: the exact task line you used in every session — e.g. "justifying why a step in
a constrained-optimisation solution is valid, in your own words"]**. Participants, by the only
attributes I recorded: **[LUCAS: P1 — programme, year, gender; P2 — …; P3 — …]**. Each session
ran 35–40 minutes — verbal consent, a 15-minute interview, then a 10-minute think-aloud on a
real problem they brought themselves. I recorded programme, year and gender; never names,
student IDs or NUSNET IDs.

Their current workflow was the same shape in all three sessions: the lecture PDF open on one
side of the screen, a chat window on the other, the question or a screenshot pasted across.
**[LUCAS: two or three sentences on what they actually paste — question only, question plus
attempt, screenshot, whole PDF — from your §5 observation sheet. Quote one.]**

### 1.2 The difficulty: uncritical use of AI output

Of the brief's four categories, the evidence points at **uncritical use of AI output**: the
learner can obtain a correct, well-written answer, but struggles to explain, question or verify
it with their own reasoning. In this task it looks like this — the model names the theorem and
produces the derivation; the student can reproduce it; but asked *why that condition applies
here and not in the next question*, the explanation stops.

> **[LUCAS: the verbatim Block 5 completion — "I can get an answer for ___, but I still can't
> ___ on my own." This quote is the spine of the whole report.]**

> **[LUCAS: a second quote from Block 3 — the moment something broke in the 30-second
> explain-with-the-screen-covered attempt.]**

Observed behaviours support the self-report: **[LUCAS: from the §5 sheet — time unaided before
the first query (`t_ai − t_read`), whether an own attempt was typed first, and the verification
tally. "Across three sessions I counted N verification acts" is worth more than any quote if
the number is low.]**

### 1.3 User needs

- **N1 — Produce a justification, not receive one.** They can get the answer; what they cannot
  do alone is say why it holds. **[LUCAS: quote]**
- **N2 — Be pushed without being judged.** **[LUCAS: from §6a — why they do not push back in
  tutorials, or on the model]**
- **N3 — A low-cost way to ask the question that looks basic.** **[LUCAS: the §6a probe — what
  fraction of your questions do you actually post, and what gets DM'd instead?]**
- **N4 — Keep the answer attached to the material.** *No participant raised the split-screen
  workflow unprompted; this is a design decision, not an interview finding.* **[LUCAS: upgrade
  this sentence only if the follow-up (Q1/Q2) came back — if someone described losing track of
  which answer went with which slide, quote it here and delete this caveat.]**

### 1.4 How a CUI could help

A conversational partner can do what a document cannot: ask the learner to say it, notice what
was not said, and press on that. It can also withhold — the difficulty is not a shortage of
explanations, so a system supplying a better one makes it worse. What is missing is an
interlocutor for whom only the learner's own words count.

## Step 2 — The learning goal and the CUI's role

### 2.1 Learning goal

**The learner can defend, in their own words and without reading from the screen, an
explanation of one concept from their own lecture slide.** Progress is tracked by the
**Explanation Ledger**: each concept is a row with three states — ○ *stated*, ◐ *justified*
(they gave the reason it holds), ● *defended* (the justification survived a probe and was not
retracted). Three rules make it evidence rather than applause: only the learner's verbatim text
moves a row; agreement ("yes, exactly") is not evidence; and **● is unreachable without a Tester
probe**.

### 2.2 Division of labour

| The learner does | The CUI does |
|---|---|
| Decides where one concept ends and the next begins | Proposes boundaries from page geometry; never cuts on its own |
| Asks the question, at a place they chose | Answers once, neutrally, in ≤ 120 words, then hands back |
| Explains the concept back, and answers the quiz in their own words | Teaches from the slide, tracks what it covered, then quizzes one covered concept and gives feedback |
| Writes the last word of every exchange | Never writes the learner's conclusion |

Two agents: **Ellie the Teacher** explains; **Max the Tester** quizzes when handed the floor and
never answers his own question. This departs deliberately from Xu et al.'s Peer, whose contract
forbade supplying a complete explanation: I separate teaching from testing and keep
learning-by-explaining as the *graded* moment rather than the whole session.

### 2.3 Why conversational

A quiz app could ask the same question. It could not choose it from what *this* learner was just
taught, judge whether a free-text answer is a justification or a restatement, or follow up on the
weak half of it. The ledger's ● is defined as surviving a challenge, and a challenge is a turn.
Xu et al. (2026) measured the gap: explaining to a responsive agent produced 121–141 cognitive
acts per session against 61 for a non-responsive control, which logged 49 turn-*closing* acts
instead.

### 2.4 Design goals

**DG1 — Make the learner produce justification, not answers.** *Theory:* the self-explanation
effect and learning-by-explaining (Chi et al., via Xu et al., 2026 §2.1). *Need:* N1.
*Realisation:* agents never state the target explanation; only verbatim learner text moves the
ledger; the terminal state is *defended*, not *stated*.

**DG2 — Inject cognitive conflict without evaluation apprehension.** *Theory:* Piagetian
cognitive conflict and Socratic questioning; an agent's low social presence strips the evaluation
apprehension a human tutor carries (Xu et al., 2026 §6.1.3). *Need:* N2. *Realisation:* the
Tester asks one question, hedges contestable claims, and the learner closes the exchange.
*Evidence:* Xu et al. report critical thinking 5.62 vs 3.74 control (*p* < .001, η² = 0.29) at a
*lower* felt pressure than their tutee condition (2.93 vs 4.02).

**DG3 — The learner authors the material.** *Theory:* Joshi & Vogel (2026) found readers
preferred selecting the passage themselves, and that lower AI involvement produced stronger
ownership. *Need:* N4. *Realisation:* nothing is pre-annotated; geometry proposes cuts as faint
ticks and only a click splits, so every boundary in the log is the learner's.

**DG4 — Give the learner a private, low-cost way to participate.** *Theory:* invisible
whispering — silent, ephemeral side-channels raise participation and politeness (Dennis et al.,
2010). *Need:* N3. *Realisation:* a whisper popover answered privately by the Teacher, with an
*insert into the document* escape hatch that is the only path from private to shared. It closes a
gap I diagnosed in Critique 1: `/btw` claimed it could send a private answer back into the group
and could not.

**DG5 — Buy engagement with pacing, never with pressure.** *Theory:* Song et al. (2025) found
normative influence rises with agent count while informational influence does not — I cite their
multi-agent paper as the reason to *stop* at two. Tan et al. (2026) found 2-second replies read
as less thoughtful, usefulness peaking near 9 s. *Realisation:* two agents; replies held to a
role band (Teacher 4–6 s, Tester 9–12 s) behind a visible counter, never a hidden delay; the
Tester can be declined or set quieter.

## Step 3 — Implementation plan

**Form.** A hybrid CUI+GUI desktop app in which the document *is* the conversation surface:
Electron, Svelte 5 and TypeScript over SQLite, running locally on macOS so lecture files never
leave the student's machine.

**The document format — one decision, one reason.** A segment is a **crop of the pdf.js-rendered
page**, never re-typeset. Fidelity stops being a quality target and becomes an invariant: there
is no code path that can alter a slide's pixels, so the lecturer's equations and figures cannot
be silently corrupted. Splitting a card changes one number in page space, which is why it is
instant and why "Original pages" is a toggle rather than a re-import. (The four-format
comparison is in Appendix C.)

**Segmentation has no model in it.** Four local stages — collapse progressive-reveal builds,
extract text and ink boxes, drop page chrome, propose cut lines — run offline, free, in
milliseconds; on my seven-page demo deck they propose 4/2/3/0/2/3/4 cuts per page. A ten-line
genre router opens anything that is not a slide deck as whole pages with a notice, rather than
guessing.

**Components I built by hand**, because each carries a design decision: the room actor (one
writer, serialised mailbox); the silence timer; the latency scheduler; the **rules-then-model
orchestrator**; the ledger and its evidence rules; the flow-session module (boundary, covered
set, freshness, hand-off) with every constant in one file; and the whisper's context scoping,
with a test that walks the import graph for leaks. The orchestrator deserves a note:
deterministic rules decide first, a Sonnet 5 call is consulted only when they have not, and a
model that asks for the Tester outside a hand-off is demoted. Houde et al. (2025 §7.2.6) reached
the same conclusion in deployment: *"its decision-making quality was poor. We resorted to using
external decision logic."*

**What leans on an LLM at runtime:** agent turn text (Claude Haiku 4.5, or the local Claude CLI),
the orchestrator's structured decision and ledger coding (Sonnet 5). **What leaned on an LLM to
build:** scaffolding, test generation and research synthesis, under my design decisions — every
prompt, threshold and gate in the list above is mine, and the architecture, the roster and the
segmentation decision are recorded as dated decisions in the repository's issues.

## Step 4 — The prototype

The prototype is a running app, demonstrated on a seven-page deck of my own. One multi-turn
interaction, end to end:

1. **Open.** The deck opens as a flow of seven cards, each a crop of a rendered page, with faint
   ticks in the gutter where geometry says a boundary could go.
2. **Split.** I click a tick on page 3 and the card divides in place; seven cards become eight.
   Nothing re-rendered — visible proof that nothing was ever converted.
3. **Ask here.** A faint "+ Ask here" line sits between cards. I click it and type a question.
4. **REFERENCE.** A neutral grey card inserts into the flow, in the app's UI font so it cannot be
   mistaken for the slide: 100 words, then a hand-back line. It moves no ledger row — nothing you
   *read* counts — and both agents are locked out of the thread until I press **Explain it
   back →**.
5. **Teach.** I explain it back; Ellie replies after 4–6 s, building on the slide.
6. **Hand-off.** On my fourth turn, with two concepts covered and the freshest older than three
   minutes, Ellie posts *"You've covered X and Y — Max, over to you."* That line is written by a
   rule, not generated, and is labelled **BY RULE** on screen.
7. **Quiz.** Max's avatar rings amber, a counter climbs to ~10 s, and one question lands — on the
   concept taught four minutes ago, not the sentence just read.
8. **Ledger.** My answer moves two rows: one to ● *defended*, one to ◐ *justified*, followed by a
   mandatory feedback turn.
9. **Reopen.** Reopening the document restores eight cards, fourteen messages and the ledger.

**What is real and what is scripted.** Real and tested: the segmentation geometry, split/merge,
persistence, the actor, the timer and latency bands, the flow-session rule and the hand-off
line, the ledger gates, the REFERENCE truncation and lock, and the whisper's scoping. Scripted:
the *text* of the agent turns, replayed through the real actor, timer and gates by a scripted
backend — entering an API key runs the same code path against Haiku 4.5. I say "scripted" once
on camera and then stop apologising for it. **[LUCAS: confirm on filming day whether the ⌘K
whisper popover is wired in the flow; if not, demo the whisper in the room view and say so.]**

## Limitations

The evaluation construct is unvalidated. The nearest prior work — Joshi & Vogel (2026) — found
in-document AI notes were *preferred* and produced more ownership, but had **no measurable effect
on reading comprehension at a two-hour delay**. My measure is not comprehension but *defended
explanation*, a different construct that nobody has validated. Second, "flow" here is a
behavioural proxy for sustained engagement, not flow in Csikszentmihalyi's sense; no shipped
system triggers a quiz on interaction rate, so the hand-off is a design proposal with a logging
plan, and its constants are untested. Third, it handles slide decks only. **[LUCAS: if the follow-up came back,
your participant's own objection belongs here and is worth more than any of the above.]**

---

## References

Dennis, A. R., Rennecker, J. A., & Hansen, S. (2010). Invisible whispering: Restructuring
collaborative decision making with instant messaging. *Decision Sciences*, 41(4), 845–886.

Houde, S., et al. (2025). Controlling AI agent participation in group conversations. *IUI '25*.
arXiv:2501.17258.

Joshi, A., & Vogel, D. (2026). Designing and evaluating AI margin notes in document reader
software. *CHI '26*. arXiv:2509.09840.

Rowland, C. A. (2014). The effect of testing versus restudy on retention: A meta-analytic review
of the testing effect. *Psychological Bulletin*, 140(6), 1432–1463.

Song, T., Tan, Y., Zhu, Z., Feng, Y., & Lee, Y.-C. (2025). Multi-agents are social groups:
Investigating social influence of multiple agents in human-agent interactions. *Proc. ACM
Hum.-Comput. Interact.*, 9(7), CSCW452.

Tan, F. F.-Y., Messerschmidt, M. A., Yin, W., & Nov, O. (2026). The impact of response latency
and task type on human-LLM interaction and perception. *CHI '26*.

Xu, Z., Zhang, J., Tang, A., & Lee, Y.-C. (2026). Who you explain to matters: Learning by
explaining to conversational agents with different pedagogical roles. *CHI '26*.

**Appendices (excluded from the count):** A — the 16-beat demonstration script; B — the segment
schema and migration; C — the four-approach document-format comparison; D — the interview
protocol and synthesis sheet.

---

## Notes for Lucas

*Not part of the submission. What you must supply, and where every claim above came from.*

### Everything marked `[LUCAS: …]`, in order

| # | Section | What is needed |
|---|---|---|
| 1 | 1.1 | The one-line task wording you actually used in all three sessions (`interview-guide.md` §0 Variant A gives the model wording). |
| 2 | 1.1 | P1/P2/P3 by programme, year and gender. The 4.0-mark criterion names these three fields explicitly. Nothing else. |
| 3 | 1.1 | Two or three sentences on what they paste into the chat, from your §5 observation sheet, with one quote. |
| 4 | 1.2 | The Block 5 completion quote, verbatim. This is the report's spine. |
| 5 | 1.2 | A second quote from the explain-with-the-screen-covered attempt. |
| 6 | 1.2 | The observed numbers: `t_ai − t_read`, own attempt Y/N, verification tally. |
| 7 | 1.3 | Quotes for N1, N2, N3 (Block 5, §6a, §6a). |
| 8 | 1.3 | **The N4 decision.** I have written it at tier 3 (`pivot-spec.md` §F2) — declared as a design decision, not a finding. If the §F3 follow-up (Q1/Q2) came back and anyone described the answer ending up away from the material, promote it to tier 1, quote them, and delete the caveat sentence. Do **not** promote it on a Q3 answer: Q3 is a reaction to a design I described, which is Step 3 material and must be labelled as such. |
| 9 | Step 4 | Whether ⌘K/the whisper popover is wired in the flow on filming day. |
| 10 | Limitations | Your participant's own objection, if the follow-up returned one. |
| 11 | Everywhere | The word count at the top is my count of this draft; re-count after you paste the quotes in. |

Nothing in the video is drafted here: the 16-beat script with its timestamps is
`flow-build-plan.md` §2, and beats 1–3 and 16 carry 3 of the video's 5 marks.

### Where each claim comes from

| Claim in the draft | Source |
|---|---|
| Rubric structure, 2,000 words, references excluded, "programme, gender or year" | `Academia/Sources/_text/assignment1-brief.txt` §3A, §4 |
| Section-by-section word budget and what each must contain | `flow-build-plan.md` §6 |
| Interview method, 35–40 min, consent, what was recorded | `interview-guide.md` §2, §3, §5 |
| The difficulty named as *uncritical use of AI output*; the three quotes to lean on | `pivot-spec.md` §F2 |
| Tier 1/2/3 honesty rule for the split-screen claim | `pivot-spec.md` §F2 (table) |
| Ledger states and the four evidence rules; ● needs a Tester probe | `design-brief.md` §F1; `app/docs/STATUS.md` ("Ledger") |
| Teacher/Tester roster; Peer contract retired; Theo dropped | Issue #32; `STATUS.md` "Teacher + Tester" |
| Xu et al. numbers (121–141 vs 61 acts; 5.62 vs 3.74; pressure 2.93 vs 4.02) | `design-brief.md` §E (DG1, DG2) |
| Song et al. as the reason the count stops at two (MASG used *inverted*) | `masg-drop-assessment.md` §D2 point 4 |
| Tan et al. latency bands and the 9 s usefulness peak | `design-brief.md` §A3, §D4 |
| Houde et al. "we resorted to using external decision logic" (§7.2.6) | `pivot-spec.md` §F2; `flow-build-plan.md` §6 |
| Joshi & Vogel: preferred integrated notes, preferred selecting text, ownership, **and the null result at 2 h** | `pivot-integrated-document.md` §C16; `pivot-spec.md` §F2 |
| Crop-not-re-typeset as an invariant; no model in the segmentation path | `pdf-fidelity-segmentation.md` §C0; issue #25 |
| Lazy split adopted, vision pass out of A1 | `segmentation-lazy-split.md` §5; issue #25 |
| Search inside maths is broken; a crop cannot reflow; boundaries have no ground truth | `pdf-fidelity-segmentation.md` §C8 |
| 4/2/3/0/2/3/4 candidate cuts on the demo deck | `STATUS.md` ("Measured on a real deck") |
| Flow-session constants (k = 3 in m = 10 min, 20 min gap, 3 min guard, 6 h horizon) and mandatory feedback | `flow-session.md` §8.3; issue #33 |
| "Flow is an engagement proxy" and "nobody ships an engagement-triggered quiz" | `flow-session.md` §0, §6 |
| Hand-off line is built by a rule, not generated; the model cannot put the Tester on the floor | `STATUS.md` ("Teacher + Tester"); `src/room/flow.ts` |
| Every measured number in Step 4 (8 cards, 100 words, ~10 s, 14 messages, two rows moving) | `STATUS.md` "Verified live over CDP" table |
| Real vs scripted split | `STATUS.md` "Real" / "Scripted" / "Stubbed" sections |

### Two things I deliberately did not do

- **I invented no findings.** No interview transcripts, quotes or participant attributes exist
  anywhere in this repository, so every one of them is a `[LUCAS]` placeholder. The report reads
  as complete once you paste them in.
- **I did not soften the departures from the sources.** The report says the Peer contract was
  retired for a Teacher (issue #32), and that Song et al. is cited *against* multi-agent
  enthusiasm rather than for it (`masg-drop-assessment.md` §D2). Both are stronger as stated
  departures than as quiet omissions.
