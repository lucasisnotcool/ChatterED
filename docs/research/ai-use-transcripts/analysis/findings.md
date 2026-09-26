# What students do with AI when they study: a coded conversation analysis

**Question.** In real AI-assisted study sessions, what does the learner do, what does the
AI do, and what does the exchange leave the learner never having to do? The evidence is
**observed conversation behaviour**, not the learners' own account. Assignment 1 Step 1
asks for "observed behaviors", and self-report is the weaker evidence.

Data: 6 shared chats from the form *CS3249: AI for Student Learning and Revision*
(R1–R6). Each chat is treated as an **independent session**: its own learner, context and
moment. Sessions are compared as separate cases and never linked to one another.

Method: turn-level coding with two independent coders, computed behavioural measures,
and, for the SQL session, execution of the disputed code against PostgreSQL. Files:
`codebook.md` (v1.3), `coding-final.jsonl`, `agreement.json`, `metrics.json`,
`r6-sql-checks.json`. Pipeline: `../README.md`.

---

## 1. Research questions

- **RQ1 — Learner contribution.** What moves does the learner make, and do any contain
  their own reasoning?
- **RQ2 — AI moves.** Does the AI tell, produce, elicit or assess? Does it do the
  learner's assessable work?
- **RQ3 — Contingency.** How does each turn build on the last (uptake, offers, repair)?
- **RQ4 — Critical use.** When the AI is wrong, does the learner notice? When the AI
  judges the learner's work, is the judgement right?
- **RQ5 — Pacing and persistence.** Is the output read? When does the learner ask for the
  answer instead of trying?

## 2. Method

**Sessions** (dates are from message timestamps where the share has them):

| | Tool / model | Task (from the transcript) | Learner turns | Span |
|---|---|---|---|---|
| R1 | Claude, with tool access to a notes vault | Same-day quiz prep: weekly notes + 33-item MCQ, then questions | 6 | one sitting (no timestamps) |
| R2 | ChatGPT, gpt-5-2 | Understanding Bayesian-network lecture slides, sent as screenshots | 10 | 49 min (Feb 2026) |
| R3 | Perplexity, Claude Sonnet 4.6 (thinking) | One set of notes for "all lectures taught so far" | 1 | single turn (Apr 2026) |
| R4 | Perplexity, pplx_pro / pplx_beta / Sonnet 4.6 | Midterm debrief, then a searchable notes file keyed to tutorials | 10 | 3 min + 34 min (Mar 2026) |
| R5 | ChatGPT, gpt-4o | Understanding a tutorial construction (a random-order independent set) from a slide image | 4 | 6 min (Apr 2025) |
| R6 | ChatGPT, gpt-4o | SQL (PostgreSQL) midterm practice against a supplied schema | 45 | 3 days (Mar 2025) |

That is 76 learner turns and 76 AI turns. **R6 contributes 45 of the 76**, so results
are reported **per session**, and pooled figures are avoided.

**Coding.** The unit is one turn. The codebook (`codebook.md`) operationalises:
- dialogue acts (DAMSL-style);
- question depth (Graesser & Person 1994);
- engagement mode, ICAP (Chi & Wylie 2014);
- learner-authored content / self-explanation (Chi et al. 1989);
- uptake and repair (Linell et al. 1988; Schegloff et al. 1977);
- verification of AI output (Lee & See 2004);
- AI tutorial moves: tell / produce / elicit / assess (Graesser et al. 1995; Chi et al.
  2001);
- AI closing questions and offers, scope creep, unprompted exam framing, fidelity, and
  whether the AI did an assessable task for the learner.

The codebook grew as the data required:
- v1.1 added decision rules from reconciling R1–R4;
- v1.2 added `ATTEMPT` and `RESPOND`, first needed for R5/R6;
- v1.3 added four rules and no new codes.

Earlier codes remain valid under each version.

**Reliability.** Two coders coded all 152 turns independently:
- coder A is the analyst;
- coder B is a separate Claude Opus instance given only the codebook and the
  transcripts. **Coder B is a model, not a human.**

| Dimension | Agreement | Cohen's κ |
|---|---|---|
| OWN, ENDQ, EXAMFRAME | 1.00 | 1.00 |
| L-ACT, Q-DEPTH, ICAP, A-MOVE, ANSWERS-TASK | 0.93–0.99 | 0.91–0.98 |
| UPTAKE, VERIFY, OFFER | 0.92–0.97 | 0.90 |
| FIDELITY | 0.84 | 0.68 |
| SCOPE | 0.95 | 0.57 (a κ artefact of prevalence: 71 of 76 final codes are `N`) |

The 40 disagreements were reconciled. Each reason is recorded in `coding-final.jsonl`.

**Execution check (R6).** R6 is a SQL practice session in which the AI grades the
learner's queries. 15 disputed AI claims were settled by running the learner's and the
AI's queries **verbatim** on PostgreSQL 17.3. The runs used the schema the learner
supplied and a small synthetic dataset (`scripts/verify_r6_sql.py` →
`r6-sql-checks.json`). A claim is marked refuted only where execution contradicts it.

**Computed measures** (`metrics.json`):
- words typed vs pasted;
- gaps between turns, and the reading rate a full read of each answer would need, against
  238 wpm (Brysbaert 2019);
- lexical uptake;
- prompt reuse;
- formatting density;
- model switching.

---

## 3. Results

### 3.0 Two interaction regimes

The sessions fall into two regimes, and the difference is the structure of the activity.

| | R1 | R2 | R3 | R4 | R5 | R6 |
|---|---|---|---|---|---|---|
| Learner turns with own domain content (OWN) | 0/6 | 0/10 | 0/1 | 0/10 | 0/4 | **24/45** |
| AI turns ending in a question the learner must answer (ENDQ) | 0/6 | 0/10 | 0/1 | 0/10 | 0/4 | **29/45** |
| AI turns that elicit or assess | 0 | 0 | 0 | 0 | 0 | **31** |

- **R1–R5: "ask and receive."** The learner asks, and the AI tells or produces. No turn
  in any of these five sessions contains the learner's own attempt, explanation or
  hypothesis. No AI turn asks the learner to think.
- **R6: "attempt and get feedback."** The AI poses a question, the learner submits a
  query, and the AI assesses it. **The learner set up this structure, not the AI:**
  - L4 asks for "a practice question not seen in the assignment and **do not send the
    answer** with the question";
  - L20 writes: "for the next few questions, **I will attempt the question**, and based on
    my attempt, you can either increase or reduce the difficulty".

  Before L20 the AI answered its own practice questions whenever asked (5 times). After
  L20 it held to the attempt-first protocol.

### RQ1 — Learner contribution

| ICAP (Passive / Active / Constructive / Interactive) | R1 | R2 | R3 | R4 | R5 | R6 |
|---|---|---|---|---|---|---|
| | 1/5/0/0 | 4/6/0/0 | 1/0/0/0 | 4/6/0/0 | 1/3/0/0 | 17/4/19/5 |

- **R1–R5 contain no Constructive or Interactive turn.** Engagement is either asking for
  delivery, or pointing at material ("what is L?", "what is I?", a pasted quiz item).
- **All the deep questions in R1–R5 are handed over whole.** Each asks the AI to supply
  the reasoning, and none offers a guess:
  - "…Discuss." (R1 L6);
  - "why is C not independent of F?" (R2 L5);
  - "what if the random ordering was abcd instead?" (R5 L3);
  - "How do we prove I is an independent set?" (R5 L4).

  R5 L3 is the closest any of the five comes to generating a case: the learner varies
  the AI's example. The AI works it out for them.
- **R2:** 4 of 10 turns are a slide image with no words, so the learner hands over even
  the framing of the question.
- **R4:** no knowledge question at all in 10 turns. All 10 turns direct production.
- **R6:** 21 `ATTEMPT` turns (the learner's own SQL) and 5 Interactive turns. In the
  Interactive turns the learner:
  - revises after feedback (L10);
  - writes their own version, which adds a condition the AI's model answer missed (L6);
  - corrects the AI (L13, L32);
  - reverses the roles: "this query is not possible. **to check you understanding,
    explain to me why** it is not possible" (L39).

### RQ2 — AI moves

| | R1 | R2 | R3 | R4 | R5 | R6 |
|---|---|---|---|---|---|---|
| TELL / PRODUCE | 4 / 2 | 10 / 0 | 0 / 1 | 0 / 9 | 4 / 0 | 11 / 2 |
| ELICIT / ASSESS | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | **10 / 21** |
| Does an assessable task for the learner (ANSWERS-TASK) | 2 | 2 | 0 | 5 | 0 | **24** |
| Unprompted exam framing | 0 | **9/10** | 0 | 1 | 0 | 0 |
| Next-step offers | 0 | 10 | 0 | 3 | 3 | 4 |

- **R6** has 24 turns where the AI completes a practice item. That is not a contradiction
  of the attempt-first pattern: most are "fixed queries" attached to its assessments,
  plus 7 answers given on request (see RQ5).
- **R2:** the learner never mentions an exam, yet the AI frames 9 of 10 answers around
  one: "exam-safe", "examiners *love*", "One-line exam answer".

### RQ3 — Contingency

- **Offers that would make the learner work were declined in every session that
  received them.**
  - R2: 0 of 10 offers taken, including "Test you with 'is X independent of Y given Z?'
    questions" and "Drill this with true/false d-separation questions".
  - R5: 0 of 3 taken ("Would you like a diagram", "simulate the expected value", "a
    version with diagrams").
  - R6: both offers of hints were followed by requests for the answer ("answer?",
    "please solve the question").
  - The only offers accepted anywhere were to produce more material (R4, 2 of 3).
- **Uptake:**
  - In R1–R5, learner turns either start the next item (`NEW`: 9) or pick up the AI's
    own vocabulary (`FOLLOW`: 8).
  - In R6 the dominant move is `RESPOND` (18): answering a question the AI posed. That
    move does not occur in R1–R5.
- **Repair:**
  - R1–R5: 1 repair in 31 learner turns, and it concerned a missing keyword.
  - R6: 3 explicit repairs, all of them correct challenges to the AI (L13, L32, L39).

### RQ4 — Fidelity, and whether the learner catches it

**R1–R5.** 10 of 31 AI turns have a problem visible within the transcript. The learner
checks content once, and that check is lexical:

| Session | Problem |
|---|---|
| R2 | **ERROR:** decodes the slide's variables as H = "Hemoptysis", F = "Fever"; a later slide shows H = History of smoking. **CONTRADICT:** "because conditioning on a collider opens a path", for a path the same turn shows is a fork. |
| R3 | **OMIT:** "all information … taught so far" becomes Lectures 7–13 from 4 files, presented as drawn from the uploaded materials. |
| R4 | **CONTRADICT:** "not to write in exam math" vs the sample question "write the factorized joint". **OMIT:** "All keywords from Tutorial 2 now searchable"; the next turn finds one missing. **UNVERIFIABLE (4):** "30+ page", "search for any intuitive term", "all questions have exact keyword matches", and "97% concept coverage" stated right after the AI reports its own check failing. |
| R5 | **CONTRADICT:** the example's ASCII drawing does not match its stated edge set. |
| R1 | None visible. A1 **volunteers** its gaps: missing week, misfiled recording, unreadable notebooks, a figure that differs between slides and demo. |

In R2 (both problems) and R5, the learner's next turn moves on without comment.

**R6: the AI's feedback on the learner's work is wrong half the time.**

| | Count |
|---|---|
| AI turns that assess a learner query | 21 |
| … verdict refuted by execution or by the transcript | **11 (52%)** |
| — false negative: the learner's correct query is called wrong | 9 |
| — false positive: an incorrect query is called "completely correct" | 2 |
| AI model answers that are wrong | 4 |

Every false negative, with the claim refuted by PostgreSQL 17.3:
- **A7:** "COUNT(*) needs an alias; without it, it cannot be accessed". The learner's query
  runs.
- **A23:** "COUNT(*) double-counts a team in the same contest". PRIMARY KEY (team, site,
  year) forbids that.
- **A26:** "you forgot to count them". The learner's query does count them.
- **A27:** "PostgreSQL does not support `COUNT(DISTINCT (a, b))`". It runs.
- **A28:** "alias issue". The query runs, and the AI's own fix uses the same correlation.
- **A30 and A31:** "`ORDER BY … LIMIT` inside `IN` is invalid in PostgreSQL". It runs.
- **A33:** "issues" that the AI's "fixed" query does not change: identical output.
- **A40:** the AI calls `EXCEPT` on (team, univ) a mistake, while stating that team
  determines univ.
- **A43:** "`= ALL (subquery)` does not work". It runs.

The false positives:
- **A36:** "completely correct", but the query has no 2024 filter: 4 rows vs 3.
- **A41:** the same, with 3 rows vs 1.

The wrong model answers:
- **A2:** built on tables that are not in the uploaded schema (`relation "contest_results"
  does not exist`).
- **A5:** omits the own-region condition, as the AI itself admits a turn later.
- **A12:** returns 2 of the 3 true last-placed teams.
- **A17:** does not run.

What the learner does with them:
- **Catches 4 of the 19 R6 fidelity problems:**
  - rewrites A5's answer with the missing condition (L6);
  - catches A12's flawed query ("you assume that the worst solve has the highest time",
    L13);
  - refutes A31 ("this is not true. pqsql allows this … I am not wrong", L32). This came
    only after the same false claim in A30 went unchallenged and the learner resubmitted
    the same construct;
  - catches the impossible question (L39).
- **Accepts two false corrections with a bare "ok" / "Ok"** (L24 after A23; L29 after
  A28).
- **Keeps going after the other false verdicts.** None of these is disputed: A7, A26, A27,
  A33, A40, A43.
- **Cannot see the false positives.** The AI tells the learner their incomplete query is
  "completely correct".

If the learner trusts these verdicts, they are taught false rules: "PostgreSQL can't
count distinct pairs", "`= ALL` doesn't work", "`LIMIT` isn't allowed in `IN`".

### RQ5 — Pacing and persistence

Reading time, reading demand at 238 wpm and session length are worked out in full in
[`reading-time.md`](reading-time.md).

| | R1 | R2 | R3 | R4 | R5 | R6 |
|---|---|---|---|---|---|---|
| Learner words typed | 113 | 41 | 23 | 421 | 28 | 1,318 |
| AI words per typed learner word | 20 | **93** | 52 | 12 | 35 | 10 |
| Median gap before the next turn (min) | — | 3.4 | — | 5.7 | 2.8 | 5.9 |

**Answers not read in full before the next turn.** These are turns where the gap is
shorter than a full read at 238 wpm would take:
- **R2:** L5 came 1.5 min after 436 words (287 wpm needed), and L9 came 0.7 min after
  442 words (678 wpm needed).
- **R5:** L4 came 27 s after 238 words, and asks for a proof that A1 had already
  sketched.
- **R4:** the next query arrived about 1 min after each ~1,850-word debrief, and that
  minute includes generation time.

**R6 persistence, before and after the learner's L20 protocol:**
- **Before L20:** 4 attempts and 5 requests for the answer ("how would you do it?",
  "what's the answer", "answer?", "please solve the question", "how do we do it without
  ctes"). They came after 4 to 32 minutes.
- **After L20:** 17 attempts and 2 requests for the answer. Those 2 came only after 107
  and 173 minutes on the question ("this query seems too complex. what is the answer?",
  "send me the answer").

**R4** switches model 6 times in 10 turns, and its later prompts are templated
(similarity 0.41–1.00).

### Interaction profiles (L-ACT sequence)

- **R1** PRODUCE → DEFINE → DEFINE → EXPLAIN(pasted quiz item) → REVISE(tone) →
  EXPLAIN("Discuss")
- **R2** DEFINE ×3 → BARE → EXPLAIN → DEFINE → BARE → BARE → EXPLAIN → BARE
- **R3** PRODUCE → (end; the coverage gap is never discovered)
- **R4** PRODUCE → CONTROL ×2 → REVISE ×7 (understanding requested once, then a
  searchable crib file with the tutorial answers built in)
- **R5** DEFINE → EXPLAIN(example) → EXPLAIN(what-if) → EXPLAIN(proof)
- **R6** PRODUCE → … → EXPLAIN ×5 interleaved with 4 ATTEMPTs → **CONTROL (L20: "I will
  attempt")** → ATTEMPT ×17 interleaved with 3 REPAIR challenges → EXPLAIN ("send me the
  answer")

---

## 4. What remains difficult, in the brief's terms

| Brief category | Observed evidence | Where |
|---|---|---|
| **Reduced persistence** | In R1–R5, every deep or assessable item goes to the AI with no visible attempt. In R6, before the learner-imposed protocol, 5 requests for the answer came after 4–32 minutes | R1–R5; R6 L5–L19 |
| **Uncritical use of AI output** | In R1–R5, 10 AI problems and 1 content check, which was lexical. In R6, 4 of 19 problems caught; false corrections accepted with "ok"; false positives invisible | all six |
| **Reduced ownership / self-direction** | The AI decides content and framing: bare-image turns, unrequested exam framing, a production goal drifting into keyword injection. **R6 is the counter-case**: the learner designed the practice protocol themselves | R2, R4 vs R6 |
| **Other: unreliable feedback on the learner's own work** | When the learner **does** produce work, the AI's verdict is wrong in 11 of 21 cases, and mostly in the discouraging direction (9 false negatives) | R6 |
| **Other: retrieval substitution** | Understanding the material is replaced by a file that finds answers when searched | R4 |

Two statements the evidence supports:
1. **Across five of six sessions, the conversation never required the learner to produce
   anything.** The AI never asks, and the learner never volunteers. Offers of self-testing
   were declined in every session that received them.
2. **In the one session built on attempts, the missing piece was trustworthy feedback, not
   effort.** The learner attempted 21 times. Half the verdicts were wrong, and the learner
   could only rebut the ones they were already confident about.

## 5. Design implications for ChatterED

Each implication is tied to evidence in this file. Design decisions themselves stay in
`docs/research/` and the product issues.

| Evidence | Implication |
|---|---|
| R1–R5: 0/31 OWN, 0 ENDQ; self-test offers declined in R2, R5, R6. R6: attempts appear only once the learner imposes attempt-first (L4, L20) | **Attempt-first has to be built into the product, not offered.** The one productive session exists only because the learner built the protocol by hand. The Explanation Ledger (moves only on the learner's words) and Max firing on a visible rule are this protocol made default. |
| R6: 11/21 verdicts wrong, 9 of them false negatives; "ok" to false corrections | **Feedback must be checkable, not asserted.** Every judgement needs visible grounds that the learner can inspect: for a slide, the cited region; for code, an execution result. Where the grounds are weak, the system should say so instead of saying "completely correct". The Ledger must never mark an entry wrong on an unsupported claim. |
| R2/R5 errors pass unremarked; R3 silent omission; R1 volunteered disclosure | **Make checking cheap and coverage visible.** Keep answers anchored to the segment. Keep the document whole in the flow, so missing pages are visible as missing. |
| R2 4 bare-image turns; R5 slide + "what is I?" | **Asking happens at the segment**, without screenshots. |
| 93:1 (R2) and 35:1 (R5) words; answers skimmed; unprompted exam framing | **Short REFERENCE answers, plainly framed**, sized to the question. |
| R6 L39 "to check you understanding, explain to me why" | Learners will test the system when invited to. **Letting the learner challenge an answer** is a useful move to support in the product. |

## 6. Limitations

- **n = 6 independent sessions.** R6 is 59% of all turns, so figures are per session.
- **Shares are incomplete:**
  - slide images and attached files are not exported (R2, R5, R6), so SCOPE and "who
    introduced a term" are coded conservatively;
  - R1 has no timestamps;
  - R4's generated files are not retrievable, so only the claims about them are coded.
- **Timing:** R4's timestamps are query times, so its gaps include generation time. The
  reading-rate figures are lower bounds on what full reading would need.
- **The R6 execution checks** use a small synthetic dataset. They can **refute** a claim
  (the query runs; the outputs differ). They do not prove the learner's queries correct
  in general.
- **Coder B is a model.** The κ values show the codebook can be applied consistently.
  They do not replace a human second coder.
- **"OWN = 0" means none visible in the conversation**, not that no thinking happened.
  That is exactly the gap a CUI can close.

## 7. Report-ready observations (Step 1)

- "In five of six AI study sessions, none of 31 learner turns contained the learner's own
  attempt or explanation, and the AI never asked for one. Two independent coders agreed
  on every turn (κ = 1.00)."
- "Offers to test the learner were declined in every session that received them. Offers
  to produce more material were accepted."
- "In the one session where the learner practised by attempting (SQL), attempts rose from
  4 to 17, and early requests for the answer fell from 5 to 2, after the learner told the
  AI: 'I will attempt the question'. The protocol came from the learner, not the AI."
- "In that session, the AI's verdict on the learner's query was wrong in 11 of 21 cases,
  each refuted by running the query. Nine of those called a correct query wrong. The
  learner challenged one of the nine and replied 'ok' to others."
- "In the sessions that ask and receive, 10 AI answers had visible errors, contradictions,
  omissions or unverifiable claims. The learner checked content once."

## 8. Next

The pipeline and codebook take new sessions unchanged (`../README.md`, "Adding
respondents"). The design questions this raises for A2 testing:
- **Attempt-first as default.** Does the attempt rate stay up when attempt-first is the
  default rather than learner-imposed?
- **Checkable feedback.** Do learners contest false feedback more often when the grounds
  are shown?

Code new sessions with v1.3, and have a human second coder on at least 30% of turns.

## References

- Brysbaert, M. (2019). How many words do we read per minute? *Journal of Memory and Language*, 109, 104047.
- Chi, M. T. H., et al. (1989). Self-explanations. *Cognitive Science*, 13(2).
- Chi, M. T. H., et al. (2001). Learning from human tutoring. *Cognitive Science*, 25(4).
- Chi, M. T. H., & Wylie, R. (2014). The ICAP framework. *Educational Psychologist*, 49(4).
- Core, M., & Allen, J. (1997). Coding dialogs with the DAMSL annotation scheme. AAAI Fall Symposium.
- Graesser, A. C., & Person, N. K. (1994). Question asking during tutoring. *AERJ*, 31(1).
- Graesser, A. C., Person, N. K., & Magliano, J. P. (1995). Collaborative dialogue patterns in naturalistic one-to-one tutoring. *Applied Cognitive Psychology*, 9(6).
- Lee, J. D., & See, K. A. (2004). Trust in automation. *Human Factors*, 46(1).
- Linell, P., Gustavsson, L., & Juvonen, P. (1988). Interactional dominance in dyadic communication. *Linguistics*, 26(3).
- Schegloff, E. A., Jefferson, G., & Sacks, H. (1977). The preference for self-correction in the organization of repair. *Language*, 53(2).
