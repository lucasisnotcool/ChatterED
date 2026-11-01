# Group project: scope, design goals and study plan

**Status.** Locked 4–5 Oct 2026. The design goals were frozen by Lucas and Valerie together. The
scope, features and study were decided by Lucas, and **Valerie should confirm the study design**.
This file is the group project's source of truth. Where `midterm-deck-brief.md` disagrees, this
file wins (see "What this supersedes").

**Read with:**
- `joint-analysis.md`: the evidence.
- `docs/research/tutorials.md`: the design of the tutorial sheet.
- `midterm-shots/`: hi-fi screenshots.
- The canvas https://claude.ai/artifact/6wpHQkd2oaSxU2XeE8ra3J, where the poster pages 1–7 explain
  all of this for a reader with no context.

---

## 1. What the group project is

- **One app, ChatterED**, merged from the two Assignment 1 designs (decided 1 Oct, after
  consulting the prof).
- **What the group adds:**
  1. **the joint analysis**: both A1 datasets analysed as one (`joint-analysis.md`);
  2. **the features that answer it**: the three below;
  3. **a real user study** of those features.
- **Assignment 2 is individual and a study design only** (released Week 9), and it may reuse the app
  and this analysis. The group project is where a study is actually run. Each person's A2 framing
  stays in their own private place, never here.
- **The course still asks for:**
  - **Final presentation, Week 12 (2–6 Nov):** a live demo of the core task with a recorded
    backup, a study with **at least 3** target users, and what changed since mid-project.
  - **Report and system, 23 Nov:** a study with **at least 6** participants, measures, analysis and
    evidence. The core task must work end to end. Innovation is worth 3%.

## 2. Design goals: frozen, non-negotiable for the presentation

| | Design goal |
|---|---|
| **DG1** | Learner tries first |
| **DG2** | Gives up → system recovers |
| **DG3** | Every line traces to the slide |
| **DG4** | Short: room to think, based on task size |
| **DG5** | Only your own words count |

## 3. Needs, traced to the goals

From `joint-analysis.md` §4. Six needs stay, and one is cut.

| Need | Goal | Status |
|---|---|---|
| JN2 My attempt, in front of whoever is helping | DG1 | kept: the core of the project |
| JN6 A structure I can follow, without building the tutor first | DG2 | kept |
| JN5 Help that stays inside my course | DG3 | kept |
| JN3 Feedback that's right, or that I can check | DG3 | kept **only** as "every line and verdict cites its slide, so you can check it". No feature is built for answer correctness (§6) |
| JN1 Help sized to what I'm doing | DG4 | kept |
| JN7 What I make is mine | DG5 | kept |
| JN4 Practice that stays sharp, in scope, moves with me | — | **cut**: no design goal covers it. "Practice around the sheet" (`tutorials.md` §8) is not in scope |

## 4. Scope: one core task, three features

**Core task: working a tutorial sheet in ChatterED, with the lecture beside it.** It was chosen over:
- "revise a lecture in the notebook", which would re-test the A1 design;
- "practise around the sheet", which isn't built and is risky in two weeks.

| | Feature | Goals | Need | State |
|---|---|---|---|---|
| ① | **An answer slot under every part.** Help on a part is sent the part and what is in its slot, so the attempt comes with the request | DG1 | JN2 | built |
| ② | **Help one rung at a time, chosen by code**: Point → Break it down → A worked step, a Refresher, and Show answer (gives the part up). Each help adds one line under the part, and the full help goes in the part's chat thread | DG2, DG4 | JN6, JN1 | built |
| ③ | **The sheet tied to the lecture.** Each part links to the notes blocks and slide pages it draws on, and help is drawn from them | DG3 | JN5, JN3 | built |
| — | **DG5 as a rule on every feature:** only the learner's own correct answer fills progress; a hint never writes the answer; Show answer fills nothing | DG5 | JN7 | built, with one open bug (§9) |

**Tutorial as the main view** (merged 5 Oct): a per-notebook switch, *Main view: Lecture notes ·
Tutorial*, which is off by default. With it on:
- the sheet fills the middle column;
- the notes open in a window one click away;
- the chat answers about the sheet, while the agents still get the slide text and the linked notes
  blocks.

Design: `tutorials.md` §2.

**In the app and the demo, but not claimed by the group project**, because it is A1's design:
- the notebook and short overview;
- Explain and Example;
- Quiz me and the question block;
- the two agents, their roles and prompts. Downplay these; don't argue them again.

Every other app feature (search, folders, Listen, tables, diagrams and so on) is out of scope for
the study.

## 5. The study

**Superseded 1 Nov 2026 by `field-study.md`**: a week of real use, then interviews matched to the logs. The plan in §7 changes with it. Kept below as the record.

- **Who:** students who have taken the algorithms course the sheet comes from (for example CS3230),
  not team members. **3 by Week 11, 6 by the report.**
- **Task:** two comparable proof problems from one sheet, 20 minutes each.
- **Conditions, within subjects:** one problem in **the student's usual AI chat** with the lecture
  PDF, one in **ChatterED**. The order swaps between participants.
- **After:** one transfer question per problem. Then a 10-minute interview, after which we show the
  student their own log.
- **Content:** proof-heavy algorithms (decided 4 Oct). Check on a proof is the model's judgement:
  it is logged, but no accuracy claim is made. We mark solutions ourselves.

| | Measure, from the logs unless stated | Baseline from our data | For |
|---|---|---|---|
| M1 | Share of help requests made after a written attempt on that problem | 0 of 31 student messages held an attempt (5 real chats) | ① DG1 |
| M2 | Steering messages: those that redirect the AI's level, length or format rather than work the problem | **still to count** in the six real chats | ② DG2, DG4 |
| M3 | How much help before solving: the highest rung, and the Show answer rate | one chat: answer requests fell from 5 to 2 after the student's own rule | ② DG2 |
| M4 | Time to first attempt | ~6 min (one chat) | ① DG1 |
| M5 | Problems solved, and the transfer question, marked against the official solution | — | DG5 |
| M6 | Said vs did: the interview account set against the student's own log | 4 of 6 accounts didn't match the log | finding 5 |
| M7 | Lecture use: links followed from a part to the notes or slides, and help that cites the lecture | — | ③ DG3 |

With 3–6 people, report each person's numbers side by side, not significance tests. **Lucas's own
use of the app is not evidence** and is never reported as user research.

## 6. Correctness is not an HCI claim

Lucas, 4 Oct: *"Correctness is usually an intelligence issue, not an HCI issue."* The joint finding
stays a finding: 12 of 21 AI verdicts on one student's SQL were wrong, and nobody mentions it.
Dropped as features:
- verdict grounds with stated doubt;
- the "I think I'm right" re-check;
- verdict-accuracy audits as a study measure.

What stays: the slide citation on every line and verdict (DG3), and the code checks that already
exist where an answer is formal (a plan is simulated). These are not claimed as accuracy.

## 7. Plan

| Week | |
|---|---|
| 8 | Fix the progress bug (§9); choose the study sheet; Valerie runs the same build; Valerie checks the joint coding of her five participants |
| 9 | Read in the study sheets; pilot with one student; write the coding rule for steering messages (M2) and count the baseline |
| 10 | Sessions 1–3; Consultation 2 |
| 11 | Sessions 4–6; analysis |
| 12 | Final presentation: live demo and first results |
| 13 | Report with all six; code |

## 8. Build state (5 Oct)

- **On main:**
  - Tutorial sheets, `f856c6a`.
  - The tutorial-as-main-view switch, merge `a8b9c9d` (branch `lucas/tutorial-main`).
  - The screenshots, `6a8630c`.
- **Screenshots:** `midterm-shots/` holds 40 shots on CS3230 Lecture 2 and Tutorial 02, with real
  Claude CLI replies. 24 show the tutorial beside the notes and 16 show the tutorial as the main
  view. Each shot is mapped to the DGs in its `README.md`, and Valerie picks which to use.
- **Ingest:** a lecture plus a tutorial takes about 2–2.5 minutes over the Claude CLI.

## 9. Open issues

- **Breaks DG5:** Check after Show answer still fills progress. `check.ts` calls `statusAfterCheck`
  without the previous status. Fix before the study.
- **Breaks DG5 measurement:** pasted agent text keeps the learner's author mark, which overstates
  "own words" (by about 80% in Lucas's own use).
- **Tutorial ingest:**
  - A tutorial read in before the lecture overview finishes gets no notes links.
  - A forced re-read then duplicates every part under "Earlier answers".
  - Workaround: add the tutorial after the overview is ready.
- **Rendering:**
  - The √ sign is missing in chat replies; the sheet renders it.
  - Several pending "Max wrote this · Remove · Keep" tags on one part overlap.
  - Some slide text is garbled on extraction (doubled letters in a quote).
- **Main-view switch:**
  - The first click on "From the notes" can open the wrong section.
  - The notes map highlights the wrong section while the notes are hidden.
  - The notes flash briefly when the notebook opens.
  - Ellie still writes her one line into the hidden notes. That is the existing behaviour, kept on
    purpose; review it.
  - The agents' new context is unit-tested, but it has had only one live run (the screenshot
    session).
- **Data:**
  - 7 `quiz_outcomes` rows have a NULL `objective_id`.
  - `resetRound` is never called.
  - The research export doesn't scrub `search_chunks`.

## 10. What this supersedes

- **`midterm-deck-brief.md` (1 and 4 Oct):**
  - Its five design goals (DG1–DG5 there, including "every verdict shows its grounds") are replaced
    by §2.
  - Its seven needs are replaced by §3 (JN4 cut).
  - Its slide 10–12 dialogue and flow, built around Quiz me and Max, become base material; the
    group features are §4.
  - The "planned" JN3 items (verdict grounds, the re-check, a wrong verdict never counts) are
    dropped (§6).
  - Its 1 Oct line "no extra planned features beyond the merged app" no longer holds: the tutorial
    sheet and the main-view switch are the group features.
  - Its evidence, literature, architecture and Q&A sections still stand.
- **The 1 Oct content decision (#61)** for the study is now proof-heavy algorithms tutorial sheets,
  worked in the tutorial sheet.
- **AGENTS.md "Working decisions"** still describes the notes-centred design. It is a policy file,
  so changing it needs a PR that Valerie approves.
