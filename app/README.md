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

Video beats 4–15 of `docs/research/flow-build-plan.md` §2, re-cut for the **attempt loop**
(`docs/research/attempt-first.md` §2, §6). Paths under `app/src/`.

| # | Do this | Where |
|---|---|---|
| 4 | Open the deck — 7 crop cards and a build-steps chip; on page 3 hover a tick, then click the one at y 0.535 (⌘Z undoes); toggle **Original pages** | `renderer/components/FlowCanvas.svelte`, `shared/segment/cuts.ts`, `shared/segment/ops.ts` |
| 5 | **+ Try this** under the lower half of page 3 — the Tester asks **one** question, back in 4–6 s because you asked for it | `room/actor.ts` (`tryHere`), `renderer/lib/objectives.ts`, `room/flow.ts` |
| 6 | Type **attempt:1** below, verbatim. Nothing speaks over you | `components/FlowThread.svelte` |
| 7 | Feedback after 9–12 s: what landed, what was missing, the correction, each with a `p. 3: "…"` quote of the page | `room/orchestrator.ts` (`rule:quiz_feedback`), `room/prompts.ts` |
| 8 | The rail moves `○ → ◐` on *why whispering helps*, quoting **your** sentence. *What /btw can and cannot do* stays at ○ | `room/ledger.ts`, `SegmentCard.svelte` |
| 9 | Scroll one card and press **+ Try this** on page 5 — the pick is the objective still at ○ | `renderer/lib/objectives.ts` |
| 10 | Type **askanswer:2** (*what's the answer?*). One narrowing hint, one clause saying a try unlocks it, **no answer** | `room/attempt.ts`, `room/orchestrator.ts` (`rule:answer_withheld`) |
| 11 | **+ Ask here** on the same card and type **ask:1** — the Teacher answers the *prerequisite*, and says she will not answer the quiz | `components/AskHereLine.svelte`, `rule:teacher_answers` |
| 12 | Type **attempt:2** — feedback grounded on page 5, and `○ → ◐` on *what /btw can and cannot do* | `room/ledger.ts` |
| 13 | **Show the answer**, visible only now — the model answer with its grounds, and the rail does not move | `room/orchestrator.ts` (`rule:answer_shown`) |
| 14 | ⌘K, ask **whisper:1** privately, **Insert into the document** | `components/WhisperPopover.svelte`, `room/context.whisper.ts` |
| 15 | Hover a page chip; open the 31-page Koala paper | `shared/segment/genre.ts` |

**Type these verbatim** — the ledger quotes what is actually in the box, and a line under eight
content words trips the agreement-is-not-evidence rule. They are `CRITIQUE1_LEARNER_LINES` in
`room/llm/script.critique1.ts`, with `whisper:1`.

> **attempt:1** — The whisper is going to the agent itself rather than to a second person, and I
> think the property doing the work is politeness, because asking in the main thread would have been
> a rude interruption while it was still coding.
>
> **askanswer:2** — what's the answer?
>
> **ask:1** — before I try that — what does page 5 mean by context being a strict subset of the main
> session? i keep reading context as the context window and I do not think that is what it is saying
> here.
>
> **attempt:2** — I think it is the third one — it was asked to write a todo into memory and said it
> had, so its answer was false, and that is the bug because the other two tests came back true.

Both attempts are **partly right on purpose**: feedback with nothing to correct is a compliment, and
the coded study (`docs/research/ai-use-transcripts/analysis/findings.md` RQ4) found 11 of 21 verdicts
wrong in the one session that quizzed at all — 9 of them calling a correct answer wrong — with the
learner replying "ok". That is why every judgement cites the slide, and why a verdict you can check
is the only kind worth giving. `askanswer:2` is R6's own phrasing, asked five times in that session
before the learner imposed attempt-first by hand; here it is refused by a rule.

## 4. Real, scripted, stubbed

**Real:** segmentation — cuts, split, merge, reorder, undo, Original pages, compare-on-hover, the
genre notice — **geometry only, no model in the path**; the actor's serialised mailbox; the **attempt
loop's control flow** — `classifyLearnerTurn`, the answer lock (`attempts`, `answerShown`) and the
four rules over it, so *no model is ever asked whether to answer its own question*; the objective the
next question comes from, picked by lowest ledger level as a pure function; the silence timer, with
its thresholds scaled to the reading time of the last turn and firing only where an answer is owed,
with quit and sleep recovery; the latency floor, a floor on visible time-to-first-token and not an
added sleep, short band for a question you asked for and 9–12 s for a judgement; the orchestrator,
where rules decide first and the model can never put the Tester on the floor; `handOffDue()`, still
shipped as the secondary door; the ledger's four hard rules and the `defended` gate; whisper scoping
with a leak canary; persistence — reopen the deck and the cards, messages, glyphs and sitting come
back.

**Scripted:** the agents' turns, the summary card, the whisper reply and its relay draft — replayed
through the *same* code paths a live backend uses. Silence nudges come from a fixed pool in **both**
modes: they are content-free by construction. **Not scripted even here:** the learner's typing, the
split, the hand-off line (built by `flow.handOffLine()`), the answer lock, the ledger's evidence, the
timings, every rule.

**One thing to be clear about, because the video says it too:** feedback **grounds are asked for, not
verified**. The prompt requires a `p. N: "…"` quote of the page's own words; no code checks a live
model's quote against the deck. What *is* checked is the scripted path — `script.critique1.test.ts`
asserts every quote in every feedback and answer beat is a verbatim substring of `CRITIQUE1_PAGE_TEXT`
— so the demo cannot misquote the deck on camera, and a live model still can. Verifying the quote the
way ledger rule 1 verifies the learner's is the first thing A2 owes (`attempt-first.md` §3, §8).

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
