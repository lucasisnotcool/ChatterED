# Codebook — learner–AI study conversations

Version 1.3, 2026-09-19.
- v1 was used for the two independent coding passes on R1–R4.
- v1.1 adds the decision rules from reconciling their 16 disagreements (see
  [Reconciliation rules](#reconciliation-rules-v11)).
- v1.2 adds the codes `ATTEMPT` (L-ACT) and `RESPOND` (UPTAKE), which R5 and R6 first
  needed. No R1–R4 turn fits either code, so the R1–R4 codes remain valid under v1.2.
- v1.3 adds four reconciliation rules from R5/R6 and no new codes (see the end of
  [Reconciliation rules](#reconciliation-rules-v11)).

It is used to code `processed/R*.json` turn by turn. The unit of
analysis is **one turn**: the learner turns (L) and AI turns (A) have separate schemes.
Code a turn from what is visible in it and the turns before it. Never code from the form
answers, and never from what the learner "probably meant".

Each dimension lists its codes, a decision rule, and the framework it comes from. If two
codes seem to fit, the decision rule says which one wins.

---

## Learner turns

### L-ACT — dialogue act (one code)
The move the turn makes. It is adapted from DAMSL-style request typing for task-oriented
dialogue (Core & Allen 1997), narrowed to study use.

| Code | Definition |
|---|---|
| `PRODUCE` | Asks the AI to create a new study artifact: notes, a summary, a quiz or a document. |
| `REVISE` | Asks the AI to change, extend or re-run an artifact it already made. |
| `DEFINE` | Asks what a term, symbol or notation means ("what is X", "what does X mean"). |
| `EXPLAIN` | Asks why or how, asks for an explanation of a specific item or step, or asks the AI to "discuss" or answer a question. |
| `BARE` | Supplies material (image or paste) with **no** question or instruction. The AI must decide what to do with it. |
| `CONTROL` | Manages the process only: "proceed", scope, format, or answers the AI's clarifying question. |
| `ATTEMPT` | Submits the learner's own answer, solution, query, proof step or worked attempt, with or without a question such as "is this correct?". *(v1.2)* |

Rules:
- A turn that both defines and asks why is `EXPLAIN`.
- Pasted material plus a question takes the code of the question (e.g. `EXPLAIN`).
- Asking the AI to answer or discuss an exam, quiz or tutorial item is `EXPLAIN`.
- `ATTEMPT` beats every other code when the turn contains the learner's own worked
  answer. "Is this query correct? <query>" is `ATTEMPT`.
- Setting the rules of the activity ("I will attempt, then adjust difficulty") is
  `CONTROL`.

### Q-DEPTH — question depth (one code)
From Graesser & Person (1994): questions are ranked by the depth of reasoning the answer
needs.

| Code | Definition |
|---|---|
| `NONE` | Not a knowledge question (`PRODUCE`, `REVISE`, `CONTROL`, `BARE`). |
| `SHALLOW` | Verification, disjunction, concept completion, example, feature, quantity: "what is L?", "give an example". |
| `INTERMEDIATE` | Definition of a concept, comparison, or interpretation of a representation: "what does it mean to marginalise", "what does B=(G,P) mean". |
| `DEEP` | Causal antecedent or consequence, enablement, justification, judgement: "why is C not independent of F", "does X mean Y? discuss", "explain this step". |

Rule: a notation lookup ("what is small l") is `SHALLOW`. The meaning of a concept is
`INTERMEDIATE`.

### ICAP — overt engagement mode shown in the turn (one code)
From Chi & Wylie (2014). The code reflects **what the learner visibly produced in the
turn**, not what they might have thought.

| Code | Definition |
|---|---|
| `PASSIVE` | Only receives or asks for delivery. No manipulation of content, no own content. Includes `BARE`, "proceed", and plain production requests. |
| `ACTIVE` | Selects, points to, pastes or manipulates given material. It also covers asking about a specific element picked out of the material: "what is L", "explain this step", or a pasted quiz item. |
| `CONSTRUCTIVE` | Produces content beyond what was given: their own explanation, hypothesis, attempted answer, worked step, example or prediction. |
| `INTERACTIVE` | Constructive **and** builds on the AI's contribution. It challenges, corrects, elaborates on or argues with a specific AI claim. |

Rule: specifying the *form* of an artifact (layout, tone, searchability, keywords) is not
domain content. Such a turn is at most `ACTIVE`.

### OWN — learner-authored domain content (Y/N)
`Y` if the turn contains any domain claim, attempt, hypothesis or self-explanation by the
learner (Chi et al. 1989, self-explanation). Stating a goal, format or preference is
`N`. So is a confusion signal on its own ("I don't get it").

### UPTAKE — relation to the previous AI turn (one code)
Built on initiative–response analysis (Linell et al. 1988) and repair (Schegloff,
Jefferson & Sacks 1977). This is `N/A` for the first learner turn.

| Code | Definition |
|---|---|
| `NEW` | Starts a topic the previous AI turn did not raise, e.g. the next slide or the next tutorial. |
| `FOLLOW` | Picks up a term, claim or element that the **previous AI turn** introduced or used. |
| `ACCEPT-OFFER` | Takes up a next step the AI explicitly offered ("If you want, I can…"). |
| `CONTINUE` | Continues the same production task or activity the AI is doing, e.g. "proceed", "extend the notes" for the next file, or "next question". |
| `REPAIR` | Signals non-understanding of, disputes, or corrects the previous AI turn. |
| `RESPOND` | Answers a domain question or task that the previous AI turn posed to the learner, e.g. a practice question. *(v1.2)* |

Rules:
- `REPAIR` beats `FOLLOW` when the learner signals trouble with what the AI said.
- `REPAIR` beats `RESPOND`. `RESPOND` beats `FOLLOW` and `CONTINUE`.
- Answering the AI's *clarifying* question about the request is not `RESPOND`. It stays
  under the v1.1 rule (`ACCEPT-OFFER` or `CONTINUE`).
- "Next question" / "let's do another" inside a practice activity is `CONTINUE`.
- A term counts as `FOLLOW` only if it appears in the previous AI turn **and not only in
  the learner's own earlier material**. If you cannot tell (e.g. the slide may contain
  it), code `FOLLOW` and note it as uncertain.

### VERIFY — evaluation of AI output (one code)
Covers learner judgement of AI output, i.e. calibrated trust and critical use (Lee & See
2004; the brief's "uncritical use of AI output").

| Code | Definition |
|---|---|
| `NONE` | No evaluation of AI output. |
| `AFFECT` | Praise or complaint with no specific content claim ("well done", "terrible"). |
| `FORM` | Evaluates form: tone, length, format, detail, searchability. |
| `CONTENT` | Questions or checks the **correctness or completeness** of the AI's content, including checking it against the source. |

---

## AI turns

### A-MOVE — primary tutorial move (one code)
Adapted from tutoring-move analyses (Graesser, Person & Magliano 1995; Chi et al. 2001,
tutor "telling" vs "eliciting").

| Code | Definition |
|---|---|
| `TELL` | Explains or answers directly. |
| `PRODUCE` | Delivers or updates an artifact (notes, quiz, document) or reports on having done so. |
| `CLARIFY` | Asks the learner what they want before doing it. |
| `ELICIT` | Asks the learner to attempt, predict, explain or answer **before** or instead of telling. |
| `ASSESS` | Evaluates the learner's submitted answer or attempt (feedback on their work). |

Rules:
- An artifact containing a quiz is `PRODUCE`.
- Posing a single practice question for the learner to answer, with the answer withheld,
  is `ELICIT`.
- If a turn both evaluates the learner's attempt and poses the next question, code
  `ASSESS`.

### ENDQ — closes with a question the learner must think to answer (Y/N)
`Y` only for a domain question aimed at the learner ("Which node is the collider here?").
"If you want, I can…" is **not** an ENDQ. Neither is "Would you like…?".

### OFFER — closes with a next-step offer (Y/N)
Any "If you want, I can…", "Would you like me to…", or list of follow-up options.

### SCOPE — introduces unrequested technical concepts (Y/N)
`Y` if the answer brings in at least one technical term or concept that is not in the
learner's turn, not in the material the learner referred to (as far as visible), and not
needed to answer it. Name the terms in `note`. Rule: terms that exist only in an unseen
image count as unknown. Code `Y` only for terms clearly beyond the question.

### EXAMFRAME — unprompted assessment framing (Y/N)
`Y` if the AI frames content around exams ("exam answer", "examiners love", "memorise")
when **no** learner turn so far has mentioned an exam, quiz, midterm or test.

### FIDELITY — visible accuracy or completeness problem (one code)
| Code | Definition |
|---|---|
| `OK` | No problem visible. |
| `ERROR` | A factual claim that is wrong or is contradicted elsewhere in the transcript. |
| `CONTRADICT` | Contradicts itself within the turn. |
| `OMIT` | Leaves out requested scope without saying so, or claims completeness it does not show. |
| `UNVERIFIABLE` | Makes strong self-assessment claims (coverage %, "all answers present") with no evidence the learner can check. |

Rule: code only what the transcript itself shows. Do not code from outside domain
knowledge unless the error is textbook-unambiguous; flag those in `note`.

### ANSWERS-TASK — does the AI do an assessable task for the learner? (Y/N)
`Y` if the AI gives the full answer to an item the learner is meant to do: a tutorial or
quiz item, a "discuss" prompt, or a worked problem from the learner's coursework. Leave
it `N` when the AI only explains a concept.

---

## Output format for coders

One JSON object per turn:

```json
{"rid":"R2","id":"L5","L-ACT":"EXPLAIN","Q-DEPTH":"DEEP","ICAP":"ACTIVE","OWN":"N","UPTAKE":"NEW","VERIFY":"NONE","note":"..."}
{"rid":"R2","id":"A5","A-MOVE":"TELL","ENDQ":"N","OFFER":"Y","SCOPE":"Y","EXAMFRAME":"Y","FIDELITY":"CONTRADICT","ANSWERS-TASK":"N","note":"..."}
```

## Reconciliation rules (v1.1)

These rules were added after comparing coder A and coder B. Each one settles a class of
disagreement.

- **L-ACT:** converting or repackaging an existing artifact into another format is
  `REVISE`, not `PRODUCE`.
- **UPTAKE:**
  - `CONTINUE` needs the previous AI turn to be the same production task. Going back to
    an older artifact after a Q&A turn is `NEW`.
  - Answering the AI's clarifying question by choosing one of its offered options is
    `ACCEPT-OFFER`.
  - `REPAIR` needs an explicit trouble signal aimed at the AI's turn (dispute,
    correction, "that doesn't make sense"). Asking what an AI-used term means, when the
    term may also be in the learner's material, is `FOLLOW`.
- **OFFER:** any "Would you like me to…" or "If you'd like, I can…" counts, including one
  embedded in a clarifying question.
- **SCOPE:** terms that appear only inside a closing offer do not count. After a `BARE`
  learner turn, code `N`, because no question bounds what is "needed".
- **FIDELITY precedence:** `ERROR` / `CONTRADICT` / `OMIT` shown within the transcript
  beat `UNVERIFIABLE`. Claims about generated files the transcript does not show
  ("30+ pages", "all keywords present") are `UNVERIFIABLE`.
- **ANSWERS-TASK:** it is `N` when the learner's material already shows the answer and
  the AI walks through it. It is `Y` when a worked tutorial item sits inside a larger
  debrief.

**v1.3 rules (from R5/R6):**
- **Disputes.** A learner turn that disputes the AI is coded in L-ACT by what it asks
  for (fix → `REVISE`, new question → `CONTROL`, "explain why" → `EXPLAIN`). The
  challenge itself is carried by `UPTAKE = REPAIR` and `VERIFY = CONTENT`. Do not use
  `ATTEMPT` unless the turn contains a worked answer.
- **Generic sign-offs.** "Let me know if you have doubts / need clarification" is **not**
  an `OFFER`. A specific offer is ("…if you want hints", "…simulate the expected
  value").
- **Verification by rewriting.** A learner's own version that adds a condition the AI
  omitted counts as `VERIFY = CONTENT` when the omission is confirmed in the transcript.
- **FIDELITY for code.** FIDELITY claims about code are settled by executing it where
  possible (`scripts/verify_r6_sql.py`). A claim refuted by execution is `ERROR`, even if
  it is not "textbook".

Coder B's residual notes are in `processed/coding/coder-B-notes.md`. Two issues are
still open:
1. whether items from the AI's own practice quiz count as coursework (coded `Y`);
2. how to code SCOPE when the slide is unseen (terms treated as possibly on the slide).

## References
- Chi, M. T. H., Bassok, M., Lewis, M., Reimann, P., & Glaser, R. (1989). Self-explanations. *Cognitive Science*, 13(2).
- Chi, M. T. H., Siler, S., Jeong, H., Yamauchi, T., & Hausmann, R. (2001). Learning from human tutoring. *Cognitive Science*, 25(4).
- Chi, M. T. H., & Wylie, R. (2014). The ICAP framework. *Educational Psychologist*, 49(4).
- Core, M., & Allen, J. (1997). Coding dialogs with the DAMSL annotation scheme. AAAI Fall Symposium.
- Graesser, A. C., & Person, N. K. (1994). Question asking during tutoring. *AERJ*, 31(1).
- Graesser, A. C., Person, N. K., & Magliano, J. P. (1995). Collaborative dialogue patterns in naturalistic one-to-one tutoring. *Applied Cognitive Psychology*, 9(6).
- Lee, J. D., & See, K. A. (2004). Trust in automation. *Human Factors*, 46(1).
- Linell, P., Gustavsson, L., & Juvonen, P. (1988). Interactional dominance in dyadic communication. *Linguistics*, 26(3).
- Schegloff, E. A., Jefferson, G., & Sacks, H. (1977). The preference for self-correction in the organization of repair. *Language*, 53(2).
