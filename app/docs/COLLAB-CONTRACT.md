# The collab-doc build contract

**What this is.** The shared shapes and the file ownership for the collaborative notes doc pivot
(#48). The product decisions are in `docs/research/collab-doc.md` and that brief wins any argument
about *what*; this file settles *who builds which file against which signature*.

Six tracks build in parallel **in one working tree**. That only works if these rules hold.

## Rules for every track

1. **Touch only the files your track owns** (below). Read anything. If you need a change in a file
   you do not own, do not make it: write the request into your final report and code around it.
2. **Frozen after day 0** (the lead's files; nobody edits them): `src/shared/doc/types.ts`,
   `src/shared/docevents.ts`, `src/shared/ipc.ts`, `src/shared/types.ts`, `src/shared/cost.ts`,
   `src/preload/index.ts`, `src/main/ipc.ts`, `src/main/dochost.ts`, `src/room/docport.ts`,
   `src/renderer/lib/store.svelte.ts`, `src/main/db/migrations/020_notes_docs.sql`,
   `package.json`.
3. **Nothing is deleted during the parallel phase.** The old flow UI keeps compiling; the lead
   removes it in one commit at the end.
4. **Commits are scoped and path-limited**, because other agents are committing beside you:
   `git add <your exact paths> && git commit -m "…" -- <your exact paths>`. Never `git add -A`, never
   `git add .`, never `git commit -a`, never stash, never reset, never checkout another track's
   file. If `.git/index.lock` exists, wait a few seconds and retry. Commit early and often (work
   that exists only in your context is lost if the session limit hits).
5. **Commit messages** follow the repo: a plain descriptive subject (no `feat:` prefixes), a body
   that says why, what was verified and what is left, `#48`, and the last line
   `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
6. **Verify your own files.** `npm run typecheck`, `npm run lint` and `npx vitest run <your test
   files>` from `app/`. Other tracks' half-built files may fail typecheck while you work: read the
   output for *your* paths, and do not fix theirs.
7. **Subagents:** if you use the Agent tool, pass `model: "opus"` (or `"sonnet"`/`"haiku"`)
   explicitly. Never omit it.
8. **Shell traps:** zsh (quote globs; end inspection chains with `; :`); no `timeout` on macOS;
   foreground `sleep` is blocked; paths under `Academia/Sources/` contain spaces.
9. No participant data: never read `docs/research/ai-use-transcripts/raw` or `processed`.
10. Match the surrounding code: its comment density (this codebase comments *why*, at length),
    naming and idiom. Svelte 5 runes as `store.svelte.ts` uses them.

## The tracks

| Track | Builds | Owns |
|---|---|---|
| **T2 model** | The pure ProseMirror document model | `src/shared/doc/{schema,ops,guard,suggest,validate,inline,mention,progress}.ts` + tests |
| **T1 ingest** | Two-pass notes ingest, persistence, the actor's doc port, page images, the CLI lane | `src/main/notes/**`, `src/main/db/repos/notes.ts`, `src/main/vault/pagecache.ts`, `src/main/llm/claude-cli.ts`, `src/room/llm/{types,anthropic}.ts` + tests |
| **T3 rules** | Orchestrator rules, actor, classifier, prompts, pitch, the doc-edit call, scripted script | `src/room/**` except `src/room/llm/{types,anthropic}.ts` and `src/room/docport.ts` + tests |
| **T6 chat-main** | Chat / private-thread / progress IPC bodies, threads and outcomes repos, doc-text attempts | `src/main/docroom/**`, `src/main/db/repos/{threads,outcomes}.ts` + tests |
| **T4 editor** | The editor host, cursors and typing, Remove·Keep, suggestions, provenance chips, figures, carousel, modal, Freeze, Ctrl+E, page rasteriser | `src/renderer/components/notes/**`, `src/renderer/lib/docstore.svelte.ts`, `src/renderer/lib/pm/**`, `src/renderer/lib/typing.ts`, `src/renderer/lib/rasterise.ts` + tests |
| **T5 shell** | Three-column shell, chats, mentions, progress bar, lesson cards, mock bridge | `src/renderer/App.svelte`, `src/renderer/components/shell/**`, `src/renderer/lib/{chatstore,progressstore}.svelte.ts`, `src/renderer/lib/mockBridge.ts`, `src/renderer/lib/mockNotes.ts` + tests |

`PdfViewer.svelte` and `lib/pdfview.ts` are read-only for everyone: T4 builds its own small page
renderer for the carousel, modal, figures and rasteriser on `pdfjs-dist` directly, reusing
`pdfview.ts`'s pure functions.

## `src/shared/doc/` — signatures (T2 implements; everyone else imports)

```ts
// schema.ts
export const notesSchema: Schema;
//  nodes: doc(block+) · paragraph · heading{level} · bullet_list · ordered_list{start} ·
//         list_item · code_block{lang} · math_block{tex} (atom) ·
//         q_block{questionId, askedBy, status:'open'|'resolved', resolution, objectiveId} (content block+, isolating) ·
//         slide_figure{page, rect, caption, evidentiary} (atom) · text
//  every block-level node carries attrs: blockId (required) · pages:number[] · reason:string|null · objectiveIds:string[]
//  list_item carries blockId only.
//  marks: strong · em · code · math_inline{tex} ·
//         author{by: DocAuthor, editId: string|null, at: number}   ← on EVERY text span; the guard reads nothing else
//         suggest_ins{suggestionId, by} · suggest_del{suggestionId, by}
export function newBlockId(): string;                                   // `b_<12 hex>`
export function blockPos(doc: Node, blockId: string): { pos: number; node: Node } | null;
export function docOutline(doc: Node): OutlineEntry[];
export function docOutlineNear(doc: Node, blockId: string | null, radius?: number): OutlineEntry[];
export function blocksForPages(doc: Node, pages: readonly number[]): string[];
export function docFromJson(json: unknown): Node;                       // throws on an invalid doc
export function emptyDoc(title: string): Node;
export function learnerSpans(doc: Node): { blockId: string; from: number; to: number; text: string }[];

// inline.ts — the closed inline subset (**bold**, *em*, `code`, $tex$) ⇄ PM inline content
export function inlineToNodes(schema: Schema, text: string, author: DocAuthor, editId: string | null): Node[];
export function nodesToInline(fragment: Fragment): string;

// ops.ts
export interface ApplyResult {
  tr: Transaction | null;
  status: 'applied' | 'rejected_guard' | 'no_change';
  blockIds: string[];               // what the edit created or touched
  conflicts: LearnerConflict[];     // non-empty ⇒ part of the batch was held back for learner text
  suggestion: Suggestion | null;    // set when the batch (or its held-back part) became a suggestion
}
export function applyBatch(state: EditorState, batch: AgentDocOpBatch, opts: { frozen: boolean; docId: string; now: string }): ApplyResult;
export function draftToNodes(schema: Schema, drafts: DocBlockDraft[], author: DocAuthor, editId: string | null): Node[];
export function removeEdit(state: EditorState, edit: Pick<DocEditRecord, 'editId' | 'blockIds'>): Transaction | null;
export function keepEdit(state: EditorState, edit: Pick<DocEditRecord, 'editId' | 'blockIds'>): Transaction | null;
export function appendWindow(state: EditorState, afterBlockId: string | null, blocks: DocBlockDraft[]): Transaction;

// guard.ts — brief §5.4: "the guard is code"
export interface LearnerConflict { blockId: string; from: number; to: number; text: string }
export function learnerConflicts(state: EditorState, tr: Transaction): LearnerConflict[];
export function isLearnerRange(doc: Node, from: number, to: number): boolean;

// suggest.ts
export function suggestReplace(state: EditorState, input: { suggestionId: string; by: AgentAuthor; blockId: string; quote: string; replacement: string }): Transaction | null;
export function acceptSuggestion(state: EditorState, suggestionId: string): Transaction | null;
export function rejectSuggestion(state: EditorState, suggestionId: string): Transaction | null; // learner text byte-identical after

// validate.ts — used by the ingest in main; no view, no DOM
export interface ValidationIssue { index: number; reason: 'no_provenance' | 'bad_page' | 'empty' | 'unknown_kind' }
export function validateDrafts(input: unknown, pageCount: number): { blocks: DocBlockDraft[]; issues: ValidationIssue[] };
export function draftsToDocJson(title: string, blocks: DocBlockDraft[]): unknown;   // PM JSON, author = 'ingest'
export const DRAFT_BLOCK_JSON_SCHEMA: Record<string, unknown>;          // JSON Schema for DocBlockDraft[], for `jsonSchema` calls

// mention.ts
export function parseMention(text: string): Mention | null;

// progress.ts
export function progressFill(outcomes: readonly QuizOutcome[]): ProgressFill;  // best learner verdict; 'released' fills nothing
```

**The guard's contract, as tests:**
1. `insert_after` / `insert_before` / `insert_q` / `resolve_q` never conflict: they only add.
2. `replace_block`, `remove_block`, `append_to_block` on a block holding any `author.by === 'user'`
   text: `replace_block` → a suggestion (`suggest_del` over the learner text, `suggest_ins` of the
   agent's); `remove_block` → dropped, `rejected_guard`; `append_to_block` → relocated to an
   `insert_after` of the same block.
3. Rejecting a suggestion leaves the learner's text **byte-identical** in the serialised doc.
4. `frozen` ⇒ `status: 'no_change'`, nothing applied, nothing queued.
5. An ingest window only ever appends after the previous window's last block (`appendWindow`); it
   never touches an existing block.
6. An agent may freely rewrite, move and merge text whose `author.by` is `ingest`, `ellie` or `max`.

## IPC and events

The channel list and payloads are in `src/shared/ipc.ts` (search `collab-doc`); the push events are
`DocRoomEvent` in `src/shared/docevents.ts`, carried on the one `RoomEvent` stream. Handlers are
registered from three modules, each the body of one hook the lead placed in `AppService.register()`:

| Hook | Module | Track |
|---|---|---|
| `registerNotesIpc(host, handle)` | `src/main/notes/ipc.ts` | T1 |
| `registerDocRoomIpc(host, handle)` | `src/main/docroom/ipc.ts` | T6 |
| `registerProgressIpc(host, handle)` | `src/main/docroom/progress.ts` | T6 |

`host` is a `DocHost` (`src/main/dochost.ts`): the database, the store, the vault, the segment
service, `emit`, the LLM factory, and `openFlowRoom(fileId)` / `actorFor(roomId)`.

The actor reaches the doc through **`DocPort`** (`src/room/docport.ts`): `outlineNear`, `frozen`,
`docId`, `recordEdit`, `recordOutcome`. T1 implements it (`src/main/notes/docport.ts`); T3 calls it.

## Who calls whom

```
renderer (T4 docstore) ── notes:get / notes:ingest / notes:save / notes:pageImages ──► T1
renderer (T5 chatstore) ─ chat:* / quiz:pass / progress:* ──────────────────────────► T6 ──► actor (T3)
actor (T3) ── DocPort.outlineNear ─► T1      actor ── docedit call ─► LLM ─► emit doc.edit ─► T4 applies via T2
T4 ── notes:editResolved / notes:suggestionResolved / notes:docText ─► T1 / T6
T6 ── notes:docText ─► synthetic `doc_text` learner message ─► actor.assessDocText (T3)
```

Agreed signatures across tracks:

- **T4 → T5:** Ctrl+E calls `store.chat.openSpanThread({ blockId, quote })` and nothing else: T5
  opens a *draft* span thread in the chat column, focused, with the quote as a chip; the learner
  types the question there, and T5 calls `chatOpenSpan` on send. T4 draws the persistent span
  highlights from `store.chat.spanThreads: { threadId, blockId, quote }[]` (read-only, verbatim
  text match inside the block); a highlight click calls `store.chat.focusThread(threadId)`. **T5 → T4:** a thread's "jump" and the lesson card's
  Start call `store.doc.scrollToBlock(blockId)`; "insert into the document" needs
  `store.doc.caretBlockId()`.
- **T6 → T3 (methods T3 adds on `RoomActor`):**
  `sendMessage(text, anchorId, context?, origin?)` (exists; the mention is parsed inside it),
  `pass(anchorId): Promise<{ released: boolean; refused: string | null }>`,
  `startLesson(input: { objectiveId: string; anchorId: string; blockId: string | null }): Promise<void>`,
  `assessDocText(input: { anchorId: string; objectiveId: string; blockId: string; text: string }): Promise<void>`,
  `openPrivate(agent: AgentAuthor): { threadId: string; turns: PrivateTurnView[] }`,
  `sendPrivate(threadId: string, text: string): Promise<void>`,
  `insertPrivateIntoDoc(input: { threadId: string; turnId: string; anchorBlockId: string | null }): Promise<{ editId: string | null }>`,
  `docThreads(): ThreadView[]`, `closeOpenQuestion(reason: 'closure'): Promise<void>`.
