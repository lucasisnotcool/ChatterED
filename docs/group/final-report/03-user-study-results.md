<!-- DRAFT 1, 23 Nov 2026. Sections 5 and 6 of the final group report (rubric: "User study and
     findings", 4%). Written for the graders, in the voice of sections 1 to 4 as Lucas left them.
     Notes for Lucas and Valerie are in comments like this one and at the end; delete them before
     the PDF is made.
     Word count, main text only (tables, headings and comments excluded): section 5 about 1017,
     section 6 about 1,312. Tables continue from Table 6; no new figures.
     Vetted by Lucas on 23 Nov. -->

## 5. User study

### 5.1 Aim and research questions

Our exploratory study aimed to find out whether students working on their own
homework would put an attempt in front of the AI before asking it for help, and what they would do
once the AI told them that the attempt fell short. The outcome we look at is therefore a process,
namely the student producing an answer and revising it after feedback, which ICAP associates with
more learning than reading or receiving (Chi & Wylie, 2014). We did not measure learning gain, and
the study has no comparison condition. Table 7 gives the three research questions, what was
measured for each, and the figure from our user research that each is read against.

**Table 7. Research questions.**

| | Question | Measured by | Reference point from the user research (Section 3) |
|---|---|---|---|
| RQ1 Attempt | When help is attached to an answer slot, do students put their own work in the slot before asking for help? | Hint and Refresher presses made with text in the slot; parts that began with the student typing (log) | 0 of 31 student turns held an attempt in five shared sessions; 24 of 45 in the session where the student set their own rule |
| RQ2 Recovery | After a first verdict short of "complete", how does the student reach the end of the part? | The end state of each part, read from the order of events in the log: repaired (later marked complete), revealed (Show answer), left, or worked on and never checked | In the session with the student's own rule, 7 of 7 requests for the answer were granted at once |
| RQ3 Accounts | How do students describe the experience, and where does their account differ from their log? | Students' written feedback and the remarks they typed in the app, coded and set against each student's log | 4 of 6 written accounts left out or contradicted the log |

We wrote down three expectations on 21 November, before any data had arrived: that the share of
help requests made with an attempt would sit nearer the session with the student's own rule than
the other five; that most parts which fell short would end in a repair; and that some accounts
would still differ from the log. Section 6.6 returns to them.

### 5.2 Design

The evaluation ran in two phases. The first was the informal pilot described in Section 4.5, in
which two NUS undergraduates outside the team worked through their own tutorial questions between
26 October and 1 November; it had no set tasks and no measures, and its purpose was to find
problems before the main phase. The second was a field study, in which participants installed the
app on their own Mac and used it unsupervised, on homework of their own choosing, for as long as
they wished. We chose the field over a supervised session because both RQ1 and RQ2 concern what
students do when the work is their own and nobody is watching. The design is sequential (Fetters
et al., 2013), in that the log is analysed first and the students' accounts are then set against
it, since our user research had found that such accounts leave things out (Section 3.2).

The study as it ran differs from the design that we presented on 2 November (Table 8).
Installation on Mac only narrowed recruitment, and the study ran into the examination period. On
its first day, a student added a 35-page examination paper, a use we had not planned for, and the
app could not import it. We reworked the import to read long papers in sections (19 November)
before continuing, so the planned week of use became 18 to 22 November. Sessions in which no
homework could be imported produced no data and are not analysed.

**Table 8. Changes from the presented design.**

| | Presented (2 Nov) | As run |
|---|---|---|
| Window | Seven days of use | 18 to 22 Nov; participants were asked to use the app for a day or two of their own revision |
| Material | That week's tutorials | Any homework of the participant's choosing, past examination papers included |
| Participants | 4, with 6 targeted | 4 |
| After use | The export, then a 30-minute interview built around moments from the participant's own log | The export. No interview was held before submission; three participants sent written feedback through one of us |
| Change over time | Early use compared with late use | Dropped |
| Build | One build throughout | One fix during the study (19 Nov), to the import of long papers; every analysed session began after it |

### 5.3 Participants

Four NUS undergraduates in technical courses took part (S01 to S04, Table 9). They were recruited
by one of us from our own networks, none of them is on the team, and each needed a Mac and to have
used AI for coursework this semester. Each received a copy of the app with model credit already loaded and a
short demonstration video, and was told nothing about how to use the app well. No participant
added a lecture, and only S03 added solutions as a separate file.

**Table 9. Participants and what they brought.**

| | Homework | Lecture or solutions added | Use |
|---|---|---|---|
| S01 | A tutorial on reinforcement learning, 5 parts | Neither | One sitting, 29 active minutes |
| S02 | A practice set on probability and counting, 11 parts | No lecture; the worked solutions were in the same file | One evening, 96 active minutes |
| S03 | A tutorial on relational algebra, 5 parts | No lecture; solutions as a separate file | Three sittings over two days, 193 active minutes |
| S04 | Discussion questions on graph search, 14 parts | Neither | One sitting, 15 active minutes |

*Active minutes are counted by the app: a minute counts when the participant typed, clicked,
scrolled or moved the pointer in the app's window at least once during it, so time with the app
open but untouched is not counted.*

### 5.4 Data and consent

On first launch the app shows a notice that explains what a research export contains, and the
participant has to agree before continuing (Appendix W). Nothing is sent automatically; the
participant chooses File, Export Research Data, and sends us the resulting file. The export
replaces the Mac's user name with a random participant code and leaves out the files that the
participant added, together with their text. What it keeps is the app's own log, which records
each press of the four controls with the length of the answer in the slot at that moment, each
verdict and what it was marked against, every typed turn and every reply from the agents, and the
minutes in which the app was in use. One limit follows from this, as the log keeps the length of
the answer at each check but only the final text, so an earlier version of an answer has to be
reconstructed from the reply that quotes it.

### 5.5 Analysis

All results are given as counts for each participant; with four people, we report no percentages
and run no tests. For every part we read the order of events to assign its end state, since the
stored status alone can mislead (a part that is revealed after being marked complete is stored as
revealed). Each typed turn was coded as the student's own reasoning, a request to be taught, or a
remark about the system, and by ICAP mode. Every reply from the agents was checked against two of
the design rules, namely that no answer is given before Show answer and that replies stay short;
for S02, whose export arrived last and was the largest, all 47 replies were additionally checked
rule by rule and all 28 verdicts were audited against the answer in the slot. The written feedback
and the remarks typed in the app were divided into 38 units of one point each and coded
deductively, against ten categories fixed in advance (Appendix Z). Eight of these come from
commitments that the project had already made, which are the five design goals, the need for
feedback that can be checked, the teaching team's concern about two agents, and the cost in time
that the assistance dilemma predicts, while two further categories hold whatever these do not
cover. Each unit was then compared with that participant's log. It should be noted that all of the
coding was carried out by AI models working from written instructions, with S02's export read by
four separate runs. One of us then read the full analysis together with its evidence tables and
accepted its findings, although the coding itself was not repeated by hand.

## 6. Results

### 6.1 How the app was used

Table 10 summarises each participant's use. Only S03 used the app in the way that the study had
planned, across two days; S02 used it for one long evening, while S01
and S04 each used it for a single short sitting.

**Table 10. Use of the app, by participant.**

| | S01 | S02 | S03 | S04 |
|---|---|---|---|---|
| Parts touched | 5 of 5 | 8 of 11 | 5 of 5 | 3 of 14 |
| Parts that began with the student typing | 4 | 7 | 3 | 1 |
| Check answer | 8 | 28 | 16 | 1 |
| Hint (highest level reached) | 1 (level 1) | 1 (level 1) | 2 (level 2) | 3 (level 2) |
| Refresher | 0 | 1 | 2 | 1 |
| Show answer | 3 | 1 | 1 | 0 |
| Typed turns | 4 | 16 | 18 | 2 |
| Replies from the agents | 16 | 47 | 39 | 7 |

Of the 69 presses of the four controls, 53 were Check answer, and no participant reached the
third level of hint. The three participants who used the app for more than a quarter of an hour
all relied mostly on writing something in the slot and being told what was wrong with it. Since the reply
to a check names one fault and asks one question about it, in practice it did the work that the
hint levels had been designed for.

### 6.2 RQ1: did the attempt come first?

In most cases it did. Of the 21 parts that the participants touched, 15 began with the student
typing an answer, while 3 began with a hint and 3 with a Refresher. Of the 7 hints, 4 were
requested with an attempt already in the slot. The Refreshers are a different case, as 3 of the 4
were pressed on an empty slot as the first action on a part, which is the use that a Refresher is
meant for, and the fourth was pressed on a part that was already complete. These figures are far
from the 0 of 31 turns in our user research, although they are counts of a few events from four
people and should not be read as a rate. What they do show is that the structure worked as
intended, as each of the 53 checks carried the student's answer to the agent without the student
having to type it into a message. Two qualifications apply. S04 attempted the first part and then
asked for help on empty slots; and a
count of button presses misses requests that were typed, as S03 asked to be taught in their own
words five times and S02 once.

### 6.3 RQ2: what happened after a verdict short of complete?

Fourteen parts fell short at their first check, and what followed depended mostly on the
participant (Table 11). S03 and S02 repaired 9 of their 10 by revising and checking again, S01
pressed Show answer on all 3, and S04 left the one part and exported soon after.

**Table 11. End state of each part, by participant.**

| | S01 | S02 | S03 | S04 | All |
|---|---|---|---|---|---|
| Complete at the first check | 2 | 3 | 0 | 0 | 5 |
| Short at the first check, then repaired | 0 | 4 (after 5, 2, 10 and 2 checks) | 5 (after 2, 4, 2, 6 and 2 checks) | 0 | 9 |
| Short at the first check, then revealed | 3 | 1 | 0 | 0 | 4 |
| Short at the first check, then left | 0 | 0 | 0 | 1 | 1 |
| Worked on, never checked | 0 | 0 | 0 | 2 | 2 |

Table 12 gives four episodes behind these counts. Three points should be drawn from them.
Firstly, the repairs were real work, and much of it took place in the thread: S03 built two
answers over several typed turns before writing them into the slot, and 10 of S02's 16 typed
turns were their own reasoning. Secondly, a repair in this sense means that the student fixed
what Max had pointed at; in episode C Max located every fault, so the result does not show that
the student could have found them alone. Thirdly, S01's three reveals each came after a real
attempt and within about a minute of the last feedback, with one step left, and S01 then answered
Max's follow-up question in their own words three times out of four, which is a use of Show
answer that the design accepts.

**Table 12. Four episodes.**

| | What happened | What it shows |
|---|---|---|
| A. S03, part 1(b) | Two "not yet" verdicts, then an angry message saying that they had never studied the topic and asking what an expression should even look like. Max gave the general shape of an answer and one smaller piece to try. S03 typed the answer in two turns, and the part was complete two checks later | The recovery that the design hoped for. It needed Max to stop asking questions and to give something |
| B. S02, part 4 | A correct answer was marked "not yet" once and "partly there" five times. Max first doubted a correct term, and later quoted a version of the answer that was no longer in the slot. The student objected and was right, and Max agreed in words while the verdict stayed. The student pressed Show answer, which cost the part's progress, and Max then wrote "You were right" | Marking by the model can be wrong against the student, and the design turned that into a penalty |
| C. S02, part 2(b) | Ten checks in twelve minutes, the first eight of them "not yet". Each check changed the one factor that the previous reply had named, and the tenth was complete. Nine of Max's ten replies named a fault that was really there | Step-by-step repair, with the feedback doing the locating |
| D. S02, part 1(a) | The part asks for =, < or > with a reason. The student checked each sign in turn with no reason, then typed their own count in the thread, found a case that they had missed, and corrected both counts | Check answer used to find the answer to a three-way choice (3 of S02's 28 checks), which is the gaming that Baker et al. (2004) describe, followed by real reasoning |

### 6.4 RQ3: what students said, and how it compares with what they did

Of the 38 units of feedback, 6 support the design, 24 name a problem and 8 ask for a change
(Table 13). All 6 that support it concern attempting first and persisting, and the two
participants who gave them had first been told what the app was for, so we weigh the criticism
more heavily than the praise.

**Table 13. Feedback by category (38 units; + supports the design, − names a problem, R asks for a change).**

| Category (where it comes from) | Units | + | − | R | Example |
|---|---|---|---|---|---|
| The two agents (teaching team's concern) | 8 | 0 | 6 | 2 | "who is ellie and max? … are both not basically just AI" (S04) |
| Help when stuck (DG2) | 8 | 2 | 5 | 1 | "it's not helping me to think, it's just questioning me" (S04) |
| Interface mechanics (outside the goals) | 6 | 0 | 4 | 2 | An answer box that scrolls sideways (reported by one of us) |
| Attempt first (DG1) | 4 | 4 | 0 | 0 | "inside my head I KINDA get it but when I'm supposed to answer everything is blurry" (S01) |
| Trust in the verdict (need for checkable feedback) | 4 | 0 | 3 | 1 | "if it doesn't have the answer sheet, where is the absolute ground truth coming from" (S04) |
| Amount to read (DG4) | 3 | 0 | 3 | 0 | "pls be concise" (S02, typed to Max) |
| Grounding in the material (DG3) | 2 | 0 | 2 | 0 | The solutions cannot be opened inside the app (reported by one of us) |
| Own answer and credit (DG5); cost in time; beyond scope | 1 each | 0 | 1 | 2 | It takes much longer to finish a question (S03, as reported by one of us) |

Four themes come out of the feedback together with the logs. The first is that writing an answer
exposed what the student did not know, which S01 put in the words quoted in Table 13 and which
agrees with S01's log, where three of five first answers were partly right. The second, and the
one with the widest support, is that students could not see what a verdict rested on and could
not contest it. S04 asked where the ground truth comes from and wanted to see the answer key, S03
asked Max how he had read a symbol, S02 told Max that they had been right, and the logs bear
these out: besides episode B, five of S01's eight checks ran against a key that the app itself
had marked as uncertain, and S03 pressed Show answer only after a part was complete, apparently
to see the model answer. The third theme is that the two agents were hard to tell apart, which
came from at least three people and had nothing said in its favour, while Refresher, the only
control that belongs to Ellie, accounted for 4 of the 69 presses. The fourth is that a question
is of little help to a student who has nothing yet to reason from; S04 liked the idea of
questioning and disliked the experience, and the turning point of episode A was Max giving
something in place of asking.

Table 14 sets each participant's account beside their log. The accounts agree with the logs on
what happened, while they tend to leave out what it cost or where it stopped, which is the pattern
that our user research had found in students' accounts of their AI chats.

**Table 14. Said against did.**

| | Said | Did | Reading |
|---|---|---|---|
| S01 | Having to answer showed that what felt understood was blurry, and "I'm forced to confront it" | Began 4 of 5 parts by typing; revised 2 of the 3 that fell short, then pressed Show answer on all 3 | True of the first step. "Forced" overstates the second, as the answer was one press away and S01 took it |
| S03 (as reported by one of us) | Show answer felt like giving up, so S03 kept trying; it takes much longer | Repaired 5 of 5 over 193 active minutes; one angry message; pressed Show answer once, after "complete" | Agrees, and leaves out the frustration at the moment it occurred |
| S04 | Questions do not help without prior knowledge; the two agents are unclear; a verdict with no answer sheet is hard to trust | 15 minutes; one hint led to a correct new step, and a level 2 hint was left after 9 seconds; the one check ran on an uncertain key | First impressions, as S04 said. The criticisms hold in the log, although the view of questioning rests on one that worked and three that were not tried |
| S02 | No feedback was received. In the app: could not follow Max, asked for brevity, said that they had been right | 28 checks; repaired 4 of 5; correct on part 4 while Max was not | The remarks were unprompted, and the log bears each one out |

### 6.5 Did the system behave as designed?

Across all 109 replies, none stated a part's answer before Show answer or a "complete" verdict,
and none exceeded 400 words, against 7 of 10 in the comparable sessions of our user research; the
longest was 192 words, and 27 ran over the app's own limits of 100 to 130 words. The closer
reading of S02's export gives a less comfortable picture (Table 15), and since that reading was
not made of the other three exports, the first result should be taken as a result on two rules
only. The audit of the verdicts was made by AI readers, and where an answer had since been edited
they worked from a reconstruction of it, so the four verdicts judged too strict are the reading of
that audit and have not been confirmed by a second person.

**Table 15. S02's 47 replies and 28 verdicts, checked rule by rule.**

| Rule | Result |
|---|---|
| No answer before Show answer | 0 stated an answer; 2 gave away a step (both arguable) |
| Truthful about the student's work | 4 replies misdescribed the answer in the slot, and 6 more arguably; Max withdrew a point or apologised 5 times |
| Verdict correct | 23 of 28 correct, 4 too strict (all in episode B), none too lenient, 1 that cannot be judged |
| One question per reply | 4 replies asked two |
| Short replies | 5 over the app's own limits; longest 142 words |

The study also exposed faults in the system, which are listed in Table 16 and which we could not
fix, as the build was frozen for submission. Of the two problems found in the pilot, the first
did not recur, in that we found no reply that contradicted the verdict beside it. The second
recurred in a new form, as it was reported to one of us that participants with a solutions file
read it in a separate window outside the app. In addition, three units of feedback said that
there was too much to read or to scan.

**Table 16. Faults found in the field study.**

| Fault | Seen in | Consequence |
|---|---|---|
| Max is not told what changed in the slot between checks | S02: apologised twice for misreading a sign that the student had in fact changed; quoted an old version of an answer | The cause of episode B |
| A verdict cannot be contested, and a reveal then costs the progress | S02, part 4; S03 lost the progress of a part that was already complete by pressing Show answer afterwards | A correct answer recorded as revealed |
| The agents call the homework "the lecture", "the deck" or "the slide" | 36 of 55 replies to S01 and S03; also S04 | Hints refer to a lecture that was never added |
| Ellie describes a group conversation from an earlier design | S04, when asking how she differs from Max | Adds to the confusion over two agents |
| Solutions added at the start were not used for the key for two and a half hours, and were turned into a notes page that states the answers | S03 | Early verdicts ran on the model's own key |
| With solutions in the same file as the questions, Max's page references point at them | S02: 19 of the 35 replies sent before a part was done | Grounding (DG3) becomes a pointer to the answer |
| The one-line verdict under a part is cut short | S02: 10 of 31 lines, five of them at a factorial sign | A small case of a rule in code going wrong |
| A long examination paper could not be imported | The first day of the study (18 Nov), before the fix | That session produced no data and is excluded; fixed on 19 Nov |

### 6.6 Expectations, and the limits of these results

Of the three expectations, the first held in direction, with 4 of 7 hints and 15 of 21 parts
beginning from the student's own work. The second held as a count, with 9 of 14 parts repaired,
although the repairs belong to two of the four participants. The third held in a weaker form than
we had expected, as the accounts differed from the logs mainly by what they left out.

These results have clear limits. There were four participants, drawn from our own networks, who
knew that their log would be exported and who each brought different material. There was no comparison with an ordinary AI chat and no test of learning, so we
make no claim that the app caused any of this behaviour or that anyone learned more. No interview
was held, and the feedback was informal, given in part after the app's aims had been explained and
in part through one of us. All coding was carried out by AI models. Lastly, no participant added
a lecture, so the third design goal, help that traces back to the course material, was not tested
at all. Section 7 takes up what these results mean for the design.

<!--
NOTES FOR LUCAS AND VALERIE (delete before submission)

1. Scope. Sections 5 and 6 are the third rubric component (User study and findings, 4%). The
   outline budgeted 900 + 1,400 words; the header gives the current counts. First places to cut:
   the "We chose the field" sentence of 5.2, the "Three points" paragraph of 6.3, and 6.6's first
   paragraph.

2. Settled with Lucas on 23 Nov, by question and answer:
   - Four participants, S01 to S04. The 18 Nov copy-04 export (import failed, nothing attempted)
     is reported only as a build change during the study and an exclusion rule (5.2, Table 8,
     Table 16), with nothing said about who the student was. S04 is the 22 Nov session only.
   - No interview was held (Table 8).
   - All four are NUS undergraduates; programme and year are left out of Table 9.
   - Participants were asked to use the app for a day or two. Each got the study copy and a short
     demonstration video, and no coaching.
   - 5.5: Lucas reviewed the findings; the coding was not repeated by hand.
   - The pilot found two problems. 6.5 says two; "too much to scan" is reported as feedback.
   - 6.5 keeps "4 of 28 too strict", with the caveat that the audit was by AI readers working
     from a reconstructed answer.
   - 6.4 keeps "apparently to see the model answer" (S03), and 6.5 keeps the point about reading
     the solutions in another window. Both stay hedged.
   - Appendix Z holds the ten categories and all 38 units (appendix-z-feedback-coding.md).

3. Vetting (23 Nov, by question and answer). Lucas approved the quoted and paraphrased feedback
   for the shared repo; cut the "not recently taught" framing (5.3, 6.1, 6.2, 6.6, Table 9) and
   kept the naming-fault row of Table 16; active minutes are all logged minutes (S03 193, of which
   160 in the three sittings). Lucas vetted the file on 23 Nov, and it and Appendix Z were committed then. Feedback units
   quoted or paraphrased here (numbers as in Appendix Z): 27 and 28 (S01); 15, 20 and 24 (S04);
   13 (S03, relayed); 3 and 4 (users, relayed); 36 (S02, in app). Everything else in 6.4 is
   counts or a summary of several units.

4. Where each number comes from: docs/group/field-results.md (S01 §5, S02 §6, S03 §4, S04 §2,
   totals §7). The feedback coding is Appendix Z, which reproduces section 4 of
   reports/field-study-analysis-v1.local.pdf. The three expectations:
   docs/group/final-report-outline.md §8.3.

5. Still to check before submission.
   - For the agent editing file 02: section 4.5 says the fix of 19 Nov "means that the build was
     not identical for every participant, which Section 5 states". Section 5 states that the
     build changed during the study and that every analysed session began after the change.
     Suggested wording for 4.5: "the fix of 19 Nov means that the build changed during the study,
     which Section 5 states". Section 4.5 can keep "two problems"; Table 6's reason "Pilot: too
     much to scan" then needs another source, such as "Team testing".
   - 5.3: "each needed a Mac and to have used AI for coursework this semester" is the recruitment
     rule in field-study.md. Valerie to confirm it was applied.
   - Appendix W (the consent notice and the log events) is a new letter and has no file yet.
   - New reference: Fetters, M. D., Curry, L. A., & Creswell, J. W. (2013). Achieving
     integration in mixed methods designs. Health Services Research, 48(6pt2), 2134–2156. Baker et
     al. (2004) is already cited in section 2.

6. Not used, on purpose: per-turn ICAP counts (the coding is thin and unchecked); the comparison
   of spend; the time to a reply. "What we would change" is left for Section 7.
-->
