# Three interviews, coded, and set against the six transcripts

**Status.** 19 Sep 2026. Analysis of Lucas's interview notes (`Academia/Interviews/`, local and
gitignored). Done **after** the transcript-only reading (`../ai-use-transcripts/analysis/convergence.md`)
was written and committed, so the two were independent until §4 of this file puts them together.
Per Lucas's instructions the human notes were coded first; the AI-generated sheet was opened only
afterwards and is weighed in §5 as ideas, not as data.

**De-identified.** Participants are P1–P3 with programme, year and gender only. No names, no
grades, nothing else from the sheet is carried here or anywhere in the repo.

| | Programme | Year | Gender | Uses AI for |
|---|---|---|---|---|
| P1 | Mechanical Engineering (CDE) | 4 | M | Mainly answering quizzes; tutorial questions sent with the notes, "answer and explain" |
| P2 | Computer Science (SoC) | 4 | M | Understanding lecture slides via screenshots; built his own slide-viewer-plus-chat app |
| P3 | Computer Science (SoC), working part-time | 4 | F | Turning slides into notes for revision; being quizzed on the slides |

**What the data is.** Three sets of interviewer's notes, 1,200–1,600 characters each, in
paraphrase. **They are not verbatim**, so nothing below is a direct quote unless Lucas confirms the
wording; the report must present these as reported responses, or Lucas supplies the exact words.
All three are final-year, two of three are CS. n = 3 meets the brief's minimum and no more.

---

## 1. Coding

Codes were built from the notes (open coding), then grouped. A cell says what the participant
reported; an empty cell means it did not come up, not that it is false.

| Theme | P1 | P2 | P3 |
|---|---|---|---|
| **A. Can't understand the AI's explanation** (not pitched to what I know) | Cannot understand the output; lacks the background the answer assumes | Sometimes does not understand it; it does not pick up what he already knows | Does not understand many things in the generated notes |
| **B. Clarification spiral / drift from the material** | Many rounds of clarification; by the time one thing is clear he is "so far away from the notes" that he doubts the next answer has the right context | AI does not see what he sees; screenshots lack context; copy-paste to re-anchor | Additions land in the wrong place; has to ask again |
| **C. Too long** | A question ends up taking very long | Over-explains | Always too long; she knows she will not finish reading it |
| **D. Falls back / gives up** | Tried studying with AI, "could not keep up"; now uses it mainly to answer quizzes | Keeps using it, wishes it were seamless | For hard modules: reads what she can and goes back to the tutorial |
| **E. Wants questions pitched to them, in a progression** | Easier questions first, guided along, "a progression journey"; Duolingo is satisfying because sessions are structured; wants a study plan | | Quizzing works when she supplies sample questions to set the difficulty; quality drops as the session gets long, answers become obvious |
| **F. Wants the notes to be a shared, editable artefact** | | Cannot put what the AI tells him back into the slides; handwrites on an iPad copy, which the AI never sees; wants his notes and understanding tracked in the AI's context | Wants to edit the notes and collaborate in detail, with control over what is added and where |
| **G. Tries first** | Reads the notes and tries the tutorial, *then* sends the question to the AI | | |

Frequencies: A 3/3, B 3/3, C 3/3, D 2/3 (P1, P3), E 2/3 (P1, P3), F 2/3 (P2, P3), G 1/3.

Not raised by anyone: catching the AI being wrong; academic integrity; cost; privacy.

## 2. The four parts Assignment 1 asks for

**Learner and task.** Final-year NUS undergraduates in engineering and computing, revising lecture
material for tutorials and tests. They put the slides into a general-purpose chat: as screenshots
(P2), as a whole file to be turned into notes (P3), or alongside a tutorial question to be answered
and explained (P1).

**Current difficulty.** With AI they can get an answer, a summary, a set of notes, a quiz. What they
still cannot do is **keep up with the help**: the explanation assumes knowledge they lack (A), is
longer than they will read (C), and each clarification moves the conversation further from the
slide it started on (B). The result is not a better attempt but a worse one: P1 stopped studying
with AI and now mostly has it answer; P3 abandons the notes on hard modules.

**User needs.**
1. Help pitched to what I already know, starting easier and building up (A, E).
2. Help that stays anchored to the slide I am on (B).
3. Help short enough to finish (C).
4. Questions at my level, in a structured progression I can see myself moving through (E).
5. Notes I can edit with the AI, controlling what is added and where, and that the AI remembers (F).

**Potential CUI support.** A conversation that lives in the notes, anchored to a block and its slide
(2, 5); that sizes and pitches its turns to the learner and asks easier questions first (1, 3, 4);
that shows progress as a path (4); and that treats what the learner writes as part of its context
and never overwrites it (5).

## 3. Which of the brief's difficulties this is

| Category | Interview support |
|---|---|
| **Reduced persistence** | P1 and P3 (D): effort collapses when the help cannot be followed. But P1 **does** try first (G), so it is *sustaining* an attempt that fails, not starting one. |
| Uncritical use | None. Nobody mentioned checking the AI, or being misled by it. P1's worry about "the correct context" is the nearest, and it is about drift, not verification. |
| Reduced ownership | Mixed, and mostly the reverse: P2 built his own tool, P3 wants more control. P1 wants to be guided, which is a wish for structure more than a loss of direction. |
| **Other: "help that outruns the learner"** | 3/3 on A, B and C. This is what the participants themselves described. |

**Recommendation (Lucas decides; the brief requires it).** Keep **reduced persistence** as the named
difficulty, and define how it appears in this task using what the interviews add: *the learner
cannot sustain their own attempt, because the AI's help is not pitched to them: answers too long and
too advanced, questions too hard; so they hand the task over (P1; "answer?" in the transcripts) or
give up (P3; the single-turn notes session).* It is one of the brief's listed categories, it is
supported by both data sources, and it is the one the app's central interaction answers. The
alternative is to name it as *Other: help that outruns the learner*, which fits the interviews more
literally and the transcripts less.

## 4. Interviews against transcripts

The six questions `convergence.md` §6 said the transcripts could not answer:

| # | Question | What the interviews say | Verdict |
|---|---|---|---|
| 1 | Did they try before asking, off-screen? | P1 reads the notes and tries the tutorial first. | **Discrepancy resolved against the transcripts' surface**: "no attempt visible" was not "no attempt", as §4.1 there warned. The claim stays as worded: the conversation never *held* the attempt. |
| 2 | Why ask for the answer? | Because the help cannot be followed, and it takes too long (P1); not habit. | **Converges** with the L20 confound: persistence tracks difficulty and pitch. Supports a give-up that lowers the question. |
| 3 | Do they want to be tested? | P3 already has the AI quiz her; P1 wants easier questions first. | **Converges** (2 of 6 sessions asked for testing). |
| 4 | Did they notice the AI being wrong? | Nobody raised it. | **Discrepancy**: the transcripts show errors (R2's variables; 11 of 21 wrong verdicts) that learners did not catch, and the interviews show learners who do not think about it. Unnoticed, not unimportant. Checkable feedback stays a need, but it is one the *data* shows and the *learners* do not ask for; the report should say so. |
| 5 | Did they read the long answers? | P3: no, and she knows it in advance. | **Converges** with the reading-time inference. |
| 6 | Would a refused answer be tolerated? | Not asked. P1's history (gave up when he could not keep up) suggests a refusal would lose him. | Weakly supports releasing the answer on a give-up over withholding it. |

Two further convergences. The transcripts' *explanation debt* (7 of 8 follow-ups repairing the AI's
previous answer) is P1's "many rounds of clarification", seen from the other side. And three of six
sessions opened by asking for notes, which is P3's whole workflow.

**What the interviews add that no transcript could show:** the wish for the notes to be a shared,
editable artefact with placement control and memory (F), and the wish for a visible progression
(E). These two are the origin of the collaborative notes doc and of the progress bar.

## 5. The AI-generated sheet, weighed

It was produced by Gemini and sheet formulas over the same notes. Kept, dropped, and new:

| Idea in the sheet | Verdict |
|---|---|
| Three per-person "Other" difficulties, synthesised as "struggle to process, structure and synthesise AI output with prior knowledge" | **Agrees** with §2–3 here. Its per-person names are wordier versions of A/B (P1), B/F (P2), F/C (P3). |
| Side-by-side workspace to edit AI notes; placement controls | **Agrees** (F); already the design. |
| Persistent memory of progress, notes and gaps | **Agrees** (F, P2). Sharpens one requirement: the learner's own text in the doc must be in the agents' context. See §6. |
| **Layered disclosure**: toggle a block between a short version and a deep dive; collapse sections | **New, and worth having.** It answers C without losing depth. Candidate for A2; a per-block "simpler / more" action is the small version. |
| Reset or refine context in long quiz sessions | **Worth keeping** as a constraint (P3: quality drops over a long session). Max's questions are already separate calls with bounded context; add a no-repeat list. |
| "With AI the learner can follow structured study plans" (P1) | **Dropped: confused.** P1 *wants* one; he does not have one. |
| "Struggles to verify the AI's logic" / "apply concepts to novel problems" | **Dropped: not in the notes.** Nobody said either. |
| Use of GPA bands to characterise participants | **Dropped**: not needed for the rubric (programme, year, gender) and not carried into the repo. |

## 6. What this changes in the build

| Finding | Already in `collab-doc.md` | Change or emphasis |
|---|---|---|
| A, C: can't follow, too long (3/3) | Chat turns sized (§4.6) | **The notes themselves must be tight.** "Reads without the slides" must not become "long": short paragraphs, the key idea first, no padding. The ingest prompt says so. |
| B: drift from the slide (3/3) | Every block has provenance; threads are anchored to a span | Strongest validation of the pivot. Ellie's answers should **say which block or slide they are about** and land there. |
| E: easier first, a progression (P1, P3) | Pitch follows the learner (§4.5); progress bar and lessons (§6) | Lessons shown **as a path in prerequisite order with a "next up"**, not an unordered list. Max avoids obvious questions and repeats. |
| F: my notes must count and be remembered (P2) | Learner text is never overwritten; doc text counts as an attempt (§6) | **The learner's own doc text near the anchor is given to the agents in full**, flagged as theirs, so answers build on it. |
| F: control over where additions go (P3) | Ctrl+E anchors; Remove · Keep | Answers to a span thread are inserted **at that span's block**, never elsewhere. |
| 4.4: errors go unnoticed | Grounds in feedback; provenance | Unchanged, and now argued from observation alone. |
