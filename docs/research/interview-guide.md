# ChatterED — Assignment 1 Interview + Observation Protocol

**Purpose.** Collect the primary learner evidence that Assignment 1 Step 1 requires: ≥3 real
adult university students, one specific learning task, one named difficulty, direct quotes.
**Run window.** 14–18 Sep 2026. Analysis 19–20 Sep. Report 20–22 Sep.
**Session length.** 35–40 min total: 3 min consent → 4 min screening → 15 min interview →
10 min think-aloud observation → 5 min wrap + demographics. The *interview proper* is 20–30 min
as briefed; the observation sits inside the same booking.
**Target n.** 4 booked, 3 minimum usable (brief requires ≥3). Book 5 to absorb no-shows.

> **Question bank.** The survey (Google Form) and the interview question set, with shared item
> IDs and the transcript codebook, live in `instruments/question-bank.md`. Sections 4 and 6 below
> are the earlier draft of the interview blocks; where the two differ, the question bank wins.
> `instruments/create-google-form.gs` builds the form.

> Record **programme, year of study, gender** — never names, student IDs, or NUSNET IDs
> (A1 brief, "Learning Problem and User Needs", 4.0 marks). Use participant codes P1…P5.

---

## 0. Before you start — pick ONE task variant

Do **not** interview across mixed tasks. The rubric rewards *one focused learning task*.
Two worked variants are given below; pick the one matching the students you can actually recruit
this week, and use the same variant for all participants.

| | **Variant A — proof-based / quantitative coursework** | **Variant B — programming assignments** |
|---|---|---|
| Example modules | MA3236 Non-Linear Programming, ST2334 Probability & Statistics, MA2001 Linear Algebra, CS3230 Algorithms | CS2103T Software Engineering, CS2040S DSA, CS3223 Databases, orbital projects |
| The specific task | "Justifying why a step in a constrained-optimisation / hypothesis-test solution is valid, in your own words" | "Explaining why your submitted implementation is correct and what its failure modes are" |
| What AI gives them easily | A full derivation, a named theorem, a clean write-up | Working code, a fixed stack trace, a refactor |
| What plausibly stays hard | Deciding *which* condition/theorem applies and defending it; spotting when the AI's step is unjustified | Explaining design choices they didn't make; predicting edge cases; knowing what they'd do without the model |
| Concrete artefact to bring | Last tutorial/PS question they used AI on | Last assignment file + one AI conversation |

Whichever you pick, write it on one line and reuse that exact wording in every session:

> **Task under study (fill in):** _"________________________________________"_

---

## 1. Recruitment message (Telegram / WhatsApp friendly)

Paste as-is; swap the bracketed bits. Keep it under a screen.

```
Hi! I'm a CS3249 (Conversational UX) student doing my Assignment 1 and I need to talk to
3–4 NUS students about ONE thing:

👉 how you actually use ChatGPT/Claude/Gemini for [MA3236-style optimisation problem sets
   / your CS2103T-style coding assignments] — and what still feels hard afterwards.

• 35 min, online (Zoom) or on campus, your pick
• Bring one real question/assignment you've used AI on recently — we'll look at it together
• No prep needed. There's no "right" way to use AI; I'm not grading anyone
• Audio recorded only if you say yes; I record your major/year/gender, never your name or ID
• [Kopi on me / $5 Grab voucher / nothing — pick one and be honest]

Slots this week: [Mon 3pm, Tue 11am, Tue 4pm, Wed 2pm, Thu 10am]
Drop me a time here and I'll send the link 🙏
```

**Where to post:** module Telegram groups for the chosen variant, your tutorial group chat,
hall/RC study channels, NUS Reddit only as a last resort (harder to verify they're students).
**Do not** recruit people you supervise, TA, or grade.

---

## 2. Consent

### 2a. Verbal consent script (read aloud, ~60 s, before recording)

> "Thanks for coming. Quick admin before we start.
>
> I'm a CS3249 student. This is for a course assignment where I have to design a conversational
> AI for learning, and I have to base it on real students rather than made-up ones.
>
> I'll ask you about how you use AI for [task], then I'll ask you to work on a real problem for
> about 10 minutes while thinking out loud. You can use whatever AI tool you normally use.
>
> Three things:
> **One** — I'd like to record audio and your screen so I can quote you accurately. I can also
> just take notes if you'd prefer. Recording is deleted after I submit, by [date].
> **Two** — In my report you'll appear as something like 'P2, Year 3 Computer Science, male'.
> No name, no student ID, no matric number, nothing that identifies you. If you paste something
> with your name in it on screen, I'll blur or drop that bit.
> **Three** — You can skip any question, stop the recording, or stop the whole thing at any
> point, and I'll delete what we've got. No consequences at all.
>
> Also — I'm not evaluating whether you use AI 'correctly'. There is no policy angle here, I
> genuinely just want to see what actually happens.
>
> Are you 18 or older? … Are you okay with me recording? … Any questions before we start?"

Log for each participant: `consent_verbal = yes/no`, `recording = audio / audio+screen / notes only`, date.

### 2b. Written consent (one paragraph — send in chat, ask them to reply "I agree")

> **ChatterED / CS3249 Assignment 1 — participant consent.** I confirm that I am 18 years or
> older and a currently enrolled university student. I agree to take part in a single ~35-minute
> interview and observation session about how I use generative AI tools for my coursework, run by
> a CS3249 student for a course assignment at NUS. I understand that the session may be audio-
> and screen-recorded with my permission; that recordings and notes are stored on the
> researcher's password-protected device and deleted after the assignment is graded (by 31 Dec
> 2026); that I will be described in the report only by course-relevant details such as academic
> programme, year of study and gender, and never by name, student ID or any other identifier;
> that short anonymised quotes from what I say may appear in the report, assignment video, and
> follow-up coursework; that participation is voluntary and unpaid beyond any token of thanks
> offered; and that I may skip questions or withdraw at any time before submission, at which
> point my data will be deleted. Reply "I agree" to confirm.

Keep the replies in one archived chat folder; do not paste them into the repo.

---

## 3. Screening (4 min — ask before the main interview; stop early if they fail)

| # | Question | Include if |
|---|---|---|
| S1 | "Are you 18 or older and currently enrolled at a university?" | Yes (brief requires adult university students) |
| S2 | "Which programme and year are you in?" | Record verbatim → rubric field |
| S3 | "How would you like your gender recorded?" | Record → rubric field |
| S4 | "In the last month, have you used ChatGPT, Claude, Gemini, Copilot or similar for **[task]** specifically?" | **Must be yes** — the brief requires students who *already* use GenAI for the task |
| S5 | "Roughly how often, for this kind of work? Daily / a few times a week / a few times a month / rarer" | Record; aim for a mix, but all must be ≥ monthly |
| S6 | "Do you have a recent problem or assignment you'd be willing to work on for 10 min while I watch?" | Yes → observation is possible. No → still interviewable, mark `observation = no` |
| S7 | "Have you ever studied for this module with other people — study group, project group, tutorial buddy, group chat?" | Not exclusionary; used to route the Section 6 probes |

If S4 is "no", thank them and stop — they are not the target learner, and including them weakens
the Step 1 evidence.

---

## 4. Core interview (15 min) — organised by rubric difficulty

Semi-structured. **Ask the openers in order; use probes only when the opener lands.** Aim for
one strong quote per block. Push for *last time*, not *usually* — episodic recall beats
self-theory.

### Block 1 — The task and the current workflow (3 min) → rubric field *Learner and task*

- "Walk me through the last time you sat down to do [task]. Start from opening the file."
- "Where in that does the AI come in? Show me the actual conversation if you still have it."
- "What do you paste in — the question, your attempt, the lecture notes, a screenshot?"
- "What do you do with what comes back? Copy it? Retype it? Check it against notes?"
- Probe: "Which tool, and why that one for this?"

*Listen for:* the entry point of AI in the workflow — this is where the difficulty lives.

### Block 2 — Reduced persistence (3 min)

Opener: **"How long do you usually sit with a hard step before you ask the AI?"**

- "Think of the last time you were stuck on [task]. What did you try first?"
- "Was there a moment where you thought 'I could probably get this, but…'? What tipped it?"
- "Has the *time before you ask* changed since you started using these tools? Which direction?"
- "If the AI were down for an hour, what would you have done with that step?"
- Provocation (use once, late): "Some people say they now ask within about 30 seconds. Does that
  sound like you, or nothing like you?"

*Evidence that this is the difficulty:* a self-reported drop in attempt time, "I just ask now",
visible fast escalation in the observation, discomfort/blankness when asked what they'd do alone.

### Block 3 — Uncritical use of AI output (4 min)

Opener: **"How do you know when an AI answer for [task] is right?"**

- "Last time it gave you a full solution — did you check it? How, concretely?"
- "Has it ever been confidently wrong on this kind of problem? What happened? How did you find out?"
- Variant A: "When it cites a theorem or an assumption — do you check the assumption actually holds?"
- Variant B: "When it hands you code that passes the given tests — what do you do next?"
- **The killer question:** "Could you explain that answer to a friend in your tutorial group,
  right now, without the screen?" → then actually ask them to try for 30 s. Note what breaks.
- "Have you ever submitted something you couldn't fully explain? (No judgement.) How did that feel?"

*Evidence:* they can produce the answer but not the justification; verification is "it looks
right" / "it compiles" / "it matches the answer key"; the 30-second explanation stalls.

### Block 4 — Reduced ownership and self-direction (3 min)

Opener: **"Who decides the approach — you or the model?"**

- "When you start a hard problem, do you pick the method first, or ask the AI what method to use?"
- "Last time it proposed an approach you wouldn't have chosen — what did you do?"
- "Do you ever push back on it? What does pushing back look like for you?"
- "When it gives you a plan with steps, do you follow the order it gave?"
- "Whose solution is the thing you submitted? Yours, its, both?"

*Evidence:* method selection outsourced, plan followed as given, "both" said uncomfortably.

### Block 5 — Naming the difficulty (2 min) — do this *with* them

- "I've heard three things from you: [reflect back briefly]. Which of those actually costs you
  the most, in marks or in confidence?"
- "If I could fix exactly one, which?"
- Ask them to complete: "I can get an answer for [task], but I still can't ________ on my own."

That sentence is the raw material for Step 1's *Current difficulty* and *User needs*. Get it
verbatim.

---

## 5. Think-aloud observation (10 min) → rubric field *observed behaviours*

**Setup.** Screen share (or sit beside). Their own device, their own tool, their own problem
(from S6). If they have no live problem, keep a fallback ready:

- Variant A fallback: one unseen past-year tutorial question at their level — e.g. classify a
  quadratic minimisation case and justify which case applies and why the others don't.
- Variant B fallback: a 40-line function with a subtle off-by-one plus a failing test, "make it
  correct and be ready to explain why it's correct."

**Instruction to read:** "Work on this the way you normally would, including using AI however
you'd normally use it. Say what you're thinking out loud — even 'I'm not sure' is useful. I won't
help, and I'll stay quiet unless you've gone silent for a while."

**Prompts if they go quiet** (max 3 uses, keep them content-free): "What are you looking at?" /
"What are you about to do?" / "What are you deciding between?"

**Timed observation sheet** — mark the clock, don't interpret yet:

| Time | Event to capture | Notation |
|---|---|---|
| | First read of the problem ends | `t_read` |
| | **First AI query sent** | `t_ai` |
| | Time unaided before first query = `t_ai − t_read` | ⏱ **key persistence metric** |
| | Did they type their own attempt before querying? | Y / N; how many lines |
| | What was pasted in? | question only / question + attempt / screenshot / whole PDF |
| | Any verification act (recheck a condition, re-derive, run a test they wrote, look up notes) | tally |
| | Accepted output verbatim? | copied / retyped / edited / rejected |
| | Any pushback or follow-up challenge to the AI? | tally + quote |
| | Any moment of visible stuck-then-recovered *without* AI | note |
| | Waiting behaviour while the model streams | watches / scrolls away / starts typing next / reads problem again |

**Two scripted post-task asks (2 min, still recording):**

1. "Cover the screen. Explain the solution to me as if I'm in your tutorial and I missed the
   lecture." → Note where the explanation stops. This is your best single piece of evidence for
   *uncritical use*, and it is exactly the interaction ChatterED will train.
2. "Which part of that was yours?" → *ownership*.

---

## 6. Hypothesis probes (fold into the wrap, 5 min)

These test the three ChatterED design bets **before** you build. Keep them last so they don't
bias Blocks 2–4.

### 6a. Group study, lurking, and the whisper channel

- "Tell me about the last time you studied this module with other people. What did that look like?"
- "In a study group or module Telegram, how often do you ask a question versus just read?"
  → "Roughly what fraction of the questions you *have* do you actually post?"
- "What stops you posting the ones you don't post?" (probe for: looks basic / already answered /
  don't want to derail / feels obvious to everyone else / don't want to be wrong in public)
- "Do you ever DM one person instead of asking the group? What kind of thing gets DM'd?"
  → **This is the whisper hypothesis.** Chase the distinction: what is DM-able but not
  group-able?
- "When someone answers something wrong in the group and you think they're wrong — do you say so?"
- "Have you been in a group chat where several people agreed on something and you weren't sure,
  but you let it go?" (→ social-pressure risk, Song et al. 2025)
- Direct design probe: "If you were in a chat with three AI study-mates who could see everything
  you typed, and there was a private side channel to just one of them that the others can't see —
  would you use it? For what?"

### 6b. AI response speed

- "When the AI answers instantly versus taking ten or twenty seconds, does that change how you
  read the answer?"
- "Has a fast answer ever felt too fast — like it hadn't really looked?"
- "What do you do while it's generating?" (→ do they think, or disengage?)
- Direct design probe: "If a study bot deliberately waited ~10 seconds before replying so you had
  room to answer first, would that feel thoughtful, or just slow?"
- "How long would you tolerate before it feels broken?" (get a number)

### 6c. Reaction to the concept, in one line

Describe ChatterED in 20 seconds — group chat, you explain to 2–3 AI study-mates with different
personalities, one is a novice who needs teaching, one pushes back, one is a peer; they wait
before jumping in; you can whisper to one privately. Then ask exactly two questions:

- "What's the first thing that would annoy you about that?"
- "When would you actually open it — before a tutorial, night before a deadline, revision week?"

Record the objection verbatim. A named limitation in your own participants' words is worth marks
in the video ("one current limitation").

---

## 7. Note-taking template (one per participant)

Copy this block per session. Fill the left column live, the quotes column immediately after.

```
PARTICIPANT: P__        DATE: ____        DURATION: ____ min
Programme: ______________  Year: ___  Gender (self-described): ________
AI tools used for this task: ______________  Frequency: ______________
Consent: verbal Y/N   written Y/N   recording: audio / audio+screen / notes
Observation completed: Y/N   Task used: own problem / fallback

────────────────────────────────────────────────────────────────────────
RUBRIC FIELD 1 — LEARNER AND TASK
  Specific task in their words:
  Where AI enters the workflow:
  What they paste in / what they do with output:
  VERBATIM QUOTE:
  "                                                                    "

────────────────────────────────────────────────────────────────────────
RUBRIC FIELD 2 — CURRENT DIFFICULTY   (tick ONE primary, note secondaries)
  [ ] Reduced persistence
  [ ] Uncritical use of AI output
  [ ] Reduced ownership / self-direction
  [ ] Other — name it: ______________________________

  Evidence type:  self-report / observed behaviour / both
  What they CAN do with AI:
  What they still CANNOT do alone:
  Their own sentence: "I can get an answer for ___, but I still can't ___ on my own."
  Observed metric: t_ai − t_read = ____ s   own-attempt-before-query: Y/N
                   verification acts: ___   pushbacks: ___
                   30-second unaided explanation: complete / partial / stalled at ______
  VERBATIM QUOTE:
  "                                                                    "

────────────────────────────────────────────────────────────────────────
RUBRIC FIELD 3 — USER NEEDS  (write as "needs to ___ so that ___")
  N1:
  N2:
  N3:
  VERBATIM QUOTE supporting the strongest need:
  "                                                                    "

────────────────────────────────────────────────────────────────────────
RUBRIC FIELD 4 — POTENTIAL CUI SUPPORT  (what ChatterED would do about it)
  Which ChatterED mechanism this participant justifies:
    [ ] explain-to-agents (learning by explaining)
    [ ] novice/tutee agent   [ ] challenger agent   [ ] peer agent
    [ ] group-chat framing   [ ] whisper side channel   [ ] delayed replies
    [ ] progress ledger
  Why, in one sentence:
  Counter-evidence / what this participant says would NOT work:

────────────────────────────────────────────────────────────────────────
HYPOTHESIS PROBES
  Group asking:  posts ___ % of questions they have; lurks: Y/N
  DMs a friend instead of the group: Y/N — for what kind of question:
  Ever stayed silent against a confident group consensus: Y/N
  Whisper reaction: would use / wouldn't / conditional on ______
  Latency reaction: delay reads as thoughtful / slow / no difference
    Tolerance threshold given: ___ s
  First objection to the concept, verbatim:
  "                                                                    "

────────────────────────────────────────────────────────────────────────
BEST 3 QUOTES OF THE SESSION (mark the one you'd put in the report)
  1.
  2.
  3.
INTERVIEWER NOTES / surprises / things to change for the next session:
```

---

## 8. Cross-participant synthesis sheet (fill after all sessions, 60–90 min)

| | P1 | P2 | P3 | P4 |
|---|---|---|---|---|
| Programme / year / gender | | | | |
| AI frequency for task | | | | |
| Primary difficulty | | | | |
| `t_ai − t_read` (s) | | | | |
| Own attempt before query | | | | |
| Verification acts | | | | |
| Unaided explanation held up? | | | | |
| Lurks in group chats | | | | |
| DMs instead of posting | | | | |
| Delay = thoughtful? | | | | |

Then write four short paragraphs answering Step 1's four parts, each carrying **at least one
verbatim quote and one observed behaviour**. Choose the *single* difficulty that ≥2 of 3–4
participants show *both* self-report and behavioural evidence for. If evidence is split, say so
in the report and justify the pick — graders reward honest triangulation over a tidy fiction.

**Expected landing for ChatterED:** *uncritical use of AI output*, with *reduced persistence* as
the observed mechanism (they ask before attempting, so they never build the justification they'd
need to check the answer). That framing lets learning-by-explaining be the intervention
(Xu et al. 2026) and lets the delayed reply be a persistence lever (Tan et al. 2026). Do not
force it — let the transcripts decide.

---

## 9. Risks and how to handle them

| Risk | Mitigation |
|---|---|
| Students perform "good AI use" because you're watching | Say explicitly, twice, that there's no correct usage and you're not from the department; ask for *last time*, not *usually*; trust the observation over the self-report |
| Only 2 turn up | Book 5. Have the fallback problem ready so a session still yields observation data even with no artefact |
| They talk about AI in general, not the task | Re-anchor every drift: "and for [task] specifically?" |
| You hear three difficulties and can't choose | Block 5 makes *them* rank it; then use the behavioural metrics as the tiebreak |
| Recording fails | Notes-only is acceptable; write up within 30 min while recall is fresh |
| Someone shares a graded assignment / academic-integrity worry | Do not record that portion, do not store the artefact, note only the behaviour |

---

## References for the report

- Dennis, A. R., Rennecker, J. A., & Hansen, S. (2010). Invisible whispering: Restructuring
  collaborative decision making with instant messaging. *Decision Sciences*, 41(4), 845–886.
  — basis for the whisper probes in §6a (silent interactivity, ephemeral context, a channel to
  seek support that is more polite than interrupting).
- Song, T., Tan, Y., Zhu, Z., Feng, Y., & Lee, Y.-C. (2025). Investigating social influence of
  multiple agents in human-agent interactions. *Proc. ACM Hum.-Comput. Interact.*, 9(7),
  CSCW452. — basis for the group-consensus/silence probe.
- Tan et al. (2026). The impact of response latency and task type on human-LLM interaction and
  perception. *CHI '26*. https://doi.org/10.1145/3772318.3790716 — basis for the §6b latency
  probes and the "too fast reads as shallow" wording.
- Xu, Z., Zhang, J., Tang, A., & Lee, Y.-C. (2026). Who you explain to matters: Learning by
  explaining to conversational agents with different pedagogical roles. *CHI '26*.
  https://doi.org/10.1145/3772318.3790298 — basis for the "explain it to me with the screen
  covered" task and the peer/challenger/tutee roles described in §6c.
