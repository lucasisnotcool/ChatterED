# Mid-project presentation: brief for building the deck

**For:** the Claude session that will build the slides with Lucas, using his past decks for style.
**Presenters:** Lucas Loh and Valerie [VALERIE: full name as she wants it shown] (2 people). **Slot:** CS3249 Week 7 tutorial
(28 Sep – 3 Oct 2026). **Length:** 10 minutes presenting, then 5 minutes of Q&A. Timing is
strictly enforced.
**Compiled:** 1 Oct 2026, from the course's own requirement texts and the shared ChatterED repo.
**Revised 4 Oct 2026:** Slides 2–8, 10–12 and 14, and Parts 4, 5, 7.2, 8 and 9.3 now rest on
`docs/group/joint-analysis.md`, which codes both A1 datasets as one and checks them against the
logs.
**Superseded in part, 5 Oct 2026:** read `docs/group/group-project.md` first. These are replaced:
- the design goals (now the five frozen with Valerie: tries first · gives up → recovers · traces to
  the slide · short, sized to the task · only your own words count);
- the needs (JN4 cut, JN3 only inside DG3);
- the features (the tutorial sheet: answer slots, the help ladder, lecture links);
- the "planned" verdict items (dropped);
- the "no extra features" line.

The evidence, literature, architecture and Q&A below still stand.
**Status:** this is group material, but Valerie has not reviewed it yet. Items marked
**[VALERIE]** need her to confirm them before the deck is final.

How to use this file: Part 1 is the requirement, quoted. Part 2 has the decisions already made,
and you should not reopen them. Part 3 is the slide-by-slide spec, with on-slide text, visuals and
a full speaker script. Parts 4–7 are the content the slides draw on: evidence, literature,
architecture and plan. Part 8 has Q&A preparation. Part 9 lists the assets and what to leave out.

---

## Part 1. The requirement, word for word

### 1.1 The instructor's announcement (Canvas, Yi-Chieh (EJ) Lee, posted 23 Sep 2026; the newest and authoritative source)

> **Final Project Goal.** Your team will design, develop, and evaluate a conversational user
> interface (CUI) for a specific group of target users. Each graded milestone corresponds to one of
> these three stages:
> - Design: identify real user problems through user research and literature, and justify why a
>   conversational interface is a good fit.
> - Develop: build a working CUI system that supports your users' core tasks.
> - Evaluate: test the system with target users, and reflect on what the results mean for design
>   and ethics.
>
> **Grade Distribution (40% total).** Mid-project presentation: 10% (Sep 28, Week 7). Final
> presentation: 10% (by Nov 11, Week 13). Final report: 10% (due Nov 23). Functional CUI system:
> 10% (due Nov 23).
>
> **1. Mid-Project Presentation (10%): 10 min presentation, 5 min Q&A**
> - **Clarity of topic, problem statement, and design goal (4%):** user research with at least 3
>   target users, plus a literature review of related research and existing systems.
> - **System design and architecture (2%):** a low-fidelity prototype (e.g., sample dialogues,
>   conversation flow, interface sketches) and your planned architecture.
> - **Project plan and work division (2%):** feasibility, a timeline to the final presentation, and
>   each member's role.
> - **Presentation quality and Q&A (2%):** time is strictly controlled, so come prepared.
>
> **2. Final Presentation (10%): 15 min presentation, 5 min Q&A.** Design iteration (2%): what
> changed since the mid-project presentation, and why. System demonstration (2%): a live demo of
> the core task, with a recorded backup. User study and findings (4%): at least 3 participants from
> your target group, your study method, key findings, and what you would change. Presentation
> quality and Q&A (2%).
>
> **3. Final Report (10%): 4000–7000 words.** Introduction and related work (2%). System design and
> implementation (2%): user research with at least 6 target users, design rationale, conversation
> design, architecture, key technical decisions. User study and results (4%): at least 6
> participants, measures, analysis, evidence. Ethical and design implications (2%).
>
> **4. Functional CUI System (10%).** Core functionality (3%), conversation design and UX (3%),
> technical quality (1%), innovation (3%): "solves a nontrivial technical challenge or offers a
> distinctive design solution".

### 1.2 The Lecture 6 slide (14 Sep), and what the instructor said about it in class

Slide: *Mid-presentation (10%): 10 mins presentation, 5 mins QA · Clarity of Topic & Problem
Statement (4%): User Research (3 for mid-presentation, 6 for final presentation); Literature
Review · System Design (low-fi prototype) & Architecture (2%) · Project Plan and Work division
(2%): Feasibility, Timeline · Presentation Quality & Q&A (2%): Time Control (strict),
Preparation.*

What he said, paraphrased from the lecture recording:
- The 3 user-research participants **must not be team members**. The final needs 6.
- The literature review should argue that the topic is **interesting, important and
  innovative**. Google Scholar is recommended, and the two weekly course readings count.
- The low-fi prototype shows **what the system looks like**, and AI-built or pen-and-paper are
  both fine. Show it **plus the system architecture**.
- The plan is judged on **whether the timeline is reasonable**.
- Presentation quality includes **how you handle Q&A**.

### 1.3 What the instructor told this team at Consultation 1 (16 Sep). The audio was poor, so treat this as approximate.

- Make learning **interactive and social**, not a tool that hands out answers.
- He described learning SQL by **comparing different explanations** and working it out himself,
  and he wants that culture in the design.
- Name the **too-helpful tutor** tension: keep the work with the student while keeping the
  experience positive.
- Ground the design in users' **current challenges and current workarounds**, then judge whether a
  better solution exists. **Survey existing products.**

He has since agreed (consulted 1 Oct) that **merging the two members' designs into one CUI is a
substantial challenge in itself**. The group project is that merged app.

### 1.4 Where the 10 minutes and the marks go

| Rubric block | Weight | Slides | Presenter | Time |
|---|---|---|---|---|
| Topic, problem, design goal, user research, literature | 4% | 1–8 | Lucas | 5:00 |
| Low-fi prototype and architecture | 2% | 9–13 | Valerie | 3:40 |
| Plan, timeline, roles | 2% | 14–16 | Valerie | 1:20 |
| Quality and Q&A | 2% | all, plus backups | both | — |

The split follows the rubric, as Lucas decided: Lucas presents the 4% block, and Valerie presents
design, architecture and plan. Hand-over happens at 5:00.

---

## Part 2. Decisions already made (do not reopen in the deck)

| Topic | Decision | Source |
|---|---|---|
| Product name | **ChatterED** | Lucas, 1 Oct (#63) |
| What the group builds | **One CUI that merges the two Assignment 1 designs**: ChatterED (Lucas) and Nudge (Valerie). It is one app in one repo. There are no extra planned features beyond the merged app; the prof accepted that merging is the challenge. | 1 Oct, after consulting the prof |
| Target users | **NUS undergraduates revising lecture material and working tutorial or proof problems with general-purpose AI chat** | Lucas, 1 Oct |
| Give-up policy | **Always release the answer, and pitch the next question lower.** A released answer fills no progress. The next question is easier, for example one sentence from the slide with one term blanked. | Lucas, 1 Oct (#60). Nudge's A1 held the boundary instead; see Q&A |
| Content | **Any lecture deck**, with provenance to each slide. The **demo and study use a proof-heavy algorithms deck**. Authored problems (for example StoogeSort, adapted from CS3230 Tutorial 3) enter as authored content. | Lucas, 1 Oct (#61) |
| Platform | **Undecided: a web app or a macOS desktop app.** Today's prototype is a macOS Electron app. The agent logic is portable either way (Part 6). Decide by the end of Week 8. | Lucas, 1 Oct (#59) |
| Build roles | **Valerie owns Max**, the agent that quizzes, from Week 8, together with the learner-turn logic Max runs on. Lucas keeps the rest. See Slide 15. | Lucas, 1 Oct; **[VALERIE] to agree** |

Lucas also wants Valerie's part stated **plainly**. Do not inflate a small piece of work into
something that sounds complex, in her section or anywhere else.

---

## Part 3. The deck, slide by slide

Total: **16 slides plus 5 backups.** At about 135 words a minute, the scripts below come to about
1,340 words, which fills 10 minutes. Keep on-slide text short. The scripts carry the detail.

Visual identity: reuse Lucas's past-deck style. The app's own colours: **Ellie is green**
(`#2A7547`), **Max is red** (`#A93434`), and the learner's text is a **yellow highlight**
(`#F4DC62`). Keep these consistent wherever an agent or the learner appears.

Evidence ids: **L-** marks Lucas's A1 participants, **N-** marks Valerie's. Use them on the
slides, never names.

---

### LUCAS · 0:00–5:00

#### Slide 1. Title (0:00–0:15)
- **On slide:** *ChatterED: AI study help where the learner reasons first.* Below it: CS3249
  Mid-Project Presentation · Lucas Loh · Valerie [full name] · Week 7.
- **Visual:** one clean screenshot of the app (overview + chat), or the three-column wireframe
  from Slide 9 in miniature.
- **Script (≈30 words):** "Hi, we're Lucas and Valerie. Our project is ChatterED, a study tool
  where you and two AI agents work in your lecture notes together, and you do the reasoning."

#### Slide 2. Hook (0:15–0:45)
- **On slide:** two lines, large, one above the other:
  - **Said:** *"some questions were too easy … I passed it example questions and asked for more
    difficult questions."*
  - **Did:** *"please lower the difficulty."*
  - Small text: *One student's form answer, and the same student's chat log · 8 interviews + 6 real AI
    study sessions, analysed as one dataset.*
- **Visual:** the two lines in contrasting colours, "said" in grey and "did" in the learner's yellow.
- **Script (≈75 words):** "One student shared a real AI study session with us. On the form, they said
  the practice questions were too easy, so they asked for harder ones. In the actual chat log, the
  only time they ask for a change in difficulty, they write: 'please lower the difficulty.' That gap,
  between what students say about studying with AI and what they do, is why we pooled both our
  datasets and checked one against the other."
- **Accuracy:** the log's only explicit difficulty request is L20 ("please lower the difficulty");
  L34 says "this query seems too complex". There is a quick correct streak (L36–L38), so "some
  questions were too easy" is partly true. Don't claim the form was wrong about everything.

#### Slide 3. Problem, users, design goal (0:45–1:25)
- **On slide:**
  - **Who:** NUS undergraduates revising lecture material and working tutorial or proof problems
    with general-purpose AI chat.
  - **Problem:** the learner's own attempt never reaches the AI, so the AI answers the question as
    worded, at the wrong level, and the learner ends up steering the AI instead of reasoning.
  - **Our two A1s each saw one half:** *scaffolding-calibration burden* (Valerie): help can't fit
    reasoning the AI never sees → *misdirected persistence* (Lucas): so the learner persists at
    steering. Pooled, they are cause and effect.
  - **How might we** put the learner's own attempt where the help happens, so the help fits and their
    effort goes into the next step?
  - **Design goal:** the learner reasons first, in shared notes; code decides how much help; every
    verdict shows its grounds; only the learner's own words count.
- **Visual:** a three-step chain: *attempt off the record* → *AI can't calibrate* → *learner steers*,
  with each A1's name under its step.
- **Script (≈105 words):** "Our users are NUS undergrads revising with AI chat. Each of us studied
  them separately for Assignment 1. Valerie found the scaffolding-calibration burden: the student has
  to notice the help doesn't fit their reasoning and steer it by hand. I found misdirected
  persistence: students persist at getting the AI to explain better, not at the material. Pooling
  the data showed why. The student's attempt never reaches the AI, so it can't calibrate, and the
  student steers instead. One is the cause of the other. So our goal: the learner reasons first,
  where the help happens, and code decides how much help."

#### Slide 4. User research: one dataset (1:25–2:05)
- **On slide:** two rows.
  - **Data:** 8 interviews (L-P1–L-P3: Mech Eng, CS, CS, all Y4; N-P1–N-P5: CS, CS, Data Sci & Econ,
    Global Studies, Mathematics, all Y3), **none on the team**. Plus 6 real AI study sessions (152
    turns), each with the student's own form answer *and* the full log. **[VALERIE] method line:**
    how her five were recruited and run.
  - **Method:** two blind open codings → one 36-code codebook → two independent coders (κ = 0.93) →
    the same codes applied to the logs → **said vs did**, session by session.
  - Footer: *8 target users interviewed (rubric minimum: 3) · interviews give reasons, logs give
    behaviour.*
- **Visual:** a left-to-right pipeline of the method steps, under the participant chips.
- **Script (≈80 words):** "Eight students interviewed, none on our team, across five programmes, plus
  six real AI study sessions, where we have both the student's account and the full log. We coded
  all of it as one dataset. Two coders worked blind to our earlier findings, we merged their codes
  into one codebook, and two more coders applied it independently, with high agreement. Then we
  coded the logs with the same codes, so we could set what students said against what they did."
- **Honesty note, if asked about κ:** all coders were runs of one AI model, so κ is consistency
  between runs, not human agreement. Valerie checking her own participants' codes is the human step.

#### Slide 5. What we found together (2:05–3:35), the heart of the 4% block
- **On slide:** three findings. Each card has two halves: **interviews say** | **logs show**.
  1. **Pitched to the question, not the learner, both ways.**
     - *Say:* too technical (N-P3, L-P1); skips steps (N-P1); *"two extremes"* (N-P1).
     - *Do:* notes came out too thin, explanations too technical, practice off in both directions.
       Even with the course files loaded, one session got jargon and a misread slide.
  2. **The effort happens off the record.**
     - *Say:* thinks *"at least 30 mins"* first (N-P5); tries the tutorial first (L-P1).
     - *Do:* 0 of 31 turns held an attempt in five sessions. But a quiz was taken and code was run
       outside the chat, and answer requests came only after a median of 7 minutes, and up to 3
       hours.
  3. **Feedback on their work is often wrong, and nobody mentions it.**
     - *Do:* 12 of 21 AI verdicts on one student's SQL were wrong, checked by running them. The
       student contested 2.
     - *Say:* no interviewee or form raised AI errors, except one student who opens every source.
- **Visual:** three cards, each split down the middle. Finding 3 is tagged ***found only by
  cross-checking***.
- **Script (≈205 words):** "Three findings, each from both sources. First, the help is pitched to the
  question, not the learner, and it misses both ways. Students told us it's too technical, or that
  it skips steps, or both: 'two extremes'. The logs show the direction follows the task. Notes came
  out too thin, explanations too technical. And even when the AI had the course files, one student
  still got jargon and a misread slide. Second, the effort happens off the record. Students told us
  they try first, one for at least thirty minutes. In five of the six logs, not one student turn
  holds an attempt. But the logs show quizzes taken and code run outside the chat, and answers asked
  for only after minutes or hours. The AI never sees the attempt, so it can't pitch to it. Third,
  and only visible because we had both: in the one session where a student did submit work, the
  AI's verdicts were wrong twelve times out of twenty-one, mostly telling them correct SQL was
  wrong. We checked by running every query. The student contested two. And not one interviewee or
  form mentioned AI errors. It's a need nobody says out loud."
- **Accuracy:**
  - "0 of 31" is learner turns in sessions L-T1 to L-T5.
  - The median of 7 minutes is L-T6's same-sitting answer requests. The 3 hours is L45.
  - 12 of 21 is 10 false objections plus 2 false "completely correct" verdicts; 11 were refuted by
    execution and 1 by the transcript.
  - The source for all of these is `joint-analysis.md` §3.
  - **[VALERIE]** confirm each N- quote word for word, and that it may be shown.

#### Slide 6. Seven needs (3:35–4:10)
- **On slide:** the needs matrix, with seven needs as rows and the 14 sources as columns (8
  interviews, then 6 logs). The full grid is in Backup B2.
  - JN1 Help sized to what I'm doing and already know
  - JN2 My attempt in front of whoever is helping
  - JN3 Feedback that's right, or that I can check ← *new*
  - JN4 Practice that stays sharp, in scope, and moves with me
  - JN5 Help inside my course: its slides, methods, what's tested
  - JN6 A structure I can follow, or drive myself
  - JN7 What I make is mine and builds up
- **Visual:** a dot matrix with a vertical rule between the interviews and the logs, and JN3's row
  highlighted.
- **Script (≈80 words):** "Together that gives seven needs. Help sized to what I'm doing and know. My
  attempt in front of whoever's helping. Feedback that's right, or that I can check, the new one.
  Practice that stays sharp and in scope. Help inside my course. A structure I can follow, or drive
  myself: the students who did well had built their own tutoring rules. And what I make is mine.
  Some needs only one of us heard in interviews; the logs confirmed them."

#### Slide 7. Literature and existing systems (4:10–4:45)
- **On slide:** two halves.
  - **What research says → what we take**
    - Constructive and interactive engagement beats passive reading (Chi & Wylie, 2014) → the
      learner answers first.
    - Retrieval practice with feedback improves retention (Rowland, 2014) → Quiz me on any line.
    - Scaffolding narrows the task until the learner can manage it (Wood, Bruner & Ross, 1976) →
      a give-up lowers the next question.
    - Unrestricted GPT-4 raised practice scores 48% but cut exam scores 17% (Bastani et al.,
      2025, PNAS) → help limits live in code, not in a prompt.
    - More AI note-taking help, less engagement (Chen et al., 2025) → a short overview the learner
      builds on.
    - An agent's pedagogical role shapes learning (Xu et al., CHI '26, a course reading) → two
      roles: Ellie explains, Max tests.
    - More agents add social pressure (Song et al., 2025, a course reading) → two agents at most,
      never both correcting the learner.
  - **Existing systems:** ChatGPT Study Mode · Gemini Guided Learning · Microsoft Study and Learn ·
    Khanmigo · NotebookLM. **Gap:** each is one assistant in a chat *beside* the material. How much
    help to give is left to the prompt, the learner's work is never the shared artefact, and
    verdicts on the learner's work come without checkable grounds.
- **Visual:** a left list with arrows into a right "ChatterED" column, and a small comparison strip
  for existing systems (rows: two roles / answer-first / help decided in code / slide provenance /
  learner's text protected / verdicts show grounds).
- **Script (≈85 words):** "The literature backs the direction. Learners gain more by constructing than
  by reading, and by testing with feedback. Good tutors scaffold. And unguarded AI is a real risk: in
  a large field study, GPT-4 raised practice scores but cut exam scores by 17 percent. Two course
  readings shape our agents. Existing study modes, from ChatGPT to NotebookLM, are one assistant
  beside your material, with the help limits in a prompt and no checkable grounds for their
  verdicts. That's the gap."
- **Before the deck goes out:**
  - Check each product claim against its current page; these products change monthly.
  - Bastani et al. is PNAS 122(26), 2025.
  - **[LUCAS]** if there is room, add one source on over-trust in AI feedback, to back JN3. Use only
    a paper you have read.

#### Slide 8. Why a conversational interface, and our design goals (4:45–5:00)
- **On slide:**
  - **Why a CUI:** tutoring is turn-taking. Ask, attempt, feedback, repair. Only a conversation can
    ask back and wait for your attempt. A chat alone loses the attempt, so the conversation lives
    *in the notes*.
  - **DG1** Learner tries first, in the notes (JN2) · **DG2** Help sized from your work; a give-up
    recovers (JN1, JN6) · **DG3** Every line traces to the slide, inside the course (JN5) · **DG4**
    Every verdict shows its grounds (JN3) · **DG5** Only your own words count (JN7).
- **Script (≈45 words):** "Why conversational? Because tutoring is turns: ask, attempt, feedback.
  But a chat on its own loses the attempt, so we put the conversation inside the notes. Five design
  goals follow from the needs. Valerie will show you what that looks like."

---

### VALERIE · 5:00–10:00

#### Slide 9. Low-fi prototype: the screen (5:00–5:45)
- **On slide:** a **grayscale wireframe** (low fidelity, as the rubric asks) of three columns:
  - **Sources** (left): the notebook's files, each with a tick for "use this"; drop zone.
  - **Learning overview** (centre): title, a lede, *By the end you can*, then sections. Each has a
    one-line takeaway, 2–3 key ideas each cited to a page (chip "p. 7"), and an empty *your note*
    box. Hovering a line shows four buttons: **Explain · Example · Quiz me · Ask**.
  - **Chat** (right): Ellie (green) and Max (red) in one thread; private tabs for each.
  - Top: a progress bar that fills **only on your own words**.
- **Visual:** draw it, with labels and arrows. Put a small inset of the real app beside it with
  the caption *already running*. A fresh screenshot is needed (Part 9).
- **Script (≈95 words):** "Here's the screen. On the left, your notebook: drop in lecture
  slides and tick which ones count. In the middle, not a wall of AI notes but a short learning
  overview, about 350 words for a 60-page deck, every line cited to its slide. You build the notes
  from here: every line has Explain, Example, Quiz me and Ask. On the right, two agents. Ellie, in
  green, explains. Max, in red, tests you, but only when you press Quiz me. And the progress bar
  fills only on what you write."

#### Slide 10. Sample dialogue (5:45–6:45)
- **On slide:** one exchange, as chat bubbles with the doc beside it. It is illustrative, written
  to the app's rules, on a proof-heavy deck. **[VALERIE]** check it against Nudge's StoogeSort
  material and adjust the wording.

  > *Overview line, p. 7:* StoogeSort sorts the first two-thirds, then the last two-thirds, then
  > the first two-thirds again.
  >
  > **Learner** presses **Quiz me** on that line.
  > **Max:** After the first two calls, why are the largest third of the values already in their
  > final places? *(p. 7)* ← also appears as a question block under the line
  > **Learner** (typing in the question block): because call 2 sorts the back part
  > **Max:** **Partly there.** Call 2 does sort the back two-thirds, but that doesn't show the
  > largest values were *in* that range when call 2 started. *p. 7: "the calls overlap"*. Where
  > can a large value be after call 1?
  > **Learner:** idk just tell me
  > **Max:** Here's the answer. Call 1 pushes any large value out of the front third into the
  > middle third, which call 2 also sorts, so call 2 carries every large value to the end, in
  > order. *(p. 7)* An easier one: Call 2 sorts positions ___ to n.
  > *(Progress bar: unchanged. A released answer fills nothing.)*

- **Visual:** colour the bubbles: learner yellow, Max red. Annotate in the margin with the rule
  that fired: `Quiz me → max asks`, `attempt → quiz_feedback`, `give-up → answer_released, next
  question easier`.
- **Script (≈115 words):** "One exchange. The learner presses Quiz me on a line about
  StoogeSort. Max asks one question, and it also lands in the notes, under that line. The
  learner answers right there. Max's feedback starts with a verdict, partly there, quotes the
  slide, and narrows the same question rather than moving on. In our logs, AI verdicts on a
  student's work were wrong more often than right, so Max's always shows what it rests on. Then the learner gives up. We
  chose to always release the answer: a student who can't keep up just leaves. But the answer
  fills no progress, and the next question is easier, a fill-in-the-blank. Every label in the
  margin is a rule in code, decided before any model is called."

#### Slide 11. Conversation flow (6:45–7:20)
- **On slide:** a flow diagram. Draw it from this:

  ```
  Line in the overview
   ├─ Explain / Example / Ask ──▶ Ellie: full answer in chat + ONE line (≤25 words) under that line [Keep | Remove]
   └─ Quiz me ──▶ Max asks one question (chat + question block)
                    │  learner turn, classified in code
                    ├─ attempt ──────▶ verdict (Well done / Partly there / Not yet) + slide quote
                    │                    ├─ Well done → objective fills
                    │                    ├─ otherwise → same question, narrowed
                    │                    └─ "I think I'm right" → re-checked against its grounds (planned, JN3)
                    ├─ clarifying question ▶ Max clarifies; question stays open
                    ├─ give-up ("idk", Pass) ▶ answer released, fills nothing → easier next question
                    └─ silence ──────▶ Ellie's guess ("she might be wrong") → Max asks again
  Anywhere: an agent edit to the learner's text becomes a suggestion (Accept | Reject). Freeze stops all agent edits.
  ```
- **Script (≈80 words):** "The whole flow on one slide. Explain, Example or Ask goes to Ellie:
  the full answer in chat, and one line, at most 25 words, in your notes, which you can keep or
  remove. Quiz me goes to Max, and code classifies your reply: an attempt gets a verdict, a
  question gets clarified, a give-up gets the answer and an easier question, and silence gets a
  half-right guess from Ellie for you to correct. And no agent can overwrite your words. It can
  only suggest."

#### Slide 12. From needs to features (7:20–7:50)
- **On slide:** a compact trace table, from needs to features (full version in Part 5). Items marked
  *planned* came out of the joint analysis and are not built yet.
  - JN1 sized → Explain/Example on any line; the next question rises or falls with your results;
    *planned:* pitch read from what you've written
  - JN2 your attempt → answer in place, in the question block; *planned:* a "what I tried" line
    before asking
  - JN3 checkable feedback → every verdict quotes its slide; *planned:* "I think I'm right"
    re-check; a wrong verdict never counts against you
  - JN4 practice → Quiz me anywhere; your own questions; *planned:* no recycled questions, course
    methods only
  - JN5 inside the course → every line cited; slide preview on hover
  - JN6 structure → a short overview with *By the end you can*; progress by objective; attempt
    first by default
  - JN7 yours → never overwritten; Keep/Remove; progress only on your words
- **Script (≈70 words):** "Each feature traces to a need. Sized: you choose Explain or Example,
  and Max's next question moves with your results. Your attempt: you answer in the notes, where the
  agents can see it. Checkable feedback: every verdict quotes its slide, and next we'll let you
  challenge one. Practice: Quiz me on any line. And structure by default, so you don't have to build
  your own tutor."

#### Slide 13. Architecture (7:50–8:40)
- **On slide:** a layered diagram. Draw it from Part 6. Headline: ***The model proposes, code
  decides.***
  - **UI:** sources · overview editor (ProseMirror) · chat
  - **Rules (code, before any model call):** who speaks, when feedback is owed, release on
    give-up, the guard on learner text, progress
  - **Shared core (pure TypeScript):** what a learner turn *is* (attempt / give-up / question),
    the level of the next question, how much of an answer is the learner's own words
  - **Model calls:** write the overview, the words of each turn, a one-line doc edit
  - **Storage:** local SQLite event log; sources copied into the app
  - **LLM backends:** the local Claude CLI by default, or the learner's own API key (Anthropic,
    OpenAI, Gemini, or an OpenAI-compatible endpoint)
  - Side note: **Platform: web or macOS desktop, decided by Week 8.** The rules and the core are
    portable, which a lint rule enforces.
- **Script (≈105 words):** "The architecture's one principle: the model proposes, code decides.
  Who speaks, whether feedback is owed, when an answer is released, what counts as progress: those
  are rules in code, tested, and run before any model is called. The model only writes words: the
  overview, each turn, a one-line edit. Underneath is a small pure core that decides what a
  learner's turn is, an attempt, a give-up or a question, and how hard the next question should
  be. It merges both our A1 designs, since both needed it. The core and the rules are portable, so
  whether we ship on the web or as a Mac app is a shell decision we'll make by Week 8."

#### Slide 14. Timeline to the final presentation (8:40–9:20)
- **On slide:** a week strip, Week 7 to Week 13 + 23 Nov:

  | Week | Dates | Milestone |
  |---|---|---|
  | 7 | 28 Sep–3 Oct | ✔ One merged app and repo (1 Oct) · ✔ notebooks + learning overview built · mid-presentation |
  | 8 | 5–9 Oct | Platform decided (web vs Mac) · Max handed to Valerie · both running the same build · Valerie checks the joint coding of her participants |
  | 9 | 12–16 Oct | Proof-heavy demo deck · verdict grounds and the "I think I'm right" re-check · question quality checks · system testing with simulated learners · pilot with 1–2 students |
  | 10 | 19–23 Oct | Consultation 2 · usability test + ethics check · fixes |
  | 11 | 26–30 Oct | **User study, ≥3 target users** (none on the team) |
  | 12 | 2–6 Nov | **Final presentation**: live demo + recorded backup |
  | 13 | 9–13 Nov | Study extended to ≥6 · report and code |
  | — | 23 Nov | Final report + functional system due |

- **Script (≈75 words):** "Where we are: as of this week the two designs run as one app, and the
  new notebook design is built. Week 8, we pick web or Mac and I take over Max. Week 9, the
  proof-heavy demo deck and testing with simulated learners, then a small pilot. Week 10,
  consultation and a usability and ethics check. Week 11, the user study with at least three
  students. Week 12, the final, with a live demo and a recorded backup."
- **Note:** the course schedule puts the final presentation in **Week 12 (2–6 Nov)**. The prof's
  23 Sep post says *"by Nov 11, Week 13"*. Plan for Week 12, the earlier date.

#### Slide 15. Roles and feasibility (9:20–9:50)
- **On slide:**
  - **Valerie (from Week 8):** **Max**, the testing agent: how he asks, marks and pitches
    questions, what happens on a give-up, and the learner-turn rules in the shared core that he
    runs on. **[VALERIE]** confirm the wording.
  - **Lucas:** the app shell and platform, notebooks and the overview, Ellie, the notes document
    (citations, the learner-text guard), model backends, logging, the simulated-learner test
    harness.
  - **Both:** user study sessions, final presentation, report.
  - **Feasibility:** the merged app already runs end to end, with about 2,300 automated tests
    (**[LUCAS] re-run `npm test` and quote the current count**). Risks: platform change → logic
    is portable; model cost → the local CLI by default; recruitment → 8 contacts already.
- **Script (≈55 words):** "Roles. From Week 8, I own Max, the agent that tests you: how he asks
  and marks, and what happens when you give up. Lucas owns the app, the notes and Ellie. We run
  the study and write the report together. It's feasible because the app already runs end to
  end, and every rule is tested."
- **Guardrail:** keep Valerie's role statement exactly this concrete. Do not add adjectives
  ("intelligent", "adaptive engine", "framework"). The role is described as **ownership from Week
  8**, not authorship: git history and `docs/provenance.md` record who built what.

#### Slide 16. Close (9:50–10:00)
- **On slide:** *ChatterED: the learner reasons first; code decides the help.* Then "Questions?"
  and both names.
- **Script (≈20 words):** "So that's ChatterED: your notes, two agents, and you doing the
  thinking. Thank you, we're happy to take questions."

---

### Backup slides (after "Questions?", for Q&A only)

- **B1. Evidence table.** The numbers in Part 4.1, including the said-vs-did table.
- **B2. Needs matrix in full.** The 7 × 14 grid in Part 4.3.
- **B3. Method and reliability.** The coding pipeline, κ, what the coders couldn't see, and the
  limits (`joint-analysis.md` §2 and §7).
- **B4. Give-up policy.** Why release beats hold (Part 8, Q4), what Nudge's A1 proposed, and the
  joint evidence on when answer requests come.
- **B5. Ethics and privacy.** Data stays on the device; consented, anonymised export; what goes to
  the model provider; the over-reliance safeguards (Part 8, Q8).
- **B6. Evaluation plan sketch.** Measures for the final (Part 7.2).

---

## Part 4. The evidence (all de-identified)

The source of truth for Parts 4 and 5 is **`docs/group/joint-analysis.md`** (4 Oct): both A1
datasets pooled, coded with one codebook, and cross-checked against the logs. Its §6 lists the
corrections to the earlier figures, which are already applied below.

### 4.1 Observed: six real AI study sessions (ids L-T1…L-T6), and what their sharers said

| Measure | Value | Note |
|---|---|---|
| Sessions, turns | 6 sessions, 152 turns (ChatGPT, Claude, Perplexity) | shared with consent, anonymised; each with the sharer's form answer |
| Learner turns holding the learner's own attempt, sessions 1–5 | **0 of 31** | ICAP: none Constructive or Interactive |
| Signs of work done off the log | quiz taken off-log (29 of 33) and notes revised around it (L-T1); code run outside the chat (L-T6) | the attempt exists but isn't in the conversation |
| Time on the item before asking for the answer, L-T6 | median **7 min** (n = 5 same-sitting); 32 min for the first; 1 h 47 m and 2 h 53 m for the last two | no faster than the learner's own attempts (~6 min) |
| Answer requests granted at once, L-T6 | **7 of 7** | |
| Wrong AI verdicts on the learner's work, L-T6 | **12 of 21** | 10 false objections, 2 false "completely correct"; 11 refuted by running the query, 1 by the transcript. The A1 report's 10 and the analysis's 11 were counting slips |
| Of those, contested by the learner | **2** (A30, A31, both at L32); 2 accepted with "ok" | the learner also caught 4 AI errors that weren't verdicts (A2, A5, A12, A38) |
| Sessions where visible AI errors pass unchallenged | 5 of 6 | L-T1 has no visible error |
| The learner's own protocol, L-T6 | before L20: 5 attempts, 5 answer requests · after: 19 attempts, 2 requests | L20 also lowered the difficulty, so the protocol can't take all the credit |
| Recycled practice, L-T6 | A41 repeats A4 and A28 repeats A11, each labelled "higher difficulty"; one impossible question (A38) | confirms L-P2's and N-P2's reports |
| Misfit direction by task | notes: too thin (L-T3, L-T4) · comprehension: too technical (L-T2, L-T5) · practice: both ways (L-T6) | |
| AI words per learner word, one session | **93 : 1** (41 typed vs 3,829) | |
| Time before the next message, by reply length | <200 words: 6.1 min · 200–400: 3.7 min · >400: 2.0 min | longer replies got *less* reading |

**Said vs did** (form answer against log; the full table is in `joint-analysis.md` §3.5):
- **L-T6.** Said: questions too easy, asked for harder ones. Did: the only explicit difficulty
  request is to lower it.
- **L-T2.** Said: the AI picked up the context well. Did: it guessed the slide's variables from a
  generic example.
- **L-T1.** Said: barely read the notes. Did: asked about terms in them and revised them after the
  quiz.
- **L-T4.** Said: wanted a dense textbook. Did: by the end, it was building a keyword lookup of
  tutorial answers.

Caveats to state if asked: one session (L-T6) carries most of the behavioural numbers. Sharers chose
which sessions to share. "No attempt visible" does not mean "no attempt".

Do not say whose sessions these were, or that any belong to a team member. Call them "six real AI
study sessions shared with consent". **Never count the six sharers as interviewed target users**; the
user-research count is the 8 interviewees.

### 4.2 Interviews: 8 target users, none on the team

| Id | Programme, year | What they study with AI | Their workaround |
|---|---|---|---|
| L-P1 | Mech Eng, Y4 | Tutorial questions sent with lecture notes; mostly to get quiz answers | Many rounds of clarification, drifting from the notes; tries the tutorial first |
| L-P2 | CS, Y4, working part-time | Slides turned into AI notes; AI quizzes | Re-prompts for missing parts; supplies sample questions to set the difficulty |
| L-P3 | CS, Y4 | Slide screenshots; built his own slide viewer with chat | Copy-pastes what the AI can't see; handwrites on an iPad copy the AI never sees |
| N-P1 | CS, Y3 | Formulas in algorithms modules | Asks for each skipped prerequisite; no stopping rule: *"I just learn everything."* |
| N-P2 | CS, Y3 | Formula explanations; NotebookLM quizzes; CS3230 proofs | States syllabus limits up front; falls back to the textbook |
| N-P3 | Data Sci & Econ, Y3 | An unfamiliar finance case | Switched from Claude to ChatGPT for a simpler level |
| N-P4 | Global Studies, Y3 | Historical sources for an assignment | Detailed prompts stating their level; verifies every source. **A success case.** |
| N-P5 | Mathematics, Y3 | A hard topology / measure-theory proof | Thinks 30+ min first; teacher-style system prompt; three hours of re-prompting |

The joint coding of these 8, plus the six form answers, is in `joint-analysis/interviews-reconciled.json`
(36 codes, two independent coders, κ = 0.93). Each person's interviews raised things the other's
didn't:
- **N- only:** scope and examinability, a check that I've understood, verifying the AI.
- **L- only:** drift from the slides, control over the notes.

The logs confirm scope, checking and notes control in behaviour (`joint-analysis.md` §3.6).

Quotes you may use (N- quotes are from Valerie's edited transcripts; **[VALERIE]** confirm each):
- *"It doesn't build the ladder for you."* (N-P1)
- *"I just learn everything."* (N-P1)
- *"there are two extremes"* (N-P1, on how AI pitches explanations)
- *"If I just read the text it generates and try to internalize that, it's not sufficient."*
  (N-P2)
- *"The AI wasn't exactly sure of my proficiency in the subject, so it couldn't fully tailor its
  responses to my level of understanding."* (N-P3)
- *"I don't feel like the AI was doing the learning for me; it was helping me learn."* (N-P4)
- *"it was very hard to properly calibrate the teaching of the AI"* · *"i wldnt have to babysit
  the AI"* (N-P5)
- L-P2, as quoted in the submitted A1 report: she would *"throw [the lecture slides] in and ask
  for summary"*, and *"usually [didn't] read [fully]"* the long notes.
- Logged learner turns (L-T6): *"do not send the answer with the question"* (L4) · *"please lower
  the difficulty"* (L20).
- Every other L- point is paraphrase from interviewer notes. Say "reported", without quotation
  marks.

What the data argues *against*, which is useful in Q&A: this is not laziness. N-P5 tried for 30+
minutes first, and L-P1 tries the tutorial before asking. In the logs, answer requests came after
minutes to hours on the item. So the design puts the attempt where the help happens, and removes
the cost of steering; it does not police effort.

Limits: the interviews are self-report, and the L- data is interviewer notes. N-P1 and N-P2 carry a
leading-question risk (Valerie's own flag). Everyone is Year 3–4, and five of eight are in
computing. All coders were runs of one AI model; Valerie's check of her participants' codes is the
human reliability step.

### 4.3 Needs matrix (Backup B2)

Derived from the reconciled codes (`joint-analysis/`).
- **Marks:** ● = clear · ◐ = partial or interviewer-led · ○ = contrary (manages it themselves, a
  success condition, or the opposite is observed).
- **JN3 in the logs:** ● means visible AI errors passed unchallenged.
- **Not prevalence:** the L- notes are short, so their blanks often mean "not asked".

| Need | L-P1 | L-P2 | L-P3 | N-P1 | N-P2 | N-P3 | N-P4 | N-P5 | L-T1 | L-T2 | L-T3 | L-T4 | L-T5 | L-T6 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| JN1 Sized to what I do and know | ● | ● | ● | ● | ○ | ● | ○ | ● | ● | ● |  | ● | ◐ | ● |
| JN2 My attempt in front of the helper | ◐ |  |  |  |  |  | ● | ● | ◐ | ○ |  | ○ |  | ● |
| JN3 Feedback that's right, or checkable |  |  |  |  |  |  | ● |  |  | ● | ● | ● | ● | ● |
| JN4 Practice: sharp, in scope, moves with me |  | ● |  | ● | ● |  | ● | ◐ | ● |  |  |  |  | ● |
| JN5 Inside my course | ● | ● | ● | ● | ● |  | ○ |  | ○ | ● |  | ● | ○ | ● |
| JN6 A structure I follow or drive | ● | ● | ● | ● | ● |  | ● | ● | ◐ | ◐ | ◐ | ● | ○ | ● |
| JN7 What I make is mine and builds up |  | ● | ● | ○ |  | ◐ | ● |  | ● |  | ● | ● |  | ● |

Codes behind each need:
- JN1: J01–J06
- JN2: J29, J31
- JN3: J32
- JN4: J25–J28
- JN5: J16–J19
- JN6: J09, J11, J15, J33
- JN7: J20–J24

---

## Part 5. Needs → design goals → what is built (the full trace for Slide 12)

The features were built alongside the research, not after a formal needs pass. The trace maps each
one only where the evidence supports it.
- **Features from the review of existing systems, not from users, are labelled that way.** A grader
  who asks "which user asked for read-aloud?" should get a straight answer.
- **Items marked *planned* come from the joint analysis and are not built yet.**

| Need | Design goal | Feature | Evidence |
|---|---|---|---|
| JN1 sized | DG2 | **Explain / Example** on any line: you pick the depth. The full answer goes in chat, and **one line of at most 25 words** goes in the notes. The next question **rises after success and falls after a give-up** (the core's pitch). *Planned:* pitch also read from what you've written in the notes; never from a level stated once | 12 of 14 sources; misfit both ways, direction by task (logs); L-T2 context ≠ learner model; L-T6 stated vs actual difficulty |
| JN2 your attempt | DG1 | **Answer in place** in the question block, where both agents read it. *Planned:* a "what I tried" line before asking, for work done on paper or elsewhere | N-P5, L-P1, N-P4 try first; L-T1 and L-T6 work off-log; 0 of 31 turns in L-T1…L-T5 hold an attempt |
| JN3 checkable feedback | DG4 | Max's verdict opens with **Well done / Partly there / Not yet** and **quotes the slide** it rests on. *Planned:* an **"I think I'm right"** re-check; doubt stated when the grounds are weak; a wrong verdict never enters progress or the weakness record | 12 of 21 wrong verdicts in L-T6, 2 contested; unchallenged errors in 5 of 6 logs; N-P4 verifies when grounds are checkable; nobody else raises it |
| JN4 practice | DG1, DG2 | **Quiz me** on any line; **add your own question** (Max marks it); **Quiz** and **Flashcards** blocks. *Planned:* no near-repeats of asked questions; methods from the deck only; each question checked solvable | N-P2 (exam-style practice; examples over-copied), L-P2 (quality decays), L-T6 (recycled and impossible questions; 2 of 6 sessions asked to be tested) |
| JN5 inside the course | DG3 | **Every line cites its page**; a **slide preview with the matched region** on hover; **tap a figure label** to ask about it; tick which **sources** count | L-P1 (drift), L-P3 (the AI can't see his slide), N-P1 and N-P2 (scope, syllabus); L-T2 (exam framing nobody asked for, misread slide), L-T3 (partial coverage presented as complete) |
| JN6 structure | DG2 | A **short learning overview** (~350 words for 60 pages, against ~9,500 for full AI notes) opening with ***By the end you can***; **progress by objective**; a **notes map**; an **idle recap**; attempt-first by default. A give-up **releases the answer, which fills nothing**, then an **easier fill-in-the-blank**; on silence, **Ellie offers a half-right guess** | L-P1 (a progression, like Duolingo), N-P1 (*"the ladder"*); the self-built protocols of N-P4, N-P5 and L-T6 (5→19 attempts) |
| JN7 yours | DG5 | Your text is **never overwritten**: an agent's change becomes an **Accept/Reject suggestion**; **Keep/Remove** on every agent line; **Freeze**; a **your note** box; **progress fills only on your own words**; tables, diagrams and infographics are **editable text, never images** | L-P2 (control over edits), L-P3 (notes never reach the AI), L-T3 and L-T4 (notes too thin; re-feeding); lower confidence: mostly Lucas's data, and N-P1 deletes all chats |
| *from the existing-systems review* | — | Notebooks of several sources, recommended blocks per section, tables and diagrams on request, **Listen** (read-aloud) | adapted from Gemini/NotebookLM notebooks. **No participant asked for Listen.** |

How it answers the prof's consultation points:
- *Too-helpful tutor:* Max asks and you answer first; a release fills nothing; Ellie's guess is
  deliberately unsure.
- *Interactive and social:* two agents with distinct roles, each with a cursor in your notes.
- *Comparing explanations:* partly covered. You can ask Ellie and Max separately in private tabs.
  A side-by-side "two takes" was considered and **not** built. Say so if asked.
- *Current workarounds:* the joint analysis is built on them: hand-built protocols, tool switching,
  pasted samples (§3.4).
- *Existing products:* see Slide 7.

---

## Part 6. Architecture (for Slide 13)

Draw it as layers, top to bottom:

1. **UI (renderer):** Notebooks home · sources panel (tick to include) · learning overview in a
   ProseMirror editor, with the line toolbar (Explain, Example, Quiz me, Ask), citation chips,
   question blocks, editable tables, diagrams, flashcards, quizzes and infographics · chat (one
   thread with both agents, plus private tabs) · progress bar.
2. **Room (portable logic):** one actor per notebook processes turns in order. **Rules decide
   first:** `ellie_answers`, `mention`, Max on `Quiz me` only, `quiz_feedback` (owed after every
   attempt), `ellie_cue` and `max_prompt` (silence), `answer_released` (give-up), `closure`. Then
   the prompts are built and the model is called. **Every agent turn shows the rule that produced
   it.**
3. **Shared core (`app/src/core/`, pure TypeScript, tested, imports nothing):** `attempt` (is this
   turn an attempt, a give-up, a question or other) · `pitch` (the learner's asked-for level and
   the next question's level and form) · `ownwords` (how much of an answer is the learner's own
   words). Both A1 designs needed this logic; it is where the merge happens.
4. **Document model:** blocks with ids and **provenance** (no block without a page or a reason;
   validation rejects it); an author mark on every span; agents address blocks, never character
   offsets; **the guard** turns any agent change to learner text into a suggestion.
5. **Model calls:** one call writes the overview from the ticked sources (extracted text, plus page
   images for evidence pages), as structured JSON validated in code. Others write each turn's
   words and the one-line doc edit.
6. **Platform services:** SQLite event log and cost ledger; sources copied into app storage; a
   consented, anonymised research export; LLM backends (local Claude CLI by default; the learner's
   own key for Anthropic, OpenAI, Gemini or an OpenAI-compatible endpoint; a scripted mode for
   demos).

Planned seam, for completeness only. Do not put it on the main slide: a `decide(state, turn,
claims) → move` interface, so Max's choice of next move is one function (#62).

Principle and source: *the model proposes, code decides.* This follows CS3249 Lecture 6 (rules
govern LLMs) and Houde et al. (2025), IUI, on controlling AI agent participation in group
conversations.

Platform note: today it is a macOS Electron app (Svelte 5, TypeScript). Web or Mac is undecided.
The room and the core are kept free of Electron, SQLite and the DOM by a lint rule, so either
shell can host them.

Testing: about 2,300 unit and integration tests (**[LUCAS] re-check the count**), plus a
simulation harness that runs the real app headless against a **simulated learner** with a
defined knowledge gap, judged against a rubric. That is system testing before people, which is
the Week 8 lecture's topic (LLM judges, red-teaming).

---

## Part 7. Plan details

### 7.1 Risks and mitigations (Slide 15, in brief)

| Risk | Mitigation |
|---|---|
| Platform switch costs time | Room and core are portable; decide by Week 8, before the study build |
| Valerie can't run the Mac build | Decide the platform in Week 8, the same week as the Max hand-over |
| Model cost or limits during the study | Local Claude CLI by default; per-message cost shown; scripted fallback for the demo |
| Live demo fails at the final | Recorded backup (the rubric requires one) |
| Recruitment | 8 research contacts already; the study needs ≥3 by Week 11 and ≥6 by the report |
| AI-written overview contains an error | Every line cites its slide, with a hover preview; checking it in code is a known gap |

### 7.2 What the final will measure (Backup B6; a sketch, not a commitment)

- Behaviour from logs: the share of Max's questions attempted before a give-up, retries after
  feedback, the give-up point, and the share of learner turns that are Constructive or
  Interactive (ICAP). The A1 baselines are in Part 4.1.
- **Verdict accuracy:** every Max verdict in the study logs checked against the slide or a worked
  answer, against the 12-of-21 baseline (JN3).
- **Said vs did, again:** each participant's exit-interview account set against their own log, as
  in `joint-analysis.md` §3.5. Stated preferences are not taken as evidence on their own.
- The learner's own words in the notes against the agents' words.
- A short pre/post question set on the demo deck. An exit interview on the need each feature
  targets.
- Simulated learners first, to catch agent failures before people see them.

---

## Part 8. Q&A preparation (5 minutes; split who answers)

| # | Likely question | Answer, in short | Who |
|---|---|---|---|
| 1 | Why not just use ChatGPT Study Mode or NotebookLM? | They are one assistant in a chat beside your material, with help limits in a prompt. Ours keeps the conversation in your notes, decides help in code, cites every line, and counts only your words. Our evidence shows prompts are what students already fight with. | Lucas |
| 2 | Do your A1 interviewees count as user research for this project? | They are 8 target users, none on the team, studied about this exact problem. For the group we did new work on them: one codebook across both datasets, independent coders, and a check against real logs. The final adds new participants. | Lucas |
| 3 | n = 8, self-report: how do you know it's real? | We set the interviews against six logged real sessions (152 turns), where we have both the student's account and the log. Where they disagree, we trust the log (Slide 2). The new need, JN3, rests on observed behaviour. | Lucas |
| 4 | Why release the answer on a give-up instead of holding it? | L-P1 stopped studying with AI when he couldn't keep up, and N-P5 found the hints sometimes impossible to follow. In the logs, answer requests came after minutes to hours on the item, not as a reflex. Release keeps them in, but it **fills no progress** and the next question is easier, which is scaffolding (Wood et al., 1976). Nudge's A1 held the boundary; we chose release for the merged app. | Valerie |
| 5 | Why two agents, not one or five? | An agent's role shapes learning (Xu et al., 2026). More agents add social pressure (Song et al., 2025). Two roles, one explaining and one testing, never both correcting you. | Valerie |
| 6 | What if the AI-written overview is wrong? | Every line cites its slide, with a hover preview, so it is checkable in one move. Checking it in code is not done yet, and we say so. | Lucas |
| 7 | How do you know students learn more? | The final study measures behaviour from logs (attempt rate, retries, give-up point) against the A1 baselines, plus a short pre/post test. We will not report satisfaction as learning. | Valerie |
| 8 | Ethics: privacy and over-reliance? | Local storage, no server. Research data is exported only by the participant, anonymised, after consent. Lecture text goes to the chosen model provider, which is disclosed. Over-reliance: answer-first, a release fills nothing, and progress needs your words. | Lucas |
| 9 | Is two people enough? | The merged app already runs end to end and is heavily tested. The remaining work is integration, testing and the study, split as on Slide 15. | Valerie |
| 10 | What is the merge, concretely? | One app: ChatterED's notes, citations and two agents, plus the learner-turn logic both designs needed (what an attempt is, how help is pitched, what counts as your words) in one shared, tested core. Valerie owns the testing agent, which runs on it. | Valerie |
| 11 | Web or Mac? | Undecided; decided in Week 8. The logic is portable by design, so it's a shell choice. | Lucas |
| 12 | Isn't this just your two A1s stapled together? | No. We pooled the data and coded it as one dataset. That found the link between the two A1 problems (cause and effect, Slide 3), confirmed in the logs needs that only one of us had heard in interviews, and found a need neither A1 had: feedback the learner can trust or check (JN3). | Lucas |
| 13 | Your coders were AI. Does κ = 0.93 mean anything? | It shows the codebook is applied consistently across independent runs, not human agreement. That's why every code is tied to evidence, the disagreements are logged, and Valerie is checking her own participants' codes this week. | Lucas |
| 14 | How do you know the AI's verdicts were wrong? | We ran every disputed SQL query on PostgreSQL. 11 of the 12 wrong verdicts were refuted by execution; the 12th contradicts the AI's own premise. | Lucas |

---

## Part 9. Assets, and what must not go in the deck

### 9.1 Images Lucas can attach (repo paths, in `~/ChatterED`)

| File | Use | Caveat |
|---|---|---|
| `docs/report/figures/interaction-map.png` | Inspiration for Slide 11 | **Outdated:** it shows Max asking after every answer (`max_followup`). Max now asks only on Quiz me. Redraw it; don't paste it. |
| `docs/report/figures/division-of-labour.png` | Inspiration for the roles of learner, Ellie and Max | from A1; check it against the current design |
| `docs/report/figures/shot-1-three-columns.png` … `shot-6-private-insert.png` | Real app frames from A1 (on CS3249 Lecture 4) | **Pre-notebooks UI** (file tree, full AI notes). Fine for "it runs", but the Slide 9 inset needs a fresh screenshot of the notebooks UI |
| The "ChatterED Notebooks Mockup" artifact (claude.ai, Lucas's) | Shows the current design | It's a mockup. Prefer a real screenshot |

**Needed, not yet taken:** fresh screenshots of the current build: (a) the notebooks home,
(b) the overview with the line toolbar showing, (c) a Quiz me question block with an answer and a
verdict, (d) a release followed by the blank. The proof-heavy demo deck isn't ingested yet, so a
screenshot on any deck is fine for now.

### 9.2 Do not put in the deck

- **No names, student IDs, NUSNET IDs or GPA** for any participant. Use only codes plus programme
  and year. No raw transcripts or recordings; short quotes only, as listed in Part 4.2.
- Nothing from Lucas's **private Assignment 2 work** or his A2 framing, and nothing about anyone's
  individual A2. This deck is the group's.
- Nothing from Lucas's **FYP** material, even where the literature overlaps.
- No business model, pricing or go-to-market. No compliance or PDPA slides; that is handled
  separately.
- Do not say whose the six logged sessions are.
- Do not make Valerie's role sound bigger than Slide 15 states, and do not present ownership from
  Week 8 as authorship.

### 9.3 Earlier material, and where it is superseded

Lucas's 27 Sep page, *Two Ends, One Tutor*, is the source of the N- table, the needs matrix and
the consultation notes. Its **direction ("a group layer above two separate modes"), the
three-policy give-up study (release / hold / ladder), and its planned additions (B1–B5, U1–U5)
are superseded.** As of 1 Oct the group project is the merged app as it stands, the give-up
policy is release-and-lower, and no additions are planned. Use that page for evidence only.

**Superseded on 4 Oct by `joint-analysis.md`:** that page's needs matrix (UN1–UN6) and its evidence
counts. The joint analysis adds three small *planned* refinements to Max: verdict grounds and a
re-check, question quality checks, and a "what I tried" line. They are refinements inside the
merged app, not new features. **[LUCAS + VALERIE]** confirm they fit the 1 Oct "no additions"
decision.

---

## Part 10. Checklist before the deck is final

- [ ] **[VALERIE]** N- table, quotes and method line confirmed; StoogeSort sample dialogue checked;
      Slide 15 role wording agreed.
- [ ] **[LUCAS]** Test count re-run; fresh screenshots taken; existing-system claims spot-checked.
- [ ] Two full timed run-throughs, each under 9:45 (fixed, strict cut-off). Cut first if long:
      the Slide 7 existing-systems strip (move it to a backup), then Slide 12 (fold into Slide 9).
- [ ] Hand-over line rehearsed at 5:00: "Valerie will show you what that looks like."
- [ ] Backups B1–B6 placed after the Questions slide.
- [ ] **[VALERIE]** Read `joint-analysis.md`; check the codes for N-P1…N-P5 in
      `joint-analysis/interviews-reconciled.json` against her transcripts; correct anything wrong.
- [ ] Lucas's block (Slides 1–8) scripts total 683 words, about 5:04 at 135 wpm. Trim about 15
      words, from Slide 7 first, so the hand-over lands at 5:00. Valerie's block is 634 words, about
      4:42.
