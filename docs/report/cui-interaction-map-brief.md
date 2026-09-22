# Brief: a CUI interaction map for ChatterED, as a PPTX diagram

**For:** an outside consultant (human or LLM) with no access to this repository.
**Deliverable:** an editable PowerPoint file, 16:9, containing one main diagram slide and one
supporting table slide. Vector shapes, not a pasted image.

Everything you need is in this brief. **Do not invent names, rules or controls.** If something
here is ambiguous, draw the ambiguity as a question on the slide rather than resolving it
yourself — a wrong label is worse than a visible gap.

---

## 1. What the product is, in one paragraph

ChatterED is a learning conversational UI built on a **collaborative document**, not a chat
window. A lecture deck (PDF) is ingested into AI-written **lecture notes**; every block of those
notes keeps provenance back to the slide it came from, shown as a `p. N` chip. The app is three
columns: **files · notes · chats**. Two agents share the notes with the learner — **Ellie**, the
Teacher, who explains, and **Max**, the Tester, who asks the learner one question back. Both can
write into the notes while the learner is reading them. The learner's own text is never
overwritten.

The point of the diagram is that **the document is a conversational surface**. A reader who comes
away thinking "chatbot beside a document" has missed it. Conversation enters and leaves through
the document as well as the composer.

---

## 2. The thing to draw

Every way a learner can reach an agent, and everything the system picks up **without being
asked**. Five groups. Draw all five; the fourth is the one that distinguishes this product.

### A — Explicit, in the chat column

| # | Gesture | What happens |
|---|---|---|
| A1 | Types a message in **Doc chat** (the shared thread) | Ellie answers first; Max then asks exactly one question back |
| A2 | Names one agent — `@Ellie` or `@Max` | Only that agent replies |
| A3 | Presses **Pass** (or types *"I don't know"*) | The answer is released at once, and the next question is pitched lower |
| A4 | Presses **Stop** | The turn in flight is cancelled |
| A5 | Presses **Retry** on a failed turn | The turn is re-run |

### B — Explicit, from inside the document

| # | Gesture | What happens |
|---|---|---|
| B1 | Selects a line and presses **⌘E** | The selected text is pinned into the composer as a quoted draft; the placeholder changes to *"Ask about this line…"*. Sending it opens a **span thread** anchored to that text |
| B2 | Clicks a highlighted span | Jumps to the thread that was asked about it |
| B3 | Clicks a `p. N` **provenance chip** | Opens the source slide |

### C — Explicit, and deliberately private

| # | Gesture | What happens |
|---|---|---|
| C1 | Opens the **Ellie** or **Max** tab and asks there | A read-only side channel. The other agent cannot see it, and nothing in it reaches the shared document |
| C2 | Presses **Insert into the document** on a private reply | That one reply becomes a shared card in the notes — the only route from private to shared |

### D — Implicit: picked up without being asked ⭐

**This is the group that matters most. Give it visual weight.**

| # | What the learner does | What the system does |
|---|---|---|
| D1 | Types a sentence **into the notes**, then pauses | After a 4-second pause the sentence is put through a gate (§3). If it passes, it enters the chat as the learner's own turn — carrying a *"Jump to span"* link — and is marked exactly like a chat answer |
| D2 | Says nothing while Max's question is open | **Stage 1:** Ellie offers a peer's partial, possibly-wrong guess. **Stage 2:** Max hands the question back to the learner |

D2's timing is computed from **reading time**, not a fixed timer — see §3.

### E — Control over what the agents did

| # | Control | What it does |
|---|---|---|
| E1 | **Freeze** toggle | All agent editing of the document stops |
| E2 | **Remove · Keep** on an applied agent edit | Remove takes it out; Keep keeps the text and drops the author colour |
| E3 | **Accept · Reject** on a suggestion | Appears when an agent tried to change the learner's *own* words. Rejecting leaves the learner's text byte-identical |
| E4 | **Remove** on a question block | Takes Max's question out of the notes |

**E3 is a guarantee, not a feature.** An agent edit that overlaps learner-written text *cannot*
be applied; the code converts it into a suggestion the learner rules on. Draw it as a barrier the
agent's arrow cannot cross, not as a button.

---

## 3. What gets picked up, and what filters it

Put this on the **second slide**, as a table. It is what stops the system reacting to noise.

**A learner's message is classified before any model is asked anything**, into one of four kinds:
`attempt` · `give_up` · `question` · `other`. A turn of 25 words or fewer is short enough to be a
bare request or a clarification rather than an attempt. Agreement alone ("ok", "makes sense") is
never an attempt.

**A sentence typed into the notes must clear a gate** before it counts. It is refused, silently
and with nothing on screen, for any of:

| Refusal | Meaning |
|---|---|
| `too_short` | Under eight content words, or agreement rather than a claim |
| `no_sentence` | No terminal punctuation yet, and not long enough to be a sentence without it |
| `no_objective` | The block's slides are taught by no learning objective, or by more than one |
| `unchanged` | Byte-for-byte what was last assessed for this block |
| `in_flight` | Max is still marking the previous pause on the same block |

**Silence is measured as reading time.** The threshold is roughly *two times the words in the
question, at 238 words per minute*, clamped to between 2 and 5 minutes; stage 2 adds 90 seconds.
A **Demo** pacing profile divides all of it by six for a walkthrough. So Ellie's guess arrives at
**120 s** in the study setting and **20 s** in demo; Max hands it back at **210 s** and **35 s**.

**What an agent is given when it edits the document** is deliberately narrow: the outline of
blocks *near* the anchor, and nothing else. Agents address blocks by id; they never see character
offsets. Worth a callout — it is why agent edits land in the right place without the agent being
handed the whole document.

---

## 4. Label the arrows with the rule that fires

Every agent turn in this product is decided by a **named rule in ordinary code, before any model
is called**. That is the central design claim, so the diagram should carry the names. Use exactly
these, spelled this way:

| Rule | Fires when |
|---|---|
| `ellie_answers` | The learner asks something in the shared thread |
| `max_followup` | Chained after Ellie's answer — one question back, always exactly one |
| `mention` | The learner named one agent |
| `quiz_feedback` | The learner answered Max's open question. **Mandatory** — feedback is owed |
| `quiz_clarify` | The learner asked a clarifying question instead of answering |
| `ellie_cue` | Silence, stage 1 — the peer's partial guess |
| `max_prompt` | Silence, stage 2 — handed back to the learner |
| `answer_released` | Pass, or a give-up phrase |
| `closure` | The session went idle, or the file closed, with a question still open |

The repository also contains rules from an earlier design that are **not** part of this product.
Do not add rules from any other source. If you are given more names than these, ask before
drawing them.

---

## 5. Diagram requirements

**Structure.** A three-column spine matching the app — *files · notes · chats* — with the learner
at the centre. Arrows leaving the learner are gestures; arrows arriving are agent turns. Group A,
B, C, E by where the gesture physically happens; give group D its own visually distinct band,
because nothing in it was requested.

**Direction is meaning.** Solid arrows for learner-initiated; dashed for system-initiated (all of
group D, plus every agent turn). A reader should be able to see at a glance how much the system
does on its own.

**Colour.** Ellie is green `#0f7b6c`, Max is red `#b91c1c`. **Colour is never the only signal** —
this is a hard rule, not a preference. Roughly 8% of men have a red-green deficiency and this app
serves one lecture cohort, so that is a real person in the room. Every agent element must also
carry the agent's **name in words**, and a second distinguishing cue: Ellie a solid left rail,
Max a dashed one.

**Density.** One slide. If it will not fit, cut group E to a single labelled cluster rather than
shrinking the type. Assume it will be projected in a lecture theatre and read from the back row.

---

## 6. What to hand back

1. `.pptx`, 16:9, shapes and text boxes that can still be edited — **not** a flattened picture.
2. **Slide 1:** the interaction map (§2, §4, §5).
3. **Slide 2:** the gates and thresholds table (§3).
4. A short note listing anything you had to guess, and anything in this brief that contradicted
   itself.

## 7. Do not

- Invent rule names, controls or thresholds. Everything you need is above; if it is not above, ask.
- Draw this as a chat window with a document beside it. The document is a conversational surface.
- Use green and red as the only way to tell the two agents apart.
- Show group D as ordinary notifications. Nothing in group D was requested by the learner, and
  that is the point of the diagram.
