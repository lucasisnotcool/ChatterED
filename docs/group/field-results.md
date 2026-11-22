# Field study: results as the exports come in

**Status.** Working record, 23 Nov 2026, for Lucas and Valerie. It holds what each research export
shows, measured the way `final-report-outline.md` §6.2 defines the research questions. Four exports
are in, from study copies 01, 03 and 04 (twice). One more is expected. The coding below is by one
AI coder and has not been checked by a person. Interviews are not in yet.

**What is committed and what is not.** This file holds counts, times, part ids, the AI's replies and
a few short lines the participants typed. The exports themselves are raw research data and stay
outside the repo, on Lucas's Mac.

**One export is one person** (Lucas, 23 Nov). Participants are told apart by the export's
participant id, not by the study copy number: a copy number can appear on more than one person's
export. A new export is never merged with an earlier one because the copy number matches.

## 0. At a glance

- **Three people used the app on a tutorial of their own; a fourth could not get an exam paper to
  import.** S03 worked through a whole five-part sheet in three sittings over two days (160 active
  minutes). S01 worked through a whole five-part sheet in one hour. S04 tried three parts in 16
  minutes (§6).
- **Check answer is the control people used: 25 checks, against 6 hints, 3 refreshers and 4
  reveals.** No one reached the third hint level. The feedback after a check names one flaw and
  asks one question, so in practice it did the work the hint ladder was built for.
- **RQ1, as counts:** 4 of 9 help requests came with an attempt in the slot. Split by button, that
  is 4 of 6 hints and 0 of 3 refreshers. 8 of the 13 parts touched began with the student typing.
- **RQ2 splits by person, not by part.** 9 parts got a first verdict short of "complete". S03
  repaired all 5 of theirs by checking again. S01 pressed Show answer on all 3 of theirs. S04 left
  their 1.
- **The best material is two episodes from S03** (§4.4): a part repaired after two "not yet"
  verdicts and an angry message, and an eight-turn exchange in which the student built a hard answer
  step by step in the thread.
- **The AI kept to the design in 62 of 62 replies on the two points we can count:** none gave a
  part's answer before a reveal or a "complete", and none ran over 400 words (longest 192). 22 ran
  over the app's own shorter limits, by 1 to 32 words.
- **Faults the report should own** (§2.6, §4.5, §5.4): the agents call the tutorial sheet "the
  lecture", "the deck" or "the slide" (in 36 of 55 replies in the two new exports); Ellie's private
  chat describes a "group" that is not there; S03's solutions file was not used for the answer key
  until two and a half hours in; and the app turned that solutions file into a notes page that
  states the answers.

## 1. How these numbers are made

```sh
python3 -I tools/field-metrics.py <unzipped export folder>
```

The script reads one export and prints sizes, counts and times only. Every number in the measures
tables is its output; I then read each transcript by hand for the timelines, the coding and the
fidelity checks.

| Export | Study copy | Installed and exported (UTC) | macOS (Darwin) | Called here |
|---|---|---|---|---|
| `P-8a12c48b` | 01 | 20 Nov, 07:14 to 08:17 | 24.6 | **S01** |
| `P-67b070b4` | 03 | 20 Nov, 06:27 to 22 Nov, 15:54 | 27.0 | **S03** |
| `P-3b69844c` | 04 | 22 Nov, 03:10 to 03:26 | 25.2 | **S04** |
| `P-a6b72eca` | 04 | 18 Nov, 08:45 to 09:59 | 24.4 | **slot 04, 18 Nov** |

The app makes a new random participant id on each install. The two copy-04 exports are treated as
two people: the Macs run different macOS versions, the sheets come from different modules and
years, and Lucas has said each export is a separate user. Valerie to confirm (§8).

Singapore time is UTC + 8, so S01 and S03 both began on the afternoon of 20 Nov.

## 2. S04: one sitting, 16 minutes (22 Nov)

### 2.1 What S04 worked on

One sheet: a five-page discussion sheet on graph search from a second-year data structures module,
dated March. The app read it in 70 seconds into 14 parts. No lecture and no solutions were added.
For 6 of the 14 parts the app marked its own answer key as low confidence, because a second pass
disagreed with the first.

### 2.2 Measures

| Measure | Value |
|---|---|
| App launches | 1 |
| First launch to export | 16.3 min |
| Active minutes (`app.active`) | 15 |
| Parts touched | 3 of 14 (1.a, 1.b, 4.a) |
| Help requests (Hint or Refresher) | 4 |
| **RQ1: help requests with an attempt in the slot** | **2 of 4** (both on 1.a) |
| Parts where the first action was typing an attempt | 1 of 3 (1.a) |
| Typed replies in a question's thread | 1 (31 characters) |
| Checks | 1 (4.a: "not yet", judged by the model, key marked low confidence) |
| **RQ2: after the first "not yet"** | **left** (1 of 1); no hint, no second check, no Show answer |
| Show answer | 0 |
| Lecture links opened | 0 (none existed) |
| Source PDF opened | 1, for 6 seconds |
| AI replies | 7: Max 5, Ellie 1, Ellie private chat 1 |
| AI reply length | 73 to 173 words; 0 over 400 |
| Spend | $0.26, of which $0.17 was reading the sheet |

### 2.3 What happened, minute by minute

Times are minutes and seconds from first launch.

| Time | S04 | The app |
|---|---|---|
| 0:22 | Agrees to the trial notice | |
| 0:37 | Adds the sheet | Reads it by 1:48 |
| 3:34 | Starts typing in 1.a | |
| 4:11 | **Hint** on 1.a with 65 characters in the slot | Max, rung 1 (Point), 74 words |
| 6:10 | Replies in the thread, 31 characters | Max confirms the step and asks the next one, 97 words |
| 7:15 | Opens the source PDF for 6 seconds | |
| 8:13 | **Hint** on 1.a again; slot unchanged | Max, rung 2 (Break it down), three sub-questions, at 8:19 |
| 8:28 | **Hint** on 1.b, slot empty, 9 seconds after the rung 2 reply | Max, rung 1, 73 words |
| 10:47 | Asks Ellie in the private chat how she differs from Max | Ellie, 173 words |
| 12:22 | **Refresher** on 4.a, slot empty | Ellie, two terms and an example, 148 words |
| 12:47 | 28 characters in 4.a are first saved | |
| 12:50 | **Check** on 4.a, about 4 seconds later | "Not yet", Max, 101 words |
| 16:19 | Exports | |

How to read it: the attempt came first once, on the first part. After that S04 moved on within
seconds of each reply and asked for help on an empty slot twice. Nine seconds is not enough to work
through three sub-questions, so rung 2 was asked for and not used. This looks like someone trying
each button in turn, not someone revising, and S04's sheet is from an old module. The interview
should ask which it was.

### 2.4 What S04 typed, coded

Four typed turns in all. The ICAP codes are provisional and need a human check.

| Where | Text | Code | Why |
|---|---|---|---|
| 1.a slot | "These parent edges are only visited once and do not form a cycle." | Constructive | An explanation in S04's own words. The reason is wrong, and Max used it |
| 1.a thread | "A node can only get one parent." | Constructive (Interactive if the code book counts a reply that builds on the AI's question) | A new inference, made from Max's pointer |
| 4.a slot | "I would model it in a graph." | Token attempt (Active at most) | Restates the question. Checked about 4 seconds after the text was first saved |
| Private chat | "Hi, what is the difference between you and Max?" | Off task, about the system | See §2.6 |

Two things the measures must allow for:

- **The repair on 1.a happened in the chat, not in the slot.** The slot still holds the first
  wording. A measure that looks only at slot text would miss S04's best turn, so `tutorial.reply`
  counts as learner production.
- **1.a was never checked**, so its status is still "untried" although it got the most work. RQ2 as
  defined (what follows a "not yet") says nothing about a part the student never checks. Report
  such parts as their own end state: worked on, not checked.

### 2.5 The hint example the teaching team asked for

Real replies from this session, on part 1.a ("Explain why these parent edges form a tree").

**Rung 1, Point** (S04's slot said the edges are "only visited once"):

> The lecture doesn't work this one through, so the material is the sheet's own wording on p. 1,
> Problem 1.a. It says the parent pointer marks "the very first time that a node was visited".
>
> Your answer says the edges are "only visited once". Look at that phrase on p. 1 again: when a node
> gets its parent, which node is being given the pointer, and how many times can that happen to it?

**Rung 2, Break it down:**

> Here are three smaller questions, using the sheet's phrase "the very first time that a node was
> visited" (p. 1):
>
> 1. When $v$ is given $u$ as its parent, how do $u$ and $v$ compare in the order they were first
>    visited?
> 2. Start at any node and follow parent pointers repeatedly. Does each step go to a node first
>    visited earlier or later than the one you just left?
> 3. Given your answer to 2, could that walk ever come back to a node it has already passed? Where
>    must it end?

Why this is a fair example of "a step, not the answer": rung 1 quotes the student's own wording and
asks one question about it; rung 2 lays out the path of the proof as questions and states none of
the conclusions. S04 got one step from rung 1 ("A node can only get one parent"). Rung 3, a worked
step, was not reached.

### 2.6 Did the AI behave as designed? (fidelity check)

| Check | Result in 7 replies |
|---|---|
| Gave the answer away | 0 |
| Hint rungs did different jobs | Yes: rung 1 pointed at one phrase; rung 2 split the proof into three questions |
| Used the student's attempt when there was one | Yes, both times (quoted "only visited once") |
| Refresher stayed off the answer | Yes: defined two terms, gave an example it labelled as its own |
| Feedback said what the check rested on | Yes: "The check was against a key that a second pass disagreed with, so the official solution may differ" |
| Length | 73 to 173 words. Two replies ran 1 and 18 words over the app's own ceilings |
| Verdict right | The one verdict ("not yet" for "I would model it in a graph") is right by my reading |

**Three faults.**

1. **Hints refer to a lecture that was never added.** Two of three hints open by saying the
   lecture "doesn't work this one through" or "doesn't work it through", and the Refresher says
   "the lecture doesn't define it". With no
   lecture attached there is nothing to point at, so rung 1 can only send the student back to the
   question's own wording, which it did in all three hints. On an unlinked sheet, "Point" becomes
   "read the question again".
2. **Ellie's private chat describes the wrong product.** Asked how she differs from Max, Ellie said
   she is "a read-only side session", that Max is "the tester in the group", that what the student
   says to him "is public to the group", and that nothing said to her "reaches Max unless you send
   it". That is the earlier group-chat design. The tutorial workspace has no group. A student who
   asks the app to explain its two agents gets an explanation that makes them harder to understand.
3. **No solutions, so the key was the model's own.** The check on 4.a ran against a key the app
   wrote and had itself marked as disputed. The reply said so, which is the design working. But
   the student cannot see the key, or any sign of which parts have a disputed one, before checking.

None of these can be fixed now: the app is frozen for submission. They go in the report as
limitations and as "what we would change".

## 3. Slot 04, 18 Nov: the import failed and nothing was attempted

| Measure | Value |
|---|---|
| App launches | 2 |
| First launch to export | 74 min |
| Active minutes | 17 |
| Files added | A 35-page first-year programming practice exam, its 13-page solutions, and a 4-page first-year maths tutorial |
| Exam paper import | Failed 3 times: "the model found no part to answer" (about 105 s each) |
| Solutions file | First read as a sheet of its own (2 parts), then marked as the paper's solutions |
| Maths tutorial | Read into 18 parts on the second launch |
| Help requests, checks, typed answers, AI replies | 0 |
| Source PDF opened | 6 times |
| Spend | $1.03 |

This is the failure recorded in issue #72 and fixed on 19 Nov. What the export adds: the
participant tried the import three times over an hour, then loaded a tutorial, looked at it for a
few minutes, and stopped without typing anything. The study's first real session produced no
learning interaction at all, and the cause was ours.

## 4. S03: a whole tutorial over two days (20 to 21 Nov)

### 4.1 What S03 worked on

One sheet: a two-page tutorial on relational algebra from a second-year database module, read in
26 seconds into 5 parts. S03 also added the tutor's four-page solutions, four seconds after the
sheet. No lecture was added. S03 told Max in the first minutes that they had not studied the topic.

### 4.2 Measures

| Measure | Value |
|---|---|
| App launches | 1; the app was left open for two and a half days |
| Working sittings | 3: 20 Nov 14:27 to 15:02, 20 Nov 16:00 to 18:10, 21 Nov 16:41 to 18:01 (Singapore time) |
| Active minutes | 160 in the three sittings (24, 90, 46). The log has 33 more, scattered, with no study event in them |
| Parts touched | 5 of 5 |
| Parts ended "complete" by a check | 5 of 5, after 2, 4, 2, 6 and 2 checks |
| Help requests (Hint or Refresher) | 4: two hints on 1(b), a Refresher on 1(a) and on 3 |
| **RQ1: help requests with an attempt in the slot** | **2 of 4.** Both hints had text; the first was a 13-character fragment that Max read as left over from 1(a). Both Refreshers were pressed on an empty slot, as the first action on the part |
| Parts where the first action was typing an attempt | 3 of 5 |
| Highest hint level | 2 of 3 |
| Checks | 16: 5 complete, 8 "partly there", 3 "not yet" |
| **RQ2: after a first verdict short of complete** | **Repaired, 5 of 5.** None revealed first, none left |
| Show answer | 1, on 1(b), three minutes after the check had said "complete" |
| Typed turns | 18: 16 in parts' threads (7 to 596 characters), 2 to Ellie in the notebook chat |
| Source PDF opened | 3 times |
| AI replies | 39: Max 35 (75 to 141 words), Ellie 4 (136 to 192) |
| AI reply length | 0 over 400 words; 18 over the app's own limits, by 1 to 32 words |
| Time to a reply | 2.5 to 12.3 seconds, about 7 in the middle |
| Spend | $1.21 |

### 4.3 What happened

Singapore time.

| When | S03 | The app |
|---|---|---|
| 20 Nov 14:32 | Adds the sheet, then the solutions | Reads the sheet into 5 parts |
| 14:33 | **Refresher** on 1(a), slot empty | Ellie: selection and projection, with her own example |
| 14:35 to 14:37 | Asks in the thread whether to write SQL or relational algebra, says they have not studied it, asks what π and σ are | Max explains the two operators, with an example from another setting |
| 14:39, 14:41 | **Check** 1(a) twice | "Partly there" (the School of Computing condition is missing), then "complete" |
| 16:00 | **Hint** on 1(b), 13 characters in the slot | Level 1: two paragraphs to read, and a note that the slot text looks left over from 1(a) |
| 16:24 | Asks Ellie which operators are needed beyond π and σ | Ellie: joins, with her own example; sends the student back to the part for help with it |
| 16:29 | **Check** 1(b) | "Not yet": the wrong identifier, and "did not lend" is not expressed |
| 16:43 | **Hint** again | Level 2: three smaller questions |
| 16:46 | **Check** | "Not yet": a selection tests one row at a time, so it cannot say "no lending happened" |
| 16:47 | An angry message: never studied this, be clear what an expression should look like | Max gives the general shape with an example from another setting, then asks for one piece only |
| 16:48 | "hello??", 23 seconds after that reply was logged as finished | "I'm here, sorry for the wait", and a still smaller piece |
| 16:54, 16:56 | Writes the borrower expression in the thread, then the lender one, and proposes subtracting | Max confirms each and points to the set operations |
| 16:58 | **Check** twice, 43 seconds apart | "Partly there" (both sides of the minus are the same), then "complete" |
| 17:01 | **Show answer** on 1(b) | The model answer, opening "Your attempt already had this structure". The part's status becomes "revealed" |
| 17:07 | Asks Ellie for the set operations and their symbols | Ellie: the three, with a small example |
| 17:08 to 17:11 | **Check** 2(a) twice | "Partly there" (an alias out of scope), then "complete" |
| 17:13 to 17:19 | **Check** 2(b) six times, and asks once how Max read a symbol | "Not yet", four "partly there", then "complete". Each names one flaw: an alias, a redundant copy of a relation, "and" against "or", precedence, a bracket |
| 17:23 | **Refresher** on 3, slot empty | Ellie: "for all" as a double negation, built from cross product and set difference |
| 17:52 to 18:08 | Types 13 characters in 3; opens the Notes view three times, about 25 seconds in all | |
| 21 Nov 17:02 | Sends a SQL sketch of 3 to the thread of 1(b), then to the thread of 3 | Max confirms the shape, lists the fixes, and asks which relations the expression must bring together |
| 17:05 to 17:48 | Seven more typed turns on 3 (49 to 596 characters) | Seven replies, each ending in a question |
| 17:53, 17:59 | **Check** 3 twice | "Partly there" (names missing from the output; nothing ties a loan to a book), then "complete" |
| 22 Nov 23:54 | Exports | |

### 4.4 Two episodes worth telling

**1(b): repaired after two "not yet" verdicts and a loss of patience.** After level 2 and a second
"not yet", S03 swore at Max, said "i never study this topic" and asked him to "be clear what a
relational algebra expression should look like". Max did not give the answer and did not repeat the
question. He wrote:

> Fair enough, you haven't been taught this, so here is the shape. An expression is built from
> relations, with operators wrapped around them: […] Try writing just the "borrowed on the day they
> joined" relation, using email as the identifier.

Six minutes later S03 typed that one piece into the thread, then the second piece, then proposed
"set theory and minus them". Two checks later the part was complete. This is the path RQ2 hoped to
see, and it ran through the thread: the answer was built in two typed turns before it went into
the slot.

**3: a hard answer built in conversation.** S03 could write the query in SQL but could not see how
to say "all" in relational algebra. Over eight typed turns they proposed a plan, tested a wrong
condition, and got stuck ("im cooked"). Max's replies each took one of S03's own ideas and asked one
question about it. The turn that unlocked it was Max's:

> So you have one set of all possible pairs and one set of pairs that happened. What would a pair in
> the first set but not in the second tell you about that student?

S03 then wrote the whole plan in words, and the slot answer two checks later was correct. How to
read it: Max never wrote the expression, but that question hands over the central idea. A strict
reader would say Max led; a tutor would call it a prompt. The transcript supports both, and the
report should show the exchange and say so.

**Coding of the 18 typed turns (provisional).**

| Kind | Turns | ICAP reading |
|---|---|---|
| Own reasoning, or a piece of the answer, typed in the thread | 11 (one message was sent to two threads) | Constructive; most of them answer Max's last question, so Interactive if the code book allows it |
| A request to be taught, in the student's own words | 5 | Help-seeking. None is a button press, so RQ1's count misses them |
| About the system | 2 ("hello??", and how Max read a symbol) | Off task |

### 4.5 Did the AI behave as designed?

| Check | Result in 39 replies |
|---|---|
| Gave a part's answer before "complete" or a reveal | 0 |
| Verdicts | The 5 "complete" verdicts are right in substance by my reading of the final slots. The last one on 2(b) passed an answer with unbalanced brackets, and said so |
| Check feedback | Each of the 11 verdicts short of complete named a real flaw and ended with one question |
| Hint levels did different jobs | Yes: level 1 named two paragraphs; level 2 gave three steps. The third step ("Which set operation… combines your two groups?") comes close to the structure of the answer |
| Refresher stayed off the answer | Partly. The one on 3 names the two operators the answer is built from |
| Response to frustration | Changed approach: a general pattern, then a smaller step. No answer, no lecture |
| "In your own words" question after a part was done | Asked 3 times, answered 0 times |
| Length | 75 to 192 words; 18 of 39 over the app's own limits |

**Faults.**

1. **The sheet is called "the slide", "the lecture" or "the deck"** in 26 of 39 replies ("The slide
   doesn't define them"). This is the fault in §2.6, on a third person's sheet.
2. **The solutions were added at the start and not used until two and a half hours later.** The
   file went in four seconds after the sheet, while the sheet was being read. The checks on 1(a) and
   1(b) ran against keys the model wrote. The app read the solutions into the keys only at 16:59 on
   the first day; 2(a), 2(b) and 3 were checked against them.
3. **The app turned the solutions into a notes page.** At 16:59 the solutions file was switched to
   "lecture" for 11 seconds and back. In that time the app wrote summary notes from it, and the page
   stayed in the Notes view. It states the method for 1(b), the final condition for 2(b), and a
   four-step outline of 3. S03 opened the Notes view three times, for about 25 seconds in all, an
   hour later, while stuck on 3. The next day's eight turns do not read like someone working from an
   outline, but the log cannot settle it. Ask in the interview. In any case S03 had the solutions
   file itself: an unsupervised study cannot know what a participant looks at outside the app.
4. **A part that was checked "complete" lost its progress when S03 then pressed Show answer.** The
   status went from correct to "revealed", which fills nothing. The app warns before a reveal, and
   the rule is the designed one, but here the student had already earned the part and wanted to
   compare. The final status table says 4 correct and 1 revealed for someone who completed all 5.
5. **The lines the app writes under a part are worded for the system**, not the student: "Checked:
   correct. The learner's answer is correct in substance", "The structure matches the key".
6. **"Sorry for the wait"** answered a "hello??" sent 23 seconds after the previous reply was logged
   as finished. Either the reply was not on screen, or S03 was reacting to getting another question.
   Ask.

## 5. S01: a whole tutorial in one hour (20 Nov)

### 5.1 What S01 worked on

One sheet: a two-page tutorial on reinforcement learning, read in 35 seconds into 5 parts. Two
files were chosen and the app refused one; the log does not say which or why. No lecture and no
solutions were in the notebook, so every key was the model's own, and 3 of the 5 were marked low
confidence.

### 5.2 Measures

| Measure | Value |
|---|---|
| App launches | 1 |
| First launch to export | 63 min |
| Active minutes | 29 |
| Parts touched | 5 of 5 |
| Parts where the first action was typing an attempt | 4 of 5 |
| Help requests (Hint or Refresher) | 1: a level 1 hint on 1(b) |
| **RQ1: help requests with an attempt in the slot** | **0 of 1** |
| Checks | 8: 2 complete at the first check, 5 "partly there", 1 "not yet". 5 of the 8 ran against a low-confidence key |
| **RQ2: after a first verdict short of complete** | **Revealed, 3 of 3**, after 3, 1 and 2 checks |
| Show answer | 3, each with the student's attempt in the slot (116, 84 and 199 characters), pressed 23 to 64 seconds after the last Check, so within a minute of reading its feedback |
| Typed turns | 4, all in parts' threads (35 to 173 characters) |
| AI replies | 16, all Max, 72 to 137 words; 0 over 400; 2 over the app's own limits |
| Spend | $0.39 |

### 5.3 What happened

Times are minutes and seconds from first launch (15:14 Singapore time).

| Time | S01 | The app |
|---|---|---|
| 0:29 | Adds the sheet | Reads it by 1:05 |
| 14:20 | **Check** 1(a), a one-letter answer | "Complete" |
| 16:43 | **Hint** on 1(b), slot empty | Level 1: where the facts are, and one question |
| 20:04, 21:11, 23:28 | **Check** 1(b) three times, the answer growing from 101 to 116 characters | "Partly there" each time. Each names what is now right and the one thing still open |
| 23:51 | **Show answer** | The worked answer, opening "Your counts and your equation were already right. What was missing was…" |
| 24:50 | Answers Max's "in one line of your own" question | Max corrects the wording |
| 26:52 | **Check** 1(c) | "Partly there": the first update is right, one term in the second is wrong |
| 27:56 | **Show answer** | The worked answer |
| 29:08, 29:40 | Answers the "own line" question, then rewrites the corrected expression | Max confirms it |
| 37:43 | **Check** 2 | "Complete", with a note that one of the four values looks wrong |
| 43:26 | Explains in 173 characters why the update uses the best next value | Max confirms, and points back at the wrong value |
| 44 to 59 | Nothing logged | |
| 60:33, 61:34 | **Check** 3 twice, the answer growing from 82 to 199 characters | "Not yet" (a template, not the equations), then "partly there" (one derivative wrong) |
| 62:20 | **Show answer** | The worked answer |
| 63:00 | Exports | |

How to read it: S01 attempted first on four of five parts and revised after feedback on two of the
three that were not right. But each time one step was left, S01 took the answer, within about a
minute. On 1(b) the last feedback asked one question ("What does that tell you about the value of
U(B)?") and S01 pressed Show answer 23 seconds after pressing Check, so within about 15 seconds of the reply. This is the reveal "after real work" that the
design accepts. It is not a repair.

**What happened after a reveal.** Max ends a reveal with a question to answer in the student's own
words. S01 answered it on 1(b) and 1(c), and on 1(c) went on to redo the calculation. The third
reveal came 40 seconds before the export. Counting the same question after the "complete" on part
2, S01 answered 3 of 4. All four of S01's typed turns are of this kind: explanations in their own
words (Constructive), and all four are answers to a question Max asked.

### 5.4 Did the AI behave as designed?

| Check | Result in 16 replies |
|---|---|
| Gave a part's answer before a reveal | 0 in the 9 replies before one |
| Reveal used the attempt | Yes, 3 of 3: each opens with what the student already had right |
| Said what the check rested on | Yes: every check, reveal and follow-up on a part with a low-confidence key said "the official solution may differ" (11 replies) |
| Verdicts | 1(a), 1(b) and 3 are right by my reading of the final slots. I could not judge 1(c) (the slot was empty at export) or the value Max called wrong in 2 (the sheet is not in the export) |
| Length | 72 to 137 words |

**Faults.** The sheet is called "the deck" or "the lecture" in 10 of 16 replies ("The deck doesn't
cover the utility equation"). And with no solutions, a part can be marked "complete" against a key
the app itself doubts: part 2 was.

## 6. Across the exports

### 6.1 Per person

| | S01 | S03 | S04 | Slot 04, 18 Nov |
|---|---|---|---|---|
| Sittings | 1 | 3 over two days | 1 | 2 launches |
| Active minutes | 29 | 160 | 15 | 17 |
| Material | Tutorial on reinforcement learning; no solutions | Tutorial on relational algebra; solutions added | Discussion sheet on graph search, from an old module; no solutions | Exam paper (import failed), then a maths tutorial |
| Parts touched | 5 of 5 | 5 of 5 | 3 of 14 | 0 |
| First action on a part was typing | 4 of 5 | 3 of 5 | 1 of 3 | – |
| Hints, by highest level | 1 (level 1) | 2 (level 2) | 3 (level 2) | 0 |
| Refreshers | 0 | 2 | 1 | 0 |
| **RQ1: Hint or Refresher with an attempt in the slot** | 0 of 1 | 2 of 4 | 2 of 4 | – |
| Checks | 8 | 16 | 1 | 0 |
| Parts complete by a check | 2 | 5 | 0 | – |
| **RQ2: first verdict short of complete, then…** | revealed 3 of 3 | repaired 5 of 5 | left 1 of 1 | – |
| Show answer | 3 | 1, after "complete" | 0 | 0 |
| Typed turns in chat | 4 | 18 | 2 | 0 |
| AI replies (longest, in words) | 16 (137) | 39 (192) | 7 (173) | 0 |
| Spend | $0.39 | $1.21 | $0.26 | $1.03 |

### 6.2 Totals, as counts

These add three people who used the app differently. They are counts, not rates.

| | Count |
|---|---|
| Parts touched | 13 |
| Parts that began with the student typing | 8 of 13 (2 began with a hint, 3 with a Refresher) |
| Hints with an attempt in the slot | 4 of 6 |
| Refreshers with an attempt in the slot | 0 of 3 |
| Checks | 25 |
| Parts with a first verdict short of complete | 9: repaired 5, revealed 3, left 1 |
| Parts worked on and never checked | 2 (both S04) |
| Third hint level reached | 0 times |
| AI replies | 62; 0 gave a part's answer before a reveal or a "complete"; 0 over 400 words; 22 over the app's own limits |

## 7. What this means for the report

1. **The field phase can now be described as planned for one person and shorter for two.** S03
   used the app over two days on current work; S01 and S04 used it once. Write it as unsupervised
   use on the participant's own tutorial, one to three sittings, and give each person's use in a
   table. The "first-use trial" fallback is no longer needed for the whole phase; it still
   describes S04.
2. **Report cases and counts, and report by person.** The RQ2 result is the clearest example:
   5 repaired, 3 revealed, 1 left looks like a spread, and it is in fact three people each doing
   one thing. Do not set the counts beside the 0 of 31 from the chat logs as if both were rates.
3. **Check answer was the main channel, and the hint ladder was barely used.** This is a finding
   about the design: students preferred to put something in the slot and be told what was wrong
   with it. It supports "the attempt comes first" more directly than the RQ1 count does, and it
   means the three-level ladder is not what carried the sessions.
4. **Split RQ1 by button.** All three Refreshers were pressed on an empty slot before trying, which
   is what a Refresher is for. Hints came with an attempt 4 times in 6.
5. **Typed help requests are outside RQ1.** S03 asked to be taught five times by typing. A count of
   button presses misses them, and so understates how much S03 leaned on the AI before trying.
6. **The thread is where the work happened.** S03's two hardest parts were built in typed turns
   before the slot was filled, and S04's one repair was typed there too. This is the evidence for
   "why a conversational interface" in the introduction.
7. **Two people did not use the tutorial the way the design assumes.** S03 had not studied the
   topic and used the app to learn it from the sheet. S04 used an old module's sheet. Only S01
   looks like practice on material already taught. Ask each of them.
8. **The fidelity check carries weight, and it has limits.** 62 replies, none gave an answer early
   and none was long. But one coder read them, that coder is an AI, and the hardest call (how much
   Max led on S03's part 3) is a judgement.
9. **The faults go in as limitations and as "what we would change".** The naming fault is now on
   three people's sheets. The two new ones (solutions not used at first; solutions turned into a
   notes page) bear directly on the trust and over-reliance arguments.
10. **The 18 Nov session belongs in the report**, in the account of what went wrong and what was
    changed during the study. The build was not frozen across the study, which the workshop asks
    us to state.
11. **Interviews now have specific moments to cue**: S03's angry message and what changed after it;
    S03's reveal after "complete"; S03's visits to the Notes view; S01's three reveals with one
    step left; S04's nine seconds on a level 2 hint.

## 8. To settle

- **Who is who.** Each export is treated as one person (Lucas, 23 Nov). That makes the two copy-04
  exports two people, so the 18 Nov participant needs a code of their own. Valerie to confirm, and
  to give each person's programme and year for the participant table.
- **The fifth export**, when it arrives, is a new person whatever copy number it carries.
- **Which build each person ran.** The export records version 0.1.0 and no build number. S01 and
  S03 installed on 20 Nov, after the long-paper fix of 19 Nov; the 18 Nov session was before it.
- **Was it revision, catching up, or trying the app out?** S03 had not studied the topic; S04's
  sheet is from an old module. Ask each person before describing any session as revision.
- **S03 and the Notes view** (§4.5, fault 3): what they saw there on the first evening.
- **Which file S01's notebook refused**, if S01 remembers. It may have been a lecture or solutions.
- **A second coder** for the typed turns (§2.4, §4.4, §5.3) and the fidelity checks. A person
  should at least read S03's part 3 exchange and decide how to describe Max's part in it.

## 9. Traps in the export, for whoever analyses the next one

- The study events are JSON lines in `logs/main.log`. Select them by `event`. On `tutorial.help`
  the `level` field holds the hint rung (0, 1, 2, 3), not the log level.
- `readable/events.jsonl` has the same help requests as `flow.tutorial_help`, with `answer_chars`.
  There, a typed reply (`kind: reply`) and a check (`kind: feedback`) look like help requests. They
  are not.
- `tutorial.text_started` gives the size of the slot when typing was first logged, not the final
  size. The final text is in `readable/notes/*.json`, in the `tut_answer` nodes.
- A part's `status` stays `untried` until it is checked, however much help was asked on it.
- The export's file name carries the date on the participant's Mac, which can differ from the UTC
  date inside it.
- The answer keys are removed from the export, so a verdict can be judged only from the question,
  the answer and the AI's reply.
- A reveal after a "complete" check sets the part's `status` to `revealed`. Read the order of events
  in the log, not the final status, to tell a repair from a reveal. (The first version of the
  script also looked for the verdict "correct"; the log writes "complete".)
- `app.active` counts minutes with the window in use, including stray minutes hours away from any
  study event. For a session left open for days, total the minutes inside the working sittings.
- Typed turns in the notebook chat or a private chat are not in `tutorial.reply`. Count them from
  the transcript (`typed_turns_outside_parts` in the script).
- Files in the notebook, their roles, and when the solutions were read into the keys are in
  `notebook.source_role` and `tutorial.solutions`. A check's `key_from` says which key it used.
- `readable/notes/` can hold a second document, the Summary notes, besides the tutorial itself.
