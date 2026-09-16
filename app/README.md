# ChatterED — the Assignment 1 prototype

**Method:** a working macOS app, run from source — Electron + Svelte 5 + TypeScript + SQLite. The
geometry, rules, timer, latency floor, ledger gates and whisper scoping are real and tested; by
default only the agents' *words* are replayed (§4).

## 1. What it is

ChatterED opens a lecture deck as a **flow**. Each page is a **crop of the pdf.js-rendered page** —
the lecturer's own pixels, never re-typeset — and faint **ticks** mark where the page's own geometry
says a boundary could go (local; no model, no network); clicking one **splits the crop in place**.
**+ Ask here** inserts a neutral **REFERENCE** card — 120 words, in the app's own font — which locks
the agents out of that thread until **Explain it back →**. **Ellie, the Teacher**, then explains from
the slide; when a rule on a clock says the learner has been in flow and two concepts are fresh, she
**hands off to Max, the Tester**, who asks one question and never answers it. Only the learner's
verbatim words move the **Explanation Ledger** ○ → ◐ → ●, and ● is unreachable without a Tester
probe. **⌘K** opens a **whisper popover**: private with Ellie, ephemeral, with **Insert into the
document** the only path from private to shared.

## 2. Run it

```sh
cd app
npm install     # also rebuilds better-sqlite3 for Electron's ABI (postinstall)
npm run dev     # compiles main + preload, Vite on :5273, launches Electron
```

- **Node ≥ 22.12** (`package.json` → `engines`; built on 22.14), npm 10+, Xcode command-line tools.
- **Settings ▸ Backend = Scripted** (no network calls at all); **Settings ▸ Tester pacing = Demo**
  (the hand-off fires in a minute, not the study profile's ten).
- **Open folder →** this ZIP's `Academia/`, promote **Sources**, open
  `Sources/btw interaction/A0282987E_LohZhengLucas_Critique1_slides (1).pdf`.

First open shows the **pacing strip**: the reply hold is deliberate, which profile is live, and that
the words are replayed while the timer, the rules and the ledger are not.

## 3. The twelve in-app beats

Video beats 4–15 of `docs/research/flow-build-plan.md` §2. Paths under `app/src/`.

| # | Do this | Where |
|---|---|---|
| 4 | Open the deck — 7 crop cards, a build-steps chip | `renderer/components/FlowCanvas.svelte` |
| 5 | Page 3, hover a tick — a dashed guide | `shared/segment/cuts.ts` |
| 6 | Click the tick at y 0.535 — splits in place, ⌘Z undoes | `shared/segment/ops.ts`, `renderer/lib/flowview.ts` |
| 7 | **+ Ask here**: *who is actually whispering in the bottom row here?* | `components/AskHereLine.svelte`, `main/flowroom.ts` |
| 8 | A REFERENCE card lands; the thread is locked | `room/reference.ts`, `components/AiSegment.svelte` |
| 9 | **Explain it back →**, type `student:1`, then `student:2` | `components/FlowThread.svelte`, `room/actor.ts` |
| 10 | The hand-off fires, tagged **BY RULE** | `room/flow.ts`, `room/orchestrator.ts` |
| 11 | Max reads 9–12 s, counter climbing, one question | `room/agents.ts`, `room/actor.ts` |
| 12 | Type `student:3` — two ledger rows move, ● ◐ | `room/ledger.ts`, `SegmentCard.svelte` |
| 13 | ⌘K, ask `whisper:1` privately, **Insert into the document** | `components/WhisperPopover.svelte`, `room/context.whisper.ts` |
| 14 | Toggle **Original pages** | `renderer/lib/flowview.ts` |
| 15 | Hover a page chip; open the 31-page Koala paper | `shared/segment/genre.ts` |

**Type these verbatim** — the ledger quotes what is actually in the box, and a short line trips the
agreement-is-not-evidence rule. They and `whisper:1` are `CRITIQUE1_LEARNER_LINES` in
`room/llm/script.critique1.ts`.

> **student:1** — The bottom row is the same catch as the top row, except the person I am whispering
> to is the agent itself. I can ask while it is still working, so the warning about exposing data
> reaches me without cutting into what it is doing.
>
> **student:2** — And it is not a second agent with its own tools. Page 5 says it answers from the
> main session context only, with no tools and no memory of its own.
>
> **student:3** — The third one — it was asked to add a todo to memory, claimed it had, and nothing
> was written. So it can read the session and reason about the tool calls, but it cannot act: memory
> was protected, and the same wall is why nothing we settle in the side channel reaches the main
> agent unless I re-type it as a steering prompt.

## 4. Real, scripted, stubbed

**Real:** segmentation — cuts, split, merge, reorder, undo, Original pages, compare-on-hover, the
genre notice — **geometry only, no model in the path**; the actor's serialised mailbox; the silence
timer, with quit and sleep recovery; the latency floor, a floor on visible time-to-first-token and
not an added sleep; the orchestrator, where rules decide first and the model can never put the Tester
on the floor; `handOffDue()`; the REFERENCE scope, truncated at 120 words *in code*; the ledger's
four hard rules and the `defended` gate; whisper scoping with a leak canary; persistence — reopen the
deck and the cards, messages, glyphs and sitting come back.

**Scripted:** the agents' turns, the REFERENCE answer, the whisper reply and its relay draft —
replayed through the *same* code paths a live backend uses. Silence nudges come from a fixed pool in
**both** modes: they are content-free by construction. **Not scripted even here:** the learner's
typing, the split, the hand-off line (built by `flow.handOffLine()`), the ledger's evidence, the
timings, every rule.

**Not built:** the Firestore mirror (the `outbox` exists, the drain does not), export, history, the
consent screen, the vision "suggest cuts" pass (#26), genres beyond the honest labeller (#27–#31) —
anything that is not a deck opens as whole pages and says so — cross-page merge, reduced motion, full
keyboard traversal, signing (#17). `docs/STATUS.md` has the measurement behind every claim here.

## 5. Against a live model

Two other backends, tried in order when Settings forces none: **the local Claude Code CLI**, when
`claude` is installed *and logged in* — no key, no per-message cost, its command line argued atop
`src/main/llm/claude-cli.ts`; or **an Anthropic API key**, entered in Settings and written to
`~/Library/Application Support/ChatterED/anthropic-api-key`, mode 0600, outside the repo
(`src/main/apikey.ts`). Models are per role: turns on Haiku 4.5, orchestration and the ledger on
Sonnet 5. What changes is that the words are generated, and opening a deck makes a real ingest call,
so it takes a few seconds.

## 6. Tests

```sh
npm test           # vitest — 520 tests, 36 files, no network
npm run lint       # incl. the whisper-import and src/room portability rules
npm run typecheck  # tsc --noEmit + svelte-check
```

`src/room/context.test.ts` is the one to read: a whisper-only string never reaches a group prompt, a
shared card, a snapshot or an export — asserted at runtime *and* over the static import graph.

## 7. Repo map

```
src/
  room/      PORTABLE. Actor, orchestrator, timer, flow session, REFERENCE, ledger, whisper,
             prompts, the LLM clients. No Electron, no SQLite, no DOM. ESLint enforces it.
  main/      Window, menu, IPC, SQLite, the vault (scan, FTS5, pdf.js geometry, segment cache).
  renderer/  Svelte 5 SPA: the flow, the vault and viewers, Settings. lib/flowview.ts and
             lib/pdfview.ts hold every number as a pure function.
  shared/    The segment pipeline (pure), the IPC contract, thread grouping.
```

**Design decisions** live in `docs/research/` — `flow-build-plan.md`, `pivot-spec.md`,
`flow-session.md`, `segmentation-lazy-split.md`, `product-design.md` — and the code is a bug if it
contradicts one; they were argued on issues **#23**, **#25**, **#32** and **#33**. `docs/SEGMENTS.md`
is the segment contract.
