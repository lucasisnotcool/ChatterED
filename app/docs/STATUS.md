# ChatterED — what is real and what is stubbed

**As of the M0/M1 scaffold pass, 13 Sep 2026.** Written so that nothing in the A1 video or the
report has to be guessed at. The rule used throughout: a mechanic that carries a design decision
is real; content and infrastructure that carry none may be scripted or stubbed, and are listed
here as such.

Run it: `npm install && npm run dev`. Test it: `npm test` (82 tests, no network).

**Updated 14 Sep 2026** for issues #19 (local Claude CLI backend, per-role model selection) and
#20 (local install with a launchd auto-rebuild).

## Real — it runs, it is persisted, and it is tested

| Thing | Where | Notes |
|---|---|---|
| Electron main + preload + Svelte 5 renderer, TypeScript strict | `src/` | `npm run dev` compiles main, starts Vite, launches Electron |
| SQLite schema, migrations, repository layer | `src/main/db/` | The full `architecture-mac.md` §D.1 model, WAL, foreign keys on. DB at `~/Library/Application Support/ChatterED/app.db` |
| Room actor: serialised mailbox, one writer per room | `src/room/actor.ts`, `mailbox.ts` | Long waits run outside the mailbox so a learner message can cancel a held reply |
| Silence timer: 45 s / 90 s, typing-only pause, 120 s extension cap, ≤2 fires per round, Hold, Wait for me | `src/room/timer.ts` | 1 s wall-clock tick against a persisted deadline; `timerEpoch` fences every path; 13 unit tests on a fake clock |
| Sleep / quit / relaunch recovery, including the 120 s late-fire cut-off and the resume card | `timer.ts`, `actor.ts#recover` | Idempotent; running the pass twice is a tested case |
| Latency floor (Challenger 9–12 s, Peer 4–6 s, whisper 1–2 s) with the 8 s floor-yield window | `actor.ts` | A floor on visible TTFT, not an added delay: generation starts at once, the reply is buffered. `latency_target_ms` and `ttft_actual_ms` are both stored |
| Orchestrator: deterministic rules (anti-dog-pile, Peer-only silence fills, last word, S2 quota) + a Sonnet 5 structured decision | `src/room/orchestrator.ts` | Rules decide first; the model is consulted only when they have not |
| Ledger: the four hard rules + the `defended` gate | `src/room/ledger.ts` | Verbatim-evidence substring check, monotonic with a capped self-contradiction downgrade, 0.6 confidence floor, agreement-is-not-evidence, and `defended` unreachable without a Challenger probe. Every proposal is written to `ledger_history` with the gate that stopped it |
| Whisper: separate table, scoped context builder, group-prefix snapshot, relay with attribution | `src/room/context.*.ts`, `actor.ts` | Whispers do not pause the timer and do not move the ledger |
| **The whisper leak test** | `src/room/context.test.ts` | Canary string, store-shape assertion, and a walk of the static import graph from `context.group.ts` |
| Scripted transcript player (the A1 video fallback) | `src/room/llm/script.psd-hessian.ts`, `scripted.ts` | Replays design-brief.md §G through the *real* actor, timer, gates and whisper scoping. The ledger's evidence is lifted verbatim from what the learner actually types |
| Anthropic client: streaming, cache breakpoints, usage persisted | `src/room/llm/anthropic.ts` | `claude-haiku-4-5` for agent turns, `claude-sonnet-5` for orchestrator/ledger/ingest |
| **Local Claude CLI client** (#19) | `src/main/llm/claude-cli.ts` | Shells out to `claude -p … --output-format stream-json`, parses the deltas and the final `result`, persists the same usage shape. In `src/main`, not `src/room`, because it spawns a process and `src/room` is the portable half. 29 tests against a fake `claude` binary on a temp PATH |
| **Backend detection and order** (#19) | `src/main/llm/detect.ts`, `backend.ts` | CLI-if-logged-in → API key → scripted, forceable in Settings. The login probe costs one Haiku round trip, so it is cached in the settings table and warmed in the background at launch |
| **Per-role model selection** (#19) | `src/room/llm/models.ts`, `src/renderer/components/Settings.svelte` | Two dropdowns (agent turns / orchestrator + ledger), haiku·sonnet·opus, default **sonnet** for both on the CLI path; a free-text field takes a full id. Fable is not offered and is rejected if typed |
| Settings screen | `src/renderer/components/Settings.svelte` | Backend, CLI status and path override, the two model choices. Says which backend is *actually* live and why a forced choice was not honoured |
| **API key entry, in a 0600 file** (#15, amended 2026-09-14) | `src/main/apikey.ts` | The key is a plain file, `~/Library/Application Support/ChatterED/anthropic-api-key`, mode 0600 inside a 0700 directory. It sits in Application Support, **outside the repo**, so no `.gitignore` rule covers it and none is needed — but it is a live credential: never copy it into the checkout and never commit it. Electron `safeStorage` was removed (the prompt on every launch it caused, and the rule that boot must never touch the login keychain, are argued at the top of `apikey.ts`); migration 004 drops the dead ciphertext row, and `src/main/apikey.test.ts` walks the import graph and sweeps `src/` so it cannot come back. Optional now that the CLI can answer |
| Session setup from pasted text, claim rows, prefix frozen and hashed at confirmation | `src/main/sessions.ts` | `pack_confirmed_at` gates opening the room |
| Role–name pairing randomised at install | `src/room/agents.ts`, `ipc.ts` | Stored in settings; recorded per session |
| Three-pane shell, message anatomy, composer hairline, indicators, ledger rail, whisper pane, recap | `src/renderer/` | Functional against the scripted client |
| Event log with the §7.1 vocabulary, and an outbox with deterministic doc ids | `actor.ts`, `db/` | Event payloads never contain message bodies (asserted in a test) |
| **App icon, wired** (#20) | `assets/AppIcon.*`, `electron-builder.yml`, `src/main/index.ts` | `mac.icon` for the bundle; `app.dock.setIcon` so `npm run dev` shows it too |
| **Local install + launchd auto-rebuild** (#20) | `tools/install-local.sh`, `tools/com.chattered.updater.plist` | `npm run install:local` → `~/Applications/ChatterED.app` plus a LaunchAgent that rebuilds at login and every 6 h after `git pull --ff-only`. A failed build leaves the previous app untouched. Unsigned, ad-hoc only (#17) |

## Scripted — real machinery, scripted content

- **Agent turn text** in the default mode. `ScriptedClient` replays the eleven turns of
  `design-brief.md` §G. Say this on camera: a scripted turn presented as scripted costs nothing.
  Enter an API key in first-run and the same code path calls Haiku 4.5 for real.
- **Whisper replies and the relay draft** come from the same script in scripted mode.
- **Stage-1 silence nudges are drawn from a fixed pool in both modes, deliberately** — content-free
  by construction, never generated against the concept (`product-design.md` §C5).

## Stubbed or not built yet

| Gap | Why it is acceptable now | Where it belongs |
|---|---|---|
| Firestore mirror does nothing | Out of scope for M0/M1 by instruction; the `outbox` table and the interface exist so the drain is the only missing piece | A2 W5 |
| `cache_eligible` uses a ~1.3 tokens/word estimate, not `messages.count_tokens` | The real count needs an API call at setup time; the estimate is recorded and flagged rather than assumed correct | M2 |
| No PDF page-range picker; setup is paste-only | `architecture-mac.md` §E: pdf.js + pdf-lib ingestion is its own milestone | M2 |
| `ensurePrefixFloor`'s widen/glossary steps are not implemented | Needs real token counts first | M2 |
| Consent screen, participant code, withdrawal path | Compliance is handled by Lucas with the prof; the schema holds `consents` already | A2 |
| History, export to `~/Documents/ChatterED/` | Not on a marked A1 requirement | A2 |
| Theo's teach-back round | The recap renders the invitation; accepting it does nothing yet | A2 |
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
