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
