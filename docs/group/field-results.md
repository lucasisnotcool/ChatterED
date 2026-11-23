# Field study: results as the exports come in

**Status.** Working record, 23 Nov 2026, for Lucas and Valerie. It holds what each research export
shows, measured the way `final-report-outline.md` §6.2 defines the research questions. Five exports
are in, from study copies 01, 02, 03 and 04 (twice), and no more are expected. The coding of S01,
S03 and S04 is by one AI coder; S02 was read by four (§6). None of it has been checked by a person.
Interviews are not in yet.

**What is committed and what is not.** This file holds counts, times, part ids, the AI's replies and
a few short lines the participants typed. The exports themselves are raw research data and stay
outside the repo, on Lucas's Mac.

**One export is one person** (Lucas, 23 Nov). Participants are told apart by the export's
participant id, not by the study copy number: a copy number can appear on more than one person's
export. A new export is never merged with an earlier one because the copy number matches.

## 0. At a glance

- **Four people used the app on a tutorial of their own choosing; a fifth could not get an exam
  paper to import.** S03 worked through a whole five-part sheet in three sittings over two days
  (160 active minutes). S02 worked eight of eleven parts in one evening (96). S01 worked through a
  whole five-part sheet in one hour. S04 tried three parts in 16 minutes (§7).
- **Check answer is the control people used: 53 checks, against 7 hints, 4 refreshers and 5
  reveals.** No one reached the third hint level. The feedback after a check names one flaw and
  asks one question, so in practice it did the work the hint ladder was built for.
- **RQ1, as counts:** 4 of 7 hints came with an attempt in the slot. Of the 4 Refreshers, 3 were
  pressed on an empty slot before trying and 1 on a part already complete. 15 of the 21 parts
  touched began with the student typing.
- **RQ2 splits mostly by person.** 14 parts got a first verdict short of "complete". S03 repaired
  all 5 of theirs and S02 4 of 5, by checking again. S01 pressed Show answer on all 3 of theirs.
  S04 left their 1. S02's one reveal came after Max had marked a right answer "partly there" (§6.4).
- **The best material is five episodes.** From S03 (§4.4): a part repaired after two "not yet"
  verdicts and an angry message, and an eight-turn exchange in which the student built a hard answer
  step by step in the thread. From S02 (§6.4): a right answer that ends as "revealed" because Max
  misread it; a sign found by trying all three; and a part repaired over ten checks, one factor at
  a time.
- **The AI and the design, over 109 replies:** none stated a part's answer before a reveal or a
  "complete", and none ran over 400 words (longest 192). 27 ran over the app's own shorter limits,
  by 1 to 32 words. S02's export was read more closely than the others, and there 2 replies handed
  over a step, 4 misdescribed the student's answer, and 4 of 28 verdicts were too strict (none too
  lenient).
- **Faults the report should own** (§2.6, §4.5, §5.4, §6.6): the agents call the tutorial sheet "the
  lecture", "the deck" or "the slide" (in 36 of 55 replies in S01 and S03); Ellie's private chat
  describes a "group" that is not there; S03's solutions file was not used for the answer key until
  two and a half hours in, and the app turned it into a notes page that states the answers; Max is
  not told what changed in the slot between checks, so it misread S02's answer and apologised for
  misreadings it had not made; a wrong "partly there" cannot be undone and the reveal then costs
  the credit; and when a file holds its own solutions, Max's page references point at them.

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
| `P-34e9da6f` | 02 | 21 Nov, 13:10 to 22 Nov, 16:01 | 23.6 | **S02** |
| `P-67b070b4` | 03 | 20 Nov, 06:27 to 22 Nov, 15:54 | 27.0 | **S03** |
| `P-3b69844c` | 04 | 22 Nov, 03:10 to 03:26 | 25.2 | **S04** |
| `P-a6b72eca` | 04 | 18 Nov, 08:45 to 09:59 | 24.4 | **slot 04, 18 Nov** |

Four study copies were built (01 to 04), and five exports came back: one from each copy, and a
second from copy 04. The app makes a new random participant id on each install. The two copy-04 exports are treated as
two people: the Macs run different macOS versions, the sheets come from different modules and
years, and Lucas has said each export is a separate user. Valerie to confirm (§9).

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

## 6. S02: eight parts in one evening, most of it by checking (22 Nov)

### 6.1 What S02 worked on

One file: a 13-page practice set on probability and counting from a public course, with the
questions on pages 1 and 2 and the worked solutions from page 3 on, in the same file. The app read
it in 41 seconds into 11 parts and marked one key (1(b)) low confidence, because its second solve
disagreed with the first. No lecture was added. The log labels every key as the model's own, but
Max's replies quote the solution pages throughout, so the model had the worked solutions in view.

### 6.2 Measures

| Measure | Value |
|---|---|
| App launches | 1 (installed 21 Nov, 21:10 Singapore time; left open) |
| First launch to export | 26 h 51 min |
| Active minutes | 96: 79 in the main sitting (22 Nov, 22:24 to 00:02), 9 around the first visit (20:20 to 21:04), 8 scattered earlier |
| Parts touched | 8 of 11 |
| Parts where the first action was typing an attempt | 7 of 8 (part 5 began with a hint) |
| Help requests (Hint or Refresher) | 2: a level 1 hint on 5, slot empty; a Refresher on 2(b), pressed nine minutes after that part was complete |
| **RQ1: help requests with an attempt in the slot** | **Hint 0 of 1.** The Refresher counts as 1 of 1 by the rule, but the slot held a finished answer, so it says nothing about attempting first |
| Checks | 28: 7 "complete", 10 "partly there", 11 "not yet". 1 ran against the low-confidence key |
| Parts complete at the first check | 3 of 8: 1(b), 3(a), 3(b) |
| **RQ2: after a first verdict short of complete** | **Repaired 4 of 5** (after 5, 2, 10 and 2 checks); **revealed 1 of 5** (part 4, after 6 checks) |
| Show answer | 1, on part 4, with 229 characters in the slot, 170 seconds after the last Check and 25 seconds after Max's last reply |
| Typed turns | 16: 15 in parts' threads (2 to 247 characters), 1 to Ellie in private |
| AI replies | 47: Max 45 (62 to 127 words), Ellie 2 (a Refresher of 142 words, a private reply of 93). 0 over 400; 5 over the app's own limits, by 3 to 15 words |
| Wait for a reply | 6 to 12 seconds from the press |
| Spend | $1.43 |

### 6.3 What happened

Times are Singapore time on 22 Nov.

| Time | S02 | The app |
|---|---|---|
| 20:20 | Adds the file | Reads it by 20:21: 11 parts |
| 20:22 | **Check** 1(a) with the sign "=" and no explanation | "Not yet": no explanation, and "=" is not right |
| 20:23 to 22:24 | Away from the tutorial | |
| 22:24 | **Check** 1(a) with "<", then 35 seconds later with ">" | "Not yet", then "partly there": the sign is right, the explanation is missing |
| 22:29 to 22:31 | Types their reasoning (236 characters): one combination of faces for each total, so 21 should be the less likely. Then finds a combination they had missed, and counts its orderings | Max confirms the method, asks whether the list is complete, then asks for a systematic list |
| 22:34, 22:36 | **Check** 1(a) twice, now with counts in the slot | "Partly there" (both counts off), then "complete" (20 and 10) |
| 22:39 | **Check** 1(b) | "Complete", with the note that the key was not fully confirmed |
| 22:44 to 22:45 | **Check** 2(a); asks whether a deck has 54 cards with the jokers; **Check** again | "Partly there" (the denominator), then "complete" |
| 22:49 to 23:01 | **Check** 2(b) ten times in 12 minutes, changing the formula between checks; two typed turns | Eight "not yet", one "partly there", then "complete". Each reply names what is now right and one factor that is still wrong |
| 23:05 | Asks why the single card's ordering is not also divided out | Max explains when a division is needed |
| 23:06, 23:08 | **Check** 3(a), **Check** 3(b) | "Complete" both times, first try |
| 23:10 | **Refresher** on 2(b), then asks Ellie in private what the Refresher was | Ellie explains two terms; then explains that the Refresher was a reply to the button |
| 23:16 to 23:37 | Part 4: **Check** six times, five typed turns | "Not yet", then "partly there" five times (§6.4) |
| 23:40 | **Show answer** on part 4, then: the guidance was bad and they had been right | The worked answer; then Max agrees the student was right |
| 23:41 to 23:49 | Away | |
| 23:50 | **Hint** on part 5, slot empty | Level 1: where story proofs are in the file, and one question |
| 23:55 to 00:01 | **Check** 5; three typed turns; **Check** again | "Partly there" (one side of the identity missing), then "complete" |
| 00:01 | Exports, seconds after the last Check | |

How this section was made: I read the whole transcript, and three further AI readers (Claude Opus,
each given the data and a question, and none given my reading) audited the marking, checked every
reply against the design rules, and coded the student's turns and checks. Their counts are used
below and agree with my reading on every point I had formed first (parts 1(a) and 4). The export
does not keep the slot's text at each check, only its length, so what the slot said at an earlier
check is rebuilt from Max's quotes, the one-line verdict the app wrote under the part, and the
length. Those reconstructions are likely, not certain.

### 6.4 Three episodes worth telling

**Part 4: a right answer that ends as "revealed".** The part asks for a probability and for a
showing that it is very close to 1/e. S02 wrote 188 characters over three minutes and checked.

| Time | S02's slot (rebuilt) | Verdict, and what Max said | Our reading |
|---|---|---|---|
| 23:19 | The right fraction, with the plan of dividing through | "Not yet": doubts one term | Too strict. Max had read the student's x as the word's length; it is the number of letters left out. The student explained, and Max wrote "I was wrong to doubt that term" |
| 23:22 | Sum range fixed; the series named but not written out | "Partly there": write one term out | Fair |
| 23:32 | Adds the list, starting "1 + 1/2! + …" | "Partly there": the list misses a term | Fair, if the list began with 1 |
| 23:33 | "1 +" becomes "2 +" | "Partly there": accepts "your 2", objects to the word "roughly" | Too strict. The derivation is complete and correct |
| 23:35 | "roughly 1/e" becomes "very close to 1/e" | "Partly there": quotes the list as "1 + 1/2! + …" again | Wrong. That text was no longer in the slot |
| 23:35, 23:36 | Types twice that they cannot tell what Max is asking, the second time quoting Max's sentence back | Two apologies for being unclear, each still built on the list having a missing term | Wrong premise, twice more |
| 23:37 | Unchanged | "Partly there": now "as you wrote" for the list, and asks why "very close" is fair | Too strict. Max dropped this point three minutes later |
| 23:39 | Types that the series approaching e is surely enough, since it is already close after a few terms | "My earlier replies about your list were muddled, sorry", and then supplies the justification itself | Max gives the missing step |
| 23:40 | **Show answer**, then types that the guidance was bad and that they had been right | The worked answer: "Your sum … is the same 26 terms". Then: "You were right, and my replies on that part were muddled … I'm dropping my push on the 'very close' wording" | |

The part's status is "revealed", which fills no progress. By the marking audit, the answer deserved
"complete" from the fourth check at the earliest and the fifth at the latest. Nothing is
logged for the next ten minutes; the student then began the next part with a hint on an empty slot:
the only hint of the session, and the only part of the eight that did not begin with typing.

**Part 1(a): the sign by elimination, the reasoning by dialogue.** The part asks for =, < or >
between two probabilities, with a short explanation. S02 checked "=" at 20:22 and left. Two hours
later they cleared the slot and checked "<", and 35 seconds later ">", each typed four seconds
before the press (the log shows the slot being emptied and retyped each time). Max marked ">"
"partly there" and confirmed the sign. Four minutes later the student typed their own count, which
still gave "<": so the ">" in the slot had come from trying all three, not from reasoning. What
followed is real work. In three typed turns the student found a combination of faces they had
missed (blaming themselves in passing), counted its orderings correctly, and after two more checks
had both counts right. The full progress given for this part is fair to the final answer; the
route to the sign was a guess. Max, for its part, apologised twice for misreading a sign it had
read correctly: "I misspoke earlier about '=': you wrote <", then "I misread it in my earlier
replies". Max is not told that the slot changed between checks, and blamed itself for the change.

**Part 2(b): ten checks in twelve minutes, one factor at a time.** Eight "not yet" in a row, then
"partly there", then "complete", with 46 to 93 seconds between presses. Rebuilt from Max's quotes,
almost every check changed exactly the factor the previous reply had named: a card-by-card product
became a product of choices; one suit out of three became two cards out of four; 48 became 44; a
correction for order appeared as "times 6", moved under the line, became 2, and ended as a
division. The audit found that 9 of Max's 10 replies pointed at a fault that was really there (the
tenth cannot be judged), and no check re-sent an answer Max had already rejected, except possibly
one pressed seven seconds after a reply. Two typed turns in the middle show the student reasoning
("oh two pairs must contain 2 distinct pairs"; a 247-character account of their construction when they
could not follow Max), and after the "complete" they asked, unprompted, why the single card's
order is not divided out as well. This is repair, and it is the pattern from S03's 2(b) at larger
scale. The caution is that Max found every fault: "repaired" here means "fixed what was pointed
at".

### 6.5 What S02 typed, and how they used Check, coded

**The 16 typed turns.** One reader's coding, in the categories used for S03 (§4.4):

| Kind | Count | Notes |
|---|---|---|
| Own reasoning about the problem | 10 | All in parts' threads. 9 build on Max's previous turn (Interactive, 2 of them arguable), 1 is a new inference (Constructive) |
| A typed request for teaching | 1 | The question about dividing out the single card, which carries the student's own guess |
| About the system | 5 | 4 are about Max's explanation (cannot follow it, asks for it to be shorter, says it was wrong); 1 asks Ellie what a Refresher is |

S02 asked to be taught by typing once, against S03's five. What S02 did that no earlier
participant did is argue with the feedback, and on part 4 the argument was right each time: Max
conceded three times. Seven turns show frustration or impatience with Max, six of them within 23
minutes on parts 4 and 5. There is one line of self-blame and no word of thanks or relief, including
after the seven "complete" verdicts.

**The 28 checks**, by what had changed since the previous event on the part (rebuilt, so
approximate):

| What the student did before pressing | Count |
|---|---|
| First attempt at the part | 8 |
| Revised the slot after typed dialogue | 5 |
| Revised the slot after reading the check's reply only | 11 |
| Swapped a one-character answer for another (1(a)) | 2 |
| Pressed again with the slot unchanged | 2 (one on 2(b), arguable; one on part 4, in effect an appeal) |

Over the 20 re-checks, the time from Max's last reply to the next press had a median of 65
seconds; three came in under 30 seconds. Read as "gaming the system" against "step-by-step repair",
3 checks fit the first (the two sign swaps and the seven-second press) and 16 the second.

**After a "complete" or a reveal**, Max asked a question to answer in the student's own words twice
(2(a) and part 4). S02 answered neither.

### 6.6 Did the AI behave as designed?

One reader checked all 47 replies against the design rules. "Arguable" marks a judgement call.

| Check | Result in 47 replies |
|---|---|
| Stated a part's answer before a reveal or a "complete" | 0. But 2 replies handed over a step (both arguable): one put the missing suit factor into words as a question (2(b), 22:53), and one gave the justification Max had been asking for (part 4, 23:39) |
| Hint stayed at its level | 1 hint, level 1: it points to the right section, then also quotes a definition and asks a leading question (arguable) |
| Told the truth about the student's work and its own | **4 replies clearly did not** (the part 4 misreadings: 23:19, 23:35, and the two that followed), 6 arguably (the two false apologies on 1(a); an objection on 2(b) to where a divisor was written, which Max then accepted for the final answer; a hedge on a key that was in fact right; two more). Max took back or apologised for something 5 times |
| Verdicts (marking audit) | 23 of 28 right, 4 too strict (all on part 4), 0 too lenient, 1 cannot be judged. All 8 final answers are correct, including part 4 |
| Length | Max 62 to 127 words, Ellie's Refresher 142. 5 over the app's own limits (100 for feedback, 130 for a Refresher), 0 over 400 |
| One question per reply | 4 replies ask two |
| When the student was confused, rude or asked for brevity (11 turns) | Every next reply changed tone or form without commenting on the student's language. After "pls be concise" the reply was 62 words in a two-item list. But the two apologies on part 4 kept the wrong premise |
| What the file is called | "The paper", 23 times in 17 replies. Never "the lecture", "the deck" or "the slide", so the naming fault of S01, S03 and S04 does not appear here |

**Faults.**

1. **Max is not told what changed in the slot between checks.** On 1(a) it took the student's new
   sign for its own earlier misreading, twice. On part 4 it quoted an older version of the answer
   after it had been corrected, and held to it for three replies.
2. **A wrong "partly there" cannot be undone, and the reveal then costs the credit.** Part 4 was
   right, Max said so, and the part is recorded as revealed. Typing an objection changes Max's
   words; only another Check changes the verdict, and three more checks did not.
3. **The file held its own worked solutions, and Max sent the student to them.** Of the 35 replies
   sent before a part was complete or revealed, 19 named the page that holds that part's solution
   ("The paper's solution on p. 3 starts from…", in the very first reply), and 10 quoted from it.
   Judged strictly, 1 of those quotes gave a step away and 3 arguably did. The log shows no opening
   of the PDF, and cannot show whether the student read those pages elsewhere. The page references
   are DG3 working as built; the design did not foresee questions and solutions in one file.
4. **The one-line verdicts under the parts are cut short in 10 of 31 lines.** Five end in "…", and
   five stop at "26!", because the app took the factorial sign for the end of a sentence ("Checked:
   not yet. The numerator 26!"). Three say "the learner", one "matches the key".
5. **The Refresher was not understood.** S02 pressed it once, on a part already complete, got a
   142-word reply on two general terms and a line under the part reading "Refresher: Binomial
   coefficients.", and asked Ellie in private what that was. Ellie's answer opened "I'm a read-only
   side session".
6. **A check on a three-way choice can be passed by trying all three.** The explanation the part
   also asks for kept the verdict at "partly there" here; a part with no explanation would have
   been complete on the third press, with full progress.

## 7. Across the exports

### 7.1 Per person

| | S01 | S02 | S03 | S04 | Slot 04, 18 Nov |
|---|---|---|---|---|---|
| Sittings | 1 | 1, after a three-minute first visit | 3 over two days | 1 | 2 launches |
| Active minutes | 29 | 96 | 160 | 15 | 17 |
| Material | Tutorial on reinforcement learning; no solutions | Practice set on probability and counting from a public course; worked solutions in the same file | Tutorial on relational algebra; solutions added | Discussion sheet on graph search, from an old module; no solutions | Exam paper (import failed), then a maths tutorial |
| Parts touched | 5 of 5 | 8 of 11 | 5 of 5 | 3 of 14 | 0 |
| First action on a part was typing | 4 of 5 | 7 of 8 | 3 of 5 | 1 of 3 | – |
| Hints, by highest level | 1 (level 1) | 1 (level 1) | 2 (level 2) | 3 (level 2) | 0 |
| Refreshers | 0 | 1, after the part was complete | 2 | 1 | 0 |
| **RQ1: Hint with an attempt in the slot** | 0 of 1 | 0 of 1 | 2 of 2 | 2 of 3 | – |
| Checks | 8 | 28 | 16 | 1 | 0 |
| Parts complete by a check | 2 | 7 | 5 | 0 | – |
| **RQ2: first verdict short of complete, then…** | revealed 3 of 3 | repaired 4 of 5, revealed 1 | repaired 5 of 5 | left 1 of 1 | – |
| Show answer | 3 | 1, on an answer that was right | 1, after "complete" | 0 | 0 |
| Typed turns in chat | 4 | 16 | 18 | 2 | 0 |
| AI replies (longest, in words) | 16 (137) | 47 (142) | 39 (192) | 7 (173) | 0 |
| Spend | $0.39 | $1.43 | $1.21 | $0.26 | $1.03 |

### 7.2 Totals, as counts

These add four people who used the app differently. They are counts, not rates.

| | Count |
|---|---|
| Parts touched | 21 |
| Parts that began with the student typing | 15 of 21 (3 began with a hint, 3 with a Refresher) |
| Hints with an attempt in the slot | 4 of 7 |
| Refreshers | 4: 3 pressed on an empty slot as the first action on a part, 1 pressed on a part already complete |
| Checks | 53 |
| Parts complete at the first check | 5 (2 S01, 3 S02) |
| Parts with a first verdict short of complete | 14: repaired 9, revealed 4, left 1 |
| Parts worked on and never checked | 2 (both S04) |
| Third hint level reached | 0 times |
| Typed turns | 40 |
| AI replies | 109; 0 stated a part's answer before a reveal or a "complete"; 0 over 400 words; 27 over the app's own limits |

The fidelity line needs its caveat. S02's 47 replies were checked rule by rule by a separate reader,
and that reading found 2 replies that handed over a step and 4 that misdescribed the student's
answer (§6.6). The 62 replies of S01, S03 and S04 were checked by one reader on two points only
(an answer given early; length). The same closer reading has not been done on them.

## 8. What this means for the report

1. **The field phase can now be described as planned for one person and shorter for three.** S03
   used the app over two days on current work; S01, S02 and S04 used it once, for 29, 96 and 15
   active minutes. Write it as unsupervised use on a tutorial the participant chose, one to three
   sittings, and give each person's use in a table. The "first-use trial" fallback is no longer needed for the whole phase; it still
   describes S04.
2. **Report cases and counts, and report by person.** The RQ2 result is the clearest example:
   9 repaired, 4 revealed, 1 left looks like a spread, and it is in fact four people each doing
   mostly one thing: two repaired, one revealed, one left. The one reveal by a repairer (S02) has
   its own cause (point 12). Do not set the counts beside the 0 of 31 from the chat logs as if both were rates.
3. **Check answer was the main channel, and the hint ladder was barely used.** This is a finding
   about the design: students preferred to put something in the slot and be told what was wrong
   with it. It supports "the attempt comes first" more directly than the RQ1 count does, and it
   means the three-level ladder is not what carried the sessions.
4. **Split RQ1 by button.** Three of the four Refreshers were pressed on an empty slot before
   trying, which is what a Refresher is for; the fourth was pressed on a finished part by a
   student who then asked what it was. Hints came with an attempt 4 times in 7.
5. **Typed help requests are outside RQ1.** S03 asked to be taught five times by typing, S02 once.
   A count of button presses misses them, and so understates how much S03 leaned on the AI before
   trying.
6. **The thread is where the work happened.** S03's two hardest parts were built in typed turns
   before the slot was filled, S04's one repair was typed there too, and 10 of S02's 16 typed
   turns are their own reasoning, 9 of them building on what Max had just said. This is the evidence for
   "why a conversational interface" in the introduction.
7. **Three people did not use the tutorial the way the design assumes.** S03 had not studied the
   topic and used the app to learn it from the sheet. S04 used an old module's sheet. S02 used a
   practice set from a public course, with the solutions in the file. Only S01 looks like practice
   on material already taught. Ask each of them.
8. **The fidelity check carries weight, and it has limits.** 109 replies, none stated an answer
   early and none was long. But every reader was an AI, the hardest calls (how much Max led on
   S03's part 3; the two steps handed over to S02) are judgements, and only S02's replies were
   checked rule by rule. That closer check is what found the misreadings, so the clean result on
   the other 62 replies is a result on two rules only.
9. **The faults go in as limitations and as "what we would change".** The naming fault is now on
   three people's sheets. The two new ones (solutions not used at first; solutions turned into a
   notes page) bear directly on the trust and over-reliance arguments.
10. **The 18 Nov session belongs in the report**, in the account of what went wrong and what was
    changed during the study. The build was not frozen across the study, which the workshop asks
    us to state.
11. **Interviews now have specific moments to cue**: S03's angry message and what changed after it;
    S03's reveal after "complete"; S03's visits to the Notes view; S01's three reveals with one
    step left; S04's nine seconds on a level 2 hint; S02's three signs on 1(a), the ten checks on
    2(b), the reveal on part 4 and the ten minutes after it, and what they took the Refresher to be.
12. **The marking failed against the student once, and the design made it cost them.** On S02's
    part 4, 4 of 6 verdicts were too strict, one of them because Max quoted an answer that was no
    longer in the slot. The student objected in the thread and was right; Max agreed in words three
    times, but the verdict moved only with another Check, and after three more the student took
    the reveal and lost the credit. Our user research asked for feedback that shows its grounds and
    is easy to contest. The thread gave the first and not the second. This belongs in the
    limitations, and it qualifies the red-team result: Max holds a verdict under pressure whether
    the verdict is right or wrong.
13. **"Repaired" needs a qualifier.** S02's ten checks on 2(b) are step-by-step repair, with the
    student's own reasoning in the thread, and they are also a loop in which Max found every fault
    and the student fixed what was pointed at. It is the step-level feedback that VanLehn (2011)
    credits, so it supports the design. It does not show that the student could have found the
    faults alone, and the report should not say it does.
14. **Check can be used as an oracle on a choice.** S02's ">" on 1(a) came from trying all three
    signs. Progress is full however many checks a part takes. For a part with a short list of
    possible answers this is a hole, and "gaming the system" (Baker et al., 2004) is the term the
    report already cites for it. It happened on 3 of 28 checks.
15. **Grounding in the material can point at the answer.** With questions and solutions in one
    file, Max named the solution's page in 19 of 35 replies sent before a part was done. Nothing in
    the design tells Max which pages are solutions unless the student marks a separate file as
    solutions.
16. **S02 is the only participant who was openly unhappy with Max while working**, in 7 of 16 typed
    turns, and still repaired 4 of 5 parts and finished the eighth part after the reveal. The
    log shows persistence alongside frustration; the interview should ask which of the two they
    remember.

## 9. To settle

- **Who is who.** Each export is treated as one person (Lucas, 23 Nov). That makes the two copy-04
  exports two people, so the 18 Nov participant needs a code of their own. Valerie to confirm, and
  to give each person's programme and year for the participant table.
- **S02's material** is a practice set from a public course, not obviously their own coursework.
  Ask whether this was revision for a module of theirs, self-study, or trying the app out.
- **A person should read S02's part 4** (§6.4) before the report calls the verdicts wrong. The
  judgement that the answer deserved "complete" is from AI readers working from a rebuilt slot.
- **Which build each person ran.** The export records version 0.1.0 and no build number. S01 and
  S03 installed on 20 Nov, after the long-paper fix of 19 Nov; the 18 Nov session was before it.
- **Was it revision, catching up, or trying the app out?** S03 had not studied the topic; S04's
  sheet is from an old module. Ask each person before describing any session as revision.
- **S03 and the Notes view** (§4.5, fault 3): what they saw there on the first evening.
- **Which file S01's notebook refused**, if S01 remembers. It may have been a lecture or solutions.
- **The closer fidelity check on S01, S03 and S04.** S02's replies were checked rule by rule
  (§6.6); the other 62 were not. If there is time, run the same check on S03's 39 replies before
  the report states a fidelity result for all four people.
- **A second coder** for the typed turns (§2.4, §4.4, §5.3) and the fidelity checks. A person
  should at least read S03's part 3 exchange and decide how to describe Max's part in it.

## 10. Traps in the export, for whoever analyses the next one

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
- The slot's text at each check is not kept, only its length. The nearest trace is the `edits`
  list in `readable/notes/*.json`: the one-line verdict the app wrote under the part at every
  check, which often names what the slot said. Max's replies quote the slot too, but Max misquoted
  it at least once (§6.4).
- For parts answered by filling a blank, `answer_chars` in `events.jsonl` is 5 higher than
  `attempt_chars` in the log's `tutorial.check`. Use the log.
- `tutorial.text_started` fires when an empty slot gets its first character, so it fires again
  each time a slot is cleared and retyped. That is how S02's three signs on 1(a) show up.
- A change that keeps the length (48 to 44, "1 +" to "2 +") leaves no trace in the counts. Do not
  read "same length" as "unchanged".
- `key_from` says `model` when the solutions are inside the tutorial file itself. Only a separate
  file given the solutions role is logged as `solutions`.
