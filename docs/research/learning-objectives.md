# Learning objectives: the per-file tree, its states, and how it drives the flow

*2026-09-16. Lucas's specification, with three decisions he made the same day, turned into a build
contract. Supersedes the "concept pack" as the learner-facing object; the ledger's evidence rules are
unchanged and are what make an objective's state trustworthy.*

## 1. What Lucas asked for (verbatim intent)

1. When a deck is first opened, **Sonnet** ingests it and outputs a **structure tree of learning
   objectives and prerequisites**.
2. The tree is **shown in the UI once ready**.
3. As the learner demonstrates objectives they go **"online"**; clicking an item **scrolls to the
   slide** it references and lets the learner **start chatting from there**.
4. An objective is *a defined piece of knowledge the learner needs to demonstrate*, tracked **per
   file**, the whole tree **resettable by the learner**, and specified clearly enough to **generate
   quiz questions**.

Decisions (Lucas, 2026-09-16): an objective is **online once the learner has explained it in their
own words** (ledger level *justified*); *defended* (survived a Tester question) is a fuller state on
top. **Prerequisites the deck assumes but does not teach are nodes**, marked "assumed by the deck",
teachable on click. The tree lives in a **right-side panel that opens with the file**.

## 2. The object

```
LearningObjective {
  id: string                     // stable per file: sha1(file content_sha + normalised title)
  fileId: string
  title: string                  // ≤ 12 words, a claim or a skill: "State the Bellman optimality equation"
  kind: 'objective' | 'prerequisite'
  statement: string              // one or two sentences, what the learner must be able to do/say
  criteria: string[]             // 2–4 checkable criteria — what a correct demonstration contains
  quizSeeds: string[]            // 1–3 question stems the Tester may use, one per criterion at most
  refs: { page: number; segmentId?: string; quote?: string }[]   // where the deck teaches it (empty for assumed prerequisites)
  parentId: string | null        // tree edge: this objective is a sub-objective of parentId
  requires: string[]             // prerequisite edges (ids), acyclic
  assumedByDeck: boolean         // kind = prerequisite and refs = [] → true
  order: number                  // deck order of first ref, prerequisites before their dependants
}
LearningObjectiveState {
  objectiveId, fileId
  level: 0 | 1 | 2 | 3           // 0 untouched · 1 stated · 2 justified (online) · 3 defended
  evidenceMessageIds: string[]   // the learner's own messages (verbatim rule, ledger R5)
  lastMovedAt: string | null
  taughtAt: string | null        // when the Teacher last taught it (feeds flow.ts's taught set)
}
LearningTree { fileId, contentSha, generatedAt, model, version, objectives: LearningObjective[], status: 'pending'|'ready'|'failed', error? }
```

**Mapping to what exists.** The concept pack's `elements[].criteria{1,2,3}` were the same idea with
a different name; the Explanation Ledger's four rules (verbatim learner evidence, monotonic with
capped downgrade, confidence 0.6, agreement is not evidence, `defended` requires a Tester probe) apply
to `LearningObjectiveState.level` unchanged. **One tree per file replaces one pack per room**: a room
opened on a file reads the file's tree; the ledger writes the file's states. Rooms on the same file
share progress, which is what "tracked per file" means.

## 3. Ingest

- **Trigger**: first open of a PDF in the flow (not first Ask). Status `pending` is visible at once.
- **Model**: Sonnet 5 on the configured backend (the user's choice; it runs in the background so its
  latency is not on any path). Input: the deck title, the **outline** (segment labels with pages) and
  the **whole deck text** (`whole-file-context.md` §4). Output: forced JSON schema of §2, 6–20
  objectives for a lecture deck, ≤ 3 levels deep, each with ≥ 1 ref unless `assumedByDeck`.
- **Prerequisites**: the prompt asks explicitly for "knowledge the deck assumes without teaching",
  as `prerequisite` nodes with `assumedByDeck: true`, attached by `requires` to the objectives that
  need them (this is #36's "what is an MDP" case).
- **Cache** by `content_sha` + prompt version in a `learning_trees` table; never regenerated on
  reopen; **Regenerate** is an explicit action and keeps the old states where ids still match.
- **Failure**: status `failed` with a retry; the flow works without a tree (the rail says so).
- **Scripted backend**: the fixture deck gets a committed fixture tree; other decks get `pending`
  with a "needs a live backend" note.

## 4. States and how they move

- The ledger's evaluator runs on every learner turn, as now, but its candidates are the file's
  objectives (and prerequisite nodes), not the room's pack. It proposes level moves with evidence;
  the same gates apply. **Level 2 lights the node**; level 3 fills it.
- The Teacher's `taughtBlock` reads `taughtAt` from states, so the flow session's taught set and the
  Tester's hand-off use the same objects.
- **The Tester quizzes from `quizSeeds`** of objectives that are taught and not yet defended,
  preferring `order`; its feedback turn may propose level 3 on the learner's answer.
- **Reset** (per file, one confirm): all states to level 0, evidence cleared, `taughtAt` cleared;
  the tree itself stays. Logged as `objectives.reset`.

## 5. The panel

- Right-side panel, **open when a file is opened**, collapsible (⌥⌘L), width persisted. Header:
  file name, "n of m online", Reset, Regenerate, status ("Ellie is reading the deck…" while pending).
- Tree: objectives in `order`, sub-objectives nested, prerequisites shown under the objective that
  requires them with an "assumed by the deck" tag. Node glyph = level (dim / outline / half / full,
  reusing `LedgerRow`'s ○◐● vocabulary plus a dim state). Hover: statement + criteria + refs.
- **Click**: scroll the flow to the objective's first ref (the segment card; highlight it briefly)
  and focus its "+ Ask here" with the objective pre-selected, so a thread opened there is tagged with
  the objective. A prerequisite with no ref offers **Teach me this** → a Teacher turn anchored to the
  requiring objective's segment, explained from general knowledge (#36 contract).
- Live: states update as the ledger moves (the existing ledger events); a node that just lit
  animates once (respects reduced motion). Cards keep their glyphs; the glyph now means the
  objectives the card's segment teaches.
- Keyboard: arrows move, Enter scrolls, ⌘Enter opens the Ask, Esc returns focus to the flow.

## 6. IPC (main ↔ renderer)

`objectives:tree(fileId) → LearningTree`, `objectives:states(fileId) → LearningObjectiveState[]`,
`objectives:regenerate(fileId)`, `objectives:reset(fileId)`, `objectives:teach(fileId, objectiveId)`
(the Teach-me-this turn), events `objectives.tree` (status changes) and `objectives.state`
(one node moved). `flow:askHere` gains optional `objectiveId`.

## 7. Out of scope now

Cross-file trees (a module's objectives across decks) — A2. Editing the tree by hand — A2 (the
data model allows it: ids are stable, refs are page-based). Spaced review across sittings —
`flow-session.md` §11's logging first.
