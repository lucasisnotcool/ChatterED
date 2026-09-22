# Brief: the low-fidelity prototype, and the design rationale behind it

**For:** the same outside consultant as `cui-interaction-map-brief.md` and
`cui-sample-interaction-data.md`. This is the third and last of the three. It supplies what the
other two deliberately left out: **why** the interaction is shaped this way, and what the
low-fidelity artefact has to communicate.

The criterion being answered:

> Construct a low-fidelity prototype illustrating a multi-turn CUI learning exchange. The design
> must foster active cognitive engagement from the learner, offer tailored feedback, guidance, or
> progressive steps following user input, and directly address the target learning challenge.
> Evaluation centers on the clarity and coherence with which the interaction design is
> communicated.

**Read §0 first — it changes what you are being asked to make.**

---

## 0. An unusual situation you need to know about

A working application already exists. It has been built, shipped to a Mac, and filmed running on
a live model against a real lecture deck. So you are **not** prototyping to find out whether the
idea works.

You are producing the artefact that makes the interaction design **legible** — the thing a reader
can follow without watching the video or reading the source. The criterion says assessment
centres on *"the clarity and coherence with which the interaction design is communicated"*, and
that is exactly the job. The build is evidence the design is implementable; the low-fidelity
artefact is the argument for why it is shaped this way.

Practical consequence: **do not invent behaviour to fill a gap in the flow.** Every branch is
already decided in code, and §4 gives you all of them. A plausible-looking branch that does not
exist is the one mistake that would matter here.

---

## 1. The target learning challenge

This is the thing the design must be seen to address. It comes from an observational study of
**six real AI study sessions** (ChatGPT, Claude, Perplexity; 152 turns; collected with consent
and anonymised), coded against the **ICAP framework** (Chi & Wylie, 2014), plus three interviews.

**The finding:**

> Students put their effort into getting the AI to produce a good explanation, not into
> understanding it.

Specifically, and these are the numbers to use:

- In **five of six transcripts (T1–T5)**, *every* turn was about getting the AI to reason. **No
  reasoning by the learner was visible at all.** On ICAP, turns were **Passive or Active only —
  none Constructive, none Interactive.**
- In **T2**, the AI generated **93 words for every word the learner sent**, and the gaps between
  the AI's reply and the learner's next message were too short for the learner to have read it.
- In **T6**, the AI gave a **wrong judgement on 10 of 21 turns**. The learner challenged **one**,
  falsely accepted **two**, and never addressed the other **seven**.
- **T6 was the only session with learner attempts** — 17 of them — and it only happened because
  the learner set up a quiz format by hand and told the AI not to send answers. Even then,
  **not one of those 17 attempts had a second try.**

So there are two failures, and the design targets both:

1. **The learner never attempts.** Nothing in a general-purpose chat asks them to.
2. **When they do attempt, they never revise.** Feedback arrives and the loop ends.

**The learning goal** follows directly from it, and the whole prototype should be readable as an
attempt to produce this one behaviour:

> **The learner can answer a question about the lecture in their own words, and revise that
> answer after feedback.**

The first clause targets failure 1; the second targets failure 2.

**Four needs** were derived from the study and the interviews:

| | Need |
|---|---|
| **N1** | Physical space for the learner's own attempt |
| **N2** | Cognitive space for the learner's thinking |
| **N3** | Recognise and pitch content at the learner's level |
| **N4** | Notes that can be edited with AI, and are remembered |

---

## 2. The five design goals

Each one answers a need and cites its evidence. **Use these as the spine of the artefact** — a
reader should be able to point at any part of the flow and name which goal put it there.

**DG1 — The learner goes first, and before any answer comes a peer.** *(N1)*
Max's question is the learner's to answer. After a silence long enough to *read* the question,
Ellie offers a hedged, partial take — sometimes containing one plausible student mistake — and
Max turns it back to the learner. Because a deliberate mistake could be read and kept, every
question closes with Max's corrected answer written under it in the notes.
*Grounds: retrieval practice with feedback beats restudy (Rowland 2014, g = 0.73 with feedback
vs 0.39 without); self-explanation (Chi et al. 1989); who you explain to matters (Xu et al. 2026).*

**DG2 — A give-up lowers the question, never the learner.** *(N3)*
The learner can say "I don't know", in any phrasing, at any time. The **first** give-up on a
question brings Ellie's partial take if it has not already appeared — so there is **one rung**
between the question and the answer. A give-up after that releases Max's full answer, fills no
progress, and pitches the next question lower. Locking the answer behind an attempt was rejected:
the learner could just ask a different AI.
*Grounds: scaffolding as reducing degrees of freedom (Wood, Bruner & Ross 1976); a global escape
reachable from every point in a dialogue (Moore & Arar 2019).*

**DG3 — Feedback shows its grounds, and is finished before the next question.** *(N1)*
Max gives a **verdict first** ("Well done", "Partly there"), then quotes each point from the slide
it rests on as `p. N: "…"`, then follows up **on the same question**. Only one question is open at
a time.
*Grounds: trust in automation is calibrated only when the basis of a judgement is visible (Lee &
See 2004) — and the unchecked AI errors in T6.*

**DG4 — Notes show their sources, and the learner's text is theirs.** *(N4)*
Every block links to its slides or states why it was added. **A check in code** turns any agent
change to learner text into a suggestion the learner accepts or rejects.
*Grounds: appropriate reliance (Lee & See 2004); lower AI involvement in a document gives
stronger ownership (Joshi & Vogel 2026) — which an AI-written document works against, so
ownership is protected by a rule rather than left to the model.*

**DG5 — Chat turns are sized for reading; length lives in the document.** *(N2)*
Feedback under 100 words, chat turns under 120. Anything longer goes into the notes. Silence
thresholds scale to the length of what was just shown, at 238 words per minute.
*Grounds: Grice's maxim of quantity (1975); Xu et al. kept replies near 80 words; replies that
arrive too fast read as less thoughtful (Tan et al. 2026).*

---

## 3. How this answers "active cognitive engagement" — use ICAP explicitly

The challenge was diagnosed in ICAP terms, so the design should be defended in the same terms.
The stated aim is **to move the learner from Passive and Active turns toward Constructive and
Interactive ones.**

| ICAP mode | What produces it here |
|---|---|
| **Constructive** | The learner writes an answer in their own words — in the chat, or directly into the notes. Progress fills **only** from what the learner wrote, never from what an agent explained |
| **Interactive** | Ellie's deliberately half-right take is something to **correct**, not accept. Correcting it is practice in questioning AI output — the behaviour T6 showed was missing |

**Two design decisions to call out, because they are the load-bearing ones:**

- **Why two agents rather than one.** Splitting the roles keeps *helping* apart from *judging*.
  With one agent, the learner would be asked to critique the same voice that assesses them.
- **Why a conversation rather than a quiz app.** Static notes or a quiz could hold the same
  content, but none of them can judge a free-text answer, choose the next question from what that
  answer revealed, offer a half-right answer to improve on, or notice the learner has gone quiet.
  **The learner in T6 did all four by hand.** A conversation does it turn by turn without the
  learner steering.

---

## 4. The complete branch logic — this is the prototype's content

Every branch below is decided by **ordinary code, before any model is called**. Nothing here is
the model's discretion. Draw all of it; it is the design.

### 4a. A learner turn is first classified into one of four kinds

`attempt` · `give_up` · `question` · `other`

A turn of **25 words or fewer** is short enough to be a request or clarification rather than an
attempt. Agreement alone ("ok", "makes sense") is **never** an attempt. Give-up phrases were taken
from the observed sessions, not invented.

### 4b. If one of Max's questions is open

| Learner's turn | Rule | What happens |
|---|---|---|
| `attempt` | `quiz_feedback` | **Mandatory.** A verdict, its grounds quoted from the slide, then a follow-up on the same question |
| `give_up` (or the **Pass** control) | `answer_released` | Full answer, fills nothing, next question pitched lower |
| asks for the answer, **no attempt yet** | `answer_withheld` | One hint. Not the answer |
| asks for the answer, **after an attempt** | `answer_shown` | The answer |
| `question` | `quiz_clarify` | Clarifies; the question stays open |
| `other` (agreement) | `quiz_nudge` | A nudge. Fills nothing |

The question **survives its own feedback turn** — it stays open until answered, replaced, released
or closed.

### 4c. If no question is open

| Learner's turn | Rule | What happens |
|---|---|---|
| Asks anything in the shared thread | `ellie_answers` | Ellie answers — the thread is the Teacher's |
| *(then, automatically)* | `max_followup` | Max asks **exactly one** question back |
| Names an agent (`@Ellie` / `@Max`) | `mention` | Only that agent replies |

### 4d. If the learner says nothing, with a question open and **no attempt yet**

| Stage | Rule | Constraint |
|---|---|---|
| 1 | `ellie_cue` | ≤ **60 words**, hedged, part right, possibly one plausible student mistake, **never the full answer**, tagged *"Ellie's guess"*, and **never written into the document** |
| 2 | `max_prompt` | ≤ **50 words**, aimed at the learner, neither confirming nor correcting Ellie yet — names the part worth looking at and asks them to improve on it |

**It fires once per question.** After it, silence is left alone. **After an attempt this pair does
not fire at all** — a learner who has answered and gone quiet is waiting on feedback or revising,
not failing to start.

Timing is **reading time, not a fixed timer**: roughly 2 × the words in the question at 238 wpm,
clamped between 2 and 5 minutes; stage 2 adds 90 seconds. A demo profile divides all of it by six.

### 4e. If the sitting goes idle with a question still open

`closure` — the question is closed out rather than left hanging.

---

## 5. "Progressive steps following user input" — the two mechanisms

The criterion asks for tailoring. There are exactly two mechanisms, and both are worth drawing.

**Pitch.** Three levels and no more: `−1` plain · `0` default · `+1` rigorous. Clamped, so ten
"simpler"s do not produce an explanation for a five-year-old, and one "actually be rigorous" takes
it straight back to `0`. It is driven by a **word list, not a model** — it must be instant, and it
only tilts one line of a prompt. The system keeps **the learner's own last three phrases** that
moved it, and quotes them back, because *"they asked for it simpler"* is weaker than the phrase
they actually used. This exists because in three recorded transcripts the learner corrected the
level of an answer — *"hmm can you explain it simpler"*, *"you are just reading the slides back to
me"* — the next turn was better each time, **and the system forgot each time.**

**Progress fill.** A bar of learning objectives taken from the slides:

- **Well done** completes an objective; **Partly there** half-fills it — whether the learner
  answered in the chat *or* wrote into the notes.
- A released answer, Ellie's help, and replies like *"ok, makes sense"* fill **nothing**.
- Each objective opens as a card holding its evidence: **the learner's own sentence**.

That last point is the design's sharpest claim and should be visible in the artefact: **progress
is made of the learner's words, not the AI's.**

---

## 6. What to build, and my recommendation

The criterion allows conversation flows, paper mockups, scripts, storyboards or Dialogflow, and
leaves the choice to you. **Recommendation: an annotated conversation flow plus a scripted
exchange keyed to it** — two artefacts that reference each other.

**Why this pairing.** The flow carries the branch logic (§4), which is where the design actually
lives; a script alone cannot show the branches not taken. But a flow alone cannot show *tone* or
*length*, and DG3 and DG5 are claims about exactly those. Together they cover it. A paper mockup
would spend its effort on visual fidelity, which is explicitly not assessed.

**The flow must show:**
- the four turn kinds as the first branch (§4a), since everything downstream hangs off it
- all six branches when a question is open (§4b) — including the ones that fill nothing
- the two-stage silence path, with its **once per question** gate and the fact that it is skipped
  after an attempt (§4d)
- every branch labelled with its **rule name**, since "decided in code, not by the model" is the
  central claim
- the word budgets on the agent turns: ≤ 60 (Ellie's cue), ≤ 50 (Max's prompt), < 100 (feedback)

**The script must show** one complete pass of the learning goal: an attempt, a *Partly there*
verdict with its slide quoted, a revision, and a *Well done*. Mark each line with the rule that
produced it. A real recorded exchange is supplied in `cui-sample-interaction-data.md` — use it,
rather than writing dialogue, and note where you have abridged.

**One caution on the sample.** In that recorded sitting the learner never fully completed the
second question, and the give-up and silence paths were never exercised. If your script shows
those paths, it is **illustrative and must be labelled as such**, because no recording of them
exists.

---

## 7. What this prepares for Assignment 2

Say this explicitly; the criterion asks the prototype to prepare for implementation and testing.

The measures are already defined and are computed from recorded turns, not from a model's opinion
of the session:

- **Attempt rate**, **sustained attempt rate**, **revision rate** — the share of *Partly there*
  verdicts the learner answers again on the same question. **Revision rate is the one that
  matters**: it is the second clause of the learning goal, and the behaviour none of the six
  observed sessions produced.
- A2 will **recode ChatterED sessions with the same Step 1 codebook**, so the two settings can be
  compared directly on ICAP.
- The verdicts come from a model, and T6 showed how often a model misjudges learner work — so the
  progress bar is treated as **a new instrument, not ground truth**. A blind 20% sample of
  verdicts will be hand-scored and reported as quadratic weighted κ; **below κ = .60, the bar is
  shown to the learner but no number from it is reported.**

---

## 8. Do not

- **Do not invent branches.** §4 is complete. If the flow seems to need a branch that is not
  there, that absence is a design decision — flag it as a question instead of filling it.
- **Do not present the give-up, silence, or suggestion paths as observed.** They are specified and
  implemented, but the supplied recording does not contain them.
- **Do not cite a figure that is not in this brief.** Two claims in the underlying report are
  still marked for verification by the author — the comparison condition in the Xu et al. cognitive-act
  counts, and the "a less sure peer elicits more than a tutor" claim. Neither appears above.
  Do not reintroduce them.
- **Do not spend effort on visual polish.** It is explicitly not assessed, and effort spent there
  is effort not spent on branch coverage.
