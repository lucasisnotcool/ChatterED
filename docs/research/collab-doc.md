# The collaborative notes doc: the agents write the notes with you, live

**Status.** Decision brief, 19 Sep 2026. Decided by Lucas in a four-round interview the same evening,
after the transcript-only convergence (`ai-use-transcripts/analysis/convergence.md`). This brief is
the **source of truth** for the interaction model from this date. What it supersedes is listed in
§9; superseded briefs stay in the repo as the record of why. Code that contradicts this brief is a
bug in the code.

> **Amended 1 Oct 2026 by `notebooks.md` (#58), which wins where the two differ.** Notebooks of
> uploaded sources replace the vault; the doc is a short learning overview, not AI-written full
> notes (§0, §2 here); Max asks only when the learner presses Quiz me (`rule:max_followup` and the
> hand-off in §4.2 are off); Ellie's chat answer is the full one and her doc edit is one line of at
> most 25 words (§4.6, §5.1 here). Everything else in this brief stands. `notebooks.md` §10 lists
> exactly what changed.

> **Amended 6 Oct 2026 by `notebooks.md` §11 (Lucas's decision), which wins where they differ.**
> For a slide deck, the notes are concept cards whose depth is written at ingest, at 30–40% of the
> slide words. A lesson's Start teaches first, and Max's question is offered when code judges the
> learner ready. A blank that gives itself away is caught in code, and after two partial answers
> the learner is offered Show me instead of a blank. An open question sits in a side rail and
> resolves into a one-line chip; a released answer and an idle closure write nothing into the doc.
> Dated notes below mark each section it touches (§2, §4.2, §4.4–§4.7, §5, §5.5, §5.7, §6).
> `notebooks.md` §11.8 lists exactly what changed.

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

   *Amended 2026-10-06 (`notebooks.md` §11.2):* the goal of notes "that can be read without ever
   opening the slides" returns, after `notebooks.md` §10 retired it on 1 Oct, but not at this
   length. For a slide deck the notes are concept cards: a visible core line per idea, and the
   depth folded under it. The whole is 30–40% of the slide words, against 1.08× here and 5.7% for
   the 1 Oct overview. The extract pass, page images and mandatory provenance stand.

**Provenance is mandatory on every block**: either `pages: [n, …]` (where the content came from) or
`reason: "…"` (why it is here when no slide says it), or both. A block with neither is a bug in the
ingest and is rejected by validation.

Long decks are ingested in page windows with a running outline so the notes stay cohesive; the doc
opens as soon as the first window lands and fills in behind a visible "Ellie is still writing"
marker.

## 3. The doc

- A normal rich-text editor: headings, paragraphs, lists, bold/italic, code, maths (KaTeX), inline
  slide figures. Fully editable by the learner.

  *Amended 2026-10-03 (maths).* Inline maths was only styled, so the learner read raw source such as
  `h_{\max}`, and display maths could not be edited at all. Now:
  - **Every formula is typeset**, inline and display. At rest, the arrow keys step over a formula
    as one unit, and Backspace highlights it before deleting it.
  - **A formula is edited in a popover.** It opens on a click, on ⌘⇧E, or on Insert ▸ Formula; for a
    display formula, also on `$$` and a space. The field is MathLive's, so a learner who knows no
    LaTeX types `/` for a fraction, `^` for a power and names like `alpha` or `>=`. The LaTeX
    source is one click away, and typing `$x^2$` directly also works. What is stored is always the
    TeX, and the text stays the author's, so the guard and the doc-text assessment are unchanged.
  - **Copy and paste.** A copy puts `$…$` and `$$…$$` on the clipboard as plain text. A paste reads
    `$…$`, `$$…$$`, `\(…\)` and `\[…\]`, and recovers the TeX from rendered maths on a web page
    (KaTeX, MathJax, MathML), instead of the doubled characters a rendered formula copies as. Agent
    text with `\(…\)` or `\[…\]`, in the notes or the chat, is read the same way.
  - **Money stays money.** Inline dollars follow Pandoc's rule, so "$5 and $6" is not a formula.
  - Code: `app/src/renderer/lib/pm/math.ts`, `matheditor.ts`, `mathpaste.ts`, and
    `app/src/shared/doc/tex.ts`.
- **Provenance chip** on each block: `p. 12` or `added: bridges p. 12 and p. 13`. A click opens the
  source slide in the in-doc modal (since 2026-10-03, a popover beside the chip; see below).
- **Inline slide figures** for evidentiary slides or regions (a crop of the rendered page, as
  before: pixels, not a redraw).
- **Slide carousel**: all slides, collapsed and labelled, grouped by the section of the notes they
  feed. A click expands one into an interactive in-doc modal (zoom, previous/next).

  *Amended 2026-10-03 (slides).* The modal and the carousel at the bottom of the notes are gone.
  The slides are now the most informative thing beside the notes, so they sit with the notes:
  - **A slide opens in a window of its own beside what was clicked**: a chip, a figure or a
    thumbnail. *Revised the same evening (Lucas's call):* the first cut was a popover that closed
    once its chip scrolled away. The window instead floats anywhere over the app, moved by its title
    bar and resized from its corner, and stays until it is closed:
    - **Several windows** can be open at once, so two slides can be compared. Clicking a slide that
      is already open brings its window to the front.
    - **Keys** work while a window is focused: ← → step through the deck, ↑ ↓ step through the
      slides the block cites (or the section's strip), and Esc closes it.
    - **Size.** A new window opens at the last size the learner chose. Positions are not kept.
    - **Text.** The slide's text is real text, so it can be selected and copied.
    - **Hover.** Hovering a chip shows a small peek: the slide, the matched region and the quote,
      with nothing to click.
  - **Images sit in the line, as in Word** (2026-10-03, later):
    - A slide in the notes is an image inside a paragraph, not a block between paragraphs. The
      paragraph carries the block id and the citation; a figure saved as a block is converted when
      the notes are opened.
    - The caret can stand on either side of an image, with room to click there. Backspace after it
      deletes it; Backspace before it at the start of a line moves the line up onto the one above.
    - It can be dragged to any text position, and cut, copied and pasted with the words around it.
    - Its four corners resize it in proportion.
    - A click opens its slide in a window whose yellow box is the image's crop; moving or resizing
      that box re-crops the image.
    Code: `pm/image.ts`, `schema.ts` (`slide_image`, `inlineFigures`).
  - **Insert into notes**: from the window, the whole slide or a dragged crop goes into the notes
    as a slide figure, after the block it was opened from. It is the learner's own edit, so it is
    undoable, and it counts towards that section's slides.
  - **Each section ends with its own collapsed "Slides" strip**, and the opening slides sit under
    the objectives. Each slide is in exactly one section. The grouping is code, not a model
    (`shared/doc/slidegroups.ts`):
    - Cited pages go to the section that cites them most strongly.
    - The overview's title and objectives list are not sections, because the list cites every
      objective's pages. That is how p. 41 of the complex v4.0 deck came to be filed under the
      title and under two other sections.
    - A page no block cites is placed by its position in the deck. A divider goes to the section
      after it; anything else goes to the neighbour whose words it shares.
    - References and appendix pages go to "Other slides".
  - **Dragging a thumbnail** turns the notes into a list of section titles to drop it on. A drop
    is the learner's correction and is kept for that document (`notes_slide_groups`, migration
    025). After Update overview it is remapped by heading text.
- **Highlight + Ctrl+E**: a question anchored to the span. It opens a thread in the chat column
  tied to that span; Ellie answers by default, `@Max` works, and the edit rules of §5 apply at that
  spot. The span keeps a highlight that jumps to its thread.
- **Freeze**: a toggle in the doc header. While frozen, no agent edits the doc; agents still talk.
  Edits that would have happened are dropped, not queued.
- **Provenance preview** (2026-10-01): hovering a provenance chip shows that slide's thumbnail
  with the region the block was drawn from outlined, and the slide's own words for it. The click
  opens the modal with the same region outlined. The region is found in code by matching the
  block's words against the page's extracted text lines; when nothing matches well enough the
  whole slide is shown with no outline and no quote, never a guessed region. No model call.
- **Tappable figures** (2026-10-01): on an inline slide figure, the slide's own text labels inside
  the crop are hotspots. A click on one offers *Ask Ellie about this*, which opens a span thread on
  the figure's block asking what that label is. The hotspots come from the PDF's text geometry,
  which is exact, and not from a vision model, which would have to guess at boxes. A figure with
  no text in its crop has none. A click elsewhere on the figure opens the slide, as before.
- **Listen** (2026-10-01): a control in the notes header reads the section the cursor is in
  aloud, one block at a time, with the block being read highlighted by a decoration. It uses the
  system's built-in speech, so there is no model call, no network and no generated script: it
  reads the notes as written. Display maths is read as "formula" and slide figures are skipped.
  It never edits the document.
- **Notes map** (2026-10-01): the notes' headings as an outline in the file panel, under the file
  tree, each marked by the fill of the objectives its section covers (none, partly, complete; no
  mark when no objective maps to it). A click scrolls the doc to the heading, and the section in
  view is marked. It is a view over the headings and the progress view, and generates nothing.

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

- **Amended 2026-09-25 (#49): a fallback when the classifier misses.** Max's feedback turn may open
  `Not marked.` instead of a verdict when the learner's turn asked for background and tried no answer.
  He gives it in at most 80 words and re-asks. Code un-counts the attempt (no outcome, no fill, no
  notes edit), and the question stays open.

- **Amended 2026-10-03 (Lucas's complex v4.0 run): the follow-ups end.** One three-part question on
  the p. 4 `Fly` action was marked *Partly there* six times. Each answer was marked on its own
  against the whole question, so an answer to one follow-up could never be complete. Each follow-up
  was narrower than the last, ending on which line declares the parameters. And `:action ?`, a
  guess at what Max wanted, got another open question. What changed:
  - **Max asks for one thing.** A question in parts is marked part by part, and every missing part
    becomes a follow-up.
  - **From the second try, the answers are marked together** against the question Max first asked.
    A follow-up asks only for part of that question, never for something it did not ask.
  - **Two open follow-ups, then a blank.** Past two open follow-ups on one question, or after a
    guess (a few words ending in a question mark), a follow-up that is still owed is one
    fill-in-the-blank on what is missing (§4.5). It is marked as a blank, so the term fills nothing
    beyond what the earlier answers earned. A correct term closes the question as *you got this*.
  Code: `core/pitch.ts` (`followUpPlan`, `isGuess`, `OPEN_FOLLOW_UPS`), `prompts.doc.ts`
  (`followUpBlock`), `flow.ts` (`followUpBlank`).

- **Amended 2026-10-06 (`notebooks.md` §11.4): no blank to end a run, and the correction waits.**
  Of 47 follow-ups from 3 Oct, 31 were a blank or carried their own answer. Every chain that
  reached a third verdict short of complete ended on a blank, 8 of 8, and all 8 were scored
  complete, one of them on the wrong word. The answer was usually on screen, because the feedback
  turn had just quoted the page for "what was missing".
  - **"Two open follow-ups, then a blank" is superseded.** After two partial answers the learner
    is offered **Show me**, a release (§4.4). Asking for one thing, and marking the answers
    together from the second try, stand.
  - **The feedback row above changes for partial answers.** The verdict and what landed stand.
    The part still missing is not quoted or stated while a follow-up asks for it, and the
    correction is given when the question closes. `attempt-first.md`'s grounds rule is narrowed
    to match.
  - **One verdict per message**, matching the outcome that is logged. **No "Why…?" tail** after
    *Well done*.
  - Any blank that is still asked (§4.5) passes a check in `core/pitch.ts`: the blanked term must
    not be in Max's turn, in the sentence he quoted before the blank, or in the blank's mirror
    sentence when that is on screen. On a hit the reply is regenerated once, then the blank is
    dropped.

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

*Amended 2026-10-06 (`notebooks.md` §11.4, §11.5):* after two partial answers the open question
also offers **Show me**, which is this release. A released answer goes to the chat only; nothing
is written into the doc for it.

### 4.5 Difficulty follows the learner

No fixed rungs. Max is given the learner's recent results on this file (the last few verdicts and
releases, and the objective's current fill) and pitches freely, with two hard instructions: after a
`give_up`, the next question on that objective is **easier** (recall, or one part of the idea);
after a *Well done*, the next may be harder (explain why, apply to a case). The pitch inputs are a
pure function (`room/pitch.ts`), unit-tested; the wording is the model's.
*Clarified 2026-09-25 (#49):* "harder" stays inside the deck. The case must be one the deck's own
examples or Ellie's answer equip the learner for, never a method, notation or format the page only
names.

*Amended 2026-10-01 (from the simulation harness, `app/sim/`):* a first question on an objective
asks the learner to **use** the idea, on a case the page itself works through or by saying why it
holds, rather than to name or tell apart what the page shows; "harder" is a new angle, never the
settled distinction asked again about another symbol. Quiz me's question is about **the line
pressed** (`notebooks.md` §4.1), with the objective's seed questions offered as ideas, not stems.
Max marks against **the question he asked**, which he is shown; the objective's checklist is not
in the marking turn, and a step the question did not ask for is never missing.

**Amended 2026-10-01: the easier question is a fill-in-the-blank.** "Easier (recall, or one part of
the idea)" was left to the model, and a recall question in prose is still a question to compose an
answer to. After a release, the next question on that objective is now one sentence from the page
with one key term replaced by `____`. The design reasons:

- **It is the smallest thing that can be asked.** A learner who has just given up is asked for one
  term, not for a paragraph.
- **A correct blank fills nothing.** One recalled term is not the learner's own words about the
  objective (§6), so its verdict is recorded with `form: 'cloze'`, `progressFill` skips it, and the
  ledger is not run on the answer.
- **It does not license a harder question.** After a filled blank the next question on that
  objective is the own-words one a first question would have been.
- **Code reads the form off the question.** The pitch asks for a blank; a question that comes back
  without one is an open question and is marked and counted as one, so a fill is never withheld
  because Max ignored the instruction.
- **Marking.** *Well done* or *Not yet*, no *Partly there*. A wrong term gets where on the page to
  look and the sentence again, not the term.

Code: `core/pitch.ts` (`QuestionForm`, `questionForm`, `pitchBlock`), `prompts.doc.ts`
(`maxFollowupBlock`, `clozeFeedbackBlock`), migration 023. Only `rule:max_followup` is pitched, so
only the follow-up can be a blank.

*Amended 2026-10-03:* a blank is also how a run of *Partly there* ends: the third follow-up on one
question, or the follow-up to a guess, is one blank (§4.2). Its verdict is recorded with
`form: 'cloze'` for the same reason as above.

*Amended 2026-10-06 (`notebooks.md` §11.4): the paragraph above is superseded.* A run of
*Partly there* ends on an offer of Show me, not a blank (§4.2). The blank after a release (1 Oct)
stands, and must pass the give-away check in `core/pitch.ts`. A question resolved by a blank shows
*revisit* in the notes, never *You got this* (§5).

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

*Amended 2026-10-06 (`notebooks.md` §11.2):* the doc half, cut to one line on 1 Oct, is now an
addition to the card's depth of about 120 words at most, extending or replacing a depth item.

### 4.7 Closure: nothing is left hanging

Two invariants, enforced by rule, not by prompt:

- **No question Max asked is left without its answer.** If a question is still open when the flow
  session goes idle (the existing inactivity gap) or the file is closed, Max releases the answer
  (`rule:closure`), and the doc's Q block is resolved as *released*.
- **No mistake Ellie made is left uncorrected.** If Ellie's cue contained a mistake and the thread
  ends by any path, the resolving Max turn corrects it explicitly. The cue turn records
  `hasMistake` and the claim, so the rule can check that the correction happened.
  *Amended 2026-10-03:* the correction is asked of the **first** Max turn after the cue (a
  feedback turn, a release or closure), **once**. It used to be repeated on every feedback turn
  until the question closed, six times in one run. A mistake is a claim the page contradicts, not
  a doubt. If the page shows her flagged claim is right, Max says so rather than inventing a fault.

*Amended 2026-10-06 (`notebooks.md` §11.5):* both invariants stand in the chat. **Nothing is
written into the doc on an idle closure.** The release goes to the chat, and the open question's
chip shows *revisit*. In the studied notes, closure had released two answers 5 s and 11 s after
asking, leaving questions in the notes the learner never had a chance at.

### 4.8 Where to look next (2026-10-01)

When a sitting goes idle (the inactivity gap, after any closure release), **Ellie posts one message
in the doc chat that says where the file stands**: how many objectives are complete, then up to
three each of *answer shown, worth another try*, *partly there* and *not started*, each with its
pages as `p. N`, which the chat already links into the notes.

- **Written in code, from the outcome rows, with no model call** (`room/focusrecap.ts`). The same
  rows draw the bar, so the message and the bar cannot disagree, and a model asked to summarise a
  learner's record can misstate it. It also means the closure tick never waits on a call.
- **Once per sitting**, and not again when the file is reopened with that sitting still closed.
- **Nothing is posted for a sitting in which no question was resolved.** A list of everything
  undone, sent to someone who only read, is a nag.
- *Answer shown* means the last thing that happened on that objective this sitting was a release.

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

*Amended 2026-10-06 (`notebooks.md` §11.5): rows 5.2 and 5.3, and the amendment of 25 Sep, are
superseded as to where the question and its answer go.* In the studied MDP notes, Max's 1,406
words outnumbered the generator's 264, and about 90% of them was text a learner would not keep:
question prompts with their chat preamble, resolutions repeating the doc, one wrong resolution, and
one-word "answers" from blanks shown as *you got this*. Now:
- **An open question sits in a side rail beside its card**, not in the doc body (5.2).
- **On resolution it folds into a one-line self-check chip under the card**: the question in one
  line and the learner's earned answer, collapsed (5.3). It replaces "Q blocks stay".
- **A question resolved by a blank, a give-up or closure shows *revisit*, never *you got this*.**
  A released answer, including *partly yours*, goes to the chat only, and the 30–100-word "correct
  answer, written as notes" is no longer written.
- **No boilerplate** ("this tests the statement, not you"), **no verdict text and no tutorial
  breadcrumbs** ("Checked: correct", "Hint 2: …", "Answer shown in the chat") go into the doc.
- The edit controls (Remove · Keep), Freeze and the critical rule below stand.

**The critical rule (Lucas's 5.4).** All doc content starts AI-generated, and agents have free rein
over AI-written text: they may rewrite, move and merge it. **Learner-written text is never
overwritten, moved, or undone by an agent.** Text provenance (who wrote which characters) is tracked
per span. An agent works around learner text; if a change to learner text is the only correct edit,
it is a **suggestion**, Google-Docs style: strikethrough for the deletion, the agent's colour for
the addition, and an accept / reject control. Rejecting leaves the learner's text exactly as it was.

The guard is code: an agent transaction that touches a learner-authored range is rejected before it
is applied, and re-expressed as a suggestion. It is unit-tested against the editor's document model,
not against a prompt.

### 5.5 Answering in place (2026-10-01)

An open Q block carries **Answer here**, which opens a paragraph under the question, and **Submit
answer** (⌘↩) once the learner has written in it.

- **It is the same attempt a chat answer is.** Max marks it in the thread he asked in, so the
  exchange stays in one place. The verdict is filed as `doc_text`, a correction to the learner's
  wording is offered as a suggestion (the critical rule above), and a *you got this* does not copy
  in an answer that is already there.
- **A Submit is an attempt whatever its length.** §6's pause and length floor guess whether a pause
  was an attempt; a button says so. A give-up phrase still releases the answer (§4.4).
- **The pause watcher no longer reports text inside any Q block.** An answer there is marked on
  Submit only, so it cannot be marked twice, once by the pause and once by the button.
- An answer to a question that is no longer the open one is refused, and the block says so.

*Amended 2026-10-06 (`notebooks.md` §11.5):* the open question is in the side rail, so Answer here
and Submit live there, not in the doc body. The rest of this section stands. A submitted answer that
earns *Well done* becomes the learner's answer in the question's chip.

### 5.6 The learner's own questions (2026-10-01)

**Add a question** in the notes header inserts a Q block marked *You asked*, after the block the
cursor is in and carrying that block's pages. The learner writes the question, answers it in the
same block, and submits; Max marks the answer against the deck in a thread anchored to the block.

- **It fills no progress, and that is structural.** The question is never Max's open question: no
  outcome row is written, the pitch does not read it, the ledger is not run on it, and the thread
  is filed under no objective. A *Well done* resolves the learner's Q block as *you got this* and
  does nothing else.
- **It is independent of Max's open question.** "One open Max question at a time" is about
  questions he asks; marking a self-set one leaves his open and unmarked.
- **Open decision:** whether a self-set question should ever count toward an objective. The case
  against is that the learner chooses how hard it is. Until decided, it counts for nothing.
- Editing the text of one of *Max's* questions in the doc does not change what he marks: he marks
  the question he asked.

### 5.7 Tables and diagrams, on request (2026-10-01)

**Insert** in the notes header asks Ellie for a **table** or a **diagram** at the block the cursor
is in, with an optional line saying what it should show.

- **Both are ordinary blocks of real text.** A table's cells and a diagram's labels are document
  text with the author mark, so the learner edits them in place, the critical rule above protects
  what they typed, and every row and node carries the slide pages it came from. A diagram is
  labelled nodes and optional arrows in one of four layouts (`flow`, `hierarchy`, `compare`,
  `cycle`), laid out by the renderer. Nothing is drawn by an image model, so a wrong label is
  fixed by editing it, not by regenerating a picture.
- **The model sees the section and its slides, and nothing else.** The section is the blocks under
  the same heading as the cursor's block; the slides are the pages that section came from, at
  most ten. It may decline (`make: false`) when the section compares nothing or has one idea in
  it, and then nothing is inserted.
- **The reply is validated in code** (`shared/doc/validate.ts`): column, row and node caps, one
  cell per column, unique node ids, edges and parents that name existing nodes. A reply that does
  not pass inserts nothing. Provenance is set in code, so a block cannot arrive without it (§2).
- **It arrives as an agent edit like any other**: green, Remove · Keep, dropped while frozen.
  It is the learner's act on the document and not a turn: no message, no timer, no ledger.
- The ingest does not write tables or diagrams; its schema is unchanged.

  *Amended 2026-10-06 (`notebooks.md` §11.2): superseded for tables.* A comparison the slide
  itself gives as a table is written in at ingest, through the same validators, with provenance
  set in code. The ingest still writes no diagrams. Insert works as above.

Code: `room/docedit.ts` (`planGeneratedBlock`), `actor.generateBlock`, `notes:generateBlock`.

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
  1. posts an Ellie message in the doc chat announcing what we need to understand and the objective,
     teaching nothing and asking nothing;
  2. scrolls the doc to the segment that carries it;
  3. shows Max typing while the learner reads it (one read of her message at 238 wpm, 4–15 s), then
     has Max ask the first question on the objective, pitched and filed as Quiz me's is, with its
     Q block under the objective's first block. If Max already has a question open, step 3 is
     skipped and Ellie points the learner back to it.

  *Amended 2026-10-03:* "the objective's first block" is its first **section heading** (the
  scroll target), and the Q block goes under the block below that heading. The "By the end you
  can" list is cited to every objective's pages, so it used to be every objective's first block,
  and every lesson's question was filed at the top of the notes. It is no longer counted as any
  objective's block.

  *Revised 2026-10-01 (Lucas's decision).* Step 3 used to be "has Ellie prompt the learner to ask
  a question to begin". A lesson now opens on Max's first question on the objective, which is how
  the learner clears it.

  *Amended 2026-10-06 (`notebooks.md` §11.3): step 3 above is superseded, and step 1 changes.*
  In the five conversations from 3 Oct, all 30 of Max's opening questions came from a Start, each
  within seconds of Ellie's announcement, and the cold ones found the learner unready. Now:
  - **Ellie walks the learner through the objective's card** instead of only announcing it.
  - **Max does not ask.** A pure function in `core/` judges readiness from what the learner has
    done on that objective: depth opened, Explain or Example used, their own note written, time on
    the section. When it is ready, the app offers *Ready to check this?*, and the learner presses.
  - **A complete objective is never asked again**, even after New Conversation.
  - Step 2 (the scroll) stands.

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

The table above lists what this brief supersedes. What later briefs supersede in this one is listed
there: `notebooks.md` §10 (1 Oct) and `notebooks.md` §11.8 (6 Oct). The time-based hand-off stays
superseded. The readiness offer of `notebooks.md` §11.3 is not that hand-off: it never asks, and it
only offers.
