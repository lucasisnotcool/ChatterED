# Folders and search: find anything you already studied, offline, in under 100 ms

**Status.** Decided and built, 3 Oct 2026, on branch `lucas/folders-search`. Lucas approved the
measured proposal and the mockup (revision 2) the same day. This brief is the **source of truth**
for folders and search. It adds two things to `notebooks.md` (1 Oct) and changes nothing that
brief decides. §9 records what the build measured.

**Constraints from Lucas, 3 Oct.**
- Search works offline. Only Ellie and Max need the network.
- Search reaches everything visible in a notebook: the slides and the notes doc. It does not reach
  the chats.
- Folders are a Finder-style tree.
- The results screen has three adjustable columns: the slide or page of the top or selected hit,
  the notes segment of the top or selected hit, and the search box with its hit list.

---

## 0. The idea in one box

A learner who half-remembers something types it, for example "properties of hueristic", typo
included. Within one frame the screen shows **the notes block that answers it, highlighted inside
its notebook**, with **the slide it came from** beside it. The search looks in the open folder and
every folder inside it.

How it works:
- One small embedding model, bundled with the app, runs on the learner's machine.
- The index is built from the notes doc's own structure (blocks, headings, the learner's labels),
  not from fixed-size windows.
- No language model runs when a query is typed.

## 1. Folders

- **A folder holds notebooks and other folders.** Each notebook sits in exactly one folder, or at
  the top level. The Notebooks home becomes a folder view: a breadcrumb, then subfolders, then
  notebooks.
- **Moving.** Drag a notebook or folder onto a folder or a breadcrumb segment, or use **Move to…**
  in the context menu. A move that would put a folder inside itself is refused.
- **Deleting a folder moves its contents up one level.** Notebooks are only ever deleted by
  name, from their own context menu, as today. A folder delete must never take a semester of notes
  with it.
- **Search scope is the folder you are in, plus everything below it.** At the top level that is
  every notebook. The scope is shown as a chip in the search box and can be widened to "All".
- **Data model** (migration `025_folders_search.sql`):
  - `folders(id 'fd_<12hex>', parent_id → folders.id, name, ord, created_at, updated_at)`
  - `notebooks.folder_id → folders.id` (nullable)
  - The subtree comes from a recursive CTE. With tens of folders this is cheap.

## 2. What is indexed

"Visible content" is everything the learner can read in a notebook except the chats:

| Source | Indexed as | Notes |
|---|---|---|
| Slide and page text (`file_text`, one row per page) | one chunk per page | normalised, footers stripped, deck title and page number as header |
| Notes doc: AI-written lines, Ellie's notes, **the learner's own text**, Q blocks (Max's question, the learner's answer, the feedback), tables, diagrams, flashcards, figure captions, formulas (TeX) | **block groups**, plus one vector per block for the highlight (§3) | from `doc_json`; the author mark labels each hit |
| Overview metadata (`overview_json`: greeting, starter questions) | not indexed | shown in chat, not in the doc |
| Chats, whispers, threads | not indexed | Lucas's constraint |

## 3. Chunking

Each rule below was measured (§7). Rules marked *measured* changed the numbers; the others prevent
known failure cases.

1. **Normalise first** (*measured*).
   - Apply Unicode NFKC. Slide text from PDFs uses math italics such as `𝐹𝑙𝑦(𝑃, 𝑆𝐹𝑂, 𝑆𝐼𝑁)`, which
     neither keyword nor embedding search matches against "Fly" until it is normalised.
   - Collapse KaTeX copy-paste doubling (`h(s)≤h∗(s)h(s)≤h∗(s)`).
   - Strip lines that repeat on at least 40% of a deck's pages after digits are masked (the
     footer "Real World Planning and Acting 30").
   - Drop exact-duplicate blocks within one doc.
2. **Contextual header on every chunk** (*measured*).
   - Notes chunks get `Doc title › section › label`. Slides get `Deck title — slide N`.
   - This is Anthropic's "contextual retrieval" without the language model: the doc already has
     the structure, so no extra model call is needed.
3. **Block groups, never across a heading** (*measured*: best top-hit rate).
   - Consecutive top-level blocks under one heading path are merged until a group reaches 40 words
     (cap 220).
   - A group never crosses a heading or a blank paragraph.
   - The typical group is 50–70 words, about one idea.
4. **The learner's labels become sub-headings** (*measured*).
   - A paragraph of five words or fewer with no closing punctuation (the learner's "PREREQ:
     HUERISTICS") heads the blocks after it, up to the next blank paragraph.
   - Without this, the learner's list of heuristic properties never contains the word
     "heuristic" and is missed.
5. **Q blocks drop Max's preamble** (*measured*).
   - "Here's a question on the p. 17 example, so it's the statement I'm testing, not you" opens
     every Q block, and makes all Q blocks look alike to the model.
   - The index keeps the question itself, the learner's answer and the feedback.
6. **Composite blocks are split** (*measured*).
   - Flashcard sets are indexed one card at a time, with the set title. Tables are indexed one row
     at a time, with the caption and header row.
   - A hit still opens the whole block. Without the split, "closed world assumption" was buried
     inside a twelve-card set.
7. **Small-to-big highlight** (*measured*: best block-level precision).
   - Rank by group. Inside the top group, highlight the block whose own vector scores highest, and
     jump to it.
   - This keeps the group's context for ranking and still points at one block.

## 4. Embedding and retrieval

- **Model: EmbeddingGemma-300m, ONNX q4 (193 MB), bundled in the app**, so search works on first
  launch with no network.
  - Prompts: `task: search result | query: ` for queries, `title: none | text: ` for chunks.
  - 768 dimensions. Matryoshka truncation to 512 scored the same, so it is available if a library
    grows large.
  - q4 scored the same as full precision on both query sets (§7).
- **Runtime: `@huggingface/transformers` (v4, onnxruntime-node, CPU) in an Electron
  `utilityProcess`.** Measured on an M4 Pro:

  | What | Measured |
  |---|---|
  | Model load | 0.7 s |
  | Memory after load | about 450 MB |
  | Query (warm, p50) | 7 ms |
  | Brute-force cosine, 5k vectors × 768 | 6 ms |
  | Brute-force cosine, 50k vectors × 768 | 32 ms |
  | Indexing | about 80 ms per chunk (a 60-slide deck plus notes is about 15 s) |

  - The process is loaded on first use and shut down after a period of no use.
  - A native ONNX crash then cannot take down the app. Electron-specific crashes of
    onnxruntime-node are reported, and isolating it in a utility process is the known workaround.
- **Vectors** are BLOBs in an ordinary table, loaded into one `Float32Array` per scope. No
  sqlite-vec: brute force is fast enough well past any realistic library.
- **No reranker and no keyword fusion in the ranking** (*measured*).
  - Fusing BM25 with Gemma at equal weight cost 3–6 points of top-hit rate, and at half weight it
    still cost 3–6.
  - The best reranker (bge-reranker-v2-m3) helped one query set and hurt the other, and takes over
    a second per query. The fast ones (Ettin 17M and 32M) did not help.
- **FTS5 keyword search stays only as a fallback** for notebooks whose vectors are not built yet.
  The existing `file_text` table already covers slides. It needs the typo expansion below.
- **Typo expansion (FTS fallback only).** A query word that is rare in the corpus is expanded with
  near neighbours that are at least five times more frequent ("hueristic" → "heuristic"), rather
  than corrected only when unknown. This matters because the learner's own notes contain the
  misspelling.
- **Freshness.**
  - Chunks are keyed by notebook, `notes_docs.version` and a hash of the chunk text. After a save,
    and a short debounce, only changed chunks are re-embedded.
  - Slides are embedded when a source reaches `ready`.
  - Every writer of `doc_json` bumps `version`, so one check covers ingest, overview, agent edits
    and learner saves.
- **Latency per keystroke:** an 80 ms debounce, then 7 ms to embed, under 10 ms of cosine, then
  render. Well under 100 ms.

## 5. The results screen

- **A page of its own, opened from the left rail** (Lucas, 3 Oct). Search is a new rail item
  directly under Notebooks (⌂), and ⇧⌘F opens it from anywhere. It opens a new `Screen` value
  (`'search'`), not a panel inside the notebook view. Coming back keeps the last query, the selected
  hit and the column widths.
- **The slide and notes columns can be resized and collapsed** (Lucas, 3 Oct). Each collapses to a
  thin labelled strip. When both are collapsed, the hit list takes the full width.
- **Mockup for review:** the published artifact "ChatterED Search Mockup" (private to Lucas).

Three columns, in the order slides, notes, search, using the existing `PaneSplitter` with a
wider grab zone and a visible handle. Agreed with Lucas on 3 Oct, from revision 2 of the mockup:

| Column 1: slides | Column 2: notes | Column 3: search |
|---|---|---|
| The **whole deck** of the hit, rendered as pages and scrolled to the hit slide. The hit slide has a border, and its matching lines are outlined where `bestRegion` finds them. | The **whole notebook doc**, scrolled to the hit's block and highlighted. It is **editable in place**, and saves like the notebook. | Search box, scope chip, filters (All, Notes, Slides), then the hit list. |

- **The hit list is one list, best match first.** It ranks notes and slides together across
  notebooks.
  - Each row has a slide or note icon, the notebook and section (or slide number), and a two-line
    snippet.
  - There are **no ownership labels** (Your words, Ellie, Max) and no "your words" filter.
  - Slides that are identical in two decks collapse into one hit, marked "also in".
- **Before a hit is picked**, column 1 shows the best-matching slide and column 2 the best notes
  hit. Picking a notes hit shows the slide that block came from: the block's `pages`, else its
  section's, choosing the page that scores highest for the query. Picking a slide hit scrolls
  column 2 to the blocks that cite that page.
- **Keyboard.**
  - ⇧⌘F (View ▸ Search All Notebooks) opens search from anywhere. ⌘J, ⌘K and ⌘L show or hide the
    slides, notes and results columns, on the search page only.
  - ↑/↓ moves through hits from the search box.
  - **↵ (or a double-click) keeps the learner on the search page** and puts the cursor in column 2
    at the hit block. Esc returns to the search box.
  - "Open notebook" in column 2's header goes to the notebook view, where Ellie and Max are.
- **Text size of the notes.** Ctrl/⌘ + − 0 with the pointer or cursor in column 2, or its A− A+
  buttons, scale the notes only. In the app this is the viewer zoom of `lib/viewer.ts`: column 2
  registers as the viewer while the search page is open.
- **No enlarge control on slides.** The learner sizes them with the dividers. Both columns
  collapse to a labelled strip.
- **No search box on the Notebooks home.** The rail icon and ⇧⌘F are the only ways in.
- **Implementation.**
  - Column 2 is the real notes editor, bound to the hit's notebook. The notebook view and the
    search page are never on screen together, so the one `DocStore` moves between them rather
    than being shared.
  - Switching to a hit in another notebook loads that notebook's doc.
  - Agents do not run on the search page. Edits there are the learner's alone.

## 6. Risks and open points

- **Licence.** EmbeddingGemma is under the Gemma Terms of Use, not Apache-2.0. Redistribution is
  allowed if the terms and the use policy are passed on.
  - Fine for NUS-internal use. Needs a decision before any wider distribution.
  - The best Apache-2.0 alternative measured, gte-modernbert-base (143 MB), scored .82 / .70 on
    top hit against .88 / .97 for the proposal.
- **App size.** The DMG grows by about 193 MB for the model, plus the onnxruntime-node binary.
- **The slide viewer is being rebuilt on `main`** (SlideModal removed, `rasterise.ts` and
  `sourcepop.ts` changed, uncommitted as of this brief). Column 1 is built on `SlideSource` once
  that lands, not on the old modal.
- **Weak spots that remain** (§7):
  - Procedural queries ("how to refine an HLA") put the definition first and the algorithm slide
    third.
  - Thin ingest one-liners ("Abstraction shrinks the air cargo state count") win over the slide
    that holds the detail. The linked columns soften this.
- **Duplicated windows in two docs.** Lecture-rational-utility and CS3249 Lecture 4 repeat every
  heading block twice in `doc_json`. Search de-duplicates them, but this looks like an ingest bug
  worth its own issue.

## 7. Evaluation

**Corpus.** Lucas's own app data, read-only: 7 notebooks, 256 slide pages, 823 doc blocks.

- Queries focus on the two notebooks he studied in and extended: Lecture-complex v4.0 (more of
  the learner's own text than ingest text) and Lecture-classic v4.0.
- The other five notebooks stay in the index as distractors.

**Queries.**
- **Main set:** 40 queries written for the task, including the two from the request.
- **Held-out set:** 30 queries written separately by an agent that read only the notes and slides.
  It overlaps the main set in topic, so it is a paraphrase check, not an independent sample.

**Judging.**
- Pooled top results from every system (about 3,300 query–passage pairs) were graded 0/1/2 by
  blind LLM assessors on whether the passage answers the query. Spot checks of the two headline
  queries agreed with a human reading.
- Every reported system has all of its top 5 judged.

**Metrics.**
- **S@1:** the top hit answers.
- **A@3:** an answer is in the top 3.
- **MRR**, and **aMRR**: MRR after unrolling each hit into its blocks, which penalises large chunks.
- **N@1 / P@1:** the top notes hit and the top slide hit each answer (columns 2 and 1).
- **w@1:** words in the top hit (reading cost).

Selected results (main / held-out):

| System | S@1 | A@3 | MRR | aMRR | N@1 | P@1 | w@1 |
|---|---|---|---|---|---|---|---|
| BM25, single blocks (B1) | .55 / .73 | .90 / .83 | .72 / .78 | .72 / .78 | .59 / .73 | .59 / .54 | 47 |
| BM25 + typo expansion, groups with labels (G2) | .72 / .77 | .95 / .90 | .84 / .84 | .64 / .57 | .74 / .83 | .59 / .54 | 67 |
| bge-small (33M), G2 | .80 / .77 | .90 / .93 | .86 / .86 | .73 / .71 | .74 / .77 | .62 / .69 | 78 |
| Qwen3-Embedding-0.6B, G2 | .80 / .73 | 1.0 / .90 | .90 / .83 | .78 / .71 | .82 / .87 | .68 / .62 | 73 |
| gte-modernbert-base (Apache-2.0), G2 | .82 / .70 | 1.0 / .93 | .91 / .81 | .82 / .70 | .68 / .73 | .78 / .58 | 70 |
| EmbeddingGemma-300m, single blocks (B1) | .78 / .90 | .97 / .93 | .88 / .93 | .88 / .93 | .79 / .90 | .78 / .73 | 51 |
| EmbeddingGemma-300m, naive 120-word windows | .93 / .87 | 1.0 / .97 | .96 / .92 | .85 / .77 | .82 / .77 | .78 / .73 | 100 |
| EmbeddingGemma-300m, G2 | .85 / .93 | .97 / .97 | .92 / .95 | .75 / .76 | .91 / .97 | .78 / .73 | 66 |
| EmbeddingGemma, G2, ONNX q4 (what ships) | .88 / .93 | .97 / .97 | .93 / .95 | .76 / .74 | .91 / .97 | .76 / .69 | 70 |
| G2 + BM25 fused (RRF, equal weight) | .82 / .87 | 1.0 / .90 | .90 / .90 | .75 / .66 | .79 / .90 | .70 / .73 | 72 |
| G2 + bge-reranker-v2-m3 (568M, >1 s) | .97 / .90 | 1.0 / .97 | .98 / .93 | .88 / .64 | .91 / .90 | .81 / .81 | 86 |
| G2 + small-to-big highlight (rule 7) | .85 / .93 | .97 / .97 | .92 / .95 | .89 / .95 | .91 / .97 | .78 / .73 | 66 |
| **+ Q-block preamble and composite split (rules 5–6): proposed** | **.88 / .97** | **.97 / .97** | **.93 / .97** | **.91 / .97** | **.94 / .97** | **.78 / .73** | **62** |

How to read it:

- **The model matters most.** EmbeddingGemma beats every model of similar or smaller size here,
  and also beats the larger Qwen3-0.6B.
- **Structure-aware groups win overall, but not on every number.** Naive 120-word windows have the
  best main-set top hit (.93). They lose on the held-out set (.87 against .97). They cost 100
  words per hit against 62. They score well partly because a window is credited for any of the
  four to six blocks it spans: once unrolled into blocks, aMRR is .85 / .77 against .91 / .97. And
  a window crosses section boundaries, so it cannot point column 2 at one block. Single blocks are
  precise but lose on the top hit, because one block often lacks the context that makes it match.
- **Keyword fusion and reranking do not pay for themselves** on this corpus and query style.
- **The headline queries.**
  - "properties of hueristic" opens column 2 on the learner's own Consistent and Admissible
    entries, with the Informative entry next.
  - "how to refine HLA" returns the primitive-vs-HLA explanation, then the HLA slide (36), the HTN
    algorithm slide (31) and the HTN loop. All are relevant, but the steps are third, not first.

The evaluation harness (extraction, chunkers, BM25, dense, pooling, scoring) is outside the repo,
because its corpus is copyrighted slides and personal notes. Step 6 of §8 ports it as a local
regression check that reads the app's own index.

## 8. Build plan (branch `lucas/folders-search`)

1. **Folders.** Migration `025`, with `folders` in the notebooks service, IPC and preload; the
   mock bridge; a folder view in `NotebookHome`; move and delete as in §1. Tests: migration,
   service (cycles, delete moves contents up), mock.
2. **Chunker.** `app/src/shared/search/chunk.ts` is pure, applies rules 1–7 to `doc_json` and page
   text, and is unit-tested on fixtures.
3. **Embedder.** `app/src/main/search/embedder.ts` runs in a `utilityProcess`. The model ships
   under `extraResources`. Changes to `electron-builder.yml` (asarUnpack onnxruntime-node) and
   `package.json` are coordinated with the work in progress on `main`.
4. **Index service.** The `search_chunks` table (vector BLOB, text hash, model id), version-driven
   re-indexing, the FTS fallback with typo expansion, and the `search:query` IPC.
5. **Search screen.** A new `Screen` value, three columns, hit list, linked slide and notes
   columns, keyboard flow, ⇧⌘F and ⌘J/⌘K/⌘L.
6. **Regression check.** A local eval script reports S@1 and N@1 for the query set against the
   app's own index, so a later change to the chunker or model is measured, not guessed.

## 9. As built (3 Oct 2026)

| Piece | Where | Measured |
|---|---|---|
| Folders | migration 026, `shared/folders.ts`, `main/notebooks/*`, `NotebookHome.svelte` | Moves, nesting, delete-moves-up and the scope query tested. Driven live: New folder, Move to…, drag onto a tile and onto the breadcrumb. |
| Chunker | `shared/search/chunk.ts` | Rules 1–7, plus a quiz indexed by prompt and options only. Its answer key and explanation stay hidden until answered. |
| Embedder | `main/search/embedder*.ts`, `scripts/fetch-model.mjs` | EmbeddingGemma q4 pinned at a revision and verified by sha256, bundled under `Resources/models`. Runs in a `utilityProcess` and survives a SIGKILL. Indexing batches of 4, so a query waits about 0.2 s at most. |
| Index | migration 027, `main/search/index.ts` | Your 7 notebooks: 523 chunks indexed in about 35 s, then 350 units. Warm queries take 9–12 ms in main and 11–21 ms round trip. With no model, keyword search answers instead (BM25 with typo expansion). |
| Search page | `components/search/*`, `lib/searchlayout.ts`, `lib/searchstore.svelte.ts` | Driven live on a copy of the real profile (see the commit message of the search page). |

Behaviour that differs from §1–§5, or adds to them:

- **The shortcut is ⇧⌘F**, because ⌘K became the notes column's toggle (Lucas, 3 Oct).
- **Leaving a notebook for search closes it** as going home does (Max's open question is released).
  The notes are saved on the way out.
- **Edits are saved when the editor unmounts.** `DocStore.detach()` used to drop any edit made in the
  last 800 ms before an unmount, and the notebook view had the same problem before this work. It
  now starts the save before the view goes.
- **A short label paragraph is never the highlighted block** while its group has a block with
  content.

**Migration numbers.** 026 and 027 are taken by this branch. Another session adding a migration on
`main` before this merges must renumber one side. The runner is keyed on `user_version`, so two
different files both numbered 026 would mean one of them never runs on a database that already has
the other.

## 10. Stored explain comments (7 Oct 2026, branch `lucas/explain-comments`)

**Why.** Lucas's open-book exam: Ellie needs the network, search does not. A block can carry a
stored *explain* comment (what Ellie would answer to Explain on that line), written ahead of time
by a runner outside the app and imported headless. Search is the main way in during the exam, so
it shows a hit block's explain and can match on it.

- **Storage.** Migration 033: `block_comments(doc_id, block_id, kind 'explain', body, text_sha,
  model, created_at, updated_at)`, unique on (doc, block, kind), beside `doc_json`, never in it.
  `text_sha` is stored as the writer computed it and never compared (no staleness check).
  **Known limitation:** so a learner who edits a commented line still sees the old explain, written
  for the text as it was, until the comments are re-imported. The
  same migration widens `search_chunks.kind` with `'explain'`.
- **Import.** `node app/scripts/import-comments.mjs --db <app.db> --in <file.jsonl> [--dry-run]
  [--no-backup] [--force]`, app quit. Like the headless Duplicate, it refuses while the app holds
  the database (`SingletonLock`), backs it up to `backups/before-import-comments-<time>.db`, and
  migrates it with the app's own runner (plus the 032/034 safety net), so a database an older
  build left at 032 needs no "open the new build once" first (`main/notes/importcommentscli.ts`).
  `--dry-run` runs on a scratch copy and writes nothing. A line whose doc or block does not exist
  is skipped and reported.
- **In the notes.** A badge (Ellie's dot and "Explain") in the right gutter of each commented block
  at any depth, before the provenance chip, opens the explain in a popover with KaTeX. It folds to
  its dot while the line is hovered so the chip keeps its room; in a compact sheet it is the dot,
  under the toolbar's handle.
- **In search.** Each hit carries its block's explain (`SearchHit.explain`), shown as an expandable
  badge in the hit list and as a panel above the notes column. `via: 'explain'` says the hit came
  from the explain ("Matched Ellie's explanation").
- **Matching, one switch** (`ExplainMode`; setting `search_explain_mode`, or the env var
  `CHATTERED_SEARCH_EXPLAIN`; default `DEFAULT_EXPLAIN_MODE` in `shared/search/types.ts`, one
  constant to flip, now `append`):
  - `off`: as before 033; explains are shown, never matched.
  - `append`: each note chunk's embedded text, and each block unit's, gets its blocks' explains
    appended (a list's items included); the text and snippet are the notes'. Every commented chunk
    re-embeds. `via` is a heuristic here: the query's words are in the explain and none in the text.
  - `separate`: each explain is a chunk of its own (`explain:<notebook>:<block>`, embedded as the
    header plus the explain) that resolves to its block; note chunks are untouched, so their vectors
    are kept. A block's explain hit and its group's note hit are one hit, whichever ranks first:
    the explain's block is mapped to the note chunk that holds it, so a comment on a list item and
    the hit for its list are one hit too.
- **Shared code.** The rows a notebook indexes (`shared/search/build.ts`) and the ranking
  (`shared/search/rank.ts`) moved out of `main/search/index.ts`, so the eval runs the same code.
- **The eval (§8 step 6).** `node app/scripts/search-eval.mjs --db <app.db> --queries <q.json>
  --mode off|append|separate|all [--folder <id>] [--map slug=nb_…,…] [--model-dir …] [--verbose]
  [--json out.json]`, read-only. S@1, S@5, MRR and N@1, overall and by query `kind`. A hit is
  correct when it is in the query's notebook and its pages meet `gold_pages`. Vectors are cached by
  text hash and seeded from the database's own index; on a copy of the 7 Oct database every
  `off`-mode row hash matched the app's index, so the eval chunks exactly as the app does. Which
  mode ships should be decided on the real query set, not the five-query smoke test.
- **Measured, 7 Oct 2026, and why the default is `append`.** 84 exam-style queries (12 per notebook:
  method, definition, formula, compare, tutorial) were written blind from the slides, before any
  explain existed, over the 7 CS4246 notebooks with 4,090 stored explains:

  | Notes | S@1 | S@5 | MRR | N@1 | N@1, tutorial |
  |---|---|---|---|---|---|
  | the original notes (before the dense rewrite), `off` | .869 | .976 | .923 | .762 | .143 |
  | dense concept-card notes, `off` | .881 | .988 | .930 | .881 | .714 |
  | dense notes + explains, `append` | **.940** | .988 | **.964** | **.929** | **.857** |
  | dense notes + explains, `separate` | .845 | .976 | .901 | .845 | .786 |

  `separate` lets an explain outrank the notes block it explains, and explains of neighbouring
  lines crowd each other; folding them into the block's own text (`append`) helps every query kind
  and hurts none. 84 queries is a small set: `append` vs `off` is 5 queries at S@1.
- **Tutorial sheets (7 Oct 2026, branch `lucas/search-tutorials`).** Search is the way in during
  the exam, so it reaches each notebook's tutorial sheets' docs too (`TUTORIAL-CONTRACT.md` S2: a
  source with the role `tutorial` and its own `notes_docs` row). `tutorialChunks` makes **a part one
  group**: the sheet's question, the learner's answer (slot, blanks, ticks) and Ellie's solution
  blocks (`reason: 'exam_prep_solution'`, inside the part or right after it), never across two
  parts, split at a block only past 300 words; header `Sheet title › part label`. The problem's
  stem groups as notes do (rule 3); the title, the course housekeeping (`sheet_admin`) and Max's
  check and hint lines (`tutor_hint`) are left out. Explains on a sheet's lines (keyed by the
  sheet's doc) are read in the same `ExplainMode`. Keys are `tut:<notebook>:<file>:<block>` (kind
  `note`, so no migration), and a hit carries `tutorial: { fileId, title, label }`: the list labels
  it "Tutorial 2 · Problem 1 Part B" with its own icon and a **Tutorials** filter, and the notes
  column opens that sheet (`TutorialColumn`, the tutorial store's `DocStore` and part chrome) at the
  block, with the explain panel; Check and help there, and *Open in notebook*, open the notebook
  with the tutorial column at that part. Freshness: each sheet's doc version and the sources' roles
  are in the notebook's signature, so a save, a re-read or a role change re-chunks it. The eval
  indexes the sheets as the app does (`--no-tutorials` leaves them out). On the 84-query set
  before the solutions were written (4 sheets, 84 sheet chunks), `append` is unchanged with the
  sheets in (S@1 .940, N@1 .929), and 9 queries have a sheet's part in the top five; re-run it once
  the solutions and their explains are imported.
