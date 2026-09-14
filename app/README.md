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

## Layout

```
src/
  main/        Electron main process: window, IPC, SQLite store, keychain, room host
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
