# Field study: results as the exports come in

**Status.** Working record, 22 Nov 2026, for Lucas and Valerie. It holds what each research export
shows, measured the way `final-report-outline.md` §6.2 defines the research questions. Two exports
are in, both from study copy 04. The coding below is by one AI coder and has not been checked by a
person. Interviews are not in yet.

**What is committed and what is not.** This file holds counts, times, part ids, the AI's replies and
the few short lines the participant typed. The exports themselves are raw research data and stay
outside the repo, on Lucas's Mac.

## 0. At a glance

- **Neither export is "1–2 days of revision".** The 22 Nov export is one sitting of 16 minutes on
  one tutorial sheet. The 18 Nov export is 17 active minutes in which the exam paper would not
  import and nothing was attempted. The report has to describe the use as it was (§4).
- **The numbers are tiny, so they are cases, not rates.** In the 22 Nov session: 2 of 4 help
  requests came with an attempt in the slot; 1 answer was checked, got "not yet", and was left.
- **The AI behaved as designed in all 7 replies**, by my reading: no reply gave the answer, the two
  hint rungs did different jobs, and the longest reply was 173 words. This is the hint example the
  teaching team asked for (§2.5).
- **Three faults showed up that the report should own** (§2.6): hints talk about a lecture that was
  never added; Ellie's private chat describes a "group" that the tutorial workspace does not have;
  and with no solutions attached, the one check ran against a key the model wrote itself.
- **One question for Valerie decides the participant count:** the two exports come from Macs on
  different macOS versions, so they may be two different people on the same study copy (§5).

## 1. How these numbers are made

```sh
python3 -I tools/field-metrics.py <unzipped export folder>
```

The script reads one export and prints sizes, counts and times only. Every number in §2.2 and §3
is its output; I then read the transcript by hand for §2.3 to §2.6.

| Export | Study copy | Installed and exported (UTC) | macOS (Darwin) | Called here |
|---|---|---|---|---|
| `P-3b69844c` | 04 | 22 Nov, 03:10 to 03:26 | 25.2 | **S04** |
| `P-a6b72eca` | 04 | 18 Nov, 08:45 to 09:59 | 24.4 | **slot 04, 18 Nov** |

The app makes a new random participant id on each install, so one person who reinstalls gets two
ids.

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

## 4. What this means for the report

1. **Describe the field phase as it ran.** So far it is one first-use sitting of 16 minutes and one
   failed session, not days of revision. If the remaining exports look the same, call the phase a
   first-use field trial, drop the framing of the window as "1–2 days", and say why it shrank. The
   report brief says results that did not go as hoped cost no marks, and over-claiming does.
2. **Report cases, not percentages.** "2 of 4" and "1 of 1" are honest as counts beside the
   timeline. Do not compare them with the 0 of 31 from the chat logs as if both were rates.
3. **The strongest material from the log is qualitative:** the 1.a exchange (attempt, pointer, new
   inference) shows the designed loop working once; the rest of the session shows it not holding.
4. **The fidelity check now carries real weight.** It answers three of the teaching team's points
   at once: how analysing the AI's replies helps, the hint example, and whether the system does
   what the design says.
5. **The 18 Nov session belongs in the report**, in the account of what went wrong and what was
   changed during the study. It also means the build was not frozen across the study, which the
   workshop asks us to state.
6. **Lean on the interviews.** With logs this thin, RQ3 (what students say, set against what the
   log shows) is where most of the findings will come from.

## 5. To settle

- **Are the two exports one person or two?** Both carry study copy 04, but the Macs run different
  macOS versions (Darwin 24.4 on 18 Nov, 25.2 on 22 Nov), and the sheets are from different
  modules and years. If two people used copy 04, the field phase has one more participant than
  codes, and each needs their own code. Valerie will know.
- **Which build did S04 run?** The export records version 0.1.0 and no build number.
- **Was S04 revising, or trying the app out?** The sheet is from an old module. Ask in the
  interview before using this session as evidence about revision.
- **S04's programme and year**, for the participant table.
- **A second coder** for §2.4 and §2.6.

## 6. Traps in the export, for whoever analyses the next one

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
