# ChatterED — Evaluation Plan (Assignment 2 + live deployment)

**Status.** **v2, 21 Sep 2026**, rewritten against `measurement.md` and the #48 pivot
(`collab-doc.md`). v1 (13 Sep) tested three manipulations that the pivot removed: Group vs Single,
Whisper on/off, and reply latency, plus a Theo teach-back round. Those surfaces are gone (#48 §9,
#32), so v1's RQ1 to RQ3 and RQ5 were testing features that no longer exist. What survives from v1
is carried forward intact and marked: the instruments (§5), the Xu et al. coding scheme (§6.1) and
its procedure (§6.5), the logging plan (§7), the analysis machinery (§8) and the ethics work (§9).

**Owner:** single student researcher, no lab, no RA budget.
**Scope.** Everything after Assignment 1: the controlled user test Assignment 2 requires
(**Study A**), the deployment to real NUS students (**Study B**), and the self-run instrument
validation that has to come before either (**Phase A**, `measurement.md` §6).

**Companion docs.** `measurement.md` (**the source of truth for what counts as an outcome**;
this file is how those measures get collected). `collab-doc.md` (the design under test).
`progress-tracking.md` §8 (the ledger export, and the validation protocol `measurement.md` §4
rescopes). `architecture-options.md` (the stack that carries §7's logging and §9.5's residency).
`ai-use-transcripts/analysis/codebook.md` (**codebook v1.3, the A1 baseline instrument**, extended
in §6.2). `interview-guide.md` (A1 formative evidence, not duplicated here; this plan is
*summative*).

**Agents follow `collab-doc.md`:** **Ellie** writes the notes, answers, and offers the unsure
partial take; **Max** asks, marks, releases and keeps the doc correct. There is no third agent.

> **What A1 needed from this document** was one paragraph in Step 2, and it is now there: the A2
> primary outcomes are the Step 1 behaviours (attempt rate, sustained-attempt rate, revision rate)
> recoded with the same codebook, and the progress bar is gated on blind-scored agreement before
> any number from it is reported.

---

## 1. What is being evaluated, and why these three contrasts

ChatterED after the pivot bundles three claims. Each has evidence behind it and a specific way it
can fail. The evaluation exists to separate them. v1's three contrasts are replaced one for one,
keeping the structural roles they played: one **within**-subjects, one **between**-subjects, one
deferred to the free-n deployment.

| Mechanic | Bet | Plausible failure | v1 slot it replaces |
|---|---|---|---|
| **Rails** (orchestrator rules) vs **unrailed** (same model, same notes, no rules) | A contract beats a prompt: the rules decide who speaks, whether an answer is due, and what a give-up means, before any model call. Houde et al. (2025) reached the same conclusion for multi-agent chat: "we resorted to using external decision logic." | The rails produce compliance, not engagement: the learner answers because a box demands it, at the shortest length that passes, and the codes move while nothing else does. | Audience (within) |
| **Ellie's cue** on vs off | A peer who is *less* sure than you elicits more than a tutor (Xu et al., 2026). On silence, an unsure partial take gives the learner something to improve on instead of an answer. | Two ways. The cue is **echoed** rather than improved, so the bar fills on Ellie's words; or its deliberate mistake is **inherited**, and the closure rule repairs the transcript but not the learner. | Whisper (between) |
| **Release** on give-up vs **withhold** until one attempt | A learner must never see a question they never get the answer to; a lowered next question teaches more than a refused answer (`collab-doc.md` §1). | The release is the baseline failure with better manners: all 7 answer requests in R6 were granted in full, and a give-up at *t* simply buys a give-up at *t+1*. | Latency (Study B) |

The three cannot all be tested at once by one person. §3 assigns them: rails and cue to Study A,
release to Study B, with a within-session check on release in Study A as a cheap early read.

**What is no longer a contrast, and why.** Agent count is settled by design, not by experiment:
Song et al. (2025) found normative pressure rises with agent count while informational influence
does not, so ChatterED stops at two and does not spend participants proving it. Latency is now a
derived quantity (the silence threshold scales to reading time), not a manipulable factor.

---

## 2. Research questions and hypotheses

Naming: **Rails** = {On (the orchestrator), Off (same model and notes, no rules)}. **Cue** =
{On, Off}. **Release** = {Release on give-up, Withhold until one attempt}.
Primary/secondary/exploratory labels are binding. Declare them before data collection (§8.6).

**Every outcome below is defined in `measurement.md` §4.** Nothing here redefines a measure.

### RQ1 — Rails: does a contract change what the learner does?

- **H1a (primary, process).** **Sustained-attempt rate** is higher under Rails On than Rails Off.
  *Basis:* the baseline's direct evidence, R6 before and after L20: 5 of 6 questions handed back
  unattempted before the learner imposed a protocol by hand, 17 attempts and 2 requests after.
  *Confound to carry:* L20 changed difficulty at the same time (`convergence.md` §4.2), which is
  exactly why the rails version pitches difficulty by rule and the comparison holds it constant.
- **H1b (primary, process).** **Revision rate** is higher under Rails On.
  *Basis:* 0 of 17 attempts in the baseline was a second try at the same question, and 17 of 21
  feedback turns carried the next question in the same message. `rule:quiz_feedback` and the
  one-open-question rule exist to break exactly that. If revision rate does not move, the rule is
  decoration.
- **H1c (secondary, process).** The share of learner turns coded `CONSTRUCTIVE` or `INTERACTIVE`
  (codebook v1.3) is higher under Rails On. *Baseline:* 24 of 76 turns, all from one session.
- **H1d (secondary, unwelcome and directional).** Rails On produces **shorter** learner answers and
  a higher rate of `DIS-CLOSE` (turn closing, refusal to elaborate). *This is the compliance
  hypothesis, and the one this project most wants to be false.* It is stated as secondary rather
  than exploratory so a null cannot be quietly claimed as safety.
- **H1e (secondary).** No difference in pre/post concept-test gain between Rails conditions.
  *Basis:* Xu et al. found **no** objective-outcome differences across four roles at n = 96.
  Predicting a null at n = 20 is honest; this study is powered for process, not gain.

### RQ2 — Ellie's cue: does a peer's partial take elicit an attempt?

- **H2a (primary).** After a silence threshold fires, the probability that the learner's next turn
  is an `ATTEMPT` is higher with Cue On than Cue Off. *Basis:* Xu et al. (2026) on explaining to a
  less-sure peer; `collab-doc.md` §4.3.
- **H2b (primary, risk).** **Mistake inheritance.** Where Ellie's cue carried a deliberate mistake
  (`hasMistake` and its claim are recorded at cue time), the learner's next answer contains that
  claim. *Pre-set alarm: above 25%, the deliberate mistake is removed from the cue and the A2
  report says so.* No published result covers an agent that is wrong on purpose inside a tool
  whose other job is to be trusted; Song et al. is about agent count and does not cover it.
- **H2c (secondary).** **Own-words overlap against the cue** (`measurement.md` M3b) is not higher
  under Cue On than the equivalent block overlap under Cue Off. *This is the echo guard*, in the
  shape v1 gave the whisper cannibalisation guard: a one-sided non-inferiority test against a
  pre-set margin of 15%.
- **H2d (exploratory).** The cue raises Interest/Enjoyment (IMI) without raising Pressure/Tension.

### RQ3 — Release: does giving the answer on a give-up cost persistence?

- **H3a (primary, Study B).** **Give-up recurrence**: the probability that a give-up at *t* is
  followed by a give-up on the next question of the same objective, Release vs Withhold. A lowered
  question is supposed to produce recovery; the baseline says the answer is always given and the
  pattern repeats.
- **H3b (primary, Study B).** Release does **not** reduce session continuation (the learner's next
  turn after the released answer, and their return to the file). *This is the abandonment guard,
  and it is the reason the design chose release:* `interviews/findings.md` §4 row 6 is explicit
  that the question was never asked, so this hypothesis is where the guess gets tested.
- **H3c (secondary).** Fill and revision rate do not differ between Release and Withhold. A
  *negative* effect on either is the kill signal for release-on-give-up.
- **H3d (exploratory, Study A).** Within Study A, where Release is held constant at Release,
  describe the give-up rate and its distribution across objectives. Descriptive only; it exists to
  size Study B.

### RQ4 — The bar as an instrument (cross-cutting, gates everything)

- **H4a (gate).** Quadratic weighted κ between Max's verdicts and the researcher's blind
  hand-scoring on 20% of verdicts is **≥ .60** (`measurement.md` M4). Below it, the bar is
  reported as a user-interface feature only and every bar-derived number is struck from the
  analysis, including H1e's gain if it is scored from objectives.
- **H4b (gate).** Objective-set stability across five re-ingests of the same deck is **Jaccard
  ≥ .70** (`measurement.md` M5). Below it, progress is reported as an absolute count of objectives
  completed and never as a percentage.
- **H4c (secondary).** Fill at session end correlates with post-test score controlling for
  pre-test, Spearman ρ ≥ .5. If it does not, the bar is a UI affordance and must not be reported
  as a learning measure.

Both gates run in **Phase A, before any participant is recruited** (`measurement.md` §6). A study
that discovers its instrument is broken after 20 sessions has wasted 20 sessions.

---

## 3. Design

### 3.1 Phase A — instrument validation, no participants

Self-run, on the Week 4 deck. Produces H4a, H4b and the retrospective M3 distribution. Output is
three numbers and their gates, reportable on their own, and it decides whether the bar enters the
Study A analysis at all. Nothing else in this file starts until it has run.

### 3.2 Study A — controlled session (Assignment 2 user testing)

**Mixed 2×2.** Rails (On vs Off) **within**-subjects; Cue (On vs Off) **between**-subjects.
Release is held at **Release** in both blocks: it is the shipped default, and Study B tests it
properly.

Why this split:
- Rails within-subjects buys the most power per participant, and the paired contrast is immune to
  the between-person variance in prior knowledge and verbosity that dominates at n = 20.
- Cue cannot be within-subjects: a learner who has met Ellie's partial take will read her silence
  in the second block as a withdrawal, which is a demand effect, not a condition. Between-subjects,
  reported as lower-powered and exploratory-leaning-secondary, is the honest choice.
- The cue only exists when the rails are on, so Cue is assigned to the participant's **rails-on
  block**. The rails-off block is the same model and the same notes with the orchestrator bypassed.
- Two blocks need **two matched deck sections** (A and B) so the second is not contaminated by the
  first. See §4.1.

**Counterbalancing.** 4 sequences crossed with the 2 Cue cells = 8 allocation slots. Fill in blocks
of 8 from a randomisation list generated once, before recruitment, stored as
`docs/research/allocation-studyA.csv` (allocation only, never participant identity).

| Seq | Block 1 | Block 2 |
|---|---|---|
| S1 | Section A, Rails On | Section B, Rails Off |
| S2 | Section A, Rails Off | Section B, Rails On |
| S3 | Section B, Rails On | Section A, Rails Off |
| S4 | Section B, Rails Off | Section A, Rails On |

**n.** Target **20 completed** (10 per Cue cell), **minimum 12**, recruit **24** to absorb
attrition. Sensitivity, not power-to-detect-a-guessed-effect: at n = 20, α = .05 two-tailed, 80%
power, a paired test detects **dz ≈ 0.66**; at n = 12, **dz ≈ 0.88**. The rails contrast is a
structural manipulation of whether an attempt is ever requested, so a large within-subject effect
on H1a is plausible; the between-subject Cue contrast at 10 vs 10 is **not** (detectable d ≈ 1.3)
and must be reported as exploratory with effect sizes and CIs, never as "no difference".

**Session length: 70 min.**

| Phase | Min | Notes |
|---|---|---|
| Consent, PIS, demographics | 5 | §9.1. Programme / year / gender only. |
| Pre-test (both sections, 12 items) | 6 | Single combined pre-test avoids priming block 2. |
| **Block 1**: notes open (4) → interaction (14) → post-test A (3) → survey (4) | 25 | Interaction is timed and hard-stopped. The deck is pre-ingested: ingest is six minutes and is not participant time. |
| Break | 2 | |
| **Block 2**: notes open (4) → interaction (14) → post-test B (3) → survey (4) | 25 | Same battery, re-anchored to "the session you just had". |
| Exit interview + debrief | 8 | §7.3, §9.4. Debrief is mandatory, and in the Cue On cell it must state that Ellie's guess is sometimes wrong on purpose. |

**Pilot.** 2 pilot sessions (not analysed, not counted toward n) before the first real session, to
time the blocks and shake out the verdict and doc-edit failure paths. Freeze the protocol after
pilot 2. Phase B of `measurement.md` §6 (the codebook dry run) uses these two sessions.

**Recruitment.** Same channels and exclusions as `interview-guide.md` §1: no one the researcher
TAs, supervises or grades. A1 interviewees **may** return (note `prior_exposure = yes` as a
covariate) but must not exceed ~25% of the sample.

### 3.3 Study B — live deployment (after Study A, term-time)

**Between-subjects, user-level sticky randomisation** on **Release** {Release on give-up, Withhold
until one attempt}. Rails fixed On and Cue fixed at whatever Study A endorsed. Opportunistic n:
**40–100 students, 4–6 weeks**, multiple sessions per student (repeated measures → mixed-effects
models, §8.4).

Assignment is by hashed user id → stable arm, so a learner never sees the rule flip mid-term.
One-item exit micro-survey per session (§5.6) keeps the burden at one tap; the full battery is
offered once, at session 3, opt-in.

**Withhold is the arm that needs a floor.** `rule:closure` still applies: a question is never left
without its answer at session end. Withhold delays the answer until one attempt exists or the
session closes; it never refuses it outright. Without that floor the arm tests something the
project would not ship.

**Consent surface is different here** and is the part most likely to go wrong. See §9.2. Students
who decline research participation get the full product with **no research logging**, only the
operational minimum (§7.4).

### 3.4 Lean fallback (use only if ≤12 recruited by the Study A deadline)

Drop Cue to a within-subjects *observation* (On for everyone, cue-response counted, no contrast),
keep Rails within-subjects, and report H1a and H1b with paired plots and CIs. A 45-minute variant
cuts the pre/post test entirely, which costs H1e (an expected null) and nothing else that this
study is powered for.

---

## 4. Materials

### 4.1 Two matched deck sections

The unit is no longer an authored concept pack. It is a **section of a real lecture deck**, because
that is what the app ingests and what the learner will actually meet.

Requirements, adapted from Xu et al. §4.2 and from what the objective ingest needs: conceptual not
rote; **not** common prior knowledge for the sample; readable as notes in about 4 minutes;
discussable in 14; and yielding **4 to 6 objectives** with `assumedByDeck` prerequisites excluded,
so the bar has something to move.

Sections must be matched on: objective count (4 to 6 each), notes word count (±10%), pre-test item
count, and pilot-measured difficulty (mean pre-test score within 1 item).

**Ingest is frozen before the study.** Both sections are ingested once, the resulting notes and
objective tree are hashed, committed as fixtures, and reused for every participant. A live ingest
per session would make the material a variable (and §2 H4b is precisely the measurement of how
much it varies). Log the `content_sha` and the tree hash on every session.

Source the deck from module-permitted material and cite it in the A2 report. The CS3249 Week 4 deck
used for the A1 prototype is the working candidate; a deck from a module none of the participants
have taken is better, and finding one is a week-1 task.

### 4.2 Agents

- **Ellie** writes the notes from the slides, answers the learner's questions, and on silence
  offers an **unsure, partial take** of at most 60 words, hedged, which may hold one plausible
  student-shaped mistake, marked in the thread as *Ellie's guess* and never written to the doc
  (`collab-doc.md` §4.3).
- **Max** asks one follow-up, marks the learner's answer with a verdict first and grounds quoted as
  `p. N: "…"`, releases the full answer on a give-up, and writes the corrected version under his Q
  block.
- **Rails Off condition** = the same model, the same notes document, the same two named agents, and
  **no orchestrator**: who speaks and whether an answer is due are decided by the model in its
  prompt, as in v1 of any LLM chat app. It is not a weaker model and not a stripped UI. The point
  of the comparison is the contract, so everything except the contract is held constant.
- Turn sizes are held at `collab-doc.md` §4.6 in both conditions (Ellie ~120 words, feedback under
  100, released answer under 150) so Rails does not confound with output volume. **Log the actual
  word counts and check the manipulation held.**
- **Prompt files are study materials.** Version them, hash them, log the hash on every session
  (`prompt_version`, §7.2). A silent prompt edit mid-study invalidates the comparison.

### 4.3 Silence threshold

Reading-time scaled, per `collab-doc.md` §4.3: `clamp(2 × words / 238 wpm, 120 s, 300 s)`, computed
from the last turn the learner had to read. The Study pacing profile is used for every session; the
Demo profile is never used in a study session, and the profile is logged.

It fires **once per question**. After the cue and Max's prompt, silence is left alone until
`rule:closure`.

**Manipulation-integrity note.** The threshold and the reply delay must not collide: the delay is
seconds, the threshold is at least 120, so they are separable. Log both and verify no session had
the threshold fire while an agent reply was pending. In the Rails Off condition there is no
threshold, which is part of the manipulation and must be stated in the report rather than patched.

---

## 5. Instruments

All Likert items **7-point** unless stated, matching the source instruments. Anchor every item to
"the session you just had" / "Ellie and Max in the session you just had" so the two blocks are
separable. **Carried forward from v1 unchanged**, except §5.5 and §5.6, which are rescoped below.
Total per-block survey time must stay ≤ 4 min — this budget is the reason NASA-TLX is cut (§5.7).

### 5.1 Objective learning — pre/post concept test
*Reuse: Xu et al. 2026 §4.5.3.* Their design: 20 MCQ, one correct + three incorrect + an
**"I don't know" option to mitigate guessing** (their ref [46]), drawn from the same source text
the participants studied.

ChatterED adaptation: **12-item combined pre-test** (6 per section) and **6-item post-test per
block**, isomorphic forms (same construct, different surface), each item mapped to exactly one
**objective** in the frozen tree so item-level analysis can be aligned with the bar (§8.5, H4c).
Keep the
"I don't know" option. Score: 1 / 0 / 0 (IDK scored as incorrect but *tallied separately* — a shift
from IDK to a wrong answer is a different event from a shift from wrong to right, and worth
reporting).

### 5.2 Intrinsic Motivation Inventory — three subscales
*Reuse: IMI, as adapted in Xu et al. §4.5.4 (their ref [43]) — chase that citation for the item
wording before fielding.* Subscales, with their reliabilities in Xu et al.'s sample:
**Perceived Competence** (α = .922), **Pressure/Tension** (α = .919), **Interest/Enjoyment**
(α = .932). 1 = strongly disagree … 7 = strongly agree. Reword items to name the group chat.
Report Cronbach's α in your own sample; if α < .70 for a subscale, report the items descriptively
rather than as a scale.

### 5.3 Flow Short Scale — two subscales
*Reuse: FSS (Xu et al.'s ref [52]) following the adaptation of Chung et al. (their ref [17]),
Xu et al. §4.5.4.* **Learning Absorption** = items Q1, Q3, Q6 (Xu et al. dropped Q10 for reading
ambiguity — drop it too, for comparability), α = .708. **Learning Fluency** = Q2, Q4, Q5, Q7, Q8,
Q9, α = .882. Scale 1 = not at all … 7 = very much.

### 5.4 Perceived critical thinking
*Reuse: the six-type critical-thinking scale of Tanprasert et al. (Xu et al.'s ref [65]),
Xu et al. §4.5.4.* Average all items; overall α = .963 in their sample. This is the measure that
separated all three agent roles from Control with a large effect (η² = .29), so it is the most
likely single measure to move at small n.

### 5.5 Social influence and felt pressure (the MASG battery), rescoped to the cue

**What changed in v2.** v1 used this battery for an agent-count hypothesis (H1c, Group vs Single).
Agent count is no longer manipulated: the design stops at two on Song et al.'s own finding. The
battery is kept because the *mechanism* it measures is still live, and in a sharper form. Ellie's
cue is an agent who is **sometimes wrong on purpose**, and Max then asks the learner whether she is
right. Deference to that is the risk, so these items now serve **H2b** and **H2c**.

*Reuse: Song et al. 2025 §3.4.1–3.4.2.*
- **Informational influence** — e.g. "My decision was influenced by the opinion of the agent(s)."
- **Normative influence** — e.g. "During the discussion I felt that I had to agree with the opinion
  of the agent(s)." *Now the self-report companion to H2b.*
- **Open-ended, verbatim from Song et al.:** *"During the conversation, did you feel any pressure to
  agree with the agent(s)? If so, why?"* Coded yes/no exactly as they did (any mention of or
  allusion to pressure = "yes"), which makes the rate directly comparable to their 3%/12%/18%
  benchmark for 1/3/5 agents.
- **Concession item (ChatterED addition, needs piloting):** "There was at least one point where I
  went along with something Ellie said without being convinced it was right." Pair it with the
  transcript codes `CUE-ECHO` and `CUE-INHERIT` (§6.2): self-report and behaviour should agree, and
  if they do not, say so. A learner who inherits Ellie's mistake and does not report deferring is
  the most useful case this study can produce, because it is the one the closure rule cannot fix.
- **Control variables** worth one item each, per Song et al.: prior familiarity with the concept,
  general AI acceptance, and a short conformity-tendency item (their refs [74], [64], [41]).
  Younger and less-educated users were *more* susceptible in their RQ3 — an undergraduate sample is
  squarely in that group, so measure it rather than assume it away.

### 5.6 Perceived response quality (latency items retired)

**What changed in v2.** Latency is no longer a factor: the silence threshold is derived from
reading time (§4.3), not assigned. The seven quality items stay, because they are the cheapest read
on whether the rails make the agents feel worse, and **Thoughtfulness** becomes a secondary
outcome for RQ1 rather than a primary for a latency contrast. The "did you notice a delay" item is
dropped. One item replaces it, for RQ3: *"When you said you did not know, did the answer you got
help you with the next question?"*

*Reuse: Tan et al. 2026 §3.5.2 — all seven items, verbatim, 7-point:*
Clarity ("clear and easy to understand"), Relevance ("addressed the task without including
irrelevant information"), Understanding ("demonstrated a correct grasp of the task's meaning and
context"), **Thoughtfulness** ("were thoughtful and took the nuances of the task into account"),
Usefulness, Trustworthiness, Expectation Gap.

**Study B micro-survey** = the single Thoughtfulness item + the RQ3 item above, one screen,
skippable. Full battery offered once at session 3.

### 5.7 Deliberately excluded
- **NASA-TLX.** Tan et al. §4.3 found *no* significant main or interaction effects on any of the
  six dimensions. Six sliders × two blocks is ~3 minutes of the budget for a measure with a
  published null. If cognitive load must be indexed, use IMI Pressure/Tension plus the single raw
  TLX Mental-Demand slider.
- **Opinion-change (Δ*O*) from Song et al. §3.5.1.** It requires a stance question with no neutral
  option on a contested topic; a factual concept has a right answer, so "opinion change" is either
  learning or capitulation. The `CONCEDE-NJ` code and the normative-influence items capture the
  construct that matters here.

---

## 6. Coding: two schemes, and which one is primary

**The primary instrument is codebook v1.3**, the one already applied to the A1 baseline
(`ai-use-transcripts/analysis/codebook.md`, 152 turns, κ = .90 to 1.00). That is the whole point:
its measures were taken on general-purpose chat first, so `ATTEMPT` share, ICAP mix, `OWN` rate,
`VERIFY=CONTENT` rate and the AI-to-learner word ratio compare **within one instrument** across the
two settings rather than across two. The A2 primary outcomes named in `measurement.md` §4 come from
it. Phase B (`measurement.md` §6) extends it to **v2.0** with the doc-side acts of §6.2 below,
leaving every v1.3 code untouched so the baseline stays comparable.

**Xu et al.'s Dimensions 1 and 2 are secondary**, and are coded on a **25% subsample only**. They
exist for one reason: to place this study's cognitive and metacognitive act rates beside Xu et
al.'s published figures. Coding every message under both schemes is not affordable for one
researcher and buys nothing the primary scheme does not already give.

**Unit of analysis:** one learner message, or one learner-authored span in the document. A message
may carry **multiple codes** (Xu et al. §4.6.2 give a three-code example). Agent messages are not
coded, but are used as context and their metadata is logged.

### 6.1 Xu et al. Dimensions 1 and 2 — carried over unchanged, 25% subsample (do not modify; comparability is the point)

| Dimension | Category | Subcategory | Code | Definition (Xu et al.) |
|---|---|---|---|---|
| 1 | Cognitive Acts | Stating Fact/Definition | `COG-FACT` | Stating factual information or definitions of concepts |
| 1 | Cognitive Acts | Elaborating Causality/Principle | `COG-CAUS` | Explaining causal relationships or principles involving variables |
| 1 | Cognitive Acts | Providing Example/Analogy | `COG-EX` | Giving an example or analogy to clarify a concept |
| 1 | Cognitive Acts | Comparing/Contrasting | `COG-CMP` | Highlighting differences or similarities between entities |
| 1 | Metacognitive Acts | Self-Monitoring | `MET-MON` | Expressing awareness of one's own cognitive state |
| 1 | Metacognitive Acts | Planning/Strategizing | `MET-PLAN` | Outlining a plan or strategy for problem solving |
| 1 | Metacognitive Acts | Self-Correction | `MET-CORR` | Correcting a previous statement |
| 1 | Metacognitive Acts | Seeking Feedback/Confirmation | `MET-SEEK` | Asking to confirm understanding or receive feedback |
| 2 | Discourse Coordination | Requesting Task Clarification | `DIS-CLAR` | Asking for clarification about the task requirements |
| 2 | Discourse Coordination | Turn Closing/Refusal to Elaborate | `DIS-CLOSE` | Indicating the end of a turn or declining further elaboration |
| 2 | Feedback & Evaluation | Agreement/Affirmation | `FBK-AGREE` | Expressing agreement or affirmation with a statement |
| 2 | Feedback & Evaluation | Disagreement/Rebuttal | `FBK-DIS` | Expressing disagreement or giving a counterargument |
| — | Other | Off-Topic Chat | `OTH-OFF` | Content unrelated to the task |

### 6.2 Dimension 3 — ChatterED additions (v2: the document and the rails)

**What changed in v2.** v1's additions were built for a group chat with a private side channel:
group addressing, whisper acts, and a timer code. The whisper popover and the group framing are
gone (#48 §9, #32). What the design generates instead, and no published scheme has a slot for, is
**the learner writing into a shared document**, **a peer's partial take that can be echoed or
improved on**, and **a give-up that is a first-class move rather than a failure**.

`CONCEDE-NJ` and `DEFEND` are **kept from v1 unchanged**: the construct (unreasoned deference to an
agent) is exactly what Ellie's cue puts at risk, and keeping the definitions keeps the rate
comparable to Song et al.'s benchmark.

| Category | Subcategory | Code | Definition | Example |
|---|---|---|---|---|
| Document | Learner writes to the doc | `DOC-WRITE` | The learner types domain content into the notes rather than the chat. Coded from the author mark, not from the text. | (metadata-derived) |
| Document | Edits an agent's text | `DOC-EDIT` | The learner changes or removes agent-written text in the notes | |
| Document | Suggestion decision | `DOC-ACC` / `DOC-REJ` | Accepts or rejects an agent's suggestion on the learner's own text | |
| Cue | Improves on the cue | `CUE-IMPROVE` | The learner's next turn corrects, extends or qualifies Ellie's partial take | "not quite, it's the doubling that makes it geometric" |
| Cue | Echoes the cue | `CUE-ECHO` | The learner's next turn restates Ellie's take with no added content. **Cross-check against `measurement.md` M3b**, which measures the same thing lexically. | "yeah, what Ellie said" |
| Cue | Inherits the mistake | `CUE-INHERIT` | The learner's answer contains the specific claim the cue recorded as its deliberate mistake. **H2b's outcome.** | (checked against the cue's recorded claim) |
| Persistence | Give-up | `GIVE-UP` | Any phrasing that `classifyLearnerTurn` classes as `give_up`, or the Pass control | "idk", "just tell me" |
| Persistence | Revision | `REVISE-ATT` | A second attempt at a question that already holds a non-complete verdict, before any new question opens. **H1b's outcome.** | |
| Trust | Disputes a verdict | `DISPUTE` | Contests Max's verdict or his grounds, by the dispute control or in words | "no, that query does return the last place" |
| Social Pressure | **Concession without justification** | `CONCEDE-NJ` | Abandoning or softening a prior position after agent pushback **without** offering a reason, evidence, or a self-correction *(carried from v1)* | "Ok yeah you're probably right." (after having been correct) |
| Social Pressure | Sustained Defence | `DEFEND` | Maintaining a position *and* supplying new grounds after a challenge *(carried from v1)* | "No — the doubling is what makes the series geometric." |
| Silence | Threshold-prompted contribution | `THR-FILL` | A message posted after the silence threshold fired, responding to the cue | (metadata-derived; §6.3) |
| Silence | Self-continuation | `SELF-CONT` | A second learner message posted before any agent reply | (metadata-derived) |

`CONCEDE-NJ` vs `MET-CORR` remains the hardest boundary and is pinned as in v1: a self-correction
*supplies a reason or a corrected mechanism*; a concession does not. A concession toward a
**correct** agent position with no reasoning is still `CONCEDE-NJ`, because the construct is
*unreasoned* deference, not *wrong* deference.

`CUE-ECHO` vs `CUE-IMPROVE` is the new hard boundary. Rule: if the turn adds any domain content
the cue did not contain, it is `CUE-IMPROVE`, even if most of the wording is Ellie's. Agreement on
this pair must be reported separately, because H2c depends on it.

### 6.3 Per-message metadata (attached to every coded message, not itself a code)

`channel` (doc chat | span thread | private) · `surface` (chat | document) ·
`addressed_to` (ellie | max | none) · `after_threshold_fire` (bool, and ms since fire) ·
`cue_pending` (bool, and the cue's `hasMistake` and recorded claim) · `agent_reply_pending` (bool,
drives `SELF-CONT`) · `open_question_id` (which Max question was open) · `verdict` and
`outcome_kind` (including `revised`) · `own_words` (the three M3 shares) ·
`objective_delta` (which objectives moved on this message) · `word_count` ·
`edit_latency_ms` (first keystroke to send, a cheap proxy for deliberation).

### 6.4 Decision rules pinned to the design

- **`CUE-INHERIT` is the kill criterion for the deliberate mistake.** Pre-set: above **25%** of
  cues that carried a mistake, the mistake is removed from Ellie's cue and the A2 report
  recommends the change. The closure rule (`collab-doc.md` §4.7) repairs the transcript; it does
  not repair a learner who left with the wrong claim.
- **`CUE-ECHO` is the echo alarm.** Pre-set: if `CUE-ECHO` exceeds `CUE-IMPROVE` in the Cue On
  cell, DG1 has produced restatement rather than explanation, and H2c is reported as failed
  whatever the non-inferiority test says.
- **`CONCEDE-NJ` exceeding `DEFEND`** is the social-pressure alarm, carried from v1, now read
  against the cue rather than against agent count. Mitigation stays §9.3's.
- **`GIVE-UP` without a following attempt on the next question** is RQ3's kill signal, and the
  reason Study B exists.

### 6.5 Coding procedure and reliability

Xu et al. achieved Krippendorff's α = .831 with two researchers double-coding 25%. A single student
researcher cannot self-verify. Options, in order of preference:

1. **Human second coder (preferred).** Recruit one coursemate; train on the pilot transcripts;
   both independently code a **random 25%** of messages; compute Krippendorff's α per dimension;
   resolve disagreements by discussion; one coder finishes the rest (exactly Xu et al.'s procedure).
   Target α ≥ .80; if α < .67 on any code, that code is dropped or merged and this is reported.
2. **LLM-assisted first pass, human adjudication.** A Claude call proposes codes per message; the
   researcher reviews **100%** and overrides. Validity is then established the same way: the human
   independently blind-codes 25% *before* seeing the model's labels, and agreement between
   model-proposed and human-blind codes is reported as α. **Never report LLM-only codes as data.**
   Load the `claude-api` skill before writing this pipeline (repo policy).
3. Never: coding everything alone with no reliability statistic. That is an unreportable measure.

Budget 6–8 h of coding for 20 sessions × 2 blocks at ~15 student messages per block (~600 messages).

---

## 7. Log events to capture

Server-authoritative timestamps only (`ts` = ISO-8601 UTC with ms). Client clocks are logged
separately as `client_ts` and never used for analysis. Every event carries the **envelope**:

```jsonc
{
  "event": "message.send",
  "ts": "2026-10-14T07:21:03.412Z",
  "seq": 147,                    // monotonic per session, gap-detectable
  "session_id": "s_01JB…",       // opaque
  "subject_code": "P07",         // Study A participant code; Study B: hashed user id
  "study": "A",                  // A | B | pilot
  "block": 1,                    // 1 | 2 (Study A); null in B
  "condition": { "rails": "on", "cue": "on", "release": "release" },
  "section_id": "wk4-sec-b",
  "notes_sha": "sha256:1a7e…",      // the frozen ingest fixture, §4.1
  "tree_sha": "sha256:44b0…",
  "prompt_version": "sha256:9f2c…",   // hash of the agent prompt bundle in force
  "app_version": "0.4.2"
}
```

### 7.1 Event catalogue

| Event | When | Event-specific fields |
|---|---|---|
| `session.start` | Room created | `sequence_id` (counterbalance cell), `ua_class` (desktop/mobile), `tz_offset` |
| `consent.recorded` | Consent captured | `consent_version`, `research_optin` (bool), `recording` (none/audio/screen) |
| `pretest.submit` | Pre-test done | `items[]{item_id, objective_id, response, correct, idk}`, `duration_ms` |
| `notes.open` / `notes.close` | Notes pane shown/hidden | `section_id`, `dwell_ms` — *the Xu et al. "frequency and duration of reviewing material" measures (§4.5.1)* |
| `slide.open` | A provenance chip opened its slide | `block_id`, `page`, `dwell_ms` — whether provenance is ever actually clicked |
| `task.start` | Interaction block begins | `deadline_ts` (hard stop) |
| `message.send` | Learner sends | `channel`, `surface`, `addressed_to`, `text_len`, `word_count`, `edit_latency_ms`, `agent_reply_pending`, `after_threshold_fire_ms`, `open_question_id`, `msg_id` |
| `doc.learner_write` | Learner text committed to the notes | `block_id`, `objective_id`, `word_count`, `assessed` (bool) — the doc-side analogue of `message.send` |
| `doc.suggestion` | Agent suggestion raised on learner text | `agent`, `block_id`, `decision` (pending/accepted/rejected), `decided_ms` |
| `agent.turn.plan` | Orchestrator selects speaker | `agent`, `decided_by` (`rule:*` or `model:*`, already on every message), `target_objective_id` — **this is the Rails manipulation check (§8.1)** |
| `agent.turn.scheduled` | Delay set | `agent`, `scheduled_delay_ms`, `delay_source` (condition/jitter), `due_ts` |
| `agent.turn.dispatched` | Reply released to client | `agent`, `actual_ttft_ms`, `model`, `input_tokens`, `output_tokens`, `word_count`, `msg_id`, `in_reply_to` |
| `agent.turn.error` | LLM/API failure | `stage`, `error_class`, `retry_count` — needed for the fidelity exclusion, §8.1 |
| `silence.threshold.set` | After each learner/agent message | `window_ms` (the reading-time clamp), `source_words`, `due_ts` |
| `silence.threshold.cancelled` | Learner typed/sent in time | `remaining_ms` |
| `silence.threshold.fired` | Threshold expired | `target_objective_id`, `fire_count_in_block` |
| `cue.offered` | Ellie's partial take posted | `has_mistake` (bool), `mistake_claim` (the recorded claim, for `CUE-INHERIT`), `word_count` |
| `cue.corrected` | Max corrected the cue (`rule:closure` or resolution) | `cue_msg_id`, `path` (feedback/release/closure) |
| `quiz.verdict` | Max marks an answer | `objective_id`, `verdict`, `outcome_kind` (verdict/released/**revised**), `grounds[]{page, quote}`, `own_words{block, cue, question}` — **M1, M2, M3 all land here** |
| `quiz.answer_released` | Give-up, Pass, or closure | `objective_id`, `trigger` (phrase/pass/closure), `had_attempt` (bool), `next_pitch` (lower/same) |
| `quiz.dispute` | Learner contests a verdict (§6.2 `DISPUTE`) | `verdict_msg_id`, `outcome` (held/reversed) — **the free half of M4** |
| `progress.update` | Bar recomputed | `objectives[]{objective_id, fill_before, fill_after, evidence_msg_id}`, `completed`, `total` |
| `progress.view` | Bar or a lesson card opened / hidden | `action`, `objective_id`, `dwell_ms` |
| `posttest.submit` | Post-test done | as `pretest.submit` |
| `survey.submit` | Battery submitted | `instrument` (imi/fss/ct/masg/quality), `items{}`, `duration_ms` |
| `task.end` / `session.end` | Block or session ends | `reason` (completed/timeout/abandoned/withdrawn), `duration_ms` |
| `withdraw.request` | Student withdraws | `scope` (session/all), `at_phase` — must trigger the deletion path, §9.1 |

### 7.2 Logging rules

- **Two sinks.** Live session state in the Durable Object (SQLite); the research log appended to a
  Singapore-resident store (§9.5). Write the research log from the calling Worker, not from inside
  the DO — a DO→D1 write is a subrequest that blocks hibernation (`cloudflare-do-limits.md` §7).
- **Message text is a separate, access-controlled table** keyed by `msg_id`, so the event stream can
  be shared/analysed without transcripts.
- **No PII in any field.** No names, no NUSNET, no email, no free-text "who are you". The student's
  typed content can still contain PII — see the scrubbing requirement in §9.1.
- **Analytics Engine is not an archive** (3-month retention, `cloudflare-do-limits.md` §7). Use it
  for live dashboards only.
- **Log the manipulation, not just the intent.** `decided_by` on every turn, not just the assigned
  condition; `window_ms` *and* the actual fire time; the ingest hashes on every session. §8.1's
  fidelity exclusions cannot be applied without them, and a manipulation nobody verified is a
  manipulation nobody performed.
- **Log the cue's mistake at the moment it is made**, not reconstructed afterwards. `has_mistake`
  and `mistake_claim` are what make H2b checkable at all; if the model declines to declare one,
  that is itself the datum.

### 7.3 Exit interview (8 min, semi-structured, Study A only)

Four questions, then stop. Do not re-run the A1 interview.
1. "Which of the two sessions did you work harder in, and what made the difference?"
2. Song et al. verbatim: *"During the conversation, did you feel any pressure to agree with the
   agent(s)? If so, why?"*
3. Cue cell only: "When Ellie had a go at the answer, what did you do with it?" Follow with the
   specific cue that carried a mistake, if one did, and ask whether they noticed. (→ H2b and H2c
   face validity; and the one question the transcripts could never answer.)
4. Show them their final bar: "Does this match what you think you actually got across?"
   (→ H4 face validity, and the qualitative half of `measurement.md` §4.)

### 7.4 Operational-minimum logging (non-consenting deployment users)

`session.start`, `session.end`, `agent.turn.error`, aggregate counts, rate-limit and abuse events.
No message text, no per-message events, no survey, no progress export. Retained 30 days.

---

## 8. Analysis plan

### 8.1 Exclusions, declared in advance
- Sessions with `agent.turn.error` on >10% of turns.
- **Manipulation fidelity (Study A):** exclude a block where the orchestrator was bypassed in the
  Rails On arm, or fired in the Rails Off arm, on any turn. This is checked from `decided_by`,
  which every message already carries.
- **Ingest fidelity:** exclude a session whose notes or objective-tree hash does not match the
  frozen fixture (§4.1).
- Study A blocks with <4 learner messages (non-engagement) — reported, not silently dropped.
- Failed attention/comprehension check in the survey.
Report the exclusion count per rule in a CONSORT-style flow figure.

### 8.2 Descriptives first
Per condition: message counts, word counts, fill, revision rate, give-up counts, threshold fires,
cue fires, doc-write counts, and the three M3 own-words distributions. Xu et al. reported word
count as the headline engagement measure; report it too, but do not let it stand in for the
primary outcomes, because a rails condition that asks questions will raise word count whether or
not it raises attempts. Plot per-participant paired lines for the within-subject contrast: at
n = 20 the paired scatter is more informative than a bar chart.

### 8.3 Confirmatory tests (Study A)

| Hypothesis | Test | Notes |
|---|---|---|
| H1a, H1b (within, rates) | **Binomial / beta GLMM** on the rate, participant random intercept (attempts ÷ attempts + give-ups; revisions ÷ eligible verdicts); falls back to **Wilcoxon signed-rank** on per-participant rates if it will not converge at n = 20 | Rates, not raw counts. Report *dz* / rank-biserial *r* with 95% CI |
| H1c (act shares) | **Poisson / negative-binomial GLMM**, participant random intercept, `offset = log(n_messages)` | Same normality-gated fallback logic Xu et al. used (§4.6.1) |
| H1d (compliance: answer length, `DIS-CLOSE` rate) | Paired *t* if Shapiro–Wilk passes, else Wilcoxon | **Directional and unwelcome.** Report the CI; a null here is a claim, so state the detectable effect |
| H1e (learning gain) | **ANCOVA on post-test with pre-test as covariate** (Xu et al. §5.2.1), here as a within-subject LMM with block and section as fixed effects | Expected null; report the CI, not just *p*. Struck entirely if H4a fails and the post-test is objective-scored |
| H2a (between, Cue) | Mann–Whitney U / Welch's *t* on the per-participant post-threshold attempt rate | Underpowered by construction; lead with effect size + CI |
| H2b (mistake inheritance) | **Descriptive first**: the rate with an exact binomial CI, against the pre-set 25% alarm. Then a binomial GLMM with a cue random intercept if there are enough cues | Not a between-condition test. It is a rate with a threshold, and the threshold is a design decision |
| H2c (echo non-inferiority) | **One-sided non-inferiority test** on M3b against the pre-set 15% margin | Fails automatically if `CUE-ECHO` > `CUE-IMPROVE` (§6.4) |
| H3d (give-up description) | Descriptives only, with CIs | Exists to size Study B |
| Mixed Rails × Cue | **ART ANOVA** (Wobbrock et al.; the method Tan et al. used for this shape of non-normal factorial data) | Interaction is exploratory |

**Multiplicity.** Holm–Bonferroni within the primary family {H1a, H1b, H2a, H2b}. Secondary and
exploratory tests are reported unadjusted and labelled as such.

**Order/carryover.** Include block order as a fixed effect in the within-subject models; report the
Rails × Order interaction. A carryover effect is a finding to report, not a nuisance to hide, and
it is *likely* here: a learner who has met the rails may keep attempting in the unrailed block out
of habit, which would bias H1a **against** the hypothesis. Say so in advance.

### 8.4 Study B models
Sessions nested in users: linear/logistic **mixed-effects models** with a user random intercept.
H3a: give-up recurrence as a binomial outcome per give-up event, `~ release_arm + session_index +
(1|user)`. H3b: session continuation as a binomial outcome per released answer, plus return-to-file
within 7 days. Pre-set a stopping rule (fixed 6-week window, or n = 100, whichever comes first) so
the A/B is not peeked into significance.

### 8.5 Instrument validation (H4), and it runs first

All of this is **Phase A**, before recruitment (`measurement.md` §6).

- **H4a.** Quadratic weighted κ between Max's verdicts and the researcher's blind hand-scoring on
  20% of verdicts. **κ < .60 ⟹ the bar is an interface feature only**, every bar-derived number is
  struck, and H1e loses its objective-scored variant.
- **H4b.** Mean pairwise Jaccard over normalised objective titles across five re-ingests of each
  section. **Jaccard < .70 ⟹ progress is reported as an absolute count**, never a percentage.
- **H4c.** Spearman ρ between end-of-block fill and post-test score, partialling pre-test. Runs
  after Study A, and only if H4a passed.
- **Report the failure modes whatever the numbers say:** false-negative rate (the baseline's
  failure was 9 of 11 in that direction), parse failures, and the rate at which a verdict is later
  reversed by a learner dispute (§6.2 `DISPUTE`). An instrument section that admits its error rate
  is stronger than one that does not mention it.

### 8.6 Pre-registration and open materials
Write RQs, hypotheses, primary/secondary labels, n, exclusions and tests into a dated, committed
`docs/research/preregistration-studyA.md` **before the first non-pilot session**, and do not edit
it afterwards (amendments go in an appended log with dates). This is free, takes an hour, and is
the single cheapest credibility gain available to a solo-researcher study.
Publish: instruments, agent prompts (hashed and versioned), the codebook, the analysis script, and
**aggregate** data. Never raw transcripts (§9.1).

---

## 9. Ethics

*Nothing here is legal advice. It is a checklist of what must exist, and who to ask.*

### 9.1 Consent, anonymisation and withdrawal — Study A participants

**Must exist:**
- A **Participant Information Sheet (PIS)** and a **consent form**, separate documents, covering:
  purpose; what the session involves; that the study partners are **AI agents, not humans**; that
  conversation text and interaction logs are recorded; audio/screen recording as a *separate*
  opt-in; voluntariness; withdrawal without consequence and up to what point; storage, retention
  and destruction dates; who to contact (researcher **and** supervising faculty member); that
  transcripts are processed by a third-party LLM API outside Singapore (§9.5).
- **Age and enrolment check** (18+, currently enrolled) — as in `interview-guide.md` §3, S1.
- **No coercive recruitment.** No students the researcher TAs, tutors, supervises or grades. State
  this in the ethics application; it is the most common flag on student-run studies.
- **Pseudonymisation at capture, not after.** Participant codes P1…P24. The code↔identity mapping
  (needed only to honour withdrawal) lives in one encrypted file **outside the repo**, deleted at
  the analysis freeze. `CLAUDE.md` already forbids committing names, IDs or raw transcripts —
  this plan does not relax that.
- **Transcript scrubbing.** Students type freely and will occasionally type a name, a module code
  tied to a small cohort, or a grade. Before any transcript leaves the secure store: automated
  pattern scrub (NUSNET pattern `[A-Z]\d{7}[A-Z]`, emails, phone numbers, `@` handles) **plus** a
  manual pass. Quotes in the report are checked individually.
- **Withdrawal path that actually works.** `withdraw.request` must delete or tombstone that
  subject's rows across *both* sinks. If the architecture cannot delete, the consent form cannot
  promise deletion. Decide this before writing the consent form, not after.
- **Incentives** disclosed and not so large as to be coercive (a token: kopi / small voucher).

### 9.2 The live deployment is a different legal object from the study

The single most likely mistake in this project: reusing the research consent flow for public users,
or reusing public users' data for research. Keep them structurally separate.

**Live users who are not research participants must have:**
- **Terms of Service / acceptable use** — what the service is, that it is a student project and not
  an official NUS service, no warranty on correctness, academic-integrity expectations, that it is
  not a substitute for module materials, account termination, and a named contact.
- **A privacy notice** written for users, not for an ethics committee: what is collected, why, how
  long, who it is shared with (the LLM provider), where it is processed, how to request access or
  deletion, and a data-protection contact.
- **A persistent AI disclosure.** Every agent is visibly labelled AI at all times, not just in
  onboarding. Song et al. §5.4.4 is explicit that users are influenced by agent groups **"even when
  they are fully aware that these agents are AI"** — disclosure is necessary and *not sufficient*,
  which is why §9.3 exists.
- **A separate, unbundled research opt-in.** Refusing research must not degrade the product; the
  opt-in must be a distinct action, not a pre-ticked box inside the ToS. Non-consenting users get
  operational-minimum logging only (§7.4).
- **A route for under-18 or non-NUS visitors.** Either gate access, or state an 18+ requirement and
  enforce it at sign-up. MASG's finding that younger users are more susceptible makes an
  age-unbounded deployment of a persuasive multi-agent system a real, not theoretical, concern.

### 9.3 The MASG social-pressure risk, and what actually mitigates it

**The risk, stated precisely.** Song et al. found that a group of agents produces normative social
influence: reported pressure to agree rose from 3% (1 agent) to 12% (3) to 18% (5), and opinion
change toward the agents' position was strongest in the 3-agent condition. ChatterED deliberately
builds a group of agents, aims them at a student's reasoning, and gives one of them the job of
pushing back. The specific harm is not distress — it is **a student abandoning a correct
understanding because two agents seemed to agree**, and doing so in a system whose progress display
may then reward the capitulation.

**Design mitigations (build these; they are cheap and each maps to a source):**
1. **Two agents, not three or five.** Pressure scaled with group size in Song et al. Two is the
   smallest group that is still a group. Do not add a third agent for richness.
2. **Never unanimous on a factual point.** Enforce in the orchestrator: if Ellie and Max
   would both oppose the student's position in the same window, Ellie instead voices partial
   support or reframes. Song et al. §5.4.3 recommends exactly this — *"having a small portion of the
   bots side with instead of against the user"* (minority influence) — and their §5.5 lists mixed
   opinion composition as the untested case.
3. **Max must be able to lose.** Its prompt requires it to concede explicitly ("that's
   right, and here's why it holds") when the student's justification is sound, and it may not
   re-challenge a conceded point in the same block. A challenger that never concedes is a pressure
   machine, and Xu et al. already recorded a minority (4/24) finding the Challenger
   *"overly confrontational"* and feeling *"provoked"*.
4. **The private threads are the designed pressure valve** (`collab-doc.md` §4.1), carrying the
   whisper's research justification after the popover was retired (`btw interaction/README.md`;
   Dennis et al.'s "more polite than interrupting"). A private thread never edits the doc, and the
   agent in it may not answer an open Max question; it clarifies and reassures.
5. **Standing epistemic disclaimer in the UI.** "These are AI study partners. They can be wrong,
   and them agreeing with each other is not evidence." One line, always visible, near the roster.
6. **No agreement-shaped rewards.** The bar fills only on the learner's own words with a verdict
   on them (`collab-doc.md` §6; `progress-tracking.md` §4.4, rule 4). `CONCEDE-NJ` and `CUE-ECHO`
   must never move an objective. No score, no streak, no grade on the bar.
7. **Ellie's deliberate mistake is bounded and always corrected.** At most one plausible mistake
   per cue, never in the notes, and `rule:closure` requires the resolving Max turn to correct it
   explicitly whatever path the thread ends by (`collab-doc.md` §4.7). H2b is the check that this
   is enough, and §6.4 sets the threshold at which it is judged not to be.
8. **An exit that costs nothing.** Leave the room at any time; no streak, no penalty, no nag.

**Debrief (mandatory, Study A; and an end-of-session card in deployment):**
- State that the agents were scripted into roles (collaborative peer, Socratic challenger) and that
  the pushback was a designed behaviour, not a judgement of the student.
- State that agent agreement carries no evidential weight.
- **In the Cue On cell, state plainly that Ellie's guess is sometimes wrong on purpose**, and name
  the specific claim if one was planted. This is not optional: the design deliberately exposes a
  learner to a plausible falsehood, and a debrief that omits it is not a debrief.
- **Correct the record.** Hand over a one-page factual summary of the section, flagging any
  objective left unresolved and any inherited mistake. A learning study that leaves a student more
  confidently wrong than it found them has done harm; the fix is a correction sheet, and it costs
  one page per section.
- Offer the contact of the supervising faculty member, and a route to have their data deleted.

**A residual risk to state in the report rather than pretend away:** ChatterED's mitigations are
untested. Study A measures whether they worked (H1c, `CONCEDE-NJ`, the Song et al. pressure item).
Reporting that honestly is worth more marks than claiming the risk was designed out.

### 9.4 NUS review: what must exist for a course project that also goes public

**Ask first, build second.** The two questions that determine everything, and who answers them:
1. **The module coordinator / lecturer:** does CS3249 have blanket ethics coverage for
   in-course user testing, and what does it cover? Course projects are frequently covered for
   *classroom* data collection and *not* covered for public deployment, retention beyond the
   semester, or dissemination beyond the course.
2. **The School's DERC (Departmental Ethics Review Committee) or NUS-IRB, via a faculty
   supervisor:** students generally cannot be Principal Investigator. If any of the following are
   true, assume a formal application is required *before* recruitment: data is retained past the
   course; results may be published or put in a portfolio/preprint; the system is deployed beyond
   the class; participants are recruited from outside the module.

**Documents an application will require (prepare these regardless — they are also good practice):**
- Protocol / study description with RQs, design, n and justification.
- PIS + consent form (§9.1), and the separate ToS + privacy notice for deployment (§9.2).
- All recruitment materials, verbatim.
- All instruments: pre/post tests, every survey scale, the exit-interview guide, and **the agent
  prompts** (the prompts *are* the intervention; a reviewer will ask for them).
- Risk/benefit assessment naming the MASG social-pressure risk (§9.3) and the misconception risk,
  with the mitigations and the debrief.
- Data management plan: what is collected, where it is stored, who can access it, residency (§9.5),
  encryption, retention period, destruction method and date, and third-party processors (the LLM
  API vendor) with their processing location.
- Conflict-of-interest / power-relationship declaration (the no-TA-ing rule, §9.1).
- Incentive schedule.
- **Timeline realism:** ethics review takes weeks, not days. If Assignment 2 testing must run
  before an approval can land, that testing has to be scoped to whatever the course's own coverage
  permits, and the deployment treated as a separate, later, separately-approved activity. Confirm
  which of these you are in *this week*, because it changes what §3.2 is allowed to be.

### 9.5 PDPA basics and data residency — as an architecture requirement

**PDPA obligations to design against (Singapore PDPA; the operative ones for this system):**
- **Notification & Consent** — tell users the purposes before/at collection; obtain consent; make
  withdrawal possible. Bundled or forced consent is not consent.
- **Purpose limitation** — data collected to run the study may not be silently repurposed for
  product analytics, and vice versa.
- **Access & Correction** — a user can ask what you hold about them and ask for corrections. There
  must be a person and a process, not just an intention.
- **Accuracy, Protection** — reasonable security: encryption at rest and in transit, least-privilege
  access, no transcripts on a laptop's Downloads folder.
- **Retention limitation** — delete when the purpose ends. Put actual dates in the consent form
  (e.g. transcripts destroyed 31 Dec 2026; aggregate data kept indefinitely).
- **Transfer limitation** — sending personal data overseas requires comparable protection. Prompts
  sent to an LLM API are an overseas transfer; disclose it, minimise what is in the prompt, and
  keep direct identifiers out of prompts entirely.
- **Data breach notification** and a designated **Data Protection Officer** contact — for a student
  project, name a real person and a real email in the privacy notice.
- Note that **pseudonymised transcripts can still be personal data** if re-identification is
  reasonably possible — which, for a 20-person cohort in one module, it often is.

**Residency requirement (feeds the architecture decision):**

> **REQ-DATA-1.** All research-grade data — message text, transcripts, per-message events, survey
> responses, ledger snapshots — must be **stored at rest in Singapore**, in a store whose region is
> contractually specified, for the retention period stated in the consent form.

Consequences, from `cloudflare-do-limits.md` §8:
- Cloudflare Durable Objects offer jurisdictions `eu`, `us`, `fedramp` only. **There is no Singapore
  or APAC jurisdiction.** `locationHint: "apac-se"` is best-effort, honoured only on first `get()`,
  and DOs do not move afterwards. DO ids are logged elsewhere for billing regardless.
- Therefore: **DOs may hold ephemeral session state only** (live room, socket fan-out, silence-timer
  alarm). The durable research log must be written to a **Singapore-region store** — an
  ap-southeast-1 managed Postgres, an SG-region object store, or NUS-provided storage — with the
  Worker as the writer.
- If the ethics reviewer requires a hard residency guarantee, `cloudflare-do-limits.md` §8 already
  concludes the DO route cannot give one and recommends a Singapore-region VPS/DB for the study
  data. Take that recommendation for the research sink and keep Cloudflare for the real-time layer.
- **The LLM API call is a separate transfer** and cannot be made SG-resident by choosing a database.
  Disclose it, keep identifiers out of prompts, and check the vendor's zero-retention / no-training
  options before the ethics application, not after.

---

## 10. Timeline and effort

| When | What |
|---|---|
| A1 window (to 22 Sep) | One paragraph of this plan into the A1 report Step 2, which is now there. Do **not** build any of it yet. |
| Immediately after A1 | **Phase A** (`measurement.md` §6): the M4 and M5 gates, self-run, no participants. Days, not weeks, and it decides whether the bar is admissible at all. |
| A2 week 1 | Ethics question answered (§9.4 Q1/Q2). Deck sections picked, ingested once and frozen as fixtures. Pre/post items written against the frozen objectives. Instruments assembled. |
| A2 week 1–2 | The three build items in `measurement.md` §5: the `revised` outcome kind, own-words logging at verdict time, the dispute control. Then §7's logging, **before** the first pilot; retrofitting logs after piloting loses the pilot. |
| A2 week 2 | **Phase B**: codebook v1.3 → v2.0 on the two pilot sessions. The doc-side codes have to exist before any session is coded. |
| A2 week 3 | Pre-registration committed. 2 pilots. Protocol frozen. |
| A2 weeks 3–4 | 20 sessions ≈ 24 h of researcher time (70 min each + 15 min turnaround). Schedule ≤ 4/day. |
| A2 week 5 | Coding (6–8 h) + second coder's 25% + analysis. |
| After A2 | Study B, only if §9.2 and §9.4 are actually satisfied. |

**The realistic risk is not statistics, it is the calendar.** If sessions slip, cut n before
cutting the debrief, the reliability coding, or the pre-registration. If the calendar collapses
entirely, **Phase A still stands alone**: an instrument-validation report with the two gates,
the recomputed baseline, and no participants is a real result, and it is the one this project
cannot do without.

---

## References

- Dennis, A. R., Rennecker, J. A., & Hansen, S. (2010). Invisible whispering: Restructuring
  collaborative decision making with instant messaging. *Decision Sciences*, 41(4), 845–886.
  — whisper structural features (silent interactivity, ephemeral context) and the "more polite than
  interrupting" support channel; via `Academia/Sources/_text/critique1-btw.txt`.
- Song, T., Tan, Y., Zhu, Z., Feng, Y., & Lee, Y.-C. (2025). Investigating social influence of
  multiple agents in human-agent interactions. *Proc. ACM Hum.-Comput. Interact.*, 9(7), CSCW452.
  — normative/informational influence items (§3.4.1), the pressure open-ended (§3.4.2), the
  group-size pressure gradient (§4.2.2), and the risk/mitigation discussion (§5.4.3–5.4.4).
- Tan et al. (2026). The impact of response latency and task type on human-LLM interaction and
  perception. *CHI '26*. https://doi.org/10.1145/3772318.3790716 — the seven perceived-quality items
  and latency-perception question (§3.5.2, §3.5.4), the latency-fidelity exclusion rule, ART ANOVA,
  and the 2 s < 9 s / 20 s thoughtfulness result (§4.2).
- Xu, Z., Zhang, J., Tang, A., & Lee, Y.-C. (2026). Who you explain to matters: Learning by
  explaining to conversational agents with different pedagogical roles. *CHI '26*.
  https://doi.org/10.1145/3772318.3790298 — Peer and Challenger agent designs (§4.1.2–4.1.3),
  procedure (§4.3), the full measurement table and instrument choices (§4.5), the interaction-act
  coding scheme (Table 2), the ANCOVA approach and role effects (§5.2).
- Instruments cited *through* the papers above — chase the primary sources before fielding:
  Intrinsic Motivation Inventory (Xu et al. ref [43]); Flow Short Scale (ref [52]) with the
  Chung et al. adaptation (ref [17]); Tanprasert et al. critical-thinking scale (ref [65]);
  the social-influence items Song et al. adapted from their ref [52]; conformity (ref [64]),
  compliance (ref [41]) and AI-acceptance (ref [74]) measures; ART ANOVA (Tan et al. ref [59]);
  thematic analysis (Xu et al. ref [8]).
