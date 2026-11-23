<!-- DRAFT 1, 22 Nov 2026. Sections 1 and 2 of the final group report (rubric: "Introduction and
     related work", 2%). Written for the graders. Notes for Lucas and Valerie are in comments like
     this one and at the end; delete them before the PDF is made.
     Word count, main text only (tables and comments excluded), 23 Nov: section 1 about 890,
     section 2 about 730. -->

# ChatterED: a tutorial workspace where the student's attempt comes first

## 1. Introduction

Homework is a common way for students to practise and reinforce what they have learned in class. At university it usually comes as the tutorial: a set of questions students
work through on their own during the week. It is also where many students now open an AI chat when they encounter difficulties. We
interviewed eight NUS undergraduates, most of them in STEM subjects, about how they study with AI,
and read six AI study sessions that students shared with consent (152 turns).

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

**Target users.** Undergraduates in technical courses, where questions have one correct answer, who
already use AI for coursework and who work through their homework and past papers on their own.

**ChatterED** is a desktop app built for this. The student adds their own homework,
and the app turns it into a workspace with an answer slot under every part. Help is attached to the
slot: *Check answer*, *Hint*, *Refresher* and *Show answer*. Whatever the student has written
travels with each request, so the AI responds to the attempt and not only to the question. Code-based guardrails determine how the student will be helped, such as the level of hint given
and when the answer may be shown, while an LLM is used to turn these decisions into natural language.

**Why bring tutoring into the tutorial.** A tutorial is meant to be done alone, but alone does not
have to mean without help. Its purpose is practice, and practice works through feedback: feedback is
one of the strongest influences on learning (Hattie & Timperley, 2007), and it helps most when it
arrives while the student is still on a task they find hard (Shute, 2008). A tutorial gives that
feedback days later, in class or from the posted answers. Until then, a student who is stuck stays
stuck, and confusion that is not resolved tends to turn into frustration and then disengagement
(D'Mello & Graesser, 2012). Students have already filled this gap with AI chat, as our interviews
show. So the question is not whether AI should be there during homework, but what kind of help it
gives: unrestricted help can raise practice scores and still lower learning (Bastani et al., 2025).
We keep what makes the tutorial useful, the student's own attempt, and add help that starts from it.

**Why a conversational interface.** Human-human tutoring is effectively a dialogue spanning many small moves; a problem is posed, the student attempts, feedback is given, and both improve the answer
together (Graesser et al., 1995). ICAP places learning through this kind of exchange, where each
side builds on the other's contribution, above working alone (Chi & Wylie, 2014), and putting a
step into one's own words is itself a source of learning (Chi et al., 1994). A form that marks
answers right or wrong cannot hold that exchange; a conversation can. But an open chat makes the
student phrase every request, and asking for the right help is a skill many students lack (Aleven
et al., 2003). So each control in ChatterED is a move the student would otherwise have to phrase:
"is this right?", "I'm stuck", "I give up". A press appears as the student's turn in that part's
thread, and the student can answer the agent's reply in their own words (Appendix Y). The dialogue stays; the
work of steering it does not.
<!-- New references for the list: Hattie, J., & Timperley, H. (2007). The power of feedback.
     Review of Educational Research, 77(1), 81–112. · Shute, V. J. (2008). Focus on formative
     feedback. Review of Educational Research, 78(1), 153–189. · D'Mello, S., & Graesser, A. (2012).
     Dynamics of affective states during complex learning. Learning and Instruction, 22(2), 145–157.
     · Chi, M. T. H., de Leeuw, N., Chiu, M.-H., & LaVancher, C. (1994). Eliciting self-explanations
     improves understanding. Cognitive Science, 18(3), 439–477. · Graesser, A. C., Person, N. K.,
     & Magliano, J. P. (1995). Collaborative dialogue patterns in naturalistic one-to-one tutoring.
     Applied Cognitive Psychology, 9(6), 495–522. Bastani, Chi & Wylie and Aleven are
     already cited in section 2. -->


**Contributions.** (1) A joint analysis of two user-research datasets that explains why AI help
misfits tutorial work. (2) A working system in which the student's attempt is the input to every
request for help, on the student's own material. (3) A small evaluation in two phases: an informal
pilot, then a field trial in which students used the app unsupervised on their own homework. In a field trial with four
students, 15 of the 21 parts they worked on began with the student's own attempt, and 9 of the 14
that fell short at the first check were later repaired; the study also showed that marking by the
model can be wrong, and that students have no way to contest it.

<!-- Evidence ids: L- marks the ChatterED A1 study, N- the Nudge A1 study. Define the prefixes once
     in Section 3 (user research), or in a footnote here if Section 3 comes later. -->

## 2. Related work and the gap

### 2.1 Help works when it meets the student's own step

Students learn more from producing than from receiving. The ICAP framework orders engagement from
passive, through active and constructive, to interactive, and predicts more learning at each step
(Chi & Wylie, 2014), while past work has even shown that getting students to try a problem before being taught it improves teaching outcomes later (Kapur, 2008).

A tutor's job is then to give the least help that keeps the student moving. Wood, Bruner and Ross
(1976) called this scaffolding. How fine-grained the help is matters: in VanLehn's (2011) review,
tutoring systems that respond to each step of a student's work came close to human tutors (effect
sizes of 0.76 and 0.79), while systems that respond only to final answers reached 0.31. A tutor has
to see the step to help with it.

Help can also be misused. Students in tutoring systems often ask for too much help or avoid it
(Aleven et al., 2003), and some click through hints until the answer appears, which goes with
poorer learning (Baker et al., 2004). Koedinger and Aleven (2007) named the underlying problem the
assistance dilemma: giving help and withholding it both have costs, and the right amount depends on
the student and the moment. Our interviewees met both costs, sometimes from the same AI: one
described "two extremes" (N-P1), another help that would "go super fast … or … super slow" (N-P5).
The right amount of help moves, so no single setting fits.

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

| | Works on student's homework | The attempt is part of every help request | Who decides how much help |
|---|---|---|---|
| Intelligent tutoring systems | No: unless customised for the homework | Yes | Code, from a model of the task |
| General AI chat | Yes | No: only if the student types it | The student's prompt |
| Study modes in AI chat (ChatGPT study mode, Gemini Guided Learning) | Yes | No: the AI asks for it, the student may decline | The model, under a system prompt |
| Khanmigo | Mainly the platform's own exercises | Partly: within those exercises | The model, under a system prompt |
| NotebookLM | Yes, with answers cited to the sources | No | The student's prompt |
| **ChatterED** | Yes | Yes, by structure | Code |

Traditional intelligent tutoring systems are designed to ensure correct guidance and tighter
control over problems and hints, but this relies on content authored into the system in advance,
meaning students are unable to bring in their own homework. In contrast, general AI assistants
accept any content, but might give guidance that is wrong, or more help than the student needs, as
they only see what the student chooses to type.

Study modes released since 2025, such as ChatGPT's study mode and Gemini's Guided Learning, try to
bridge this by instructing the model to ask guiding questions and withhold the answer. While this
changes how the AI responds, it does not address the two issues raised in our user research.
Firstly, the student's attempt remains optional; the AI may ask for it, but nothing in the
interface requires it to be shared. Secondly, the amount of help is decided by a model
through its prompt, which models might fail to follow, or students can turn off. Another alternative is NotebookLM, which addresses a different studying issue. By grounding its replies in the
student's uploaded files, it gives the AI context on the course, but not on what the student has
attempted. In our own study, two of the students who shared their AI sessions praised how well
the AI made use of their course files, yet one of them still received replies full of jargon and a
misread slide.

### 2.4 The gap

We found no system that does three things together: works on the student's own homework,
makes the student's attempt a structural part of every request for help, and decides the amount of
help in code. In our user research, the students who got useful help had built this arrangement by
hand, with their own rules and system prompts, and had to keep enforcing it. ChatterED builds it
into the interface. Whether students accept that trade, more effort for better-fitted help, is what
our study looks at.

<!--
NOTES FOR LUCAS AND VALERIE (delete before submission)

1. Length. The outline budgeted 450 + 650 words; this is about 890 + 730 (Lucas, 23 Nov: leave
   the length). The whole report has room (limit 7,000, plan 6,300). If a cut is needed, the ICAP
   and Chi (1994) sentence in "Why a conversational interface" goes first, as 2.1 covers ICAP.

2. Numbers: 8 interviews, 6 sessions, 152 turns, 0 of 31 learner turns with an attempt (L-T1 to
   L-T5 only), 7 of 10 replies over 400 words (L-T2 and L-T5 only) are from
   docs/group/joint-analysis.md. The Contributions result sentence (15 of 21 parts, 9 of 14
   repaired, four students) is from section 6 (03-user-study-results.md).

3. Check before submission:
   - The four references added on 22 Nov (Hattie & Timperley, Shute, D'Mello & Graesser, Chi et
     al. 1994) and Graesser et al. (1995) were cited from memory; check them before the list is
     made.
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

4. Not used, on purpose: the 4 of 6 mismatch between what sharers said and what their logs show.
   It belongs in the user research and the study design, where it justifies measuring from logs.

5. Possible addition for 2.3: press reports of a Khan Academy study in which students made little
   use of Khanmigo's guiding questions. It would support 2.4's last sentence, but I have only seen
   news summaries. Read the study before citing it.
-->
