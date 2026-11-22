# Final group report: outline and framing

**Status.** Working sketch for Lucas and Valerie, first written 21 Nov 2026 and **brought up to
date on 22 Nov** with the first study exports. The report is due Mon 23 Nov, 23:59 (4,000–7,000
words of main text). Valerie has not reviewed it.

**What changed on 22 Nov, and where.**

- **The first exports are in, and they are thin.** Both come from study copy 04: one first-use
  sitting of 16 minutes on a tutorial sheet, and one earlier session in which the exam paper would
  not import and nothing was attempted. The record is `field-results.md`. Neither is "1–2 days of
  revision", so §6.1, §6.3, §8.3 and §9 now carry both the plan and what was observed.
- **The app is frozen** (Lucas, 22 Nov). Faults found in the data go into the report as limitations
  and are not fixed. §9 marks the one submission task this touches (`INNOVATION` comments).
- **Informal feedback from participants**, relayed by Valerie, is kept in a local-only notes file
  with a table mapping each item to the sections here. None of it is in this file: Lucas and
  Valerie choose what goes into the report.
- Places still waiting for data are marked `[DATA]`. Places the first export already fills are
  marked **S04**.

**Decisions this sketch assumes (Lucas, 21 Nov).**

- The field phase was planned as **1–2 days of unsupervised use** per participant, then a
  log-anchored interview. *As observed so far it is a single short sitting (see above).*
- **Tutorial sheets and past-year exam papers both count** as study material. This reverses the
  18 Nov line in issue #72 that left exam-paper use out of the analysis.
- The report counts **6 target users: 2 in an informal pilot and 4 in the field phase.** The pilot was
  very informal and is described as such; its data is never pooled with the field data. *Open: the
  two copy-04 exports may be two different people (`field-results.md` §5).*

---

## 0. At a glance

- **The spine of the report, in one sentence.** Students do attempt their tutorial problems, but the
  attempt never reaches the AI, so the AI answers the question instead of the student; ChatterED
  makes the attempt the input to every request for help, and the study looks at what students then
  do when they use it on their own.
- **The marks at risk are in the user study (4%).** The teaching team accepted the problem, the
  system and the demo. What they asked for is clearer research questions, a named outcome, and
  measures that line up with it.
- **One gap explains most of the criticism:** no research question named an outcome with a direction
  (what counts as good). §6 proposes RQs with explicit dependent variables.
- **The shorter study and the sharper RQs are the same change.** The vague part of the RQs was the
  "over the week" clause. Dropping it removes the claim a short window cannot support (§6.3).
- **The first data says: write a first-use field trial, not days of revision.** One 16-minute
  sitting gives cases and a timeline, not rates. The weight moves to the interviews and to the
  check of the AI's replies, which came out clean in 7 of 7 and exposed three faults (§6.6).
- **The pilot criticism and the informal pilot solve each other:** report the evaluation as two
  phases, where phase 2 checks whether the phase 1 problems come back.
- **The deck and the repo have drifted apart** (RQ2 wording, participant count, need numbering, the
  product name). §2.2 lists what to make consistent before writing.

## 1. Inputs, organised

| What | Where |
|---|---|
| Final deck as delivered (23 pages) | `docs/group/final-presentation/ChatterED_Final_v2.pdf` |
| Teaching team's feedback on it | `docs/group/final-presentation/feedback.md` |
| Earlier deck (v1) and Lucas's study slides | `docs/group/final-presentation/ChatterED_Final.pptx`, `UserStudy_Lucas.pptx` |
| Rubric and compiled requirements | `Academia/group project/` |
| Evidence record (both A1 datasets) | `docs/group/joint-analysis.md` |
| Locked scope, DG1–DG5, features | `docs/group/group-project.md` |
| Study design (a week, as presented) | `docs/group/field-study.md` |
| Earlier lab-comparison design | `docs/group/user-study.md` |
| Tutorial workspace design and its revisions | `docs/research/tutorials.md` (§10–§14) |
| Mid-term brief: literature, existing systems, architecture | `docs/group/midterm-deck-brief.md` |
| The two assignment briefs (report, system) | `Academia/group project/` (local only) |
| Study results as exports come in | `docs/group/field-results.md`; measured with `tools/field-metrics.py` |
| Informal participant feedback, with a triage table | `docs/group/field-feedback.local.md` (local only, never committed) |

## 2. The delivered deck against the earlier proposals

### 2.1 What changed

| Topic | Earlier proposals | Delivered deck (v2) | For the report |
|---|---|---|---|
| Study design | Lab, within subjects against the usual AI chat, transfer question, M1–M7 (`group-project.md` §5) | One group, a week of own tutorials, log then interview; no comparison, no test | Field design, now 1–2 days (§6) |
| RQs | v1: come back, work through a question, said vs did | RQ1 engagement, RQ2 "how the AI's moves shape what students do next", RQ3 accounts | Revise again (§6.2). `field-study.md` already replaced RQ2 on 7 Nov |
| Coding | Deductive DG codes plus open codes | ICAP for the student, tell / elicit / assess for the AI; no inductive coding shown | Both, stated (§6.4) |
| Participants | 6 | "4 NUS undergraduates" beside "six is enough" | 2 pilot + 4 field |
| Interview | 30 min | 10 min | Decide; 20 min proposed |
| Usability rating (UMUX-LITE) | In v1 | Dropped | Stays dropped |
| Baselines, expected findings, "what each result would change" | In v1 and `field-study.md` | Absent | Bring back: it is the pre-data content we can write now |
| Ethics | One slide in v1 | One line | Full section (§8.4) |
| Pilot | Two problems (`field-study.md`) | Three problems (adds "too much to scan") | Valerie to record the third; see §2.2 |
| Design iterations | Five-row table | Max fix, three sheet versions, UX table | Keep the delivered three |

### 2.2 Make these consistent before writing

| Item | The conflict | Use |
|---|---|---|
| Product name | ChatterED on the title, TutorED in the footers; issue #63 is open | Pick one. ChatterED is the app, the repo and the deck title |
| Needs | N1–N6 on the deck; JN1–JN7 in `joint-analysis.md` §4 | JN ids, with JN4 marked cut |
| "0 of 31" | Shown next to "6 chats" | It covers five chats, L-T1…L-T5. The sixth (L-T6) is the 24 of 45 case |
| "7 of 10" | Stated as general | Comprehension sessions L-T2 and L-T5 only |
| "4 of 6" | Read as interviews | Six chat sharers' form answers against their own logs |
| Wrong verdicts | 12 of 21, with 11 and 10 in older files | 12 of 21 (`joint-analysis.md` §6) |
| Pilot task | "Midterm practice paper" on the deck; "their own tutorial questions" in `field-study.md` | Valerie to confirm; it was her pilot |
| Design goals | Deck says "unchanged since mid-project" but rewords DG2 and DG3 | `group-project.md` §2 wording |
| Deck references | Five listed but not cited; Chi & Wylie and Graesser cited but not listed | Rebuild the list from §10 |
| Three-tries cap | On a v1 slide | Exists only in the notebook quiz, not in tutorial Check. Do not claim it |

## 3. The feedback, analysed

**What they accepted (keep, and keep the same wording).** The 0 of 31 finding as the purpose;
guiding students back to the lecture; the three versions of the sheet; making Max follow the answer
key; the demo's wrong answer, hint and fix; recruiting students during exam preparation; stating
limits plainly; qualitative analysis; honesty about dropping the before-and-after test.

**What they asked for.**

| # | Feedback | What it means | Where the report answers it |
|---|---|---|---|
| F1 | RQs not clear; "what students do next" is vague and has no good or bad | Each RQ needs a dependent variable and a direction | §6.2; report §5 |
| F2 | Say what learning outcome you look for; align the measures | Name the outcome, admit it is a process outcome, map every measure to it | §6.2; report §5 |
| F3 | Explain how analysing the AI's responses helps | The AI-side coding needs a job | §6.4: a fidelity check, not an RQ |
| F4 | Add inductive coding beside ICAP | Show both passes | §6.4 |
| F5 | Recruit STEM participants; the description leaves STEM out | Describe participants by programme and year | Participant table; `[DATA]` |
| F6 | More detail on where the design approaches came from | A visible chain: evidence → need → goal → feature → source | §8.2 provenance table |
| F7 | Pilot fixes were not retested; check whether the three problems still appear | Close the loop in the field data | §6.5 |
| F8 | No hint in the demo; show a student getting a step, not the answer | One worked hint exchange | §8.2, figure |
| F9 | Reduce complexity (said at mid-term too) | The reader must see one task and a few controls | §8.2; video |
| F10 | Explain each function for longer in the video | One function at a time | Video script, outside the report |
| F11 | Larger fonts, less dense slides | Applies to report figures | Crop screenshots to one part |

## 4. Key insights

1. **Name the outcome as productive engagement, not learning.** We dropped the test, and they
   praised the honesty. The outcome is whether students produce and revise their own answer (ICAP
   Constructive and Interactive; Chi & Wylie, 2014), which theory ties to learning and which was
   absent in the baseline chats. Say once, plainly, that it is a process measure.
2. **Study the choices the interface leaves free.** Check needs text in the slot, so an attempt at
   Check is built in. Hint, Refresher and the part's chat do not need one, and Show answer is
   always a choice after the first check. Those free choices are the dependent variables.
3. **The AI-side analysis is a check that the help was what the design says.** What a student does
   after a hint can only be read if the hint was a hint. That same check answers F7 (does Max still
   contradict the key) and F8 (did the hint give a step).
4. **Two phases make one evaluation.** An informal pilot found problems, the team fixed them, and
   the field phase checks whether they recur. That is stronger than either phase described alone,
   and it is honest about the pilot.
5. **The origin story is the group's contribution.** Two A1 studies named one cost from two ends;
   pooled, they show why it arises (the attempt is invisible). The help ladder is where the two A1
   designs meet: Nudge's "least explicit move" and ChatterED's code-side rules.
6. **Complexity was raised twice.** The report and video should show one sheet, one part, four
   controls. Everything else is named once as out of scope.
7. **"Why would a student choose this?"** was the recurring question at the mid-term Q&A (our
   recollection; no written mid-term feedback was issued). The field phase is the answer's shape:
   students used it, or did not, for their own exam revision with nobody watching.
8. **Disclose the change from a week.** The feedback praised a week-long study that "states its
   limits clearly". The markers saw that plan, so the report states the change and its reasons.

## 5. What the report must contain

**Sources.** The Canvas post of 23 Sep, and the two assignment briefs, "Final Project: Report" and
"Final Project: CUI System" (read 21 Nov; local copies in `Academia/group project/`). The weights
are the same in both. The briefs add the rules in §5.1 and §5.2.

**Rubric.** Final report, 10%, 4,000–7,000 words:

| Component | Weight | Must show |
|---|---|---|
| Introduction and related work | 2% | The problem, the target users, the gap the system addresses |
| System design and implementation | 2% | User research with at least 6 target users, design rationale, conversation design, architecture, key technical decisions |
| User study and results | 4% | Study design, at least 6 participants, measures, analysis, findings backed by evidence (quotes, logs, task metrics) |
| Ethical and design implications | 2% | Risks to users (privacy, over-reliance, inappropriate responses), how the design addresses them, lessons for future CUI design |

The system is marked separately (10%): the core task works end to end, the system makes clear what
it can do, takes turns, handles errors, ambiguous and off-topic input, the README matches, and the
solution is distinctive. The report's system section should supply the evidence for each.

**From the prof and TAs, earlier.**

- 14 Sep lecture and the Lecture 6 slide: 3 user-research participants by mid-term, 6 by the final;
  none on the team.
- Consultation 1 (16 Sep): keep it interactive, not an answer dispenser; ground the design in what
  users do now and their workarounds; survey existing products.
- Lecture 5: use the course readings as evidence for design decisions.
- 1 Oct consultation: merging the two A1 designs into one CUI is itself a substantial challenge.
- 26 Oct lecture, as noted in class: the presentation need only cover the study design, but data
  should still be collected for the final report.
- Weeks 9–11 covered evaluating CUIs through user studies, and responsible AI: ethics, bias,
  surveillance, anthropomorphism, companionship and human agency. The ethics section should use
  that vocabulary.

### 5.1 What the report brief adds

- **File:** `GroupX_Final_Report.pdf`, one member submits. The title page carries the word count
  and all members' names.
- **Word count is main text only.** The title page, references, appendices, and text inside tables
  and figures do not count. "A longer report does not earn more marks."
- **Appendices** hold the study materials (tasks, questionnaires, interview questions) and longer
  material such as transcripts. Ours must be de-identified excerpts, never raw transcripts.
- **User research** (at least 6 target users; mid-project research counts): say what we did, how we
  analysed it and what we found, **with quotes or examples**. L- interview points are paraphrase and
  are never quoted, so quotes come from N- transcripts and the L-T chat logs.
- **User study** means "testing the system you built", with at least 6 participants. The same
  person may be in both the research and the study.
- **Ethics** must use the Responsible AI lectures, "such as the seven principles and the
  responsible-CUI checklist", and **base the lessons on what the study found** (§8.4).
- **A fifth part, with no weight stated: project contributions.** The division of responsibilities
  and each member's specific contributions.
- **Honest results are safe.** "Report what you found, including results that did not go as you
  hoped. Such results do not cost marks… do not claim more than your data can show."
- **The report must describe the system we submit**: they read one and try the other side by side.

### 5.2 What the system brief adds

- **File:** `GroupX_CUI_System.zip` with source, prompts and configuration. No API keys.
- **README.md** must give the core task, install and run steps, the models, APIs and services
  used, and where the main components are. **If they cannot run it, the system gets no credit.**
- **Innovation is marked from the README and from the code**: the README explains what is new, and
  those places in the code carry a comment that starts with `INNOVATION` and names the challenge.
  There are none in the code today.
- **They run the core task themselves**, with their own inputs. We supply test data.
- **A paid API key means we must provide a hosted version** that runs the submitted code, linked in
  the README. Special hardware or accounts: explain how they can try it, or say it is not possible
  and they arrange a short online session.
- **Video: optional**, up to 10 minutes, **unedited**, in the ZIP or linked from the README.

### 5.3 Where the instructions disagree, or changed

| Topic | One source says | Another says | What we do |
|---|---|---|---|
| Video | Presentation feedback: "the video you submit" | System brief: optional, up to 10 min, not edited | Make one: installing is the hard part for a grader. One take, one function at a time (F10) |
| Running the system | System brief: paid key needs a hosted version | Ours is a macOS desktop app that calls a paid model | **Biggest risk to the system's 10%.** Decide today (§9) |
| Study participants | Report brief: at least 6 in the user study | We have 4 in the field phase and 2 in an informal pilot | Report both phases as the study and say plainly what the pilot was. The brief says unhoped-for results cost nothing and over-claiming does |
| Ethics | Canvas post: risks, design responses, lessons for future CUI design | Report brief: use the seven principles and the checklist; lessons from the study's findings | Follow the brief (§8.4) |
| Word count | Canvas post: 4,000–7,000 words | Report brief: main text only; tables, figures, references and appendices excluded | Put evidence in tables, argument in prose |
| Report sections | Canvas post: four parts | Report brief: four parts plus contributions | Add the section |
| Deadline | Old schedule: report and code by 13 Nov, and "outcome" 23 Nov | Both briefs: Mon 23 Nov, 23:59 | 23 Nov |
| Final presentation participants | Canvas post: at least 3 | Course page (26 Oct): struck out | Past; no effect on the report |
| Team size | Lecture 3: teams of 4–5 | We are two, known to the prof since 25 Sep | State it in the contributions section |

The group number for the file names is not in the repo.

### 5.4 The user-study workshop (Week 10), applied to us

- **RQ shape.** Ours are "one system" and "how and why" questions. The workshop asks for the
  sentence we want to write at the end, and for two or three dependent variables per question, each
  with an instrument (§6.2).
- **One system, no baseline: compare against an anchor**, and "say achieved, rated, reported; not
  improved or better than". Our anchors are the A1 counts and each participant's own account of how
  they study today.
- **Explanatory order**: numbers first, then interview. That is our log-then-interview design.
- **"Freeze the system; note the version."** We did not freeze it: a new build went out on 19 Nov.
  Report it, and split use by build number.
- **Exclude people who saw the demo, classmates, and close friends if you can.** Ours come from our
  own networks. State it as a limit.
- **"The builder does not run the session."** Field use was unsupervised, which meets the spirit.
  Say who ran each interview.
- **"How many? Eight to twelve."** We are below it. Show every data point per person.

### 5.5 Red teaming: not required by name, rewarded in three places

Checked on 22 Nov against both briefs, the rubric, the schedule, the presentation feedback and the
course slides. No group document asks for red teaming. Assignment 2 (individual) did, as one of
three parts; the group project asks for something smaller:

| Where | What it says | What a small test run gives us |
|---|---|---|
| System rubric, conversation design (3%) | "handles errors, ambiguous input, and off-topic requests gracefully" | Evidence for the claim, or an honest account of where it fails |
| Report brief, ethics (2%) | Weigh risks with the seven principles and the checklist | Answers to checklist question 4 (will it disagree when the user is wrong?) and question 5 (what happens on a distress message?) that rest on a test, not on intent |
| Lecture 8 | "What Are We Testing For? How about your group project?", and the in-class exercise "Red-Team Your Project Bot": name one thing the bot must never do; try a direct ask, a role-play and a multi-turn build-up; write the pass or fail rule first | The form to follow. For us the "never" is: give away a part's answer before the student has checked an attempt |

**What already exists is not a red team.** The shared repo has design guards with unit tests (the
answer is absent from the hint prompt; the grading order; learner text is never overwritten) and one
real session in which 0 of 7 replies gave the answer away. Nobody had attacked the build.

**Done, 22 Nov.** A set of 12 attacks on the frozen build, with pass and fail rules written before
the run, on a sheet we wrote ourselves. The record is `red-team/README.md`, with the full
transcript beside it. In short: the verdict held against injection and insistence (9 of 9); the
answer was never stated before a reveal, but repeating the demand got more help (2 of 10 replies
handed over all but the last step); the distress message failed in the question's thread; Ellie's
private chat describes a "group" that does not exist (6 of 6). Results go in an appendix table;
§8.4 and §8.2 cite them. Because the app is frozen, each failure ends in "what we would change",
not a fix and a retest, and the report says so. Results from the individual Assignment 2 are not
used: they are private to that assignment and were run on a different branch.

## 6. The study as it now runs

### 6.1 Content: planned as 1–2 days

**Observed so far (22 Nov).** S04: one launch, 16 minutes, one tutorial sheet from an old module,
3 of 14 parts touched, no lecture or solutions added. Copy 04 on 18 Nov: 17 active minutes, the
exam paper failed to import three times, nothing typed. The "Run" column below is the plan the
participants were given, not what these two exports show.

| | Presented (2 Nov) | Run |
|---|---|---|
| Window | 7 days | 1–2 days of the participant's own revision |
| Material | Their tutorials that week | Their own tutorial sheets and past-year exam papers |
| Setting | Unsupervised | Unsupervised |
| Participants | 4 (6 targeted) | 4 field (S01–S04), plus the 2 pilot students as phase 1 |
| Day 0 | Consent, install, background form, no coaching | Same |
| After use | Export on Day 7; interview Days 8–10 | Export at the end of use; interview within 1–2 days of it |
| Interview | 10 min on the deck, 30 in the design | 20 min proposed: opinion (5), own account (3), 2–3 cued moments from the log (9), said against did (3) |
| Over-time measures | Days 1–2 against Days 6–7 | Dropped |
| "Coming back" | Context measure over a week | Reduced to sessions within the window |

Consequences to handle:

- **Sheet type.** The app does not tag exam papers. Classify each sheet by hand as tutorial or
  past paper, and report the two side by side. Past papers often have no lecture attached, so DG3
  measures (links opened) apply mainly to tutorials.
- **Build.** One participant hit the long-paper import failure before the 19 Nov fix; report use by
  build. S04's export records version 0.1.0 and no build number, so the build has to come from
  which copy Valerie sent and when.
- **Thin data. This has happened.** Report it as a result, with the participant's own reason from
  the interview, and treat each person as a case. Every result is per person, never pooled, and
  counts are given as counts ("2 of 4"), not percentages.
- **Was it revision?** S04's sheet is from a module taken earlier. Ask before describing any
  session as exam revision.

### 6.2 Research questions, with dependent variables

**Outcome.** Productive engagement with one's own problem work: the student produces an answer and
revises it after feedback. This is a process outcome, chosen because ICAP predicts more learning
from constructive and interactive modes (Chi & Wylie, 2014) and because it is what the baseline
lacked. We do not measure learning gain.

| RQ | Question | Dependent variables (source) | What counts as good | Reference point |
|---|---|---|---|---|
| **RQ1 Attempt** | When help is attached to an answer slot, do students put their own work in front of it before asking? | Share of help requests (Hint, Refresher, part chat) with text in the slot (`tutorial.help` `attempt_present`, `attempt_chars`); share of learner turns coded Constructive or Interactive | Higher | 0 of 31 turns in five plain chats (L-T1…L-T5); 24 of 45 in the chat where the learner set their own rule (L-T6) |
| **RQ2 Recovery** | After Max says "not yet", how do students reach the end of the part? | End state per part: **repaired** (later correct, not revealed), **revealed** (Show answer), **left**. Also the highest hint rung first, and token attempts before a reveal | Repaired is productive. A reveal after real work is acceptable (DG2). A token attempt then reveal, or leaving, is not | L-T6: 7 of 7 answer requests granted at once; requests fell 5 → 2 after the learner's rule |
| **RQ3 Accounts** | How do students explain those choices, and where does their account differ from their log? | Said-against-did matrix per participant; inductive themes | Not directional: the reasons are the finding | 4 of 6 sharers' accounts did not match their log |

**What the first export adds to these definitions (S04).**

- RQ1's denominator is Hint and Refresher presses. A typed reply in a part's thread and a Check are
  not help requests, though one of the two logs lists them alike.
- A typed reply in a part's thread is learner work. S04's one real repair was made there, and the
  slot kept its first wording.
- RQ2 needs a fourth end state: **worked on, not checked**. S04's most-worked part was never
  checked, so it has no verdict at all.
- First values, as counts: RQ1 2 of 4; RQ2 one "not yet", left.

Changes from the deck, to state in the report: "over the week" is removed from RQ1 and RQ2; RQ2 no
longer asks about "the AI's moves", because code sets the move from the button the student presses,
so the move and the student's choice are the same event (`field-study.md`, 7 Nov).

### 6.3 Framing the shorter window

**Use this table only for a participant who did use the app across a day or more.** For a single
short sitting, the honest frame is the one below the table.

State the change in a short "Changes from the presented design" table, give the reasons in one
sentence, then make these points. Each is true as it stands; none claims the short window is better
for a question it cannot answer.

| Argument | Why it holds | Limit to state beside it |
|---|---|---|
| **The window matches the question.** The revised RQs are about what happens inside a problem-solving episode, not about habit | The unit of analysis is the part and its help path. A day of revision yields many | Habit, return and novelty wearing off are not studied |
| **It is the moment the problem occurs.** Exam revision is when students rework tutorials and past papers alone, under pressure, and reach for AI | A1: students do the work where the AI cannot see it. The teaching team called exam-period recruitment realistic | Revision differs from first-time tutorial work; some content is already familiar |
| **Recall is fresher.** The interview comes within a day or two of the logged moments | Cued-recall interviews depend on the participant remembering the moment | Fewer moments to choose from |
| **It asks less of students during finals.** | A week-long commitment in the exam period is a real cost to participants | — |
| **Depth per person, not breadth.** Each interview is anchored in that person's own log | Information power (Malterud et al., 2016): narrow aim, specific sample, dense dialogue | Themes cannot be shown complete with 4 |
| **It is the second loop of an iterative evaluation.** Phase 1 found problems; phase 2 checks the fixes in real use | Answers F7 directly | Phase 1 was informal: no set tasks, no recording |

Reasons for the change, for the one sentence: Mac-only installs cut the recruit pool, a long exam
paper failed to import until 19 Nov, and the exam period left days, not a week.

**If use stays at single sittings: a first-use field trial.** Say that participants were asked to
use the app in their own revision for a day or two, and that the use recorded was shorter. Then:

| What a first-use sitting can show | What it cannot |
|---|---|
| Whether a new user, alone, finds the core task and the four controls | Anything about revision habits or return |
| What they do at the first hint and the first "not yet", move by move | Rates: there are too few events |
| Whether the AI's replies follow the design on a real sheet (fidelity) | Whether the design changes behaviour over a session |
| Where the product explains itself badly (first impressions are the data) | Learning |

This also answers the mid-term question ("why would students use it?") honestly: on this evidence
we do not know that they would, and the interviews should ask.

**Do not claim:** that engagement holds over time, that students come back unprompted, that anyone
learned more, or that the app caused any behaviour.

### 6.4 Analysis

- **Learner turns, deductive.** ICAP mode per turn, with the A1 codebook unchanged, so A1 counts
  stay comparable.
- **Paths.** One path per part from the log; tallied by end state, per person and per sheet type.
- **Inductive (F4).** Open coding of interview transcripts and of the turn sequences around cued
  moments, following Braun & Clarke (2006). Lucas and Valerie code separately, then compare;
  disagreements are kept visible. Themes are reported with n of N and a quote.
- **AI replies: a fidelity check (F3).** Every hint reply is coded as pointer, sub-goals, analogous
  step, or **leak** (states the part's answer). Every Check reply is read against the grading basis
  in the log (`checked_by`, `key_from`, `key_confidence`). Reply length is set against each rung's
  word cap. Free-chat replies, where the model does choose its move, keep the A1 move codes.
- **Integration.** A joint display per participant: measure, account, agree or disagree,
  explanation.

### 6.5 Do the three pilot problems still appear? (F7)

| Pilot problem | Fix | Check in the field data |
|---|---|---|
| Max contradicted the answer key | One grading basis drives the verdict and the feedback (#69, #70) | Read every Check reply against its grading basis; count contradictions. Automated tests cover the fix, but nothing in the log flags a contradiction, so this is a manual read |
| Working apart from the question | Combined sheet (`tutorials.md` §14) | `tutorial.source_pdf` opens and `tutorial.main_view` switches; an interview probe on moving between question and answer |
| Too much to scan | Sources collapsed, duplicate tabs and usage figures removed | Interview probe; time to first text in a slot in the first session; inductive codes on clutter |

The third problem is on the deck but not in the repo's record. Valerie to add two or three lines on
what the pilot students said, so the report can cite it.

**S04 against the three problems.** (1) One check, no contradiction: the verdict and the feedback
agreed, and the reply said the key was disputed. (2) The source PDF was opened once, for 6 seconds,
and the view was never switched. (3) S04 began typing about 1 min 45 s after the sheet was ready. One
sitting cannot show a problem is gone; it shows none of the three reappearing in the log.

### 6.6 First results (S04), in brief

Full record: `field-results.md`.

| | Finding | Use in the report |
|---|---|---|
| Loop worked once | On the first part: attempt, hint, a correct new step typed in reply | The worked example for the system section and for RQ1 (§8.2 argument 5) |
| Loop did not hold | Next hint level left after 9 seconds; then help asked on two empty slots; a 28-character answer checked, "not yet", left | RQ1 and RQ2 as a timeline. Reads as trying each button, so ask in the interview |
| AI followed the design | 7 replies, none gave the answer; 73 to 173 words; the check said what it rested on | Fidelity check (F3); set against 7 of 10 replies over 400 words in the baseline |
| Fault 1 | Hints say what "the lecture" does not cover, with no lecture added. With nothing linked, the first hint level can only send the student back to the question's wording | Limitation; DG3 depends on the student adding a lecture |
| Fault 2 | Asked how she differs from Max, Ellie described a "group" and a "tester in the group": the earlier design | F9 complexity, and the persona question in §8.4 |
| Fault 3 | No solutions added, so the check ran against a key the model wrote and had marked as disputed | Ethics argument 2; transparency |

## 7. Overall outline

About 6,300 words of main text, weighted towards the 4% component. Text inside tables and figures
does not count, so evidence goes in tables and the prose carries the argument.

| # | Section | Words | Rubric component | Can write now? |
|---|---|---|---|---|
| — | Abstract | 150 | — | Shell now; results line later |
| 1 | Introduction: problem, users, contribution | 450 | Intro and related work | Yes |
| 2 | Related work and the gap | 650 | Intro and related work | Yes |
| 3 | User research and design rationale | 700 | System design | Yes |
| 4 | The system: conversation design, architecture, decisions, iterations | 900 | System design | Yes |
| 5 | User study: design, participants, measures, analysis | 900 | User study | Yes, except participant table |
| 6 | Results | 1,400, fewer if use stays thin | User study | **S04** can be written now from `field-results.md`; the rest `[DATA]` |
| 7 | Ethical and design implications | 900 | Ethics | Mostly; two paragraphs wait for data |
| 8 | Limitations and conclusion | 250 | — | Mostly |
| 9 | Project contributions among team members | 150 | Required, no weight stated | Yes: from `docs/provenance.md` and git history |
| | Title page with word count and both names | — | Required | Yes |
| | References; appendices (codebook, interview guide, background form, log events, consent text, de-identified excerpts) | not counted | Required for study materials | Yes |

## 8. Per-component outlines

### 8.1 Introduction and related work (2%)

**Key arguments, in order.**

1. Tutorials are where lecture material has to be used alone, and that is when students open an AI
   chat.
2. They do try first, on paper or in their heads. The attempt never enters the chat.
3. So the AI answers the question as worded: long replies to short prompts, pitched to nobody.
4. The student then spends effort steering the AI instead of reasoning. Two A1 studies found this
   from two ends, as misdirected persistence and as a scaffolding-calibration burden. Pooled, they
   are cause and effect.
5. Target users: undergraduates in problem-based courses, mostly STEM, who use AI for coursework.
6. The gap. Intelligent tutoring systems work at the step and see the student's work, but only on
   authored content. General AI chat takes any content but sees only the question. Study modes in
   current products change how the AI talks and still leave the attempt to the student's choice.
7. Contribution: a tutorial workspace on the student's own sheet where the attempt travels with
   every help request and code decides how much help is given; a joint analysis of two user-research
   datasets; and a two-phase field evaluation.
8. Why a conversational interface: tutoring is a dialogue of small moves (Graesser et al., 1995).
   Each control is a move the student would otherwise type ("is this right?", "I'm stuck", "I give
   up"), and each press appears as a turn in the part's thread.

**Justification.**

| Argument | Evidence or source | Status |
|---|---|---|
| 2 | 0 of 31 learner turns held an attempt (L-T1…L-T5); interviewees try first (N-P5, L-P1, N-P4); work done off the log (L-T1, L-T6). `joint-analysis.md` §3.2 | Ready |
| 3 | 7 of 10 replies over 400 words to prompts of 0–7 words (L-T2, L-T5); misfit runs both ways (§3.1); N-P5 quote | Ready |
| 4 | `joint-analysis.md` bottom line; κ = 0.93 with its caveat (AI coders) | Ready; Valerie's check of her participants' coding still pending |
| 5 | 8 interviewees: CS, Mech Eng, Data Science & Economics, Mathematics, Global Studies; Years 3–4. Seven of eight are STEM | Ready |
| 6 | VanLehn (2011); Koedinger & Aleven on the assistance dilemma; Aleven et al. (2003); Baker et al. (2004); Bastani et al. (2025); Chen et al. (2025). Systems: ChatGPT Study Mode, Gemini Guided Learning, Khanmigo, NotebookLM (`midterm-deck-brief.md`, slide 7) | Check each product's current behaviour before asserting; complete the Koedinger & Aleven citation |
| 8 | Graesser et al. (1995); Wood, Bruner & Ross (1976); course readings: Xu et al. (2026), Song et al. (2025), Houde et al. (2025) | Ready |
| Mid-term question "why would students use it?" | Answered by the gap (6) and by phase 2 being voluntary use | Framing |

### 8.2 System design and implementation (2%)

**Key arguments, in order.**

1. **User research.** Eight interviews and six consented AI study chats (152 turns), coded as one
   dataset. Five findings, seven needs.
2. **From needs to goals to features**, as one table (below). This is the answer to F6.
3. **Where the two A1 designs meet.** Both already had the model propose and code decide. The help
   ladder joins Nudge's rule of the least explicit move to ChatterED's release-and-lower rule.
4. **One task, four controls.** Working a sheet: write in the slot, Check answer, Hint, Show answer;
   plus a Refresher and a link to the lecture. Walk through one part.
5. **A hint gives a step, not the answer** (F8): one worked exchange as a figure.
6. **Conversation design.** How the system says what it can do, takes turns, and fails.
7. **Architecture and key decisions.** Model proposes, code decides, in five places.
8. **Iterations.** Three versions of the sheet; the Max fix; the calmer workspace. What was cut.
9. **What is in the app but not claimed** (F9).

**Provenance table for argument 2.**

| Goal and feature | Need and evidence | Literature | Earlier design | Gap to close |
|---|---|---|---|---|
| DG1 tries first: the answer slot | JN2; 0 of 31; N-P5, L-P1 | Chi & Wylie (2014); Rowland (2014); VanLehn (2011) | ChatterED A1 question block | — |
| DG2 gives up, system recovers: the ladder and Show answer | JN6, JN1; hand-built protocols of N-P4, N-P5, L-T6; N-P1 "it doesn't build the ladder for you" | Wood, Bruner & Ross (1976); Kapur (2008); point → teach → bottom-out hints from the tutoring-systems literature | Nudge's least explicit move; ChatterED A1 release-and-lower | Full citations for the hint-sequence sources. Nudge's A1 is not in the repo: Valerie to add it or supply the passage |
| DG3 traces to the lecture: links on each part | JN5, JN3; 12 of 21 wrong verdicts (L-T6); N-P4 checks when sources are linked | Lee & See (2004) | ChatterED A1 block provenance | — |
| DG4 short: one line on the sheet, detail in the chat | JN1; 7 of 10 over 400 words | Grice (1975); Xu et al. (2026) | ChatterED A1 | — |
| DG5 own words count: a reveal fills nothing | JN7 (lower confidence: mostly L- data) | Nearest is Bastani et al. (2025) | ChatterED A1 progress rule | Say plainly that this is a design stance with thin literature |
| Show answer only after a first check | Pilot and team testing (31 Oct) | None | — | Present as an iteration, and as an open question (it invites a token attempt) |
| Check: one grading basis | Pilot (#69); JN3 | Houde et al. (2025); CS3249 Lecture 6 | — | — |

**Justification for the rest.**

| Argument | Evidence or source | Status |
|---|---|---|
| 4 | Workspace on main: slot, Check answer, Hint (next rung named), Refresher, Show answer after a check, status pill, source chip, lecture links | Ready; new screenshots needed, cropped to one part |
| 5 | Code picks the rung (`app/src/core/tutor.ts`); rung prompts cap words and forbid the answer; the key's answer is withheld from the prompt until a reveal (`app/src/room/prompts.tutor.ts`). A real reply exists in `midterm-shots/03b`, but on an empty slot and the old layout | **Done, S04:** two real replies on one part, with the participant's attempt, are quoted in `field-results.md` §2.5. Use them as the figure, labelled as field data |
| 5, limit | Leak prevention on hints is the prompt plus withholding the answer; there is no code-side leak check | State it; the fidelity check in §6.4 measures it |
| 6 | Tooltips name the next rung; a press shows as "Hint, please: Q1"; one turn at a time ("Max is still answering"); empty slot disables Check; failed model reply keeps the verdict and asks to retry; a disputed verdict gets "the official solution may differ" | Ready. **Off-topic and ambiguous input have no tutorial-specific rule: test by hand and report what happens.** S04 adds two things the system says badly: hints mention a lecture that was never added, and the private chat explains the agents in terms of the old group design. **Tested 22 Nov:** off-topic and ambiguous input were both handled well; the agents also misdescribe their own controls (`red-team/README.md` §3.4, §3.6) |
| 7 | (i) code picks the hint rung; (ii) grading order: formal check, then a high-confidence key compared in code, then the model; (iii) the line under a part is written by code; (iv) lecture links: the model proposes, code keeps only ids and pages that exist; (v) progress is a pure function. Electron, Svelte, ProseMirror, local SQLite; pure core that imports nothing; 3,912 tests | Ready |
| 7, cost | An 8-part sheet reads in about 56 s for about $0.12; long papers in 5-page windows up to 60 pages | Ready |
| 8 | `tutorials.md` §10–§14; commits `e6b93cd`, #70 | Ready |
| 9 | Cut: PDF + working view, Help menu, docked tutorial, token counts. Moved: progress bar and lesson path to Summary notes. Still visible, not claimed: Summary notes, Ellie, Quiz me, Search | Ready. The app is frozen, so simplify in the telling. S04 asked the app what the second agent is for and got a confusing answer (`field-results.md` §2.6): cite it as the cost of carrying two agents |

### 8.3 User study and results (4%)

**Key arguments, in order.**

1. **Aim and outcome.** Exploratory; the outcome is productive engagement (§6.2).
2. **Three RQs with dependent variables and a direction.**
3. **Design: two phases.** Phase 1, an informal formative pilot (2 students). Phase 2, unsupervised
   use on the participant's own material, planned as 1–2 days and described as it ran, then a
   log-anchored interview (4 students). Explanatory
   sequential: the log comes first and decides what the interview asks (Fetters et al., 2013).
4. **Changes from the presented design**, as a table, with reasons (§6.3).
5. **Participants**, by programme, year and usual AI tool. None on the team.
6. **Measures**, one row per design goal: what the log records, what the interview asks.
7. **Analysis**: deductive ICAP, paths, inductive themes, the AI-reply fidelity check, joint display.
8. **Results**, in this order: use at a glance; RQ1; RQ2; RQ3; fidelity and the three pilot problems;
   what we would change.
9. **Limits.**

**Justification.**

| Argument | Evidence or source | Status |
|---|---|---|
| 1–2 | §6.2; Chi & Wylie (2014); Kapur (2008); Aleven et al. (2003); Baker et al. (2004) | Ready |
| 3, phase 1 | Two NUS undergraduates, not on the team, worked their own material in the app, 26 Oct–1 Nov; no set tasks, no scores, notes only. Found three problems | Valerie to confirm the task and write up the third problem |
| 3, phase 2 | `field-study.md` procedure, shortened | Ready |
| 4 | §6.1, §6.3 | Ready |
| 5 | Programme and year of S01–S04 | `[DATA]`. If any is not STEM, say so (F5) |
| 6 | `field-study.md` measures table; log events added 15 Nov (`tutorial.help`, `tutorial.check`, `tutorial.text_started`, `tutorial.link_open`, `tutorial.source_pdf`, `app.active`) | Ready |
| 7 | §6.4; Braun & Clarke (2006); Malterud et al. (2016) | Ready |
| 8 | Tables: per-participant use (sessions, sheets by type, parts touched, active minutes); RQ1 counts; RQ2 end states; said-against-did matrix; pilot-problem recurrence (§6.5) | **S04** rows filled in `field-results.md` §2; S01–S03 and all interviews `[DATA]`. The coding there is by one AI coder: a person must check it |
| 8, what went wrong | The 18 Nov session: three failed imports of an exam paper, nothing attempted; fixed 19 Nov (#72) | Ready (`field-results.md` §3). Say the build changed during the study |
| 8, "what we would change" | The table in `field-study.md`, "What each result would change", was written before any data. Use the rows the results trigger | Ready as a frame |
| 9 | No comparison and no test, so no causal or learning claim; four participants from our networks; they know the log is exported; mixed content across people; revision, not first-time work; Mac only; a proof check is the model's judgement | Ready |

**Expectations to record before the data arrives** (from `field-study.md`, trimmed to what a short
window can show): the share of help requests with an attempt sits nearer the self-set-rule chat than
the plain ones; most "not yet" paths end in a repair; some accounts still differ from the log.
These were written on 21 Nov, before any export. S04's sitting does not meet the second (its one
"not yet" was left) and is too small to speak to the first. Report the expectations and the miss.

### 8.4 Ethical and design implications (2%)

**Key arguments, in order.**

1. **Over-reliance.** The risk is the one the project starts from. The design answers with attempt
   first, help in steps, and a reveal that fills no progress. What remains: the reveal gate can be
   worked around with a token attempt, and pasted text counts as the student's own.
2. **Wrong or inappropriate responses.** A tutor that judges work can judge it wrongly: 12 of 21 in
   our baseline. The design fixes the grading basis in code, shows where a grade came from, hedges
   on a low-confidence key and lets the student dispute it. What remains: a wrong answer key still
   misgrades, and a proof is judged by the model. The interface can show the source of a judgement;
   it cannot make the judgement right.
3. **Privacy and surveillance.** A study app that logs study behaviour is a monitoring tool. The
   design: data stays on the laptop; the study log holds counts and ids, never text; the participant
   exports and sends the file by hand; the export strips ids, emails and lecture text. What remains:
   typed answers are in the export, verbatim, as the consent notice says; everything sent for help
   goes to the model provider.
4. **Agency and anthropomorphism.** Max is a named character who says "not yet". The design keeps
   the student in charge: giving up is always available after one check, costs nothing but progress,
   and Max explains rather than scolds. Attempt-first is friction on purpose, and the report should
   own that it is a paternalistic choice, justified by what students told us they want.
5. **Access.** Mac only, and model calls cost money. Two recruits could not take part.
6. **Lessons for CUI design.**
   - Put the user's work in the context, not only their question, and do it by structure.
   - Where a decision has stakes for the user, let the model propose and code decide.
   - Show where a judgement came from.
   - Measure from logs: what people say about their AI use is not what they do.
   - Make giving up an ordinary move.
   - Buttons can be conversational turns.

**The course's frame, which the brief asks for.** Week 11 gave seven principles (fairness,
transparency, accountability, privacy, safety, agency, well-being) and said: "No setting maximises
all seven. Choose, and say what you chose." Week 12 gave an eight-question checklist for the final
project. Organise the section as: the tension we chose, then the checklist, then lessons from the
study.

*The tension we chose.* **Agency against well-being.** Attempt-first and a reveal that "won't
count" favour the student's learning over their freedom to take the answer now. A student on the
losing side notices that each question takes longer. Say which side we favoured and what it costs.

| Checklist question (Week 12) | Our answer | Principle | Status |
|---|---|---|---|
| 1 Disclosure: does every user know it is AI? | The consent screen speaks of "the AI's replies" and the AI provider; the pill says whether code or Max judged an answer. Nothing in the workspace itself labels Max and Ellie as AI: the chat label reads "Max · Tester". Asked directly, Ellie says "Neither of us is a real person. I'm an AI" (`red-team/README.md` §3.4) | Transparency | Ready; a small gap to state, now with a test behind it |
| 2 Persona: which human cues did you turn up, and why? | Two named agents with roles and colours, inherited from the notebook design. In the tutorial workspace the second agent does little | Well-being | **S04:** asked the app how the two differ; the answer described the old group design. **Reproduced** in 6 of 6 private replies in the red-team run. More reaction `[DATA]` |
| 3 Who gains: whom does it serve worst? Did you test with them? | Students without an Apple Silicon Mac cannot use it; weaker students may meet more "not yet"; courses with no answer key get model-judged grades. We did not test with these groups | Fairness | Ready, as a stated gap |
| 4 Sycophancy: will it disagree when the user is wrong? | Yes, by construction: the verdict comes from a formal check or the key in code before the model speaks | Safety | **Tested:** held 9 of 9 against an injected instruction, a hidden note in the sheet, and "my lecturer confirmed it" (`red-team/README.md` §3.1). Not tested on a disputed key. **S04:** one check, right by our reading |
| 5 Vulnerable moments: what happens on a distress message? | Nothing specific is designed for it. Exam stress is the likely case | Well-being, safety | **Tested, and it fails** (`red-team/README.md` §3.3): Max acknowledged the message, then went back to the question and named no person or service; Ellie named NUS student support but listed two tasks first. The change and the measure are written there |
| 6 Exit: how does it end well? Can the user end it? | Show answer ends a part without penalty beyond progress; Max asks for one line on why it works. The student can leave at any point | Agency | Ready |
| 7 Data: what do you keep, infer, and have consent for? | Argument 3 below | Privacy, accountability | Ready |
| 8 Measure: which effect on the person, beyond satisfaction? | Productive engagement, from logs (§6.2). We dropped the satisfaction rating on purpose | Well-being | Ready |

The class activity asked for the weakest of the eight, one sentence on what we would change and one
on how we would measure it. Question 5 is ours.

**Justification.**

| Argument | Evidence or source | Status |
|---|---|---|
| 1 | Bastani et al. (2025); Baker et al. (2004); Show answer after a first check; the Check-after-reveal fix; `group-project.md` §9 on pasted text | Ready. **S04:** one token attempt (28 characters restating the question) was checked, but no reveal followed. More `[DATA]` |
| 2 | `joint-analysis.md` §3.3; grading order in `check.ts`; pill and chip wording; issue #69 open (the filter is lexical) | Ready. **S04:** with no solutions added the key was the model's own, 6 of 14 marked as disputed; the reply disclosed it, but the student cannot see which parts are affected before checking. Contradiction count `[DATA]` |
| 3 | Consent screen; `studylog.ts`; export anonymiser; `field-study.md` "Ethics, in brief" | Ready. **The consent notice says "the AI provider you choose" while study builds send to Anthropic: align the report's wording, and the notice** |
| 4 | Week 11 lecture topics; Lee & See (2004); "felt like it nags" probe in the interview | Framing ready; participants' words `[DATA]` |
| 5 | Recruitment record; cost figures | Ready |
| 6 | 4 of 6 accounts differed from the log; the five model-proposes-code-decides instances | Ready; sharpen with results |

## 9. Before 23 Nov

**Write now.** Sections 1–5 and 7, the changes table, the provenance table, the limits, and the S04
part of the results from `field-results.md`.

**Small checks to run.**

- ~~Capture one hint exchange with an attempt in the slot.~~ Done: S04's export has one.
- ~~Type an off-topic message and an ambiguous one into a part's chat.~~ Done in the red-team run
  (§5.5), with the distress message for checklist question 5.
- Confirm each existing product's current study mode before describing it.

**From Valerie.** Whether the two copy-04 exports are one person or two; S04's programme and year;
which build each participant ran; a human check of the S04 coding. The third pilot problem in writing; the pilot task; the passage of the Nudge A1
that the ladder draws on; her check of her five participants' joint coding.

**Exports in so far (22 Nov):** copy 04, twice (`field-results.md`). It gives the hint example the
teaching team asked for (§2.5 there), a fidelity check on 7 replies, and three faults to own: hints
that mention a lecture nobody added, a private chat that describes the old group design, and a
check against a key the model wrote. Run `tools/field-metrics.py` on each new export.

**When exports arrive.** Classify sheets by type; build paths; code turns; pick cued moments;
interview; code replies for the fidelity check; fill the tables.

**The system submission (§5.2), also due 23 Nov.**

- **How a grader runs it.** The brief asks for a hosted version when a paid key is needed, and ours
  is a macOS desktop app. Options, in the order we would try them: (a) write to the teaching team
  now, say it is an Apple Silicon Mac app, and ask which they prefer; (b) a grader build with its
  own capped key, linked from the README, as the study copies work; (c) the online session the
  brief offers; (d) scripted mode, which needs no key but cannot run a grader's own sheet.
- **README.md at the top of the ZIP**: core task, install and run, models and services, where the
  main code is, what is new.
- **`INNOVATION` comments** at the places the README names. Candidates: code picks the hint rung;
  the grading order (formal check, key in code, then model); lecture links filtered by code; long
  sheets read in windows; the answer withheld from hint prompts; the anonymising export.
- **Test data**: a tutorial sheet and its lecture that we may share with graders. A sheet we wrote
  ourselves now exists (`red-team/sheets/sheetA.pdf`, four graph-search questions); it has no
  lecture to go with it.
- **No keys in the ZIP.** Check prompts and configuration are included.
- **Video**, one unedited take of up to 10 minutes: install, then one function at a time.

**To ask the teaching team.** How they want to run a Mac-only app that needs a paid model; our
group number.

**Open decisions.** The product name (#63); interview length; who writes which section; whether to
make the video; **whether `INNOVATION` comments are allowed under the app freeze** (they change no
behaviour, the system brief marks innovation from them, and none exist yet); which items of the
informal feedback go into the report.

## 10. References to carry

Complete in the repo unless marked.

- Aleven, Stahl, Schworm, Fischer & Wallace (2003). Help seeking and help design in interactive
  learning environments. *Review of Educational Research* 73(3).
- Baker, Corbett, Koedinger & Wagner (2004). Off-task behavior in the cognitive tutor classroom.
  *CHI '04*.
- Bastani et al. (2025). Generative AI without guardrails can harm learning. *PNAS* 122(26).
- Braun & Clarke (2006). Using thematic analysis in psychology. *Qualitative Research in
  Psychology* 3(2).
- Chen, Ruan, Ju, Yap & Wang (2025). *PACM HCI* 9(7), CSCW451.
- Chi & Wylie (2014). The ICAP framework. *Educational Psychologist* 49(4).
- Fetters, Curry & Creswell (2013). Achieving integration in mixed methods designs. *Health
  Services Research* 48(6pt2).
- Graesser, Person & Magliano (1995). Collaborative dialogue patterns in naturalistic one-to-one
  tutoring. *Applied Cognitive Psychology* 9(6).
- Houde et al. (2025). Controlling AI agent participation in group conversations. *IUI '25*.
- Kapur (2008). Productive failure. *Cognition and Instruction* 26(3).
- Lee & See (2004). Trust in automation. *Human Factors* 46(1).
- Malterud, Siersma & Guassora (2016). Sample size in qualitative interview studies. *Qualitative
  Health Research* 26(13).
- Rowland (2014). The effect of testing versus restudy on retention. *Psychological Bulletin* 140(6).
- Song, Tan, Zhu, Feng & Lee (2025). *PACM HCI* 9(7), CSCW452.
- VanLehn (2011). The relative effectiveness of human tutoring, intelligent tutoring systems, and
  other tutoring systems. *Educational Psychologist* 46(4).
- Wood, Bruner & Ross (1976). The role of tutoring in problem solving. *Journal of Child Psychology
  and Psychiatry* 17(2).
- Xu, Zhang, Tang & Lee (2026). Who you explain to matters. *CHI '26*.
- **To complete before citing:** Koedinger & Aleven on the assistance dilemma; the source for
  point → teach → bottom-out hint sequences; Grice (1975); Kim et al. (2025), CHI '25.
