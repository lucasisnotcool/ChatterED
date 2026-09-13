# ChatterED — Learner Evidence Instruments (Google Form + Interview)

**Status.** v1, 13 Sep 2026. Feeds Assignment 1 Step 1 (Learning Problem and User Needs, 4.0
marks) and the ChatterED hypothesis probes. Companion: `../interview-guide.md` keeps consent,
recruitment, the think-aloud observation and logistics; this file is the **question bank** that
both the survey and the interview draw from.
**Task variant.** Variant A (#7): quantitative / proof-based coursework.

> **The task, in one line — reuse this wording everywhere:**
> *"Working through problem sets, tutorials or past-year questions in a quantitative or
> proof-based module (e.g. MA3236 Non-Linear Programming, MA2001 Linear Algebra, ST2334
> Probability & Statistics, CS3230 Algorithms) with the help of ChatGPT, Claude, Gemini,
> Copilot or similar."*

Two instruments, one construct map:

| | **Google Form** (async, friends fill in alone) | **Interview** (live, 20–30 min, transcript coded later) |
|---|---|---|
| Purpose | Breadth: pattern across many respondents, screen for interviewees, closed-ended counts | Depth: verbatim quotes, episodes, the difficulty in the participant's own words |
| Counts toward the "≥3 real students" requirement? | **No** on its own — the brief says *talk to or observe*. A form response is documented evidence but does not replace the conversation. | **Yes.** Three interviews minimum. |
| Item form | Closed, construct-specific scales, short optional open text | Open questions + probes; no scales |
| Analysis | Frequencies, cross-tabs by year/programme | Codebook in §4, thematic synthesis |

Both use the same item IDs (U, P, C, O, D, G, L, R, A) so a form answer and an interview quote
on the same construct sit side by side in the synthesis sheet.

---

## 0. Design principles applied (and where they come from)

These are the rules every item below was checked against. Cite them in the report's method
paragraph; graders reward a visible method.

**Questionnaire design**

1. **One construct per item; no double-barrelled, leading or loaded wording**
   (Krosnick & Presser 2010; Dillman, Smyth & Christian 2014).
2. **Construct-specific response scales instead of agree/disagree.** Agree/disagree invites
   acquiescence; "how often / how long / how confident" with fully labelled points does not
   (Krosnick & Presser 2010; Saris et al. 2010).
3. **Episodic anchoring.** Every behaviour block opens with *"Think about the most recent time…"*
   and uses bounded reference periods ("in the last 2 weeks"). Recall of a specific episode is
   more accurate than self-theory about "usually" (Tourangeau, Rips & Rasinski 2000; Flanagan
   1954, Critical Incident Technique).
4. **Funnel order.** Neutral behaviour first, difficulty next, design-hypothesis probes after
   that, the product concept **last** so it cannot prime earlier answers, demographics at the
   end where they cannot cause drop-off (Dillman et al. 2014).
5. **Social desirability control.** The intro says twice that there is no correct way to use AI
   and nobody is being assessed; sensitive items carry *Prefer not to say* (Tourangeau & Yan
   2007).
6. **Length.** Target ≤ 10 min. Items are tagged **Core** or **Optional**; cut Optionals if a
   pilot exceeds 10 min.
7. **Pilot with two people** before sending. Ask them to think aloud while filling it in and
   flag any item they re-read (cognitive pretesting; Willis 2005).
8. **No PII.** The form must not collect email, name or NUSNET. Willing interviewees message
   you separately.

**Interview design**

9. **Semi-structured, funnel-shaped.** Grand-tour opener → focused probes → reflect-back
   (Spradley 1979; Kvale & Brinkmann 2015).
10. **Ask "what happened", not "why".** "Why" invites rationalisation; "walk me through" and
    "what happened next" elicit behaviour (Portigal 2013; Weiss 1994).
11. **Never introduce your own vocabulary early.** No "persistence", "ownership", "whisper",
    "agent" until §3.7. Let them name it; the codebook maps it afterwards.
12. **Probe with silence, echo and "say more".** Repeat their last phrase and wait. Use the
    scripted probes only when the opener does not land.
13. **Member-check in-session.** §3.5 reflects back what you heard and asks them to rank it —
    the participant, not you, picks the primary difficulty.
14. **Analysis plan fixed before data.** Deductive codes (the brief's three difficulties) plus
    inductive codes, following reflexive thematic analysis (Braun & Clarke 2006, 2021). §4.

---

## 1. Construct map

| ID | Construct | Rubric field it feeds | Form items | Interview Qs | Code prefix |
|---|---|---|---|---|---|
| U | Current AI workflow for the task | Learner and task | U1–U6 | I-U1–U3 | `WF-*` |
| P | Reduced persistence | Current difficulty | P1–P4 | I-P1–P4 | `PERS-*` |
| C | Uncritical use of AI output | Current difficulty | C1–C6 | I-C1–C5 | `UNCR-*` |
| O | Reduced ownership / self-direction | Current difficulty | O1–O4 | I-O1–O4 | `OWN-*` |
| D | Difficulty in their words, ranked | Current difficulty, User needs | D1–D3 | I-D1–D3 | `NEED-*`, `DIFF-*` |
| G | Group study, lurking, DM-vs-post | Potential CUI support (whisper) | G1–G6 | I-G1–G6 | `GRP-*` |
| L | Response speed perception | Potential CUI support (latency) | L1–L3 | I-L1–L4 | `LAT-*` |
| R | Reaction to the ChatterED concept | Potential CUI support, video limitation | R1–R4 | I-R1–R3 | `CONC-*` |
| A | Programme / year / gender | Learner and task (rubric requires these) | A1–A3 | screening | — |

---

## 2. Google Form — full specification

Build it with `create-google-form.gs` in this folder (Extensions → Apps Script at
script.google.com, paste, run `createChatterEdForm`, open the URL it logs), or copy the items
below by hand. **Form settings:** do *not* collect email addresses; do *not* require sign-in;
turn off "Limit to 1 response" (it forces sign-in); show progress bar; shuffle nothing.

Notation: **MC** = multiple choice (one), **CB** = checkboxes (many), **Short** = short answer,
**Para** = paragraph, **Scale** = linear scale. **(R)** = required. **Core/Opt** = priority.

### Section 0 — Welcome and consent

**Title:** How do you actually use AI for maths / stats / algorithms coursework?

**Description (verbatim):**
> I'm a CS3249 (Conversational UX) student. For Assignment 1 I have to design a
> conversational learning tool based on real NUS students, not made-up ones. This form asks
> how you use AI tools (ChatGPT, Claude, Gemini, Copilot…) for **problem sets, tutorials or
> past-year questions in a quantitative or proof-based module** — maths, statistics,
> optimisation, algorithms — and what still feels hard afterwards.
>
> **There is no right way to use AI and nobody is being assessed.** I'm not from the
> department and this has nothing to do with academic-integrity policy. Honest answers,
> including "I just paste the question", are the useful ones.
>
> About 8–10 minutes. No name, email or student ID is collected. I record only your
> programme, year and gender, and you may skip those. Short anonymised quotes may appear in
> my report and video. You can close the tab at any point and nothing is saved.

- **K1** (MC, R) *I confirm that I have read the above and agree to take part.*
  ○ I agree → continue  ○ I do not agree → submit form

### Section 1 — Eligibility

- **E1** (MC, R, Core) *Do all three of these apply to you? (1) I am 18 or older. (2) I am
  currently enrolled at a university. (3) In the last 4 weeks I have used an AI tool for the
  kind of coursework described above.*
  ○ Yes, all three → continue  ○ No → submit form

### Section 2 — How you use AI for this work

> Description: *The questions in this section are about what you actually do, not what you
> think you should do.*

- **U1** (CB, R, Core) *Which AI tools have you used for this kind of coursework in the last
  4 weeks?*
  ☐ ChatGPT ☐ Claude ☐ Gemini ☐ Copilot ☐ DeepSeek ☐ Perplexity ☐ NotebookLM ☐ Other: ___
- **U2** (MC, R, Core) *In the last 2 weeks, roughly how many separate times did you use an AI
  tool for this kind of coursework?*
  ○ 0 ○ 1–2 ○ 3–5 ○ 6–10 ○ More than 10
- **U3** (CB, R, Core) *Think about the MOST RECENT time you used AI for this work. What did
  you give the AI? Tick all that apply.*
  ☐ The question only ☐ The question plus my own attempt ☐ Lecture notes or slides
  ☐ A screenshot or photo ☐ My full working ☐ Other: ___
- **U4** (MC, R, Core) *On that same occasion, what did you mainly ask it to do?*
  ○ Give the full solution ○ Check my working ○ Explain one step I didn't get
  ○ Suggest which method or theorem to use ○ Explain a concept from the lecture
  ○ Other: ___
- **U5** (MC, R, Core) *What did you then do with what it gave you?*
  ○ Copied it into my work as-is ○ Rewrote it in my own words ○ Used it to check an answer I
  already had ○ Read it, closed it, and solved the problem myself ○ Didn't use it
  ○ Other: ___
- **U6** (Para, Opt) *In a sentence or two: on that occasion, what were you stuck on, and what
  happened?*

### Section 3 — When it gets hard

> Description: *Think about the last time you were STUCK on a step in this kind of problem.*

- **P1** (MC, R, Core) *Roughly how long did you work on it yourself before asking an AI?*
  ○ I asked almost immediately ○ Under 2 minutes ○ 2–10 minutes ○ 10–30 minutes
  ○ Over 30 minutes ○ I didn't ask an AI that time
- **P2** (MC, R, Core) *Before asking, how much of your own attempt had you written down?*
  ○ Nothing ○ A few notes ○ A partial attempt ○ A full attempt
- **P3** (MC, R, Core) *Compared with before you started using AI tools, how long do you now
  stay on a hard step before seeking any help?*
  ○ Much shorter ○ Somewhat shorter ○ About the same ○ Somewhat longer ○ Much longer
  ○ Can't say
- **P4** (MC, R, Opt) *If AI tools were unavailable for a day, what would you most likely do
  with a step like that?*
  ○ Keep trying on my own ○ Check notes or the textbook ○ Ask a friend or group chat
  ○ Ask a TA or forum ○ Skip it and move on ○ Other: ___

### Section 4 — Checking and explaining

> Description: *Still thinking about the most recent AI answer you received for this kind of
> work.*

- **C1** (CB, R, Core) *Did you check whether that answer was correct? Tick all that apply.*
  ☐ No ☐ Glanced at it and it looked right ☐ Compared it with an answer key or a friend
  ☐ Worked through or re-derived it myself ☐ Checked that the theorem / condition it used
  actually applies ☐ Other: ___
- **C2** (MC, R, Core) *How confident are you that you could explain that answer to a
  classmate right now, without looking at it?*
  ○ Not at all confident ○ Slightly ○ Moderately ○ Very ○ Completely
- **C3** (MC, R, Core) *In the last month, how many times has an AI answer for this kind of work
  turned out to be wrong or unjustified?*
  ○ Never ○ Once ○ 2–3 times ○ 4 or more ○ I wouldn't know
- **C4** (Short, Opt) *If it happened: how did you find out?*
- **C5** (MC, R, Core) *In the last month, how often have you handed in or presented work
  containing a step you could not fully explain?*
  ○ Never ○ Once ○ A few times ○ Often ○ Prefer not to say
- **C6** (MC, R, Core) *When the AI names a theorem, rule or assumption, how often do you check
  that it actually applies to your problem?*
  ○ Never ○ Rarely ○ Sometimes ○ Usually ○ Always

### Section 5 — Deciding the approach

- **O1** (MC, R, Core) *When you start a hard problem, which usually happens first?*
  ○ I pick a method myself, then maybe check with the AI ○ I ask the AI which method to use
  ○ I ask the AI to solve it directly ○ It varies too much to say
- **O2** (MC, R, Core) *The last time the AI proposed an approach different from the one you
  would have chosen, what did you do?*
  ○ Followed the AI's approach ○ Kept my own ○ Combined the two ○ Never happened
  ○ Don't remember
- **O3** (MC, R, Core) *How often do you push back on or question an AI answer for this kind of
  work?*
  ○ Never ○ Rarely ○ Sometimes ○ Usually ○ Always
- **O4** (Scale 1–5, R, Core) *Think of the last piece of work you submitted where AI helped.
  Whose solution was it?*  1 = *Entirely the AI's* … 5 = *Entirely mine*

### Section 6 — In your own words

- **D1** (Short, R, Core) *Complete this sentence: "I can get an answer for this kind of problem
  with AI, but I still can't ________ on my own."*
- **D2** (MC, R, Core) *Which of these costs you the most, in marks or in confidence?*
  ○ I turn to AI before really trying ○ I can get the answer but can't explain or check it
  ○ I let the AI decide the approach and next steps ○ Something else: ___ ○ None of these
- **D3** (MC, R, Core) *If one tool could help with exactly one of those, which would you pick?*
  (same options as D2)

### Section 7 — Studying with others

- **G1** (CB, R, Core) *Do you study for this module with other people? Tick all that apply.*
  ☐ A study group ☐ A module Telegram / Discord / WhatsApp ☐ Tutorial mates
  ☐ A project group ☐ No, alone
- **G2** (MC, R, Core) *In a module group chat, of the questions you actually have, roughly what
  share do you post?*
  ○ None ○ A few (under a quarter) ○ Some (about a quarter to half) ○ Most ○ Nearly all
  ○ I'm not in one
- **G3** (CB, R, Core) *What stops you posting the ones you don't post? Tick all that apply.*
  ☐ It looks too basic ☐ It's probably been answered already ☐ I don't want to derail the chat
  ☐ I don't want to be wrong in front of others ☐ Nobody replies anyway
  ☐ I'd rather ask an AI ☐ Nothing stops me ☐ Other: ___
- **G4** (MC, R, Core) *Do you ever DM one person instead of asking the whole group?*
  ○ Often ○ Sometimes ○ Rarely ○ Never
- **G5** (Short, Opt) *What kind of question goes to a DM rather than the group?*
- **G6** (MC, R, Core) *Has there been a time when the group agreed on an answer you doubted, and
  you let it go?*  ○ Yes ○ No ○ Not sure

### Section 8 — AI response speed

- **L1** (MC, R, Core) *When an AI replies instantly, versus after 10–20 seconds, does that
  change how you read the answer?*
  ○ No difference ○ Instant feels more helpful ○ A pause makes it feel more considered
  ○ A pause just feels slow ○ Not sure
- **L2** (MC, R, Core) *While the AI is generating, what do you usually do?*
  ○ Watch it type ○ Re-read the question ○ Start thinking about my own next step
  ○ Switch to something else ○ Other: ___
- **L3** (MC, R, Core) *In a study group chat, how long could a reply take before it feels
  broken?*  ○ Under 5 s ○ 5–15 s ○ 15–30 s ○ 30–60 s ○ Over a minute

### Section 9 — One idea (last, on purpose)

> Description (verbatim): *Imagine a group chat for revising a lecture topic. You explain the
> concept in your own words to two or three AI study-mates with different personalities — one
> builds on what you say, one pushes back and asks the awkward question. They wait a moment
> before replying so you get room to continue. You can also send a private message to one of
> them that the others don't see.*

- **R1** (MC, R, Core) *How likely would you be to try this the week before a test?*
  ○ Very unlikely ○ Unlikely ○ Not sure ○ Likely ○ Very likely
- **R2** (Short, R, Core) *What is the first thing that would annoy you about it?*
- **R3** (CB, R, Core) *When, if ever, would you open it?*
  ☐ Before a tutorial ☐ The night before a deadline ☐ Revision week
  ☐ When a friend isn't free to help ☐ Never ☐ Other: ___
- **R4** (Short, Opt) *The private message to one study-mate — what, if anything, would you use
  it for?*

### Section 10 — About you

> Description: *Used only to describe respondents as a group (e.g. "Year 2 Statistics").*

- **A1** (Short, R, Core) *Your programme / major*
- **A2** (MC, R, Core) *Year of study*  ○ Year 1 ○ Year 2 ○ Year 3 ○ Year 4 ○ Year 5+
  ○ Graduate ○ Other
- **A3** (MC, R, Core) *Gender*  ○ Woman ○ Man ○ Non-binary ○ Self-describe: ___
  ○ Prefer not to say
- **A4** (MC, R, Core) *Would you be willing to do a 35-minute follow-up chat (Zoom or campus,
  kopi on me)?* **Do not type your name here** — if yes, just message me on Telegram.
  ○ Yes, I'll message you ○ No thanks

**Confirmation message:** *Thank you. If you later want your answers removed, message me with
the time you submitted and I'll delete that row.*

**Item count:** 41 (34 Core, 7 Optional). Piloted length target: 8–10 min.

---

## 3. Interview variant — script with probes

**Format.** Semi-structured, 20–30 min for the questions (35–40 with consent, screening and the
think-aloud observation from `../interview-guide.md` §2, §3, §5). Audio-record with consent;
transcribe verbatim including hesitations. Interviewer speaks < 20% of the time.

**Interviewer conduct (read before every session)**
- Open every block with the **opener** only. Wait. Count to five in silence before probing.
- Probes are for when the opener lands thin. Use *echo* ("…couldn't check it?"), *say more*,
  and *what happened next* before any scripted probe.
- Ask for **the last time**, not "usually". If they generalise, re-anchor: "and the most recent
  time that happened?"
- Do not say persistence, ownership, verify, critical, agent, whisper, latency, ChatterED,
  or the module's own jargon before §3.7. Use their words back at them.
- Do not evaluate, agree, or reassure ("that's normal"). Neutral acknowledgements only:
  "okay", "mm-hm", "got it".
- Write the time-stamp of anything you will want to quote.

**Preamble after consent (say once):**
> "I'm going to ask about how you actually work through [task] and where AI comes in. I'm
> after real recent examples, not what you think you should do. There's no right way to use
> it and I'm not assessing anything. If a question doesn't fit, say so and we'll skip it."

### 3.1 Warm-up and workflow (U) — 3 min

- **I-U1 opener.** "Walk me through the last time you sat down to do [task]. Start from
  opening the file."
  - Probe: "Where does the AI come in?" → "Can you show me the actual conversation?"
  - Probe: "What did you paste in?" (question / attempt / notes / screenshot)
  - Probe: "What did you do with what came back?" (copy / rewrite / check / ignore)
- **I-U2.** "Which tool, and why that one for this kind of work?"
- **I-U3.** "How is that different from how you did this a year ago?"
  - *Listen for:* the **entry point** of AI in the workflow. → `WF-ENTRY`, `WF-INPUT`,
    `WF-OUTPUT-USE`.

### 3.2 When it gets hard (P) — 3 min

- **I-P1 opener.** "Tell me about the last time you were properly stuck on a step."
  - Probe: "What did you try first?" → "And then?" → "At what point did you ask the AI?"
  - Probe: "Before you asked, what was on the page?"
- **I-P2.** "Was there a moment where you thought 'I could probably get this, but…'? What
  tipped it?"
- **I-P3.** "Has the time before you ask changed since you started using these tools? Which
  way?"
- **I-P4.** "If the AI had been down for the afternoon, what would have happened to that step?"
- Provocation, use once, late: "Some people tell me they ask within about thirty seconds. Does
  that sound like you, or nothing like you?"
  - *Listen for:* self-reported drop in attempt time; "I just ask now"; blankness at I-P4.
    → `PERS-EARLY`, `PERS-DRIFT`, `PERS-NOALT`.

### 3.3 Checking and explaining (C) — 4 min

- **I-C1 opener.** "How do you know when an AI answer for this kind of problem is right?"
  - Probe: "Last time it gave you a full solution — what did you actually do to check it?"
    (push past "it looked right": "looked right how?")
- **I-C2.** "Has it ever been confidently wrong on this kind of problem? Tell me about that
  time." → "How did you find out?"
- **I-C3.** "When it names a theorem or an assumption — do you check that the assumption
  holds for your problem? Walk me through the last time."
- **I-C4 — the explanation task.** "Could you explain that answer to a friend in your tutorial
  group, right now, without the screen? Go ahead — I'm the friend." Let them try for 30–60 s.
  Note exactly where it stalls. (Do not rescue. Say "okay" and move on.)
- **I-C5.** "Have you ever handed in something you couldn't fully explain? No judgement — what
  was that like?"
  - *Listen for:* answer without justification; verification = "looks right" / "matches the
    key"; explanation stalls at the step the AI supplied. → `UNCR-NOCHECK`, `UNCR-SURFACE`,
    `UNCR-STALL`, `UNCR-SUBMIT`.

### 3.4 Deciding the approach (O) — 3 min

- **I-O1 opener.** "When you start a hard problem, who decides the approach — you or the
  model?"
  - Probe: "Method first and then check, or ask it what method?"
- **I-O2.** "Last time it proposed an approach you wouldn't have picked — what did you do?"
- **I-O3.** "Do you ever push back on it? What does pushing back look like for you?"
- **I-O4.** "The last thing you submitted with AI help — whose solution was that? Yours, its,
  both?" (Note tone and hesitation, not just the word.)
  - *Listen for:* method selection outsourced; plan followed in the order given; "both" said
    uncomfortably. → `OWN-METHOD`, `OWN-PLAN`, `OWN-CREDIT`.

### 3.5 Naming the difficulty (D) — 2 min, member-check

- **I-D1.** "I've heard three things: [reflect back in their words, one line each]. Which of
  those actually costs you the most — in marks, or in confidence?"
- **I-D2.** "If I could fix exactly one, which?"
- **I-D3.** "Finish this sentence for me: 'I can get an answer for [task], but I still can't
  ________ on my own.'" **Get it verbatim.**
  - → `DIFF-PRIMARY`, `NEED-*`.

### 3.6 Studying with others and response speed (G, L) — 5 min

- **I-G1 opener.** "Tell me about the last time you worked on this module with other people."
- **I-G2.** "In the module group chat — of the questions you have, how many do you actually
  post?" → "What happens to the rest?"
- **I-G3.** "What stops you posting them?" (Probe only if thin: basic / answered / derail /
  wrong in public.)
- **I-G4.** "Do you ever DM one person instead? What kind of thing gets DM'd and not posted?"
  → chase the distinction. → `GRP-DM-CONTENT`.
- **I-G5.** "When someone answers wrong in the group and you think they're wrong — do you say
  so?"
- **I-G6.** "Ever been in a chat where everyone agreed and you weren't sure, but let it go?
  Tell me about it."
- **I-L1 opener.** "When the AI answers instantly, versus after ten or twenty seconds, does
  that change how you read it?"
- **I-L2.** "Has a fast answer ever felt too fast — like it hadn't really looked?"
- **I-L3.** "What do you do while it's generating?"
- **I-L4.** "In a group chat, how long before a reply feels broken? Give me a number."
  - → `GRP-LURK`, `GRP-DM`, `GRP-CONFORM`, `LAT-THOUGHTFUL`, `LAT-SLOW`, `LAT-FILL`,
    `LAT-THRESHOLD`.

### 3.7 Concept reaction (R) — 3 min, last

Read the Section 9 description verbatim (20 s). Then exactly:

- **I-R1.** "What's the first thing that would annoy you about that?"
- **I-R2.** "When would you actually open it — before a tutorial, night before a deadline,
  revision week, never?"
- **I-R3.** "The private message to one of them — would you use it? For what?"
  - → `CONC-OBJ` (verbatim — this is the video's "one current limitation"), `CONC-USE`,
    `CONC-WHISPER`.

**Close.** "Anything I should have asked and didn't?" Then thank, confirm the deletion date,
and stop recording.

---

## 4. Codebook for transcript coding

**Process.** (1) Transcribe verbatim within 24 h. (2) Read once without coding. (3) Code with
the deductive codes below; add inductive codes as `IND-<name>` with a one-line definition when
something recurs across two participants. (4) Fill the per-participant matrix. (5) Pick the
primary difficulty by the rule in §5. Code in a spreadsheet: columns *P, timestamp, quote,
code, note*. If a second coder is available, double-code one transcript and discuss
disagreements; report agreement qualitatively (Braun & Clarke 2021 treat reliability
statistics as optional for reflexive TA).

**Unit of coding:** a complete thought (one turn or a clause within it). A segment may carry
more than one code.

| Code | Definition | Include when | Exclude when |
|---|---|---|---|
| `WF-ENTRY` | Where AI first enters the workflow | Describes the trigger moment | Generic "I use it a lot" |
| `WF-INPUT` | What is given to the AI | Question / attempt / notes / screenshot | — |
| `WF-OUTPUT-USE` | What is done with the output | Copy, rewrite, check, discard | — |
| `PERS-EARLY` | Asks AI before a meaningful own attempt | "I just ask", < 2 min, nothing on the page | Asks after a documented attempt |
| `PERS-DRIFT` | Reports attempt time has shortened since adopting AI | Explicit before/after comparison | Says unchanged |
| `PERS-NOALT` | Cannot say what they would do without AI | Blank, "I don't know", laughs it off | Names a concrete alternative |
| `UNCR-NOCHECK` | Accepts output with no verification act | "I trust it", "no time" | Any re-derivation |
| `UNCR-SURFACE` | Verification is surface-level only | "Looked right", "matched the key", "compiled" | Checks a condition or step |
| `UNCR-STALL` | Unaided explanation breaks down | I-C4 stalls, retreats to "the AI said" | Explanation completes |
| `UNCR-SUBMIT` | Submitted work they could not explain | Explicit admission | Hypothetical only |
| `OWN-METHOD` | Method/theorem choice delegated to AI | "I ask it what to use" | Picks then checks |
| `OWN-PLAN` | Follows AI's plan or step order as given | — | Reorders or drops steps |
| `OWN-CREDIT` | Ambivalent authorship of submitted work | "Both", "kind of mine", hesitation | Clear "mine" or clear "its" |
| `DIFF-PRIMARY` | Participant's own ranking of what costs most | I-D1/I-D2 answer | — |
| `NEED-EXPLAIN` | Need to be able to explain / justify a step | "I want to actually get it" | — |
| `NEED-VERIFY` | Need to know whether an answer is right | — | — |
| `NEED-ATTEMPT` | Need to be pushed to try first | — | — |
| `NEED-SAFE-ASK` | Need a low-stakes place to ask basic questions | — | — |
| `GRP-LURK` | Reads group chats without posting | Share posted < half | — |
| `GRP-SUPPRESS-*` | Reason a question goes unposted: `BASIC`, `ANSWERED`, `DERAIL`, `WRONG-PUBLIC`, `NOREPLY` | — | — |
| `GRP-DM` | DMs one person instead of the group | — | — |
| `GRP-DM-CONTENT` | What is DM-able but not group-able | Concrete example | — |
| `GRP-CONFORM` | Stayed silent against a group consensus they doubted | Specific episode | Hypothetical |
| `LAT-THOUGHTFUL` | Reads a delay as consideration | — | — |
| `LAT-SLOW` | Reads a delay as lag or breakage | — | — |
| `LAT-FILL` | What they do during generation | Think / re-read / disengage | — |
| `LAT-THRESHOLD` | Number given for "feels broken" | Record seconds | — |
| `CONC-OBJ` | First objection to the concept (verbatim) | — | — |
| `CONC-USE` | When they would open it | — | — |
| `CONC-WHISPER` | Stated use, or refusal, of the private channel | — | — |
| `IND-<name>` | Inductive code | Recurs in ≥ 2 participants | — |

**Per-participant matrix** (one row each; paste into `../interview-guide.md` §8):

`P | programme/year/gender | primary difficulty (their ranking) | PERS evidence | UNCR
evidence | OWN evidence | explanation task: complete / partial / stalled at… | lurks Y/N |
DM content | conform episode Y/N | latency reading | threshold s | first objection`

---

## 5. Decision rules for the report

- **Primary difficulty** = the one that ≥ 2 of 3–4 interviewees rank first at I-D1 **and**
  show behavioural evidence for (`*-STALL`, `*-EARLY`, `*-METHOD`, or observation metrics).
  If ranking and behaviour disagree, report both and say which you weighted and why.
- **Form data supports, never substitutes.** Use form frequencies as "n of N respondents also
  reported…" alongside interview quotes. Do not present a form respondent as an interviewee.
- **Quotes.** One verbatim quote per Step 1 part, tagged `P2, Year 3 Statistics, woman`.
- **Silence-timer number.** Median of L3 (form) and `LAT-THRESHOLD` (interviews) versus the
  45 s default (#8). Report the gap either way.
- **Video limitation.** The most common `CONC-OBJ`, in the participant's words.

---

## 6. Admin checklist

- [ ] Pilot the form with 2 people; time it; fix any item they re-read.
- [ ] Form settings: no email collection, no sign-in, no response limit, progress bar on.
- [ ] Send with the recruitment message from `../interview-guide.md` §1; the form link is the
      low-commitment ask, the interview is the follow-up.
- [ ] Book interviews with A4 = Yes respondents who message you; run Variant A only (#7).
- [ ] Before each interview: re-read §3 conduct rules; have the fallback problem ready
      (`../interview-guide.md` §5).
- [ ] Export form responses as CSV to a **gitignored** folder; never commit raw responses.
- [ ] Transcribe within 24 h; code within 48 h; synthesis 19–20 Sep.

---

## References (method)

- Braun, V., & Clarke, V. (2006). Using thematic analysis in psychology. *Qualitative Research
  in Psychology*, 3(2), 77–101.
- Braun, V., & Clarke, V. (2021). *Thematic Analysis: A Practical Guide*. SAGE.
- Dillman, D. A., Smyth, J. D., & Christian, L. M. (2014). *Internet, Phone, Mail, and Mixed-Mode
  Surveys: The Tailored Design Method* (4th ed.). Wiley.
- Flanagan, J. C. (1954). The critical incident technique. *Psychological Bulletin*, 51(4),
  327–358.
- Krosnick, J. A., & Presser, S. (2010). Question and questionnaire design. In *Handbook of
  Survey Research* (2nd ed., pp. 263–313). Emerald.
- Kvale, S., & Brinkmann, S. (2015). *InterViews: Learning the Craft of Qualitative Research
  Interviewing* (3rd ed.). SAGE.
- Portigal, S. (2013). *Interviewing Users: How to Uncover Compelling Insights*. Rosenfeld.
- Saris, W. E., Revilla, M., Krosnick, J. A., & Shaeffer, E. M. (2010). Comparing questions with
  agree/disagree response options to questions with item-specific response options. *Survey
  Research Methods*, 4(1), 61–79.
- Spradley, J. P. (1979). *The Ethnographic Interview*. Holt, Rinehart and Winston.
- Tourangeau, R., Rips, L. J., & Rasinski, K. (2000). *The Psychology of Survey Response*.
  Cambridge University Press.
- Tourangeau, R., & Yan, T. (2007). Sensitive questions in surveys. *Psychological Bulletin*,
  133(5), 859–883.
- Weiss, R. S. (1994). *Learning from Strangers: The Art and Method of Qualitative Interview
  Studies*. Free Press.
- Willis, G. B. (2005). *Cognitive Interviewing: A Tool for Improving Questionnaire Design*. SAGE.

Design-hypothesis probes (G, L, R) are grounded in Dennis et al. 2010, Song et al. 2025, Tan et
al. 2026 and Xu et al. 2026 — full citations in `../interview-guide.md`.
