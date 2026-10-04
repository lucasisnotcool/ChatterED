# Tutorials in a notebook: the sheet beside the notes, answered with help from the lecture

Decided 2026-10-03 with Lucas (AskUserQuestion, two rounds), after a review of tutoring research
and of how notebooks work today. Builds on `notebooks.md` (one notebook, ticked sources, a short
overview the learner builds into notes) and `collab-doc.md` (provenance, the author mark, Max's
questions, releases, progress on the learner's own words). Contract for the build:
`app/docs/TUTORIAL-CONTRACT.md`.

## 0. The idea in one box

A learner who has worked through a lecture's notes adds the **tutorial sheet** for it. The sheet
does not go into the overview. It opens as **its own document beside the notes**: the sheet
copied faithfully (words, figures, formulas), with an **answer slot under every part**. The
learner completes the whole tutorial there. Help comes into the notebook's one chat and is always
drawn from the **lecture notes and slides**, never from the sheet alone: a pointer to the block or
slide where the answer's material is, the part broken into steps, a refresher on the
prerequisite. A correct answer fills the notebook's own objectives.

## 1. Sources have a role

| Role | What it is | Overview | Agents' context | Shown |
|---|---|---|---|---|
| `lecture` | a deck, notes, a reading (the default; every existing source) | written from it | yes | the notes |
| `tutorial` | a problem sheet | **no** | yes | its own document, beside the notes |
| `solutions` | the official answers to one tutorial | no | **never** | a row in the sources panel only |

The role is guessed when a source is read (`guessSourceRole`: the file name, and "Problem 1"-style
headings) and changed from the source's row. The guess errs to `lecture`. Adding or retyping a
tutorial does not raise the overview's "not covered" banner; it is not the overview's to cover.

## 2. Layout

The tutorial opens as a **resizable split column** inside the doc column, beside the notes (the
chat stays where it is). Its header has the title, *Parts 4 / 9*, **Pop out** and close. **Pop
out** floats it in a window over the app that is moved, resized and kept until closed, as the
slide windows are (`slidewindow.ts`); **Dock** puts it back. More than one tutorial: tabs in the
header. The sub-notebook has no chat and no objectives of its own (Lucas: *"the main check and
learning goals stay"*).

**Zoom** (2026-10-04, Lucas): the sheet zooms on its own, apart from the notes (− 100 % + in its
header, a pinch over it). ⌘ or Ctrl with + − 0 zoom whichever of the two the learner last pressed
or typed in. An image dropped on the sheet goes into it, as on the notes (`notebooks.md` §1).

**Copying a part, and getting out of one** (2026-10-04, from Lucas dogfooding Tutorial 1). A part
copied to a later problem, to read while answering it, pastes as a **reference**: *From Problem 3
A) i.:* and its words, blanks and choices as text. It is not a second live part with the same id.
A part that was cut, to move it, stays live. Copies made before this are turned into references
when the sheet opens. To get out of a part or any other component, there are three ways:
- **⌥↩** adds a line below the top-level block you are in, and **⇧⌥↩** a line above.
- A **＋ line** control sits in each gap beside a component.
- The arrow keys reach the gap between two components, where the gap cursor is now drawn.

Something pasted on such a line lands beside the component, not inside it.

## 3. The sheet as blocks (answer **"Sheet + answer slots"**)

- The sheet's words are `ingest`-authored blocks with `reason: 'sheet'`, cited to the tutorial's
  pages (`Tutorial 1 p. 2`), maths typeset, figures cropped from the page as inline images.
  Housekeeping (team sign-up, deadlines) is `sheet_admin`: dimmed and folded.
- Each answerable part is a **`tut_part`** container: the sheet's prompt for it, then its slot.
  The slot takes the answer's shape:

| Answer | Slot | Example |
|---|---|---|
| `code` | a code block | a PDDL domain and problem |
| `tree` | a nested list | a forward-search tree |
| `sequence` | a numbered list | a plan |
| `text` | paragraphs | "explain why…" |
| `blanks` | a field (`tut_blank`) in the sheet's own line | `Effect: ____` |
| `choice` | a tick box on each of the sheet's options (`tut_choices`) | "choose all that apply" |

- The sheet is read by one model call over the page text and page images, returning the blocks
  and parts as JSON, validated in code (the overview's pattern). A re-read keeps the learner's
  answers by part id (`carryAnswers`).

## 4. Help (answer **"Max owns"**, kept as a decision point)

Max helps with a part; Ellie gives a refresher. `TUTOR_HELPER` in `shared/tutorial.ts` switches the
hints to Ellie in one line if the sheet's pressure plus Max's proves too hostile (Lucas: *"keep
this a possible decision point"*). Each part's buttons:

- **Hint** climbs a ladder, one rung per press (Koedinger & Aleven's assistance dilemma; the
  Andes/Cognitive Tutor point → teach → bottom-out sequence):
  1. **Point:** where the material is: a notes block (opens and flashes it) and slide pages
     (open in slide windows), and what to look at there.
  2. **Break it down:** the part as two to four sub-steps (subgoal labels).
  3. **A worked step:** one step done on an analogous case from the lecture, not this part.
- **Refresher:** the prerequisite, from the lecture notes and slides, by Ellie.
- **Check:** judged against the hidden key (§5); Max says what is right and what is missing,
  without giving the rest.
- **Show answer:** a give-up. The key's answer, then Max asks for one line on why it works.
  Fills nothing, as a release never has.

Hints are not timer-gated. Each help gives the full explanation **in the chat** (the part's own
span thread) and **one short line in the tutorial under the part**, marked as Max's or Ellie's
with Remove · Keep, so the sheet records what help was used (answer **"Chat + one line in
slot"**). Explain and Ask work on any line of the sheet, as on the notes.

**Typed replies, and the guard** (2026-10-04, Lucas: "explain, never solve"). Anything the learner
**types** in a thread on a part goes to Max, not to Ellie: their answer to his question, a reply to
a check, or a new question about the part. Max gets the same turn as a Help: the part, the answer
slot as it is now, and the key behind its guard. A reply writes nothing into the sheet. While any
part is unsolved (not checked correct, not shown), every other turn carries a guard naming those
parts. Ellie, in the notebook chat or on a line of the sheet, explains the lecture ideas a part uses
on the lecture's own examples. She never gives a part's answer or any step of it, and she writes no
line inside an unsolved part. Before this, a typed reply fell to Ellie's general answer. She could
not see the answer slot, answered in full, and filed the answer into the lecture notes.

## 5. Checking (answer **"Model key + code checks"**)

The student version of a sheet has no solutions. At ingest the model writes a hidden **key** per
part: an answer, the sub-steps, likely mistakes, prerequisites. It never reaches the renderer.

- **Where the problem is formal, code decides** (`core/planning.ts`): a plan is simulated from the
  start state and must reach the goal; which action sequences reach a goal is computed; an HLA's
  precondition and effect are derived from its implementations (angelic `∼+ ∼− ∼±`). The model's
  key is run through the same check, and the computation wins where they disagree.
- Elsewhere a second, independent pass re-solves the part; where it disagrees, the key is marked
  low-confidence and Max judges cautiously and says the official answer may differ.
- **Official solutions**, added as a `solutions` source, replace the key for their tutorial.

## 6. Progress (answer **"Yes, full credit"**)

Each part is linked to the notebook's objectives. A correct answer fills them fully, whatever help
was used; a partial one half, as Max's verdicts do; a revealed one nothing. Each part's record
keeps the highest hint rung and the attempts (DataShop-style), for the research log, not the
fill. The tutorial shows *Parts 4 / 9* of its own.

## 7. Links both ways (answer **"Two-way links"**)

The ingest is given the notes' outline and proposes, per part, the notes blocks and lecture
pages it draws on; code keeps only ids that exist and pages of lecture sources. A part shows
*From the notes: PDDL · p. 3–7*; a notes section shows *Practise: Tutorial 1 · P1 a–c*, which
opens the part. The overview is not rewritten.

## 8. Next: practice generated around the sheet (researched, not decided)

Lucas, 3 Oct 2026: the tutorial could hold the original questions and **more**: questions on
concepts the lecture teaches and the sheet skips, warm-ups, same-level and stretch questions, in
many formats (single and multiple choice, true/false, ranking, matching, numeric, blanks, open),
so the learner practises at differing levels of cognitive forcing by topic. The parts carry an
`origin` (`sheet` | `generated`) so this can be added without a migration. Research summary:

- **Forcing levels** (ICAP; Buçinca et al. 2021 on cognitive forcing): F0 recognise (single
  choice, T/F, matching) · F1 select or order (select-all, ordering, Parsons) · F2 produce a term
  or step (blanks, numeric, faded completion) · F3 construct (find-the-error, T/F or two-tier with
  a reason, open, stretch). Higher forcing helps more but is liked less; raise it on readiness.
  Lower forcing is right for novices (expertise reversal; fading worked examples).
- **Formats with evidence:** two-tier choice with a reason (misconceptions); Parsons problems
  (same learning as writing, less time; LLM-made Parsons as help beat showing the solution,
  CodeTailor 2024); erroneous examples (delayed gains, McLaren 2016); short answer beats choice
  only with feedback; plausible distractors make choice a retrieval task.
- **Generated items must be mechanically checkable** (an id set, a permutation, pairs, a value
  with tolerance, accepted blanks, a simulation) or go to Max's judgement; difficulty is fixed by
  code from the item's relation to the part, not by the model's label (models drift up a level).
- **Coverage gaps** from a parts × objective-criteria matrix: an objective the deck teaches that
  no part exercises gets "probably not covered by the sheet" items, citing lecture pages.
- **Risks:** drift from the lecture (reject items not citing lecture pages) and leakage (a warm-up
  must not give away a step of the official part beyond the hint rung reached).

**Decided 2026-10-03 (Lucas):**

- **Fill:** a correct generated item fills its objectives first, whatever its format. Every item
  then has a button that always starts a Max chain checking the learner can say it in their own
  words (the follow-up chain of `collab-doc.md` §4.2).
- **When:** everything on demand. The ingest only **advertises the gaps**: the objectives the
  lecture teaches that no part of the sheet exercises, shown on the tutorial so the learner decides
  whether to practise them. Nothing is generated until asked.
- **Where:** collapsed under each part (*Practice around P3A*: warm-up, another like it, stretch),
  visually distinct from the sheet (a *Generated* chip, dashed edge), never counted in *Parts 4 / 9*;
  gap practice in a final *Not covered by the sheet* section.
- **Format:** a code rule picks the format and forcing level from the topic and the learner's
  state; the learner can swap it (*Try another format*).

## 9. Lucas's answers, 3 Oct 2026

| | Question | Answer |
|---|---|---|
| A | How does the sheet become blocks? | The sheet copied faithfully, with answer slots per part. |
| B | How are answers checked without solutions? | A hidden model key, with code checks where formal; official solutions override it. |
| C | Does tutorial work fill the notebook's progress? | Yes, full credit regardless of hints; revealed fills nothing. |
| D | Who helps? | Max, kept as a decision point (Ellie if too hostile). |
| E | How do the tutorial and the notes link? | Both ways; the overview is not rewritten. |
| F | Where does help appear? | In the chat, plus one line under the part. |
| G | How much in the first pass? | All of it. |
| — | "The checkbox toggle will need to now track provenance" | Withdrawn (a leftover from another idea). |
