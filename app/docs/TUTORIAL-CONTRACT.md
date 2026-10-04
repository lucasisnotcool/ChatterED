# TUTORIAL-CONTRACT: tutorial sheets in a notebook (2026-10-03)

Design: `docs/research/tutorials.md`. This file freezes the seams between the five workstreams
that build it in parallel. **Already written by the lead, do not change the shape without saying
so in your report:** `src/shared/tutorial.ts`, `src/core/planning.ts` (types section only),
`src/shared/doc/schema.ts` (`tut_part`, `tut_answer`, `tut_blank`, `tut_choices`, `blankText`,
`choicesText`; `tut_part` is a container), `src/shared/doc/tutorialdoc.ts` (`tutorialDoc`,
`tutorialDocJson`, `partAnswers`, `partAnswerOf`, `carryAnswers`, `partBlockIds`, the reason
constants), the fixture `src/shared/doc/tutorial.fixture.test-support.ts`.

Several agents edit this clone at once. **Edit only the files your workstream owns**; for a shared
file named below, make surgical `Edit`s and re-read it first. Typecheck errors in files another
workstream owns are theirs; do not fix them. Never commit, never `git add`. Migrations: the next
free number is **028** (026, 027 are taken on main).

## Workstreams and ownership

| | Owns | Delivers |
|---|---|---|
| **A · core** | `src/core/planning.ts` (below the types), `src/core/planning.test.ts`, `src/core/tutor.ts(+test)`, `src/core/README.md` row | the formal checks and the help ladder rules |
| **B · main** | `src/main/tutorial/**`, migration `028_tutorials.sql`, `src/main/notebooks/**` changes, `src/main/notes/overviewingest.ts` + `host`/`flowroom` source filtering, IPC channels in `src/shared/ipc.ts` + `src/preload/index.ts`, registration in `src/main/ipc.ts`, `NotebookSourceView.role/keyFor` in `src/shared/notebook.ts` | roles, ingest, keys, checks, help routing, progress rows |
| **E · room** | `src/room/**` (new `prompts.tutor.ts`; `actor.ts` additions), the `docPortFor` dep wiring line in `src/main/ipc.ts` | Max's and Ellie's tutorial turns, the hint line in the tutorial doc |
| **D1 · renderer shell** | `src/renderer/components/**` (new `TutorialPane.svelte`, `TutorialWindow.svelte`; `ThreeColumn`, `SourcesPanel`, `NotesPane`, `ChatColumn` edits), `src/renderer/lib/docstore.svelte.ts`, `store.svelte.ts`, `notebookstore.svelte.ts`, new `tutorialstore.svelte.ts`, `layout.ts`, `layoutstore.svelte.ts`, `mockBridge.ts`, `NotesEditor.svelte` | the split column, pop-out, opening/ingesting, sources-panel roles, chat routing, mock bridge |
| **D2 · editor** | `src/renderer/lib/pm/tutorial*.ts(+test)`, `src/renderer/lib/pm/tutorial.css`, additions to `src/renderer/lib/pm/setup.ts` | node views, part chrome, practice chips in the main notes |

## The seams

### S1 · Source role (B; read by D1)

`NotebookSourceView` gains `role: SourceRole` and `keyFor: string | null` (the tutorial a
`solutions` source answers). Migration 028 adds `notebook_sources.role TEXT NOT NULL DEFAULT
'lecture'` and `key_for TEXT`. The role is guessed with `guessSourceRole(name, text)` when a source
finishes reading, and set with `notebook:setRole` (`SetSourceRoleInput` → `NotebookView`).

- The overview (`deckText` for the overview run, `ingestPages`, `contextFingerprint` for its
  banner) uses **lecture** sources only. `contextFingerprint` gains a role filter; the renderer's
  banner compares the same.
- The room's material (`refreezeNotebookMaterial`) uses lecture **and tutorial** sources, never
  `solutions`. `textFor` of a solutions page returns '' outside `main/tutorial/`.

### S2 · The tutorial document (B; read by D1)

One `notes_docs` row per tutorial: `content_sha = tutorialContentKey(notebookId, fileId)`,
`file_id = fileId`. Built with `tutorialDocJson(sheet, { pageBase })`. Saved by the renderer
through the existing `notes:save` by `docId`, like the notes. Agent edits arrive on the existing
doc event stream with this `docId`.

IPC (names in `shared/ipc.ts`, bridge methods in brackets):

| Channel | Bridge | In → Out |
|---|---|---|
| `tutorial:list` | `tutorialList` | `TutorialListInput` → `TutorialView[]` |
| `tutorial:doc` | `tutorialDoc` | `{ notebookId, fileId }` → `NotesDocView \| null` (as `notes:get` returns) |
| `tutorial:ingest` | `tutorialIngest` | `TutorialIngestInput` → `TutorialView` (returns at once, `status: 'pending'`) |
| `tutorial:check` | `tutorialCheck` | `TutorialCheckInput` → `TutorialCheckResult` |
| `tutorial:help` | `tutorialHelp` | `TutorialHelpInput` → `TutorialHelpResult` |
| `notebook:setRole` | `notebookSetRole` | `SetSourceRoleInput` → `NotebookView` |
| event `tutorial:changed` | `onTutorialChanged` | `TutorialChange` |

Before `tutorial:ingest`, the renderer stores the tutorial's page images through the existing
notebook page-image channel (the one the overview ingest uses), so the model sees figures. The
ingest also gets `geometry.ts`'s figure boxes per page as candidates for `figure` rects.

### S3 · Ingest (B)

One structured model call (the overview's client and JSON-schema pattern) over the tutorial's page
text + page images + the **main notes' outline** (`docOutline` of the notebook doc: block ids,
headings, pages) + the objective tree. Returns `{ sheet: TutorialSheet, parts: { partId, key:
PartKey (without confidence/from), links: PartLinks, objectiveIds: string[] }[] }`. Validated in
code: unknown block ids, non-lecture pages and unknown objective ids dropped; a part whose
formal `check` fails `core/planning` validation loses its `check`; where `solveCheck` gives an
answer, it **replaces** the key's (`confidence: 'high'`); other parts get one independent re-solve
call and `confidence` from agreement. Re-ingest uses `carryAnswers`. `scripted` backend: the
fixture sheet. Stored in table `tutorial_parts(doc_id, part_id, key_json, links_json,
objective_ids_json, status, hint_level, attempts, checked_by, revealed_at, updated_at,
PRIMARY KEY(doc_id, part_id))`. A `solutions` source re-runs key generation for its tutorial
with the solutions' text as ground truth (`from: 'solutions'`).

### S4 · Check (B, A; then E voices it)

`tutorial:check` reads the saved doc, `partAnswerOf` the part. Empty → `empty`. With a `check`:
`judgeFormal(check, answer)` (A) decides. Otherwise a small model call judges against the key →
`QuizVerdict3` + `detail` (what is right, what is missing, never the missing piece itself).
`not_yet` → status `incorrect`. Records the part (status, attempts+1, checked_by), and for
`complete`/`partial` writes one `quiz_outcomes` row per objective on the **notebook's** content key
(`questionId: tut:<fileId>:<partId>`, `kind: 'verdict'`, `source: 'doc_text'`, `form: 'open'`) so
the bar fills (full credit: hints never discount). Then calls the actor (S5, `kind: 'feedback'`).

### S5 · The actor's tutorial turn (E; called by B)

```ts
actor.tutorialTurn(input: {
  kind: 'hint' | 'refresher' | 'feedback' | 'reveal';
  level: HintLevel;                 // the rung for 'hint'; the part's current rung otherwise
  docId: string; contentKey: string; // the tutorial doc
  partId: string; partBlockId: string; label: string;
  anchorId: string;                 // the part's span thread (main finds or creates it, docId = tutorial doc)
  prompt: string; answer: string;   // PartAnswer.prompt; the learner's answer as text ('' if empty)
  key: PartKey;                     // hidden: never quoted before 'reveal'
  verdict?: { verdict: QuizVerdict3; checkedBy: 'simulation' | 'model'; detail: string };
  notes: { blockId: string; heading: string | null; text: string }[]; // linked notes blocks
  slides: { page: number; label: string; text: string }[];             // linked lecture pages
  objectiveId: string | null;
}): Promise<{ accepted: boolean; reason: 'busy' | 'no_doc' | null; threadId: string; turn: Promise<void> }>
```

Posts the learner's request line in the thread ("Hint on Problem 3 A) i."), runs one agent turn
decided in code (no orchestrator call): Max for hint/feedback/reveal unless `TUTOR_HELPER` is
`ellie`; Ellie for refresher. Citations in the chat are lecture pages. Then writes **one line**
(≤ 25 words) into the tutorial doc after the part's last child, as an agent insert with
`reason: 'tutor_hint'` and the usual pending Remove · Keep, through `docPortFor(contentKey)`, a new
`RoomActorDeps` member `docPortFor?: (contentKey: string) => DocPort` (wired in `main/ipc.ts` with
`createDocPort`). Does not record outcomes (main does). `reveal` ends by asking for one line on why.

### S6 · Help (B, A)

`tutorial:help`: `hint` → `nextHintLevel(record)` (A; `top` when already at 3); `refresher` and
`reveal` keep the rung. `reveal` sets status `revealed`, writes a `released` outcome row (fills
nothing). Finds/creates the part's span thread (as `notes:blockAction` does, with the tutorial
doc's `docId` and the part's `blockId`), builds the context (linked notes blocks' text from the
notebook doc, linked pages' text) and calls S5.

### S7 · Renderer (D1, D2)

- D1: `TutorialPane` hosts a `NotesEditor` on a **second `DocStore`** opened on the tutorial doc
  (`tutorial:doc`); `ThreeColumn`'s doc column splits notes | `PaneSplitter` | tutorial, width
  persisted; pop-out into a floating window (drag by header, resize from the corner, remembered);
  tabs for several tutorials; a pending/failed state with Retry; triggers page images +
  `tutorial:ingest` when a tutorial has no doc. Sources panel: a role badge and a "Use as" menu on
  each row, **Open** on a tutorial row, "Hidden: only used to check your answers" on solutions.
  The chat: a span thread whose `docId` is a tutorial doc focuses the part in the tutorial pane.
  The mock bridge implements every S2 channel with `FIXTURE_SHEET`.
- D2 exports from `pm/tutorial.ts`:

```ts
export interface TutorialChromeContext {
  part(partId: string): TutorialPartView | null;
  onHelp(partId: string, kind: 'hint' | 'refresher' | 'reveal'): void;
  onCheck(partId: string): void;
  onOpenNotesBlock(blockId: string): void;
  onOpenSlide(page: number, rect: DOMRect, anchor: HTMLElement): void;
  citation(pages: readonly number[]): string;
  notesHeading(blockId: string): string | null;
}
export function tutorialPlugins(ctx: () => TutorialChromeContext): Plugin[];   // node views + chrome
export function tutorialNodeViews(): Record<string, NodeViewConstructor>;
export interface PracticeChipsContext {
  tutorials(): TutorialView[];
  onOpenPart(fileId: string, partId: string): void;
}
export function practiceChipsPlugin(ctx: () => PracticeChipsContext): Plugin;  // main notes, under each H2 section
export function bumpTutorialChrome(tr: Transaction): Transaction;
```

  Node views: `tut_blank` an input sized to its value (typing updates `value` via `setNodeMarkup`,
  Tab/Enter move to the next blank, the authorship stamp is not needed: the attr is the learner's);
  `tut_choices` tick boxes (KaTeX in option text), updating `picked`; `tut_answer` a slot with a
  placeholder per kind. Part chrome (a header widget at the start of each `tut_part`; *amended 2026-10-04 after Lucas:
"too many buttons when not popped"*): one row of label · status word · **Check** · **Help ▾**. The
Help menu holds *Hint · next rung*, *Refresher* and *Show answer…* (inline confirm); hint dots appear
once a hint is used. *From the notes:* is one muted line of text links (sections · `p. 3–5`). A
card 600 px wide or more shows Hint and Refresher inline. `sheet_admin`
blocks folded under one "Course admin" toggle. `tutor_hint` lines styled as agent notes.
