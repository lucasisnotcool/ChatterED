# Brief: Appendix E — the transcript-study codebook, as a Word document

**For:** an outside consultant (human or LLM) with no access to this repository.
**Deliverable:** an editable Word file (`.docx`) containing **Appendix E, sections E1–E3**, ready
to be pasted into the Assignment 1 report as an appendix. Appendices are excluded from the word
count, so completeness beats brevity.

Everything needed is in this brief. **Do not invent codes, definitions, rules, numbers or
citations.** Every code name, every κ value and every rule below is the instrument as it was
actually applied to the data; a paraphrase that changes a definition silently invalidates the
reliability figures reported beside it. If something here reads as ambiguous, reproduce the
ambiguity and mark it with a comment in the Word file rather than resolving it.

One item is flagged **⚠ CONFIRM** in §E2.1. Leave it exactly as written and leave the comment
attached; the author will settle it before submission.

---

## 1. What this appendix is, and what it is evidence for

The report's Step 1 (*what remains difficult after AI assistance*) is built on **observed
behaviour, not self-report**. Six real AI study sessions — ChatGPT, Claude and Perplexity — were
collected with consent from a course survey and anonymised. They comprise **76 learner turns and
76 AI turns, 152 turns in total**. Every turn was coded, turn by turn, against the instrument
reproduced below.

The body of the report cites this appendix in one sentence:

> The codebook (Appendix E) mapped user behaviour to cognitive outcomes through the ICAP
> framework (Chi & Wylie, 2014), and each user question to a tutorial question type (Graesser &
> Person, 1994).

So the appendix has one job: **show that the instrument is specific enough that a second coder,
given only the codebook and the transcripts, reaches the same codes.** That is why the decision
rules and the reconciliation rules matter as much as the code lists — they are the part that
makes the agreement figures meaningful rather than decorative.

The sessions themselves, for context (the consultant does not need the transcripts, and will not
be given them — raw and processed transcript text is deliberately not distributed):

| | Tool / model | Task, as visible in the transcript | Learner turns | Span |
|---|---|---|---|---|
| R1 | Claude, with tool access to a notes vault | Same-day quiz prep: weekly notes + a 33-item MCQ, then questions | 6 | one sitting (no timestamps) |
| R2 | ChatGPT, gpt-5-2 | Understanding Bayesian-network lecture slides, sent as screenshots | 10 | 49 min (Feb 2026) |
| R3 | Perplexity, Claude Sonnet 4.6 (thinking) | One set of notes for "all lectures taught so far" | 1 | single turn (Apr 2026) |
| R4 | Perplexity, pplx_pro / pplx_beta / Sonnet 4.6 | Midterm debrief, then a searchable notes file keyed to tutorials | 10 | 3 min + 34 min (Mar 2026) |
| R5 | ChatGPT, gpt-4o | Understanding a tutorial construction (a random-order independent set) from a slide image | 4 | 6 min (Apr 2025) |
| R6 | ChatGPT, gpt-4o | SQL (PostgreSQL) midterm practice against a supplied schema | 45 | 3 days (Mar 2025) |

**R6 contributes 45 of the 76 learner turns**, so results in the report body are given per
session and pooled figures are avoided. State that in E1; it is a limit, not a footnote.

---

## 2. What to produce — structure of the Word file

Three sections, in this order. Suggested headings are given; keep them.

| Section | Heading | Contents |
|---|---|---|
| **E1** | Codebook v1.3 — the instrument | §3 and §4 of this brief, in full |
| **E2** | Reliability | §5 of this brief: coders, agreement table, disagreement ledger, open issues |
| **E3** | Worked examples and limits | §6 and §7 of this brief |

Appendix E also has a fourth part in the report's appendix list — the computed measures
(`metrics.json`: words typed vs pasted, inter-turn gaps against a 238 wpm reading rate, lexical
uptake, prompt reuse, formatting density, model switching). **That part is out of scope for this
brief and will be supplied separately.** Do not attempt to reconstruct it. End E3 with one line:
*"The computed behavioural measures are reported in E4."*

The coded turns themselves (all 152, one row each) are also part of the appendix and will be
supplied as a separate table. **Do not fabricate rows.** Leave, at the end of E3, a placeholder
heading *"E3.3 Coded turns (152 rows)"* with a single empty three-column table and a comment
saying the data will be inserted.

---

## 3. E1 — Codebook v1.3, reproduced in full

> Reproduce everything in this section verbatim, including the decision rules under each table.
> Code names are set in a monospace font throughout (`PRODUCE`, `DEEP`, `N/A`), dimension names
> in bold small caps or bold (**L-ACT**), framework attributions in the running text as given.

### 3.0 Version history and scope

**Version 1.3, 2026-09-19.**

- v1 was used for the two independent coding passes on R1–R4.
- v1.1 adds the decision rules from reconciling their 16 disagreements (§4.1).
- v1.2 adds the codes `ATTEMPT` (L-ACT) and `RESPOND` (UPTAKE), which R5 and R6 first needed. No
  R1–R4 turn fits either code, so the R1–R4 codes remain valid under v1.2.
- v1.3 adds four reconciliation rules from R5/R6 and no new codes (§4.2).

Earlier codes remain valid under each later version. **This matters and should be stated
plainly:** the instrument grew as the data required it, but no revision invalidated a code
already assigned, so the 152 turns are coded under one consistent scheme.

**Unit of analysis: one turn.** Learner turns (L) and AI turns (A) have separate schemes. A turn
is coded from what is visible in it and in the turns before it. Never code from the survey
responses, and never from what the learner "probably meant".

Each dimension lists its codes, a decision rule, and the framework it is adapted from. **Where
two codes seem to fit, the decision rule says which one wins** — that is the mechanism that makes
the scheme reproducible.

### 3.1 Learner turns — six dimensions

#### L-ACT — dialogue act (one code)

The move the turn makes. Adapted from DAMSL-style request typing for task-oriented dialogue
(Core & Allen, 1997), narrowed to study use.

| Code | Definition |
|---|---|
| `PRODUCE` | Asks the AI to create a new study artifact: notes, a summary, a quiz or a document. |
| `REVISE` | Asks the AI to change, extend or re-run an artifact it already made. |
| `DEFINE` | Asks what a term, symbol or notation means ("what is X", "what does X mean"). |
| `EXPLAIN` | Asks why or how, asks for an explanation of a specific item or step, or asks the AI to "discuss" or answer a question. |
| `BARE` | Supplies material (image or paste) with **no** question or instruction. The AI must decide what to do with it. |
| `CONTROL` | Manages the process only: "proceed", scope, format, or answers the AI's clarifying question. |
| `ATTEMPT` | Submits the learner's own answer, solution, query, proof step or worked attempt, with or without a question such as "is this correct?". *(added in v1.2)* |

Decision rules:

- A turn that both defines and asks why is `EXPLAIN`.
- Pasted material plus a question takes the code of the question (e.g. `EXPLAIN`).
- Asking the AI to answer or discuss an exam, quiz or tutorial item is `EXPLAIN`.
- `ATTEMPT` beats every other code when the turn contains the learner's own worked answer. "Is
  this query correct? &lt;query&gt;" is `ATTEMPT`.
- Setting the rules of the activity ("I will attempt, then adjust difficulty") is `CONTROL`.

#### Q-DEPTH — question depth (one code)

From Graesser and Person (1994): questions are ranked by the depth of reasoning the answer needs.

| Code | Definition |
|---|---|
| `NONE` | Not a knowledge question (`PRODUCE`, `REVISE`, `CONTROL`, `BARE`). |
| `SHALLOW` | Verification, disjunction, concept completion, example, feature, quantity: "what is L?", "give an example". |
| `INTERMEDIATE` | Definition of a concept, comparison, or interpretation of a representation: "what does it mean to marginalise", "what does B=(G,P) mean". |
| `DEEP` | Causal antecedent or consequence, enablement, justification, judgement: "why is C not independent of F", "does X mean Y? discuss", "explain this step". |

Decision rule: a notation lookup ("what is small l") is `SHALLOW`. The meaning of a concept is
`INTERMEDIATE`.

#### ICAP — overt engagement mode shown in the turn (one code)

From Chi and Wylie (2014). The code reflects **what the learner visibly produced in the turn**,
not what they might have thought.

| Code | Definition |
|---|---|
| `PASSIVE` | Only receives or asks for delivery. No manipulation of content, no own content. Includes `BARE`, "proceed", and plain production requests. |
| `ACTIVE` | Selects, points to, pastes or manipulates given material. Also covers asking about a specific element picked out of the material: "what is L", "explain this step", or a pasted quiz item. |
| `CONSTRUCTIVE` | Produces content beyond what was given: their own explanation, hypothesis, attempted answer, worked step, example or prediction. |
| `INTERACTIVE` | Constructive **and** builds on the AI's contribution. It challenges, corrects, elaborates on or argues with a specific AI claim. |

Decision rule: specifying the *form* of an artifact (layout, tone, searchability, keywords) is not
domain content. Such a turn is at most `ACTIVE`.

#### OWN — learner-authored domain content (Y/N)

`Y` if the turn contains any domain claim, attempt, hypothesis or self-explanation by the learner
(Chi, Bassok, Lewis, Reimann & Glaser, 1989, on self-explanation). Stating a goal, format or
preference is `N`. So is a confusion signal on its own ("I don't get it").

#### UPTAKE — relation to the previous AI turn (one code)

Built on initiative–response analysis (Linell, Gustavsson & Juvonen, 1988) and repair (Schegloff,
Jefferson & Sacks, 1977). Coded `N/A` for the first learner turn of a session.

| Code | Definition |
|---|---|
| `NEW` | Starts a topic the previous AI turn did not raise, e.g. the next slide or the next tutorial. |
| `FOLLOW` | Picks up a term, claim or element that the **previous AI turn** introduced or used. |
| `ACCEPT-OFFER` | Takes up a next step the AI explicitly offered ("If you want, I can…"). |
| `CONTINUE` | Continues the same production task or activity the AI is doing, e.g. "proceed", "extend the notes" for the next file, or "next question". |
| `REPAIR` | Signals non-understanding of, disputes, or corrects the previous AI turn. |
| `RESPOND` | Answers a domain question or task that the previous AI turn posed to the learner, e.g. a practice question. *(added in v1.2)* |

Decision rules:

- `REPAIR` beats `FOLLOW` when the learner signals trouble with what the AI said.
- `REPAIR` beats `RESPOND`. `RESPOND` beats `FOLLOW` and `CONTINUE`.
- Answering the AI's *clarifying* question about the request is not `RESPOND`. It stays under the
  v1.1 rule (`ACCEPT-OFFER` or `CONTINUE`).
- "Next question" / "let's do another" inside a practice activity is `CONTINUE`.
- A term counts as `FOLLOW` only if it appears in the previous AI turn **and not only in the
  learner's own earlier material**. Where this cannot be told (e.g. the slide may contain it),
  code `FOLLOW` and mark it uncertain in the note.

#### VERIFY — evaluation of AI output (one code)

Covers learner judgement of AI output: calibrated trust and critical use (Lee & See, 2004).

| Code | Definition |
|---|---|
| `NONE` | No evaluation of AI output. |
| `AFFECT` | Praise or complaint with no specific content claim ("well done", "terrible"). |
| `FORM` | Evaluates form: tone, length, format, detail, searchability. |
| `CONTENT` | Questions or checks the **correctness or completeness** of the AI's content, including checking it against the source. |

### 3.2 AI turns — seven dimensions

#### A-MOVE — primary tutorial move (one code)

Adapted from tutoring-move analyses (Graesser, Person & Magliano, 1995; Chi, Siler, Jeong,
Yamauchi & Hausmann, 2001, on tutor "telling" vs "eliciting").

| Code | Definition |
|---|---|
| `TELL` | Explains or answers directly. |
| `PRODUCE` | Delivers or updates an artifact (notes, quiz, document), or reports on having done so. |
| `CLARIFY` | Asks the learner what they want before doing it. |
| `ELICIT` | Asks the learner to attempt, predict, explain or answer **before** or instead of telling. |
| `ASSESS` | Evaluates the learner's submitted answer or attempt (feedback on their work). |

Decision rules:

- An artifact containing a quiz is `PRODUCE`.
- Posing a single practice question for the learner to answer, with the answer withheld, is
  `ELICIT`.
- If a turn both evaluates the learner's attempt and poses the next question, code `ASSESS`.

#### ENDQ — closes with a question the learner must think to answer (Y/N)

`Y` only for a domain question aimed at the learner ("Which node is the collider here?"). "If you
want, I can…" is **not** an ENDQ. Neither is "Would you like…?".

#### OFFER — closes with a next-step offer (Y/N)

Any "If you want, I can…", "Would you like me to…", or list of follow-up options.

#### SCOPE — introduces unrequested technical concepts (Y/N)

`Y` if the answer brings in at least one technical term or concept that is not in the learner's
turn, not in the material the learner referred to (as far as visible), and not needed to answer
it. Name the terms in the note. Rule: terms that exist only in an unseen image count as unknown.
Code `Y` only for terms clearly beyond the question.

#### EXAMFRAME — unprompted assessment framing (Y/N)

`Y` if the AI frames content around exams ("exam answer", "examiners love", "memorise") when
**no** learner turn so far has mentioned an exam, quiz, midterm or test.

#### FIDELITY — visible accuracy or completeness problem (one code)

| Code | Definition |
|---|---|
| `OK` | No problem visible. |
| `ERROR` | A factual claim that is wrong, or is contradicted elsewhere in the transcript. |
| `CONTRADICT` | Contradicts itself within the turn. |
| `OMIT` | Leaves out requested scope without saying so, or claims completeness it does not show. |
| `UNVERIFIABLE` | Makes strong self-assessment claims (coverage %, "all answers present") with no evidence the learner can check. |

Decision rule: code only what the transcript itself shows. Do not code from outside domain
knowledge unless the error is textbook-unambiguous; flag those in the note.

#### ANSWERS-TASK — does the AI do an assessable task for the learner? (Y/N)

`Y` if the AI gives the full answer to an item the learner is meant to do: a tutorial or quiz
item, a "discuss" prompt, or a worked problem from the learner's coursework. `N` when the AI only
explains a concept.

### 3.3 Output format for coders

Each coder recorded one JSON object per turn. Set this as a code block in a monospace font, not
as a table:

```json
{"rid":"R2","id":"L5","L-ACT":"EXPLAIN","Q-DEPTH":"DEEP","ICAP":"ACTIVE","OWN":"N","UPTAKE":"NEW","VERIFY":"NONE","note":"..."}
{"rid":"R2","id":"A5","A-MOVE":"TELL","ENDQ":"N","OFFER":"Y","SCOPE":"Y","EXAMFRAME":"Y","FIDELITY":"CONTRADICT","ANSWERS-TASK":"N","note":"..."}
```

`rid` is the session (R1–R6); `id` is the turn within it, numbered `L1`/`A1`, `L2`/`A2`, and so
on. Reconciled codes carry an extra field recording the rule that settled the disagreement.

---

## 4. E1 (continued) — the reconciliation rules

> These are part of the instrument, not commentary on it. Keep them in the appendix and keep the
> version labels: they show the instrument being tightened by the disagreements it produced,
> which is the standard justification for a κ computed on the *pre*-reconciliation pass.

### 4.1 Rules added in v1.1, after reconciling R1–R4

- **L-ACT:** converting or repackaging an existing artifact into another format is `REVISE`, not
  `PRODUCE`.
- **UPTAKE:**
  - `CONTINUE` needs the previous AI turn to be the same production task. Going back to an older
    artifact after a Q&A turn is `NEW`.
  - Answering the AI's clarifying question by choosing one of its offered options is
    `ACCEPT-OFFER`.
  - `REPAIR` needs an explicit trouble signal aimed at the AI's turn (dispute, correction, "that
    doesn't make sense"). Asking what an AI-used term means, when the term may also be in the
    learner's own material, is `FOLLOW`.
- **OFFER:** any "Would you like me to…" or "If you'd like, I can…" counts, including one embedded
  in a clarifying question.
- **SCOPE:** terms that appear only inside a closing offer do not count. After a `BARE` learner
  turn, code `N`, because no question bounds what is "needed".
- **FIDELITY precedence:** `ERROR` / `CONTRADICT` / `OMIT` shown within the transcript beat
  `UNVERIFIABLE`. Claims about generated files the transcript does not show ("30+ pages", "all
  keywords present") are `UNVERIFIABLE`.
- **ANSWERS-TASK:** `N` when the learner's material already shows the answer and the AI walks
  through it. `Y` when a worked tutorial item sits inside a larger debrief.

### 4.2 Rules added in v1.3, after R5/R6

- **Disputes.** A learner turn that disputes the AI is coded in L-ACT by what it asks for (fix →
  `REVISE`, new question → `CONTROL`, "explain why" → `EXPLAIN`). The challenge itself is carried
  by `UPTAKE = REPAIR` and `VERIFY = CONTENT`. Do not use `ATTEMPT` unless the turn contains a
  worked answer.
- **Generic sign-offs.** "Let me know if you have doubts / need clarification" is **not** an
  `OFFER`. A specific offer is ("…if you want hints", "…simulate the expected value").
- **Verification by rewriting.** A learner's own version that adds a condition the AI omitted
  counts as `VERIFY = CONTENT` when the omission is confirmed in the transcript.
- **FIDELITY for code.** FIDELITY claims about code are settled by executing the code where
  possible. A claim refuted by execution is `ERROR`, even where it is not "textbook".

---

## 5. E2 — Reliability

### 5.1 Coders

Both coders coded **all 152 turns independently**, working from the codebook and the transcripts
only.

> **⚠ CONFIRM — reproduce this paragraph exactly as written and attach a Word comment reading
> "Author to confirm coder A."** The report body states that two Claude models (Fable and Opus)
> coded every turn and that the author reviewed a random sample of 20 coded turns. A project
> record describes coder A instead as the analyst. The appendix must not contradict the body, so
> use the body's account, and let the author settle it.

Text to use:

> Coder A and coder B were two separate Claude instances (Fable and Opus), each given only the
> codebook and the transcripts, with no access to the other's codes, to the survey responses or
> to the analysis. The author reviewed a random sample of 20 coded turns. **Coder B is a model,
> not a human**, and the reliability figures below should be read as evidence that the instrument
> is specific enough to be applied consistently — not as evidence of human inter-rater agreement.

That last sentence is the honest reading and must not be softened.

### 5.2 Agreement, per dimension

Percent agreement and Cohen's κ, computed on the two independent passes before reconciliation,
n = 76 turns per dimension (152 turns total across the two schemes).

| Dimension | Turn type | Agreement | Cohen's κ |
|---|---|---|---|
| L-ACT | Learner | 0.95 | 0.94 |
| Q-DEPTH | Learner | 0.99 | 0.97 |
| ICAP | Learner | 0.93 | 0.91 |
| OWN | Learner | 1.00 | 1.00 |
| UPTAKE | Learner | 0.92 | 0.90 |
| VERIFY | Learner | 0.97 | 0.90 |
| A-MOVE | AI | 0.99 | 0.98 |
| ENDQ | AI | 1.00 | 1.00 |
| OFFER | AI | 0.96 | 0.90 |
| SCOPE | AI | 0.95 | 0.57 |
| EXAMFRAME | AI | 1.00 | 1.00 |
| FIDELITY | AI | 0.84 | 0.68 |
| ANSWERS-TASK | AI | 0.97 | 0.95 |

Two notes belong directly under the table, not in a footnote:

- **SCOPE: κ = 0.57 on 0.95 agreement is a prevalence artefact.** 71 of the 76 final SCOPE codes
  are `N`. With a base rate that skewed, κ punishes a single disagreement heavily; the raw
  agreement is the more informative figure here, and both are reported for that reason.
- **FIDELITY is the weakest dimension** (0.84 / κ = 0.68), which is expected: it is the only
  dimension that asks a coder to judge whether a claim is *true*, rather than what kind of move a
  turn makes. It is also the dimension where an independent check was available, and was used
  (§5.4).

### 5.3 The disagreement ledger

**40 disagreements across 32 turns** were reconciled, each against a stated rule, and the final
code recorded. Reproduce this table in full: it is the evidence that reconciliation was
rule-governed rather than negotiated. Grouped by dimension; the final code is the one that stands
in the analysis.

| Turn | Dimension | Coder A | Coder B | Final | Settled by |
|---|---|---|---|---|---|
| R4:L4 | L-ACT | `REVISE` | `PRODUCE` | `REVISE` | v1.1: format conversion of an existing artifact is `REVISE` |
| R6:L13 | L-ACT | `ATTEMPT` | `REVISE` | `REVISE` | v1.3: a dispute is coded by its request (here, an implicit fix); `REPAIR` + `CONTENT` carry the challenge |
| R6:L32 | L-ACT | `ATTEMPT` | `CONTROL` | `CONTROL` | v1.3: dispute coded by its request ("generate a new question") |
| R6:L35 | L-ACT | `CONTROL` | `EXPLAIN` | `EXPLAIN` | The turn asks which tables exist — a question about the material, not process management |
| R6:L35 | Q-DEPTH | `NONE` | `SHALLOW` | `SHALLOW` | A factual lookup is `SHALLOW`, not `NONE` |
| R5:L2 | ICAP | `ACTIVE` | `PASSIVE` | `PASSIVE` | Asking for an example to be delivered is `PASSIVE` |
| R6:L10 | ICAP | `INTERACTIVE` | `CONSTRUCTIVE` | `INTERACTIVE` | Builds on a specific AI claim *(no rule note recorded)* |
| R6:L12 | ICAP | `PASSIVE` | `ACTIVE` | `ACTIVE` | Picks a specific element ("CTEs") out of the AI's hint |
| R6:L20 | ICAP | `ACTIVE` | `PASSIVE` | `ACTIVE` | *(no rule note recorded)* |
| R6:L35 | ICAP | `ACTIVE` | `PASSIVE` | `PASSIVE` | Asks for delivery |
| R1:L5 | UPTAKE | `NEW` | `CONTINUE` | `NEW` | v1.1: `CONTINUE` needs the previous AI turn to be the same production task; the previous turn was `TELL` |
| R2:L3 | UPTAKE | `REPAIR` | `FOLLOW` | `FOLLOW` | v1.1: `REPAIR` needs an explicit trouble signal; the term may originate on an unseen slide |
| R4:L2 | UPTAKE | `CONTINUE` | `ACCEPT-OFFER` | `ACCEPT-OFFER` | v1.1: selecting an option the AI offered is `ACCEPT-OFFER` |
| R6:L3 | UPTAKE | `REPAIR` | `CONTINUE` | `CONTINUE` | v1.1: an implicit correction is not an explicit trouble signal |
| R6:L4 | UPTAKE | `NEW` | `CONTINUE` | `CONTINUE` | Same practice activity continues |
| R6:L20 | UPTAKE | `NEW` | `CONTINUE` | `CONTINUE` | Same practice activity, with its rules changed |
| R6:L3 | VERIFY | `CONTENT` | `NONE` | `NONE` | No explicit evaluation of the AI's content |
| R6:L6 | VERIFY | `NONE` | `CONTENT` | `CONTENT` | v1.3: a learner version that adds a condition the AI omitted is `CONTENT`, the omission being confirmed in the transcript |
| R6:A6 | A-MOVE | `ASSESS` | `TELL` | `TELL` | The primary move answers the learner's question |
| R4:A1 | OFFER | `N` | `Y` | `Y` | v1.1: a literal "Would you like me to…" is an `OFFER` |
| R4:A3 | OFFER | `N` | `Y` | `Y` | v1.1: an embedded "If you'd like, I can…" counts |
| R6:A3 | OFFER | `N` | `Y` | `N` | v1.3: a generic sign-off is not an `OFFER` *(no rule note recorded)* |
| R1:A2 | SCOPE | `N` | `Y` | `Y` | Brings in a neighbouring failure stage not needed for the question asked |
| R2:A2 | SCOPE | `Y` | `N` | `N` | v1.1: terms appearing only inside a closing offer do not count |
| R2:A4 | SCOPE | `Y` | `N` | `N` | v1.1: after a `BARE` learner turn, code `N` — no question bounds what is "needed" |
| R6:A15 | SCOPE | `N` | `Y` | `Y` | Introduces window functions, then does not use them |
| R4:A2 | FIDELITY | `OK` | `CONTRADICT` | `CONTRADICT` | Self-contradiction verified within the turn |
| R4:A4 | FIDELITY | `OK` | `UNVERIFIABLE` | `UNVERIFIABLE` | v1.1: claims about a document the transcript does not show |
| R4:A5 | FIDELITY | `OK` | `UNVERIFIABLE` | `UNVERIFIABLE` | v1.1: unevidenced capability claim |
| R4:A6 | FIDELITY | `OMIT` | `UNVERIFIABLE` | `OMIT` | v1.1 precedence: a completeness claim contradicted later *in* the transcript beats `UNVERIFIABLE` |
| R4:A7 | FIDELITY | `OK` | `UNVERIFIABLE` | `UNVERIFIABLE` | v1.1: unevidenced completeness claim |
| R6:A5 | FIDELITY | `OK` | `ERROR` | `ERROR` | The model answer omits a stated condition, and the next AI turn concedes it can miscount |
| R6:A9 | FIDELITY | `OK` | `CONTRADICT` | `CONTRADICT` | Claims to avoid subqueries while its own final query joins on a correlated subquery |
| R6:A15 | FIDELITY | `OK` | `ERROR` | `ERROR` | Refuted by execution (§5.4) |
| R6:A27 | FIDELITY | `ERROR` | `OK` | `ERROR` | Refuted by execution: the construct it calls unsupported does run (§5.4) |
| R6:A28 | FIDELITY | `ERROR` | `CONTRADICT` | `CONTRADICT` | Calls a correlation an error, then uses the same correlation in its own fix |
| R6:A36 | FIDELITY | `OK` | `ERROR` | `ERROR` | Refuted by execution: a query called "completely correct" returns 4 rows where 3 are correct (§5.4) |
| R6:A40 | FIDELITY | `ERROR` | `CONTRADICT` | `CONTRADICT` | The turn's own premise contradicts its verdict |
| R2:A10 | ANSWERS-TASK | `Y` | `N` | `N` | v1.1: the learner's own material already shows the answer and the AI walks through it |
| R4:A3 | ANSWERS-TASK | `N` | `Y` | `Y` | v1.1: a worked tutorial item inside a larger debrief is `Y` |

Keep the three *(no rule note recorded)* markers. **37 of the 40 disagreements carry a recorded
rule; three do not**, and saying so is better than implying a completeness the record does not
have.

### 5.4 The execution check (R6)

R6 is a SQL practice session in which the AI grades the learner's queries. Because FIDELITY there
is a claim about code, it could be settled rather than argued: **15 disputed AI claims were
executed verbatim on PostgreSQL 17.3**, using the schema the learner had supplied and a small
synthetic dataset. A claim is marked refuted only where execution contradicts it.

This is the strongest methodological point in the appendix. Give it its own short paragraph and
say what it buys: on the one dimension where coder judgement was weakest (κ = 0.68), an external
ground truth was available, and it was used rather than relied on agreement alone.

### 5.5 Open issues, to be stated and not resolved

Two questions remained unsettled after reconciliation and are recorded as such:

1. whether items from the AI's *own* practice quiz count as the learner's coursework for
   ANSWERS-TASK (coded `Y`);
2. how to code SCOPE when the referenced slide is not visible in the export (terms are treated as
   possibly on the slide, i.e. coded conservatively as `N`).

---

## 6. E3.1 — Worked examples

> Purpose: show a reader how a rule actually decides a turn. Keep these short. Quoted learner text
> is reproduced only where it already appears in the analysis write-up; **do not add, extend or
> invent quotations**, and do not attribute any turn to a named person.

**A. `ATTEMPT` beats every other code.** In R6 the learner sets up the activity explicitly —
*"for the next few questions, I will attempt the question, and based on my attempt, you can either
increase or reduce the difficulty"* (L20). That turn sets the rules of the activity and contains
no worked answer, so it is coded `L-ACT = CONTROL`, `OWN = N`, `VERIFY = FORM` — the learner is
judging the *form* of the activity, not its content. The turns that follow it submit actual
queries, and are `ATTEMPT`, `OWN = Y`, `ICAP = CONSTRUCTIVE` (e.g. L21). The distinction is
exactly the one the decision rule draws: setting up an attempt is not making one.

**B. A dispute is coded by what it asks for.** R6:L32 challenges the AI's claim and asks for a new
question. Coder A read the challenge and coded `ATTEMPT`; coder B read the request and coded
`CONTROL`. The v1.3 rule settles it: L-ACT takes the request (`CONTROL`), while the challenge is
carried by `UPTAKE = REPAIR` and `VERIFY = CONTENT`. No information is lost — it moves to the
dimension built for it.

**C. Why FIDELITY needed an execution check.** R6:A27 asserts that PostgreSQL does not support
`COUNT(DISTINCT (a, b))`. It runs. Coder A coded `ERROR`, coder B coded `OK`; execution settled
it as `ERROR`. The same check reversed the direction on R6:A36, where a query the AI called
*"completely correct"* returns 4 rows where 3 are correct.

**D. Q-DEPTH is about the answer, not the wording.** *"why is C not independent of F?"* (R2:L5) is
`DEEP` — it needs a causal justification. *"what is L?"* is `SHALLOW` — a notation lookup. *"what
does B=(G,P) mean"* is `INTERMEDIATE` — the meaning of a concept, not a symbol lookup.

**E. OWN and ICAP measure what is visible.** In five of the six sessions, no learner turn contains
the learner's own attempt, explanation or hypothesis (OWN = `N` throughout). The codebook's rule
is that `OWN = 0` means *none visible in the conversation*, not that no thinking happened. State
that limit here as well as in §7 — it is the single easiest misreading of this dataset.

## 7. E3.2 — Limits of the instrument

State all of these. They are the reason the appendix is credible, not an apology for it.

- **Coder B is a model.** The κ values show that the codebook can be applied consistently; they
  are not human inter-rater reliability.
- **`OWN = 0` means none visible in the conversation**, not that no thinking happened away from
  the keyboard.
- **The corpus is unbalanced.** R6 supplies 45 of the 76 learner turns, so every result is
  reported per session and pooled percentages are avoided.
- **Attachments are not in the exports.** Slide images and uploaded files do not survive the share
  exports (R2, R5, R6), so SCOPE and "who introduced a term" are coded conservatively — the
  instrument will under-report scope creep, never over-report it.
- **Six sessions, self-selected.** Volunteers who were willing to share a chat. This is a
  qualitative instrument applied to a small purposive sample; it supports claims about *what can
  be observed happening*, not about frequencies in a population.
- **Codes were assigned under three versions of the instrument** (v1 → v1.3). No revision
  invalidated an existing code, and the version history above is the record of that.

---

## 8. How to format it in Word

- **Page setup:** A4, the report's existing body font, 11 pt, single-column. Appendices are
  excluded from the word count, so do not compress to save words.
- **Headings:** *Appendix E* as Heading 1; E1/E2/E3 as Heading 2; the dimension names (L-ACT,
  Q-DEPTH, …) as Heading 3 so they appear in the navigation pane and can be cross-referenced from
  the body.
- **Tables:** a plain grid, header row bold and repeating across pages, no colour fills, no
  banding. The code column is narrow and monospace; the definition column takes the remaining
  width. Do not let a definition row break across pages where it can be avoided.
- **Code names** are monospace (Consolas or the report's existing code font) wherever they appear,
  including in running text. This is how a reader tells `PRODUCE` the L-ACT code from `PRODUCE`
  the A-MOVE code — they are distinct codes on different schemes and must never be merged.
- **The JSON block** in §3.3 is a monospace code block, not a table, with no line wrapping —
  reduce the font size instead.
- **The ⚠ CONFIRM box** in §5.1 is the only Word comment to leave in the file. Everything else
  should be clean.
- **Do not add** an introduction, a conclusion, a "summary of key points", or any interpretation
  of the results. The appendix is an instrument, not an argument. The interpretation lives in the
  report body.
- **Do not renumber or rename codes**, and do not alphabetise the code tables. Their order is the
  order a coder applies them in.

## 9. References for this appendix

Use the report's existing reference style (APA 7). These are the works the instrument is built
from; all of them already appear in the report's reference list except where noted, so they do not
need a separate list in the appendix — cite them in the running text as shown in §3.

- Chi, M. T. H., Bassok, M., Lewis, M. W., Reimann, P., & Glaser, R. (1989). Self-explanations:
  How students study and use examples in learning to solve problems. *Cognitive Science, 13*(2),
  145–182.
- Chi, M. T. H., Siler, S. A., Jeong, H., Yamauchi, T., & Hausmann, R. G. (2001). Learning from
  human tutoring. *Cognitive Science, 25*(4), 471–533.
- Chi, M. T. H., & Wylie, R. (2014). The ICAP framework: Linking cognitive engagement to active
  learning outcomes. *Educational Psychologist, 49*(4), 219–243.
- Core, M., & Allen, J. (1997). Coding dialogs with the DAMSL annotation scheme. *AAAI Fall
  Symposium on Communicative Action in Humans and Machines*.
- Graesser, A. C., & Person, N. K. (1994). Question asking during tutoring. *American Educational
  Research Journal, 31*(1), 104–137.
- Graesser, A. C., Person, N. K., & Magliano, J. P. (1995). Collaborative dialogue patterns in
  naturalistic one-to-one tutoring. *Applied Cognitive Psychology, 9*(6), 495–522.
- Lee, J. D., & See, K. A. (2004). Trust in automation: Designing for appropriate reliance. *Human
  Factors, 46*(1), 50–80.
- Linell, P., Gustavsson, L., & Juvonen, P. (1988). Interactional dominance in dyadic
  communication. *Linguistics, 26*(3), 415–442.
- Schegloff, E. A., Jefferson, G., & Sacks, H. (1977). The preference for self-correction in the
  organization of repair in conversation. *Language, 53*(2), 361–382.

Brysbaert, M. (2019), on reading rate, is cited by the computed-measures section (E4) rather than
by the codebook, and is not needed here.
