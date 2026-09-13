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

`npm run dev` starts on the scripted transcript player (`ScriptedClient`), so it runs with no API
key and makes no network calls. Enter an Anthropic API key in Settings to switch to live agents.

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
