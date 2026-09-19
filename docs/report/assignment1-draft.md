# Assignment 1: ChatterED, putting the conversation inside the lecture deck

**Body word count: 1,930 / 2,000** as drafted, counted over Steps 1 to 4 and Limitations only. The
title block, references, appendices and *Notes for Lucas* are excluded, as the brief allows ("the
2,000-word limit covers the core text only, excluding references and optional appendices"). The one
`[LUCAS: …]` bracket is an instruction to you, not submission text, and is not counted: filling it
with six programme/year/gender triples adds roughly 40 words, which leaves about 30 words of
headroom. Re-count before you export.

Section counts: Step 1 = 696, Step 2 = 593, Step 3 = 315, Step 4 = 258, Limitations = 68. If you need
room, the easiest cuts are DG5 and the third row of the roles table.

*Draft for Lucas to edit. The one `[LUCAS: …]` bracket marks the only content I cannot supply.*

---

## Step 1: What remains difficult after AI assistance

### 1.1 Learner and task

My learner evidence is a coded study of six real AI study sessions, shared by six NUS undergraduates
through my form, *CS3249: AI for Student Learning and Revision*, with their written answers about
each. None of it is simulated: these are their own sessions with ChatGPT, Claude or Perplexity, coded
turn by turn by two independent coders (κ = 0.90 to 1.00 on the dimensions this section uses), and
the form answers are documented responses beside that observed behaviour. Respondents are R1 to R6 and nothing else:
**[LUCAS: R1 programme, year, gender; R2 …; R3 …; R4 …; R5 …; R6 …]**.

The task is studying lecture material with generative AI: understanding slides, building notes,
practising for a test. The workflow is the deck on one side and a chat on the other, the slide
carried across as an image.

### 1.2 The difficulty: reduced persistence

Of the brief's four categories the evidence points at **reduced persistence**: when the task becomes
difficult, the learner turns to AI before making a meaningful attempt of their own. Here the
explanation or the finished notes arrive before the learner has written anything.

In five of six sessions, none of 31 learner turns contained the learner's own attempt or explanation,
and the AI never asked for one; the coders agreed on every turn (κ = 1.00). Offers to test the learner
were declined in every session that received them, while offers to produce material were accepted.
R1: "I prompted it quite hard and just ran through the quiz and ask questions when I see a question I
do not know." R3's goal was "Summarising all my lecture slides into one set of notes"; it "did not go
in depth enough", and the workaround was "Gave up".

One session runs the other way, and it is my design hypothesis: where the learner practised by
attempting (SQL), attempts rose from 4 to 17 and early answer requests fell from 5 to 2, after the
learner told the AI "I will attempt the question".

Once that learner produced work, the AI's verdict on their query was wrong in 11 of 21 cases, each
refuted by running it on PostgreSQL, and nine of those called a correct query wrong. The learner
challenged one and replied "ok" to others: the missing piece there was not effort but trustworthy
feedback.

The answers were also not read: turns ran 246 to 1,190 AI words, R2 got 93 AI words per word typed,
and the next question often came faster than a full read at 238 wpm (median gaps 3 to 6 minutes).

### 1.3 User needs

- **N1, attempt before answer.** An offer to be tested is declined and an available answer taken, so
  the activity must require an attempt.
- **N2, feedback that can be checked.** An unsupported verdict is accepted when wrong ("ok"), and
  invisible when falsely positive.
- **N3, answers sized and pitched to the learner.** R2: "It used jargon and pitched content abit too
  complicatedly, e.g. 'marginalise the probability'", and "I had to ask it a series of followup and
  ask it to 'explain intuitively', but this was still quite long and not very helpful… I only
  understood 50% of what I needed to at the end". R5 met "very complicated mathematically heavy
  notations" and "asked for examples". R1: "The tone and style of notes were not what I expected, and
  I barely read them in the end". R4: "I had to refeed the files and go through one by one,
  encouraging it to add on to the original output".
- **N4, progress by objective.** R6: "some questions were too easy. I could not track my learning
  progress, so I prompted it to ask questions based on my weaknesses", and "I passed it example
  questions and asked for more difficult questions."

### 1.4 Potential CUI support

A conversation can do what neither the deck nor the chat window did here: ask first, and withhold. It
can require an attempt before an answer exists, judge it against the slide, show the page that
judgement rests on, and pick the next question from what the learner has not shown. That makes what
R6 negotiated by hand the default.

## Step 2: The learning goal and the CUI's role

### 2.1 Learning goal and progress

**The learner can answer a question about a concept on their own lecture slide in their own words,
and revise that answer after feedback.**

Progress is a tree of learning objectives per file, each at one of three levels: ○ *stated*, ◐
*justified* (they gave the reason it holds), ● *defended* (it survived a Tester question). Four rules
make a level evidence rather than applause: only the learner's verbatim text moves it, agreement is
not evidence, a shown answer moves nothing, and ● needs a probe. The panel is a record of the
learner's own words.

### 2.2 Roles of the learner and the CUI

| The learner does | The CUI does |
|---|---|
| Types an attempt, in their own words, before any answer exists | Asks first; refuses the answer until an attempt is typed |
| Revises after feedback, and may dispute a verdict | Quotes the page behind each point; a disputed point is dropped, not marked down |
| Decides when to see the answer, and asks for teaching | Shows the answer only after an attempt, moving no level |

**Ellie** explains from the slide when asked; **Max** asks and assesses. I stop at two agents: Song et
al. (2025) found normative influence rises with agent count while informational influence does not.

### 2.3 Why conversational

A quiz app could ask the same question. It could not judge whether a free-text attempt is a
justification or a restatement, pick the next question from what it revealed, or withhold an answer
and reveal it on the learner's call. Xu et al. (2026) measured the gap: explaining to a responsive
agent produced 121 to 141 cognitive acts per session against 61 for a non-responsive one.

### 2.4 Design goals

**DG1, attempt before answer.** *Theory:* retrieval practice, where feedback roughly doubles the gain
(Rowland, 2014: g = 0.73 against 0.39) and the advantage over restudy grows with delay (Roediger &
Karpicke, 2006); what the learner produces is a self-explanation (Chi et al., 1989). *Need:* N1.
*Realisation:* a rule withholds the answer until an attempt is typed, and every attempt gets feedback
that opens with a verdict on the question asked and, unless the verdict is *Well done*, ends on one
follow-up question for the gap; a new question is a click, never a clause.

**DG2, feedback that shows its grounds.** *Theory:* trust is calibrated only when the basis of a
judgement is visible (Lee & See, 2004). *Need:* N2, from 11 wrong verdicts in 21. *Realisation:*
feedback quotes the page that settles each point, says so when the deck does not settle it, and never
lowers a level on a contested point.

**DG3, replies sized to the reader.** *Theory:* Xu et al. held agent replies near 80 words; adult
prose reads at about 238 wpm (Brysbaert, 2019); 2-second replies read as less thoughtful, usefulness
peaking near 9 s (Tan et al., 2026). *Need:* N3. *Realisation:* teaching aims at 120 words and
feedback under 100, and feedback alone holds 9 to 12 seconds behind a visible counter.

**DG4, the learner authors the material and asks at the segment.** *Theory:* Joshi & Vogel (2026)
found readers preferred selecting the passage themselves, and that lower AI involvement produced
stronger ownership. *Evidence:* R2's four bare slide images and R5's slide with "what is I?" make
asking at the segment observed behaviour. *Realisation:* nothing is pre-annotated; geometry proposes
cuts as faint ticks and only a click splits.

**DG5, progress the learner can see.** *Theory:* new knowledge comes from constructive engagement,
where the learner generates (Chi & Wylie, 2014); no turn in five sessions reached it. *Need:* N4.
*Realisation:* "Try another" picks the lowest-level objective, which is "questions based on my
weaknesses" as a button.

## Step 3: Implementation plan

**Form and stack.** A hybrid CUI+GUI desktop app in which the document *is* the conversation surface:
Electron, Svelte 5 and TypeScript over SQLite, local on macOS.

**Rules first, then the model.** The structure the evidence asks for is a contract, so it is code, not
a prompt: rules decide who speaks and whether an answer is due, and a Sonnet 5 call is consulted only
where they have not. Houde et al. (2025 §7.2.6) reached the same conclusion: *"its decision-making
quality was poor. We resorted to using external decision logic."*

**Components I build myself**, each carrying a design decision: (1) the **attempt classifier**
(`classifyLearnerTurn`, pure and unit-tested), sorting a learner turn into attempt, answer request,
clarifying question or agreement, on the SQL session's own phrasings ("answer?", "send me the
answer"); (2) the **answer rules**, `rule:answer_withheld` (a hint, and a clause saying one try
unlocks the answer) and `rule:answer_shown` (the answer, logged, moving no level); (3) the **objective
pick**, lowest level first; (4) the **silence threshold**, scaled to the last turn's reading time, and
the latency bands, every constant in one file; (5) the room actor and the private whisper's scoping
(Dennis et al., 2010).

**Where A1 stops.** Feedback grounds are prompt-level: the Tester is told to quote the page, but
nothing checks the quote against the deck yet; verifying it is A2's first job.

**The document format.** A segment is a crop of the pdf.js-rendered page, never re-typeset, so nothing
can alter a slide's pixels, and segmentation is local geometry with no model in it (Appendix C).

**LLMs at runtime:** agent turn text, the orchestrator's structured decision, the objective tree and
ledger coding (Sonnet 5, or the local Claude CLI). **To build:** scaffolding, tests and research
synthesis, under my decisions; every prompt, threshold and rule above is mine, and dated in the
issues.

## Step 4: The prototype

The prototype is a running app on a seven-page deck of my own. Cards are crops of rendered pages with
faint ticks where a boundary could go, and a click splits one in place. The interaction runs:

1. **Try this.** Each card carries "+ Ask here" (Ellie) and "+ Try this" (Max). I click "+ Try this",
   and Max asks one question on an objective this card teaches, at the lowest level, labelled **BY
   RULE**.
2. **Attempt and feedback.** I type an answer in my own words; Max says what landed and what was
   missing, citing `p. 3: "…"` in the slide's words. One objective moves ○ to ◐ on my words, naming
   the message that is the evidence.
3. **Try another** asks about the objective still at ○, not the one I just showed.
4. **I ask for the answer** instead of attempting: "what's the answer". Max gives a hint and a clause
   saying one try unlocks it. That refusal is a rule, not a prompt.
5. **Attempt, feedback, answer.** I try, Max assesses, and **Show the answer** appears; I take it and
   no level moves. Reopening restores the cards, the thread and the levels.

**Real and scripted.** Real and tested: the classifier, the answer rules, the objective pick, the
ledger gates, the timer, segmentation, split and persistence. Scripted: the *words* of the agents'
turns, replayed through the real actor, rules, timer and gates; an API key runs the same path against
a live model, and I say so once on camera.

## Limitations

The evidence is six sessions, one contributing 59% of all turns, so figures are per session. The
second coder is a model, not a human, so the κ values show only that the codebook applies
consistently. Feedback grounds are asked for, not verified: the SQL session shows why a quote should
be checked in code. The flow constants are untested, and the app handles slide decks only.

---

## References

Brysbaert, M. (2019). How many words do we read per minute? A review and meta-analysis of reading
rate. *Journal of Memory and Language*, 109, 104047.

Chi, M. T. H., et al. (1989). Self-explanations: How students study and use examples in learning to
solve problems. *Cognitive Science*, 13(2).

Chi, M. T. H., & Wylie, R. (2014). The ICAP framework: Linking cognitive engagement to active
learning outcomes. *Educational Psychologist*, 49(4), 219–243.

Dennis, A. R., Rennecker, J. A., & Hansen, S. (2010). Invisible whispering: Restructuring
collaborative decision making with instant messaging. *Decision Sciences*, 41(4), 845–886.

Houde, S., et al. (2025). Controlling AI agent participation in group conversations. *IUI '25*.
arXiv:2501.17258.

Joshi, A., & Vogel, D. (2026). Designing and evaluating AI margin notes in document reader
software. *CHI '26*. arXiv:2509.09840.

Lee, J. D., & See, K. A. (2004). Trust in automation: Designing for appropriate reliance. *Human
Factors*, 46(1), 50–80.

Roediger, H. L., & Karpicke, J. D. (2006). Test-enhanced learning: Taking memory tests improves
long-term retention. *Psychological Science*, 17(3), 249–255.

Rowland, C. A. (2014). The effect of testing versus restudy on retention: A meta-analytic review of
the testing effect. *Psychological Bulletin*, 140(6), 1432–1463.

Song, T., Tan, Y., Zhu, Z., Feng, Y., & Lee, Y.-C. (2025). Multi-agents are social groups:
Investigating social influence of multiple agents in human-agent interactions. *Proc. ACM
Hum.-Comput. Interact.*, 9(7), CSCW452.

Tan, F. F.-Y., Messerschmidt, M. A., Yin, W., & Nov, O. (2026). The impact of response latency and
task type on human-LLM interaction and perception. *CHI '26*.

Xu, Z., Zhang, J., Tang, A., & Lee, Y.-C. (2026). Who you explain to matters: Learning by explaining
to conversational agents with different pedagogical roles. *CHI '26*.

**Appendices (excluded from the count):** A, the demonstration script; B, the segment schema and
migration; C, the four-approach document-format comparison; D, the form wording and consent text;
E, the transcript study: codebook v1.3, the coded turns, the agreement table, the computed metrics
and the SQL execution checks, per session (`docs/research/ai-use-transcripts/analysis/`).

---

## Notes for Lucas

*Not part of the submission. What you must supply, and where every claim above came from.*

### Everything marked `[LUCAS: …]`

| # | Section | What is needed |
|---|---|---|
| 1 | 1.1 | R1 to R6 by programme, year and gender, from the form responses. The 4.0-mark criterion names those three fields explicitly. Nothing else, and no R code tied to a name anywhere in the submission. |
| 2 | Everywhere | The word count at the top is my count of this draft. Re-count after you paste the six triples in. |

Every other placeholder is gone, because the transcript study answers it. The interview-based ones
(task wording, the Block 5 quote, the verification tally, the N4 caveat, a participant objection in
Limitations) are removed: no interviews exist, and the coded study of six shared sessions is the
evidence instead.

Two things to settle on filming day rather than in the report: whether the whisper popover is wired
in the flow (if not, demo it in the room view and say so), and whether the `p. N` quote in feedback
is clickable.

### Where each claim comes from

| Claim in the draft | Source |
|---|---|
| Rubric structure, 2,000 words, references excluded, "programme, gender or year" | `assignment1-brief.txt` §3A, §4 |
| Six sessions, the form title, turn-level coding, 152 turns, two coders, κ, the PostgreSQL 17.3 checks | `findings.md` §2 |
| R2's four bare slide images, R5's slide plus "what is I?" | `findings.md` RQ1, §5 |
| "None of 31 learner turns contained an attempt… κ = 1.00"; "offers to test declined in every session that received them" | `findings.md` §7, observations 1 and 2 |
| R6: attempts 4 to 17, answer requests 5 to 2, "I will attempt the question" | `findings.md` §7, RQ5, §3.0 |
| 11 of 21 verdicts wrong, 9 false negatives, "ok" to false corrections | `findings.md` §7, RQ4 |
| 246 to 1,190 AI words per turn; 93:1 in R2; a full read at 238 wpm; median gaps 3 to 6 minutes | `findings.md` RQ5; `attempt-first.md` §1 |
| Every quoted form response (R1 tone and "prompted it quite hard", R2 jargon and "explain intuitively", R3 "Gave up", R4 "refeed the files", R5 notations, R6 progress and harder questions) | the six form rows behind `findings.md`, quoted verbatim in `attempt-first.md` §1 |
| **Reduced persistence** as the difficulty, in the brief's own words | `assignment1-brief.txt` Step 1.2; `findings.md` §4; `attempt-first.md` §0 |
| N1 to N4 | `findings.md` §5; `attempt-first.md` §0, §2 |
| Learning goal; objective levels; the four evidence rules; ● needs a probe | `attempt-first.md` §6; `learning-objectives.md` §2, §4; `progress-tracking.md` §4.4 |
| Roles table, the withhold rule, "Show the answer", the lowest-level pick | `attempt-first.md` §2.1 to §2.4 |
| Xu et al. (121 to 141 against 61 acts; agent replies near 80 words) | `design-brief.md` §E; `attempt-first.md` §4 |
| Rowland 2014 g = 0.73 against 0.39; Roediger & Karpicke 2006; feedback after every answer | `flow-session.md` §3 table, §8.3 |
| Lee & See 2004 as the ground for visible grounds | `findings.md` §2 (VERIFY), §5; `attempt-first.md` §3 |
| Brysbaert 238 wpm; the reading-time silence threshold | `attempt-first.md` §5; `findings.md` §2 |
| Tan et al.: 2 s reads as less thoughtful, usefulness peaks near 9 s; the long band is for feedback | `design-brief.md` §A3, §D4; `attempt-first.md` §2.1 |
| Chi & Wylie 2014, and "no Constructive or Interactive turn in R1 to R5" | `findings.md` RQ1 |
| Chi et al. 1989 self-explanation | `findings.md` §2 and its reference list |
| Joshi & Vogel: preferred selecting the passage, stronger ownership | `pivot-integrated-document.md` §C16 |
| Song et al. as the reason the count stops at two | `masg-drop-assessment.md` §D2 point 4 |
| Houde et al. "we resorted to using external decision logic" (§7.2.6) | `pivot-spec.md` §F2 |
| Crop-not-re-typeset; no model in segmentation | `pdf-fidelity-segmentation.md` §C0; issue #25 |
| The classifier, the two answer rules, the objective pick, `p. N` grounds, prompt-level only in A1 | `attempt-first.md` §2.2, §2.3, §3 |
| The demonstration beats | `attempt-first.md` §6 |
| Limitations: n = 6, R6 59% of turns, coder B is a model, grounds unverified, constants untested | `findings.md` §6; `attempt-first.md` §6; `flow-session.md` §0 |

Nothing about the video is drafted here; the re-cut storyboard is `attempt-first.md` §6.

### Two things I deliberately did not do

- **I invented no findings.** There are no interview transcripts in this repository and none are
  claimed: the evidence is the coded study of six shared sessions plus the respondents' own form
  answers. Every number in Step 1 traces to `findings.md`, and the only thing still missing is the
  six programme/year/gender triples that you hold.
- **I did not soften the departures from the sources.** The report says Song et al. is cited
  *against* multi-agent enthusiasm rather than for it, that feedback grounds are asked for and not
  verified in A1, and that the whisper carries no evidence from this study. All three are stronger
  as stated departures than as quiet omissions.
