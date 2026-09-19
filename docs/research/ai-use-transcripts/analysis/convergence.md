# One narrative from the six sessions: whoever asks the question does the thinking

**Status.** 19 Sep 2026. A convergent reading of the **observed interactions only**: the six
transcripts (R1–R6), their turn-level codes (`coding-final.jsonl`) and the computed measures
(`metrics.json`). **No self-report is used**: no form answers, no interviews. Lucas holds the
interview data and analyses it separately, so that the two readings can be compared; §6 lists
what to compare.

This file does not replace `findings.md` (the per-RQ results). It evaluates those results, drops
what does not hold up on a second read of the turns, and converges on one story. Where it
disagrees with `findings.md`, `attempt-first.md` or the report draft, §5 says so.

---

## 1. The narrative

**In an AI study chat, whoever asks the question does the thinking, and by default that is the
AI.** The learner points at material and the AI thinks at length. Learners who want it the other
way round have to build that themselves, and two of six did. Even then the chat gives way at
exactly the two points that matter: **when the question gets hard, the answer is one short
message away and is always given; and when the learner does produce work, the verdict on it is
unreliable and is never worked through.**

So the difficulty is **reduced persistence**, in a specific form: *the conversation gives the
learner's attempt no place, and no reason to be sustained once it gets hard.* It is a property
of the interaction's structure more than of the learner's willingness.

## 2. The pattern, in four steps

**Step 1: the default contract is ask and receive.** In R1–R5, 31 learner turns, none holds the
learner's own reasoning, and none of the 31 AI turns asks for any. The learner's side is tiny:
41 typed words against 3,829 in R2 (93:1), four turns that are a slide image and nothing else,
"What is L?", "What is I ?".
The deep questions are handed over whole ("Why is C not independent of F?", "How do we prove I is
an independent set?"), with no guess attached.

**Step 2: the answers create the next question.** In R2 and R5, 7 of the 8 worded follow-up
turns build on the AI's previous answer, not on the slide: A1 says "summed out (marginalised)",
and L3 asks "What does it mean to marginalise a probability? I only know how to marginalise
people." The learner is paying off explanation debt. The answers run 159–521 words, and three
next turns (R2 L5, L9; R5 L4) arrive faster than a full read would allow. The pitch and the size of the reply are an
observed problem, not only a reported one.

**Step 3: some learners do want to be tested, and they have to engineer it.** R1's first turn
asks for "an MCQ quiz for me attempt", and L5 comes back with "my quiz score": the attempt
happened, but **outside the conversation**, in an artefact, and the chat only saw the two items
the learner then pasted for explanation. R6's first turn asks for "questions to test my SQL".
The AI's reply put the answers under the questions, so the learner had to write "do not send the
answer with the question" (L4) and later "I will attempt the question, and based on my attempt,
you can either increase or reduce the difficulty" (L20). Wanting practice was not the missing
piece. A conversation that holds the practice in shape was.

**Step 4: the two points where it gives way (R6).**

- *Hard question → answer.* Before L20 the AI posed 6 questions. One was attempted first; five
  ended in a request for the answer ("how would you do it?", "how do we do it without ctes",
  "what's the answer", "answer?", "please solve the question"), and **all seven answer requests
  in the session were granted in full, at once**. No hint was ever asked for in 45 turns; both
  offers of hints were followed by an answer request. After L20: 17 attempts, 2 answer requests,
  and those came after 107 and 173 minutes, the first with "this query seems too complex".
- *Attempt → unreliable, unprocessed feedback.* 11 of 21 verdicts were wrong (9 called a correct
  query wrong; each refuted by running it). **17 of the 21 assessment turns also posed the next
  question in the same turn**, in 175–624 words. After L20 the learner never once tried the same
  question a second time: 0 of 17 attempts is a revision. Feedback was read past on the way to
  the next question, false corrections got "ok", and the three challenges the learner did make
  (L13, L32, L39) were all on points they were already sure of.

## 3. Evaluating the candidate difficulties

| Brief category | Transcript evidence | Verdict |
|---|---|---|
| Reduced persistence | Direct in R6 (5 of 6 questions handed back before L20; 7/7 answer requests granted). Structural in R1–R5 (no attempt visible, none asked for). | **Chosen.** It is the one the structure of all six sessions explains, and the one the R6 before/after contrast shows moving. Caveats in §4. |
| Uncritical use | The broadest evidence: 10 visible AI problems in R1–R5 against one content check; R6 catches 4 of 19. | Real, and the **second act** of the same story: it only becomes the binding problem once the learner is attempting. Carried as the feedback-grounds need, not as the headline. |
| Reduced ownership | Mixed. R2 and R4 hand over framing; R1, R4 and R6 show learners steering hard (tone, a search-keyed file, a whole practice protocol). | Not supported as the primary difficulty. These learners direct a lot; what they direct is production, not their own reasoning. |
| Other: retrieval substitution (R4) | One session builds a searchable answer file in place of understanding. | One case. Out of scope for a slide-side CUI. |

## 4. What the transcripts cannot show (and what weakens the claim)

1. **"No attempt visible" is not "no attempt".** R1 proves it: the attempt was an MCQ taken
   off-chat. Two of R6's pre-L20 answer requests came after 19 and 32 minutes, which may be
   sustained effort that was never typed. The defensible claim is that the conversation *never
   held* the attempt, so nothing could respond to it.
2. **L20 changed two things at once**: the attempt-first protocol **and** the difficulty ("please
   lower the difficulty… increase or reduce"). L18 had just raised difficulty to a past paper.
   The 4→17 / 5→2 contrast cannot be credited to attempt-first alone. Persistence in R6 tracks
   difficulty calibration at least as much as it tracks the withheld answer.
3. **One session carries the direct evidence.** R6 is 45 of 76 learner turns.
4. **Tasks differ.** R2, R3 and R5 are comprehension or note-making, where "an attempt" has no
   natural form in a chat. That is part of the finding (the chat offers none), but it is not the
   same as a learner abandoning a problem.

## 5. Where this departs from the current write-ups

- **"Offers to quiz were declined in every session"** is overstated. Quiz offers occur only in
  R2, twice, as one bullet in a boilerplate "If you want, I can…" tail that closed all 10 turns;
  R5's three offers were for diagrams and a simulation, not a test (`attempt-first.md` §1 counts
  them as self-test offers). The defensible line: *trailing offers of any kind were ignored (0 of
  13 in R2 and R5), while two of six learners asked to be tested unprompted.* R4's two "accepted
  offers" are replies to clarifying questions.
- **The R6 contrast needs the difficulty confound stated** wherever 4→17 and 5→2 appear.
- **N3 (sized, pitched replies) stands on transcript evidence alone** (step 2), so it does not
  need the form quotes to carry it.
- **N4 as observed is difficulty calibration, not progress tracking.** What the transcript shows
  is the learner steering difficulty by hand (L18, L20, L34). "I could not track my progress" is
  self-report. The lowest-level-first pick answers both, but the report should say which need
  the observed evidence supports.
- **A need the write-ups do not name: feedback must be worked through before the next question
  arrives.** 17 of 21 bundled turns, 0 of 17 revisions. The app already does this (the follow-up
  stays on the same question; a new question is a click, never a clause). The report can cite
  this observation for it, which is stronger than citing Rowland alone.

## 6. For the comparison with the interviews

Questions the transcripts raise and cannot answer; a mismatch on any of them is a finding.

1. Did they try before asking, off-screen? (R1's quiz; R6's 19- and 32-minute gaps.)
2. Why ask for the answer: too hard, out of time, or habit? (The L20 confound.)
3. Do they want to be tested? (Observed: 2 of 6 asked for it; 0 took a trailing offer.)
4. Did they notice the AI was wrong? (R2's mislabelled variables; R6's nine false negatives.)
5. Did they read the long answers, and did they feel they understood at the end?
6. Would a refused answer be tolerated, or would they leave for another tool?

## 7. How the app answers the narrative

| Step | What the app does |
|---|---|
| 1. Ask and receive | "+ Try this" on every card: Max asks, the learner answers. "+ Ask here" keeps pointing-at-the-slide, without the screenshot. |
| 2. Answers create the next question | Teacher turns near 120 words, pitched by the learner model; silence thresholds scaled to reading time. |
| 3. Practice has to be engineered | The attempt loop is the default structure, not a protocol the learner writes. |
| 4a. Hard question → answer | `rule:answer_withheld` gives one hint until one attempt exists; then **Show the answer**, which moves nothing. Questions are picked lowest level first, which is the difficulty ramp R6 asked for by hand. |
| 4b. Unreliable, unprocessed feedback | Verdict first, `p. N` grounds, a contested point never lowers a level; the follow-up stays on the same question, and a new question is a click. |

Open against the narrative: grounds are asked for, not verified (A2); difficulty adapts by
objective level only, not within an objective.
