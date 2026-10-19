# Group user study: does tutorial mode smooth the start of a tutorial?

**Status.** Proposal, 19 Oct 2026, drafted for Lucas and Valerie to confirm (#66). It narrows
`group-project.md` §5 to **4 participants** and adds a qualitative RQ, keeping §5's task,
conditions and measures M1–M7. If this is agreed, §5 should point here.

**Course constraint to settle:** the final report needs a study with **at least 6** participants.
Four is enough for the final presentation (at least 3). To reach 6, run the same protocol twice
more. The 2 × 2 counterbalancing below then repeats with two of its four orders, so the extra two
should take the two least-tested orders.

## Goal

**Goal:** help students start and work through a tutorial sheet with AI, without the AI doing the
working for them.
**Sub-goal:** reduce cognitive debt, meaning the gap between a solution the student has handed in
and one they can explain without help.

"Smoothing the learning curve" is measured as four things the logs can show:
- how soon the student writes a first attempt;
- how often they stall, meaning two minutes or more with no writing and no help request;
- how much help they need before they solve the problem;
- whether they can still do it and explain it with every tool closed.

## Mixed-methods design: explanatory sequential (QUAN → qual)

Each session collects the quantitative strand first: logs, timings, scores and ratings while the
student works two problems. During a 3-minute break, the researcher picks moments from that
participant's own log: their first attempt, their highest hint, a stall, and any answer request or
Show answer. The interview is then built on those moments. Integration happens at two points:
- **when the interview is designed:** the logs choose the moments the interview asks about;
- **when the results are interpreted:** a joint display per participant sets each measure beside
  the student's account of it.

**Why not convergent:** the interview depends on what the logs show, so the two strands are not
independent. **Why not exploratory:** the exploratory phase has already happened. Both
Assignment 1 studies and the joint analysis produced DG1–DG5, and this study tests the features
built from them.

---

## RQ1: Can students work a tutorial problem end to end in tutorial mode without help?

**Rationale.** Before claiming that tutorial mode makes tutorials easier, check that students can
use it at all. That means writing in the answer slot, climbing the help ladder, following a part's
link to the lecture, using Check and revising, all without the moderator. If the interface itself
is the stall, RQ2's comparison measures the interface, not the approach.

**Research question and variables.** In ChatterED's tutorial mode, can first-time users carry out
the core actions on a proof problem without moderator help, and where do they hesitate?
- **Design:** one system, the ChatterED half of each session only. No condition is manipulated.
- **Core actions:**
  - write an attempt in the answer slot;
  - use at least one Hint rung;
  - open a part's *From the notes* link;
  - press Check and act on the feedback.
- **Measures:**
  - each action completed unaided, yes or no;
  - number of moderator interventions;
  - the Single Ease Question (1–7) after the problem.
- **Anchor, set beforehand:** at least 3 of 4 participants complete each core action unaided.

**Tasks.** The ChatterED problem from the shared session (below): "Work this problem in the sheet
until you have a solution you'd hand in. Use any help the app offers." The moderator answers
nothing about the interface and logs every request for help.

**Evidence.**
- From the app's log: the time of each core action.
- From the screen recording: hesitation, wrong clicks and stalls.
- The SEQ rating.
- In the interview: "What did you expect to happen here?" at each hesitation the researcher picked.

**What this RQ can conclude:** which steps of the tutorial flow first-time users manage and which
they don't, and why. It says nothing about learning.

## RQ2: Compared with their usual AI chat, does tutorial mode change how students get into and through a problem?

**Rationale.** In the joint analysis, 0 of 31 student messages to AI held an attempt, and in one
chat the first attempt came after about 6 minutes. Tutorial mode is meant to change that:
- the answer slot sends the attempt with every request for help (DG1);
- help comes one rung at a time (DG2, DG4);
- help is drawn from the lecture (DG3).

The comparison is with what students actually do now, which is the baseline the group locked on
4 Oct.

**Research question and variables.**
- **X (within subjects):** the student works one problem in ChatterED tutorial mode and one in
  their usual AI chat with the lecture PDF attached.
- **Kept the same:** the sheet, the time limit, the lecture material and the instructions.
- **Y, from the logs** (the screen recording and chat export for the usual chat):
  - **M4:** time to first written attempt;
  - **M1:** share of help requests made after a written attempt;
  - **M2:** steering messages, which redirect the AI's level, length or format;
  - **M3:** help before solving: the highest rung, or answer requests and Show answer;
  - number of stalls.
- **Y, outcome:**
  - **M5:** problem solved, and the score on an unseen transfer question, both marked blind against
    the official solution;
  - **cognitive debt:** with every tool closed, the student explains their own solution in a few
    sentences. This is marked blind on a 0–3 rubric.
- **Y, rating:** "How stuck did you feel?" (1–7).

**Study design.** Within subjects, n = 4. Four participants fully counterbalance tool order against
problem pairing, with one participant per cell:

| | First | Second |
|---|---|---|
| S1 | ChatterED, problem A | usual chat, problem B |
| S2 | usual chat, problem A | ChatterED, problem B |
| S3 | ChatterED, problem B | usual chat, problem A |
| S4 | usual chat, problem B | ChatterED, problem A |

**Tasks.** Two comparable proof problems from one CS3230 tutorial sheet, using the same technique
and of similar length. The pilot checks that they are matched. Each problem has an 18-minute
limit, then a transfer question and the explanation, with the tools closed. Don't tell anyone to
"try first": that is the behaviour being measured.

**Evidence and analysis.**
- Show each participant's paired values side by side, for example "S2: first attempt at 1:40 in
  ChatterED and 7:10 in the usual chat".
- Summarise by direction, for example "3 of 4 started sooner in ChatterED", plus medians.
- Run no significance tests: four people cannot support them.
- M2 is coded with the joint codebook's steering rule. Lucas and Valerie code independently and
  then reconcile.

**What this RQ can conclude:** whether, for these four students, tutorial mode went with an
earlier start, more attempt-first requests, less steering and less help before solving, and
whether they could explain the result afterwards. It cannot say which feature caused a difference,
because the two tools differ in everything. RQ3's accounts and the per-feature log events are what
point to a cause. It cannot claim a learning gain either.

## RQ3 (qualitative): How do students experience starting and getting unstuck on a tutorial, and where does their account differ from what they did?

**Rationale.** The numbers in RQ2 can move for the wrong reasons. A student might attempt first
because the slot nags them, not because it helps, or climb the ladder to reach Show answer faster.
In the joint analysis, 4 of 6 students' accounts of their own AI use didn't match their logs. This
RQ explains the RQ1 and RQ2 numbers through the student's own reasons, and checks them against the
log.

**Research question.** How do students describe the moments they started, stalled and asked for
help in each tool? What made tutorial mode feel easier or harder to get into than their usual chat?
Where does that account agree or disagree with their log?

**Data.** A 12-minute cued retrospective interview. The researcher replays 3–4 moments picked from
the participant's own log and recording:
- the first attempt;
- the highest hint;
- a stall;
- any answer request or Show answer.

At each moment the researcher asks: "What were you thinking here? What did you want from the AI
right then?" Open questions follow:
- "Which tool would you open for next week's tutorial, and why?"
- "When did the help feel the right size, and when too much or too little?"

Audio is recorded with consent and transcribed. The transcript is de-identified to S1–S4 before
analysis, and raw recordings are never committed.

**Analysis.** Thematic analysis that starts from DG1–DG5 as codes (deductive) and adds open codes
for anything they don't cover (inductive). Lucas and Valerie code all four interviews separately,
compare, and keep disagreements visible. Report:
- each theme, with how many participants it came from (n of 4) and quotes;
- a said-vs-did matrix (M6): each claim a student made about their own behaviour, against the log;
- a joint display per participant: their RQ2 numbers beside the theme that explains them.

Four interviews are judged by information power (Malterud et al., 2016), not saturation. The task
is narrow, the participants are specific, and the interviews are anchored in each participant's
own log, so four can be enough to explain these behaviours. They cannot show that the themes are
complete.

**What this RQ can conclude:** why the RQ1 and RQ2 patterns happened for these students, which
parts of tutorial mode they credit or blame, and where self-report can't be trusted. It does not
generalise beyond them.

---

## Shared session (all three RQs)

**Participants.** Four NUS undergraduates who:
- have taken CS3230 or its equivalent;
- have used AI for coursework this semester;
- have not seen ChatterED.

Exclude team members and anyone who has seen the demo. Record prior knowledge of the two problems'
technique with one screening item. Run one pilot with a fifth student first, who is not counted.

**Before the first session:**
- Fix the DG5 bug: Check after Show answer still fills progress, because
  `app/src/main/tutorial/check.ts:157` calls `statusAfterCheck` without the previous status.
- Freeze the app version, model and backend, and log them.
- Read the sheet in beforehand, so participants don't wait the roughly 2 minutes it takes.
- Prepare a separate practice part, from another sheet, for the orientation.

**Procedure (about 75 min):**

| Min | Step |
|---|---|
| 5 | Consent (screen and audio recording asked for separately), background, prior-knowledge item |
| 4 | Neutral ChatterED orientation on the practice part: where the slot, Hint, Check and the lecture links are. Nothing about how to use them well |
| 18 + 5 + 1 | Round 1: the problem in tool 1; then, with tools closed, the transfer question and the explanation; then SEQ and "how stuck" |
| 18 + 5 + 1 | Round 2: the same, in the other tool |
| 3 | Break: the researcher picks 3–4 moments from each round |
| 12 | Cued retrospective interview (RQ3, and RQ1's "what did you expect") |
| 2 | Debrief: show the participant their own log, and answer questions |

**Log for each session:**
- participant code and counterbalancing cell;
- the problems and their order;
- the app build, model and date;
- the usual chat tool and model, as the participant reports them;
- the moderator's interventions.

## What the study as a whole can conclude

For four students who know the material, it can show:
- whether tutorial mode is usable unaided (RQ1);
- whether it went with an earlier, attempt-first, less-steered path through a proof problem than
  their usual AI chat, and whether they could explain their solution afterwards (RQ2);
- why, in their own words, set against what they actually did (RQ3).

It is a pattern with explanations, not an effect estimate. Two limits stay:
- The comparison is with a whole different tool, so no single feature can be credited from RQ2
  alone.
- Four participants are below the report's minimum of six.
