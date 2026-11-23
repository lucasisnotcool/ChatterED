<!-- DRAFT 1, 23 Nov 2026. Sections 3 and 4 of the final group report (rubric: "System design and
     implementation", 2%). Written for the graders, in the voice of sections 1 and 2 as Lucas left
     them. Notes for Lucas and Valerie are in comments like this one and at the end; delete them
     before the PDF is made.
     Word count, main text only (tables, figures, headings and comments excluded): section 3 about
     870 (3.1 was expanded in the 23 Nov fact check), section 4 about 950. -->

## 3. User research and design rationale

### 3.1 What we did

Our user research combines the two studies that each of us carried out individually earlier in the
semester, which we then analysed again as a single dataset. In total, we interviewed eight
undergraduates who use AI for their coursework, none of whom are on the team, and collected six AI
study sessions that students shared with consent, each with the student's own written account of
how the session went (Table 1). Both studies had numbered their participants from P1, so sources
from the first study carry the prefix L- and sources from the second carry N-.
*[Valerie: are N-P1 to N-P5 all NUS students? If so, "eight undergraduates" becomes "eight NUS
undergraduates", as in Section 1. Please also confirm the N- row of Table 1.]*

**Table 1. Sources of the user research.**

| Source | What it is | Participants |
|---|---|---|
| L-P1 to L-P3 | Interviews, recorded as the interviewer's notes in paraphrase | Final-year NUS students: Mechanical Engineering (one), Computer Science (two) |
| N-P1 to N-P5 | Two recorded interviews (N-P1, N-P2), one voice-recorded response (N-P3) and two responses prepared in advance (N-P4, N-P5), all transcribed | Year 3: Computer Science (two); Data Science and Economics; Global Studies; Mathematics (describing a graduate course taken on exchange) |
| L-T1 to L-T6 | AI study sessions shared with consent through a form, held with ChatGPT (three), Perplexity (two) and Claude (one): the full chat log (152 turns, 76 by the student) and the student's written account (their goal, what the AI did well, where it fell short, and any workarounds) | Programme not recorded; each session is treated as independent |

The interviews tell us why students use AI the way they do, but only as the students report it,
while the shared sessions show what students did without the reasons behind it. In the first study,
all 152 turns of the shared sessions had already been coded turn by turn by two AI coders working
independently, covering the student's level of engagement under ICAP (Chi & Wylie, 2014) and the
type of question asked, and 20 of the coded turns were sampled at random and reviewed by one of us.
For the joint analysis, the fourteen accounts (the eight interviews and the six written accounts)
were open-coded twice, independently, and the two sets of codes were merged into one codebook of 36
codes, in which each code also describes what it would look like in a chat log. Two further coders
then applied the codebook to all fourteen accounts, agreeing on whether a code was present with a
Cohen's κ of 0.93, and the six chat logs were coded with the same codebook, with each student's
written account compared claim by claim against their own log. It should be noted that every coder in both
passes was an AI model, so the κ reflects consistency between runs and should not be read as
agreement between human coders; the review of the 20 turns is the only human check so far.
*[Valerie: say here whether you have checked the coding of N-P1 to N-P5.]*

### 3.2 What we found

Five findings came out of comparing the two kinds of data (Table 2). The first two were introduced
in Section 1, so we concentrate here on the remaining three.

**Table 2. Findings of the joint analysis.**

| | Finding | From the interviews | From the shared sessions |
|---|---|---|---|
| 1 | The AI's help misses in both directions, and the direction depends on the task | "it often got too technical for me" (N-P3); "it skips so many steps that it doesn't tell you anything more than you already knew" (N-P1) | Notes came out too thin (L-T3, L-T4); explanations too technical, with 7 of 10 replies over 400 words (L-T2, L-T5); practice missed both ways (L-T6) |
| 2 | Students' effort exists, but stays outside the conversation | Students try first (N-P5, L-P1, N-P4) | 0 of 31 student turns held an attempt (L-T1 to L-T5); a quiz and code were run outside the chat (L-T1, L-T6) |
| 3 | The AI's feedback on a student's work is often wrong, and students do not raise it | Only N-P4 verifies, opening "every single linked source" | 12 of 21 judgements wrong in L-T6; the student challenged 2 |
| 4 | Help that works follows rules the student set up by hand | A teacher system prompt, at the cost of having to "babysit the AI" (N-P5); "It doesn't build the ladder for you" (N-P1) | "do not send the answer with the question" (L-T6); attempts 5 → 19 and answer requests 5 → 2 after the student's rule |
| 5 | What students report differs from what they did | — | In 4 of 6 sessions the student's written account left out or contradicted the log |

The third finding was not named by either of our individual studies. In the one session where the
student submitted their own work to be judged (L-T6), 12 of the AI's 21 judgements were wrong,
which we confirmed by running the student's database queries ourselves. Despite this, none of the
first study's interviewees and none of the six written accounts mentioned AI errors at all, and only one
interviewee described verifying what the AI said. We therefore treat feedback that is correct, or
that can at least be checked, as a need that students have but do not voice.

Fourthly, every case of AI help that worked well came with rules that the student had set up
themselves. N-P5 wrote a teacher system prompt and asked for hints only after thinking for half an
hour, while the student in L-T6 typed "I will attempt the question, and based on my attempt, you
can either increase or reduce the difficulty", after which their attempts rose from 5 to 19 and
their requests for the answer fell from 5 to 2, although the same message also asked for easier
questions. Students who did not know how to set up such rules
went without them, and those who did had to keep enforcing them.

Lastly, in four of the six sessions the student's written account left out or contradicted something in
their own log; for instance, the student in L-T6 reported asking for harder questions, while the
only request about difficulty in the log asks to lower it. This is why the user study in Section 5
measures behaviour from logs first, and only then asks students about it.

### 3.3 From needs to design goals

We restated the findings as seven user needs, which map onto five design goals and the features
that carry them (Table 3). One need, practice questions that stay in scope and adapt to the
student's results, was left out, as no design goal covers it.

**Table 3. From evidence to feature.**

| Need (evidence) | Design goal | Feature | Supporting literature | Earlier design it comes from |
|---|---|---|---|---|
| My attempt, in front of whoever is helping me (finding 2) | DG1: the student tries first | An answer slot under every part; whatever is in the slot is sent with each request for help | Chi & Wylie (2014); VanLehn (2011) | ChatterED A1: answering in place |
| A structure I can follow without having to build the tutor first (finding 4); help sized to what I am doing (finding 1) | DG2: when the student is stuck or gives up, the system recovers | Hints in three levels, a Refresher, and Show answer | Wood, Bruner & Ross (1976); Koedinger & Aleven (2007); Kapur (2008) | Nudge A1: the least explicit helpful move. ChatterED A1: releasing the answer by rule |
| Help that stays inside my course; feedback I can check (finding 3) | DG3: help traces back to the course material | Each part links to the lecture pages it draws on; replies quote the page they rest on | Lee & See (2004) | ChatterED A1: every line cites its slide |
| Help sized to what I am doing (finding 1) | DG4: short replies | One line under the part, the full reply in the part's thread; word limits on every reply | Grice (1975); Xu et al. (2026) | ChatterED A1 |
| What I make is mine (first study only) | DG5: only the student's own answer counts | Progress fills on a checked answer; Show answer fills nothing | Nearest: Bastani et al. (2025) | ChatterED A1: the progress rule |

Both of our individual designs had already separated what the model does from what code does. In
Nudge, the model only labels the student's reasoning, while a rule-based controller picks the least
explicit move that would help; in the earlier ChatterED, rules in code decided when an agent could
speak and when an answer was released. The hint levels in the combined system join these two ideas,
as code decides which level of hint comes next, starting from the least explicit, and the model is
only asked to write it. This arrangement is also our response to the fourth finding, since it makes
the rules that the successful students wrote by hand the default behaviour of the system. The fifth
goal has the weakest support of the five, as it rests mostly on the first study's data and has
little direct literature behind it, so we present it as a design stance.

## 4. The system

### 4.1 One task, four controls

The core task is working through a tutorial. The student adds the PDF of their own homework,
optionally together with the lecture it is based on and its solutions, and ChatterED reads it into
a workspace in which every part of every question has an answer slot beneath it (Figure 1). In our
field study, a two-page tutorial took about half a minute to read.

*[Figure 1. One part of a tutorial in the workspace: the question, the answer slot, the four
controls, and the part's thread beside it.]*

Each part has four controls. *Check answer* is available once something has been written in the
slot, and returns one of three verdicts (complete, partly there, or not yet) together with what is
right and what is still missing. *Hint* gives one level of help per press, in a fixed order; the
first points to where the relevant material is, the second breaks the part into smaller questions,
and the third works one step on a similar case. *Refresher* explains a concept that the part
depends on without working on the part itself. *Show answer* appears only after the part has been
checked at least once, and gives the answer at the cost of that part's progress, while hints cost
nothing. Each press appears as the student's turn in a chat thread that belongs to that part, where
an agent replies and the student can continue in their own words; only a single line is added
under the part itself, so that the homework stays readable. Two agents share the work, with Max
checking answers and giving hints, and Ellie giving refreshers and answering general questions.

### 4.2 What a hint looks like

Figure 2 shows the first two hint levels on one part, taken from a participant's session in the
field study. The first hint quotes the student's own wording and asks one question about it, while
the second lays out the argument as three smaller questions without stating any of their
conclusions. After the first hint, the student replied with a correct new step.

**Figure 2. Two hints on one part, from the field study (participant S04). The part asks why the
parent pointers left by a graph search form a tree.**

| Turn | Text |
|---|---|
| Student's answer in the slot | "These parent edges are only visited once and do not form a cycle." |
| Max, hint 1 (Point) | "The lecture doesn't work this one through, so the material is the sheet's own wording on p. 1, Problem 1.a. It says the parent pointer marks 'the very first time that a node was visited'. Your answer says the edges are 'only visited once'. Look at that phrase on p. 1 again: when a node gets its parent, which node is being given the pointer, and how many times can that happen to it?" |
| Student's reply in the thread | "A node can only get one parent." |
| Max, hint 2 (Break it down) | "Here are three smaller questions […] 1. When v is given u as its parent, how do u and v compare in the order they were first visited? 2. Start at any node and follow parent pointers repeatedly. Does each step go to a node first visited earlier or later than the one you just left? 3. Given your answer to 2, could that walk ever come back to a node it has already passed? Where must it end?" |

### 4.3 Conversation design

An open chat leaves the student to work out what can be asked and how to ask it. ChatterED instead
offers a small set of moves that are always visible, and keeps free typing for the student's own
reasoning. Table 4 sets out how the system handles the points on which a conversational interface
is usually judged.

**Table 4. Conversation design.**

| Aspect | How the system handles it |
|---|---|
| Making clear what it can do | The four controls are visible on every part. The Hint button names what the next press gives ("Hint 2 of 3, from Max: the part as two to four sub-steps"), and Check answer states what it will return |
| Turn-taking | A press is shown as the student's turn ("Hint, please: Problem 1 b)"). One reply per turn, and one turn at a time. Most replies end with one question for the student to take up |
| Preventing errors | Check answer is disabled while the slot is empty ("Write an answer first"). Show answer asks for confirmation and says that the part will not count |
| When the system may be wrong | The status under a part says whether code or Max marked it. When the answer key is uncertain, Max says that "the official solution may differ" |
| Off-topic input | Declined in one sentence, with a return to the part (tested: "Any good bubble tea near NUS?") |
| Ambiguous input | A clarifying question (tested: "this one?" received "I'm not sure which one you mean…") |
| Attempts to override it | The verdict held in 9 of 9 replies against an instruction typed into the answer, an instruction hidden in the homework, and "my lecturer confirmed it" |

The last three rows come from a test of twelve attacks that we ran on the submitted build
(Appendix X). The same test and the field study showed two faults in how the system describes
itself, which we were unable to fix before submission. Firstly, the agents refer to the homework as
"the lecture" or "the deck" even when no lecture has been added, as the first hint in Figure 2
does. Secondly, when asked how she differs from Max, Ellie describes a group conversation that
belonged to an earlier design.

### 4.4 Architecture and key technical decisions

ChatterED is a desktop application for macOS, built with Electron, with a Svelte interface, a
ProseMirror document for the homework, and a local SQLite database. Nothing is stored on a server,
and the only data that leaves the machine is the text sent to the language model, which in the
study builds was Claude Sonnet through the Anthropic API. The rules of tutoring are kept in a small
core module that makes no model calls and touches neither storage nor the clock, so that each rule
can be tested on its own.

The principle behind the main decisions is that the model proposes while code decides (Table 5).
It is important to be precise about how far this holds. Code decides the order of the hints, when
Show answer is offered, and how much progress a part earns. For marking, on the other hand, code
decides only where the answer can be computed, namely planning problems that can be simulated and
multiple-choice parts with a confident answer key; every other answer is marked by the model
against a hidden answer key. That key is taken from the official solutions if the student has
added them, and is otherwise written by the model when the homework is read. In the latter case
the model solves each part a second time without seeing the key, and a disagreement between the two
marks the key as uncertain, which Max then discloses. Similarly, a hint is kept from giving the
answer away by leaving the answer out of what the model is shown until Show answer is pressed, and
by instruction; no code inspects a hint for a leaked answer. Section 6 reports how the replies held
up in real use.

**Table 5. Where the model proposes and code decides.**

| Decision | The model | Code |
|---|---|---|
| Which hint comes next | Writes the hint for the level it is given | Picks the level, in order; three levels and no more |
| Marking an answer | Marks answers that cannot be computed, against the hidden key | Simulates planning answers; compares multiple-choice answers with a confident key |
| The answer key | Writes a key, then solves each part again without it | Marks a key as uncertain when the two disagree; replaces it with the official solutions when they are added |
| Showing the answer | Writes the explanation once the answer is released | Offers Show answer only after a first check; the answer is absent from every earlier prompt |
| Links to the lecture | Proposes the pages and notes a part draws on | Keeps only pages and notes that exist |
| Progress | — | Full for a correct answer, half for a partly correct one, none after Show answer, whatever hints were used |

### 4.5 Iterations

The workspace went through three versions (Table 6). Before the field study, two students outside
the team worked through their own tutorial questions in an informal pilot, which found two
problems. Firstly, Max's written feedback could contradict the verdict of a verified answer key,
which we resolved by having one marking result drive both the verdict and the feedback. Secondly,
the second version showed the original PDF beside separate answer boxes, which kept the student's
working apart from the question and its diagrams, so the third version returned to a single
combined page with the PDF one click away.

**Table 6. Iterations of the workspace.**

| Version | What it was | What changed, and why |
|---|---|---|
| 1 (3 Oct) | The homework re-typeset with an answer slot under each part, docked beside the lecture notes | — |
| 2 (26 Oct) | The original PDF beside a separate working area | Some PDFs have figures that the re-typeset page did not reproduce reliably |
| 3 (31 Oct) | One combined page; the original PDF opens beside it on request | Pilot: answer boxes were separated from the question |
| 31 Oct | Show answer appears only after a first check | Team testing and pilot: gives the student a first attempt before the option to give up |
| 26 Oct to 1 Nov | Help menu removed; all four controls always visible; model usage figures and duplicate tabs removed | Pilot: too much to scan |
| 19 Nov | Long exam papers are read in sections | A participant's 35-page paper failed to import during the field study |

Two of these changes carry a cost that we return to later. Offering Show answer only after a first
check invites a token attempt, which Section 7 discusses, and the fix of 19 Nov means that the
build was not identical for every participant, which Section 5 states. Several features of the
earlier designs remain in the application, such as summary notes, quizzes and search, but they are
outside the core task and we make no claims about them in this report.

<!--
NOTES FOR LUCAS AND VALERIE (delete before submission)

1. Scope. "The next part" is read as the next rubric component, System design and implementation:
   report sections 3 and 4. Section 5 (the user study) is the part after this.

2. Length. The outline budgeted 700 + 900 words; this is about 770 + 950. Tables and the two
   figures are not counted. First places to cut: the last paragraph of 3.2 (the said-against-did
   example), and the closing paragraph of 4.5.

3. Where each number comes from.
   - Section 3: docs/group/joint-analysis.md (sources and programmes §1; method and kappa §2;
     findings §3.1 to §3.5; needs §4) and docs/group/group-project.md §2 to §4 (goals, features).
   - Section 3.1 was fact-checked on 23 Nov, first against the mid-project deck as presented
     (docs/group/midterm-presentation/ChatterED_MidProject.pdf, pages 5, 6, 19, 20), then against
     both A1 reports as submitted and the coding files. From the deck: 8 interviews, none on the
     team; programme and year of each; 6 chats shared with consent, 152 turns, ChatGPT, Claude and
     Perplexity; "each with the student's own written account"; 14 accounts. NOT in the deck, and
     taken from elsewhere: "76 by the student" and the split by tool (counted from the processed
     logs: 6+10+1+10+4+45 student turns); the turn-by-turn coding and the 20 reviewed turns
     (Lucas's A1 report, section 1.1); the make-up of N-P1 to N-P5 (Valerie's A1 report: "two
     recorded interviews, one voice-recorded response, and two prepared responses"); the whole
     joint-coding method, 36 codes and kappa 0.93 (joint-analysis.md §2; joint-analysis/
     agreement.txt gives 0.925 on 504 cells; codebook.md has 36 codes). The deck never showed
     the coding method or kappa.
   - Corrected in 3.1 on 23 Nov: "NUS" removed for the eight (only Lucas's A1 says NUS, of his
     three; Valerie's says "adult university students"); the N- row no longer says "Interviews,
     transcribed"; "all coders were the same AI model" now covers both codings and names the one
     human check.
   - Figure 2 and "about half a minute": docs/group/field-results.md §2.5, §4.1, §5.1.
   - Table 4, last three rows: docs/group/red-team/README.md §3.1, §3.6.
   - Section 4.4 and Table 5 were checked against the code on 23 Nov: app/src/core/tutor.ts (hint
     order, credit), app/src/main/tutorial/check.ts (marking order), app/src/main/tutorial/prompt.ts
     (key, second solve, solutions), app/src/room/prompts.tutor.ts (answer only in the reveal
     prompt), app/src/renderer/lib/pm/tutorialmodel.ts line 103 (Show answer after one check).
   - Table 6: docs/research/tutorials.md §10 to §14, docs/group/field-study.md (pilot), issue #72.

4. Check before submission.
   - Nudge's design in 3.3 ("the model only labels… a rule-based controller picks the least
     explicit move") is taken from AGENTS.md, which says that summary is Lucas's and Valerie should
     correct it. Valerie to confirm the wording.
   - "which we confirmed by running the student's database queries ourselves": joint-analysis.md
     says 11 of the 12 wrong judgements were refuted by running the queries. Say "11 of which we
     confirmed" if you want the exact figure.
   - The 3.1 placeholder: whether a person has checked the coding of N-P1 to N-P5.
   - Table 3, DG3: no field participant added a lecture, so the links were never used in the study.
     Section 6 has to say so; the table describes what is built.
   - Table 3 literature column: Rowland (2014) was in the outline for DG1 and is left out here
     because I could not confirm the reference. Add it back if you have it. Kapur (2008), Lee & See
     (2004) and Grice (1975) need entries in the reference list.
   - Figure 1 needs a screenshot cropped to one part. docs/group/red-team/shots/02-tutA.png is a
     clean one on our own test homework.
   - Figure 2 uses a participant's typed lines. They are already in the committed results record;
     confirm you are content to print them.
   - Figure 2 contains the word "sheet" inside Max's quoted reply. It is a quotation, so it stays.
   - "Appendix X" is the red-team record; number it when the appendices are fixed.
   - Table 6 dates for versions 1 and 2 are the dates of the design notes, not of a release.
   - "Claude Sonnet through the Anthropic API" matches the three exports (claude-sonnet-5-5,
     backend anthropic). The README must say the same.
   - I left out a test count: the only figure in the repo docs is out of date.

5. On the open point in section 1 ("if the answer may be shown"). In the code the Show answer
   button is offered only after the part has been checked once (tutorialmodel.ts line 103; the
   red-team run saw the same). The main process does not check this again, which may be what
   "never locked" referred to. So the sentence in section 1 is true if it reads "when the answer is
   offered". I have not changed section 1.

6. Not used, on purpose: the hint-ladder usage figures from the field study (25 checks against 6
   hints). They belong in Section 6.
-->
