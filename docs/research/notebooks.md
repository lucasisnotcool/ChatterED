# Notebooks and the learning overview: the learner builds the notes

**Status.** Decision brief, 1 Oct 2026. Decided by Lucas the same day, from a reviewed mockup
(the published artifact "ChatterED Notebooks Mockup") and five follow-up answers (§9). This brief is
the **source of truth** for the three areas below from this date. It amends
`collab-doc.md` (#48), which stays the source of truth for everything this file does not change;
§10 lists exactly what is superseded. Code that contradicts this brief is a bug in the code.

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

## 1. Notebooks replace the folder vault

- **A notebook is a named set of sources.** Sources are files the learner added: PDF, slides,
  Word, Markdown, text, images. There is no "open folder", no vault root, no file tree.
- **Sources are copied into app storage** (answer C), under the app's data directory, one folder
  per notebook. The original file can move or be deleted without breaking the notebook. Removing a
  source deletes the copy, never the original.
- **Adding sources:** drag files anywhere onto the notebook window, onto the drop zone in the
  sources panel, or press **Add sources** for a file picker. Each new source shows a reading bar,
  then "ready" (text extracted and indexed).
- **The Notebooks home** is a grid of notebooks: title, source count, last edited, own-words fill.
  Dropping files on the home screen starts a new notebook named after the first file. A **New
  notebook** button opens the picker.
- **Existing work is kept.** On first launch after this change, each file that already has a notes
  doc becomes a notebook of one source (the file is copied in), and its existing notes doc is kept
  unchanged as that notebook's doc. Files on disk that were only browsed are not imported. The
  vault folder itself is never modified.

## 2. Context is per notebook

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

### 3.2 Length

About **350 words for a 60-page deck**, scaling gently with the material (a floor of about 200, a
ceiling of about 600), against about 9,500 for the #48 notes on the same deck. The budget is computed
in code from the ticked sources' word counts, as `windowWordBudget` was, and the ingest logs words
written against it. It is a ceiling: a deck with less to say gets less.

### 3.3 Scaffolding, not answers

The overview is bare-minimum scaffolding: what each idea is and where it is on the slides, not the
working. Derivations, examples and worked cases are what Explain, Example and the recommended
blocks are for.

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

## 4. Every line has actions

### 4.1 The actions

Hovering (or focusing) a block in the overview shows a small toolbar:

| Action | Who | Chat gets | Doc gets |
|---|---|---|---|
| **Explain** | Ellie | the full explanation, as long as it needs (the usual Teacher shape) | one line under the block: the point most worth keeping |
| **Example** | Ellie | a worked example, preferably the slide's own | one line: the example in brief |
| **Quiz me** | Max | his question, then feedback as now | the Q block under the block (as #56: the learner answers in place or in chat) |
| **Ask…** | either | the composer opens with the block quoted; the learner types the question | as for any doc-chat question |

Each section's key ideas also show **Explain · Example · Quiz me** as a row of small buttons, for
touch and for learners who do not hover.

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

## 6. The chat

- Ellie opens each notebook with one short greeting and **three suggested starter questions**
  (answer D), written with the overview, shown as buttons under her greeting. A click sends the
  question as the learner's.
- The composer placeholder: *Ask about this notebook, or @Ellie / @Max…*.
- Ask… from a block opens the composer with that block quoted.

## 7. Progress

Unchanged: the bar and the objective fills move only on the learner's own words (in chat or doc).
The overview's objectives are those fills; the outline in the sources panel shows each section's
fill, as the notes map does now.

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
