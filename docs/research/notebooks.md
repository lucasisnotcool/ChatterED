# Notebooks and the learning overview: the learner builds the notes

**Status.** Decision brief, 1 Oct 2026. Decided by Lucas the same day, from a reviewed mockup
(the published artifact "ChatterED Notebooks Mockup") and five follow-up answers (§9). This brief is
the **source of truth** for the three areas below from this date. It amends
`collab-doc.md` (#48), which stays the source of truth for everything this file does not change;
§10 lists exactly what is superseded. Code that contradicts this brief is a bug in the code.

**Amended 6 Oct 2026 (Lucas's decision, §11): notes that replace the slides, Max on cue, a clean
doc.** For a slide deck the short overview gives way to concept cards whose depth is written at
ingest; Max's question is offered when code judges the learner ready; questions and their answers
stay out of the notes body. Where §11 and an earlier section differ, §11 wins. The earlier text
stays as the record, with a dated note where it is superseded, and §11.8 lists exactly what changed.

**Where it lives.** On `main`, as the direction of the ChatterED app (Lucas's call, 1 Oct: "replace
on main", over keeping it off main until `a2-submitted`). It was first framed as group-project
work; it is built here, and reaches the group repo with the rest of the app from `a2-submitted`.

---

## 0. The idea in one box

The learner adds files to a **notebook**, as in Gemini's notebooks: drag them in, tick which ones
count. The centre doc opens as a **short learning overview** of the ticked sources (a few minutes
to read, every line cited to its slide), not a full set of AI-written notes. The learner **builds
the notes** by working through the overview: each line has **Explain**, **Example**, **Quiz me** and
**Ask**. Every action gives two things: the full explanation in the **chat**, and a **one-line edit
in the doc**. Ellie and Max stay. Max asks only when asked.

The change in one sentence: the AI no longer gets the first full pass at the notes. It gets the
first *short* pass, and the rest of the notes grow from what the learner chose to work on.

*Amended 2026-10-06 (Lucas's decision, §11):* for a slide deck this box is superseded. The doc
opens as **notes that replace the slides**: one concept card per idea, its core line (the term and
a one-sentence definition, cited) always visible, and its depth (intuition, the equation with its
symbols in English, a worked example, the slide figure, a pitfall) folded under it and written at
ingest. On a real deck the short pass named every idea and explained none, and the learner rebuilt
the notes by hand (§11.1). Explain, Example, Quiz me and Ask stay. Max is still never sent
unasked: the app offers his question when code judges the learner ready, and the learner presses.

## 1. Notebooks replace the folder vault

- **A notebook is a named set of sources.** Sources are files the learner added: PDF, slides,
  Word, Markdown, text, images. There is no "open folder", no vault root, no file tree.
- **Sources are copied into app storage** (answer C), under the app's data directory, one folder
  per notebook. The original file can move or be deleted without breaking the notebook. Removing a
  source deletes the copy, never the original.
- **Adding sources:** drag files onto the sources column (its drop box lights up), or press
  **Add sources** for a file picker. Each new source shows a reading bar, then "ready" (text
  extracted and indexed). *Changed 2026-10-04 (Lucas):* this was "anywhere onto the notebook
  window". Now only the sources column turns a drop into sources. An **image** dropped on the
  notes or on a tutorial sheet goes into that sheet, in line, after the block it was dropped on.
  It is still added as an image source, because an image in a sheet is a notebook page
  (`slide_image` cites a page), which keeps its provenance and its slide window. Any other file
  dropped on a sheet or on the chat is refused, with a line that says to drop it on Sources.
- **The Notebooks home** is a grid of notebooks: title, source count, last edited, own-words fill.
  Dropping files on the home screen starts a new notebook named after the first file. A **New
  notebook** button opens the picker.
- **Existing work is kept.** On first launch after this change, each file that already has a notes
  doc becomes a notebook of one source (the file is copied in), and its existing notes doc is kept
  unchanged as that notebook's doc. Files on disk that were only browsed are not imported. The
  vault folder itself is never modified.

## 2. Context is per notebook

*Amended 2026-10-03:* sources now have a **role** (`tutorials.md` §1). A `lecture` source is
everything this section says. A `tutorial` is a problem sheet that opens as its own document
beside the notes and is never in the overview; a `solutions` source is never in anyone's context.

- **Each source has a checkbox.** The ticked sources are the notebook's context: the overview is
  written from them, and Ellie and Max read them. An unticked source stays in the notebook and
  is ignored. **All** ticks or unticks every source.
- The chat header states it: *Using 2 of 3 sources*.
- **Adding, ticking or unticking a source never rewrites the overview silently.** The doc shows a
  banner: *1 new source added. The overview doesn't cover it yet.* · **Update overview** · **Not
  now**. Updating rewrites only the overview's own AI-written blocks. The learner's text, and
  agent edits the learner kept, carry over under the section with the matching heading, or, when no
  section matches, under a final *Earlier notes* heading. The learner-text guard applies as it
  does to every agent edit.
  *Amended 2026-10-02 (Lucas's decision):* Ellie's notes (§4.2) that the learner has neither kept
  nor removed carry over too, with their Remove · Keep intact. A background note records a gap a
  question filled, for revision; losing it because the learner never pressed Keep loses exactly
  that. Max's unkept edits still go.

## 3. The learning overview

**One overview per notebook**, across the ticked sources.

### 3.1 Shape

1. **Title** (the deck's own topic) and a meta line: *from N sources · about M min to read*.
2. **Lede**: two or three sentences, the whole lecture in brief.
3. **By the end you can**: four or five objectives, each with its own-words fill. These are the
   objective tree's top level (`learning-objectives.md`), so the progress bar keeps its meaning.
4. **Sections, in the deck's order**, five to eight, one per idea, not one per slide:
   - a heading;
   - a **one-line takeaway**;
   - **two or three key ideas**, each one short paragraph, **each cited** to the pages it came from
     (`p.17`, `p.23–24`, and the source's name when the notebook has more than one source);
   - an empty **your note** slot (a placeholder the learner types into; it holds nothing until they
     do);
   - optionally, one **recommended block** (§5.3).
5. A last short section for **what comes next** when the deck ends on one.

*Amended 2026-10-06 (§11.2):* in a slide deck, a section's "two or three key ideas" become
**concept cards**, one per idea the section teaches, however many that is. A card is a core line
(the term and a one-sentence definition, cited) with its depth folded beneath it. Algorithms are
numbered steps, and a comparison the slide gives as a table is written in as a table. The title, the
meta line, the lede, the objectives, the deck's order, the one-line takeaway per section and the
your-note slot stand.

### 3.2 Length

About **350 words for a 60-page deck**, scaling gently with the material (a floor of about 200, a
ceiling of about 600), against about 9,500 for the #48 notes on the same deck. The budget is computed
in code from the ticked sources' word counts, as `windowWordBudget` was, and the ingest logs words
written against it. It is a ceiling: a deck with less to say gets less.

**Amended 2026-10-02 (Lucas's decision): the budget follows the kind of source.** The figures above
were calibrated on slide decks, at about 80 words a slide. A research paper is about 750 words a page,
and on the first one (a 15-page arXiv paper, about 9,800 words) the overview came out at 406 words:
nine sections of a one-line lede and two ten-word bullets, with the method, data and results reduced
to phrases and no numbers. For a learner that is not a map of a paper. So the budget is set per
source, from its own text:

- **Slides** (under 300 words a page): as above, unchanged.
- **Prose**, a paper or a reading (300 words a page or more): about a tenth of the body's words,
  between 400 and 1,200, with five to ten sections in the paper's own order and two to four key
  ideas each. The ideas may carry the paper's own specifics: the method's components, the datasets,
  the baselines, the headline results with their numbers, the limitations. It is still the map, not
  the working (§3.3): it names and places, and does not derive or re-explain. The overview says "the
  paper", not "the slides".
- **References are not the source's words.** Everything after a source's References heading is
  left out of the word count for both kinds.

*Amended 2026-10-06 (§11.2): the slide budget above is superseded.* About 350 words for a 60-page
deck came to 5.7% of the slides' words on a 68-slide deck, which named 28 of its 31 core concepts
in one line each and explained none. For slides, the whole notes are now **30–40% of the slide
words** (math blocks and figures not counted), with the always-visible core layer at **8–10%**,
about the size of the old overview. Each card gets 40–400 words by weight. The ratio is a check
logged against the source, not a hard ceiling. The prose budget of 2 Oct stands for papers and
readings, and the References rule stands for both.

### 3.3 Scaffolding, not answers

The overview is bare-minimum scaffolding: what each idea is and where it is on the slides, not the
working. Derivations, examples and worked cases are what Explain, Example and the recommended
blocks are for.

*Amended 2026-10-06 (§11.2): the paragraph above is superseded for slide decks.* The working
the slides carry (the equation, the slide's own worked example, the algorithm's steps, the figure)
is written at ingest, folded under each card's core line, so the folded doc still reads as a map.
Anything the slides do not say carries a `reason` and shows as added. The blanks rule below stands.

**Blanks only where the deck leaves one** (answer B). When a slide itself leaves a blank for the
student (Lecture-complex p.24 has "Max(Cost) = " and "Sum(Cost) = "; p.17 has "h_FF : ?"), the
overview may carry it as a blank, verbatim, with that page as provenance. The overview never
invents a blank the deck does not have.

### 3.4 Provenance

Unchanged from `collab-doc.md` §2: every block has `pages` or `reason` or both, and validation
rejects a block with neither. New: **pages are per source**. In a notebook of more than one source,
a citation names the source, so the chip reads `Notes p.3` rather than `p.3`. The hover preview and
the slide modal (#57) open the right file.

### 3.5 How it is made

One model call per overview over the ticked sources' extracted text, with page images for the
evidentiary pages as now, returning structured JSON (sections, key ideas with per-source pages,
objectives, starter questions, recommendations), validated in code, then turned into the doc. A
notebook too large for one call is outlined per source and merged in a second call. No per-window
notes pass.

*Amended 2026-10-06 (§11.2):* for a slide deck the JSON returns concept cards with their depth
items, and where it applies a math block per equation, a table where the slide has one, and the
page of a figure to place as a `slide_image`. All of it is validated in code with the existing
block validators before it becomes the doc. Whether this still fits one call per notebook is the
build's to measure.

## 4. Every line has actions

### 4.1 The actions

Hovering (or focusing) a block in the overview shows a small toolbar:

| Action | Who | Chat gets | Doc gets |
|---|---|---|---|
| **Explain** | Ellie | the full explanation, as long as it needs (the usual Teacher shape) | one line under the block: the point most worth keeping |
| **Example** | Ellie | a worked example, preferably the slide's own | one line: the example in brief |
| **Quiz me** | Max | his question, then feedback as now | the Q block under the block (as #56: the learner answers in place or in chat) |
| **Ask…** | either | the composer opens with the block quoted; the learner types the question | as for any doc-chat question |

The toolbar also shows on the block that holds the caret, so a tap or the keyboard reaches it
without a hover.

*Amended 2026-10-06 (§11.2, §11.5):* in the "Doc gets" column, Explain and Example now add to the
card's depth (extending or replacing a depth item) instead of inserting a new line under the
block. Quiz me's question no longer goes into the doc under the block: it sits in a side rail beside
the card while it is open, and folds into a one-line self-check chip under the card when it
resolves. The chat column is unchanged.

### 4.2 Two outputs, never one squeezed into the other

Lucas, 1 Oct: *"the answer usually does not fit verbosely into the doc, so need two separate outputs
for explaining to user vs. doc edit."* An action therefore asks for **two artefacts in one call**:
the chat message, and a doc line of **at most 25 words**, one sentence, written to stand in the
notes on its own (not "as I said above"). The doc line:

- is inserted **directly under the block it was asked on**, as a new block with Ellie's author mark;
- carries **provenance**: the pages Ellie drew on, or a `reason` when she added something the slides
  do not say;
- shows **Keep** and **Remove** (the existing agent-edit controls); Remove deletes it in one click;
- is never inserted when the doc is frozen (the chat message still arrives);
- never touches learner text (the guard, unchanged).

The chat message ends with a short note naming the edit: *Added one line under the bullet in §2.*

**The same holds for any question in the doc chat.** `collab-doc.md` §5.1 had Ellie write the long
half of her answer, 40–150 words, into the doc. It is now the same one line of at most 25 words,
under the block the question was about, with the same controls. The full answer stays in the chat.

**Amended 2026-10-02 (Lucas's decision): what the notes get follows what the exchange
uncovered.** On the first research paper, a learner asked how fine-tuning works in general and then
in the paper. Two thirds of Ellie's answer explained what fine-tuning and LoRA are, which the notes
took for granted; the 25-word line kept the paper's recipe, which the notes nearly said already. The
gap was found and filled, and the notes did not show it, so revising from them hits the same gap
again. Lucas: the filled gap should be *"evidenced in the doc, so that user can revise"*. So the doc
edit is one of three, chosen by the call that writes it:

- **Background**, when the question or the answer shows the notes assume something they never
  explain (a term, a method, a prerequisite) and Ellie explained it: a self-contained note of what
  it is and how it works, **at most 90 words**, under the block that assumed it, with the reason
  *background Ellie added* as its provenance unless it cites a page itself.
- **Detail**, when the source gives specifics the notes skip and the answer brought them out (an
  equation, a setting, a number, a step): the specifics themselves, **at most 50 words**.
- **Point**, otherwise: the one sentence most worth keeping, **at most 25 words**, as before.

Each limit is enforced in code as the 25 words were. The chat answer stays whole; the doc edit is
still Ellie's, with Keep and Remove; and nothing about it fills the bar (§4.3): only the learner's
own words do. A question asked in a thread on a block (a highlight or Ask…) files its edit under
that block, as a block action does.

*Amended 2026-10-06 (§11.2): the caps above are superseded; the two outputs stand.* On the MDP
study day the learner twice removed Ellie's short line and pasted her full chat answer in its
place, and 63% of the words marked as his were her chat answers copied in by hand. Ellie's doc edit
(from an action, a doc-chat question or a thread) now **attaches to the card's depth**: it extends
or replaces a depth item, and is never a new sibling block. One addition is **about 120 words** at
most, within the card's depth budget. The 2 Oct reasoning still decides what it adds (the
background the notes assumed, the specifics they skipped, or the point worth keeping), and the
limit is enforced in code. Keep and Remove, provenance, the frozen-doc rule, the guard and "fills
nothing" stand.

### 4.3 What does not fill the bar

Actions fill nothing. Explain and Example are Ellie's words; only the learner's own words count
(`collab-doc.md` §6, unchanged). A Quiz me answer fills as any answer to Max does.

## 5. Ellie and Max

### 5.1 Roster

Kept: Ellie (green) explains, Max (red) tests. Their cursors, colours, and the doc-chat thread stay.

### 5.2 Max asks only when asked

Answer A. **Max asks a question only when the learner presses Quiz me** (on a block, on a
section, or from a Quiz block). Removed: his follow-up after Ellie's answer (`rule:max_followup`),
his unprompted hand-off question, and any silence-driven question. `@Max` still reaches him.

What happens once he has asked is unchanged: one open question at a time, feedback with a verdict,
clarifying questions, give-up releases the answer and lowers the next question, Ellie's cue on
silence while his question is open, closure.

*Amended 2026-10-06 (§11.3, §11.4):* "only when asked" stands, but in practice a lesson's Start
asked for the learner: in the five conversations from 3 Oct, all 30 of Max's opening questions came
from a Start, and Quiz me was never pressed. Now a lesson's Start opens with Ellie walking the
learner through the card, and Max does not ask. Code decides when the learner looks ready on an
objective and **offers** *Ready to check this?*, which the learner presses. Max never re-asks an
objective that is complete, even after New Conversation. What happens after he asks changes in
§11.4: after two partial answers the learner is offered **Show me** instead of a blank, and a
correction waits until the question closes.

### 5.3 Recommended blocks (answer E)

As Gemini's report recommends an artefact per section, each section may carry **one recommended
block**: a card under the section naming the type, a title, and one line of what it would hold,
with **Add**. Add generates the block in place, by the same path as the Insert menu (#57). The
recommendation is written with the overview; it costs one line until the learner adds it.

The block types:

| Type | What it is | Editable as |
|---|---|---|
| **Table** | as #57 | cells |
| **Diagram** | as #57 (nodes and edges, laid out in code) | node labels, edges |
| **Flashcards** | a short deck of front/back cards, flipped in place | each card's two sides |
| **Quiz** | three to five questions (multiple choice or short answer) with answers held back until the learner answers | questions, options, answers |
| **Infographic** | a structured visual summary: a titled set of panels (timeline steps, stat callouts, comparisons) rendered from data in code | every text field |

**No mind map.** **No image is ever generated.** An infographic is structured data in the doc,
rendered as HTML/SVG in code, so the learner can edit every word of it and the agents can read it
as text. A picture would be neither editable nor readable by the model.

The Insert menu offers all five types anywhere, as it offers table and diagram today.

*Amended 2026-10-06 (§11.2):* a comparison the slide itself gives as a table is **written in at
ingest**, not offered as a recommendation. On the 68-slide deck, three of the overview's lines were
pointers to tables the doc did not contain. The other recommendations, the Insert menu, and the
rule that no image is ever generated stand. A slide figure placed at ingest is a crop of the
slide (`slide_image`), not a generated image.

## 6. The chat

- Ellie opens each notebook with one short greeting and **three suggested starter questions**
  (answer D), written with the overview, shown as buttons under her greeting. A click sends the
  question as the learner's.
- The composer placeholder: *Ask about this notebook, or @Ellie / @Max…*.
- Ask… from a block opens the composer with that block quoted.

## 7. Progress

Unchanged: the bar and the objective fills move only on the learner's own words (in chat or doc).

**Typing in the doc is just writing** (Lucas, 1 Oct 2026, after the live run: *"adding your own
notes is just typing into doc, but with a nice box"*). `collab-doc.md` §6's rule that a pause in
the learner's own doc text is assessed as an attempt is **retired**: no agent reads, answers or
writes under what the learner types, in a your-note slot or anywhere else. The learner's words in
the doc count when the learner says they are an answer: **Submit** in a Q block (`collab-doc.md`
§5.5, §5.6), or an answer in the chat. The your-note slot is only a box to write in.
The overview's objectives are those fills; the outline in the sources panel shows each section's
fill, as the notes map does now.

*Amended 2026-10-06 (§11.3):* readiness (§11.3) takes as one signal **whether** the learner has
written their own note in a section, measured in code as a count. No agent reads it, answers it or
assesses it, and it fills nothing. The rule above stands.

## 8. The layout

**Sources · overview · chat**, as before (file panel · doc · chats), with the left column now the
notebook's sources (Add sources, the drop zone, the per-source checkboxes) above the overview's
outline. The title bar shows *Notebooks › {notebook}*; Notebooks goes home.

## 9. Lucas's answers, 1 Oct 2026

| | Question | Answer |
|---|---|---|
| A | Max unprompted, or only on Quiz me? | Only on Quiz me. |
| B | Blanks in the overview? | Yes, but only where the deck itself leaves a blank. |
| C | Copy files in, or link to them on disk? | Copy. |
| D | Suggested starter questions in the chat? | Yes. |
| E | Gemini's per-section recommended artefacts? | Yes, as block types. No mind map. The infographic must never be image-based, so the learner can edit it and the model can read it. |

From the first round the same day: the redesign replaces the app's direction on `main`; Ellie and
Max are kept; one overview per notebook; and each action gives a chat explanation and a separate
doc edit.

## 10. What this supersedes

- `collab-doc.md` §0 and §2: the AI-written notes "that can be read without ever opening the
  slides", the per-window refine pass and its word budget. The extract pass, page images,
  evidentiary figures and mandatory provenance are kept.
- `collab-doc.md` §4.2: `rule:max_followup` (Max's follow-up after every Ellie answer) and Max's
  unprompted hand-off. §4.3–§4.7 stand for questions Max was asked.
- `collab-doc.md` §5.1: Ellie's 40–150-word doc edit after a question becomes the one-line edit of
  §4.2 here.
- The vault (#14 library revamp): vault root, promoted topics, recursive scan, file tree, finder.
  Full-text search stays, scoped to the open notebook's sources.
- The notes map's place "under the file tree" (§3 of `collab-doc.md`): it now sits under the
  sources.

Kept from #48 without change: block provenance and the chips, author marks and cursors, Freeze,
the learner-text guard and suggestions, answers in place, the learner's own questions, tables and
diagrams, citation previews, tappable figures, Listen, the progress rules.

*Amended 2026-10-06:* §11 in turn supersedes parts of this brief and of `collab-doc.md`. Its own
list is §11.8. "Answers in place" now means in the side rail (§11.5).

## 11. Amendment of 2026-10-06: notes that replace the slides, Max on cue, a clean doc

**Status.** Decided by Lucas on 6 Oct 2026, after a day of studying one lecture (Markov decision
processes, 60 slides) in the app on 5 Oct and an analysis of what that left behind. This section
is the source of truth for what it covers and wins over §0–§10 and `collab-doc.md` where they
differ. It amends #58 (this brief), #56 and #48. The goal it serves is Lucas's: **the notes should
replace studying the slides, without being verbose.**

**The evidence.** It is Lucas's own dogfooding of the app, and nothing else. It comes from the stored
notes of three notebooks, compared against their decks, and from the 19 logged conversations
between 14 Sep and 5 Oct, all read in full. The working files are not committed. The numbers:

### 11.1 What was wrong

**The notes named everything and explained nothing.**
- On a fresh 68-slide deck on sequential decisions (6,112 slide words), the overview was 349 words,
  or 5.7%. Of the deck's 31 core concepts, 28 got a one-line mention, 3 were absent, and none was
  explained well enough to act on. Eight of the lines only describe what a slide contains.
- That deck has about 30 distinct equations, 8 worked examples, 2 comparison tables and about 20
  slides that are mostly a figure. The overview had none of them. This is what §3.2 and §3.3 asked
  for, not a bug.

**The learner rebuilt the notes by hand.** On the MDP notebook after the study day:
- The doc grew to 4,572 words, of which 264 (6%) were the generator's.
- The learner asked Ellie 28 times, nearly always what a line, a term or an equation meant.
- He inserted 9 slide images himself.
- Of the 1,796 words marked as his, 1,134 (63%) were Ellie's chat answers copied in by hand. Twice
  he removed her short doc line and pasted her full chat answer in its place.
- Outside Max's question blocks, 92% of his text filled gaps the notes left.

**Max asked before the learner was ready, and the asking filled the notes.**
- In the five conversations from 3 Oct, all 30 of Max's opening questions came from a lesson's
  Start. Quiz me was never pressed.
- Across all 45 opening questions since 14 Sep, the 5 the learner asked for (Quiz me, Try here) were
  all asked when he was ready. Of the 32 from a Start, 19 were.
- In the MDP doc, 8 of Max's 13 question blocks were asked before the learner was ready: 2 ended in
  a give-up and 6 in a one-word blank after three verdicts short of complete. Those 8 hold 939 of
  Max's 1,406 words (67%).
- Max's 1,406 words in that doc outnumber the generator's 264. About 90% of them is text a learner
  would not keep as notes: 933 words of question prompts (190 of them boilerplate about testing "the
  statement, not you") and 473 of resolutions, most repeating a line already there.
- One resolution wrote a misconception into the notes, and Max later quoted it back as the
  learner's mistake.
- The 30 recent openers covered only 17 objectives. Two questions were each asked twice into the
  same block, and three Starts re-fired on an objective 34–48 s after its answer was released.

**The follow-ups gave the answer away.**
- Of 47 follow-up questions since 3 Oct, 31 (66%) were a blank or carried their own answer, in the
  question or in Max's message just before it. Only 8 asked for new reasoning.
- From the second conversation of 3 Oct on, every chain that reached a third verdict short of complete ended on a
  blank at the fourth attempt: 8 of 8.
  - In 6 of them the answer was on screen, quoted by Max himself. In 1, the mirror sentence was.
  - All 8 were scored complete, including one filled with the wrong word ("fewer"), which the notes
    still show as *You got this*. Max's message on it said *Well done* and *Not yet* together.
- Twelve "Why…?" questions followed a tutorial-sheet check marked *Well done* or a revealed
  answer. None was answered, and 7 asked for a reason Max had given in the same message.
- In the notes, 26 of 30 recent questions carried a chat preamble, and 25 lines were verdict or
  hint breadcrumbs. Of 25 stored "your answer" fields, 13 were not the learner's real answer, 9 of
  them one word or a short phrase.

**How these connect.** Thin notes pushed the learner to Explain on every line and into questions
before he was ready. Unready questions ran to chains of *Partly there*. Each chain ended on a
give-away blank, and the one-word answer or a 30–100-word released answer landed in the notes.

### 11.2 D1: notes as concept cards

**For a slide deck, the notes are a set of concept cards.** Prose sources (papers, readings)
keep §3.2's prose budget and shape, unless the card form carries over to them trivially.

- **One card per idea, not per slide.** Its **core line is always visible**: the term and a
  one-sentence definition, in the deck's terms, cited (`p. 14`).
- **The depth is folded under the core line** and opens in place, in a fixed order:
  1. the intuition, marked as added;
  2. the equation as a math block, then a "where" list giving each symbol in English;
  3. one worked example: the slide's own, or else a tiny added one;
  4. the slide figure, as a `slide_image`, when the concept's slide is mostly a figure;
  5. one pitfall, marked as added.

  A card has only the items its idea needs.
- **Algorithms are numbered steps.** A comparison the slide gives as a table is **written in as a
  table at ingest**, not offered later.
- **What is left out or folded:**
  - title, recap, divider and homework slides (homework gets one line);
  - repeated slides, demos and asides;
  - a motivating vignette gets one sentence where it first appears;
  - appendix proofs keep only their results.
- **The budget.**
  - The whole notes are 30–40% of the slide words, with math blocks and figures not counted.
  - The core layer is 8–10%, about the size of the old overview, so the folded doc is still a few
    minutes' read.
  - Each card gets 40–400 words by weight.
  - The ratio is a check the ingest logs, not a hard ceiling. A deck that packs many concepts into
    few slides needs more.
  - Why 30–40%: after the study day, the distinct useful content of the MDP doc was about 42% of
    the slide words, about 30% with the copied chat phrasing tightened. The #48 notes ran to
    177–200%, and the overview to 5–9%. Two cards drafted at this density came to about 260 and
    400 words, where the studied doc spent about 1,280 and 978 on the same ground.
- **Provenance is unchanged** (`collab-doc.md` §2). Anything not on the slides carries a `reason`
  and shows as added.
- **Ellie is the co-author.** She writes the depth at ingest.
  - Her later Explain, Example and answer edits attach to the card's depth, extending or replacing
    a depth item, never as new sibling blocks.
  - One addition is about 120 words at most, within the card's depth budget. This replaces §4.2's
    25 words and the 90/50/25 limits of 2 Oct, and is enforced in code as they were.
- **The learner's your-note slot stays.**

### 11.3 D2: Max on cue

**Readiness is decided by code and offered to the learner.** The model never decides it.

- **A lesson's Start opens with Ellie walking the learner through the card.** Max does not ask at
  once. This reverses the Start of `collab-doc.md` §6, revised 1 Oct.
- **A pure function in `app/src/core/` computes readiness** per objective (or section). Its
  signals:
  - the card's depth opened;
  - Explain or Example used on the objective's blocks;
  - the learner's own note written in the section, as a count (§7);
  - time on the section, with `now` passed in.

  Explain and Example are therefore recorded against the block's objective. Until now they were only
  logged.
- **When it is ready, the app offers *Ready to check this?*** as a chip or a button, and the learner
  presses it. **There is no unrequested quiz.** Quiz me works at any time, as before.
- **An objective that is complete is never asked again**, including after a reset (New Conversation).

### 11.4 D3: better questions

- **A blank must not give itself away.** Before a reply with a blank is released, a pure check in
  `app/src/core/pitch.ts` looks for the blanked term in Max's turn, in the sentence he quoted
  before the blank, and in the blank's mirror sentence when that is on screen. On a hit, the
  reply is regenerated once. On a second hit, the blank is dropped.
- **A correction waits.** Feedback after a partial answer does not quote or state the part still
  missing. The correction is given when the question closes, by a *Well done*, a release or closure.
- **After two partial answers, the learner is offered Show me** (a release, `collab-doc.md` §4.4)
  instead of the question shrinking to a one-word blank. This reverses "Two open follow-ups, then
  a blank" (`collab-doc.md` §4.2 and §4.5, 3 Oct).
- **No "Why…?" tail after *Well done*.**
- **One verdict per message**, and it must match the outcome that is logged.

### 11.5 D4: a clean doc

- **An open question sits in a side rail beside its card**, not in the doc body. The learner answers
  it there or in the chat.
- **When it resolves, it folds into a one-line self-check chip under the card**: the question in one
  line, and the learner's earned answer, collapsed.
- **A question resolved by a blank, a give-up or closure shows *revisit*, never *You got this*.**
- **A released answer goes to the chat only.** Nothing is written into the doc for it.
- **Nothing is written into the doc on an idle closure.**
- **None of the following goes into the doc:**
  - boilerplate such as "this tests the statement, not you";
  - verdict text;
  - tutorial breadcrumbs such as "Checked: correct", "Hint 2: …" or "Answer shown in the chat".

### 11.6 D5: formulas in the prompts

Two prompt lines still told the overview and Ellie's doc edits that inline maths shows as raw TeX:
`main/notes/overview.ts` (the overview system prompt) and `room/docedit.ts` (the block-note
prompt). Formulas have been typeset since `d3ae057` (`collab-doc.md` §3, 3 Oct), so both lines
are removed, and formulas are allowed. This carries out the 3 Oct amendment and needed no new
decision. It is recorded here because the stale lines are part of why the notes had no equations.

### 11.7 What stands

- Notebooks, sources and context (§1, §2), and provenance (§3.4, `collab-doc.md` §2).
- Every line's actions (§4.1), and the two outputs: the full answer in the chat and the doc edit
  (§4.2).
- What fills the bar (§4.3, §7), and Max's roles once he has asked (§5.2): one open question,
  verdicts, clarifying, release on a give-up, a lower question after it, Ellie's cue, closure.
- The after-release blank (`collab-doc.md` §4.5, 1 Oct), now under §11.4's check.
- Recommended blocks other than a slide's own table, and the Insert menu (§5.3).
- The chat (§6) and the layout (§8).
- The guard, Freeze, Keep and Remove.
- Tutorial sheets (`tutorials.md`), with one note in §11.9.

### 11.8 What this supersedes

In this brief:
- §0's box and §3.3's first paragraph, for slide decks: the short overview, "the map, not the
  working".
- §3.1's "two or three key ideas" per section, which become concept cards.
- §3.2's slide budget (about 350 words for a 60-page deck, floor 200, ceiling 600).
- §4.1's "Doc gets" for Explain, Example and Quiz me.
- §4.2's 25-word line and the 90/50/25 limits of 2 Oct, and the edit as a new block under the
  block asked on.
- §5.3's offer of a table the slide itself has.
- §9 answer A is refined: Max still asks only when the learner presses, and the app may now offer.
- §10's first bullet, in part. The goal of notes "that can be read without ever opening the
  slides" returns, at 30–40% of the slide words. The per-window refine pass and its budget stay
  retired.

In `collab-doc.md`:
- §4.2: Max's feedback giving the correction with grounds on every turn short of *Well done*
  (`attempt-first.md`'s grounds rule, narrowed to match), and "Two open follow-ups, then a blank"
  (3 Oct).
- §4.5's last paragraph (3 Oct): a blank ending a run of *Partly there*.
- §4.6: Ellie's doc half, one line since 1 Oct, becomes a depth addition of about 120 words.
- §4.7: "the doc's Q block is resolved as *released*" at closure.
- §5, rows 5.2 and 5.3 and the 25 Sep amendment: the Q block in the doc body; the correct answer
  written as notes on a release; "Q blocks stay".
- §5.5: the place of the answer (the rail, not the doc body).
- §5.7's "The ingest does not write tables or diagrams", for tables.
- §6, Start step 3 as revised on 1 Oct: Max asking at once.

### 11.9 Caveats and open questions

**Caveats.**
- The budget and the gap-fill shares rest on one studied lecture, by one learner who is also the
  developer. Two other notebooks point the same way (Max's words exceed the generator's in both),
  but they were not coded block by block.
- Who wrote what was attributed by four-word overlap with the chat, and readiness by reading the
  conversations. Both are judgement calls.
- 30–40% is to be retuned on a second lecture.

**Open questions.**
- **Tutorial sheets.** `tutorials.md` §4 adds one line per help under a part of the sheet, and the
  group project's feature ② builds on it (`docs/group/group-project.md` §4). D4 keeps breadcrumbs
  out of the notes. Whether it also changes the sheet is a joint call with Valerie, and until it is
  made, the sheet's rule stands. The same goes for the "one line on why it works" after a sheet's
  Show answer.
- **DG4** ("Short: room to think, based on task size", #66) is frozen for the group. The core layer
  keeps the notes short to read, and the notebook is A1's design, not claimed by the group. Whether
  #66 should note this is a joint call.
- **Papers.** Whether prose sources move to cards is left to the build: only if it is trivial.
- **What counts as ready**: the weights and thresholds of §11.3 are set in code and tuned on use.
  They are not fixed here.
- **The *you got this* chip.** It holds the learner's answer. Whether Max's one corrective sentence
  (`collab-doc.md` §5, 25 Sep) survives in it, or goes to the chat only, is left to the build to
  report.
- **The learner's own questions** (`collab-doc.md` §5.6) are the learner's text in the doc and are
  not moved to the rail by this amendment.
