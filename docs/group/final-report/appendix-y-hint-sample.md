<!-- DRAFT 1, 23 Nov 2026. Appendix for the final group report: the full thread behind Figure 2.
     Source: S04's export (P-3b69844c, 22 Nov), readable/transcripts, thread on part 1.a; the slot
     text and the minute-by-minute times match docs/group/field-results.md §2.3 to §2.5.
     "Appendix Y" is a placeholder: give it its letter when the appendices are fixed. -->

## Appendix Y. A sample session: one part, from the question to the student's reply

This is the complete thread on one part of a participant's homework from the field study (S04,
22 Nov 2026), from which Figure 2 is taken. The homework was a discussion tutorial on graph search
from a second-year data structures module. The participant added no lecture and no solutions, so
all help was drawn from the homework itself. Times are minutes and seconds from the participant's
first launch of the app.

Max's replies are given in full, apart from one opening sentence in his first reply, which is cut
and marked […]. Words in square brackets are ours, and mathematical symbols are shown in italics.
Nothing else has been changed.

**The question (Problem 1.a).** "Recall that when performing DFS or BFS, we may keep track of a
`parent` pointer that indicates the very first time that a node was visited. Explain why these
parent edges form a tree (i.e., why there are no cycles)."

**The student's answer in the slot** (typed from 3:34): "These parent edges are only visited once
and do not form a cycle."

| Time | Who | Text |
|---|---|---|
| 4:11 | Student, presses *Hint* | "Hint, please: Problem 1.a (point)" |
| 4:15 | Max, hint 1 (Point) | "[…] [The question] says the parent pointer marks "the very first time that a node was visited". Your answer says the edges are "only visited once". Look at that phrase on p. 1 again: when a node gets its parent, which node is being given the pointer, and how many times can that happen to it?" |
| 6:10 | Student, types in the thread | "A node can only get one parent." |
| 6:22 | Max | "Yes, that's the first piece. p. 1 says the pointer records "the very first time that a node was visited", so each node gets its parent once and never changes it. That also fixes your phrase: it's the nodes that get a pointer once, not the edges that are "visited once". What's still missing is the step from "one parent each" to "no cycle". When *v* gets *u* as its parent, which of the two had already been visited at that moment, and what does that mean for walking back up the parent pointers starting from *v*?" |
| 8:13 | Student, presses *Hint* | "Hint, please: Problem 1.a (break it down)" |
| 8:19 | Max, hint 2 (Break it down) | "Here are three smaller questions, using [the question's] phrase "the very first time that a node was visited" (p. 1): 1. When *v* is given *u* as its parent, how do *u* and *v* compare in the order they were first visited? 2. Start at any node and follow parent pointers repeatedly. Does each step go to a node first visited earlier or later than the one you just left? 3. Given your answer to 2, could that walk ever come back to a node it has already passed? Where must it end?" |

The thread shows the attempt carried into each request. Max's first hint starts from the student's
own wording and asks one question about it, and the student replies with a correct step. Max then
confirms that step, corrects the wording of the original answer, and names what is still missing
without stating it, while the second hint breaks the remaining argument into three questions and
gives none of their answers. Nine seconds after the second hint, the student moved on to another
part, so 1.a was never checked and the third hint level was not reached (Section 6).
