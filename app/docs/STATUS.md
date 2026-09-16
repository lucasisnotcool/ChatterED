# ChatterED — what is real and what is stubbed

**As of the M0/M1 scaffold pass, 13 Sep 2026.** Written so that nothing in the A1 video or the
report has to be guessed at. The rule used throughout: a mechanic that carries a design decision
is real; content and infrastructure that carry none may be scripted or stubbed, and are listed
here as such.

Run it: `npm install && npm run dev`. Test it: `npm test` (**356 tests**, no network).

**Updated 14 Sep 2026** for issues #19 (local Claude CLI backend, per-role model selection) and
#20 (local install with a launchd auto-rebuild), and **15 Sep 2026** for the UI-review fixes —
see *UI review fixes* near the end of this file, which is also the record of what is **not yet
committed** while `git` is blocked on this Mac.

## Real — it runs, it is persisted, and it is tested

| Thing | Where | Notes |
|---|---|---|
| Electron main + preload + Svelte 5 renderer, TypeScript strict | `src/` | `npm run dev` compiles main, starts Vite, launches Electron |
| SQLite schema, migrations, repository layer | `src/main/db/` | The full `architecture-mac.md` §D.1 model, WAL, foreign keys on. DB at `~/Library/Application Support/ChatterED/app.db` |
| Room actor: serialised mailbox, one writer per room | `src/room/actor.ts`, `mailbox.ts` | Long waits run outside the mailbox so a learner message can cancel a held reply |
| Silence timer: 45 s / 90 s, typing-only pause, 120 s extension cap, ≤2 fires per round, Hold, Wait for me | `src/room/timer.ts` | 1 s wall-clock tick against a persisted deadline; `timerEpoch` fences every path; 13 unit tests on a fake clock |
| Sleep / quit / relaunch recovery, including the 120 s late-fire cut-off and the resume card | `timer.ts`, `actor.ts#recover` | Idempotent; running the pass twice is a tested case |
| Latency floor (Challenger 9–12 s, Peer 4–6 s, whisper 1–2 s) with the 8 s floor-yield window | `actor.ts` | A floor on visible TTFT, not an added delay: generation starts at once, the reply is buffered. `latency_target_ms` and `ttft_actual_ms` are both stored |
| Orchestrator: deterministic rules (REFERENCE lock, mandatory quiz feedback, anti-dog-pile, the hand-off, Teacher-only silence fills, last word) + a Sonnet 5 structured decision | `src/room/orchestrator.ts` | Rules decide first; the model is consulted only when they have not — and **the model can never put the Tester on the floor**: a model asking for `challenger` outside a hand-off is demoted to the Teacher. 11 unit tests |
| **Teacher + Tester roster and the display mapping** (#32) | `src/room/agents.ts`, `prompts.ts` | Ellie explains from the slide and is told each turn what she has taught this sitting; Max asks one question when handed the floor and never answers it. `participants.role` / `agents.role` still store `peer` / `challenger` — `ROLE_LABEL` is the only translation. `PROMPT_VERSION` = `prompts.v0.2` |
| **The flow session: boundaries, taught set, recency, `handOffDue()`** (#33) | `src/room/flow.ts` | The only place the constants live, aligned to `docs/research/flow-session.md` §8.3. 20 min gap (typing pauses it, `timer.ts`-style absolute deadline, survives sleep), 3 min `MIN_AGE` **capped** as a UI guard, recency a 60-min *ranking* weight that never excludes, 6 h horizon as a conversational-context bound, k = 3 in m = 10 min, feedback after every quiz answer mandatory (Rowland 2014). Pure, 39 fake-clock tests, plus a disclosed `DEMO` profile (k = 2, m = 3 min) |
| **The REFERENCE path** (`pivot-spec.md` §B1) | `src/room/reference.ts`, `prompts.reference.ts`, `actor.askHere()` | A scope, not an agent: the participant is created with the room with `agent_key = NULL`, so the orchestrator cannot select it. 120-word cap **hard-truncated in code**, then the rule and the hand-back. An answer takes no floor, does not touch the timer, cannot move the ledger, and locks Ellie and Max out of that segment's thread until `actor.explainBack()` — all four asserted in `reference.test.ts` |
| Ledger: the four hard rules + the `defended` gate | `src/room/ledger.ts` | Verbatim-evidence substring check, monotonic with a capped self-contradiction downgrade, 0.6 confidence floor, agreement-is-not-evidence, and `defended` unreachable without a Tester probe (the gate is unchanged; only the role's display name moved). Every proposal is written to `ledger_history` with the gate that stopped it |
| Whisper: separate table, scoped context builder, group-prefix snapshot, relay with attribution | `src/room/context.*.ts`, `actor.ts` | Whispers do not pause the timer and do not move the ledger |
| **The whisper leak test** | `src/room/context.test.ts` | Canary string, store-shape assertion, and a walk of the static import graph from `context.group.ts` |
| Scripted transcript player (the A1 video fallback) | `src/room/llm/script.psd-hessian.ts`, `scripted.ts` | Replays design-brief.md §G through the *real* actor, timer, gates and whisper scoping. The ledger's evidence is lifted verbatim from what the learner actually types. `ScriptedClient` now takes a `ScriptSource`, so `script.critique1.ts` drops in without editing it, and answers `scope: 'reference'`; the script carries `handoff:N`, `feedback:N` and `reference:N` beats |
| Anthropic client: streaming, cache breakpoints, usage persisted | `src/room/llm/anthropic.ts` | `claude-haiku-4-5` for agent turns, `claude-sonnet-5` for orchestrator/ledger/ingest |
| **Local Claude CLI client** (#19) | `src/main/llm/claude-cli.ts` | Shells out to `claude -p … --output-format stream-json`, parses the deltas and the final `result`, persists the same usage shape. In `src/main`, not `src/room`, because it spawns a process and `src/room` is the portable half. 29 tests against a fake `claude` binary on a temp PATH |
| **Backend detection and order** (#19) | `src/main/llm/detect.ts`, `backend.ts` | CLI-if-logged-in → API key → scripted, forceable in Settings. The login probe costs one Haiku round trip, so it is cached in the settings table and warmed in the background at launch |
| **Per-role model selection** (#19) | `src/room/llm/models.ts`, `src/renderer/components/Settings.svelte` | Two dropdowns (agent turns / orchestrator + ledger), haiku·sonnet·opus, default **sonnet** for both on the CLI path; a free-text field takes a full id. Fable is not offered and is rejected if typed |
| Settings screen | `src/renderer/components/Settings.svelte` | Backend, CLI status and path override, the two model choices. Says which backend is *actually* live and why a forced choice was not honoured |
| **API key entry, in a 0600 file** (#15, amended 2026-09-14) | `src/main/apikey.ts` | The key is a plain file, `~/Library/Application Support/ChatterED/anthropic-api-key`, mode 0600 inside a 0700 directory. It sits in Application Support, **outside the repo**, so no `.gitignore` rule covers it and none is needed — but it is a live credential: never copy it into the checkout and never commit it. Electron `safeStorage` was removed (the prompt on every launch it caused, and the rule that boot must never touch the login keychain, are argued at the top of `apikey.ts`); migration 004 drops the dead ciphertext row, and `src/main/apikey.test.ts` walks the import graph and sweeps `src/` so it cannot come back. Optional now that the CLI can answer |
| Session setup from pasted text, claim rows, prefix frozen and hashed at confirmation | `src/main/sessions.ts` | `pack_confirmed_at` gates opening the room |
| Role–name pairing randomised at install | `src/room/agents.ts`, `ipc.ts` | Stored in settings; recorded per session. `ellie_peer` now reads as "Ellie is the Teacher" |
| Three-pane shell, message anatomy, composer hairline, indicators, ledger rail, whisper pane, recap | `src/renderer/` | Functional against the scripted client |
| Event log with the §7.1 vocabulary, and an outbox with deterministic doc ids | `actor.ts`, `db/` | Event payloads never contain message bodies (asserted in a test) |
| **App icon, wired** (#20) | `assets/AppIcon.*`, `electron-builder.yml`, `src/main/index.ts` | `mac.icon` for the bundle; `app.dock.setIcon` so `npm run dev` shows it too |
| **Local install + launchd auto-rebuild** (#20) | `tools/install-local.sh`, `tools/com.chattered.updater.plist` | `npm run install:local` → `~/Applications/ChatterED.app` plus a LaunchAgent that rebuilds at login and every 6 h after `git pull --ff-only`. A failed build leaves the previous app untouched. Unsigned, ad-hoc only (#17) |
| **Segmentation, stages 0–3 — geometry only, no model call** (#25) | `src/shared/segment/` | Build groups, chrome removal, candidate cut lines (horizontal + the §C6 vertical), labels from the text layer, and split/merge/reorder with the §C5 invariants asserted by `checkPartition`. Pure: no Electron, no SQLite, no pdf.js, no DOM. Contract in `docs/SEGMENTS.md` |
| **Page geometry from pdf.js** (#25) | `src/main/vault/geometry.ts` | Text boxes per §B1.1 (zero-width `hasEOL` items dropped), non-text ink by a CTM walk over `getOperatorList` per §B1.3 Method 1, tagged struct roles per §B1.4. One extra rule the briefs do not have: ink holding ≥ 25 % of its page's text runs is a *container*, not a figure — without it, 5 of the fixture's 7 pages refuse every cut |
| **Genre router** (#31) | `src/shared/segment/genre.ts` | The four §H threshold rules; only `slides` produces candidates in A1, everything else opens whole-page with a notice |
| **Segments persisted, and on the IPC bridge** (#25) | `009_segments.sql`, `src/main/db/repos/segments.ts`, `src/main/vault/segments.ts` | Cached against `content_sha`; `segments_touched` means a learner-edited flow is never recomputed. Five channels (`segments:get/split/merge/reorder/rename`), each returning the whole view, a refusal included. Nothing reflowed is stored — §C3 |
| **Measured on a real deck** | `src/main/vault/geometry.test.ts` | The 7-page 16:9 critique deck in `Academia/Sources/btw interaction/`: 4/2/3/0/2/3/4 accepted candidates per page (18 total, one empty page), inside `segmentation-genres.md` §D1's 1–5 per page. Page 4 is §C6's figure-beside-bullets case and correctly offers nothing horizontal |

## Scripted — real machinery, scripted content

- **Agent turn text** in the default mode. `ScriptedClient` replays the eleven turns of
  `design-brief.md` §G. Say this on camera: a scripted turn presented as scripted costs nothing.
  Enter an API key in first-run and the same code path calls Haiku 4.5 for real.
- **Whisper replies and the relay draft** come from the same script in scripted mode.
- **REFERENCE answers** come from the script in scripted mode — and go through the *same*
  `truncateToWords()` the live path uses, so a script cannot put a 300-word answer on camera.
- **The Teacher's hand-off line is not scripted and is not generated.** It is built by
  `flow.handOffLine()` from the taught set and posted as Ellie's own message. That is the point:
  beat 10 says "a rule I can see and turn down, not a model's whim", and it has to be true.
- **Stage-1 silence nudges are drawn from a fixed pool in both modes, deliberately** — content-free
  by construction, never generated against the concept (`product-design.md` §C5).

**The Critique 1 script — the whole video path, offline** (`flow-build-plan.md` §3.3 Track C, §4.4).
`src/room/llm/script.critique1.ts` carries beats 7–13 over the deck the video is filmed on, with
its own pack (`concepts/btw-side-channel-v1.ts`, claims C1–C3, every criterion traceable to a
page). `script.critique1.test.ts` drives all six beats through the **real** actor on a fake clock:
the REFERENCE card (100 words, no floor, no timer, no ledger, thread locked until *Explain it
back*), Ellie teaching from page 6, the hand-off fired by `handOffDue()` on the DEMO profile, Max's
one question on C1 — taught four minutes earlier, not the thing taught seconds ago — the answer
moving **two** rows (C1 → defended, C3 → justified) on evidence lifted verbatim from what is
typed, `rule:quiz_feedback`, and the whisper with its relay draft.

**The ledger does not move until Max has been answered**, and the test pins the negative as well as
the positive: `C1:0 C2:0 C3:0` through beat 9 and through the hand-off, an **empty**
`ledger_history` (no gate refused an advance — nothing was proposed), then `C1:3 C2:0 C3:2` on the
answer, with exactly two history rows. Beats 9 and 10 are questions for that reason; a hedged
read-back of the REFERENCE card the app has just written is not the learner explaining anything, so
quoting it as their evidence would be scoring the machine's own words back at them. Both states are
reachable in that one turn — `ledger.ts` gates an advance on rule 1, rule 3 and, for `defended`, on
the Tester having probed that element, and never on the previous level having been passed through —
so no fourth learner turn is needed after the probe. **The three lines the presenter types,
verbatim:**

> **student:1** — Let me try saying it back. The card has the two rows with the same structure, and
> the only thing that changes underneath is that the whispering partner is the agent itself. Is that
> the whole of it, or does the bottom row buy something the top one does not?
>
> **student:2** — And where is any of that tested rather than asserted? Page 5 has a table of limit
> tests on it, and I have not worked out yet what the three of them add up to.
>
> **student:3** — The third one — it was asked to add a todo to memory, claimed it had, and nothing
> was written. So it can read the session and reason about the tool calls, but it cannot act: memory
> was protected, and the same wall is why nothing we settle in the side channel reaches the main
> agent unless I re-type it as a steering prompt. The canary runs again over this
deck and over both agents' contexts. `ScriptedClient` now picks its script: the material's file
name or content hash, a Settings override, or — when nobody told it, which is the app's case today
— by recognising the deck in the request and latching it. Two things the take depends on and the
script cannot fake: **the presenter types the learner's lines** (`CRITIQUE1_LEARNER_LINES`,
verbatim, or the ledger quotes the improvisation instead), and **the sitting must be warmed up** —
`MIN_AGE` stays at 3 min in the demo profile, so beat 10 is not reachable from a cold open;
`critique1Sitting()` is that warm-up as data, for the test and the rehearsal, not for the take.

## Stubbed or not built yet

| Gap | Why it is acceptable now | Where it belongs |
|---|---|---|
| Firestore mirror does nothing | Out of scope for M0/M1 by instruction; the `outbox` table and the interface exist so the drain is the only missing piece | A2 W5 |
| `cache_eligible` uses a ~1.3 tokens/word estimate, not `messages.count_tokens` | The real count needs an API call at setup time; the estimate is recorded and flagged rather than assumed correct | M2 |
| ~~No PDF page-range picker; setup is paste-only~~ | Landed in issue #22 and corrected in the UI-review pass: the range is marked by scrolling, shown and validated as `Pages N–M of X` | done |
| `ensurePrefixFloor`'s widen/glossary steps are not implemented | Needs real token counts first | M2 |
| Consent screen, participant code, withdrawal path | Compliance is handled by Lucas with the prof; the schema holds `consents` already | A2 |
| The flow UI itself — cards, ticks, drag-to-cut, build chips, "Original pages" | The pipeline, the store and the IPC surface are built and tested against the real deck; the renderer is a separate piece of work against `docs/SEGMENTS.md` | A1, next |
| Stage 4, the Claude vision pass over candidate cuts | Removed from A1 by issue #25 decision 4: it was the only API dependency, the only per-page cost and the most visible failure mode on the deadline path | A2, on demand |
| Cross-page merge; non-slide genres (papers, readings, scans, handwriting) | Same-page merge is enough to undo a split; other genres open whole-page with a notice, and `G = 16 pt` is a *slides* constant that §D3 says must be derived per document first | A2 |
| History, export to `~/Documents/ChatterED/` | Not on a marked A1 requirement | A2 |
| ~~Theo's teach-back round~~ | **Dropped, not deferred** (#32): a teach-back *is* a quiz, so it folded into the Tester's question. Theo is out of `rosterFor()`, which makes `teachbackOffer` structurally unreachable rather than merely unbuilt. `acceptTeachback` still compiles, so `shared/types`, the IPC surface and `RecapCard.svelte` are untouched | — |
| Settings: Reply speed, pacing toggle, the `don't do this` target | The Settings screen now exists (#19) but carries only the backend and model choices | A2 |
| Signing / notarisation | Unsigned by decision (#17). `npm run install:local` ad-hoc signs so macOS does not see a *broken* signature; `npm run dist:mac` still produces an unsigned DMG, untested this pass | Later milestone |
| Firebase Auth, the `claudeProxy` function | Superseded for now by per-user keys (#15) | Revisit with the cohort |

## Verified on this Mac, 14 Sep 2026

- `npm run install:local` built and installed `~/Applications/ChatterED.app` (0.1.0, build 21,
  commit `e6df5bf`), ad-hoc signed, `codesign --verify --deep` clean.
- It launches from `~/Applications` — main, GPU, network and renderer processes all up against
  `app.asar`, and it quits cleanly on `osascript -e 'quit app "ChatterED"'`.
- **The packaged app finds the Claude CLI.** Launched through LaunchServices, with none of the
  login shell's PATH, its boot-time probe wrote
  `{"found":true,"path":"/Users/lohzh/.local/bin/claude","loggedIn":true}` into the settings
  table. That is the whole point of building the PATH explicitly (#19).
- Migration 003 applied on first launch (`pragma user_version` = 3).
- `launchctl list | grep com.chattered` shows the agent loaded, and its `RunAtLoad` run appears
  in `~/Library/Logs/chattered-updater.log` — so node, npm and git are all reachable from
  launchd's environment.
- `npm run uninstall:local` unloads and removes the agent and leaves the app in place.

## Teacher + Tester — what changed on 15 Sep, and what it costs

**Ellie is the Teacher; Max is the Tester** (#32). The Peer's "may never supply a complete
correct explanation" contract is **retired**: Ellie explains from the slide and tracks what she
has covered this sitting. Max only ever speaks when he is handed the floor, asks one question,
and never answers it. Theo is out of the roster entirely — a teach-back is a quiz.

**When Max is invoked is a rule on a clock, not a model's judgement** (#33). `src/room/flow.ts`
implements `flow-session.md` §8.2's four conditions — k = 3 learner turns in m = 10 min, ≥ 2
concepts quizzable, the youngest older than the 3 min UI guard, and a clear floor — and
`ruleDecision()` consults it before the orchestrator model is asked anything. A model that asks
for the Tester outside a hand-off is silently demoted to the Teacher. Ellie's *"You've covered X
and Y — Max, over to you."* is written by `flow.handOffLine()`, not generated.

**Say this on camera, in this order.** (1) The hand-off is a rule, and it is visible and
declinable. (2) "Flow" here is a **behavioural proxy for sustained engagement**, not flow in
Csikszentmihalyi's sense — that is self-reported and has no validated log proxy, and nobody
ships an engagement-triggered quiz, so this is a design proposal with a logging plan rather than
established practice. (3) If the `DEMO` profile is in force (k = 2, m = 3 min), say so in the
same breath as "scripted": a hand-off that fires in three minutes because the thresholds were
lowered for filming is a manipulated demo unless the manipulation is said out loud.

**Three numbers that moved away from what issue #33 proposed**, because the research brief found
the evidence ran the other way: the 2 h half-life is gone (recency is now a 60-minute *ranking*
weight that orders candidates and never excludes one); `MIN_AGE` stays at 3 min and is capped in
code, because for *prose* Karpicke & Roediger found immediate testing **beat** a 10-minute delay;
and feedback after every quiz answer is now mandatory (Rowland 2014: g = 0.73 with feedback
against 0.39 without) and is enforced as `rule:quiz_feedback` rather than asked for in Max's
prompt.

**What it cost.** `PROMPT_VERSION` is `prompts.v0.2` and `sharedBlock()` changed, so
`prefix_sha256` moves — harmless, since the prefix is frozen per material and a new document
opens a new room. The S2 disagreement quota, `mustDisagree` and `TurnDecision.disagreement` are
deleted end to end; the `messages.disagreement` column and the `MessageView` field stay so a
room recorded before this build still renders its markers.

## Deviations from `docs/research/architecture-mac.md`

Recorded in full in that document's **Implementation notes** section. In short: Svelte 5 + Vite
instead of SvelteKit (one window, no routing); per-user API keys instead of the Cloud Function
proxy (issue #15 supersedes §B.2); `node:sqlite` in tests because `better-sqlite3` is rebuilt for
Electron's ABI; a relaxed material `CHECK` so an uncacheable selection is recorded rather than
refused; a fifth ledger gate making `defended` unreachable without a Challenger probe.

## Issue #21 — the title bar, 14 Sep 2026

**Real.** The window is still `titleBarStyle: 'hiddenInset'`, but the renderer now draws a
38 px `TitleBar.svelte` above everything else and reserves the left 78 px of it
(`src/renderer/lib/chrome.ts`, `TRAFFIC_LIGHT_INSET`) as an empty spacer for the traffic
lights. The bar is the window's drag handle (`-webkit-app-region: drag`); a `.no-drag` class
is defined for any control added to it later, because a drag region swallows clicks. The
brand mark moved out of the nav rail and into the bar, after the spacer — it was the thing
sitting underneath the buttons. `trafficLightPosition` moved to `{x:14, y:13}` so 12 px
buttons centre in a 38 px bar.

Fullscreen is the case the obvious fix gets wrong: macOS stops drawing the buttons, and a
78 px spacer then just shoves the title into the middle of nowhere. The window is the only
thing that knows, so `main/index.ts` pushes `{fullScreen}` on `enter-full-screen`,
`leave-full-screen` and `did-finish-load` over a new `app:windowState` channel, and the
spacer collapses to 0.

Verified in a real Electron window against the built renderer
(`app/dist/renderer`, preload loaded, main's #21 wiring stood in):

| state | bar | drag region | spacer | brand left | nav rail top / first item |
|---|---|---|---|---|---|
| windowed 1320 | top 0, h 38 | `drag` | 78 px | x 78 | 38 / 50 |
| fullscreen 1512 | top 0, h 38 | `drag` | **0 px** | x 0 | 38 / 50 |
| narrow 1040 | top 0, h 38 | `drag` | 78 px | x 78 | 38 / 50 |

Hit-testing (20,19), (40,19), (60,19) — inside the traffic-light rectangle — returns the
empty header in every windowed state, so nothing is underneath the buttons any more.

## Issue #22 stage (b) — the vault: scan, topics, sidebar tree

**Real.** "Open folder" now picks a **vault root**, not a slides folder. Migration `005`
adds `vaults`, `topics`, `files` and an FTS5 `file_text`; `src/main/vault/` holds the scan,
the classification, the repository, the pdf.js extractor, the background indexer and the
fuzzy finder. `src/room` imports none of it — the room still receives plain text.

| Piece | Where | Notes |
|---|---|---|
| Recursive scan with skip rules | `src/main/vault/scan.ts`, `kinds.ts` | Skips dotfiles/dot-dirs, a fixed `node_modules`/`.git`/build-output denylist, files over 200 MB, non-regular files and **symlinks** (in or out), with a depth and a file-count guard. Sorted output, so two scans of an unchanged tree are byte-identical — the topic file list reaches a cached prompt prefix, where §E.2 forbids volatility |
| Topic promotion | `service.ts#promote` | Depth-1 folders only. The promoted set is set *exactly*; anything untick*ed* falls back to **Other**, which stays browsable. A folder named like a module code (`MA3236`) gets `module_code`; anything else does not, because guessing harder than that is guessing |
| Incremental re-sync | `repo.ts#sync` | Keyed on `(size, mtime_ms)`. A changed file loses its `indexed_*` stamp and comes back round to the indexer; a file whose *topic* changed keeps its index, because the bytes did not move. A deleted file takes its FTS rows with it. Runs on `open`, on "Re-scan", and on **window focus** |
| PDF text extraction | `vault/pdf.ts` | `pdfjs-dist` 6.x, **worker disabled**, no canvas, no standard-font fetches. ESM-only, so it is loaded through `new Function('s','return import(s)')` — tsc with `module: CommonJS` would otherwise rewrite a literal `import()` into a `require()` that cannot load ESM — with a `vm.USE_MAIN_CONTEXT_DEFAULT_LOADER` fallback for vitest's module runner. Per page, joined into lines by `hasEOL` and y-coordinate breaks |
| FTS5 index | migration `005`, `repo.ts` | One row per PDF **page** (so a hit names a page), one per Markdown/text/code file. Background, incremental, batched, yielding to the event loop between files; the app stays usable while it runs. A learner's query is quoted term-by-term before it reaches the FTS5 query parser |
| Sidebar | `VaultSidebar.svelte`, `FileTree.svelte`, `TopicSheet.svelte` | Topic list with count badges, "Other", a determinate indexing strip (§B1 L212), and a folders-first tree with numeric collation (`Week 4` before `Week 10`). Topic dots come from a **new palette** that avoids the three agent hues and indigo (§C2 rules 2 and 3) |

**The test driver changed.** Node 22's built-in `node:sqlite` has **no FTS5**
(`sqlite_compileoption_used('ENABLE_FTS5')` = 0; `CREATE VIRTUAL TABLE … USING fts5` fails
with "no such module: fts5"), so migration 005 could not even be applied under the old test
database. `openTestDatabase` now loads `better-sqlite3-node` — a devDependency **alias of the
identical better-sqlite3 version**, left on its Node-ABI prebuild while `postinstall`
rebuilds the production copy for Electron. Both sides are now SQLite 3.53.4 with
`ENABLE_FTS5` = 1, and a test can no longer pass against a different SQLite than the one
that ships. Verified that `electron-builder install-app-deps` only rebuilds `dependencies`,
so the alias survives a `postinstall`.

**Verified on the real vault** (`/Users/lohzh/ChatterED/Academia`, 17 files): scan 3 ms;
promoting `Sources` gives a 16-file topic and 1 file under Other; indexing all 16 takes
1.8 s; `Challenger` returns 8 hits, top five all in the Xu et al. paper at pages 11, 12, 4,
15 and 14 with correct snippets; the ⌘K matcher resolves `explain` to
`Sources/_text/who-you-explain-to-matters.txt`.

**Departures from `product-design.md` §B1, named rather than slipped in:**

1. **"A *launcher*, not a content manager" (§B1 L169)** — issue #22 deliberately moves that
   line. Browsing, searching and reading now happen here. The two §B1 rules that carry a
   design decision survive untouched: **no upload button exists anywhere** (L180) and **no
   agent appears in the Library** (L222).
2. **One vault root, not "Watched folders" (§B1 L179, §B7 L587)** — a student keeps one notes
   tree and the modules are folders inside it. `settings.slides_folder` is kept in step so
   §F.4's first-run copy is not orphaned, but it is no longer what the Library reads.
3. **Count badges count files, not sessions (§B0 L137, §B1 L173)** — the badge is next to a
   folder now, and the number a learner wants beside a folder is how much is in it. The
   course list in the nav rail still counts sessions.
4. **"No PDFs in this folder yet." (canonical string 1, §E4 L1207)** becomes "Nothing readable
   in this folder yet.", because the vault indexes Markdown, text, code and images too. §E4
   L1205 says that is a design change, so it is recorded here as one.

**Stubbed at this stage:** clicking a file only selects it — the viewers are stage (d); the
finder and the search box are stage (c); nothing yet reaches the room.

## Issue #22 stage (c) — the finder and full-text search, in the UI

**Real.** The indexer from stage (b) now has two front ends.

- **⌘K finder** (`Finder.svelte`): fuzzy filename and path matching, no index needed, instant.
  Matching happens in the main process (`vault/finder.ts`), so the renderer holds no file list
  of its own and cannot go stale against the index. Arrow keys / ⌃N / ⌃P move, Enter opens,
  Esc closes; the matched characters are **bold, not tinted**, because indigo belongs to the
  learner and to primary actions (§C2 rule 3) and weight survives greyscale (rule 1).
- **Search box** in the Library header: FTS5 over PDF pages, Markdown, text and code, with a
  snippet per hit and a **page number for a PDF hit**. Results replace the launcher content
  while a query is live and the Clear link puts it back.

**The ⌘K collision, resolved by scope rather than by moving either binding.** §C10 L1004 binds
⌘K to the whisper; §B1's own header ASCII at L186 already prints `[ Search ⌘K ]`. The two can
never be live at once, because the Library is not on screen while a room is open: `App.svelte`
owns the binding and stands down when `screen === 'room'`, where `Room.svelte` has always
owned it. Written down here because §C10 does not say so itself.

**Snippets cross IPC as text, never as markup.** SQLite wraps each matched term in two Private
Use Area code points (`src/shared/snippet.ts`, shared by both sides so they cannot disagree);
the renderer splits on them and renders each run as text. A search result is untrusted file
content — whatever is on the learner's disk — and a main process handing the renderer HTML to
inject would be an injection point. Asserted in `snippet.test.ts`.

A learner's query is quoted term-by-term before it reaches the FTS5 query language, so typing
`AND OR NEAR(` is a search for those words rather than a syntax error; only the last term gets
a prefix `*`, so search feels live while it is still being typed.

**Stubbed at this stage:** a hit or a finder result only *selects* the file — the viewers are
stage (d).

## Issue #22 stage (d) — the viewers

**Real.** Opening a file in the Library now shows it, in the app. No Quick Look.

| Kind | Component | What it does |
|---|---|---|
| PDF | `PdfViewer.svelte` | pdf.js in the renderer: page navigation (‹ › and a page box), zoom (⊟ 140% ⊞ / Fit — the §B2 L240 chrome), current-page state from an IntersectionObserver, and a page-range selector |
| Markdown | `MarkdownViewer.svelte` + `lib/markdown.ts` | marked + **KaTeX** for `$…$` and `$$…$$`, highlight.js for fenced code, and an outline rail when there are more than two headings |
| Text and code | `TextViewer.svelte` | highlight.js by extension for code; plain text is left alone, because auto-detecting a language in lecture notes produces confident nonsense |
| Images | `ImageViewer.svelte` | png · jpg · gif · svg · webp · bmp · avif, via an object URL, with zoom |
| Anything else | `DocumentPane.svelte` | The "no viewer" card: says what happened, keeps the file, offers **Reveal in Finder** |

**The page-range conflict, resolved by building both.** `product-design.md` §B2 L230 specifies a
typed `Pages [30]–[31]` stepper; `architecture-mac.md` L970 says the opposite — "the range is
chosen by scrolling — 'start here' / 'end here' — **not** by typing numbers". They are not
really alternatives: **Start here / End here** mark the page you are looking at, and the two
number fields show and correct what they marked. The marked range is outlined on the pages
themselves with a rule, not a tint (§C2 rule 2 keeps backgrounds untinted).

**Bytes cross IPC, not a URL.** A PDF or an image comes back as a `Uint8Array` on the
`DocumentView`. A custom `chattered://file/<id>` protocol would have been less copying, but it
would also have handed the renderer a URL it could re-request at will; as it stands a file the
main process never handed over stays unreachable. The cost is that a very large PDF is copied
once per open — noted, not yet a problem (the 10.3 MB Xu et al. paper opens in well under a
second).

**Two bugs the browser probe caught, both fixed before this commit:**
1. *"Cannot use the same canvas during multiple render() operations."* Two intersections for
   one page can arrive before the first render resolves. Each page's `RenderTask` is now kept
   and cancelled before a new one starts; a cancelled render is the normal result of scrolling
   past a page, not an error.
2. **Every page rendered at once.** An unrendered page box has no height, so all 24 pages of a
   paper sat inside the viewport, all intersected, and the "lazy" render rendered the whole
   document. Page 1's viewport is now read up front and used as the placeholder size for every
   page. Measured after the fix: **2 of 24** canvases drawn on open.

**`{@html}` is used twice, and both are asserted rather than trusted.** `lib/markdown.ts`
drops raw HTML from the source instead of rendering it, escapes fenced code, and turns links
and images into inert text — the pane is a reader, not a browser, and a renderer that can be
navigated is a way out of the app. `markdown.test.ts` (17 tests) covers a raw `<script>`, an
`onerror` attribute, a `javascript:` link, a relative image, KaTeX inline and display, `$5 and
$6` not being a formula, `$HOME` inside a code span, and a broken formula degrading to its own
source instead of an error card.

**Verified against the real vault in a real Electron window** (real main process, real preload,
real renderer, `/Users/lohzh/ChatterED/Academia` as the vault, `Sources` promoted): 16 of 16
files indexed, 0 failed; searching `Challenger` gives 20 hits led by the Xu et al. paper at
pages 11, 12 and 4; clicking that hit opens the PDF at 24 pages, 10.3 MB, first canvas
1715×2220 with 358,646 dark pixels; the page box jumps to 3; **Start here / End here** writes
3–3 and outlines exactly one page; a Markdown file renders with its headings and no `<script>`
nodes; ⌘K with `whoyouexplain` finds `Sources/_text/who-you-explain-to-matters.txt`.

**Stubbed at this stage:** nothing from the viewer reaches the room yet — that is stage (e).

## Issue #22 stage (e) — Show the room, session-from-file, topic context

**Real.** The vault now reaches the group chat, and only the group chat.

**Chat is the study room, and always was.** There is no single-assistant "Ask" mode to remove:
a sweep of `src/` finds no such affordance, and product-design.md argues against it three times
over — P2 L65 ("exactly two agents are ever live… the UI has no affordance for adding a third
voice"), P1 L51 (the learner speaks first and last) and §B3 L360 ("No model picker (NUSSync has
one; ChatterED must not)"). Recorded as confirmation, not as a change.

**"Show the room"** — three ways in, per the decision: the **Show the room · p. N** button in the
document pane's header while a room is open, **⌘⇧S** (which opens the vault browser if it is not
already open, because "show them this" and "go and find the thing to show them" are the same
intention half a second apart), and a **right-click on a selection**. It posts a *learner
message* — `Look at this — <file>, p. N.` — with a `message_refs` row carrying the page range,
the selection (capped at 1,500 characters, **in the main process**, because the renderer does
not get to decide how much of a document reaches a model) and the extracted page text.

Being a learner message settles three things at once: a held agent reply is **cancelled, not
queued** (§C3 L731); the 8 s floor-yield window opens, so nothing acknowledges it instantly
(§C3 L719); and the ledger can only ever quote the one-line body, because the page text is on
the reference row and never in `messages.body`. That last one is the point — a slide can never
become "evidence the learner explained it".

**The card** (`DocumentCard.svelte`) follows §C6 L872, the one existing source reference in the
transcript: neutral, system-styled, carries a page reference, and clicking it reopens the file
at that page. It shows the highlighted passage (collapsed past 160 characters) and **not** the
page text — the agents were given that; printing a slide back at the learner would make this a
paste, which is exactly what it is not. No action chips: §B3 L359 rules out anything in the
transcript that produces an agent turn.

**Where the text goes.** `message_refs.page_text` is rendered into the **message stream**, after
the last cache breakpoint — never into `system[0]`, which is frozen and hashed at pack
confirmation (§E.3 L1119). A mid-session document that touched the prefix would invalidate every
cached prefix in the room for the rest of the session. Asserted in `context.test.ts` and again
in `actor.test.ts`, alongside a check that `system[0]` stays byte-identical for both agents.

**The whisper invariant still holds.** `groupView`'s member list grew `messageRefs`, and the
store-shape assertion in the leak test was **widened deliberately rather than loosened**: a
reference is a public act posted by the learner into the thread, and the agents are meant to see
it. The canary test now runs with a reference present and still finds no whisper in the group
prompt.

**Session from a file + page range.** `Explain p. N →` in the document pane pulls the extracted
text for the marked range into the existing paste box, with a line saying where it came from and
an invitation to fix it ("it often does with maths" — §E.1 L939 is explicit that pdf.js output
is a record, not a prompt). Paste is untouched and remains the fallback.

**Topic context** (`materials.topic_context`, migration 006) is the topic name plus a sorted,
capped list of file names, frozen on the material row at creation and included in `sharedBlock`.
Frozen, because `sharedBlock` is rebuilt from that row on every turn and must be byte-identical
each time (§E.2 L1077) — a list read live from the vault would change the moment the learner
saved a file into that folder. It also tells the agents they have **not read** those files,
because otherwise a file list reads as a reading list they are expected to know.

**The prefix arithmetic stays honest.** The topic block counts towards `token_count`, and
`cache_eligible` still tracks the same 4,096 threshold. Measured on the real flow: a single page
of the Xu et al. paper plus the topic block gives `token_count` 2,064 and `cache_eligible` 0 —
which is §E.2 L1004's prediction ("every realistic slide selection misses") showing up as a
recorded fact rather than an assumption.

**The page-range conflict**, again: both controls are built (see stage (d)).

**Three bugs the probe caught:**
1. **A search hit opened the file at page 1.** `goTo` clamped against `pageCount`, which is 0
   until the document has loaded, so "open at page 11" silently became page 1. The target is now
   remembered and applied once the document is there.
2. **"An object could not be cloned."** The topic object handed to `createSession` was a Svelte
   `$state` proxy, and IPC is `structuredClone`. Snapshotted before it crosses.
3. **The button sat spinning for ten seconds.** `showDocument` does not resolve until the agent
   that answers has finished its latency floor, so awaiting it left the learner looking at the
   file they had just shown. It is now fire-and-forget, the same shape as `send()`; a failure
   still lands in the notice banner.

**Verified end to end in a real Electron window**, against `/Users/lohzh/ChatterED/Academia`
with `Sources` promoted: search `Challenger` → 20 hits → open the Xu et al. PDF **at page 11**
(the hit's own page) → jump to 3 → **Start here / End here** marks 3–3 → `Explain p. 3 →` seeds
setup with 5,675 characters and the line "From 3772318.3790298 (1).pdf, p. 3" → open the room →
**Bring a document…** reopens the browser with the PDF still where it was → mark 3–3 →
**Show the room · p. 3** → back in the room, transcript shows
`Look at this — 3772318.3790298 (1).pdf, p. 3.` with the document card `▤ … p. 3`. In the
database: one `message_refs` row, pages 3–3, 5,675 characters of page text. In the assembled
prompt: the reference block and the page text in `messages`, the topic block ("The student is
working in their "Sources" folder…") in `system[0]`, and nothing of the attachment in the
prefix.

**Stubbed or deliberately left:**
- The right-click path is only reachable where there is DOM text to select — Markdown, text and
  code. A pdf.js page is a canvas, so a PDF reference carries a page range and no highlighted
  passage. A pdf.js text layer would fix that and is not built.
- A reference posted while the room is closed is not possible: the button only appears in a room.
- `ensurePrefixFloor`'s widen and glossary steps are still unbuilt (M2), so a short selection is
  recorded as `cache_eligible = 0` and said so, exactly as before.
- References are local-only. They are not in the `outbox` collection enum and are not mirrored,
  for the same reason `extracted_text` is not (§D.3 L862).

## Verified on this Mac, 14 Sep 2026 — the installed app (issues #21, #22)

`npm run install:local -- --force` built and installed `~/Applications/ChatterED.app`
(0.1.0, build 28, commit `882012b`, ad-hoc signed). It was then driven over the Chrome
DevTools Protocol — the real bundle, running out of `app.asar`, not a dev build:

| Step | Result |
|---|---|
| Migrations | `pragma user_version` = **6**; `vaults`, `topics`, `files`, `file_text`, `message_refs` present; `materials.topic_context` added |
| Title bar (#21) | 38 px, `-webkit-app-region: drag`, 78 px spacer, brand at x 78; `elementFromPoint` at (20,19), (40,19), (60,19) returns the empty header |
| Library | `Sources 16` · `Other 1`, 22 tree rows, search box |
| Search `Challenger` | 20 hits, led by the Xu et al. paper at pages 11, 12 and 4 |
| Open that hit | The PDF opens **at page 11** — the hit's own page — 24 pages, 10.3 MB, **2 of 24** canvases drawn |
| Page 3, Start here / End here | Page box `3`, range `3–3` |
| `Explain p. 3 →` | Setup seeded with 5,675 characters and "From 3772318.3790298 (1).pdf, p. 3" |
| Open the room | Room opens on the live Claude CLI backend (the concept draft is a real model call, so it takes a few seconds) |
| `Bring a document…` → `Show the room · p. 3` | Back in the room, the transcript shows `Look at this — 3772318.3790298 (1).pdf, p. 3.` with the document card `▤ 3772318.3790298 (1).pdf p. 3` |
| In the app's own database | one `message_refs` row: pages 3–3, 5,675 characters of page text. The material: `source_kind = pdf_pages`, pages 3–3, `topic_context` = "The student is working in their "Sources" folder…", `token_count` 2,809, `cache_eligible` 0 |
| Quit | `osascript -e 'quit app "ChatterED"'` — clean, no processes left |

pdf.js in the renderer works from inside `app.asar` (its worker is a Vite-emitted same-origin
asset, and the CSP now names `worker-src 'self' blob:` and `font-src 'self' data:` for it and
for KaTeX's fonts). The main process's copy of pdf.js is `asarUnpack`ed, because Node's ESM
loader cannot `import()` out of an asar archive.

`cache_eligible = 0` at 2,809 tokens is the honest, expected answer, not a regression:
architecture-mac.md §E.2 L1004 says every realistic single-slide selection misses the 4,096
floor, and `ensurePrefixFloor`'s widen and glossary steps are still M2 work.

## UI review fixes, 15 Sep 2026 — **uncommitted** (git is blocked on this Mac)

`git` exits 69 (`You have not agreed to the Xcode license agreements`; only Lucas can run
`sudo xcodebuild -license accept`), so none of the work below is committed. It is all in the
working tree. The per-stage file lists are here so nothing is lost if this has to be picked up
in another session.

Source: the merged list from `docs/research/ui-review-code.md` and `docs/research/ui-review-ux.md`.
**Deliberately not done this pass** (Lucas's decision, a later pass): the persistent third chat
pane in the Library (code review §2, UX B1) and the "Bring a document replaces the room"
restructure (UX M10).

### Stage 1 — PDF fit and viewer correctness (code review §1, §5.1–5.6, §5.8)

| File | What changed |
|---|---|
| `src/renderer/lib/pdfview.ts` | **New.** Every number the viewer depends on, as plain functions: `fitScale` (fit-width / fit-page against the real page box, 0 = "not measured, do not paint"), `governingSize`, `pageAtViewportTop`, `validateRange`, `markStart`/`markEnd`, `evictable`, `pinchScale`, `anchorScroll`, `pushHorizontal` (the page-turn latch), the zoom ladder |
| `src/renderer/lib/pdfview.test.ts` | **New.** 36 tests, against the numbers measured in the review (960 pt deck, 841.9 pt landscape, 891 px pane) |
| `src/renderer/components/PdfViewer.svelte` | Rewritten around that module: real `base.w`, a **Fit width / Fit page** pair, `scrollbar-gutter: stable`, per-page sizes measured in background chunks, canvas eviction outside ±3 pages, scroll-position page counter, range validation with an inline error, keyboard-reachable scroll area, one integer for both the page box and the canvas |
| `src/renderer/components/DocumentPane.svelte` | Binds `pageCount`, restores and records scroll per file, disables **Explain** / **Show the room** on an inverted range |
| `src/renderer/lib/store.svelte.ts` | `docPageCount`, `docScroll`, and `showTheRoom()` refuses an invalid range |

Verified in a running dev build over CDP (own port 9333, own `--user-data-dir`, vault =
`/Users/lohzh/ChatterED/Academia`):

| Check | Before | After |
|---|---|---|
| 16:9 deck (960 pt), pane 891 px | page 1346 px, `scrollWidth` 1345, h-scrollbar, "140 %" | page **843 px**, `scrollWidth` 891, no h-scrollbar, "88 %" |
| 31-page paper, scrolled end to end | 31 of 31 canvases live | **4** live, 56 MB (27 released to 0×0) |
| Page counter at 300 % (max ratio 0.285) | frozen on page 1 | tracks: 8 at 25 %, 19 at 60 % |
| `pp. 9–3` | `Explain pp. 9–3 →` seeded an empty paste box | inline *"Pages 9–3 runs backwards…"*, Explain disabled, nothing outlined |

### Stage 2 — the on-camera blockers (ui-review-ux.md B4, B5, M2, M7, M9, m4)

| File | What changed |
|---|---|
| `src/room/roundcard.ts` + `.test.ts` | **New.** The round card is built from the live Concept Pack and the live roster; `SCRIPT_ROUND_CARD` is used only in scripted mode, where the fixed pack *is* the session |
| `src/room/actor.ts` | Uses it; recap rewritten — act counts of what the learner *did* (turns, challenges answered, self-corrections, documents brought in) with zero counts dropped and the block absent when nothing happened; the Theo block gated on something being on the record; `Nothing yet on X.` instead of `What about X?`; new `acceptTeachback()` |
| `src/main/sessions.ts` | `module_code` may be empty — no `MA3236` literal; `learner_label` constrained in `DRAFT_SCHEMA` (≤ 8 words / ≤ 60 chars) plus one line in the ingest system prompt, a single re-prompt when it comes back long, and `shortLabel()` as the truncating fallback; `packFor` shortens whatever arrives |
| `src/room/prompts.ts` | The `MODULE` line is omitted when there is no module. Old materials all have one, so the frozen prefix of every historical room is byte-identical |
| `src/renderer/components/SessionSetup.svelte` | No `MA3236` default (optional field, `e.g. CS3249` placeholder); claim rows are auto-growing textareas with the short rail label beside each |
| `src/renderer/components/RecapCard.svelte` | No score block when there is nothing to describe; **Yes, invite Theo** is wired |
| `src/renderer/components/LedgerRow.svelte` | Row id shown (§B5's own wireframe), label clamped to two lines with the full claim as the row title |
| `shared/types.ts`, `shared/ipc.ts`, `preload/`, `main/ipc.ts`, `mockBridge.ts`, `store.svelte.ts` | `acceptTeachback` through the bridge; `CreateSessionInput.claims[].learnerLabel` |

**Theo, honestly.** His teach-back round is still A2. The button now records `teachback.accepted`
in the event log and answers *"Noted — Theo's round is the next thing being built. Nothing here is
lost…"*, which is a real handler and a true sentence; it is not the round itself.

Tests: `roundcard.test.ts` (8), `sessions.test.ts` +17 (`shortLabel`, the empty module code and
the prefix, `packFor`, `draftConcept`'s re-prompt against a fake client), `actor.test.ts` +6
(act profile, the Theo gate, the open-question template, the round card, `acceptTeachback`).

### Stage 3 — the navigation merge (ui-review-code.md §3, ui-review-ux.md M1–M5, m1, m2, B2)

| File | What changed |
|---|---|
| `src/renderer/components/NavRail.svelte` | 48 px, icons only, always. `COURSES` and the `dot()` hue function deleted; **History is absent, not greyed** — it comes back with its own screen |
| `src/renderer/App.svelte`, `store.svelte.ts` | `navCollapsed` and its three writers gone; `TopicSheet` mounted above the screen router so Settings and first run can open it |
| `src/renderer/components/VaultSidebar.svelte` | Two-line header: the vault name (2-line clamp, full path as `title`) over **Edit topics · Change vault…**. "Other" pinned below a hairline, muted, and its tree starts closed |
| `src/renderer/components/FileTree.svelte` | `defaultOpen` prop; only folders the learner actually touched are remembered |
| `src/renderer/components/VaultBrowser.svelte` | One search entry: the box searches inside files, a `⌘K names` chip inside it opens the filename finder |
| `src/renderer/components/DocumentPane.svelte` | The primary action is a real indigo button — **Explain p. 3 with Ellie and Max** — `aria-describedby` the page-range fields; Reveal in Finder / Close stay secondary |
| `src/renderer/components/PdfViewer.svelte` | The range group is `#page-range`, labelled `Pages … of N`, and outlined indigo when set |
| `src/renderer/components/FirstRun.svelte` | Card 3 opens the **vault**, through the same call the Library uses |
| `src/renderer/components/Settings.svelte` | New **Your files** group: vault name, path, counts, Change vault… / Re-scan / Edit topics… |
| `src/renderer/components/Library.svelte` | Empty-state copy fixed (`n files here, no topics yet` + **Pick your topics →**) |
| `src/renderer/lib/labels.ts` | `agentNames()` — the button's "Ellie and Max", read off the live roster |
| `src/main/db/migrations/007_drop_slides_folder.sql` | **New.** Deletes the `slides_folder` settings row |
| `shared/ipc.ts`, `preload/`, `main/ipc.ts`, `main/vault/service.ts`, `shared/types.ts`, `mockBridge.ts` | `chooseSlidesFolder` and `slidesFolder` deleted end to end; `SettingsView.vaultRoot` replaces it; `RecentSession.moduleCode` dropped from the view type |

**`rooms.module_code` is untouched in the database.** Only the display path is gone. Every
historical material's `prefix_sha256` was hashed with the code in the `MODULE` line, and
rewriting the column would silently invalidate the frozen prefix of every room that already
exists (architecture-mac.md §E.3). Asserted in `navigation.test.ts`.

Tests: `navigation.test.ts` (5 — the two dead paths swept out of `src/`, migration 007 against a
database that already had the row, and the columns still present), `labels.test.ts` (5).

Verified live: nav rail 48 px, document scroll area **1011 px** (was 891 — the 120 px went to the
document), header reads `Explain p. 1 with Ellie and Max` as an indigo button, one search box
with a `⌘K names` chip, `Pages … of 7` beside it, Other closed.

### Stage 4 — the application menu and trackpad gestures (ui-review-code.md §4, §5.9)

| File | What changed |
|---|---|
| `src/main/menu.ts` + `.test.ts` | **New.** App / File / Edit / View / Window / Help. View owns **Zoom In ⌘+ (and a hidden ⌘= twin), Zoom Out ⌘−, Actual Size ⌘0, Fit Width ⌘1, Fit Page ⌘2, Next/Previous Page ⌘↓ ⌘↑** and routes each to the viewer over one `app:command` channel. **Reload / Force Reload / Toggle DevTools only when `!app.isPackaged`** |
| `src/main/index.ts` | Installs it; `webContents.setZoomMode('disabled')` + `setVisualZoomLevelLimits(1, 1)` so nothing scales the UI chrome; the BrowserWindow `'swipe'` event as a secondary page-turn path |
| `src/renderer/lib/viewer.ts` + `.test.ts` | **New.** The registry from a menu item to whichever viewer is open |
| `src/renderer/lib/store.svelte.ts` | `runCommand()` — viewer commands to the viewer, `vault.open` / `vault.rescan` / `topics.edit` / `search.files` / `settings.open` to the same calls the buttons make |
| `src/renderer/components/PdfViewer.svelte` | Pinch (`wheel` + `ctrlKey`, `preventDefault`, zoom about the cursor, one CSS transform on a `.pages` wrapper, re-render at the final scale after 150 ms idle); two-finger horizontal `wheel` with a momentum latch → page turn, suppressed while the page is pannable; double-click toggles Fit ↔ 100 % about the click point |
| `shared/ipc.ts`, `shared/types.ts`, `preload/`, `mockBridge.ts` | The `app:command` channel and the closed `AppCommand` union |

Verified live over CDP and the macOS accessibility API:

| Check | Result |
|---|---|
| Menu bar | `Apple / Electron / File / Edit / View / Window / Help` — the app's own, not Electron's default |
| View menu | `Zoom In / Zoom Out / Actual Size / — / Fit Width / Fit Page / — / Next Page / Previous Page / — / Toggle Full Screen / — / Reload / Force Reload / Toggle Developer Tools` (the last three dev-only) |
| Clicking **Zoom In** | PDF 100 % → 125 %, page 960 → 1200 px; `devicePixelRatio` still 2, `innerWidth` still 1320 — the chrome did not move |
| `Input.synthesizePinchGesture` ×2.0 at (600, 400) | PDF 100 % → **201 %**, page 963 → 1926 px, scroll anchored to (289, 225); `visualViewport.scale` still 1 |
| One horizontal flick (13 wheel events with momentum) | page 1 → **2**, exactly once |
| Double-click, twice | Fit width → 100 % → Fit width |

### Stage 5 — the room shows the slide (ui-review-ux.md M11)

| File | What changed |
|---|---|
| `src/main/db/migrations/008_material_file_id.sql` | **New.** `materials.file_id`, nullable. `CreateSessionInput.fileId` has existed since issue #22 and was thrown away, so the room had no way to find the bytes again |
| `src/main/sessions.ts`, `src/room/records.ts`, `src/room/actor.ts`, `shared/types.ts` | Store it, carry it into `MaterialView` |
| `src/renderer/components/SourcePane.svelte` | Renders the referenced page with `PdfViewer` (read-only, page-locked). The extracted text stays as a closed `› text I read from this page` disclosure — it is exactly what the agents were given, and it is the thing to look at when extraction went wrong |
| `src/renderer/components/PdfViewer.svelte` | `locked` + `pageWindow` props: no toolbar, no gestures, no menu registration, fit-page always, a 4 px gutter because the pane is 320–420 px wide |
| `src/renderer/lib/pdfview.ts` | `visiblePages()` — clamped rather than validated, so a range that outlived a re-scan still shows something |
| `src/renderer/lib/store.svelte.ts` | `roomSource` / `loadRoomSource()`, separate from `openDoc` so bringing a second document over does not replace the slide the room is about |

**The prefix is untouched.** `sharedBlock()` reads named fields and `file_id` is not one of them;
asserted by hashing two materials that differ only in it. The room layout is otherwise unchanged —
"Bring a document…" still replaces the room, which is the deferred restructure.

Verified live (scripted session started from `…Critique1_slides (1).pdf`, p. 3): the source pane
renders **one** page, 269 × 151 CSS px in the 320 px pane, no toolbar, no page stamp, the
hyphenated dump (`educa- tional`) absent from the pane, and the text disclosure closed.

Tests: `pdfview.test.ts` +4 (`visiblePages`), `sessions.test.ts` +3 (`file_id` stored, null for
pasted text, and two materials differing only in it hashing identically).

### Stage 6 — docs, and what could not be done

`README.md` gained a **document viewer, menu and trackpad** section (the gesture table, the
`app:command` contract, the dev-only Reload/DevTools rule, canvas eviction) and the layout block
now names `lib/pdfview.ts` and `lib/viewer.ts`.

**Not done, and why.**

- **`npm run install:local` and the installed-app check.** `tools/install-local.sh` calls
  `git status --porcelain`, `git rev-parse HEAD` and `git rev-list --count HEAD` and `die`s if any
  of them fail, so it cannot run while `git` exits 69. The `!app.isPackaged` gate on Reload /
  Force Reload / Toggle DevTools is therefore asserted in `menu.test.ts` (both ways) and confirmed
  present in a **dev** build over the accessibility API; its *absence* in the installed app has
  not been observed on this machine.
- **Nothing is committed or pushed.** See the note at the top of this section.

**Deferred by decision, not missed** (Lucas, 15 Sep): the persistent third chat pane in the
Library (ui-review-code.md §2, ui-review-ux.md B1) and making "Bring a document…" an overlay over
the source pane instead of replacing the room (ui-review-ux.md M10). Issue #23's pivot — the
conversation living inside the document — drops the third pane for good and also drops the recap
screen; the recap fixes in stage 2 were asked for explicitly after that issue was opened, so they
are here, and if the pivot removes the screen they go with it.

**Still open from the review, not in this pass**: Settings ▸ Pacing and the `don't do this` target
(M12), session setup keeping the document on screen with a `①──②` indicator (M6), the recap's
two-column glyph delta and its footer buttons (M9, partly), `Explain this` on file-tree rows on
hover (B2, the document-header button landed), the `Thread` live-region fix (§5.7), and the
whisper-picker `<kbd>` hints (m8).

---

## The flow renderer — Track A of `flow-build-plan.md` §3.2, §4.1 (16 Sep, issue #25)

A PDF opened from the Library now arrives as a **flow of crop cards** instead of a page viewer.
`PdfViewer.svelte` is **modified, not replaced** — it gained `canvasFor(page)`,
`ensureRendered(page)` and `pageSizes()` / `renderScale()`, and is one click away in the flow's
header as **Page viewer**, so nothing that shipped on 15 Sep regresses.

| File | What it is |
|---|---|
| `lib/flowview.ts` + `.test.ts` (**new**, 53 tests) | Every number: card geometry, tick positions, the snap preview, the `PageLru`, `colourFromPixel`, the split's scroll anchor, `flowCards` (the whole Original-pages claim) and the undo ops with their inverses. Node-only, in the shape of `lib/pdfview.ts`. |
| `components/FlowCanvas.svelte` (**new**) | The screen. Its own render-at-card-scale path with its own LRU (it deliberately does not borrow `PdfViewer`'s canvases — that viewer releases a page ±3 away, which is risk 3's blank card), the scroll anchor, the undo stack, the Original-pages toggle, the genre notice band. |
| `components/SegmentCard.svelte` (**new**) | One crop: `drawImage` off a source rectangle, editable label strip, page chip with compare-on-hover, build-steps chip, ticks in the gutter, the dashed guide, the free cut, the merge affordance, the drag handle and the faint "+ Ask here" line. |
| `lib/store.svelte.ts`, `VaultBrowser.svelte`, `DocumentPane.svelte` | `docView`, the flow state, the four `segments:*` calls, the `askHere(segmentId)` stub, and the route both ways. |

**Verified in a running dev build over CDP** (own port 9333, own `--user-data-dir`, vault =
`/Users/lohzh/ChatterED/Academia`) against `A0282987E_LohZhengLucas_Critique1_slides (1).pdf`:

| Check | Measured |
|---|---|
| Opens as the flow | genre `slides`, 7 pages, 7 cards, **18 ticks** — page-for-page identical to SEGMENTS.md §7 (4/2/3/**0**/2/3/4, including the two vertical ones on pages 6 and 7) |
| No blank card | 159 in-viewport crop samples over three end-to-end passes, **0 blank**; 63 more over the 31-page Koala paper, **0 blank** |
| Hover a tick | dashed guide at `top: 218px` on a 428 px card — exactly `offsetFromNorm(0.510)` |
| Click a tick | splits in place, 7 → 8 segments, page 1 becomes `0.000–0.510` + `0.510–1.000` |
| ⌘Z | 8 → 7, and again: `split→8, undo→7, split→8, undo→7` |
| The scroll anchor | cut on screen: `scrollTop` 1400 → 1400. Cut above the fold: 1400 → 1488, and the card under the eye stayed at **743 px, unmoved** |
| Merge | the affordance between two same-page cards merges 8 → 7; ⌘Z restores the boundary at exactly 0.510 (split and merge are inverses, live) |
| Drag reorder | `[1,2,3,4,5,6,7]` → `[2,3,1,4,5,6,7]`, ⌘Z back |
| Refused cut | a free cut on page 4 (0 ticks, 13 blocked) returns *"That cut would slice a figure…"* verbatim, inline, nothing split, cleared after ~2.2 s |
| Original pages | 8 cards → 7 full pages, segments untouched in the store, **painted on the first frame**, no ticks |
| Compare-on-hover | the source page dimmed with the segment outlined, *"Region of page 1 · nothing has been re-typeset"* |
| Keyboard | a focused tick draws its guide and **Enter splits** (landed at 0.634, page 1's second accepted cut) |
| The genre notice | the Koala paper routes to `prose`, 31 whole pages, 0 ticks, and the band says *"This document is not a slide deck — segments are whole pages."* |

Screenshots in the session scratchpad under `flow/`. The anchor's added height is **measured**
rather than assumed — `SPLIT_ADDED_HEIGHT` is the analytic value and the fallback, but a split
also brings a merge affordance into the gap, and an 18 px error is an anchor that visibly slips.

**Not in this pass:** the "+ Ask here" composer and the REFERENCE card (track C), AI cards in the
flow, the whisper popover, and cross-page merge (A2). `SPLIT_ENABLED` in `lib/flowview.ts` is the
§3.8 F1 switch and is `true`.

---

## The conversation inside the flow — Track B of `flow-build-plan.md` §3.3, §4.1 (16 Sep, issue #25)

"+ Ask here" is no longer a stub. A deck now opens as a flow of crops *and* holds the whole
conversation about them, anchored segment by segment, with no setup screen anywhere in the path.

### A room per document, created lazily

| File | What it is |
|---|---|
| `src/main/flowroom.ts` + `.test.ts` (**new**, 12 tests) | `openOrCreateFlowRoom()` — the material is keyed on `file_id` + the segment cache's own **`content_sha`**, so the second question reopens the room and an *edited* deck opens a new one. It calls `createSession()`, unchanged, with a material assembled from what the vault already knows; claims come from the ingest draft when a backend is live and from the committed fixed pack in scripted mode, chosen with `pickScriptName()`. Also `segmentText()`, and the sitting's round trip through one settings row. |
| `src/main/ipc.ts` | `flowAskHere` / `flowExplainBack` / `flowSend` / `flowMessages`; `openRoom(roomId, { opener: false })` for a flow room; `flowState` restored on open and persisted after every learner-authored action. |
| `src/main/sessions.ts` | One optional field — `CreateSessionInput.fileSha`. Every other caller still keys on the sha of the text. |
| `src/main/db/repos/core.ts`, `src/room/ports.ts` | `MessagesRepo.forAnchor` — the real SQL over migration 010's index, which `reference.ts` asked for once this file was free — and `MaterialsRepo.forFile`. |

**Four things simplified, on purpose.** (1) There is no setup screen and nothing to confirm: the
learner edits a claim by explaining it, not by editing a row. (2) A flow material is pages 1..N,
because `001_init.sql` requires a `page_from` for `pdf_pages` and the material *is* the whole
document now. (3) A REFERENCE call sees the segment's **page**, not its rectangle — the geometry
pipeline keeps its text boxes in the main process (`SEGMENTS.md` §2) and cropping properly is a
second geometry pass per question; a slide page is ~120 words, so the error is "can see the
other half of the slide", which is the safe direction. (4) The sitting is one `settings` row per
room (~1.1 KB measured), not a table.

### IPC and the renderer

| File | What it is |
|---|---|
| `shared/flowthread.ts` + `.test.ts` (**new**, 10 tests) | `groupByAnchor`, `threadFor`, `claimsForAnchor` — pure, and called by **both** sides, so the main process's view and the renderer's live recomputation cannot disagree about where a turn landed. |
| `components/AskHereLine.svelte` (**new**) | The faint line, and the single-line prompt it opens: pre-focused, `Enter` asks, `Esc` cancels and discards the anchor. |
| `components/AiSegment.svelte` (**new**) | REFERENCE / Teacher / Tester. §C4's four separations, enforced structurally: app UI font on the app ground, inset with a left rule in the speaker's colour, name + avatar in the header, and a callout rule drawn to the crop's **edge**, never inside it. KaTeX's Computer Modern is overridden — agent-written maths that looks like the lecturer's is the confusion S5 exists to prevent. |
| `components/FlowThread.svelte` (**new**) | The thread under a crop: the learner's own writing full-width and indigo (§B2's asymmetry), the reserved slot with §B9's counter and the amber ring, the lock line while a REFERENCE card is unanswered, the composer after **Explain it back →**. |
| `lib/aitext.ts` + `.test.ts` (**new**, 10 tests) | Escape first, then put back exactly two things — paragraphs and maths. Not `renderMarkdown()`: a turn is prose with notation, and marked would let a stray `#` restyle it and a stray tag reach the DOM. |
| `components/SegmentCard.svelte`, `FlowCanvas.svelte`, `lib/store.svelte.ts`, `mockBridge.ts` | The glyph strip on the label strip, the ask prompt, the thread under each card, and a mock that replays the whole shape so the renderer is drivable without Electron. |
| `shared/types.ts`, `room/views.ts` | `MessageView.anchorId` and `byRule`, and **a new `'reference'` speaker kind**: `messageView()` was mapping the reference participant — `kind = 'agent'` with a null `agent_key`, which is how the schema says *not an agent* — to `{ kind: 'student' }`, i.e. the machine's 120-word answer wearing the learner's face. |
| `room/actor.ts` | `sendMessage(text, anchorId)`; `#runAgentTurn` carries the anchor onto the hand-off line and the reply; `referenceLocked` asked per anchor; a silence nudge lands in the thread the learner was last in, because a flow has no bottom of the page; `flowSnapshot()` gained the REFERENCE answers so the lock survives a relaunch. |

**Verified live over CDP** (own port 9334, own `--user-data-dir`, vault = `/Users/lohzh/ChatterED/Academia`,
backend `scripted`) on `A0282987E_LohZhengLucas_Critique1_slides (1).pdf`:

| Check | Measured |
|---|---|
| Tick click on page 3 | 7 → 8 segments; `/btw as a whisper` + `“Yeah, I cannot see` |
| "+ Ask here" | prompt opens **pre-focused**, `⏎ ask · esc cancel`; `Esc` restores the line and discards the anchor |
| The REFERENCE card | **3.4 s** from Enter (`Looking it up…` in between), anchored to the lower segment, `REFERENCE`, **100 words**, the rule, the hand-back line, **Explain it back →** and **✕ Remove**, in the app's UI font (`-apple-system…`) |
| Ledger after the card | **0 glyphs** — nothing you read moves a row |
| **Explain it back →** | card collapses to one line, buttons gone, lock line gone, composer opens **focused** on the same anchor |
| The Teacher's thread | two learner turns → two replies, `MAX · TEACHER` with the callout rule; glyphs on the card's strip go `○ ○` |
| The hand-off | fired on the 4th learner turn, once the 3-min freshness floor had passed: **`MAX · TEACHER` `BY RULE` — "You've covered what /btw can and cannot do and the forwarding gap — Ellie, over to you."** |
| The Tester | `Ellie is thinking…`, counter climbing (caught at **8 s**, replied at ~10 s), ringed avatar, dashed amber rule, one question |
| The quiz feedback turn | landed after the answer; glyphs move `● ◐ ◐` (C1 **defended**) |
| ⌘K in the flow | unbound — 0 whisper nodes; the popover is Friday |
| Close and reopen the document | 8 cards, **14 messages restored**, glyphs still `● ◐ ◐`; every message anchored, none room-level |
| The persisted sitting | one settings row, **1094 bytes**: the session, 2 taught items, the pending quiz with `feedbackGiven`, and the answered REFERENCE card |

Screenshots in the session scratchpad under `flow/`, numbered from 10.

**Two bugs the live run found, both fixed** (`326809d`). The scripted client was answering the
Critique 1 deck with the PSD/Hessian script — a REFERENCE call carries one segment of one slide,
page 3's lower half contains `/btw` and nothing else, and `scriptNameForRequest` needs two
markers; `openRoom` now passes the material and the client is **pinned**. And `roleWord()` in the
renderer still said *peer* / *challenger* while `ROLE_LABEL` said *teacher* / *tester* since #32.

**Not in this pass.** The whisper popover and `⌘K` (Friday, §3.5). The off-screen breadcrumb chip
of §B9 device 3 — the thread shows a line in its foot instead, and R2 guarantees there is at most
one held turn to point at. The `DEMO` flow profile in `flow.ts` is still not selectable in
Settings, so the hand-off waits out the real 3-minute freshness floor; that is a filming-day
concern and it is one wire from `RoomActorDeps.flowProfile`. `flow:messages` returns thread ids
only and the renderer regroups live — there is no second copy of the transcript anywhere.

**Two lint errors predate this work** and belong to the Teacher/Tester track: `#lastMessageIdByRole`
in `actor.ts` and the `ROLE_LABEL` import in `prompts.ts` are both unused at `e8f3d78`. Left alone
rather than edited under another agent.

---

## Ellie teaches, Max tests — the pairing pinned, the pacing disclosed (16 Sep, #32, #33)

Four fixes the flow build left behind, each its own commit.

### 1. The roster pairing is pinned (`30500aa`, swept in by a concurrent `commit -a`; `361df91`)

`rosterFor()` drew the role–name pairing at install (#16) as a study control against confounding
role with gender. That control belonged to the **group framing**, which #32 deleted. What is left
is a two-agent flow whose copy names its agents out loud, and a coin flip made half of all
installs read **`MAX · TEACHER`** under an *"Ellie, over to you"* hand-off, with the Tester's own
question saying *"Ellie had you on page 6"* — the Teacher quoting herself as somebody else. That
is what this install actually rendered on 16 Sep, and it is in the table in the previous section.

- `PINNED_PAIRING = 'ellie_peer'`; `randomPairing()` is gone. `AppService.pairing()` **rewrites**
  a stored `ellie_challenger` on the next launch, so old installs correct themselves.
- **No migration of room data, and none needed**: the names are in no frozen `prefix_sha256` —
  `sharedBlock()` dropped the cast list with the group framing — so the hash does not move.
- A room played *before* the pin keeps the names it was played under. `messageView()` falls back
  to the room's own `participants.display_name` for an `agent_key` the live roster no longer
  contains, with the role from the key's prefix. Without it the old room's agent turns fell
  through to `{ kind: 'student' }`, which is the REFERENCE defect of `b6bbbbb` all over again.
  `views.test.ts` (**new**, 4 tests) pins that; this install's own database still holds a
  `peer.max` room to be wrong about.
- **Nothing spells a name any more.** `handOffLine()` takes the roster, not two name arguments a
  caller could swap. `script.critique1.ts` writes `{teacher}` / `{tester}` and `ScriptedClient`
  fills them from the roster the room is running (`agents.fillAgentNames`), asserted both ways.

### 2. Lint is clean (`52850be`)

`#lastMessageIdByRole` was the deleted disagreement marker's helper, not the relay's; the
`ROLE_LABEL` import in `prompts.ts` went unused when `roleBlock()` started reading the profile.
`npm run lint` exits 0, `svelte-check` 0 errors.

### 3. Tester pacing is a setting (`895878e`)

Settings ▸ **Tester pacing** offers **Study** (the `FLOW` constants) and **Demo**, default Study,
one `flow_profile` row, handed to the actor at `openRoom` and applying to the next document.
`DEMO` also lowers `minAgeMs` to **20 s** — `flow-session.md` §3.2/§8.3 argues that constant in
one direction only (never *raised*), and from a cold sitting it is the only thing between two
taught concepts and a hand-off.

> **The conflict this creates, said out loud.** §2 beat 10 narrates *"minutes old, not seconds"*,
> and `critique1Sitting()` seeds a warm-up so the Tester lands on a concept taught four minutes
> ago. At 20 s the concept Ellie teaches at beat 9 becomes eligible and **wins `pickTarget` for
> being fresher and less demonstrated** — the live run below picked `C3`, the thing just taught,
> while the scripted question is written about `C1` on page 5. A real backend generates its
> question for the target it is given, so the mismatch is a scripted-mode artefact; the *target
> choice* is not. The take therefore pins `CRITIQUE1_TAKE` (= DEMO with the guard back at
> `MIN_AGE_CAP_MS`) and the storyboard is unchanged. **If filming ends up cold rather than warmed
> up, beat 10's narration is the line that has to change.** Lucas's call.

### 4. The first-open pacing strip (`98ae8b4`, `cd2e84b`)

§3.5's disclosure, rescued from the dead round card: the reply hold is deliberate (with Tan et
al. and the real counter), the Tester is invoked by a **rule spelled out in the active profile's
own numbers**, which profile is running, and — when the backend is scripted — that the words are
replayed while the timer, the rules and the ledger are real. Names off the live roster. Dismissed
per install in one settings row; **Settings ▸ Tester pacing ▸ "Show the pacing note again"**
clears it. Settings and the strip read one copy module (`labels.PACING_PROFILES`), asserted
against `flow.ts`'s constants — the failure mode here is two surfaces describing one setting
differently, not a crash.

### Verified live over CDP

Own port 9335, own `--user-data-dir`, vault = `/Users/lohzh/ChatterED/Academia`, backend
`scripted`, on `A0282987E_LohZhengLucas_Critique1_slides (1).pdf`. The dir was seeded with
`role_pairing = ellie_challenger` to make the migration do work.

| Check | Measured |
|---|---|
| The stored pairing corrects itself | `ellie_challenger` → **`ellie_peer`** on the first launch, before any room opened |
| The headers | **`ELLIE · TEACHER`** on every Teacher turn, **`MAX · TESTER`** on the quiz |
| The hand-off names the Tester | **"You've covered what /btw can and cannot do and the forwarding gap — Max, over to you."**, `BY RULE` |
| The quiz names the Teacher | **"Ellie had you on page 6, but the evidence is back on page 5…"** — filled from the roster, not the script |
| Demo hands off inside a minute | second concept taught 01:26:22.27, hand-off line 01:27:14.60 — **52.3 s**; Max's question 11.7 s later, inside Tan's band |
| The rule that fired | `rule:handoff`, `move_type = quiz`, on the DEMO profile persisted in the sitting (`minAge 20 s, k 2, m 3 min`) |
| The target it picked | **`C3`** — the fresher concept, as §3 predicts and the shipped profile would not have allowed |
| The strip, first open | shows above the first card, four paragraphs, names Study and the scripted backend |
| Dismiss | gone; `pacing_strip_seen = 1`; **not shown again** after a reload and a reopen |
| Re-open from Settings | the row is cleared, the button reads *"The pacing note is showing"*, and the strip returns on the next open — reading **Demo**, with the demo rule spelled out |

Screenshots in the session scratchpad under `flow/`, numbered from 20. Tests 491 → 521 green.

**Not verified live:** that Study does *not* hand off inside a minute — that is the fake-clock
pair in `flow.test.ts` (the same 55-second sitting, `r1_engagement` and `r3_maturity` by name),
because waiting out the shipped floor live is what the previous section already measured.

---

## Ask privately — the whisper popover on a card (16 Sep, `flow-build-plan.md` §3.5, issues #25, #16)

**The whisper moved from a rail into the document.** `⌘K` on a focused segment card — and a faint
**🔒 Ask privately ⌘K** in the same card's label strip, because a gesture with no visible handle
is a gesture only its author knows about, and the person `design-brief.md` §D5 wrote this for is
the one least likely to have read a shortcut list. `App.svelte` stands its finder binding down
while `store.flowFocus` is set, the sentence it already writes for a room.

### What a "round" became

`design-brief.md` §D5 clears a whisper **at the end of the round** (Dennis et al., *ephemerality*).
A flow has no rounds, so the unit is the **segment sitting**, and the private thread id is keyed on
`${flow session id}|${anchorId}` in an in-memory map that is deliberately **absent from
`flowSnapshot()`**. Three consequences, all of them the point: ⌘K on another card opens an empty
thread; a sitting that closed while the app was shut (`flow.ts`'s 20-minute gap) takes its private
threads with it; and quitting ends every one of them. Rows are never deleted — they stay in
`whispers` for the research export and become *unreachable*, which is the shape `whisper.cleared`
already had.

| File | What it is |
|---|---|
| `components/WhisperPopover.svelte` (**new**) | Anchored **under** the card, never over it: §4.1's never-rule holds for a popover as it does for an AI card, which is why the caret points up. `Esc` and click-away close it. The vocabulary is `WhisperPane.svelte`'s — the lock, "Private with Ellie", "Max can't see this", the limits statement first — and the insert ladder is `RelayOffer.svelte`'s offer → preview → edit → sent, with one verb changed: in a document you *insert into the document*. |
| `room/actor.ts` | `openSegmentWhisper` (Ellie resolved from the **room's own participants**, so the renderer cannot name an addressee and a room created under another pairing still opens), `sendSegmentWhisper`, `closeSegmentWhisper`, `noteSelection`; `relay()` gained an `anchorId` so the approved card lands in the segment's thread; `handOffDue`'s `whisperOpen` wired for the first time. |
| `room/context.whisper.ts` | An optional `segment` — **the same page text `flowAskHere` gives the REFERENCE call**, resolved once in `ipc.#segmentContext` so a private answer and a public one cannot be looking at different slides. It goes in `messages`, never `system[0]`: the prefix is frozen and hashed at confirmation, and a per-segment block there would invalidate every cached prefix on every ⌘K. |
| `main/ipc.ts`, `shared/ipc.ts`, preload, `mockBridge.ts` | `flow:whisperOpen` / `whisperSend` / `whisperRelay` / `whisperClose`, and `flow:selection`. `flow:whisperOpen` **creates the document's room** the way "+ Ask here" does: refusing to open one until a public question had been asked would make the private channel the second-class one. |
| `room/timer.ts` + `.test.ts` (7 new) | §B8's idle predicate. `isIdle` / `lastActivityTs` are pure; `onSelectionChange()` is a second caller of the extension path `typing()` already used (now `#extendWindow()`). **There is no field for scroll** — that is the enforcement, not a comment. The machine and its constants are untouched. |
| `room/context.test.ts` | The canary, extended three ways — see below. |

### The leak canary, extended and not relaxed

The flow's component walk was a blanket ban on the word *whisper*. It is now an **allowlist of what
a component may say**: `WhisperPopover.svelte` is exempt, and everywhere else a line may name the
layer only to mount the popover, to pass a `flowWhisper*` store field through, or to print
`promotedFromWhisper`, which is a field of a *shared* message. A second test asserts no other flow
component reads `.turns`. A third describe block is **runtime, not static**: it plants the canary in
a real private whisper on a real actor and looks for it in both agents' group prompts, the REFERENCE
request, the room snapshot, the persisted sitting and `flow:messages` — then relays, and asserts the
approved text is in the document and the canary still is not.

### Dual attribution, and a deliberate departure

`MessageView.promotedFromWhisper`'s docstring said the UI **must not** render a badge
(`product-design.md` §B4). The flow prints one — `FROM A PRIVATE NOTE`, in `FlowThread` for a
learner-authored card and in `AiSegment` for Ellie's — and the docstring now says why. A chat message
scrolls away; a card in a document is the artefact `pivot-spec.md` §B5 says the learner would show a
tutor, and a sentence they re-read in a week should say where it came from. It says *that* a private
note happened, never what was in it, and **no agent's prompt carries the line**: the group builder
reads `body` and nothing else.

**Verified live over CDP** (own port 9336, own `--user-data-dir`, vault = `/Users/lohzh/ChatterED/Academia`,
backend `scripted`) on `A0282987E_LohZhengLucas_Critique1_slides (1).pdf`:

| Check | Measured |
|---|---|
| The affordance | `🔒 Ask privately ⌘K` in every card's label strip, faint until hover or focus; clicking it opens the popover on that card |
| ⌘K on a focused card | popover opens **anchored 6 px under the card**, `overlapsCrop: false`, composer **pre-focused**, and the vault finder does **not** open (0 finder nodes) |
| The limits line | first thing in the pane, verbatim: *"I can see the group chat and explain background bits, but I won't answer Max's question for you — and nothing here reaches him unless you send it."* |
| The private answer | **1.35 s** from Enter — inside the shipped 1–2 s whisper floor, and visibly shorter than any agent's |
| The flow while it is open | 0 occurrences of the private question or answer anywhere in `.scroll` with the popover subtree removed |
| **Insert into the document** | offer → preview shows `You` · `FROM A PRIVATE NOTE` with the draft from the script's `relayOffer`; approving inserts a shared card **under the same segment** (`underSegment: seg_…6hulf`) |
| The inserted card | the approved text only; the private question does not appear in the flow |
| Ledger after the insert | **0 glyphs** on that card — R5 live: nothing said privately, relayed or not, moves a row |
| `Esc` / click-away | popover gone, card unchanged |
| ⌘K again, same card, same sitting | the same 3 turns |
| ⌘K on another card | **1 turn** — the limits line, and nothing else |
| Close and reopen the document | 0 popovers, 0 occurrences of either private turn, **the inserted card still there with its provenance tag** |
| §B9 off-screen breadcrumb | scrolling away while Ellie is typing docks one chip, `↑ your private note · p.6`, centred on the flow pane; it disappears when the answer lands |

Screenshots in the session scratchpad under `flow/`, numbered from 30. Tests 507 → 520 green.

**Five bugs the live run found, all fixed** (`fc41e11`), and every one invisible to the suite
because the suite builds its own room: the whisper resolved its counterpart by roster *key* while a
room keeps its participants for life, so ⌘K threw on any deck opened before the pairing last changed
— the shipped pane had the same latent bug and gets the same fix; ⌘K on a second card closed the
popover instead of moving it; the breadcrumb was `position: sticky` inside the scroller and so only
appeared once you had scrolled to the end of the deck; a private answer was the one place in the app
rendering raw `**` markers; and the foot line said *"clears when you leave this card"* when it in
fact clears with the sitting.

**Not in this pass.** `aiBody()` restores paragraphs and maths and **not bold**, app-wide — so the
Critique 1 whisper beat's `**no**` and `*and*` show their markers in the popover exactly as they
would on a REFERENCE card. The honest fix is one line in `script.critique1.ts` (drop the markers from
`CRITIQUE1_WHISPERS[0]`), and that file belongs to the roster track, so it is left alone. `⌘K` is
bound to the *focused* card only; there is no "whisper about the whole document" entry point, and
`pivot-spec.md` §B5's addressee segmented control is gone on purpose — #32 removed the second option
by removing the group, and a private channel to the Tester is the one shape this must not have. The
selection-change wiring is asserted by fake-clock tests rather than live: watching a 45-second window
not fire is not something a CDP run can show in a screenshot.

---

## The fallback gate, run early — beats 4–15 twice, no restart (16 Sep, `flow-build-plan.md` §3.4, §3.6, issue #23)

**Verdict: G1, G2 and G3 all pass. No fallback.** §3.8's F1 and F2 are not taken; `SPLIT_ENABLED`
stays `true`. Two fixes were needed to get there and each is its own commit.

**How it was driven.** The **installed app** (`~/Applications/ChatterED.app`, build 72, `ccc5b9d`),
launched with `env -u ELECTRON_RUN_AS_NODE open -n ~/Applications/ChatterED.app --args
--remote-debugging-port=9340 --user-data-dir=<fresh>` — the packaged binary honours both flags, so
no `npm run dev` was needed. A **fresh profile**, so first run, the vault and the pacing strip are
part of the run: onboarding → *Skip — use the scripted demo* → **Choose a folder…** (a native macOS
open panel, driven over the accessibility API, because CDP cannot reach it) →
`/Users/lohzh/ChatterED/Academia` → Settings ▸ **Scripted demo** + Tester pacing ▸ **Demo**. Deck:
`A0282987E_LohZhengLucas_Critique1_slides (1).pdf`. `Runtime.consoleAPICalled` and
`Runtime.exceptionThrown` captured for the whole session. Screenshots and `gate.log` in the session
scratchpad under `gate/`, numbered by beat and run.

### The three gate criteria

| | Criterion | Evidence |
|---|---|---|
| **G1** | A tick click splits in place and ⌘Z restores it, twice in a row, no blank card, no re-render flash, surviving a relaunch | **4 cycles** (two per run): split **2–4 ms**, ⌘Z back **4–20 ms**, `scrollTop` **unchanged**, the page-3 card's viewport top **255 → 255 → 255** and **355 → 355 → 355** (max move **0 px**), **0 blank crops** sampled at each card's centre. Close and reopen restored 8 and then 9 segments. |
| **G2** | A complete Teacher → learner → Tester → learner exchange of ≥ 6 turns in one segment's thread through the real actor, twice, no restart | **12 turn nodes** in run 1's thread and **23** by the end of run 2 — `You → REFERENCE → You → Ellie → You → Ellie → (nudge) → You → Ellie BY RULE → Max → You → Max`. Every turn anchored to the one segment; `flow:messages` still returns ids only. |
| **G3** | *Ask here* inserts a REFERENCE card that provably cannot move a ledger row, and the whisper leak canary still passes over the flow renderer's import graph | REFERENCE **100 words** against the 120 cap, in `-apple-system`. Ledger across the card: `[]` → `[]` (run 1) and the identical triple (run 2) — **unchanged both times**. Whisper: **0** occurrences of the private question or of Ellie's private answer anywhere in `.scroll` with the popover subtree removed, in both runs and again after close-and-reopen. `npm test` **521 green**, canary included. |

### Every beat, both runs

| Beat | Run 1 | Run 2 | Measured |
|---|---|---|---|
| 4 open the deck from the vault | PASS | PASS | **2.6 s**, 7 cards, **18 ticks** `[4,2,3,0,2,3,4]` — unchanged from the SEGMENTS.md §7 table |
| 4b the first-open pacing strip | PASS | n/a | four paragraphs, the **Demo** numbers, dismissed once per install as designed |
| 5 ticks on page 3, hover | PASS | PASS | 3 ticks; the dashed guide at `top: 229px`, the 0.535 cut the script names |
| 6 split in place, ⌘Z, twice | **PASS** | **PASS** | see G1. **One fix** — `8c049eb` |
| 7 + Ask here | PASS | PASS | prompt opens **pre-focused**, 0.6 s |
| 8 REFERENCE card | PASS | PASS | **2.4–3.1 s**, 100 words, 0 rows moved |
| 9 Explain it back → Ellie | PASS | **FAIL** | **4.3 s** and the scripted teach turn in run 1. In run 2 the learner cues are exhausted, so Ellie has nothing scripted to say and the learner waits **50 s** for a silence nudge instead. Not fixed — see below. |
| 10 the hand-off, by rule | PASS | PASS | **67 s** from the second learner line, and it needed **one spare learner turn plus a 22 s wait**. `BY RULE`, *"You've covered what /btw can and cannot do and the forwarding gap — Max, over to you."* |
| 11 the Tester's question | PASS | **PASS** | **9.6 s** / **9.8 s**, inside Tan's band; the counter caught mid-hold at **`Max is thinking… 7s`**. **One fix** — `ccc5b9d` |
| 12 the ledger moves | PASS | PASS | **10.2 s** / **10.6 s**. `C1 … defended`, `C3 … justified`, then `C2 … justified` in run 2 |
| 13 ⌘K whisper → insert | PASS | PASS | private answer **1.6 s**, popover **below** the crop (`overlaps crop false`), **0** finder nodes, **0** `**` markers (`b395ad7` holds), 0 leaked strings, and a shared card headed `You · FROM A PRIVATE NOTE` |
| 14 Original pages | PASS | PASS | **11–16 ms**, 8/9 cards → 7 whole pages, 0 ticks, and back |
| 15a compare-on-hover | PASS | PASS | 1.8 s, *"Region of page 1 · nothing has been re-typeset"* |
| 15b a non-slide PDF | PASS | PASS | the Koala paper, **31 whole pages**, 0 ticks, *"This document is not a slide deck — segments are whole pages."*, in **3.2–3.4 s** |
| close and reopen | PASS | PASS | **4.0 s**; segments, thread and the inserted card with its provenance tag all back, glyphs intact, **0** popovers, **0** private strings |

**Console errors and exceptions across every run: none.** `Runtime.exceptionThrown` never fired and
no `console.error` was emitted.

### The two fixes

1. **`8c049eb` — beat 6's anchor measured from the wrong origin.** `cutTopOf()` and `onmerge()`'s
   seam read `offsetTop` on `[data-segment]`, which was scroller-relative until Friday's whisper
   popover gave `.cardwrap` `position: relative` so a popover could be anchored to its card. That
   made the cardwrap the offset parent and `offsetTop` read ~0 for every card, so **every** cut
   looked as if it were above the fold and the scroller shifted by a card's chrome. Measured before
   the fix: a tick click moved the card under the eye from viewport y **355 to 267**. An 88 px jump
   on the one beat whose claim is *"that was a number changing, not a re-render"*. A rect difference
   has no offset parent to be wrong about. This is an **integration seam between the flow-renderer
   track and the whisper track**, invisible to both suites.
2. **`ccc5b9d` — beat 11 went silent on the second walkthrough.** `actor.ts` cues the Tester as
   `handoff:N` where N counts the *actor's* hand-offs, and a flow actor lives for the life of the
   process — reopening a document resumes the sitting, which is right. The second pass reached
   `handoff:3`, which the script did not answer, so the camera saw Ellie's `BY RULE` line and then
   **nothing at all**. `handoff:`/`feedback:` cues now fall back to the last scripted question of
   the same kind, the convention `referenceBeatFor` and `whisperBeatFor` already use. Safe to repeat
   *only* because no hand-off beat carries a `ledger` block; a test pins that, and pins that
   `student:N` does **not** fall back.

### What the presenter must know on filming day

1. **Film a cold open, not a warm-up** — *and the 13 ms half of this is now fixed.*
   `script.critique1.ts`'s `critique1Sitting` docstring says *"the presenter does a short warm-up
   on the same deck before the take"*. Measured here, that made beat 9 impossible: after a quit
   and relaunch onto a sitting that already has two taught concepts, the **hand-off fired on the
   very first learner turn in 13 ms** — Ellie never taught, she went straight to *"Max, over to
   you."* The cause was not R1 misbehaving: the previous run's taught set **and** its turn
   timestamps were both still inside the Demo profile's three-minute window, so k-in-m was
   satisfied before the learner had said anything this time round. k-in-m is a rate, and a rate
   cannot express *"and not again immediately"*. **R1b** (`flow.requiresTurnsSinceHandOff`) adds
   the missing clause on the **Demo profile only**: ≥ k learner turns *since the last hand-off*,
   counted strictly after it, with `r1_since_handoff` as its own `reasons[]` entry and
   `learner_turns_since_handoff` logged raw on `flow.state.changed`. A second walkthrough in one
   sitting therefore teaches again before it quizzes. The **study profile is unchanged** — its
   10-minute window against a 20-minute gap does not reach the pile-up, and adding a rule there
   to fix a demo pacing artefact would change what §11's logs mean for A2; the raw count is
   logged on both profiles so §11 can decide later whether to promote it. What still needs
   Lucas's call is only the *narration*: `flow-build-plan.md` §4.4 and that docstring still say
   warm-up, and beat 10's *"minutes old, not seconds"* is a cold-open line now.
2. **Beat 10 costs a spare turn and about 90 seconds.** From a cold open on Demo the hand-off needs
   a *third* learner line and ~20 s of quiet after the second concept is taught (Demo's 20 s
   `minAgeMs`). `CRITIQUE1_LEARNER_LINES`'s `student:4` spare is what the gate used.
3. ~~**A consequence of 2: the ledger moves one beat early.**~~ **Fixed.** By the time Max's
   question landed, `C1` was already **defended** and `C3` **justified** — scored on the spare turn,
   because the ledger blocks are keyed to the learner-turn ordinal. Beats 9 and 10 now propose *no
   element at all* and their learner lines are questions, so the two rows that move are the two the
   answer to Max moves, and `ledger_history` is empty until then. Re-time the ordinal and nothing
   can be scored early, because there is nothing left before the probe to score.
4. **Pause for ~45 s and Ellie nudges.** *"Still turning it over? Happy to wait."* / *"Take your
   time. If it helps, say the bit you're sure about first."* The silence timer is real and it will
   speak over a slow take.
5. ~~**One take per sitting.**~~ **Fixed.** A second pass in the same session completes (fix 2),
   and Ellie no longer stops teaching once the learner cues run out: `student:N` **cycles** over the
   teaching beats, filtered to those that propose no ledger element, so a repeat can never move a
   row twice. Beat 9 on a second walkthrough is a Teacher turn again rather than a 45 s silence
   nudge. Note 1 still governs *what to open*.
6. ~~**Copy drift, no code change.**~~ **Fixed — it was a code fix after all.** The app said
   **`Max is thinking… 7s`**; §2 beat 11, `pivot-spec.md` §B9 and `FlowThread.svelte`'s own
   docstring all say *"Max is reading…"*. §4.2's cell claimed `VERB` was unchanged **and** that
   Max "still reads", so the freeze was never the point — the code was the half that was out of
   step. `VERB` is per role and the Tester's is now `reading`; Ellie still *types*, which §B9 is
   equally explicit about. `product-design.md` §C3's older `Max is thinking…` is superseded for
   the flow by §B9, which cites §C3 and extends it: what Max does first is read your region.
7. ~~**First-run step 1 still describes the group.**~~ **Fixed.** *"you explain … to a small
   group … they'll disagree with each other … a ledger on the right"* — three claims #32 and the
   pivot removed, on the first screen the camera sees if the take starts from a fresh install.
   Card 1 is now the flow: the deck opens as crops of the rendered page, Ellie explains a card
   when asked, she hands off to Max who asks one question and never answers it, nothing is
   written where you did not ask, and only your own words move the ○ ◐ ● beside a card. Cards 2
   (which backend) and 3 (open the vault) are untouched.
8. **The vault chooser is a native panel.** Not reachable from inside the app and not scriptable
   over CDP; on camera it is ⌘⇧G and a path, or three clicks.

**Not covered by this gate.** Beats 1–3 and 16 need no app. The free-cut drag, same-page merge and
drag reorder were exercised by last night's run, not this one. `undo()` still applies no scroll
anchor of its own — with fix 1 a cut on screen needs none, and a cut above the fold is not in the
storyboard. The §3.6 requirement of **five** storyboard runs on Saturday is still outstanding; this
was two, plus a third partial that established note 1.

## The submission ZIP — §3.6, verified 16 Sep 2026

`tools/make-submission-zip.sh` (repo root, not `app/tools/`) builds
`dist/ChatterED-A1-<short-sha>.zip` from the index at `HEAD` and refuses to run on a dirty tree.
**Allowlist, not exclude list:** every path is named in the script and enumerated through
`git ls-files`, so nothing untracked (`node_modules`, `dist`, `out`, `.vite`) and nothing
git-ignored (`.env`, `*.key`, `*.pem`, `*.p12`, `*.local.*`, `.claude/settings.local.json`) can be
swept in, and `.git` is never walked; a `find` over the staged tree then refuses anything secret-
or build-shaped. `Academia/` contributes **one** folder — `Sources/btw interaction/`, Lucas's own
Critique 1 deck, so the vault has something to open — and the script asserts nothing else from it
arrived; the source papers are not ours to redistribute. `app/README.md` ships in place *and* at
the archive root. §2's storyboard is extracted from the plan by the script itself, so
`docs/report/video-storyboard.md` cannot drift from the brief that owns it.

**Measured on this Mac**, from `7df8612`: **2.8 MB**, 235 entries, 205 tracked files plus the two
generated ones. Unzipped into an empty directory on another path, `npm ci` took **4.0 s** (warm
npm cache — a cold cache on a marker's machine will be slower; `better-sqlite3` rebuilt for
Electron 44's ABI as part of `postinstall`, from a prebuilt, not from source) and `npm test` ran
**526 tests in 36 files, all passing, in 1.30 s**. The archive's `README.md` is byte-identical to
`app/README.md`, and `grep` over `unzip -l` finds no `.git`, no `*.local.json`, no key file, no
`node_modules` and no build output. **Not verified:** opening it on a *different* machine, which
is what §3.6's gate actually asks for.

## The log — added 16 Sep 2026, after the room_6a9609d5c6fb silence

**Where.** `~/Library/Logs/ChatterED/main.log` (`app.getPath('logs')`). JSON lines, one object
per event. Rotates at **4 MB**, keeping `main.1.log` … `main.4.log` — bounded at 16 MB forever.
Level from `CHATTERED_LOG_LEVEL` (`debug|info|warn|error`, default `info`), so a debugging
session is `CHATTERED_LOG_LEVEL=debug open -a ChatterED` with no rebuild. Settings ▸ Diagnostics
has **Open log folder** and **Copy diagnostics** (version, build, backend, models, CLI path, and
the last 50 lines).

**Why not `electron-log`.** Three runtime dependencies is the whole bundle and the app is
installed unsigned by a hand-rolled script, so each addition is another thing inside it nobody
has read; `electron-log` formats through a template where what is wanted is a *record*, greppable
with `jq`, with a correlation id on every line; and the one feature that would have justified it
— rotation — is twenty lines. `src/main/log.ts`, ~200 lines, no dependency.

**Every line.** `ts` (ISO), `level`, `event`, `turn` (the correlation id, when inside a turn),
`v` (app version), `packaged`, `room_id`, then the event's own fields.

| event | fields |
|---|---|
| `app.start` / `app.quit` | electron, node, platform, level |
| `turn.start` | trigger, anchor_id, silence_stage, consecutive_agent_turns, backend |
| `orchestrator.request` | model, backend, trigger, anchored |
| `orchestrator.response` | model, backend, **ms**, since_turn_start_ms, **parsed_ok**, decided_by, speak, **chosen_role**, move_type, target_element_id, failure |
| `llm.request` | scope, model, backend, agent_key, system_chars, prompt_chars, turns, **cache_breakpoints**, max_tokens, json_schema |
| `llm.first_token` | scope, model, ms |
| `llm.stream.chunk` | scope, chunks *(count only, `debug`)* |
| `llm.complete` | scope, model, backend, ms, ttft_ms, chunks, reply_chars, usage, cost_usd |
| `llm.error` | scope, model, backend, ms, **class**, cause *(stderr tail, capped 400)*, **exit_code** |
| `ledger.request` / `ledger.applied` / `ledger.error` | model, backend, ms, **parse_ok**, proposed, changed, **gates**, skipped, inside_hold_ms |
| `turn.dispatched` | role, agent_key, move_type, decided_by, model, backend, latency_target_ms, ttft_actual_ms, total_ms, reply_chars, usage |
| `turn.failed` / `turn.retry` | kind, failure_id, anchor_id, reason, detail |
| `timer.fired` / `timer.armed` / `timer.held` | stage, late_by_ms, cause, epoch, reason |
| `ipc.error` | channel, class, cause |
| `renderer.error` | kind, class, cause, source, line |
| `process.uncaught` / `process.unhandled_rejection` | class, cause |

**What is never in it.** No message body, no prompt, no system block, no page text, no API key.
`redact()` drops ~30 forbidden keys by *name* (`body`, `text`, `prompt`, `evidence`, `rationale`,
`apiKey`, …) and keeps only `<key>_chars`; every other string is capped at 300; any `sk-ant-…`
token is scrubbed out of **every** string, not only out of a field called `key`. The one
free-text field that ships is `cause`, which is the child process's own stderr tail, capped at
400 — hence the blanket key scrub. `src/main/log.test.ts` asserts all of it, modelled on
`actor.test.ts`'s "writes an event stream with no message bodies in it" (evaluation-plan.md §7.2).

**Reading one turn back:**

```sh
jq -c 'select(.turn=="turn_7")' ~/Library/Logs/ChatterED/main.log
jq -c 'select(.event=="orchestrator.response") | {ms, parsed_ok, chosen_role, decided_by}' …
```

## The room_6a9609d5c6fb silence — fixed and verified live, 16 Sep 2026

**What happened.** Build 78 (`523bd53`), installed app, live CLI backend, the real 58-page
CS4246 deck. The learner asked *"So manhattan distance is not admissible, while straight line is
admissible?"* at 02:30:33. At 02:30:38 `progress.update {"parse_ok":false}`. At 02:30:53 a
`turn_decisions` row with trigger `student_message`, move `correct_misconception`, target
`admissible-heuristics`, a rationale naming the exact error — and `chosen_participant_id` **NULL**,
which downstream means deliberate silence. No turn was dispatched. The silence timer was re-armed
and fired at 02:31:38 and 02:32:29, posting the *same* pool nudge twice.

**Four root causes.**

1. **The role vocabulary was never translated.** `decideTurn` accepted only the stored strings
   `peer`/`challenger`; every word the model reads says Teacher and Tester. Anything else — a
   name, a missing field, a bare `null` — became `role = null`, which collapsed `speak` and threw
   an already-made decision away.
2. **The call should not have happened.** By the time control reaches the model the answer is
   forced: the Tester has only two rule-doors, silence is wrong when the learner has just asked,
   and §B1 says the thread is the Teacher's. `rule:teacher_answers` says so in code.
3. **The ledger had no schema and no instructions**, so it failed on *every* live turn; the rail
   has never moved outside the scripted client. That is the `parse_ok:false`.
4. **Failure was indistinguishable from silence** at the end of `#runAgentTurn`, so nothing was
   shown and the timer nudged on top of the outage.

**Orchestrator latency, measured.** Before, on the CLI at this room's prompt size: **17.1 s and
20.0 s** on `sonnet`, 12.6 s and 39.6 s on `haiku` — the cost is 0.9k–3.8k output tokens of
reasoning before the object, not the prompt and not process start-up, so haiku is not the fix.
After: **0–4 ms**, no model call.

**Verified live on build 86 (`1cded6f`)**, installed by `npm run install:local -- --force`, CLI
backend, driven over CDP against `CS4246/Lecture-complex v4.0.pdf` (59 segments, never copied
into the repo). *Ask here* → *Explain it back* → the same learner message:

```
turn.start            trigger=student_message anchor=seg_mu3he86g65558u backend=claude-cli
orchestrator.request  model=sonnet backend=claude-cli anchored=true
orchestrator.response ms=1 parsed_ok=true decided_by=rule:teacher_answers chosen_role=peer move=respond
llm.request  scope=group  system_chars=15090 prompt_chars=2308 cache_breakpoints=2
llm.complete scope=group  ms=4060 ttft_ms=1699 reply_chars=460 model=claude-sonnet-5
turn.dispatched       role=peer move=respond decided_by=rule:teacher_answers
                      latency_target_ms=5249 ttft_actual_ms=1699 total_ms=5254
ledger.request        model=sonnet elements=5
ledger.applied        ms=28030 parse_ok=true   ← off the critical path
```

Ellie replies, once, in the right thread. `turn.dispatched.total_ms` **5254**, against 28 777 ms
on the first post-fix build, when the turn still awaited the ledger — see the commit that stopped
it. No `turn.failed`, one `agent.thinking` (the wait has a location before it has content, §B9).
`grep -ci 'manhattan|admissible|straight line' main.log` → **0**; `grep -c sk-ant` → **0**.

**Not verified live.** (a) The failed-turn **card and its Retry** — covered by six tests driving
the real `RoomActor` against a failing client, but an attempt to force a live failure by pointing
Settings at a broken binary did not reach the actor, because `openRoom` reuses an actor that is
already open for that room and the client is bound at construction. That is itself worth an issue:
a backend change in Settings does not take effect until the room is reopened. (b) The **stage-1
nudge rotation** in a live room (unit-tested only). (c) The **ledger actually moving a row** — it
now parses, but both live proposals were held by the confidence and evidence gates, so no ○→◐
transition has been seen against a real deck yet. (d) Token *streaming* to the UI: there is none
by design — the reply is buffered and released at the latency floor, and the thinking indicator is
what fills the wait.

---

## The conversation layer, against mature chat UIs (16 Sep, `cui-standards-audit.md`, issue #34)

**The renderer half of the audit's P0 + P1 + P2, in full.** The owner's complaint on a real
58-page deck — *"quite difficult to gauge what is happening, lack of user feedback when a message
is sent, and streaming is not working"* — was one root cause: the flow inherited the room's
conversation **content** and none of its **status surfaces**. `Room.svelte` had six of them;
`FlowCanvas` → `FlowThread` had one, conditioned on local state that was frequently wrong.

Lucas's three decisions on #34 (16 Sep) are implemented as written: **plain animated dots for
Ellie, the elapsed counter for Max, the ETA only in the indicator's `title`**; **Stop only once
the floor has elapsed**; **the per-round Hold / Wait-for-me pause kept, with no global off
switch**.

| Audit | What landed | Where |
|---|---|---|
| §4 P0-1 | `Divider` above any message with a `dividerCause` — the line `actor.ts` has always written and the flow always dropped, so a content-free nudge stops being pixel-identical to a considered reply. `WaitLine` under the thread composer: the 45 s track, the *"Ellie may chime in"* caption, **Hold** and **Wait for me** | `AiSegment.svelte`, `FlowThread.svelte` |
| §1 P0-2 | Optimistic append. A client-side pending queue; the block is on screen from the keystroke, greyed; the composer is cleared only after the send reaches the bridge; the echo acks it by text-under-anchor; a rejection leaves the words in place with **Retry** / **Discard**, never in a global banner. Visible **Send**, disabled on an empty box | `flowchat.ts` (`PendingSend`, `ackIndex`), `store.svelte.ts`, `FlowThread.svelte` |
| §2a P0-3 | `turn.received` rendered as neutral, un-attributed room state — *Sent · the room has it*. No name, no avatar, no verb, so §C3's agent-chrome-free window and §D4's "an indicator runs during the hold" are both satisfied. Times out rather than outliving a turn that died | `flowchat.receivedVisible`, `FlowThread.svelte` |
| §2b P0-4 | The wait follows **the turn's anchor**, not `store.composerAt`. The old condition meant a nudge landing anywhere else drew the indicator nowhere at all | `flowchat.thinkingAnchor` |
| §3 P0-5 | Inline failure card + Retry kept and rendered per anchor; a persistent **backend strip** above the deck when the scripted client is answering or the CLI is installed and signed out. (The untrue *"retrying"* copy was corrected on the room track in `b7596ec`) | `FlowCanvas.svelte`, `TurnFailureCard.svelte` |
| §5 P0-6 | `scrollDecision()`: into view when the learner is writing in that thread or within 220 px of it, otherwise a docked **↓ Ellie replied · p.6** pill that clears when the thread is reached. Esc closes the thread composer and restores focus to the card | `flowchat.ts`, `FlowCanvas.svelte`, `FlowThread.svelte` |
| §8 P0-7 | One `aria-live="polite" aria-atomic="true"` region per flow, one sentence per event, never the body. `ThinkingIndicator` demoted to `role="status"` + `aria-live="off"` — it used to re-announce the Tester's wait once a second | `FlowCanvas.svelte`, `ThinkingIndicator.svelte` |
| §2 P1 | `turn.delta` accumulates into a provisional card drawn by the same `AiSegment`, with a caret; `turn.released` finalises it. **Stop** wired to `flow:stop`, offered only when `stopAllowed()` | `flowchat.appendDelta/stopAllowed`, `FlowThread.svelte` |
| §B9 P1 | Device 1: the anchor ring on the crop while a public turn is held — an outline **outside** the crop's bounds, because the never-rule holds for a ring as for an AI card. Device 3 generalised from the private popover to public turns, which is the case §B9 was written about | `SegmentCard.svelte`, `FlowCanvas.svelte` |
| §6 P1 | Provenance foot on every AI card: `4.1s · scripted:sonnet · scripted`, hover-revealed — **except `scripted`, shown unconditionally**, because a card that does not say which backend produced it is a claim about a model that never ran | `flowchat.metaParts`, `AiSegment.svelte` |
| §9 P1/P2 | Settings ▸ **Reply speed** (Considered / Faster / No pacing) with the disclosure on the options, not in a footnote. §C3 argues a paced system the learner cannot un-pace is a dark pattern; this was the one §C3 control never built. Settings ▸ Open log folder already landed in `7d440bb` | `Settings.svelte`, `flowchat.REPLY_SPEEDS` |
| §10 §7 P2 | ⌥⌘D **turn log** over `flow:turnTrace` — trigger, `decidedBy`, decision and generation latency, TTFT, floor, total, backend, model, tokens. No bodies are in `TurnTraceView` and none are rendered. Unread dots per thread from `lastSeenSeq`, cleared by `flow:markSeen` when the thread is genuinely on screen. Thread collapse and dismissed cards persisted through `flow:cardState`. `prefers-reduced-motion` extended to the three dots and the ring | `DebugDrawer.svelte` (new), `SegmentCard.svelte`, `FlowThread.svelte` |

`lib/flowchat.ts` holds every decision in that table as a pure function with **33 tests**: nothing
in it reaches the bridge, holds a timer, or knows what a DOM node is.

### Verified live over CDP

Own port 9336, own `--user-data-dir`, vault = `/Users/lohzh/ChatterED/Academia`, backend
`scripted`, Reply speed **Considered**, on `A0282987E_LohZhengLucas_Critique1_slides (1).pdf`.

| Check | Measured |
|---|---|
| The send is acknowledged | `Sent · the room has it` from the ack until **3.2 s**, when Ellie's dots replaced it |
| The indicator is Lucas's | dots for Ellie, no counter; `title` = *"Ellie usually takes about 1s more"* — the ETA nowhere on screen |
| The wait has a location | anchor ring on the crop (`.card.pending`) for the whole hold; breadcrumb **"Ellie is replying · p.1"** once the card scrolled away |
| The reply | landed at **4.7 s**, foot `4.1s · scripted:sonnet · scripted`, shown unconditionally |
| A nudge looks like a nudge | **"45 s quiet · Ellie stepped in · don't do this"** above the pool turn |
| The quiet timer, in the document | `45s → 31s` counting down under the thread composer, with Hold / Wait for me |
| Send button | disabled on an empty box, enabled on the first keystroke |
| Esc | composer closed and focus returned to `data-segment="seg_mu3jyc9616a37"` |
| The pill | scrolled six slides away mid-turn → **"↑ Ellie replied · p.1"** docked at the foot of the flow |
| The live region | *"Your message was received under "/btw"."* → *"Ellie replied under "/btw", 77 words."* |
| Backend strip | *"Scripted demo — these replies are a fixed transcript, not a model."* |
| ⌥⌘D | one row: `student_message │ rule:teacher_answers │ peer │ decide 0.00s │ generate 3.81s │ ttft 4.81s │ floor 4.81s │ total 4.82s │ scripted:sonnet │ scripted │ ok` — note ttft **==** floor, which is what a floor on *visible* TTFT means |
| Collapse and unread, persisted | `▾ hide this thread` ⇄ `▸ 13 turns`, and the sitting row holds `cards: {seg_…: {collapsed:false}}`, `seen: {seg_…: 13}` |
| Reply speed | all three options render with their disclosure; `replySpeed` round-trips through `saveSettings` |

Screenshots in the session scratchpad under `cui/`, `01`–`14`.

### Two bugs the live run found, and fixed here

1. **An agent turn can arrive empty.** Two rows came back from `scripted:sonnet` with
   `length(body) = 0` (SQLite seq 8 and 13; `main.log` says `reply_chars: 0`), and the flow drew
   a header, a rule and nothing else — the silence of #34 with an avatar on it. An empty turn now
   says *"This reply arrived empty."* The upstream cause is the scripted client's, not the
   renderer's.
2. **A provisional card outlived its message** — a duplicate with the streaming caret still on it,
   under the finished reply. `turn.released` is the designed drop; an agent message *landing* now
   also clears the stream, which cannot be wrong under §B10 R2.

### Not verified live

- **Stop.** Impossible to exercise on the scripted backend *by construction*: generation always
  finishes before the floor, so `stopAllowed()` is never true while the indicator is up; with
  Reply speed **off** the floor is zero and a frame-accurate sampler caught **no** frame with an
  indicator at all. `stopAllowed` has three tests and `flow:stop` is registered (its own
  `That room is not open` came back from the real handler). It needs a backend whose generation
  outlasts the floor.
- **The incremental render.** Built and unit-tested; **no `turn.delta` was emitted** in any of the
  eleven turns run (a tap on the event stream shows `turn.received → agent.thinking →
  message.appended → turn.released`, no deltas), so it has not yet had a live stream to draw.
- **The failed-send block** (`pending → failed` with Retry). The local IPC ack lands inside one
  animation frame, so the greyed state is not observable here, and the API object is frozen by
  `contextBridge`, so a slow link cannot be simulated from the page. Covered by `ackIndex`'s tests.
- **The failed-*turn* card in the flow.** Same blocker the previous section already recorded: an
  open room keeps the client it was constructed with, so pointing Settings at `/bin/false` did not
  reach the actor. The card, its Retry and the store's `turn.failed` handler are unchanged from
  `b7596ec`, which was verified live then.

### Noted for the room track

`turn.received` is emitted **twice** with the same `turnId` in the same millisecond. The renderer
is idempotent on it, so it is harmless on screen — but the debug drawer counts turns, and a
double-emit is usually a double-subscription.

## The conversation layer says what it is doing — the main-process half (16 Sep, audit §2/§6/§7/§9/§10, #34)

The audit's verdict was that the flow inherited the conversation's *content* from the chat room
and none of its **status surfaces**, and that streaming was not broken but absent. This is that
half of the fix: the events, the IPC, the actor. The flow-side rendering is the parallel track.

**Eight commits**, `31a8c30` → `b4ca1c9`.

### The wire

| Event | Shape | When |
|---|---|---|
| `turn.received` | `{turnId, messageId, anchorId, receivedAt, yieldMs, etaMs, responder}` | the instant the actor accepts a learner turn — **before** the floor-yield sleep and any model call |
| `turn.delta` | `{turnId, anchorId, participant, text}` | only ever **after** the floor has elapsed |
| `turn.released` | `{turnId, messageId \| null, stopped}` | once per turn, whatever the ending |

| IPC | Shape |
|---|---|
| `flow:stop` | `{roomId, turnId}` → `{stopped:true, turnId}` \| `{stopped:false, refused:'floor'\|'unknown'}` |
| `flow:turnTrace` | `{roomId, turnId?}` → `TurnTraceView[]` (in-memory ring, last 50, **no bodies**) |
| `flow:markSeen` | `{roomId, anchorId, seq}` |
| `flow:cardState` | `{roomId, anchorId, collapsed?, removed?}` |

`MessageView` gained `model`, `backend`, `totalMs`, `decidedBy`, `stopped` (migrations 011, 012);
`FlowThreadView` gained `lastSeenSeq`, `collapsed`, `removed`; `SettingsView` gained `replySpeed`.

**The acknowledgement is two-phase, and that is not a double emit.** Phase 1 goes out with no
speaker and no ETA, because neither is known and the learner needs it *now*. Phase 2 goes out when
a **rule** fixes the speaker — on an anchored thread `rule:teacher_answers`, no model call, so the
two usually land in the same millisecond — carrying the responder and the floor target for §B9's
reserved slot and the hover ETA. A model decision is never re-emitted: it lands mid-yield, and a
name appearing at second 4 is the agent chrome §C3 forbids. Identical payloads are dropped, so a
second event always means something changed. Key the render on `turnId`, treat it as a replace.

**The floor is untouched.** `TurnStream` buffers every delta produced during the hold, flushes the
buffer as one delta the moment the floor elapses, and streams the rest live. Nothing is visible one
millisecond earlier than before. `ttft_actual_ms` is now the first **visible** token; the model's
own TTFT is in the log as `ttft_model_ms`. The hold runs concurrently with the generation instead
of after it, which is what makes the tail live rather than a second buffer.

### Verified live over CDP — installed build 102 (`b4ca1c9`), own port 9351, own `--user-data-dir`

Scripted backend, `room_6a9609d5c6fb` / `seg_mu3he86g65558u` — the 16 Sep silence room:

```
2ms timer.updated | 3ms message.appended | 4ms turn.received | 8ms ledger.updated |
9ms turn.received | 4637ms agent.thinking | 5639ms turn.delta | 5639ms agent.thinking.cleared |
5641ms message.appended | 5642ms turn.released
```

ack at **4 ms** carrying the learner's own `messageId`, `yieldMs 8000`; the second at **9 ms** with
`eta 5632` and `responder Ellie`; **no agent chrome until 4637 ms**; one flush delta at **5639 ms**
against a floor target of **5632**; `concat(deltas) === body` (268 chars); `model=scripted:sonnet
backend=scripted ttft=5634 total=5635 decidedBy=rule:teacher_answers`. Stop at 250 ms and at 1.8 s
both `{stopped:false, refused:'floor'}`.

With floors off, the same turn streamed **12 deltas** at 7, 44, 81 … 411 ms — the 35 ms word-chunk
rate `llm/backend.ts` asks ScriptedClient for — and a Stop fired from inside the page returned
`{stopped:true}`, kept the partial with `stopped: true`, `released.stopped=true`, `turn.failed=0`.

**CLI backend, the real deck's room** (`claude-sonnet-5`, `/Users/lohzh/.local/bin/claude`): ack at
4 ms, second at 11 ms (`eta 4737`, Ellie), thinking at 3742 ms, one flush delta at **4744 ms**
(floor 4737), 483 chars, `concat === body`, `backend=claude-cli ttft=4740 total=4741`, trace
`generationMs 4245`, `cache_creation_input_tokens 9893`. Stop during the floor refused. A second
CLI turn with floors off streamed live and was **stopped mid-stream**: 4 deltas, `{stopped:true}`,
33 chars kept and flagged, `turn.failed=0`, and the turn's `claude` child gone from `pgrep`.

### Two bugs the live runs found, both fixed here

1. **`loggedClient` dropped the abort signal.** It decorates `LLMClient` and silently omitted the
   third argument, so `signal` reached no client in the app. The first live Stop returned
   `{stopped:true}` while the scripted client streamed all twelve chunks to the end; on the CLI
   path that leaves `claude` generating and billing after a stop that reported success. Fixed,
   including the JSON-repair retry's second child, with a test that fails on the old wrapper.
2. **`generationMs` measured the wait, not the call.** It was stamped where the promise is
   *awaited*, which is on the far side of the yield sleep, so a reply produced in milliseconds
   read as `gen=4996ms`. Now stamped in the settle handlers.

### The backend-rebinding bug from the last report — fixed

`openRoom` returns the already-open actor and the client was bound at construction, so a Settings
change reached SQLite and never reached the actor. `RoomActor.rebind()` swaps client, models,
roster, mode and reply speed; it is called from `openRoom`'s reuse path and after a successful
`saveSettings`, between turns only. That is also why the earlier attempt to force a live failure by
pointing Settings at a broken binary never reached the actor.

### Not verified, and one thing seen in passing

- The **live tail on the CLI path at the studied pacing** was never observed: the CLI answered in
  4.2 s against a 4.7 s floor, so everything buffered into one flush, which is correct. The tail
  was proved with the floors halved and off, and by unit test with a gated client.
- A turn that **fails** does not record `generationMs` in the trace — only `failed` and `totalMs`.
- **A scripted turn can arrive empty.** Past the end of a script `beatFor(cue)` returns nothing and
  the reply is `''`, so there are no deltas and nothing to stop. The flow-track agent's "eleven
  scripted turns with no `turn.delta`" is this, not a missing stream. Worth its own issue.
- **`vault:find` returned ids that `segments:get` rejects** with *"That file is not in the vault any
  more"*, for every PDF tried, in a profile whose `app.db` was copied and then rescanned. Seen
  once, cause not chased, not this track's.
