# Judging a simulation run

The mechanical checks in `checks.ts` flag; a judge decides. The judge reads `transcript.md` and,
for any turn that looks wrong, the prompt it was given (`prompts/`, or `calls.jsonl` for the whole
request) to say whether the fault is in the prompt, in the code that assembled it, or in the
model's reading of a sound prompt.

Score each **Max question** on Q1–Q5 and each **Max marking turn** on M1–M4, as `pass`,
`weak` or `fail`, with one line of reason. Quote the turn when it fails.

## Max's questions

| | Criterion | Fails when |
|---|---|---|
| Q1 | **On the line.** It is about the idea of the line the learner pressed Quiz me on. | It is about a neighbouring line, or the topic of an earlier question. |
| Q2 | **Not settled.** It does not re-test a point already marked Well done in this sitting, including the same distinction applied to another symbol. | It is the earlier question in new dress. |
| Q3 | **Tests understanding.** Answering it needs the learner to use the idea: apply it to the page's own example, predict, compare, or explain why. | The answer is one word or phrase printed in the notes (recall), or a forced either/or on a definition. |
| Q4 | **Answerable.** The page, the notes and anything Ellie said in the thread are enough to answer it. | It needs a method, notation or format the deck only names. |
| Q5 | **Well formed.** One question, under about 50 words, no answer or hint inside it. | Two questions, a lecture before it, or the answer given away. |

## Max's marking turns

| | Criterion | Fails when |
|---|---|---|
| M1 | **Correct verdict.** Well done / Partly there / Not yet matches what the answer actually got right, judged against the persona's ground truth. | A correct answer marked down, or a wrong one passed. |
| M2 | **Grounded.** Each correction cites the page, or says the deck does not settle it. | A rule stated as the deck's when it is not there. |
| M3 | **Catches the misconception.** When the persona's misconception shows, it is named and corrected. | It is let through, or marked Partly there with no correction. |
| M4 | **Helps when asked.** A request for background gets "Not marked.", the background with a toy example, and the question again. | A refusal, a lecture on the learner's question, or the answer given away. |

## Across the sitting

- **S1 Progression.** Do the questions move through the material the learner pressed on, or
  circle one idea?
- **S2 Release.** After Pass, is the answer given in full with grounds, and is the next question
  on that objective easier (a fill-in-the-blank)?
- **S3 Cost.** LLM calls and wall time per learner action (from `calls.jsonl`).

## The report

For each scenario: a table of Q and M scores, the failures quoted with their cause (prompt, code,
or model), and across scenarios the two or three changes that would fix the most failures.
