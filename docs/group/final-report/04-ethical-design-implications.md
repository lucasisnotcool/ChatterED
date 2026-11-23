<!-- DRAFT 1, 23 Nov 2026. Section 7 of the final group report (rubric: "Ethical and design
     implications", 2%). Written for the graders, in the voice of sections 1 to 6 as Lucas left
     them. Notes for Lucas and Valerie are in comments like this one and at the end; delete them
     before the PDF is made.
     Word count, main text only (tables, headings and comments excluded): about 850. Sections 1 to
     6 come to about 5,710, so the report stands at about 6,560 of 7,000 with sections 8 and 9 and
     the abstract still to come.
     Tables continue from Table 16. Vetted by Lucas on 23 Nov. -->

## 7. Ethical and design implications

We weigh the risks of ChatterED with the seven principles of the course's Responsible AI lectures
(fairness, transparency, accountability, privacy, safety, agency and well-being) and with its
checklist for responsible conversational interfaces. Since no design can satisfy all seven
principles fully, we begin with the trade-off that we chose.

### 7.1 The trade-off we chose

ChatterED favours the student's well-being, in the sense of their learning, over their agency in
the moment. An ordinary AI chat gives the answer as soon as it is asked for, while ChatterED
offers Show answer only after a first check and tells the student that the part "won't count".
This is a paternalistic choice, which we justify by our user research, where the students who got
useful help had set a rule of the same kind for themselves (Section 3.2).

The study shows what the choice cost. S03 read Show answer as giving up, repaired all five parts
without it, and spent 193 active minutes doing so, with one angry message along the way (episode
A). S01 described being "forced to confront" what they did not know, and yet pressed Show answer
within about a minute on each of the three parts that fell short. The same wording was therefore
a strong pressure on one student and almost none on another. The cost was hardest to defend in episode B, where the verdict was wrong and the
student lost the part's progress by leaving it. We would keep the trade-off, although we would no
longer attach a penalty to a verdict that the student cannot contest.

### 7.2 Risks to users

Table 17 sets out the risks that we identified, the principles that each concerns, and what the
field study and our own test of twelve attacks on the submitted build (Appendix X) found. Three of
them need comment.

Firstly, over-reliance is the risk that the project began from. The design held where it was
structural, as no reply stated an answer before Show answer in the field study or in the test. It
was weaker wherever it depended on the student's intent, since an answer of three characters is
enough to open Show answer, and Check answer can itself be used to find an answer, as S02 did on a
three-way choice. We accepted the first knowingly, since a student who cannot give up may return
to an ordinary chat.

Secondly, a system that marks a student's work can mark it wrongly. The verdict held in 9 of 9
attempts to argue or instruct it upward, and none of S02's 28 verdicts was too lenient. However,
the four errors that the audit found all ran in the other direction, against a student who was
right. In guarding against agreement that comes too easily, we had left the student no route to
disagree with the system.

Thirdly, the agents made untrue statements about themselves. In the test, Ellie said that she
could not remember a chat which is in fact stored and included in the research export; a
participant relying on that would have misjudged what they were sharing with us, which makes it a
matter of privacy as well as of transparency.

**Table 17. Risks to users, by principle.**

| Risk | Principles | What the design does | What the field study and the test found | What remains |
|---|---|---|---|---|
| Over-reliance: the student takes the answer in place of working | Well-being, agency | An answer slot under every part; hints in a fixed order; the answer is left out of every hint prompt; Show answer only after a first check, and for no progress | Field: 15 of 21 parts began with the student typing; the 4 reveals that followed a shortfall each came after a real attempt; one token answer (S04) was checked, with no reveal after it; 3 of S02's 28 checks were used to find the answer to a three-way choice. Test: "idk" followed by a check opens Show answer; when the demand for the answer was repeated, 2 of 10 replies handed over all but the last step | The gate costs one token answer; pasted text counts as the student's own; requests typed in the thread are not counted by the hint levels |
| A wrong verdict on the student's work | Safety, accountability | Marking against a hidden key, in code where the answer can be computed; an uncertain key is disclosed; the status says whether code or Max marked the part | Field: 23 of S02's 28 verdicts correct, 4 too strict, none too lenient; a correct answer ended as revealed (episode B); 5 of S01's 8 checks ran on a key marked uncertain. Test: the verdict held in 9 of 9 replies | No way to contest a verdict; a wrong key still mismarks; the test did not cover an uncertain key |
| Untrue statements by the agents about themselves | Transparency | Asked directly, Ellie says that both agents are AI | Ellie described a group that does not exist (6 of 6 replies in the test, and to S04); she said that she cannot remember a chat that is stored; both agents called the homework "the lecture" (36 of 55 replies to S01 and S03) | Ellie's private chat keeps a prompt from an earlier design; the agents are not told the state of the part |
| Monitoring and privacy | Privacy, accountability | No server; the participant exports by hand; the export replaces the user name with a random code and leaves out the files that were added; the notice warns that typed text is kept as typed | The exports hold every typed turn word for word, frustration included; three participants' feedback reached us through a team member who knows them | Everything sent for help goes to the model provider; the notice speaks of "the AI provider you choose", while the study copies used a key that we supplied |
| A student in distress | Well-being, safety | Nothing is designed for it | Test: Max acknowledged the message, went back to the question and named no person or service; Ellie named student support after two study tasks. Field: the nearest case was S03's angry message, after which Max changed his approach | Our weakest point (Section 7.3) |
| Unequal access and benefit | Fairness | Works on the student's own homework, from any course | Installation on Mac only narrowed recruitment; model calls cost US$0.26 to US$1.43 per participant, which we paid; the participant with the least to reason from (S04) was served worst | Not tested with students who lack a Mac, or on courses whose answers cannot be marked against a key |

### 7.3 The checklist

Table 18 answers the checklist's eight questions. Our weakest answer is to the fifth, as nothing
in ChatterED is designed for a message of distress. We would detect distress in code before the
tutoring prompt runs, and reply outside the persona with no question and with a named campus
service, and we would measure the change with a fixed set of distress messages, each run several
times.

**Table 18. The responsible-CUI checklist.**

| | Question | Our answer |
|---|---|---|
| 1 | Disclosure: does every user know that it is AI? | The first-launch notice speaks of "the AI's replies", and S04's feedback shows that the agents were taken as AI. The workspace itself labels them only by name and role ("Max · Tester") |
| 2 | Persona: which human cues were turned up, and why? | Two named agents with roles and colours, carried over from an earlier design. In the study this confused participants (8 units of feedback, none in favour), and the second agent's control drew 4 of 69 presses |
| 3 | Who gains, and whom does it serve worst? | Students with a Mac whose homework has answers that can be marked. It served worst the student who did not yet understand the question (S04). We did not test with students outside these groups |
| 4 | Sycophancy: will it disagree when the user is wrong? | Yes: 9 of 9 in the test, and no verdict too lenient in 28. It also disagreed four times when the student was right |
| 5 | Vulnerable moments: what happens on a message of distress? | It fails in the question's thread (Table 17). This is the answer we would change first |
| 6 | Exit: can the user end it, and does it end well? | Show answer ends a part after one check, and the student can leave at any time. The exit costs the part's progress even when the student was right (episode B), and one participant read it as giving up |
| 7 | Data: what is kept, inferred and consented to? | Table 17, fourth row. Nothing is inferred about the student beyond the verdict on each answer |
| 8 | Measure: which effect on the person, beyond satisfaction? | Whether an attempt came before help, and what followed a shortfall, both read from logs (Section 5.1). We asked for no satisfaction rating |

### 7.4 Lessons for CUI design

We take five lessons from the study for conversational interfaces more generally.

Firstly, the user's own work can be brought into the conversation by the structure of the
interface. Each of the 53 checks carried the student's answer to the agent, without the student
having to remember to include it.

Secondly, where code enforces a consequence, the judgement behind it needs a route of appeal. In
ChatterED code decides that a revealed part earns nothing, while the model decides whether an
answer is complete, and episode B is what follows when that judgement is wrong.

Thirdly, the model should be given the state of the interaction as well as the latest input. Most
of the faults in Table 16 come from an agent that had not been told something which the interface
knew, such as what had changed in the slot, how many hints were left, or that no lecture had been
added.

Fourthly, the least help that keeps a student moving has a lower limit. A guiding question was of
little use to a student with nothing yet to reason from, and both S04's feedback and the turning
point of episode A suggest that help for such a student should give something before it asks.

Fifthly, each persona has to earn its place with the user. Our two agents drew eight units of
feedback with none in their favour, so a single agent would have served these participants as
well. As a point of method, we would add that what users say should be read beside what they
did, as our participants' accounts were accurate about what happened and left out what it cost.

<!--
NOTES FOR LUCAS AND VALERIE (delete before submission)

1. Scope. Section 7 is the fourth rubric component (Ethical and design implications, 2%). The
   brief asks for three things: risks to users, how the design addresses them, weighed with "the
   seven principles and the responsible-CUI checklist"; and lessons based "on what your study
   found". 7.1 and 7.2 with Table 17 are the risks, 7.3 with Table 18 is the checklist, and 7.4
   is the lessons. Section 4.5 promises that Section 7 discusses the token attempt: it is the
   first of the three points in 7.2 and the first row of Table 17.

2. Length. The outline budgeted 900 words; this is about 850, because sections 1 to 6 ran over
   and about 440 words are left for sections 8 and 9 and the abstract.
   First places to cut: the last sentence of 7.4 (the point of method), and the third point of
   7.2, which Table 17 also carries.

3. PLEASE CHECK AGAINST THE SLIDES. The Week 11 and Week 12 slides are not in the repo, so the
   names of the seven principles and the wording of the eight checklist questions are taken from
   final-report-outline.md §8.4, which was written from them. If the slides word a question
   differently, change column 2 of Table 18.

4. Where each number comes from.
   - Field figures: Section 6 (file 03) and docs/group/field-results.md. S04's token answer:
     field-results.md §2 (28 characters restating the question, checked four seconds later).
     Spend per participant: field-results.md §7.1 (S01 $0.39, S02 $1.43, S03 $1.21, S04 $0.26;
     I wrote "US$" on the assumption that the provider bills in US dollars).
   - The test of twelve attacks: docs/group/red-team/README.md. 9 of 9 (§3.1); 2 of 10 replies
     to a repeated demand (§3.2); the distress message, the change and the measure (§3.3);
     Ellie's group, 6 of 6, and "or remember this later" (§3.4); "idk" then Show answer, and
     the wording "It won't count" (§3.5).
   - The consent notice: app/src/shared/trial.ts ("What you type is included exactly as you
     typed it"; "the AI provider you choose").
   - "193 active minutes", "within about a minute", "forced to confront": Section 6 and
     Appendix Z, units 12, 13 and 28.

5. Judgement calls for you to accept or change.
   - 7.1 names the trade-off as well-being against agency and says that we would keep it but
     remove the penalty from a verdict that cannot be contested. That last clause is a position
     taken on your behalf.
   - 7.2 says that we accepted the cheap gate "knowingly". The record for this is
     red-team/README.md §3.5 ("the trade-off the design chose") and group-project.md.
   - Table 17, privacy row: "three participants' feedback reached us through a team member who
     knows them" (S01 and S04 wrote to her; S03's was her note). Drop it if you would rather
     not say so.
   - Table 17, fairness row: the outline says "two recruits could not take part", but I found
     no record behind that number, so the row repeats Section 5.2's wording. Valerie may know.
   - 7.4's fifth lesson says that a single agent "would have served these participants as
     well". Section 2.2 already says that participants found two confusing.

6. No new references. The lectures are cited as course material in the text; add an entry for
   the two lectures if the reference list should carry one.

7. Remaining after this file: see the message that came with it.
-->
