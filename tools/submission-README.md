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

The learner keeps three guarantees, all enforced in code rather than in a prompt:

1. **Their own words are never overwritten.** An agent that needs to change learner text can only
   *suggest* — strikethrough, Accept · Reject. Reject leaves the text exactly as it was.
2. **A question is always theirs first.** On silence Ellie offers a half-right peer's guess, never
   the answer; any give-up releases the answer at once, fills no progress, and makes the next
   question easier.
3. **Nothing is left hanging.** Every question reaches a verdict, a release, or closure.

---

## 2. What is in this package

| Path | What it is |
|---|---|
| `app/` | The entire application, source only — main process, renderer, the room rules, the prompts, the document model, and the tests. |
| `app/README.md` | How to install and run it, the walk-through to follow once it is open, and which parts are rules in code versus words from a model. |
| `figures/` | The two figures above, full resolution. |
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
