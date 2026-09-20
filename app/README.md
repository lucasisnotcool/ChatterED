# ChatterED — the Assignment 1 prototype

**Prototyping method:** a working macOS desktop app, run from source — Electron + Svelte 5 +
TypeScript + ProseMirror + SQLite. It demonstrates one multi-turn CUI learning interaction end to
end: *the learner asks about a lecture, is asked a question back, answers in their own words, gets
grounded feedback, and watches the shared notes and their progress change because of what they
wrote.* The rules that decide who speaks and whether an answer is due are code, tested, and run
before any model is called; a model writes the words (§4).

The design is argued in `docs/research/collab-doc.md`, from two evidence write-ups:
`docs/research/ai-use-transcripts/analysis/convergence.md` (six real AI study sessions, coded) and
`docs/research/interviews/findings.md` (three interviews). The report is in `docs/report/`.

## 1. What it is

A lecture deck (PDF) is **ingested into lecture notes**: an editable document that reads without
the slides, where every block carries a **provenance chip** (`p. 12`, or `added: …` with the
reason) that opens the source slide, and diagrams appear inline as **crops of the original page**.
The window is three columns: **files · notes · chats**.

Two agents work in the notes with the learner, each with a visible cursor:

- **Ellie** (green) wrote the notes. Ask her anything — in the doc chat, or by highlighting a line
  and pressing **⌘E / Ctrl+E** — and she answers, citing the slide; if the notes did not already
  say it, she **types it in** at that spot. One click removes it (**Remove · Keep**).
- **Max** (red) then asks **one follow-up question**, in the chat and as a **question block in the
  notes**. It is the learner's to answer first. Max replies with a verdict — *Well done* / *Partly
  there* / *Not yet* — grounds quoted from the slide (`p. N: "…"`), and, unless it was *Well
  done*, a follow-up on the same question. His corrected answer is written under his question.
- If the learner **goes quiet**, Ellie offers an unsure, half-right guess as a classmate would
  (*"Ellie's guess — she might be wrong"*) and Max turns it back to the learner. It fires once per
  question and is never written into the notes.
- If the learner **gives up** — "I don't know", "just tell me", or the **Pass** button — Max gives
  the full answer at once, it fills no progress, and his next question is easier. No question is
  ever left unanswered.
- **The learner's own text is never overwritten.** Every span records who wrote it. An agent that
  needs to change the learner's words can only **suggest**: strikethrough, its colour, Accept ·
  Reject. What the learner writes in the notes is also assessed as an attempt. **Freeze** stops
  all agent edits.
- **Progress** is a bar of learning objectives derived from the slides. An objective fills only on
  the learner's own words: *Well done* completes it, *Partly there* half-fills it; a released
  answer, Ellie's help and "ok" fill nothing. Clicking the bar opens the objectives as a path of
  lessons, each with **Start**.
- **Private threads** with Ellie and with Max never reach the notes unless the learner clicks
  **Insert into the document**.
- **Cost is visible at every level** — per message, per thread, per document (the ingest as its own
  line) and for the app — and on a **Usage** page.

## 2. Run it

```sh
cd app
npm install     # also rebuilds better-sqlite3 for Electron's ABI (postinstall)
npm run dev     # compiles main + preload, starts Vite, launches Electron
```

- **Node ≥ 22.12**, npm 10+, macOS with the Xcode command-line tools.
- **A live model is needed to ingest a deck.** The app uses, in order: the local **Claude Code
  CLI** when `claude` is installed and logged in (no key, no per-message charge), or an
  **Anthropic API key** entered in Settings (stored mode 0600 under
  `~/Library/Application Support/ChatterED/`, outside the repo). Turns, feedback and edits run on
  Claude Sonnet 5.
- **Open folder →** any folder of lecture PDFs. This ZIP carries one small deck of the author's
  own (`Academia/Sources/btw interaction/`, 7 slides). The deck in the video is the module's own
  Week 4 lecture, which is the lecturer's and is not redistributed here.
- Opening a PDF for the first time ingests it: about **85 s for 7 slides**, about **4 minutes for
  66**, with the notes appearing section by section while Ellie is still writing. Reopening is
  instant and never re-ingests.
- **Settings ▸ Tester pacing = Demo** shortens the silence thresholds so Ellie's guess can be seen without
  waiting minutes. **Study** keeps the thresholds the design argues for.

## 3. Walk through the interaction

1. Open a deck. Read a section; click a `p. N` chip; open the collapsed slide carousel.
2. Highlight a sentence, press **⌘E**, ask about it. Ellie answers; her addition is typed into the
   notes in green at that line.
3. Max asks a follow-up (chat, and a red question block in the notes). Answer it in your own words.
4. Read the verdict and its `p. N` quotes; answer the follow-up. On *Well done* a bar segment
   fills, the lesson card shows *"You wrote: …"*, and Max's version is written under his question.
5. On the next question, say nothing. Ellie's guess arrives, then Max's prompt. Type **i don't
   know**: the answer is released, the bar does not move.
6. Type a sentence of your own into the notes, in a section with a `p. N` chip, and pause. Max
   assesses it in a thread on that span.
7. Open **Max**'s private tab, ask something, **Insert into the document**. Click the progress
   bar, pick the lesson marked **Next up**, press **Start**.

`docs/report/video-storyboard.md` is the same walk-through as filmed.

## 4. What is real, and what a model does

**Rules, in code, decided before any model call** (`src/room/orchestrator.ts`, `actor.ts`): who
answers (`rule:ellie_answers`, `rule:mention`), Max's one follow-up and one-open-question-at-a-time
(`rule:max_followup`), what a learner turn *is* — attempt, clarifying question, give-up
(`src/room/attempt.ts`), feedback owed after an attempt (`rule:quiz_feedback`), Ellie's cue once per
question after a reading-time silence (`rule:ellie_cue`, `rule:max_prompt`), release on any give-up
(`rule:answer_released`), and closure (`rule:closure`). Every agent turn in the chat shows the rule
that produced it.

**The document model, in code** (`src/shared/doc/`): blocks with ids and provenance; a per-span
author mark; agents address **blocks, never offsets**; and the **guard** that turns any agent
change to learner-written text into a suggestion, tested against the document model, not a prompt.
Validation rejects any ingested block with no provenance.

**Progress, in code**: a pure function of recorded verdicts (`src/shared/doc/progress.ts`).

**A model writes**: the notes (two passes: extracted slide text and geometry, then a refine pass
that is shown the slide images), the words of each turn, Ellie's cue (a structured reply that
declares whether it contains a mistake, so the rule can check it was corrected), the plan for a
doc edit (given only an outline of nearby blocks), and the coding of learner evidence.

**Known limits**, stated in the report: the notes are AI-written, and nothing verifies them or
Max's quotes against the slide in code; "a question the notes do not already answer" is checked by
question, not by meaning; inline maths is styled, display maths is typeset.

## 5. Tests

```sh
npm test           # vitest — about 1,760 tests, no network
npm run lint       # incl. the src/room portability rules
npm run typecheck  # tsc --noEmit + svelte-check
npm run build      # the production build (a different tsconfig from typecheck)
```

Worth reading: `src/shared/doc/guard.test.ts` and `suggest.test.ts` (rejecting a suggestion leaves
the learner's text byte-identical); `src/room/actor.collabdoc.test.ts` (every rule above, on the
real actor); `src/room/context.test.ts` (nothing from either private thread reaches a shared
prompt, a snapshot or an export, or the other private thread); `src/main/cost/attribution.test.ts`
(every model call is filed under the right document, thread and turn).

## 6. Repo map

```
src/
  room/      PORTABLE. Actor, orchestrator rules, classifier, timer, ledger, pitch, prompts, the
             doc-edit call, the LLM clients. No Electron, no SQLite, no DOM; ESLint enforces it.
  shared/    doc/ — the ProseMirror schema, agent ops, the guard, suggestions, validation,
             progress. The IPC contract and the push events.
  main/      notes/ — the two-pass ingest and its persistence. docroom/ — chat, private threads,
             progress. cost/ — the usage ledger and analytics. The vault, pdf.js, SQLite, the CLI
             and API backends.
  renderer/  Svelte 5. components/notes/ — the editor, agent cursors, Remove · Keep, suggestions,
             chips, figures, carousel. components/shell/ — the three columns, chats, progress.
             components/usage/ — the Usage page.
docs/COLLAB-CONTRACT.md   the shared shapes the build was split along
```

Decisions are recorded as GitHub issues and argued in `docs/research/`; the code is a bug if it
contradicts `collab-doc.md`.
