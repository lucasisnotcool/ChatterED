# ChatterED — macOS app

Electron (Node main process) + Svelte 5 renderer + TypeScript (strict) + SQLite.
The architecture this implements is `docs/research/architecture-mac.md`; the interaction it
has to deliver is `docs/research/product-design.md` §B–§D and `docs/research/design-brief.md` §G.

## Requirements

- Node ≥ 22.12 (developed on 22.14) and npm 10+
- macOS with Xcode command-line tools (for the one native module, `better-sqlite3`)

## Commands

| Command | What it does |
|---|---|
| `npm install` | Installs, then rebuilds `better-sqlite3` against Electron's ABI (`postinstall`) |
| `npm run dev` | Compiles main + preload, starts Vite on :5273, launches Electron against it |
| `npm run build` | `tsc` for main/preload/room/shared → `dist/`, Vite for the renderer → `dist/renderer/` |
| `npm test` | Vitest — room actor, silence timer, ledger gates, whisper leak canary |
| `npm run lint` | ESLint, including the whisper-import restriction and the `src/room` portability rule |
| `npm run typecheck` | `tsc --noEmit` plus `svelte-check` |
| `npm run dist:mac` | Unsigned DMG into `out/` (no signing, no notarisation — issue #17) |
| `npm run install:local` | Builds this checkout into `~/Applications/ChatterED.app` and loads the auto-rebuild LaunchAgent (#20) |
| `npm run uninstall:local` | Unloads and removes the LaunchAgent. Leaves the app |

`npm run dev` picks a backend automatically — see below. With no Claude CLI and no API key it
starts on the scripted transcript player (`ScriptedClient`) and makes no network calls at all.

## Backends

The room actor takes an `LLMClient` and cannot tell which one it has (`src/room/llm/types.ts`).
Three implement it, and with no forced choice in Settings they are tried in this order (#19):

| Backend | Where | When it is used |
|---|---|---|
| **Claude Code on this Mac** (`ClaudeCliClient`) | `src/main/llm/claude-cli.ts` | The `claude` binary is installed **and logged in**. The default: it uses the subscription the learner already has, needs no key, and costs nothing per message |
| **Anthropic API key** (`AnthropicClient`) | `src/room/llm/anthropic.ts` | A key has been entered (#15) and the CLI cannot answer |
| **Scripted** (`ScriptedClient`) | `src/room/llm/scripted.ts` | Neither of the above. Also the A1 video fallback, and what every test runs against |

Any of the three can be forced in Settings. Forcing one that cannot run still falls back — the
pane says which backend is live and why the choice was not honoured.

### Where the API key lives

`~/Library/Application Support/ChatterED/anthropic-api-key` — a plain file, mode `0600`, inside a
`0700` directory, written by `src/main/apikey.ts` (#15, amended 2026-09-14). Nothing encrypts it,
and nothing on the boot path reads it: the backend only asks whether the file is non-empty, and the
plaintext is fetched lazily, at the moment an API call is actually made.

Electron `safeStorage` used to hold it as ciphertext in the settings table. That was dropped
because its encryption key is an OS credential, so the boot-time availability check made macOS
challenge every ad-hoc-signed rebuild — a permission modal on **every** launch, including the
default Claude Code path that never wants a key. `apikey.ts` argues it in full. Migration 004
deletes the stranded ciphertext, and `src/main/apikey.test.ts` fails the build if the dependency
reappears.

The file is **outside the repo**, so no `.gitignore` rule covers it and none is needed — but it is
a live billable credential: never copy it into the checkout, and never commit it.

### The command line

```
claude -p --model <model> --tools "" --output-format stream-json \
       --include-partial-messages --verbose --no-session-persistence \
       --strict-mcp-config --setting-sources "" --disable-slash-commands \
       [--json-schema <schema>] --system-prompt <text>
```

with the flattened group transcript on **stdin**. Four things about it are load-bearing, all
verified against Claude Code 2.1.259:

- `--verbose` is **required**: `-p` with `--output-format stream-json` exits 1 without it.
- `--bare` must **not** be passed. It makes auth strictly `ANTHROPIC_API_KEY`/apiKeyHelper and
  never reads the OAuth login, so the subscription this backend exists to use returns
  "Not logged in".
- `--strict-mcp-config --setting-sources "" --disable-slash-commands` keep the learner's own
  Claude Code configuration out of the room. Without them the call loads their MCP servers and
  hands the model those tools — measured at 6,319 extra cached prompt tokens on one turn.
- the prompt goes on stdin, never in argv: a transcript plus a lecture slide is past the limit.

The binary is resolved as `~/.local/bin/claude` → the built PATH → a Settings override. The PATH
is built explicitly (`/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:/usr/bin:/bin`) because an
Electron app launched from Finder inherits launchd's PATH, not the login shell's.

### Models, per role

Two Settings dropdowns, because these are the two kinds of call the app makes:

| Role | Calls | CLI default | API-key default |
|---|---|---|---|
| **Agent turns** (Ellie, Max, Theo) | group turns, whisper replies | `sonnet` | `claude-haiku-4-5` |
| **Orchestrator + ledger** | the turn decision, the ledger update, concept ingestion | `sonnet` | `claude-sonnet-5` |

`haiku` / `sonnet` / `opus`, or a full model id in the free-text field. Fable is not offered and
is rejected if typed (CLAUDE.md hard invariant). Every message row stores the backend and the
resolved model id; every session row stores the plan it was opened with.

## Install on your Mac

```sh
npm run install:local
```

Builds this checkout and installs it as `~/Applications/ChatterED.app`, then loads a LaunchAgent
(`com.chattered.updater`) that repeats the build **at login and every six hours**, after a
`git pull --ff-only origin main` (issue #20). So the app on the Dock tracks `main` without anyone
remembering to rebuild it.

What the script guarantees, and why:

- **A failed build never removes the working app.** It packages into a scratch directory and only
  then does `rm -rf ~/Applications/ChatterED.app && cp -R`. An unattended job that runs every six
  hours will eventually run during a broken commit; the cost of that has to be "yesterday's app
  and a line in the log". Same shape as `/Applications/scribe/ScribeBar/build.sh`.
- **A dirty working tree is never pulled over.** It warns, skips the pull, and builds the tree as
  it stands.
- **`npm ci` runs only when `package-lock.json` actually changed** (a hash under
  `~/Library/Caches/chattered-install`), because it is slow and wipes `node_modules`.
- **One build at a time**, via a lock that goes stale after an hour so a killed run cannot block
  the updater for ever.
- The bundle's `CFBundleShortVersionString` comes from `package.json`, `CFBundleVersion` is the
  commit count (monotonic, which is what macOS expects), and `ChatterEDGitCommit` records the
  short hash.

Unsigned, by decision #17: no Developer ID, no notarisation. The bundle is **ad-hoc** signed
(`codesign --force --deep -s -`) only so macOS sees a coherent signature rather than a broken one
after the Info.plist edits — that is not distribution security and is not offered as any.

Logs: `~/Library/Logs/chattered-install.log` (the script) and `~/Library/Logs/chattered-updater.log`
(launchd's capture of it).

```sh
launchctl list | grep com.chattered      # is the agent loaded?
bash tools/install-local.sh update --force   # rebuild now, even if HEAD has not moved
```

### Uninstall

```sh
npm run uninstall:local     # unloads and removes the LaunchAgent; leaves the app
```

Then drag `~/Applications/ChatterED.app` to the Trash if you want the app gone too. Its data lives
in `~/Library/Application Support/ChatterED/`.

The distribution path is unchanged: `npm run dist:mac` still produces an **unsigned** DMG in
`out/`, and nothing here signs or notarises it.

## Layout

```
src/
  main/        Electron main process: window, IPC, SQLite store, API key file, room host
  preload/     contextBridge surface (the only thing the renderer can call)
  renderer/    Svelte 5 SPA — library / document / chat shell, ledger rail, whisper pane
  room/        PORTABLE. The room actor, orchestrator, silence timer, context builder,
               ledger gates and the two LLM clients. Imports no Electron, no SQLite driver,
               no Firebase — it takes Clock / Store / Transport / LLMClient interfaces.
  shared/      IPC contract types shared by main, preload and renderer
```

`src/room` staying free of platform imports is what makes a Windows build (or a Tauri port, or a
server rehost) packaging work rather than a rewrite. ESLint enforces it.

## Tests and the whisper invariant

`src/room/context.test.ts` is the canary from `architecture-mac.md` §D.4: a whisper-only string
must never appear in a group-scope prompt or in a group-scope mirror document. It is asserted two
ways — at runtime, and by walking the static import graph so that no module reachable from
`buildGroupContext()` can even see the whispers repository.

No test makes a network call. The Anthropic client is exercised through a fake transport.
