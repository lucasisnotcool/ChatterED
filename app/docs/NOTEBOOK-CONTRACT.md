# The notebooks build contract

**What this is.** The shared shapes, the binding design calls and the file ownership for the
notebooks redesign (`docs/research/notebooks.md`, 1 Oct 2026). The brief wins any argument about
*what*; this file settles *who builds which file against which signature*. It follows the pattern
of `COLLAB-CONTRACT.md` (#48), which worked: six tracks in one working tree, disjoint files,
path-limited commits, the lead relaying hand-backs.

## Rules for every track

1. **Touch only the files your track owns** (below). Read anything. If you need a change in a file
   you do not own, do not make it: put the request in your final report (or message the lead) and
   code around it.
2. **Frozen after day 0** (the lead's; nobody edits them): `src/shared/notebook.ts`,
   `src/shared/ipc.ts`, `src/shared/types.ts`, `src/preload/index.ts`, `src/main/dochost.ts`,
   `src/main/db/migrations/024_notebooks.sql`, `package.json`, and the day-0 fields of
   `src/renderer/lib/notebookstore.svelte.ts`. Additions to `src/shared/doc/types.ts` belong to
   N4 (it owns that file), except the day-0 names already in it (`OverviewMeta`,
   `OverviewRecommendation`, `NOTE_SLOT_REASON`, `BLOCK_LINE_MAX_WORDS`, `GeneratedBlockKind`,
   `BlockActionKind`, `'block_action'`), which are frozen.
3. **Delete only what your track owns, and only once nothing else imports it.** The lead removes
   any leftovers at the end.
4. **Commits are scoped and path-limited**, because other agents commit beside you:
   `git add <your exact paths> && git commit -m "…" -- <your exact paths>`. Never `git add -A`,
   `git add .`, `git commit -a`, stash, reset, or checkout of another track's file. If
   `.git/index.lock` exists, retry a few seconds later. **Commit as soon as your own tests pass,
   and again at every working step**: the Opus session limit can end your run without warning,
   and only committed work survives it. A pre-commit hook refuses `A2-PRIVATE` content; never
   bypass it.
5. **Commit messages** follow the repo: a plain descriptive subject (no `feat:` prefixes), a body
   that says why, what was verified and what is left, the issue number the lead gives you, and
   the last line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (or
   `Claude Sonnet 5.5`, whichever model you are).
6. **Verify your own files.** From `app/`: `npm run typecheck`, `npx tsc -p tsconfig.main.json
   --noEmit` (the build's config differs from typecheck's; both must pass), `npm run lint`, and
   `npx vitest run <your test files>`. Other tracks' half-built files may fail while you work:
   read the output for *your* paths and do not fix theirs.
7. **Subagents:** if you use the Agent tool, pass `model: "opus"` (or `"sonnet"`/`"haiku"`)
   explicitly. Never omit it.
8. **Shell traps:** zsh (quote globs; end inspection chains with `; :`); no `timeout` on macOS;
   foreground `sleep` is blocked; paths under `Academia/Sources/` contain spaces.
9. No participant data: never read `docs/research/ai-use-transcripts/raw` or `processed`, and
   never open `~/ChatterED-A2`.
10. Match the surrounding code: comment density (this codebase comments *why*, at length), naming,
    Svelte 5 runes as the existing stores use them.
11. **Your final report** lists: commits, what was verified (and how), what is left, and every
    request for a file you do not own, with the exact change.

## Binding design calls (the lead's, day 0)

**C1. The notebook is one virtual deck.** Each source has a fixed `pageBase` (append-only, never
reused). Every page that crosses a module boundary on the doc path is a **notebook page**:
block `pages`, objective refs, `sectionPagesForBlock`, `notes:pageLines`, `notes:pageImages`,
citation chips, `[p. N]` markers in deck text. Only code that opens a source's bytes translates,
through `shared/notebook.ts` `locatePage` (renderer) or `DocHost.notebooks.locate` (main). This
is why provenance, `blocksForPages`, the notes map and objective mapping need no change.

**C2. The notebook id is the subject.** On every notes / chat / progress / objectives channel,
`fileId` carries the notebook id (`nb_…`). `DocHost.fileBytesKey(nbId)` returns
`{ contentSha: 'nb:<id>', pageCount: <virtual page count> }`; `notes_docs`, `quiz_outcomes`,
`learning_trees`, `learning_objective_states`, `materials.file_id` and the rooms are keyed on the
notebook id / content key, never a source's. The content key never changes when sources change,
so the doc, the progress and the room survive it. `openDocument({ fileId })` still takes a
**source's** file id: it is how the renderer gets a source's bytes.

**C3. Sources are `files` rows in one managed vault.** A synthetic `vaults` row whose root is
`<userData>/notebooks`; a source's copy lives at `<nbId>/<fileId>-<safe name>`. The indexer,
FTS, page geometry, `textFor` and adoption keep working by file id. The managed vault is never
rescanned by `scanVault` (it would reconcile deletions by path). Text sources (Markdown, plain
text, Word/RTF via macOS `textutil -convert txt`) are paginated into notebook pages of about
`TEXT_PAGE_WORDS` words by one pure function, `src/shared/paginate.ts` `paginateText` (N1 writes
it; the renderer uses the same one), so main and renderer agree on page boundaries.

**C4. The room is per notebook; its material is the ticked sources.** `openFlowRoom(nbId)` builds
the material from `DocHost.notebooks.deckText(nbId)`. When the context fingerprint changes, the
material's text and frozen prefix are re-frozen before the next turn (the existing
refreeze/rebind pattern in `flowroom.ts`), not a new room.

**C5. The overview writes the objective tree.** One overview call (N2) returns the sections *and*
four to six objectives with statement, criteria, quiz seeds and notebook pages; N2 stores them as
the notebook's `LearningTree` (flat, depth 1; the 6–20 bound is relaxed for notebooks). The
"By the end you can" list in the doc is an `ordered_list` block with
`reason: 'objectives'` whose items are the tree's objective titles **in tree order**; the editor
(N6) decorates each item with that objective's fill from the progress view. `ensureObjectives` on
a notebook never runs the old whole-deck objective ingest.

**C6. The overview's block shape** (N2 writes it, N6 renders it, everyone else reads it):

| Block | Node | Provenance |
|---|---|---|
| Title | `heading` level 1 | `reason: 'title'` |
| Lede (2–3 sentences) | `paragraph` | pages it draws on |
| "By the end you can" | `heading` level 3 | `reason: 'objectives'` |
| The objectives | `ordered_list`, one item per objective | `reason: 'objectives'`, pages = union |
| Section heading | `heading` level 2 | the section's pages |
| Takeaway (one line) | `paragraph` | pages |
| Each key idea | its **own** one-item `bullet_list`, so each idea has its own pages, chip and toolbar | pages |
| Your-note slot | empty `paragraph` with `reason: NOTE_SLOT_REASON` | `pages` = the section's |

A blank the deck itself leaves (`Max(Cost) = `) is kept verbatim as `____` with that page.
Recommendations, starter questions and the greeting live in `OverviewMeta`
(`notes_docs.overview_json`), not in the doc; a recommendation names its section by
`headingBlockId`.

**C7. Every block action gives two outputs** (brief §4.2). Explain / Example: Ellie's **full**
answer in the block's span thread, then a separate schema-bound call for one line of at most
`BLOCK_LINE_MAX_WORDS` words, inserted `insert_after` the block with `cause: 'block_action'`,
author Ellie, provenance, Keep/Remove. The same one-line form replaces §5.1's 40–150-word edit
after any doc-chat question; Ellie's chat answer is no longer split short. Quiz me: Max's question
in the span thread and as a Q block under the block (the existing `tryHere` + `buildQuestionEdit`
path). Ask… is renderer-only (`chat.openSpanThread`).

**C8. Max asks only when asked** (answer A). Off: `rule:max_followup`, `rule:handoff` and any path
where Max opens a **new** question unprompted. On, unchanged: everything about a question he was
asked (feedback, clarify, give-up release, Ellie's cue and Max's prompt on silence, closure). A
`maxOnlyOnRequest` actor dep, default `true`; tests of the old behaviour pass `false`.

**C9. Infographics are data, never images** (answer E). Every generated block type is structured
document content, editable text with the author mark, rendered in code (HTML/SVG). No image
generation anywhere. No mind map.

**C10. The chat greeting is static.** Ellie's greeting and the three starter questions come from
`OverviewMeta` and are drawn by the chat when the doc chat is empty; a click sends the question as
the learner's. No model call, no room until the learner acts.

## The tracks

| Track | Model | Builds | Owns |
|---|---|---|---|
| **N1 notebooks-main** | Opus | NotebookService (create, list, rename, delete, add/copy/convert/read sources, enable, remove), the managed vault, `paginateText`, `DocHost.notebooks` and the notebook-aware `fileBytesKey` / `openFlowRoom` / room material (C2–C4), `notebook:*` IPC bodies, the drop path, the menu, the one-time legacy import, removal of the vault IPC and topic code from main | `src/main/notebooks/**` (new), `src/shared/paginate.ts` (+test), `src/main/vault/**`, `src/main/flowroom.ts`, `src/main/sessions.ts`, `src/main/ipc.ts`, `src/main/menu.ts`, `src/main/index.ts`, `src/main/research/**`, `src/main/db/repos/core.ts`, `src/main/db/migrations.ts` + tests (incl. `menu.test.ts`, `navigation.test.ts`) |
| **N2 overview** | Opus | The overview ingest (one call, C5, C6), its prompt and validator, `OverviewMeta` persistence, Update overview with carry-over, page images and page lines by notebook page, the objective tree from the overview, `notes:updateOverview` / `notes:setRecommendation` bodies, the scripted/fixture overview | `src/main/notes/**`, `src/main/objectives/**`, `src/main/db/repos/{notes,objectives}.ts` + tests |
| **N3 rules** | Opus | `blockAction` (C7), the one-line doc edit for doc-chat questions, `maxOnlyOnRequest` (C8), notebook-aware span context (`contextFor` via `DocHost.notebooks.textFor`), `notes:blockAction` body, scripted script and test updates | `src/room/**` except `src/room/generate.ts`; `src/main/docroom/**`; `src/main/db/repos/{threads,outcomes}.ts` + tests |
| **N4 blocks** | Sonnet | Flashcards, Quiz and Infographic block types end to end (schema, validator, ops, generation prompt and schema, node views, Insert menu, read-aloud, doc text), following the diagram precedent | `src/shared/doc/**`, `src/room/generate.ts`, `src/renderer/lib/pm/{nodeviews,setup,doctext,readaloud}.ts`, new `src/renderer/lib/pm/{flashcards,quiz,infographic}.ts` (+ any pure helpers in `src/renderer/lib/`), `src/renderer/lib/readaloud.ts`, `src/renderer/components/notes/InsertControl.svelte`, new `src/renderer/components/notes/blocks.css` + tests |
| **N5 shell** | Opus | Notebooks home, the sources panel (Add sources, drop zone, checkboxes, All, remove, reading state), title-bar breadcrumb, routing, the notebook store, the context chip and the static greeting with starter questions in the chat, removal of the vault UI, the drop-guard carve-out, the mock bridge's notebook model | `src/renderer/App.svelte`, `src/renderer/lib/store.svelte.ts`, `src/renderer/lib/notebookstore.svelte.ts`, `src/renderer/components/*.svelte` (top level: TitleBar, NavRail, Library, Vault*, FileTree, Finder, FirstRun, Settings, new NotebookHome / SourcesPanel …), `src/renderer/components/shell/**`, `src/renderer/lib/{chatstore,progressstore,layoutstore}.svelte.ts`, `src/renderer/lib/dropguard.ts`, `src/renderer/lib/mockBridge.ts`, `src/renderer/lib/mockNotes.ts` + tests |
| **N6 editor** | Opus | The block toolbar (Explain · Example · Quiz me · Ask…) and the per-section action row, the your-note slot placeholder, the objectives-list fills, the recommendation cards (Add → `notesGenerateBlock`, then `notesSetRecommendation`), the out-of-date banner (Update overview / Not now), source-aware citation labels, previews, slide modal and carousel across several sources (text sources as text cards), `docstore` notebook awareness and `blockAction` | `src/renderer/components/notes/**` except `InsertControl.svelte`, `src/renderer/lib/docstore.svelte.ts`, `src/renderer/lib/pm/**` except N4's files, `src/renderer/lib/{rasterise,pagelines,notesmap}.ts` + tests |

### Seams between tracks

- **N1 → N2, N3:** `DocHost.notebooks` (`subject`, `deckText`, `textFor`, `locate`) and
  `fileBytesKey(nbId)`. Until N1 lands, the stub in `main/ipc.ts` returns empties: code against
  the interface and test with a fake host (`main/docroom/fakehost.test-support.ts` is N3's; N2
  may add its own fake).
- **N2 → N6, N5:** `NotesDocView.overview` (`OverviewMeta`), and the block shape in C6.
- **N3 → N6:** `notesBlockAction` result's `threadId` (the chat focuses it).
- **N4 → N6:** node views are registered in `pm/nodeviews.ts` (N4). N6 must not touch them.
- **N5 → N6:** `store.notebook.view` for citation labels and sources; `store.chat` for Ask… and
  focusing a thread (`openSpanThread`, existing).
- **N5 mock bridge:** N5 owns `mockBridge.ts`. Every other track that needs a mock change asks N5
  through the lead with the exact change.
- **N4 ↔ N2:** `main/notes/prompts.ts` `draftWords` is exhaustive over `DocBlockDraft`. N2 gives it
  a default branch on day 1 so N4's new kinds compile.

## Day-0 state (commit at the head when tracks start)

- Brief: `docs/research/notebooks.md`. This file.
- Migration 024 (verified on a copy of a real database: 36 edit rows kept, no FK violations).
- `src/shared/notebook.ts` (+ tests): types and the page arithmetic.
- IPC: `notebook:*`, `notes:updateOverview`, `notes:setRecommendation`, `notes:blockAction`,
  `pathForFile` in the API, the preload, and mock-bridge stubs.
- `DocHost.notebooks` declared, stubbed in `main/ipc.ts`.
- `src/room/generate.ts`: the generate-block code moved out of `docedit.ts` unchanged; the three
  new kinds return `invalid` until N4 builds them.
- `NotebookStore` skeleton at `store.notebook`.
