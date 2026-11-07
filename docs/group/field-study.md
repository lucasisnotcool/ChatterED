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

**Revised 2 Nov (Lucas), from the mid-project needs.** An observational study cannot test a
hypothesis or show cause, so the RQs are exploratory. They are derived from four of the six needs
presented at mid-project (slide 5; `joint-analysis.md` §4) and the theory each applies:

| Need (mid-project) | Theory it applies | RQ |
|---|---|---|
| N1 The learner's own attempt reaches the tutor | Tutoring at the step (VanLehn, 2011) | RQ1 |
| N2 Support in responding to productive failure | Productive failure (Kapur, 2008) | RQ1, RQ2 |
| N3 Structure without setting it up; N4 Help sized to the task and the learner | Scaffolding (Wood, Bruner & Ross, 1976) | RQ2 |
| N5 Grounded in the course; N6 Verifiable feedback | | **not studied**: about content correctness, not engagement; would need planted errors in a set task |

All three theories predict that learning follows what the learner produces. The learner's side is
read with ICAP (Chi & Wylie, 2014), a code in the A1 codebook
(`docs/research/ai-use-transcripts/analysis/codebook.md`), reused unchanged, so the A1 counts are the
baseline. The help is read as the student's own help-seeking path (Aleven et al., 2003), not as the
AI's move: see the note under RQ2.

- **RQ1 (N1, N2): engagement.** How do students engage with their own tutorial work when the AI waits
  for their attempt, and does that hold over time? Every learner turn (answer box at Check, chat
  message, button press) coded Passive / Active / Constructive / Interactive; where C and I turns
  appear, and where they don't. A1: 0 of 31 turns C or I in five chats; 24 of 45 in the chat with a
  self-set protocol. Over time: the C + I share in early use against late use (in a one-week study,
  Days 1–2 against Days 6–7), to see whether it lasts once the app is no longer new.
- **RQ2 (N2, N3, N4): help-seeking.** When students get stuck, which help do they reach for, and where
  does the path end: a repair in their own words, or Show answer? Does that change over time? One
  path per part, from the log: attempt → Check → "not yet" → hint 1 → hint 2 → revise and re-check,
  or Show answer, or leave. Over time: whether the highest hint used per part falls (help fading as
  they need less: scaffolding working), and whether token attempts just before Show answer rise
  (gaming the gate; Baker et al., 2004). A1: 7 of 7 answer requests granted at once before the
  learner's own protocol; answer requests then fell 5 → 2 (L-T6).

  *Why not the AI's moves (changed 7 Nov, Lucas; the presented deck still has the earlier wording).*
  The earlier RQ2 asked how the AI's moves (tell, elicit, assess) shape what students do next. In
  TutorED the move is set by code from the student's action: Check gets an assessment, Hint gets an
  elicitation, Show answer gets the answer. So in an observational study the move cannot be
  separated from the student's own choice, and pairing it with the next turn measures that choice
  twice. Its effect could only be seen by varying it on purpose, which is an experiment. The A1
  `A-MOVE` code (tutoring moves; Graesser et al., 1995; Chi et al., 2001) is kept only to describe
  free-chat replies, where the model chooses its own move.
- **RQ3 (all four): accounts.** How do students make sense of their own engagement, and where does
  their account differ from what they did? The interview set beside the log (A1: 4 of 6 accounts
  did not match).
- **Context, not an RQ: coming back.** Days used, unprompted, and whether use clusters before a tutorial
  is due. It says whether TutorED is worth opening when nobody asks, and frames everything above.

**Usability is not part of this study (2 Nov, Lucas).** A week of use tells us about engagement and
return, not about usability, and a two-item rating adds little to that. The Day 7 rating is dropped.
Usability problems that come up in the interview are noted and fixed, not analysed.

The export includes what participants type, as typed, so turns can be coded. Earlier wording (kept
for the record): RQ1 uptake, RQ2 behaviour, RQ3 said against did (1 Nov); then RQ2 as the AI's
moves (2 Nov, presented at the final presentation).

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
| Day 7 | File ▸ Export Research Data…, and emails us the zip | Participant | 5 min |
| Days 8–9 | Build the log digest. Pick 3–4 moments: first attempt, highest hint, a Show answer, a retry or a stop | Researcher | 30 min |
| Days 8–10 | Interview | Both | 30 min |

**Before this study: an informal usability pilot (done; not part of the study).** Valerie had two friends (NUS
undergraduates, not on the team) work their own tutorial questions in the app, 26 Oct – 1 Nov, and
noted what they ran into. No set tasks or scores, so it finds problems but measures nothing. It
found two, both fixed: Max's feedback contradicted a verified answer key (#69, fixed in #70), and
the separate PDF + working view kept the answer boxes apart from the question text and diagrams
(replaced by the combined sheet, `e6b93cd`, `docs/research/tutorials.md` §14). It informed the design;
the study itself does not measure usability.

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
| Coming back (context) | Sessions, days active, sheets added, parts touched | Recorded (`app.start`, `app.quit`, notebook and tutorial rows) | Why did you come back, or stop? What did you use instead? |
| DG1 tries first | Share of help requests with an attempt in the slot; time to first attempt | **Not recorded yet** (gap 1, 2). Check count per part is recorded | Did the slot help you start, or feel like a demand? |
| DG2 recovers | Highest rung per part, Show answer rate, retries after Not yet | Recorded (`tutorial.help`, `tutorial.check`, `tutorial_parts`) | When you pressed Show answer, what had happened just before? |
| DG3 traces to the slide | Links opened from a part; lecture pages cited in replies | Citations recorded in messages; **link opens not recorded** (gap 3) | Did you check what it told you? What made you check? |
| DG4 short | Words per reply; steering messages (joint codebook rule) | Recorded (`messages`), steering hand-coded | Was anything too long or too thin? |
| DG5 own words | Parts correct in own words against revealed | Recorded (`quiz_outcomes`). **Pasted agent text still counts as the learner's** (`group-project.md` §9) | Did the bar mean anything to you? |
| Said vs did | Each claim set against the log | Built in analysis | Part 4 of the interview |

**A1 baselines are context, not a comparison:** 0 of 31 student messages held an attempt (5 chats);
4 of 6 accounts did not match the log.

### Baselines and expected findings (added 2 Nov, for the final presentation)

With no control group, a number is read against three baselines. None supports a causal claim.

| Baseline | What it is | Read against |
|---|---|---|
| How students use AI today (A1, `joint-analysis.md`) | 0 of 31 messages held an attempt (5 chats); answer requests 5 → 2 once one learner set a rule (L-T6); 7 of 10 comprehension replies over 400 words for 0–7-word prompts (L-T2, L-T5); 4 of 6 accounts did not match the log | Attempt present on a help request; Show answer rate and highest rung; words per reply and steering; said vs did |
| Their own account, Day 0 | The background form: usual AI tool and how they use it | Their log and interview |
| Themselves over time | Early use against late use (Days 1–2 against Days 6–7), descriptive only | Whether engagement holds once the novelty fades (RQ1); whether help fades (RQ2) |

**Expected findings, written before any data.** These are our expectations, not results; the rules
under "What each result would change" say what follows if they fail.

- Coming back: most participants use it on two or more days, unprompted, mostly before a tutorial is
  due. If few return after Day 2, cut the two-minute start-up first.
- RQ1: the C + I share sits nearer the self-set-protocol chat (24 of 45) than the plain ones (0 of 31).
  If help is asked with an empty box, a hint should need a line of attempt first.
- RQ1 over time: the C + I share holds from early use to late use. If it falls, the attempt-first
  habit only lasts while the app is new: ask what changed, and make the attempt step lighter.
- RQ2: most paths that reach "not yet" end in a repair in the student's own words, not Show answer,
  and the highest hint used per part falls over time. If Show answer follows straight after the first
  hint, the ladder is friction; if token attempts before Show answer rise over time, the gate is being
  worked around.
- RQ3: some accounts still differ from the log, as 4 of 6 did in A1; the reasons are the point.

These are hunches to check, not hypotheses to test.

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
- **Over time.** Each measure split early use against late use (Days 1–2 against Days 6–7), per
  person. Descriptive only.
- **Help-seeking paths.** One path per part, as a sequence of the student's actions; tallied by where
  it ends (repair, Show answer, left), per person.
- **Integration.** A joint display per participant: measure, their account, agree or disagree, and the
  explanation. A said-vs-did matrix across participants.

## What each result would change

| If we see | We would change |
|---|---|
| C + I share falls from early to late use | The attempt-first habit lasts only while the app is new: make the attempt step lighter |
| Few return after Day 2 | The core task is not worth opening: look at start-up cost (2 min read-in) before anything else |
| Help is asked with empty slots | DG1 is not doing its work: revisit whether Hint should need a line of attempt first |
| Show answer straight after rung 1 | The ladder is friction, not scaffolding: shorten it, or make rung 1 stronger |
| Token attempts before Show answer rise over time | The attempt gate is being worked around: ask for a substantive line before the reveal, or stop counting a check as an attempt |
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

- Aleven, V., Stahl, E., Schworm, S., Fischer, F., & Wallace, R. (2003). Help seeking and help design
  in interactive learning environments. *Review of Educational Research*, 73(3), 277–320.
- Baker, R. S., Corbett, A. T., Koedinger, K. R., & Wagner, A. Z. (2004). Off-task behavior in the
  cognitive tutor classroom: When students "game the system". *CHI '04*, 383–390.
- Braun, V., & Clarke, V. (2006). Using thematic analysis in psychology. *Qualitative Research in
  Psychology*, 3(2), 77–101.
- Chi, M. T. H., Siler, S. A., Jeong, H., Yamauchi, T., & Hausmann, R. G. (2001). Learning from
  human tutoring. *Cognitive Science*, 25(4), 471–533.
- Chi, M. T. H., & Wylie, R. (2014). The ICAP framework: Linking cognitive engagement to active
  learning outcomes. *Educational Psychologist*, 49(4), 219–243.
- Fetters, M. D., Curry, L. A., & Creswell, J. W. (2013). Achieving integration in mixed methods
  designs: principles and practices. *Health Services Research*, 48(6pt2), 2134–2156.
- Graesser, A. C., Person, N. K., & Magliano, J. P. (1995). Collaborative dialogue patterns in
  naturalistic one-to-one tutoring. *Applied Cognitive Psychology*, 9(6), 495–522.
- Kapur, M. (2008). Productive failure. *Cognition and Instruction*, 26(3), 379–424.
- Malterud, K., Siersma, V. D., & Guassora, A. D. (2016). Sample size in qualitative interview
  studies: guided by information power. *Qualitative Health Research*, 26(13), 1753–1760.
- VanLehn, K. (2011). The relative effectiveness of human tutoring, intelligent tutoring systems, and
  other tutoring systems. *Educational Psychologist*, 46(4), 197–221.
- Wood, D., Bruner, J. S., & Ross, G. (1976). The role of tutoring in problem solving. *Journal of
  Child Psychology and Psychiatry*, 17(2), 89–100.
