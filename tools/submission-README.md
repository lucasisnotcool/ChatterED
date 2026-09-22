# ChatterED — Assignment 1 prototype package

**Prototyping method:** a **working macOS desktop application, supplied as source and run from
source** — Electron + Svelte 5 + TypeScript + ProseMirror + SQLite — together with a
**low-fidelity interaction map** that makes the same design legible without running anything.

There are two ways into this package, and you can use either:

- **Read it.** §1 below is the user story, told through two figures. Nothing needs to be
  installed. This is the low-fidelity artefact.
- **Run it.** `app/README.md` §2 has the commands. Node ≥ 22.12 and macOS with the Xcode
  command-line tools; a live model (the Claude Code CLI, or an Anthropic API key entered in
  Settings) is needed to ingest a deck. A small deck of the author's own ships in
  `Academia/Sources/btw interaction/` so there is something to open.

---

## 1. The user story

**The learner** has a lecture deck, a test coming, and wants to understand the deck well enough to
answer questions about it in their own words. Today they paste it into a chatbot, ask for a
summary, and read the answer. Nothing they write is theirs, and nothing checks whether they
understood it.

In ChatterED the deck is ingested into **lecture notes** — an editable document that reads without
the slides, where every block carries a provenance chip (`p. 12`) that opens the slide it came
from. The window is three columns: **files · notes · chats**. Two agents work in that document
alongside the learner, each with a visible cursor and a defined job:

![Who does what: the learner, Ellie the peer, Max the challenger, and the shared notes they all write in](figures/division-of-labour.png)

The learner asks about the lecture; **Ellie** (green) explains and, if the notes did not already
say it, types the explanation into the document at that line; **Max** (red) then asks **one**
question back, which is the learner's to answer first. The learner answers in their own words, in
the chat *or* by typing into the notes — both count as attempts on the same question. Max returns
a verdict with the slide quoted. A progress bar fills only on the learner's own words.

The figure below is the full interaction map: every way in, what the system does with it, and the
rule that decides. **Section D is the part to look at** — the things that happen without the
learner asking for them, which is where the design's argument lives.

![The complete interaction map: asking in the chat, asking from inside the notes, private threads, undoing agent edits, and the four behaviours that fire without being asked](figures/interaction-map.png)

### The same story, as it actually ran

These are screenshots of a real session — the module's own Week 4 lecture deck, ingested into the
notes, with a live model answering. The deck itself is the lecturer's and is not redistributed
here, so what you see in the document is the AI-written notes, not the slides. Read the six in
order; each one is a different mechanism.

**1 — The three columns.** Files on the left, the notes in the middle, the chats on the right.
The `p. 42` chip on the heading opens the slide that block came from. The green bar in the margin
is an edit Ellie made, with **Remove · Keep** beside it. In the chat, Max has just marked an
answer *"Not yet."* — the learner asked a new question instead of answering the one that was open.

![The three-column window: files, the lecture notes with a p. 42 provenance chip and a green Ellie edit, and the chat where Max has answered "Not yet."](figures/shot-1-three-columns.png)

**2 — Max asks, and the question lands in the notes.** The same question appears twice: as a red
block in the document marked `open`, and in the chat carrying its rule tag, `by rule · follow-up`.
Every agent turn shows the rule that produced it. The composer below reads *"Your answer…"*, and
offers **Pass**.

![Max's question as a red block in the notes marked "open", and in the chat tagged "by rule · follow-up"](figures/shot-2-max-asks.png)

**3 — The learner answers, and the verdict quotes the slide.** *"Well done."* followed by the
grounds — `p. 43` and `p. 47`, each a link that opens the slide. The verdict comes first, the
evidence second, and the evidence is checkable.

![Max's "Well done." verdict quoting p. 43 and p. 47, each a clickable link to the slide](figures/shot-3-verdict-well-done.png)

**4 — Writing into the notes counts as answering.** The learner typed a sentence of their own
directly into the document (highlighted). Max assessed it as an attempt on the open question —
*"Partly there"* — and corrected which slide the claim belongs to: `p. 41`, not `p. 42`. The chat
and the document are two ways into one activity, not two activities.

![The learner's own sentence highlighted in the notes, with Max assessing it and correcting the slide attribution from p. 42 to p. 41](figures/shot-4-learner-text-assessed.png)

**5 — The question closes in the document.** The red block is now marked `partly yours`, and Max's
completion is written underneath his own question — labelled *"Part of this was the learner's"*,
with **Remove · Keep**. Nothing overwrote what the learner wrote.

![The question block marked "partly yours" with Max's completion written under it and Remove · Keep controls](figures/shot-5-question-resolved.png)

**6 — Private threads, and the one way out of them.** Ellie's own tab is a read-only side channel;
Max cannot see it. The reply is marked *"In the document ✓"* because the learner chose to insert
it, and it appears in the notes as a shared card attributed to Ellie.

![Ellie's private tab, with a reply marked "In the document" and the corresponding inserted card in the notes](figures/shot-6-private-insert.png)

---

The learner keeps three guarantees, all enforced in code rather than in a prompt:

---

## 2. What is in this package

| Path | What it is |
|---|---|
| `app/` | The entire application, source only — main process, renderer, the room rules, the prompts, the document model, and the tests. |
| `app/README.md` | How to install and run it, the walk-through to follow once it is open, and which parts are rules in code versus words from a model. |
| `figures/` | The two diagrams and the six screenshots above, full resolution. |
| `Academia/Sources/btw interaction/` | A 7-slide deck of the author's own, so the app has something to ingest on your machine. |

**The prompts and configuration** the criterion asks for are in the source, not in a separate
folder: `app/src/room/prompts*.ts` and `app/src/main/notes/prompts.ts` for the prompts,
`app/src/room/flow.ts` for the pacing constants, and `app/src/room/orchestrator.ts` and
`actor.ts` for the rules that run before any model is called.

## 3. What is deliberately not in this package

- **The lecture deck used in the video** — the module's own Week 4 lecture — is the lecturer's
  work and is not redistributed. Any folder of PDFs works instead.
- **The source papers** behind the design are other authors' work; they are cited in the report,
  not bundled here.
- **The research briefs, the interview and transcript analysis, and the report drafts** are the
  report's material. This package is the prototype.
- **No session data, and no participant data of any kind.** The application writes its database
  to `~/Library/Application Support/ChatterED/`, outside this package; running it creates a fresh
  one.

## 4. If you only have a few minutes

Read §1's second figure, region **D**, and then `app/src/room/flow.ts`. The figure states the
behaviours that fire without the learner asking; the file holds the `FLOW` and `DEMO` pacing
profiles that time them. Between them they are the design decision this project is actually
making.
