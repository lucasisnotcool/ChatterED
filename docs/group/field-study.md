# Group user study: a week of real use, then interviews matched to the logs

**Status.** Design, 1 Nov 2026. Replaces the session design in `user-study.md` and §5 of
`group-project.md` (both stay as the record). The format is confirmed by Lucas and Valerie: students
use the app for a week, then are interviewed on their opinion, and that is matched against
observations from the app's logs. The prof relaxed the final presentation: **present the study
design; it need not have been run.** The details below (RQs, measures, numbers, schedule) were drafted
from that and need Valerie's read.

**Still required by the course.** The final report asks for a study with **at least 6 participants**,
with measures, analysis and evidence (due 23 Nov). The relaxation we were told about covers the
presentation. Confirm with the prof whether it also covers the report; until then, plan to run it.

## Why this changed from the lab comparison

| | Lab comparison (19 Oct) | Week of use (this) |
|---|---|---|
| Question it answers best | Does tutorial mode differ from usual AI chat on a set problem? | Do students choose it for their own tutorials, how do they use it, and why? |
| Task | Two set CS3230 proofs, 18 min each | Whatever tutorials the student has that week |
| Control | Usual AI chat, within subjects | None; A1 baselines are context only |
| Strength | Comparison | Real motive, real content, repeated use, novelty can fade |
| Cannot show | Whether anyone would open it unprompted | That the app caused a difference, or any learning gain |

Our A1 finding is about behaviour in real study (students do the work where the AI cannot see it),
so a real week tests the design goals where the problem occurs. Removing the comparison also removes
the claim: this study reports a pattern with explanations, not an effect.

## Research questions

- **RQ1 Uptake.** Over a week of their own coursework, do students come back to tutorial mode, and
  for what?
- **RQ2 Behaviour.** How do they get into and through a part: is the attempt there when they ask for
  help, how far do they climb the ladder, do they revise after feedback, do they follow the links to
  the lecture?
- **RQ3 Experience, said against did.** What do they say about it, what do they credit or blame, and
  where does their account differ from their log?

## Method

**Explanatory sequential mixed methods (QUAN → qual)**, one group, in the field. The log comes first
and decides what the interview asks. Integration happens at two points (Fetters et al., 2013): the
log selects the interview's moments (*building*), and a joint display per participant sets each
measure beside their account (*interpretation*).

**Participants.** NUS undergraduates who have at least one tutorial sheet in the study week, used AI
for coursework this semester, have an Apple Silicon Mac on macOS 13+, are not on the team and have not
seen the demo. **Target 6**, the report's minimum. Four preloaded copies are built; each has its own
key with $50 of credit. Sample size is justified by information power (Malterud et al., 2016): a narrow
aim, specific participants, and interviews anchored in each person's own log. It cannot show that the
themes are complete.

**Procedure.**

| When | What | Who | Time |
|---|---|---|---|
| Day 0 | Consent (audio separately), background form: programme, year, usual AI tool and how they use it. Install. Nothing on how to use it well | Participant, one researcher | 15 min |
| Days 1–7 | Uses the app as they choose, on their own tutorials. No minimum, no reminders to use it. One message on Day 3 asking only about technical problems | Participant | their choice |
| Day 7 | File ▸ Export Research Data…, and emails us the zip | Participant | 2 min |
| Days 8–9 | Build the log digest. Pick 3–4 moments: first attempt, highest hint, a Show answer, a retry or a stop | Researcher | 30 min |
| Days 8–10 | Interview | Both | 30 min |

**Interview, in this order.** Opinion comes first, before the participant sees any log, so their
account is not primed by it.

1. *Opinion, 8 min.* Walk me through how you used it this week. What did you use for tutorials
   besides it? Which would you open for next week's tutorial, and why? When did the help feel the right
   size, and when too much or too little?
2. *Their account of their own use, 4 min.* Do you usually write something before asking for help?
   How often did you ask for the answer? Did you open the lecture from a question?
3. *Cued moments from the log, 14 min.* For each of the 3–4 moments, show the part and the timeline.
   What were you thinking here? What did you want from the AI right then? What did you expect to
   happen?
4. *Said against did, 4 min.* Show the summary of their week. Does this match how it felt? Anything
   we have misread?

## Measures: each design goal, the log, and the question

| Goal | Observed in the log | Status today | Asked in the interview |
|---|---|---|---|
| RQ1 uptake | Sessions, days active, sheets added, parts touched | Recorded (`app.start`, `app.quit`, notebook and tutorial rows) | Why did you come back, or stop? What did you use instead? |
| DG1 tries first | Share of help requests with an attempt in the slot; time to first attempt | **Not recorded yet** (gap 1, 2). Check count per part is recorded | Did the slot help you start, or feel like a demand? |
| DG2 recovers | Highest rung per part, Show answer rate, retries after Not yet | Recorded (`tutorial.help`, `tutorial.check`, `tutorial_parts`) | When you pressed Show answer, what had happened just before? |
| DG3 traces to the slide | Links opened from a part; lecture pages cited in replies | Citations recorded in messages; **link opens not recorded** (gap 3) | Did you check what it told you? What made you check? |
| DG4 short | Words per reply; steering messages (joint codebook rule) | Recorded (`messages`), steering hand-coded | Was anything too long or too thin? |
| DG5 own words | Parts correct in own words against revealed | Recorded (`quiz_outcomes`). **Pasted agent text still counts as the learner's** (`group-project.md` §9) | Did the bar mean anything to you? |
| Said vs did | Each claim set against the log | Built in analysis | Part 4 of the interview |

**A1 baselines are context, not a comparison:** 0 of 31 student messages held an attempt (5 chats);
4 of 6 accounts did not match the log.

### What must be added before the build goes out

Audited against `8198994`, 1 Nov. All of it is logging; none changes what the learner sees. Until
these are in, the measures marked above cannot be computed.

1. **Attempt present on a help request.** `tutorial.help` in `main/tutorial/help.ts` logs kind and
   level but not whether the slot had text. Add a boolean and a character count, never the text.
2. **Time of the first text in a slot.** `working` is derived from the saved document and has no
   timestamp (`main/tutorial/view.ts`), and `updated_at` is overwritten. Add one event per part.
3. **Links opened.** *From the notes* and page links are renderer-only, so nothing reaches `main.log`.
4. **Which view is in use.** PDF + working or combined sheet is in `localStorage` only.
5. **PDF + working drafts.** Drafts for printed questions with no generated part are in `localStorage`
   (`TutorialPane.svelte`), so the export cannot see that writing. Log the character count per
   question, or move them to the database.
6. **Active time.** `app.start` and `app.quit` give sessions, not time in use. Stalls (from the lab
   design) are dropped as a measure rather than instrumented: an idle app in a real week is not a stall.

Also: `main.log` rotates at 4 MB × 4 files (`main/log.ts`). Check that a heavy week fits, or the first
days' events are lost. And the four built copies are from `97d36f9`, before Valerie's revamp and
answer verification: rebuild with the same keys after the logging is added
(`app/docs/STUDY-RELEASE.md` §4).

## Analysis

- **Logs.** One timeline per participant, and each measure per participant side by side. Counts and
  medians only; no significance tests.
- **Interviews.** Transcribed and de-identified to S1…S6. Thematic analysis (Braun & Clarke, 2006)
  starting from DG1–DG5 as codes and adding open codes. Lucas and Valerie code separately, compare, and
  keep disagreements visible. Report each theme with n of N and quotes.
- **Integration.** A joint display per participant: measure, their account, agree or disagree, and the
  explanation. A said-vs-did matrix across participants.

## What each result would change

| If we see | We would change |
|---|---|
| Few return after Day 2 | The core task is not worth opening: look at start-up cost (2 min read-in) before anything else |
| Help is asked with empty slots | DG1 is not doing its work: revisit whether Hint should need a line of attempt first |
| Show answer straight after rung 1 | The ladder is friction, not scaffolding: shorten it, or make rung 1 stronger |
| Long replies, then no next action | DG4's sizing is wrong for that task type |
| Links never opened, and they say they trust it | DG3 makes help checkable but not checked: bring the source into the reply |
| "Felt like it nags" with high attempt-first | The number moved for the wrong reason: the behaviour is not one they would keep |

## What it can and cannot conclude

It can show, for these students, whether they came back, how they worked through parts in the wild,
and why, set against what they did. It cannot show that the app caused any change (no control group),
that anyone learned more (no test), or anything beyond this group. Other limits:

- **Recruitment.** Participants are from our networks, so they may be kinder in interviews. Ask for
  faults directly, and let the log check the account.
- **Being observed.** They know the log is exported. Reported, not removed.
- **Mixed content.** Each brings different sheets, so parts are not comparable across people.
- **Correctness.** Check on a proof is the model's judgement. We make no accuracy claim (`group-project.md`
  §6). Where a solutions file or a formal checker exists, code holds the grade (`app/docs/TUTORIAL-ANSWER-TESTING.md`).
- **End of term.** Week 13 is 9–13 Nov. Tutorial sheets stop soon, so the week must start by about
  5–9 Nov, or participants will be working past sheets for exams, a different task.

## Ethics, in brief

Compliance is handled by Lucas with the prof and TAs. For the design: participants export their own data
by hand, and it is anonymised by the export (`P-…` id, student ids and emails dropped, lecture PDFs and
their text never included). Material they send to the model goes to Anthropic through the study's
key, as the notice states. Any folder can be excluded from research data. Audio needs separate consent;
recordings and raw transcripts are never committed.

## Schedule

| When | |
|---|---|
| Before the presentation | Valerie reads this; settle the slot and who presents what |
| By 5 Nov | Logging added, copies rebuilt, a 10-minute pilot on a clean profile |
| 5–9 Nov | Day 0 for each participant |
| By 16 Nov | Week of use done, interviews done |
| 17–20 Nov | Coding, joint displays |
| 23 Nov | Report and system |

## References

- Braun, V., & Clarke, V. (2006). Using thematic analysis in psychology. *Qualitative Research in
  Psychology*, 3(2), 77–101.
- Fetters, M. D., Curry, L. A., & Creswell, J. W. (2013). Achieving integration in mixed methods
  designs: principles and practices. *Health Services Research*, 48(6pt2), 2134–2156.
- Malterud, K., Siersma, V. D., & Guassora, A. D. (2016). Sample size in qualitative interview
  studies: guided by information power. *Qualitative Health Research*, 26(13), 1753–1760.
