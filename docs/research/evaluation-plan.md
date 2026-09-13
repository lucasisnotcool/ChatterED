# ChatterED — Evaluation Plan (Assignment 2 + live deployment)

**Status.** Draft v1, 13 Sep 2026. Owner: single student researcher (no lab, no RA budget).
**Scope.** Everything after Assignment 1: the controlled user test that Assignment 2 requires
(**Study A**), and the subsequent deployment to real NUS students (**Study B**).
**Companion docs.** `design-brief.md` (the A1 design decisions this plan tests — agent roster
§D1, turn-taking §D2, silence timer §D3, latency §D4, whisper §D5, the pressure risk §D6, and the
Explanation Ledger §F). `progress-tracking.md` (the Explanation Ledger's implementation spec — it is
both a design feature and an instrument here). `architecture-options.md` (the stack that has to
carry the logging in §7 and the residency requirement in §9.5). `interview-guide.md` (A1 formative
evidence — do not duplicate it here; this plan is *summative*). `cloudflare-do-limits.md` (the
residency finding in its §8 drives §9.5 below).

**Agent names follow `design-brief.md` §D1:** Peer = **Mei**, Challenger = **Arun**, opt-in closing
Tutee = **Kai**.

> **What A1 needs from this document.** The A1 rubric line *"a clear mechanism for tracking
> student progress"* is answered by `progress-tracking.md`, not here. What A1 should borrow
> from this file is one paragraph in Step 3: *"Assignment 2 will test H1–H5 below with a
> within-subjects design (n≈20), reusing the pre/post test, IMI and FSS instruments from
> Xu et al. (2026) and the perceived-quality items from Tan et al. (2026)."* That single
> paragraph shows the design is falsifiable, which is what the rubric is buying.

---

## 1. What is being evaluated, and why these three contrasts

ChatterED bundles three manipulations. Each has a published effect it is betting on, and each
has a specific way it can fail. The evaluation exists to separate them.

| Mechanic | Bet (source) | Plausible failure |
|---|---|---|
| **Group chat** (Peer + Challenger) vs **single agent** | Peer raises absorption/interest, Challenger raises metacognitive acts and critical thinking; both beat a passive partner (Xu et al. 2026, §5.1.2, §5.2). A group of agents reads as a *social group* (Song et al. 2025). | The MASG effect fires the wrong way: two agents create normative pressure, the student concedes instead of defending, and *conceding* looks like *learning* in the transcript. |
| **Whisper** available vs not | A private side channel restores questions the learner would suppress in public — silent interactivity, ephemeral context, "more polite than interrupting" (Dennis et al. 2010, via `critique1-btw.txt` §Analysis). | Nobody uses it; or it becomes an answer-hatch (students whisper "just tell me") and cannibalises the public explanation the whole design exists to produce. |
| **Delayed** vs **immediate** agent replies | Responses at 9–20 s are rated more thoughtful than at 2 s (Tan et al. 2026, §4.2); ~31% of participants read delay as deliberation. | In a *group chat* the delay is not the same object as in a Q&A tool: it may just feel like lag, and it interacts with the silence timer (the student is meant to fill the gap, not wait it out). |

The three cannot all be tested at once by one person. §3 assigns them: audience and whisper to
Study A, latency to Study B (where n is free), with a within-session perception check in Study A
as a cheap early read.

---

## 2. Research questions and hypotheses

Naming: **Audience** = {Group (Mei + Arun), Single (Arun only)}. **Whisper** =
{On, Off}. **Latency** = {Immediate (~1 s), Delayed (8–12 s TTFT)}.
Primary/secondary/exploratory labels are binding — declare them before data collection (§8.6).

### RQ1 — Audience: does a group of agents change how students explain?

- **H1a (primary, process).** Students in **Group** produce more *metacognitive acts*
  (Self-Monitoring + Planning + Self-Correction + Seeking Confirmation, §6) per message than in
  **Single**. *Basis:* Challenger alone produced 49 metacognitive acts vs Peer's 36 and Tutee's 14
  (Xu et al. Table 3); adding a supportive Peer alongside the Challenger should raise
  Seeking-Confirmation and Self-Monitoring without suppressing elaboration.
- **H1b (primary, experience).** **Group** yields higher *Learning Absorption* and
  *Interest/Enjoyment* than **Single**. *Basis:* Peer was the highest-absorption, most enjoyable
  role in Xu et al. (§5.2.2); Single here is Challenger-only, which was absorbing but not the most
  enjoyable.
- **H1c (primary, risk — directional and unwelcome).** **Group** yields higher *perceived
  normative influence* and more *Concession-without-justification* acts than **Single**.
  *Basis:* Song et al. found normative influence and reported pressure rise from 1 agent (3% felt
  pressure) to 3 agents (12%) to 5 agents (18%). **H1c is the hypothesis this project most wants
  to be false**; it is stated as primary so that a null cannot be quietly claimed as safety.
- **H1d (secondary).** No difference in *pre→post concept-test gain* between Audience conditions.
  *Basis:* Xu et al. found **no** significant objective-outcome differences across four roles at
  n=96 (§5.2.1). Predicting a null at n=20 is honest; the study is powered for process, not gain.
- **H1e (secondary).** **Group** yields higher *perceived critical thinking* and *perceived
  competence* than **Single** — both were role-sensitive in Xu et al. with large effect sizes.

### RQ2 — Whisper: does a private channel change what gets asked?

- **H2a (primary).** With **Whisper On**, students ask more *low-status questions* (basic
  definition requests, confidence checks, "am I embarrassing myself" checks) *in total across both
  channels* than with Whisper Off. *Basis:* Dennis et al.'s finding that whispering gives a channel
  to seek support more politely than interrupting; and the interview-guide §6a probe on DM-vs-post
  behaviour.
- **H2b (primary).** Whisper does **not** reduce public explanation volume: word count in the main
  channel under Whisper On is non-inferior to Whisper Off (pre-set non-inferiority margin: 15% of
  the Whisper-Off mean). *This is the cannibalisation guard.*
- **H2c (secondary).** Whisper On lowers *Pressure/Tension* (IMI) and raises *Learning Fluency*
  (FSS) relative to Whisper Off — i.e. the channel functions as a pressure valve in the sense the
  developer intended ("encourages user interaction when they perceive too much pressure in group
  chat context", `btw interaction/README.md`).
- **H2d (exploratory).** Whisper content is disproportionately *task-clarification* and
  *confidence-seeking* rather than *answer-seeking*. Measured by the channel-tagged coding in §6.
  If answer-seeking dominates, the feature needs a design change (see §6.4).

### RQ3 — Latency: is a delayed group reply read as thoughtful, or as broken?

- **H3a (primary, Study B).** **Delayed** replies are rated higher on *Thoughtfulness* than
  **Immediate**. *Basis:* Tan et al. §4.2, 2 s < 9 s (p=.008) and 2 s < 20 s (p=.040).
- **H3b (primary, Study B).** **Delayed** increases the probability that the student sends a
  further message *before* any agent replies (self-continuation rate) — the delay buys thinking
  room rather than dead time. *No published precedent; this is ChatterED's own claim*, and the
  mechanism the developer cares about ("after 1 min if student not respond, then AI2 can answer",
  `Multi Agent AI ED/README.md`).
- **H3c (secondary).** Delay does not reduce session length or return rate. Tan et al. found no
  NASA-TLX or expectation-gap effects, so a null here is the expected result; a *negative* effect
  is the kill signal for the mechanic.
- **H3d (exploratory).** Latency perception (Yes/No noticed, Tan et al. §3.5.4) moderates H3a —
  students who did not consciously notice the delay should show a weaker thoughtfulness effect.

### RQ4 — The ledger as an instrument (cross-cutting)

- **H4 (secondary).** LLM-computed Explanation-Ledger coverage at session end correlates with
  post-test score controlling for pre-test (target: Spearman ρ ≥ .5). If it does not, the ledger is
  a UI affordance only and must not be reported as a learning measure. See `progress-tracking.md` §8.

### RQ5 — The Kai teach-back round (exploratory, opt-in, not manipulated)

`design-brief.md` §D1 makes the Tutee agent an *invited* closing round rather than a standing third
voice, gated on a filled ledger (`progress-tracking.md` §6.5). It is **not** added as a fourth
experimental factor — Study A cannot carry one, and forcing an opt-in feature destroys the thing
that makes it safe.

- **H5a (exploratory).** Blocks that include a teach-back show more Cognitive acts (`COG-*`) in the
  final third than blocks that do not. *Basis:* the protégé effect and Xu et al.'s highest
  cognitive-investment finding for the Tutee role (§6.1.1), plus their §6.3(1) recommendation to use
  a Tutee for a concluding review phase.
- **H5b (exploratory).** Accepting the teach-back is associated with higher Pressure/Tension.
  *Basis:* Tutee was the highest-pressure condition in Xu et al. (M = 4.02 vs Peer 2.49). If it
  replicates even for a 3-minute opt-in round, the feature needs a warning in its invitation copy.
- **Analysis:** self-selected, so descriptive only — report the accept rate, both group means with
  CIs, and no causal claim. If accept rates are high (>60%) it becomes the primary within-subject
  factor for a follow-up study, which is exactly what `design-brief.md` §D1 anticipates.

---

## 3. Design

### 3.1 Study A — controlled session (Assignment 2 user testing)

**Mixed 2×2.** Audience (Group vs Single) **within**-subjects; Whisper (On vs Off) **between**-
subjects. Latency held constant at **Delayed** in both blocks (it is part of the design under test,
and Study B tests it properly).

Why this split:
- Audience within-subjects buys the most power per participant, and the paired contrast is
  immune to the huge between-person variance in prior knowledge and verbosity.
- Whisper cannot be within-subjects: once a student has used a private channel, taking it away is
  a salient deprivation and invites demand effects. Between-subjects, treated as
  lower-powered/exploratory-leaning-secondary, is the honest choice.
- Two blocks require **two matched concepts** (A and B) so the second block is not contaminated by
  the first. See §4.1.

**Counterbalancing.** 4 sequences, crossed with the 2 Whisper cells = 8 allocation slots. Fill in
blocks of 8 from a randomisation list generated once, before recruitment, and stored in the repo as
`docs/research/allocation-studyA.csv` (allocation list only — never participant identity).

| Seq | Block 1 | Block 2 |
|---|---|---|
| S1 | Concept A, Group | Concept B, Single |
| S2 | Concept A, Single | Concept B, Group |
| S3 | Concept B, Group | Concept A, Single |
| S4 | Concept B, Single | Concept A, Group |

**n.** Target **20 completed** (10 per Whisper cell), **minimum 12**, recruit **24** to absorb
attrition. Sensitivity, not power-to-detect-a-guessed-effect: at n=20, α=.05 two-tailed, 80% power,
a paired test detects **dz ≈ 0.66**; at n=12, **dz ≈ 0.88**. Xu et al.'s role effects on pressure
and absorption were large (η²p = .18–.20), so the within-subject process contrasts are plausibly in
range; the between-subject Whisper contrast at 10-vs-10 is **not** (detectable d ≈ 1.3) and must be
reported as exploratory with effect sizes and CIs, never as "no difference".

**Session length: 70 min.** (A 45-min lean variant is in §3.3 if recruitment stalls.)

| Phase | Min | Notes |
|---|---|---|
| Consent, PIS, demographics | 5 | §9.1. Programme / year / gender only. |
| Pre-test (both concepts, 12 items) | 6 | Single combined pre-test avoids priming block 2. |
| **Block 1**: material (6) → interaction (12) → post-test A (3) → survey (4) | 25 | Interaction is timed server-side and hard-stopped. |
| Break | 2 | |
| **Block 2**: material (6) → interaction (12) → post-test B (3) → survey (4) | 25 | Same survey battery, re-anchored to "the group / the agent you just talked to". |
| Exit interview + debrief | 8 | §7.3, §9.4. Debrief is mandatory, not optional. |

**Pilot.** 2 pilot sessions (not analysed, not counted toward n) before the first real session, to
time the blocks and shake out the ledger's JSON failure path. Freeze the protocol after pilot 2.

**Recruitment.** Same channels and exclusions as `interview-guide.md` §1 — no one the researcher
TAs, supervises or grades. A1 interviewees **may** return for Study A (note it as a covariate,
`prior_exposure = yes`), but must not be more than ~25% of the sample.

### 3.2 Study B — live deployment (after Study A, term-time)

**Between-subjects, user-level sticky randomisation** on **Latency** {Immediate ~1 s, Delayed
8–12 s}. Audience is fixed at Group and Whisper fixed at On — the configuration Study A endorsed.
Opportunistic n: **40–100 students, 4–6 weeks**, multiple sessions per student (repeated measures →
mixed-effects models, §8.4).

Assignment is by hashed user id → stable arm, so a student never sees the latency flip mid-term.
One-item exit micro-survey per session (see §5.6) keeps the burden at one tap; the full battery is
offered once, at session 3, opt-in.

**Consent surface is different here** and this is the part most likely to go wrong — see §9.2.
Students who decline research participation get the full product with **no research logging**, only
the operational minimum (§7.4).

### 3.3 Lean fallback (use only if ≤12 recruited by the Study A deadline)

Drop Whisper to a within-subjects *observation* (On for everyone, usage counted, no contrast),
keep Audience within-subjects, keep n≥10, and report the whisper RQ as descriptive with usage
counts, quotes and the H2b non-inferiority check against a historical baseline. Say plainly in the
report that RQ2 was downgraded and why. A downgraded RQ honestly reported beats an underpowered
significance claim.

---

## 4. Materials

### 4.1 Two matched concepts

Requirements (adapted from Xu et al. §4.2's three criteria): conceptual not rote; **not** common
prior knowledge for the sample; learnable from a 6-minute condensed reading; explainable in 12
minutes; and — added for ChatterED — possessing **4–6 separable claim slots** so the Concept
Ledger has something to track (`progress-tracking.md` §3).

Concept pair must be matched on: number of ledger elements (5 each), reading word count (±10%),
pre-test item count, and pilot-measured difficulty (mean pre-test score within 1 item).

Worked candidate pair (CS-track sample, matching `interview-guide.md` Variant B):
- **Concept A** — *Amortised analysis of dynamic-array append* (the worked example in
  `progress-tracking.md` §7).
- **Concept B** — *Why binary search on a rotated sorted array still runs in O(log n)*.

Alternative pair for a quantitative-track sample (Variant A): *convexity and the
positive-semidefinite Hessian* (the concept `design-brief.md` §G already scripts in full) paired
with *why a confidence interval is not a probability statement about the parameter*.
**Pick one pair and use it for every participant**, matching whichever variant the A1 interviews
actually recruited (`interview-guide.md` §0). Source the readings from openly licensed or
module-permitted material and cite them in the A2 report.

### 4.2 Agents

- **Peer (Mei)** — collaborative partner; per turn, screens whether the student contributed, then picks
  one or two of {ask for elaboration, suggest a focus area, offer a tentative idea}
  (Xu et al. §4.1.2).
- **Challenger (Arun)** — Socratic; screens input for adequacy, analyses the statement for flaws (vague
  language, unstated assumptions), then selects one question type from {clarification, probing
  assumptions, probing reasons and evidence, probing implications and consequences, probing
  alternative viewpoints}, opening with a brief acknowledgment (Xu et al. §4.1.3).
- **Single condition** = Arun (Challenger) only. *Justification:* Challenger is the closest single-agent
  analogue to the intended ChatterED experience (pushback + explanation) and Xu et al. rate it
  "moderate pressure, high critical thinking" — the fair comparator. Comparing Group against a
  Tutee or Control would stack the deck.
- Both constrained to **~80 words** per turn (Xu et al. Figure 1 note) so that Audience does not
  confound with output volume. Log the actual word counts and check the manipulation held.
- **Prompt files are study materials.** Version them, hash them, and log the hash on every session
  (`prompt_version` field, §7.2). A silent prompt edit mid-study invalidates the comparison.

### 4.3 Silence timer

Server-authoritative (Durable Object alarm; see `cloudflare-do-limits.md` §1 — "usually within a
few milliseconds… can be delayed by up to a minute", so the UI countdown must be client-side and
cosmetic while the DO stays the source of truth). Default **60 s** of student silence, per the
developer's original framing. On fire, Mei posts a partial statement about the ledger's target
element for the student to correct (`progress-tracking.md` §6.3) — this is deliberately a
*correctable* prompt, not an answer.

**Manipulation-integrity note:** the timer and the reply delay must not collide. Reply delay
(8–12 s) is an order of magnitude below the silence window (60 s), so they are separable; log both
and verify no session had a timer fire while an agent reply was pending.

---

## 5. Instruments

All Likert items **7-point** unless stated, matching the source instruments. Anchor every item to
"the group chat you just used" / "the study partner you just used" so the two blocks are separable.
Total per-block survey time must stay ≤ 4 min — this budget is the reason NASA-TLX is cut (§5.7).

### 5.1 Objective learning — pre/post concept test
*Reuse: Xu et al. 2026 §4.5.3.* Their design: 20 MCQ, one correct + three incorrect + an
**"I don't know" option to mitigate guessing** (their ref [46]), drawn from the same source text
the participants studied.

ChatterED adaptation: **12-item combined pre-test** (6 per concept) and **6-item post-test per
block**, isomorphic forms (same construct, different surface), each item mapped to exactly one
ledger element so item-level analysis can be aligned with the ledger (§8.5, H4). Keep the
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

### 5.5 Social influence and felt pressure (the MASG battery)
*Reuse: Song et al. 2025 §3.4.1–3.4.2.*
- **Informational influence** — e.g. "My decision was influenced by the opinion of the agent(s)."
- **Normative influence** — e.g. "During the discussion I felt that I had to agree with the opinion
  of the agent(s)." *This is the H1c primary measure.*
- **Open-ended, verbatim from Song et al.:** *"During the conversation, did you feel any pressure to
  agree with the agent(s)? If so, why?"* Coded yes/no exactly as they did (any mention of or
  allusion to pressure = "yes"), which makes the rate directly comparable to their 3%/12%/18%
  benchmark for 1/3/5 agents.
- **Concession item (ChatterED addition, needs piloting):** "There was at least one point where I
  changed what I said because the agents seemed to agree with each other, not because they
  convinced me." Pair it with the transcript code `CONCEDE-NJ` (§6.2) — self-report and behaviour
  should agree, and if they do not, say so.
- **Control variables** worth one item each, per Song et al.: prior familiarity with the concept,
  general AI acceptance, and a short conformity-tendency item (their refs [74], [64], [41]).
  Younger and less-educated users were *more* susceptible in their RQ3 — an undergraduate sample is
  squarely in that group, so measure it rather than assume it away.

### 5.6 Perceived response quality and latency perception
*Reuse: Tan et al. 2026 §3.5.2 and §3.5.4 — all seven items, verbatim, 7-point:*
Clarity ("clear and easy to understand"), Relevance ("addressed the task without including
irrelevant information"), Understanding ("demonstrated a correct grasp of the task's meaning and
context"), **Thoughtfulness** ("were thoughtful and took the nuances of the task into account" —
*the H3a primary DV*), Usefulness, Trustworthiness, Expectation Gap.
Plus: *"Did you notice any delay in the agents' responses?"* (Yes/No) and, if Yes, their open-ended
follow-up on how the delays influenced interaction and quality judgements.

**Study B micro-survey** = the single Thoughtfulness item + the Yes/No delay item, one screen,
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

## 6. Interaction-act coding scheme (adapted from Xu et al. Table 2)

**Unit of analysis:** one student message. A message may carry **multiple codes** (Xu et al. §4.6.2
give a three-code example). Agent messages are not coded, but are used as context and their
metadata is logged.

### 6.1 Dimensions 1 and 2 — carried over unchanged (do not modify; comparability is the point)

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

### 6.2 Dimension 3 — ChatterED additions (new; group chat and side channel)

These exist because Xu et al. studied a **dyad**. A group chat and a private channel generate acts
their scheme has no slot for.

| Category | Subcategory | Code | Definition | Example |
|---|---|---|---|---|
| Group Addressing | Selective Address | `GRP-ADDR` | Message explicitly directed at one named agent while others can see it | "Rae, you said the copy is O(n) — but only sometimes, right?" |
| Group Addressing | Broadcast Repair | `GRP-REPAIR` | Restating for the benefit of the group after one agent misunderstands | "Let me restate that for both of you." |
| Social Pressure | **Concession without justification** | `CONCEDE-NJ` | Abandoning or softening a prior position after agent pushback **without** offering a reason, evidence, or a self-correction | "Ok yeah you're probably right." (after having been correct) |
| Social Pressure | Sustained Defence | `DEFEND` | Maintaining a position *and* supplying new grounds after a challenge | "No — the doubling is what makes the series geometric. Halving the growth factor wouldn't." |
| Social Pressure | Consensus Deference | `DEFER-CON` | Explicitly citing agent agreement as the reason to change | "Since you both think so, I'll go with that." |
| Whisper | Private Clarification | `WSP-CLAR` | Whispered request to clarify the task or an agent's message | "wait what does he mean by amortised" |
| Whisper | Private Confidence Check | `WSP-CONF` | Whispered check on whether one's own statement is right/embarrassing | "is what i said just now stupid" |
| Whisper | Private Answer-Seeking | `WSP-ANS` | Whispered request for the answer or for content the student should be producing | "just tell me the total cost" |
| Whisper | Private Rehearsal | `WSP-REH` | Trying a formulation privately before posting it publicly | "if i say the copies sum to 2n is that right" |
| Timer | Timer-Prompted Contribution | `TMR-FILL` | Message posted after the silence timer fired, responding to the Peer's fill | (metadata-derived; see §6.3) |
| Timer | Self-Continuation | `SELF-CONT` | A second student message posted before any agent reply — unprompted continuation | (metadata-derived) |

`CONCEDE-NJ` vs `MET-CORR` is the hardest boundary and must be pinned in the codebook: a
self-correction *supplies a reason or a corrected mechanism*; a concession does not. When a
concession is toward a **correct** agent position and includes no reasoning, it is still
`CONCEDE-NJ` — the construct is *unreasoned* deference, not *wrong* deference.

### 6.3 Per-message metadata (attached to every coded message, not itself a code)

`channel` (main | whisper) · `addressed_to` (peer | challenger | group | none) ·
`after_timer_fire` (bool, and ms since fire) · `agent_reply_pending` (bool, drives `SELF-CONT`) ·
`ledger_delta` (which elements advanced on this message, from `progress-tracking.md`) ·
`word_count` · `edit_latency_ms` (time from first keystroke to send — a cheap proxy for
deliberation).

### 6.4 Decision rules pinned to the design

- `WSP-ANS` rate is the **kill criterion for the whisper feature as designed**. Pre-set: if
  `WSP-ANS` exceeds 40% of whisper messages, the channel is functioning as an answer hatch and the
  A2 report must recommend a design change (e.g. the whispered agent refuses content answers and
  returns a question, mirroring how `/btw` is read-only over the main conversation —
  `critique1-btw.txt` T1).
- `CONCEDE-NJ` rate is the **social-pressure alarm**. Pre-set: if it exceeds `DEFEND` in the Group
  condition, report H1c as supported and recommend the MASG mitigation of a dissenting agent
  (§9.3).

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
  "condition": { "audience": "group", "whisper": "on", "latency": "delayed" },
  "concept_id": "amortised-append-v1",
  "prompt_version": "sha256:9f2c…",   // hash of the agent prompt bundle in force
  "app_version": "0.4.2"
}
```

### 7.1 Event catalogue

| Event | When | Event-specific fields |
|---|---|---|
| `session.start` | Room created | `sequence_id` (counterbalance cell), `ua_class` (desktop/mobile), `tz_offset` |
| `consent.recorded` | Consent captured | `consent_version`, `research_optin` (bool), `recording` (none/audio/screen) |
| `pretest.submit` | Pre-test done | `items[]{item_id, element_id, response, correct, idk}`, `duration_ms` |
| `material.open` / `material.close` | Reading pane shown/hidden | `concept_id`, `dwell_ms` — *the Xu et al. "frequency and duration of reviewing material" measures (§4.5.1)* |
| `task.start` | Interaction block begins | `deadline_ts` (hard stop) |
| `message.send` | Student sends | `channel`, `addressed_to`, `text_len`, `word_count`, `edit_latency_ms`, `agent_reply_pending`, `after_timer_fire_ms`, `msg_id` |
| `agent.turn.plan` | Orchestrator selects speaker | `agent`, `selection_reason`, `target_element_id`, `probe_type` (Socratic type, §4.2) |
| `agent.turn.scheduled` | Delay set | `agent`, `scheduled_delay_ms`, `delay_source` (condition/jitter), `due_ts` |
| `agent.turn.dispatched` | Reply released to client | `agent`, `actual_ttft_ms`, `model`, `input_tokens`, `output_tokens`, `word_count`, `msg_id`, `in_reply_to` |
| `agent.turn.error` | LLM/API failure | `stage`, `error_class`, `retry_count` — needed for the fidelity exclusion, §8.1 |
| `silence.timer.set` | After each student/agent message | `window_ms`, `due_ts` |
| `silence.timer.cancelled` | Student typed/sent in time | `remaining_ms` |
| `silence.timer.fired` | Timer expired | `filler_agent`, `target_element_id`, `fire_count_in_block` |
| `whisper.open` / `whisper.close` | Panel toggled | `agent`, `open_ms` |
| `whisper.send` / `whisper.reply` | Private turn | as `message.send` / `agent.turn.dispatched`, `channel: "whisper"` |
| `progress.update` | Ledger recomputed | `elements[]{element_id, level_before, level_after, confidence, evidence_msg_id}`, `coverage`, `ledger_latency_ms`, `parse_ok` — see `progress-tracking.md` §4 |
| `progress.view` | Ledger rail opened / hovered / hidden | `action`, `element_id`, `dwell_ms` |
| `posttest.submit` | Post-test done | as `pretest.submit` |
| `survey.submit` | Battery submitted | `instrument` (imi/fss/ct/masg/quality), `items{}`, `duration_ms` |
| `task.end` / `session.end` | Block or session ends | `reason` (completed/timeout/abandoned/withdrawn), `duration_ms` |
| `teachback.offer` / `.accept` / `.decline` / `.end` | Kai round (`progress-tracking.md` §6.5) | `elements_probed[]`, `duration_ms` — feeds RQ5 |
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
- **Log the manipulation, not just the intent.** `scheduled_delay_ms` *and* `actual_ttft_ms`;
  `window_ms` *and* actual fire time. Tan et al. excluded participants whose median observed TTFT
  exceeded 120% of assigned latency (§3.5.4, Weber's-law rationale) — you cannot apply that rule
  without both numbers.

### 7.3 Exit interview (8 min, semi-structured, Study A only)

Four questions, then stop. Do not re-run the A1 interview.
1. "Which of the two sessions did you work harder in, and what made the difference?"
2. Song et al. verbatim: *"During the conversation, did you feel any pressure to agree with the
   agent(s)? If so, why?"*
3. Whisper cell only: "When did you decide to whisper rather than post? What would you never
   whisper?" (Dennis et al.'s DM-able-but-not-group-able distinction.)
4. Show them their final ledger: "Does this match what you think you actually got across?"
   (→ H4 face validity, and the qualitative half of `progress-tracking.md` §8.)

### 7.4 Operational-minimum logging (non-consenting deployment users)

`session.start`, `session.end`, `agent.turn.error`, aggregate counts, rate-limit and abuse events.
No message text, no per-message events, no survey, no ledger export. Retained 30 days.

---

## 8. Analysis plan

### 8.1 Exclusions, declared in advance
- Sessions with `agent.turn.error` on >10% of turns.
- **Latency fidelity (Study B):** exclude a user whose median `actual_ttft_ms` exceeds 120% of the
  assigned value (Tan et al. §3.5.4).
- Study A blocks with <4 student messages (non-engagement) — reported, not silently dropped.
- Failed attention/comprehension check in the survey.
Report the exclusion count per rule in a CONSORT-style flow figure.

### 8.2 Descriptives first
Per condition: message counts, word counts, ledger coverage, whisper counts, timer fires, TTFT
distributions. Xu et al. reported word count as the headline engagement measure; do the same, and
plot per-participant paired lines for the within-subject contrast — with n=20 the paired scatter is
more informative than a bar chart.

### 8.3 Confirmatory tests (Study A)

| Hypothesis | Test | Notes |
|---|---|---|
| H1a, H1b, H1e (within, continuous) | Paired *t* if Shapiro–Wilk passes, else **Wilcoxon signed-rank**; report *dz* / rank-biserial *r* with 95% CI | Same normality-gated logic Xu et al. used (§4.6.1) |
| H1a (act counts) | **Poisson / negative-binomial GLMM**, participant random intercept, `offset = log(n_messages)` — models rate, not raw count | Preferred over t-tests on counts; falls back to Wilcoxon on per-message rates if the GLMM won't converge at n=20 |
| H1c (normative influence) | Wilcoxon signed-rank; plus χ² / McNemar on the binary "felt pressure" coding, benchmarked against Song et al.'s 3%/12%/18% | |
| H1d (learning gain) | **ANCOVA on post-test with pre-test as covariate** (Xu et al. §5.2.1's exact approach), here as a within-subject LMM with block and concept as fixed effects | Expected null; report the CI, not just *p* |
| H2a–H2c (between, Whisper) | Mann–Whitney U / Welch's *t*; H2b as a **one-sided non-inferiority test** against the pre-set 15% margin | Underpowered by construction — lead with effect size + CI |
| Mixed Audience × Whisper | **ART ANOVA** (Wobbrock et al.; the method Tan et al. used for exactly this shape of non-normal factorial data) | Interaction is exploratory |

**Multiplicity.** Holm–Bonferroni within the primary family {H1a, H1b, H1c, H2a, H2b}. Secondary and
exploratory tests are reported unadjusted and labelled as such.

**Order/carryover.** Include block order as a fixed effect in the within-subject models; report the
Audience × Order interaction. A significant carryover effect is a finding to report, not a nuisance
to hide.

### 8.4 Study B models
Sessions nested in users: linear/logistic **mixed-effects models** with a user random intercept.
H3a: Thoughtfulness ~ latency + session_index + (1|user). H3b: self-continuation as a binomial
outcome per agent-wait window. H3d: add `noticed_delay` and its interaction. Pre-set a stopping
rule (fixed 6-week window, or n=100, whichever first) so the A/B is not peeked into significance.

### 8.5 Ledger validation (H4)
Spearman ρ between end-of-block ledger coverage and post-test score, partialling pre-test. Plus
quadratic-weighted κ between LLM element levels and the researcher's blind hand-scoring on 20% of
blocks (`progress-tracking.md` §8). Report both; if κ < .60, the ledger is reported as an interface
feature only and every ledger-derived claim is struck.

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
2. **Never unanimous on a factual point.** Enforce in the orchestrator: if Mei and Arun
   would both oppose the student's position in the same window, Mei instead voices partial
   support or reframes. Song et al. §5.4.3 recommends exactly this — *"having a small portion of the
   bots side with instead of against the user"* (minority influence) — and their §5.5 lists mixed
   opinion composition as the untested case.
3. **Arun must be able to lose.** Its prompt requires it to concede explicitly ("that's
   right, and here's why it holds") when the student's justification is sound, and it may not
   re-challenge a conceded point in the same block. A challenger that never concedes is a pressure
   machine, and Xu et al. already recorded a minority (4/24) finding the Challenger
   *"overly confrontational"* and feeling *"provoked"*.
4. **The whisper channel as a designed pressure valve.** This is its research justification, not
   just a feature (`btw interaction/README.md`; Dennis et al.'s "more polite than interrupting").
   The whispered agent may not answer the concept question; it clarifies and reassures.
5. **Standing epistemic disclaimer in the UI.** "These are AI study partners. They can be wrong,
   and them agreeing with each other is not evidence." One line, always visible, near the roster.
6. **No agreement-shaped rewards.** The ledger advances on *justified* claims with quoted evidence,
   never on the student agreeing with an agent (`progress-tracking.md` §4.4, rule 4). `CONCEDE-NJ`
   must never move a ledger element. No score, no streak, no grade on the rail
   (`design-brief.md` §F3).
7. **Kai never joins a majority.** The teach-back round mutes Mei and Arun, so the live agent count
   never exceeds two (`design-brief.md` §D1; `progress-tracking.md` §6.5).
8. **An exit that costs nothing.** Leave the room at any time; no streak, no penalty, no nag.

**Debrief (mandatory, Study A; and an end-of-session card in deployment):**
- State that the agents were scripted into roles (collaborative peer, Socratic challenger) and that
  the pushback was a designed behaviour, not a judgement of the student.
- State that agent agreement carries no evidential weight.
- **Correct the record.** Hand over a one-page factual summary of the concept, flagging any
  misconception the ledger recorded as unresolved. A learning study that leaves a student more
  confidently wrong than it found them has done harm; the fix is a correction sheet, and it costs
  one page per concept.
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
| A1 window (now → 22 Sep) | One paragraph of this plan into the A1 report Step 3. Do **not** build any of it yet. |
| A2 week 1 | Ethics question answered (§9.4 Q1/Q2). Concept pair + tests written. Instruments assembled into the survey tool. |
| A2 week 2 | Implementation; logging (§7) built *before* the first pilot — retrofitting logs after piloting loses the pilot. |
| A2 week 3 | Pre-registration committed. 2 pilots. Protocol frozen. |
| A2 weeks 3–4 | 20 sessions ≈ 24 h of researcher time (70 min each + 15 min turnaround). Schedule ≤ 4/day. |
| A2 week 5 | Coding (6–8 h) + second coder's 25% + analysis. |
| After A2 | Study B, only if §9.2 and §9.4 are actually satisfied. |

**The realistic risk is not statistics, it is the calendar.** If sessions slip, cut n before cutting
the debrief, the reliability coding, or the pre-registration.

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
