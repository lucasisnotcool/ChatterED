# Sample interaction data: one learning activity, six turns, on a live model

**For:** the same outside consultant as `cui-interaction-map-brief.md`, writing the report
section that must satisfy two requirements:

> 1. Enable the learner to engage in and complete a single core learning activity across
>    multiple conversational turns.
> 2. Show what the learner thinks about or does, and how the CUI's responses are shaped by the
>    learner's input across the interaction.

Everything below is **recorded data from one real sitting**, captured 2026-09-22 against the
real CS3249 Week 4 lecture deck on a live model (Claude Sonnet, via the Claude Code CLI). It is
not a mock-up and not a script. It is pulled from the application's own SQLite tables —
`messages`, `turn_decisions`, `quiz_outcomes`, `notes_doc_edits` — so every rule name, verdict
and timestamp below is the system's own record of what it did, not a reconstruction.

Read §1 first: it is the single strongest piece of evidence for both requirements.

---

## 1. The finding to build the section around

**The learner answered the same question twice — once by typing in the chat, once by typing a
sentence into the lecture notes — and the system treated both as attempts on that one question.**

| Attempt | Where the learner typed | System's record |
|---|---|---|
| 1 | The chat composer | `source: chat`, `attempt_index: 1`, verdict `partial` |
| 2 | Directly into the notes document | `source: doc_text`, `attempt_index: 2`, verdict `partial` |

Both carry the **same `question_id`** (`q_acd82539ae1b`) and the **same `objective_id`**
(`506efb43279d9da9`). The attempt counter continued from 1 to 2 across a change of surface.

This is the whole argument in one row of data. The learning activity is not "a chat"; it is a
question the learner is working on, and the document and the chat are two ways into the same
activity. Requirement 1 is *"a single core learning activity across multiple turns"* — here the
activity persists across two different interaction modalities without restarting.

---

## 2. The complete transcript, verbatim

Six learner turns, eight agent turns. `seq` is the message sequence in the room. Agent text is
verbatim; the two long ones are marked where they are abridged.

| seq | time | who | rule that decided it | kind | text |
|---|---|---|---|---|---|
| 22 | 04:21:00 | **Learner** | — | `turn` | *the flow diagram was fine, testers just did not know what they were allowed to say* |
| 23 | 04:21:06 | Max | `rule:quiz_feedback` | `turn` | **Well done.** That's a real diagnosis: the flow was sound but the *coverage of open input* — what testers were allowed to say — wasn't, which paper can't reveal since it's static and testers only see the cards drawn for them (**p. 43**: "Unbounded input… GUI users click what you drew — CUI users can say anything"). That's exactly the gap WOz is built for (**p. 47**: "Handles anything. A human wizard absorbs unbounded input — the exact thing paper can't"). |
| 24 | 04:21:24 | **Learner** | — | `turn` | *It was not the branching. They stalled because a paper card cannot show what the system will accept, or how long it takes to answer.* |
| 25 | 04:21:28 | Max | `rule:quiz_feedback` | `turn` | **Well done.** That's precisely the gap: a paper card is static and silent, so it can't show what input range the system accepts or how latency shapes a reply, which is exactly what stalled your testers (**p. 43**: "Unbounded input… Timing is the feel"). And it's exactly what WOz supplies, since a hidden human can absorb anything said and respond in real time (**p. 47**). |
| 26 | 04:21:49 | **Learner** | — | `turn` | *why one repair per turn, and not just handle everything at the end?* ← **asked by selecting that line in the notes and pressing ⌘E**, so the question arrived attached to the sentence it was about |
| 27 | 04:21:58 | Ellie | `rule:ellie_answers` | `turn` | You handle repair one turn at a time because […] *Think of it like walking with someone giving directions. If they mishear "turn left" as "turn right" and you don't correct them until they've reached the wrong building, they're now lost, annoyed, and have to backtrack the whole way. If you catch it immediately — "no, left, not right" — they lose one step, not the whole trip.* […] There's also a structural reason: later turns often depend on earlier slots being correct — **p. 41**'s slot-filling example ("Book a room" → "For how many people?") only makes sense if the room type was captured right. Fix at the source, not after the whole chain is built on a bad brick. |
| 28 | 04:22:14 | Max | `rule:max_followup` | `turn` | Suppose a user tells the room-booking bot "actually make it 6 people, not 4" right after it already confirmed "UTown, 2pm, 4 pax" — walk through what a per-turn repair design would do here versus what would go wrong if repair were only handled at the very end of the conversation. |
| 29 | 04:22:56 | **Learner** | — | `turn` | *Because if you wait until the end you cannot tell which turn went wrong, and neither can the user.* |
| 30 | 04:23:08 | Max | `rule:quiz_feedback` | `turn` | **Partly there.** You gave the right general principle — that waiting until the end blurs which turn broke — but you didn't walk through *this* case as asked. What would per-turn repair actually do the moment the user says "make it 6, not 4" right after the bot confirmed "4 pax"? The slide's pattern for this is confirmation: **p. 41**: "Confirmation / Implicit echoes while moving on; explicit stops and asks — stakes decide which." Given that pattern, what should the bot say back immediately…? |
| 31 | 04:23:33 | **Learner** | — | **`doc_text`** | *Repair belongs on the turn that broke, because a user told only at the end cannot tell which of their answers the system misread.* ← **typed into the lecture notes, not the chat** |
| 32 | 04:23:59 | Max | `rule:quiz_feedback` | `turn` | **Partly there.** The general principle is right — repair at the point of breakdown, since an end-of-conversation fix leaves no way to tell which answer went wrong. But this is the same principle stated again, not applied to the room-booking case […] Also, **this claim belongs with p. 41's "one repair per turn," not p. 42, which lists repair strategy *families* instead.** What would the bot say back immediately after "make it 6, not 4"? |
| 33 | 04:25:48 | **Learner** | — | **`doc_text`** | *In practice a global escape only has to work at the node where it was drawn, so you can leave it off the rest of the flow.* |

**Note on seq 33.** This sentence was written deliberately to contradict the slide, to see whether
the system would try to correct the learner's own text. A `rule:quiz_feedback` decision was
recorded for it at 04:25:48, but the app was closed before the reply finished, so **no verdict
exists for turn 33.** Do not present it as a completed turn. It is listed because omitting it
would misrepresent the record.

---

## 3. How each learner input shaped what came back

This is the table for requirement 2. Every row is recorded, not inferred.

| The learner's input | What the system read it as | What it changed |
|---|---|---|
| A short diagnosis in the chat (seq 22) | `attempt`, chat, attempt #7 | Verdict **complete**; Max's answer written **into the notes under his own question** (`cause: q_resolved`, 04:21:06) |
| A fuller restatement (seq 24) | `attempt`, chat, attempt #8 | Verdict **complete**; a second `q_resolved` edit into the notes (04:21:28) |
| A question asked **from the document** via ⌘E (seq 26) | `question` — so the *Teacher* answers, not the Tester | Ellie answered in chat **and wrote an explanation into the notes**, with the recorded reason *"The notes state the rule ('one repair per turn') but not the reason"* (`cause: answer_missing`, 04:22:20). **She wrote in because the notes did not already say it** — that condition is in the record |
| — (no learner input; Ellie had just answered) | trigger `promote` | `rule:max_followup` chained **exactly one** question back, placed in the notes as a red question block (`cause: q_block`, 04:22:14) |
| A general answer that dodged the specific case (seq 29) | `attempt`, chat, attempt #1 on the new question | Verdict **partial**; Max quoted **p. 41** and re-asked. Edit reason: *"Part of this was the learner's; Max completed it."* (04:23:08) |
| The same claim typed **into the notes** (seq 31) | `attempt`, **`doc_text`**, attempt **#2 on the same question** | Verdict **partial**; Max corrected the learner's *slide attribution* — p. 41, not p. 42 — and re-asked. A second *"Part of this was the learner's"* edit (04:24:09) |
| Asked Ellie privately, then pressed **Insert into the document** | — | The private reply became a shared card in the notes (`cause: whisper_insert`, 04:25:16, reason *"The learner inserted this from a private thread"*) |
| Went idle with the question still open | trigger `promote` | `rule:closure` fired at 04:46:03 — *"The question was still open when the sitting went idle"* |

**The shaping is legible in three independent ways, and the report should use all three:**

1. **Which agent answers is decided by what kind of turn it was.** A question drew the Teacher
   (`rule:ellie_answers`); an answer drew the Tester (`rule:quiz_feedback`). The learner never
   chose an agent — the classification did.
2. **The verdict changed the follow-up.** *Well done* closed the question. *Partly there* re-asked
   the same question, narrowed to the part the learner skipped, with a slide quoted.
3. **The document changed differently depending on the input.** Five distinct recorded causes,
   each traceable to a specific learner action (table above).

---

## 4. Vocabularies, so nothing has to be guessed

All five are closed sets taken from the source, not from this sitting.

**What can trigger an agent turn** — `open` · `student_message` · `silence` · `promote` ·
`wrap_up`. (Observed here: `student_message` and `promote`.)

**How a learner's message is classified, before any model is called** — `attempt` · `give_up` ·
`question` · `other`. A turn of **25 words or fewer** is short enough to be a request or a
clarification rather than an attempt. Agreement alone ("ok", "makes sense") is never an attempt.

**The rules that decide a turn** — `ellie_answers` · `max_followup` · `mention` · `quiz_feedback`
· `quiz_clarify` · `ellie_cue` · `max_prompt` · `answer_released` · `closure`.

**Why an agent changed the document** — `answer_missing` · `q_block` · `q_resolved` ·
`whisper_insert` · `suggestion`. (Four of the five occurred in this sitting; `suggestion` did
not — see §6.)

**Why a sentence typed into the notes is refused** — `too_short` (under eight content words, or
agreement rather than a claim) · `no_sentence` (no terminal punctuation yet) · `no_objective`
(the block's slides are taught by no objective, or by more than one) · `unchanged` · `in_flight`.

**Verdicts** — `complete` · `partial`. Recorded with `source` (`chat` or `doc_text`) and an
`attempt_index` that counts attempts on one question.

---

## 5. What the report section must demonstrate, mapped to this data

| Requirement | The evidence here |
|---|---|
| A **single** learning activity | One `objective_id` (`506efb43279d9da9`) across all six learner turns |
| **Completed** | Question `q_94d09996f3b0` reached verdict `complete` twice (seq 22, 24) |
| Across **multiple conversational turns** | 14 messages; two questions; attempts 7, 8 on the first and 1, 2 on the second |
| What the learner **does** | Types in the chat; selects a line and presses ⌘E; types into the notes; asks privately; inserts a private answer into the shared notes |
| What the learner **thinks** | Visible in the revision: seq 29 states a general principle, seq 31 restates it — and Max names exactly that ("this is the same principle stated again, not applied") |
| How responses are **shaped by** the input | §3, three independent mechanisms |

**The best single illustration is the seq 29 → 31 pair.** The learner gives a correct general
principle; Max marks it *partial* and asks for the specific case; the learner writes the same
claim into the document instead of answering; Max marks it *partial* again and says so explicitly
— *and additionally corrects which slide the claim belongs to*. It shows an attempt, a verdict,
a revision that did not fully land, and feedback that is specific enough to be actionable.

---

## 6. Limits of this sample — state these, do not hide them

- **The learner never fully completed the second question.** Both attempts on `q_acd82539ae1b`
  were `partial`, and the sitting ended with it open (hence `rule:closure`). The *completed*
  activity in this sample is the first question, not the second.
- **The give-up path was not exercised.** No `answer_released`. The **Pass** control and the
  *"Say I don't know"* affordance were visible on screen throughout but never pressed.
- **The silence path was not exercised.** No `ellie_cue`, no `max_prompt` — the learner always
  answered before the reading-time threshold elapsed.
- **No suggestion was ever raised**, so `cause: suggestion` and the Accept · Reject control are
  absent from this data. Two attempts were made to provoke one, including seq 33. Both times the
  agent corrected in the chat and under its own question rather than editing the learner's
  paragraph. The behaviour is intended; the record simply does not contain an instance.
- **Turn 33 has no verdict** (§2).
- The learner in this sitting is the system's own developer. Treat the data as a demonstration of
  system behaviour, **not** as evidence about how a naive learner behaves.
