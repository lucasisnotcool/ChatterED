# Joint analysis: both A1 datasets as one

**Status.** Draft, 4 Oct 2026, for Lucas and Valerie. Valerie has not reviewed it yet. It is group
material: it feeds the mid-project presentation (`midterm-deck-brief.md`) and later the final report.

**What it is.** Each A1 analysed its own data. This file pools the two datasets, Lucas's three
interviews and six logged AI study sessions, and Valerie's five interviews, and codes them as **one
dataset with one codebook**. It then cross-examines them: what people said against what the logs
show they did. The aim is the group project's first stage, "identify real user problems through user
research", done jointly. That means finding what neither A1 could see alone, as well as confirming
what both already found.

**De-identified.** Participant codes, programme and year only. N- quotes are short and verbatim from
Valerie's edited transcripts. L- interview points are the interviewer's paraphrase and are never
quoted. Raw interview data and transcripts stay local and gitignored; the coding files in
`joint-analysis/` hold codes and turn ids only.

---

## Bottom line

The two A1s named one cost from two ends: **misdirected persistence** (Lucas) and the
**scaffolding-calibration burden** (Valerie). Pooled and cross-examined, the data says *why* that
cost arises, and it adds a need that neither A1 named.

1. **The misfit runs both ways, and the task predicts its direction.** Learners call AI help too
   technical *and* too thin, too long *and* skipping steps. In the logs, notes tasks come out too
   thin, comprehension help too technical, and practice misses in both directions. No length or
   level setting fixes this. Supplying the course material doesn't either: two sharers praised how
   well the AI picked up their files, and one of them still got jargon and a misread slide (§3.1).
2. **The learner's effort exists, but it never reaches the conversation.** Interviewees try before
   asking (30+ minutes, the tutorial first, reading from scratch). The logs show quizzes taken and
   code run *off* the log, and answer requests that come only after minutes or hours on the item.
   The AI pitches to the question because the attempt is never in front of it. This is where the two
   A1 framings meet: **with no attempt to calibrate to, the AI can't calibrate (Valerie's burden), so
   the learner steers it instead (Lucas's misdirected persistence)** (§3.2).
3. **New: when learners do put their work in front of the AI, its feedback can't be trusted, and
   nobody says so.** In the one session built on attempts, 12 of the AI's 21 verdicts on the
   learner's work were wrong, and the learner contested 2 of them. Every log with a visible AI error
   lets most errors pass. Yet no L- interviewee and no form answer mentions AI errors. Only N-P4
   verifies, and their sources are checkable. **Trustworthy, checkable feedback is a latent need:
   visible in behaviour, absent from what people say** (§3.3).
4. **What works is a tutoring protocol that learners build by hand.** The two clear successes (N-P4,
   N-P5) and the one productive logged session (L-T6) all impose their own rules: a stated level, a
   teacher system prompt, "do not send the answer", attempt-then-adapt. In L-T6, once the learner set
   the protocol, attempts went from 5 to 19 and answer requests from 5 to 2. Only learners who know
   how to build one get one, and they have to keep re-imposing it (§3.4).
5. **Self-report is not a reliable guide to pitch.** In 4 of the 6 logged sessions, the sharer's form
   answer leaves out or contradicts what the log shows. The clearest case: L-T6 says the questions
   were too easy and they asked for harder ones; the only explicit difficulty request in the log
   asks to *lower* it. The design should adjust from what learners do, not from a level they state
   (§3.5).

**For the CUI.** Most of the current design survives the joint analysis. The attempt has a place
(answer in place), code decides the help, and every line cites its slide. Three things are new or
sharper: (a) Max's verdicts must show their grounds, admit doubt, and be easy to contest (from
finding 3); (b) help is pitched from the learner's own work, per request, never from a level
setting (findings 1 and 5); (c) generated practice needs quality controls: no recycled questions,
the course's methods only, and difficulty that follows results (§3.4, §5). Details are in §5.

---

## 1. The pooled dataset

Fourteen sources of two kinds. Six of them have both kinds.

| Source | What it is | Says (self-report) | Does (observed) |
|---|---|---|---|
| L-P1…L-P3 | Lucas's interviews; interviewer's paraphrase notes, 250–340 words each | ✔ | — |
| N-P1…N-P5 | Valerie's interviews; edited transcripts, 200–1,050 words (N-P3 a 3-minute voice note; N-P4 and N-P5 prepared in advance) | ✔ | — |
| L-T1…L-T6 | AI study sessions shared with consent: **the sharer's form answers** (2–4 sentences) **and the full chat log** (152 turns, 76 by learners) | ✔ form | ✔ log |

Participants: L-P1 Mech Eng Y4 · L-P2 CS Y4 · L-P3 CS Y4 · N-P1 CS Y3 · N-P2 CS Y3 · N-P3 Data Sci &
Econ Y3 · N-P4 Global Studies Y3 · N-P5 Mathematics Y3 (graduate course on exchange). L-T sharers:
programme not recorded; L-T6 is a database course, and L-T2 and L-T5 are quantitative. Each L-T
session is treated as independent. No inference is made about who shared it.

**Why pooling helps.** The interviews give reasons and wishes, but only as reported. The logs give
behaviour, but not reasons. The six L-T sessions are the only place in either A1 where one person's
account of a session can be checked against the session itself.

## 2. Method

1. **Blind open coding, twice.** Two coders worked independently on the 14 self-report sources
   (interviews and form answers). Neither saw either A1's findings, the earlier needs list, or any
   hypothesis. Coder A coded line by line (40 codes). Coder B mapped each study episode as a journey,
   from goal through breakdown and repair to outcome (38 codes). Both produced 7 themes, and they
   agreed on the strongest ones.
2. **One codebook.** The two drafts were merged into 36 codes in 7 groups (`joint-analysis/codebook.md`).
   Each code has an include/exclude rule and a **log indicator**: what it looks like in a learner–AI
   transcript.
3. **Reliability.** Two fresh coders applied the codebook independently to all 14 self-report
   sources (504 cells). Agreement on presence: 97.0%, **Cohen's κ = 0.93**. On the four-way marks
   (clear, partial, contrary, none): 95.8%, κ = 0.90. No code fell below κ = 0.63. The 15 disagreements
   were resolved against the codebook's rules, and each resolution is recorded
   (`joint-analysis/reconciliation.md`).
4. **Logs coded with the same codebook.** A separate coder applied the log indicators to all six
   sessions. It also measured timing, attempts, answer requests and level requests, and set each
   sharer's form answer claim by claim against the log. R6's AI claims had already been checked by
   executing them on PostgreSQL.
5. **Cross-examination** (this file). For each theme: what the interviews say, what the logs show, and
   what follows from having both.

**Caveats on the method.**
- All coders were instances of the same AI model (Claude Opus), so κ measures consistency between
  runs, not agreement between humans. A κ that high also reflects a codebook built from this same
  data, and many cells both coders left blank.
- **Valerie should check the coding of her five participants.** That check is the human reliability
  step this analysis is missing.

## 3. Joint findings

Each finding gives what the interviews say, what the logs show, and what neither shows alone.

### 3.1 The misfit runs both ways, and the task predicts its direction

- **Interviews.** The most widespread theme, found by both open coders:
  - **Too technical:** L-P1, L-P3, N-P3 (*"it often got too technical for me"*).
  - **Too thin or skipping steps:** N-P1 (*"it skips so many steps that it doesn't tell you anything
    more than you already knew"*).
  - **Too long:** L-P2, L-P3.
  - **Both, in one person's account:** N-P1 (*"there are two extremes"*), N-P5 (*"sometimes it will go
    super fast … or it will go super slow"*).
  - **Contrary:** N-P2, for whom the AI unpacks formulas well; N-P4, who sets their level up front.
- **Forms.** Too complicated (L-T2, L-T5); not deep or detailed enough (L-T3, L-T4).
- **Logs.** The direction follows the task:

  | Task | Sessions | How the help misses |
  |---|---|---|
  | Notes or summary | L-T3, L-T4 | Too thin: ~200 words per lecture in L-T3; six extension turns in L-T4 |
  | Comprehension of a slide or problem | L-T2, L-T5 | Too technical: 7 of 10 AI turns over 400 words for prompts of 0–7 words; notation-heavy proofs |
  | Practice | L-T6 | Both ways, item by item: "please lower the difficulty" (L20), "this query seems too complex" (L34), then a quick correct streak |

- **Neither alone shows this.** Lucas's A1 said the AI gives too much; Valerie's emphasised pace in
  both directions. Pooled, it is neither "too long" nor "too fast": **the right size depends on what
  this learner is doing and already knows**, so no fixed setting fits.
- **Context is not the learner model.** L-T1 and L-T2 both praised how the AI picked up their course
  files. L-T2 still got jargon, understood "50%", and its log shows the AI guessing the slide's
  variables from a generic textbook example (A1, contradicted at A4). Supplying the slides answers
  "which course", not "what do I already know".

### 3.2 The effort exists, but never reaches the conversation

- **Interviews.**
  - **Tries first:** N-P5 thinks *"for at least 30 mins"* before asking for small hints. L-P1 reads the
    notes and tries the tutorial before sending it to the AI. N-P4 read their sources unaided before
    turning to AI.
  - **Not laziness:** coder A's and coder B's data both argue against it.
- **Logs.**
  - **R1–R5:** no learner turn contains the learner's own attempt (0 of 31 turns).
  - **Off the log:** L-T1 took a quiz off the log (A5 reports 29 of 33) and revised the notes around
    the 4 missed items. L-T6 ran code outside the chat ("this code doesn't work", L13; "pqsql allows
    this", L32).
  - **Answer requests come late:** in L-T6 they came after a median of 7 min on the item (32 min for
    the first; 1 h 47 m and 2 h 53 m for the last two). That is no faster than the learner's own
    attempts (median ~6 min).
- **Self-report leaves the attempt out too.** L-T1's form doesn't mention the quiz, and L-T6's doesn't
  mention 24 attempt turns.
- **Neither alone shows this.**
  - The logs alone read as "no attempt" (Lucas's A1 was careful to say *no visible* attempt).
  - The interviews alone read as "students do try".
  - Together: **students do the work where the AI can't see it.** The AI answers the question as
    worded, at the question's level, because it has nothing else to go on. The learner then has to
    steer it towards the help they need.
- **How this joins the two A1s.**
  - The **calibration burden** (Valerie) is the direct consequence: the AI can't calibrate to
    reasoning it never sees.
  - **Misdirected persistence** (Lucas) is the learner's response: persisting at steering instead.
  - They are cause and effect, not two names for one thing.
- **Not everyone.** L-T2 sent two slide exercises as bare images, and L-T4's goal drifted from "a
  textbook" to a keyword-searchable store of tutorial answers with 0 attempts. The finding is that
  effort is invisible *when it exists*, not that it always exists.

### 3.3 New: feedback on the learner's work can't be trusted, and nobody says so

- **Logs.**
  - **L-T6 is the only session where the learner submitted work to be judged.** Of the AI's 21
    verdicts, **12 were wrong**: 10 objections to queries that run correctly, and 2 "completely
    correct" verdicts on incomplete queries. 11 of the 12 were refuted by executing the queries on
    PostgreSQL. The learner contested 2 and answered 2 with a bare "ok".
  - **The AI's record of the learner's "weaknesses" was built on those verdicts,** so it was largely
    false.
  - **Every other log with a visible AI error lets it pass:** L-T2 (2), L-T3 (coverage claimed
    complete, covering only Lectures 7–13), L-T5 (an inconsistent diagram). In L-T4, unverifiable
    completeness claims ("97%") were met with praise.
- **Interviews and forms.** No L- interviewee raised catching AI errors, and no form answer mentions
  one. Among N-, only N-P4 verifies, opening *"every single linked source"*. N-P2 calls AI *"still
  mostly good"*.
- **Neither alone shows this.**
  - The logs show the failure but can't say whether learners care.
  - The interviews show learners don't raise it.
  - Together, this is a **latent need**: learners rely on AI judgements of their own work that are
    often wrong, and they don't know to ask for better.
  - N-P4's case shows what changes it: when the grounds are checkable (a linked source), checking
    happens.
  - Neither A1's user needs included it. **It is the joint analysis's clearest new finding.**

### 3.4 What works is a protocol the learner builds by hand

- **Interviews.** Every success comes with a learner-imposed rule:
  - N-P4: a detailed multi-part prompt stating their JLPT level, then verification.
  - N-P5: a teacher system prompt, hints only after 30 minutes, at the cost of having to
    *"babysit the AI"*.
  - L-P2: sample questions to set the difficulty.
  - Partial workarounds: L-P3 built his own slide-and-chat app; N-P3 switched models to get simpler
    answers.
- **Logs.** L-T6's learner wrote the protocol into the chat:
  - L4: *"do not send the answer with the question"*.
  - L20: *"I will attempt the question, and based on my attempt, you can either increase or reduce
    the difficulty"*.
  - Before L20: 5 attempts and 5 answer requests. After: 19 attempts and 2 requests.
  - Caveat: L20 also lowered the difficulty, so the protocol can't take all the credit.
  - L-T4 had to re-paste its instructions three times.
- **The practice it produces decays.** L-P2 reported that question quality drops in long sessions,
  and N-P2 that the AI over-copies examples. The L-T6 log confirms both:
  - A41 recycles A4 with the year changed, labelled "Higher Difficulty, Expanded Scope"; A28
    recycles A11.
  - One question is impossible on the schema (A38) and one is degenerate (A44).
- **Neither alone shows this.**
  - The interviews show the protocols but not whether they work. The log shows one working, but not
    that it is common.
  - Together: **the tutoring behaviour that works is known, it works when imposed, and only skilled
    or determined learners impose it.** Both open coders found the same success condition: precise
    self-knowledge (a JLPT band, a rule about when to ask).
- **Who leads.** L-P1 and N-P1 want the AI to lead: *"It doesn't build the ladder for you"* (N-P1),
  and L-P1 wants a Duolingo-like progression. The self-led successes would not want it taking over.

### 3.5 What learners say about pitch is not what they do

The four claims that don't match their log:

| Session | The form says | The log shows |
|---|---|---|
| L-T6 | Questions too easy; asked for harder ones; "could not track my learning progress, so I prompted it to ask questions based on my weaknesses" | The only explicit difficulty request is to **lower** it (L20; L34 "too complex"). No turn asks for questions on weaknesses. 24 attempts and a self-designed protocol go unmentioned |
| L-T2 | The AI "picked up on the context well" | It guessed the slide's variables from a generic example (A1, contradicted at A4) |
| L-T1 | "I barely read [the notes]" | Learner turns ask about terms in the notes, and the notes were revised after the quiz |
| L-T4 | Wanted a dense, tailored textbook | By L6–L10 the goal is a keyword-matched lookup of tutorial answers, with worked solutions added |

- Six sessions and two-sentence forms can't support a rate.
- **They do mean the design shouldn't trust a stated level or stated preference over behaviour,** and
  the final study should measure from logs, not satisfaction.
- The same caution applies to the interviews, all of which are self-report.

### 3.6 Each dataset saw things the other didn't, and the logs settle some of them

| Theme | Raised in L- interviews | Raised in N- interviews | What the L-T logs show |
|---|---|---|---|
| Scope, examinability, methods the course doesn't use | 0 of 3 | N-P1, N-P2 | **Present in 3 of 6:** L-T2's unrequested exam framing on 9 turns; L-T4's goal drift; L-T6 asking for a solution without CTEs (L12) and setting exam constraints (L18, L20). **Confirmed in behaviour** |
| Checking whether I understand; a signal that I've got it | 0 of 3 | 4 of 5 | L-T1 (a quiz drove the notes), L-T6 (attempts with feedback). **Confirmed where practice happened** |
| Verifying the AI | 0 of 3 | N-P4 | Errors pass in 5 of 6 sessions (§3.3). **The need is real, but it isn't voiced** |
| Drift from the slides over a session | L-P1, L-P2 | 0 of 5 | L-T4 drifts. **Weakly confirmed** |
| Notes the learner controls and keeps | L-P2, L-P3 | 0 of 5 (N-P4's study page is a success case) | L-T4 re-feeds files to steer the notes; 1,800-word artefacts superseded within 60 s. **Confirmed for note tasks** |
| Memory across sessions | L-P3 | contrary: N-P1 *"I delete all my chats"* | Not observable. **Unsettled** |

Some of these splits come from the interview questions. Valerie's guide asked about prerequisites,
scope and stopping; Lucas's asked what a good study buddy would be. Some come from the samples:
Lucas's interviewees were Y4 engineering and computing students revising from slides, and Valerie's
covered five disciplines, with two strong success cases. **The logs are the tie-breaker. They confirm
two N-only themes (scope, checking) and one L-only theme (notes control) in behaviour.**

## 4. User needs, revised

These replace the six needs (UN1–UN6) in the 1 Oct brief, which were coded from the interviews
alone, by one coder, without the logs.

| # | Need, in the learner's terms | Main evidence | Change from UN1–UN6 |
|---|---|---|---|
| **JN1** | Help sized to what I'm doing and what I already know, not to how I worded the question, without my having to diagnose myself. That includes hints when I'm stuck. | §3.1; 12 of 14 sources in open coding; direction by task in the logs | UN1 and UN3, sharpened: the misfit is two-sided and task-dependent, and context alone doesn't fix it |
| **JN2** | My attempt, in front of whoever is helping me. | §3.2; N-P5, L-P1, N-P4; L-T1 and L-T6 off-log work | **New framing.** Links the two A1 constructs as cause and effect |
| **JN3** | Feedback on my work that is right, or that I can check. | §3.3; 12/21 in L-T6; unchallenged errors in 5 of 6 logs; N-P4 | **New.** Latent: seen in behaviour, not stated |
| **JN4** | Practice that makes me produce, stays sharp and in scope, and moves with my results. | §3.4, §3.6; N-P2, L-P2, L-T6 log | UN2, sharpened by observed decay and scope problems |
| **JN5** | Help that stays inside my course: its slides, its methods, what's tested. | §3.6; N-P1, N-P2, L-P1, L-P3; L-T2, L-T4, L-T6 logs | UN5, plus scope now confirmed in behaviour |
| **JN6** | A structure I can follow, or one I can drive myself, without having to build the tutor first. | §3.4; L-P1, N-P1 vs N-P4, N-P5, L-T6 | UN4, recast: the protocol learners build by hand becomes the default |
| **JN7** | What I make is mine and builds up: notes I control, at a length I'll read, that carry forward. | §3.6; L-P2, L-P3, L-T1, L-T3, L-T4 | UN6. **Lower confidence:** rests mostly on Lucas's data; one contrary case on memory |

## 5. What this means for the CUI

**Confirmed: keep.** These features now rest on pooled evidence, not on one A1:

| Feature | Need |
|---|---|
| The learner answers in place, in the notes (the question block) | JN2 |
| Help decided by rules in code, not by a prompt | JN6; the hand-built protocols of §3.4, made default |
| Explain and Example on any line: the learner picks the depth | JN1 |
| Every line cites its slide | JN5 |
| Progress fills only on the learner's own words | JN2, JN7 |
| A short overview the learner builds on, instead of 9,500 words of notes | JN7; L-T3 and L-T4 show the opposite failure too, so the overview must be complete in coverage even while short |

**New or sharper requirements from the joint analysis:**

1. **Max's verdicts show their grounds, admit doubt, and can be contested (JN3).**
   - Each verdict cites what it rests on: the slide line, or a worked check.
   - When the grounds are weak, it says so rather than "completely correct".
   - The learner can reply "I think I'm right", which triggers a re-check, not a repeat.
   - A wrong verdict never enters progress or the record of weaknesses.
   - This is the riskiest model call in the app, and the final study should audit verdict accuracy.
2. **Pitch from the learner's own work, per request (JN1, §3.5).** The core's `pitch` already moves
   the next question with results. It should also read what the learner has written in the notes,
   and never rely on a level the learner states once. Defaults should follow the task: an overview
   that is complete in coverage but short in each line; comprehension help in plain terms first.
3. **Quality controls on Max's questions (JN4, JN5).**
   - No near-repeats of a question already asked.
   - Only methods the deck teaches.
   - Each question checked solvable before it's shown.
   - Difficulty follows results in both directions.
4. **A place for work done elsewhere (JN2).** Learners already work on paper and in other tools. A
   quick "what I tried" line before asking would put that work where the agents can see it. It's
   small, and it addresses the root of §3.2.

**Evidence for the open group decisions** (to inform them, not settle them):
- **#60, give-up policy.** In the logs, answer requests came after real time on the item (median 7
  min, up to 3 hours), not as a reflex. L-P1 left studying with AI when he couldn't keep up. N-P5
  wants the boundary held, but sets it themselves. Releasing the answer after a visible attempt, or
  after time on the item, fits both A1s and this evidence.
- **#62, the planner seam.** §3.4 suggests the seam's job is to make the protocol that works the
  default: attempt-first, adapt to results. Valerie's controller and ChatterED's rules meet there.

## 6. Corrections to the 1 Oct deck brief

1. **"About half of the AI's 21 verdicts were wrong" → 12 of 21.** The A1 analysis
   (`ai-use-transcripts/analysis/findings.md`, RQ4) lists 10 false negatives but totals them as 9;
   its own list, and `r6-sql-checks.json`, give 10 + 2 = 12. The submitted A1 report says 10. On
   slides: "more than half (12 of 21)".
2. **"Only one [wrong verdict] was challenged" → 2 contested, both at L32 (A30 and A31), and 2 accepted
   with "ok".** The learner also caught 4 other AI errors that weren't verdicts (A2, A5, A12, A38).
3. **"Help outruns the learner" is one-sided.** Use "pitched to the question, not the learner: too
   much or too little".
4. **"Nobody raised catching AI errors"** holds for the L- interviews only. N-P4 does verify. The
   stronger, joint version is in §3.3.
5. **The needs matrix (B2)** should be rebuilt from `joint-analysis/interviews-reconciled.json`, with
   the logs as a second layer.

## 7. Limits

- **Small and unbalanced.** n = 8 interviews and 6 logs. One session (L-T6) carries most of the
  behavioural evidence, including all of §3.3's numbers. Programme is unknown for the L-T sharers.
- **The two halves differ in depth.** The L- interviews are short paraphrase notes and the N- are
  transcripts, so stance and practice codes surface mostly in N-. Theme counts show spread, not
  prevalence.
- **Interview questions shaped the answers.** Some N- topics were asked about directly (N-P4's
  prepared answer has a heading per question). Valerie flagged a leading-question risk for N-P1 and
  N-P2. The L-T form asks about workarounds outright.
- **One model family coded everything.** See §2. Valerie's check of her own participants' codes is
  the needed human step.
- **The logs were chosen by their sharers,** probably as interesting sessions rather than typical
  ones.

## Files

- `joint-analysis/codebook.md`: the 36-code joint codebook, with log indicators.
- `joint-analysis/interviews-reconciled.json`: the reconciled codes for the 14 self-report sources.
- `joint-analysis/logs-matrix.json`: the codes for the six logs.
- `joint-analysis/agreement.txt`, `joint-analysis/reconciliation.md`: reliability and resolutions.
- The blind open codings, per-cell evidence and the full log coding stay local. They hold
  paraphrase and quotation from the raw data at a density that belongs with the raw data.
