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
| API key entry via safeStorage | `src/main/keychain.ts` | Ciphertext in the settings table, key in the login keychain. Optional now that the CLI can answer |
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
