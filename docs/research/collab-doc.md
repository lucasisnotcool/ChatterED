# The collaborative notes doc: the agents write the notes with you, live

**Status.** Decision brief, 19 Sep 2026. Decided by Lucas in a four-round interview the same evening,
after the transcript-only convergence (`ai-use-transcripts/analysis/convergence.md`). This brief is
the **source of truth** for the interaction model from this date. What it supersedes is listed in
§9; superseded briefs stay in the repo as the record of why. Code that contradicts this brief is a
bug in the code.

**Read alongside.** `ai-use-transcripts/analysis/convergence.md` (the evidence, observed
interactions only), `attempt-first.md` (the loop this replaces, and the rules that survive it),
`learning-objectives.md` (the objective tree the progress bar is drawn from),
`progress-tracking.md` §4.4 (the ledger's hard rules, unchanged).

---

## 0. The idea in one box

A lecture deck is **ingested into a set of lecture notes**: an editable text document that reads on
its own, where every segment knows which slide it came from or why it is there. The layout is
**file panel · doc · chats**. Ellie (green) and Max (red) are **present in the doc**, each with a
cursor, and they edit it as the conversation goes: an answer that was missing is written in, a
question Max asks is written in, and the corrected answer is written under it. The learner can edit
anything, highlight a span and ask about it, freeze the agents, and remove any agent edit in one
click. **Nothing the learner writes is ever overwritten.**

The model is collaborative editing (Google Docs), not a chat beside a PDF.

## 1. How this sits against the evidence

From `convergence.md`. Stated both ways, because the report has to.

**What it answers.**

| Observation | What the doc does |
|---|---|
| R1, R3, R4 open by asking for lecture notes; R1 returns with "refine notes based on my quiz score" | Notes are the artefact, and they are refined by what the conversation reveals (§5). |
| R3's "all lectures" silently became lectures 7–13; R4 claimed "97% coverage" after its own check failed; R2 mislabelled the slide's variables | Every segment carries provenance to its slide; omissions and errors are checkable in one click (§2, §3). |
| R2 and R5: 7 of 8 worded follow-ups repair the AI's previous answer; 93 AI words per typed word | The answer lands once, in the doc, where it belongs, instead of scrolling away; chat turns stay short (§4.6). |
| R6: 5 of 6 questions handed back unattempted before the learner set rules; all 7 answer requests granted in full, at once | Max's question is the learner's to answer first. What comes before the full answer is a peer's partial take and a prompt, not the answer (§4.3). |
| R6 L20 lowered the difficulty in the same message that set attempt-first; L34 "this query seems too complex" | A give-up is read as "too hard": the next question is pitched lower (§4.5). |
| R6: 17 of 21 feedback turns bundled the next question; 0 of 17 later attempts was a second try | One open question at a time; its Q block stays in the doc until it is resolved (§4.2, §5). |

**Where it departs, knowingly.**

1. **The answer is no longer locked behind an attempt.** `attempt-first.md` §2.3 withheld it until
   one attempt. Here any give-up phrase releases it (§4.4). Lucas's reason: a learner must never see
   a question they never get the answer to, and a refused answer teaches less than a lowered
   question. The transcripts cannot say which is right; it is A2's first test.
2. **The doc is AI-written**, so the durable artefact is mostly the agents' words. The learner's own
   words count toward progress both in chat and in the doc (§6), which is the counterweight.
3. **Ellie's cue may contain a plausible mistake** (§4.3). The risk is a learner who reads it and
   leaves. The closure rule (§4.7) exists for that.
4. **Slides are re-typeset.** `pdf-fidelity-segmentation.md` requirement R1 ("never re-typeset") is
   retired (§9). Fidelity is now carried by provenance and by inline slide crops for anything
   diagrammatic (§2).

## 2. Ingest: heavy AI work, at the front

Real on any deck. Two passes.

1. **Extract.** All original slide text, per page, as structured data (pdf.js text items with
   geometry, grouped into lines and blocks; the existing `vault/geometry.ts` and `vault/pdf.ts`).
   Page images are rendered for pass 2.
2. **Refine.** An LLM pass over the structured text **with the slide images**. It produces cohesive
   lecture notes that can be read without ever opening the slides, and it marks, per slide, whether
   the slide (or a region of it) is **evidentiary** (a diagram, figure, table or formula layout that
   text cannot carry) and must be shown inline, or can live in the carousel. It may add bridging
   material and must say so.

   **What the slides teach, not what they say (2026-09-23).** The notes carry **what each stretch
   of slides is trying to teach**, organised **by idea in the deck's order**: one heading per idea
   rather than per slide, each section opening with its takeaway, with title, agenda, divider and
   admin slides dropped and repeated examples cut to one. Each window gets a word ceiling computed
   in code from its slides' own words (`main/notes/prompts.ts` `windowWordBudget`: ≤ 1.2× a page's
   words, at most 90, nothing for a near-empty page), and `notes.window` logs the words written
   against it.

   *Correction, same day.* The stored notes measured 2.3–3.0× the slides' words (Lecture 4 at
   ~9,500 words, a 40-minute read), and that was first read as verbosity. It was mostly a bug:
   **every ingest window was saved twice**. The renderer re-derived each window's nodes with its
   own block ids, and its next save rebased main's copy in beside them (fixed: `notes.window`
   now carries main's nodes, `ops.ts` `appendNodes`). With the duplicates removed, the v2 prose
   was 1.13–1.47× the slides (72–80 words a page, inside v2's own 60–90). What v3 changes is
   mainly the organisation: on Lecture-complex, regenerated live with page images, headings went
   48 → 25 and length 1.14× → 1.08× (4,289 words, no duplicates).

**Provenance is mandatory on every block**: either `pages: [n, …]` (where the content came from) or
`reason: "…"` (why it is here when no slide says it), or both. A block with neither is a bug in the
ingest and is rejected by validation.

Long decks are ingested in page windows with a running outline so the notes stay cohesive; the doc
opens as soon as the first window lands and fills in behind a visible "Ellie is still writing"
marker.

## 3. The doc

- A normal rich-text editor: headings, paragraphs, lists, bold/italic, code, maths (KaTeX), inline
  slide figures. Fully editable by the learner.
- **Provenance chip** on each block: `p. 12` or `added: bridges p. 12 and p. 13`. A click opens the
  source slide in the in-doc modal.
- **Inline slide figures** for evidentiary slides or regions (a crop of the rendered page, as
  before: pixels, not a redraw).
- **Slide carousel**: all slides, collapsed and labelled, grouped by the section of the notes they
  feed. A click expands one into an interactive in-doc modal (zoom, previous/next).
- **Highlight + Ctrl+E**: a question anchored to the span. It opens a thread in the chat column
  tied to that span; Ellie answers by default, `@Max` works, and the edit rules of §5 apply at that
  spot. The span keeps a highlight that jumps to its thread.
- **Freeze**: a toggle in the doc header. While frozen, no agent edits the doc; agents still talk.
  Edits that would have happened are dropped, not queued.

## 4. The conversation

### 4.1 Channels

- **Doc chat**: the shared thread for the open file. Span-anchored threads (Ctrl+E) are part of it.
- **Private threads**: one with Ellie, one with Max. Private. **They never edit the doc** unless the
  learner clicks "insert into the document" on a message (the whisper's one path from private to
  shared, kept).

### 4.2 Who speaks

| Learner does | Who answers | Rule |
|---|---|---|
| Asks in doc chat, no mention | **Ellie answers in full**, then **Max asks one follow-up** to the chat | `rule:ellie_answers`, `rule:max_followup` |
| `@Ellie …` | Ellie only; no follow-up | `rule:mention` |
| `@Max …` | Max only | `rule:mention` |
| Answers Max's open question | Max gives feedback: verdict first (`Well done.` / `Partly there.` / `Not yet.`), grounds as `p. N: "…"`, and a follow-up on the same question unless *Well done* | `rule:quiz_feedback` (unchanged) |
| Asks a clarifying question while Max's question is open | Max clarifies without answering his own question | `rule:quiz_clarify` (unchanged) |
| Says a give-up phrase while Max's question is open | **Max releases the full answer** | `rule:answer_released` |
| Is silent past the threshold while Max's question is open | **Ellie's cue**, then Max's prompt (§4.3) | `rule:ellie_cue`, `rule:max_prompt` |

**One open Max question at a time per file.** `rule:max_followup` does not fire while one is open;
Ellie's answer to a new learner question simply stands, and Max's open question stays open.

**Amended 2026-09-23 (#49, Lucas's Lecture 4 run):**
- **A request for background is a clarifying question.** That includes *"can you give me an
  example of…"*, *"I'm not familiar with…"*, and *"I don't know what X is"*, however many
  sentences it runs to. Max gives the idea or format the question assumes, with an example of his
  own that is not the case asked about. The limit is 80 words, not two or three sentences. He
  re-asks the question and still says it did not count as a try (kept by Lucas's call). No Max
  turn comments on how the learner went about it, for example "asking was reasonable".
- **The follow-up is filed under the objective of the page the learner asked on.** The taught set
  was empty in the live app, so every follow-up fell to deck order's first objective. A *Well
  done* on p. 11 filled pp. 3–6. The question must be answerable from the page and Ellie's answer
  alone. The first question on an objective asks for own words or telling things apart, never a
  construction the page only names. The pitch's "fill" is that objective's fill, not the file's.

All of the above are rules in the orchestrator, decided in code before any model is consulted, as
today. The model writes the words of a turn; it never decides whether an answer is due.

### 4.3 Ellie's cue, and Max's prompt

When Max's question has waited past the silence threshold (reading-time scaled, as
`attempt-first.md` §5: `clamp(2 × words / 238 wpm, 120 s, 300 s)`; the Demo pacing profile shortens
it) and the learner has not attempted:

1. **Ellie offers an unsure or partial take** as a peer: part of it right, hedged, possibly with one
   plausible mistake of the kind a student makes. At most 60 words. She never gives the full answer
   to Max's question. Marked in the thread as *Ellie's guess*. **It is never written to the doc.**
2. **Max responds to her, aimed at the learner**: he neither confirms nor corrects yet; he names
   the part worth looking at and asks the learner to improve on it or say whether she is right.
   At most 50 words.

This fires **once per question**. After it, silence is left alone until the closure rule (§4.7).
This is the peer of Xu et al. (2026): something to improve on, in place of an answer.

### 4.4 Releasing the answer

`classifyLearnerTurn` (kept, `room/attempt.ts`) gains a `give_up` class that absorbs today's
`answer_request` and the frustration and don't-know phrasings: *"I don't know"*, *"idk"*, *"no
idea"*, *"I give up"*, *"just tell me"*, *"what's the answer"*, *"this is too hard"*, *"I'm lost"*,
and the R6 phrasings already in `ANSWER_REQUEST_PHRASES`. There is also a **Pass** control on the
open question.

On `give_up`, at any time, with or without an attempt: Max gives the full answer with grounds, says
what any earlier attempt had of it, and corrects Ellie's guess if she made one. Logged
`quiz.answer_released`. **It fills no progress.** `rule:answer_withheld` is retired.

### 4.5 Difficulty follows the learner

No fixed rungs. Max is given the learner's recent results on this file (the last few verdicts and
releases, and the objective's current fill) and pitches freely, with two hard instructions: after a
`give_up`, the next question on that objective is **easier** (recall, or one part of the idea);
after a *Well done*, the next may be harder (explain why, apply to a case). The pitch inputs are a
pure function (`room/pitch.ts`), unit-tested; the wording is the model's.

### 4.6 Size

Max's turns stay at the `attempt-first.md` §4 sizes (feedback under 100; released answer under 150).
The doc is where length lives, and since 2026-09-23 that is literal for Ellie too:

**Ellie's doc-chat answer is the short half (~60 words, ceiling 90):** the answer in her first
sentence, the plain meaning, one example, the page. **The long half** (the rigorous version, the
conditions, how the slide uses it) is written into the notes by the §5.1 edit. It replaced ~120 /
ceiling 180 because the live app ran the lengths the wrong way: chat replies at a median of 202
words (her five-step shape cannot fit 120 and always won), notes additions at ~80, because the edit
was condensed out of the reply. The A1 report commits to the split (§1.4, DG4: *"Replies in chat
are kept short while longer explainers are written into notes"*). **When the doc is frozen** no edit
can land, so she gives the full answer at the old size. Code: `prompts.doc.ts` `ellieAnswersBlock`,
`prompts.ts` `turnDirective` (`docChat`), `actor.ts` `#answerSplitsIntoNotes`.

### 4.7 Closure: nothing is left hanging

Two invariants, enforced by rule, not by prompt:

- **No question Max asked is left without its answer.** If a question is still open when the flow
  session goes idle (the existing inactivity gap) or the file is closed, Max releases the answer
  (`rule:closure`), and the doc's Q block is resolved as *released*.
- **No mistake Ellie made is left uncorrected.** If Ellie's cue contained a mistake and the thread
  ends by any path, the resolving Max turn corrects it explicitly. The cue turn records
  `hasMistake` and the claim, so the rule can check that the correction happened.

## 5. Live agent editing

Agents are visibly present: a labelled cursor each, green for Ellie, red for Max. An edit is typed
in at reading speed with the cursor, not pasted, and the doc scrolls to it only if the learner is
not typing.

**When an agent edits:**

| # | Trigger | Edit |
|---|---|---|
| 5.1 | The learner asked, and the **fuller explanation is missing from the doc** | Ellie writes the long half of her answer (§4.6), green, at the segment it belongs to, with provenance, 40–150 words. The call is given the learner's question, the page's slide text and her chat reply (as what not to repeat). If the doc already carries it, no edit; she points to the block instead. |
| 5.2 | Max asks a question the doc **does not already answer** | Max writes the question in as a **Q block** (red, body text) at the segment it is about. |
| 5.3 | A Max question is resolved: by the learner's answer and Max's feedback, by release, or by closure | **Max's correct version** is written under the Q block, red, tagged with how it was resolved (*you got this* / *partly yours* / *released*). *Amended 2026-09-25, below.* |

**Amended 2026-09-25 (#49): the chat is about the learner, the notes are about the material.**
5.3 had been built by copying Max's resolving turn into the notes word for word, and it fired on
every feedback turn. The live runs of 20–23 Sep wrote 17 resolutions under 5 questions: each *Partly
there* and *Not yet* with its verdict, second-person marking and follow-up question, newest on top,
with the Q block marked resolved while the question was still open in the chat. What changed:

- **A question resolves once, when it closes**, which means the learner's *Well done* or a release.
  *Partly there* and *Not yet* write nothing to the notes. *Partly yours* is a release after any
  *Partly there*. A second resolution on a closed question is a no-op, in the actor and in the op.
- **On *you got this* the learner's own answer is the entry** (Lucas's call). Their chat answer
  goes under the question verbatim, in **their** author mark and with no edit id. The guard
  protects it, and Remove on Max's edit leaves it. Max adds at most one sentence, and only if the
  answer leaves out or misstates something. Learner text inside a resolved Q block is not reported
  as a new doc-text attempt.
- **Otherwise the notes get the correct answer, written as notes**: a structured call
  (`docedit.planResolveEdit`) given the question, the slide and Max's turn, with no verdict, no
  second person, no question and no mention of anyone. That is one call per question. If the call
  fails, a conservative code filter keeps only the sentences of the turn that could stand in notes.
  If nothing survives, the question closes tag-only.
- **Closure's criteria fallback no longer writes the criteria.** They are phrased as a rubric ("Lists
  all four steps in order") and were once written under a question as if they were its answer.
  They are now input to the same call.
- **5.2 is filed where the exchange was.** A follow-up that borrows an example from another page
  anchors at the page the learner asked on, not at the example's pages. Provenance still names
  what the question cites.
- **5.1 does not fire on a lesson's Start**, which is told not to teach yet.

- **Q blocks stay** after they are resolved. The learner removes them if they want to.
- **Every agent edit can be removed or edited in one click** (a small control on the edit: Remove ·
  Keep). *Keep* drops the colour and keeps the text and its provenance.
- **Freeze** stops all of it (§3).

**The critical rule (Lucas's 5.4).** All doc content starts AI-generated, and agents have free rein
over AI-written text: they may rewrite, move and merge it. **Learner-written text is never
overwritten, moved, or undone by an agent.** Text provenance (who wrote which characters) is tracked
per span. An agent works around learner text; if a change to learner text is the only correct edit,
it is a **suggestion**, Google-Docs style: strikethrough for the deletion, the agent's colour for
the addition, and an accept / reject control. Rejecting leaves the learner's text exactly as it was.

The guard is code: an agent transaction that touches a learner-authored range is rejected before it
is applied, and re-expressed as a suggestion. It is unit-tested against the editor's document model,
not against a prompt.

## 6. Progress

- **Objectives are derived from the slides** (the existing objective ingest) and shown as a
  **progress bar** in the doc header: completed / total.
- **An objective completes on the learner's own correct answer**: Max's verdict *Well done* on the
  learner's words completes it; *Partly there* half-fills it. A released answer, Ellie's cue and
  agreement fill nothing. The ledger's hard rules are unchanged: only the learner's verbatim words
  are evidence.
- **The learner's own doc text counts.** When the learner writes in the doc (their own provenance
  span, at least one sentence, in a segment mapped to an objective), it is assessed as an attempt on
  that objective once they pause. Max's feedback goes to a thread anchored to that span, and any
  correction to the text itself is a suggestion (§5). This is the one place suggestions arise
  naturally.
- **Click the bar** and the objectives open as hover cards, one per objective, like lessons: title,
  what it asks of you, its fill, the slide pages. Each has one big **Start** button, which:
  1. posts an Ellie message in the doc chat announcing what we need to understand and the objective;
  2. scrolls the doc to the segment that carries it;
  3. has Ellie prompt the learner to ask a question to begin.

## 7. The demo and the report

**Deck:** `Academia/Sources/CS3249+Lecture+4.pdf` (Lucas's choice; about 66 pages; not committed).
Ingest is real. Everything in the filmed build is real.

**Step 1 stays reduced persistence**, on the transcript evidence. **Learning goal** stays: *the
learner can answer a question about the lecture in their own words, and revise after feedback.*
**Progress**: the bar. **Roles**: the learner asks, answers Max first, revises, edits, decides when
to give up; Ellie writes the notes, answers, and thinks aloud as a peer; Max asks, marks, releases,
and keeps the doc correct. **One design decision**: what comes before the answer is a peer's partial
take and a prompt aimed at the learner, by rule, and a give-up lowers the next question instead of
being refused. **One limitation**: the doc is AI-written and re-typeset, so its fidelity rests on
provenance the learner has to click; nothing verifies the notes against the slide in code.

## 8. Implementation shape (binding on the build)

- **Editor:** ProseMirror (framework-agnostic; Svelte 5 hosts the view). The schema carries
  `blockId`, block provenance (`pages`, `reason`), an **author mark** on every text span
  (`ingest | ellie | max | user`, with `editId` for agent edits), suggestion marks
  (`suggest_ins`, `suggest_del`, with `suggestionId` and the agent), Q blocks, and slide-figure
  nodes. The document is stored as ProseMirror JSON in SQLite, versioned.
- **Agents address blocks, never offsets.** An agent edit is a structured op from main to renderer
  (`insert_after blockId`, `replace_block`, `append_to_block`, `resolve_q`), produced by a
  structured model call given the doc outline near the anchor. The renderer turns it into a
  transaction, runs the **guard**, animates it behind the agent's cursor, and saves.
- **The guard and the op→transaction mapping are pure**, in `src/shared/doc/`, tested without a DOM.
- **Reused as is:** the room actor, orchestrator, timer, ledger gates, `classifyLearnerTurn`,
  objective ingest and repos, the LLM backends (CLI, API, scripted), cost tracking, vault and pdf.js
  rendering, persistence.
- **Retired from the UI:** the crop flow, ticks and split, "+ Ask here", "+ Try this", the whisper
  popover (its scoping lives on as the private threads), the objectives tree panel (its data feeds
  the bar). Code is removed only where it is in the way.

## 9. What this supersedes

| Older text | Status |
|---|---|
| `pdf-fidelity-segmentation.md` R1 / §C0 "a segment is never re-typeset"; issue #25; CLAUDE.md "never re-typeset" | **Retired.** Lucas, 19 Sep: "it was from earlier expectation." Crops survive as inline figures and the carousel. |
| `attempt-first.md` §2.1 "+ Try this", §2.3 `rule:answer_withheld` / `rule:answer_shown`, §2.4 "Show the answer"; issue #47 point 3 | **Superseded** by §4.3–4.5. The classifier, the verdict opener, grounds, turn sizes and the reading-time threshold survive. |
| `pivot-integrated-document.md`, `pivot-spec.md`, `flow-build-plan.md`: the crop flow as the document; issue #23 | **Superseded** as the surface. The "conversation lives inside the document" argument stands and is carried further. |
| `flow-session.md` §8.2 time-based hand-off as a door to the Tester | **Superseded** by `rule:max_followup`. The flow session (inactivity gap) survives and drives closure. |
| Issue #16 whisper popover | **Superseded** by private threads; "insert into the document" survives. |
| Issue #38 objectives tree panel | **Superseded as UI** by the progress bar and lesson cards; the tree and ledger survive as data. |
| `docs/report/assignment1-draft.md` Steps 2–4, `video-storyboard.md` | To be rewritten against this brief. |
