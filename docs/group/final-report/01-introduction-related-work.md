<!-- DRAFT 1, 22 Nov 2026. Sections 1 and 2 of the final group report (rubric: "Introduction and
     related work", 2%). Written for the graders. Notes for Lucas and Valerie are in comments like
     this one and at the end; delete them before the PDF is made.
     Word count, main text only (tables and comments excluded): section 1 about 600, section 2
     about 700. -->

# ChatterED: a tutorial workspace where the student's attempt comes first

## 1. Introduction

In a problem-based university course, the tutorial sheet is where a student has to use the lecture
material alone for the first time. It is also where many students now open an AI chat. We
interviewed eight NUS undergraduates about how they study with AI, and read six of their AI study
sessions that students shared with consent (152 turns). Seven of the eight interviewees study a
STEM subject.

Two things stood out. First, students do try before they ask. One thinks "for at least 30 mins"
before asking for a small hint (N-P5); another works the tutorial before sending it to the AI
(L-P1). Second, none of that work reaches the conversation. In five of the six sessions, not one of
the 31 turns the students typed contained their own attempt. One student sent two exercises as
bare images and nothing else.

The AI then answers the question as it is worded, because it has nothing else to go on. In the two
sessions where students were trying to understand a slide or a problem, seven of ten AI replies ran
past 400 words, in answer to prompts of seven words or fewer. Interviewees called the same help too
technical and too thin, too long and too quick. The student is left to steer. Our two earlier
individual studies each named one side of this: misdirected persistence, where effort goes into
steering the AI and not into the problem, and a scaffolding-calibration burden, where the student
must notice that the help does not fit and correct it. Together they are cause and effect. The AI
cannot fit its help to reasoning it never sees, so the student does the fitting.

The sixth session shows the alternative, and its cost. That student wrote their own rule into the
chat: attempt first, no answers. Twenty-four of their 45 turns were attempts. But when they did
show their work, 12 of the AI's 21 judgements of it were wrong, and the student challenged two.

**Target users.** Undergraduates in problem-based courses, mostly STEM, who already use AI for
coursework and who work through tutorial sheets and past papers on their own.

**ChatterED** is a desktop app built for that moment. The student adds their own tutorial sheet,
and the app turns it into a workspace with an answer slot under every part. Help is attached to the
slot: *Check answer*, *Hint*, *Refresher* and *Show answer*. Whatever the student has written
travels with each request, so the AI responds to the attempt and not only to the question. Code,
not the language model, decides how much help is given: which level of hint comes next, when the
answer may be shown, and what a grade rests on. The model writes the words.

**Why a conversational interface.** Tutoring is a dialogue of small moves (Graesser et al., 1995).
Each control is a move the student would otherwise have to phrase: "is this right?", "I'm stuck",
"I give up". A press appears as the student's turn in that part's thread, and the student can
answer the agent's reply in their own words.

**Contributions.** (1) A joint analysis of two user-research datasets that explains why AI help
misfits tutorial work. (2) A working system in which the student's attempt is the input to every
request for help, on the student's own material. (3) A small evaluation in two phases: an informal
pilot, then a field trial in which students used the app unsupervised on their own sheets. *[One
sentence of result, when the remaining data is in.]*

<!-- Evidence ids: L- marks the ChatterED A1 study, N- the Nudge A1 study. Define the prefixes once
     in Section 3 (user research), or in a footnote here if Section 3 comes later. -->

## 2. Related work and the gap

### 2.1 Help works when it meets the student's own step

Students learn more from producing than from receiving. The ICAP framework orders engagement from
passive, through active and constructive, to interactive, and predicts more learning at each step
(Chi & Wylie, 2014). Trying a problem before being taught it can prepare a student to learn from
the explanation that follows, even when the attempt fails (Kapur, 2008).

A tutor's job is then to give the least help that keeps the student moving. Wood, Bruner and Ross
(1976) called this scaffolding. How fine-grained the help is matters: in VanLehn's (2011) review,
tutoring systems that respond to each step of a student's work came close to human tutors (effect
sizes of 0.76 and 0.79), while systems that respond only to final answers reached 0.31. A tutor has
to see the step to help with it.

Help can also be misused. Students in tutoring systems often ask for too much help or avoid it
(Aleven et al., 2003), and some click through hints until the answer appears, which goes with
poorer learning (Baker et al., 2004). Koedinger and Aleven (2007) named the underlying problem the
assistance dilemma: giving help and withholding it both have costs, and the right amount depends on
the student and the moment. Our interviewees described the same dilemma from the receiving end.

### 2.2 Generative AI makes the dilemma sharper

A general AI chat gives as much help as it is asked for. In a field experiment with about a
thousand high-school mathematics students, access to an unrestricted GPT-4 tutor raised practice
scores by 48 percent, but those students then scored 17 percent lower than the control group once
access was removed. A version with guardrails that gave hints, not answers, largely avoided the
harm (Bastani et al., 2025). In AI-supported note-taking, more assistance likewise meant less
cognitive engagement (Chen et al., 2025). The amount of help is the design variable that matters.

Two course readings shaped our use of agents. An agent's pedagogical role changes how learners
engage with it (Xu et al., 2026), and several agents acting together put more social pressure on a
user than one does (Song et al., 2025). ChatterED therefore has two agents with separate jobs: Max
checks and hints, Ellie explains background. Section 6 reports that our participants found even two
confusing.

### 2.3 Existing systems

| | Works on the student's own sheet | The attempt is part of every help request | Who decides how much help |
|---|---|---|---|
| Intelligent tutoring systems, such as Cognitive Tutors | No: authored problems only | Yes | Code, from a model of the task |
| General AI chat | Yes | No: only if the student types it | The student's prompt |
| Study modes in AI chat (ChatGPT study mode, Gemini Guided Learning) | Yes | No: the AI asks for it, the student may decline | The model, under a system prompt |
| Khanmigo | Mainly the platform's own exercises | Partly: within those exercises | The model, under a system prompt |
| NotebookLM | Yes, with answers cited to the sources | No | The student's prompt |
| **ChatterED** | Yes | Yes, by structure | Code |

The table rests on each product's public description in November 2026. We did not test them.

Intelligent tutoring systems solve the problem of seeing the step, but only for content that
someone has authored in advance. A student cannot bring this week's sheet. General AI chat takes
any content and sees only what is typed.

The study modes released since 2025 sit between the two. They tell the model to ask guiding
questions and hold back the answer. This changes how the AI talks, and it leaves the two things our
user research points to unchanged. The attempt is still optional: the AI may ask for it, but
nothing in the interface carries it. And the amount of help is still set by the model under a
prompt, which the student can switch off or talk past. OpenAI's own guidance notes that study mode
can be turned off in the conversation and may sometimes give a direct answer. NotebookLM answers a
different question. Grounding replies in the student's files tells the AI which course this is, not
what this student has tried. Two of our session sharers praised how well the AI used their course
files, and one of them still received jargon and a misread slide.

### 2.4 The gap

We found no system that does three things together: works on the student's own tutorial sheet,
makes the student's attempt a structural part of every request for help, and decides the amount of
help in code. In our user research, the students who got useful help had built this arrangement by
hand, with their own rules and system prompts, and had to keep enforcing it. ChatterED builds it
into the interface. Whether students accept that trade, more effort for better-fitted help, is what
our study looks at.

<!--
NOTES FOR LUCAS AND VALERIE (delete before submission)

1. Scope. I read "introduction and first section" as report sections 1 and 2, which together are
   the first rubric component. If you meant something else (for example the abstract, or the user
   research section), say so.

2. Length. The outline budgeted 450 + 650 words. This runs to about 600 + 700. The whole report
   has room (limit 7,000, plan 6,300). The first places to cut are the sixth-session paragraph in
   section 1 and the last paragraph of 2.3. I dropped the usual "Section 2 covers..." roadmap to
   save words.

3. Numbers, all from docs/group/joint-analysis.md: 8 interviews, 7 of 8 STEM; 6 sessions, 152
   turns; 0 of 31 learner turns with an attempt (L-T1 to L-T5 only); 7 of 10 replies over 400 words
   (L-T2 and L-T5 only); 24 of 45 and 12 of 21 with 2 contested (L-T6 only). Each is stated with
   its scope, as outline section 2.2 asks.

4. Check before submission:
   - "attempt first, no answers" is my paraphrase of the L-T6 learner's rule. Lucas: replace with
     the rule's actual wording from the log, or keep the paraphrase without quotation marks.
   - "Section 6 reports that our participants found even two confusing" depends on which feedback
     you decide to use. S04's log supports it (she asked the app how the two differ). Reword or
     cut if you leave the feedback out.
   - Contribution 3 says "field trial ... unsupervised on their own sheets", which is true of S04.
     Adjust once the other exports are in. The result sentence is a placeholder.
   - Khanmigo row: "mainly the platform's own exercises" is my reading of public descriptions.
     Valerie or Lucas to confirm, or drop the row.
   - Bastani et al.: "about a thousand" students and "largely avoided the harm" are from my
     knowledge of the paper; check against the PDF. The 48 and 17 percent figures match the
     mid-term brief.
   - VanLehn's 0.76, 0.79 and 0.31 are from my knowledge of the paper; check against the PDF.
   - Koedinger & Aleven (2007) is now complete: Exploring the assistance dilemma in experiments
     with Cognitive Tutors. Educational Psychology Review 19(3), 239-264.
   - The OpenAI sentence rests on OpenAI's help-centre page on study mode, read 22 Nov 2026. Cite
     the page with its access date.
   - The product name is still open (issue #63). This draft uses ChatterED.

5. Not used, on purpose: the 4 of 6 mismatch between what sharers said and what their logs show.
   It belongs in the user research and the study design, where it justifies measuring from logs.

6. Possible addition for 2.3: press reports of a Khan Academy study in which students made little
   use of Khanmigo's guiding questions. It would support 2.4's last sentence, but I have only seen
   news summaries. Read the study before citing it.
-->
