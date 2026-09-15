# ChatterED — build specification for the integrated-document pivot

**Status:** build specification. Written 15 Sep 2026 for execution between 16 Sep and 22 Sep 2026.
**Authority:** issue #23 (*Decision: FULL PIVOT*, 15 Sep 2026) — Lucas chose the full pivot over the
rendering-only recommendation in `docs/research/pivot-integrated-document.md` §G1.
**Feasibility route:** the brief's approach **(iv) hybrid block document** (`pivot-integrated-document.md`
§D4): the original rendered pages stay immutable blocks (pdf.js canvases, already built), and
learner/agent blocks are inserted inline between page regions and in the margins. True PDF→editable
conversion (Marker / MinerU / Docling) is the **A2** upgrade and is out of scope here.

**Deadline:** Assignment 1, Mon 22 Sep 2026 23:59 — a role-playable multi-turn prototype, a
≤10-minute video, a 2,000-word report.

**Read alongside:** `docs/research/pivot-integrated-document.md` (the exploration brief; §A, §D, §E,
§F, §G are the load-bearing sections), `docs/research/design-brief.md` §D–§G,
`docs/research/product-design.md` §A/§C/§D, `docs/research/progress-tracking.md` §3–§4,
`docs/research/ui-review-code.md` §1/§5, `app/docs/STATUS.md`,
`Academia/Sources/_text/koala-2501.17258.txt` (Houde et al., IUI '25),
`Academia/Sources/_text/assignment1-brief.txt`.

**How to read this document.** §A–§E are written to be executed verbatim by a coding agent: schemas
are given as DDL, coordinates are given with their units, files are named by their path under `app/`, and every rule that must not be trusted to a prompt is marked **enforce in code**. §F is for
the video and the report. §G is the list of things only Lucas can decide.

## Contents

- [A. Document model](#a-document-model) — blocks, anchors, migration 009, the sidecar, what persists
- [B. Interaction spec — the seven primitives](#b-interaction-spec--the-seven-primitives) — triggers, turn-taking, wireframes, the timer, latency, the global floor, learner controls
- [C. Screens and layout](#c-screens-and-layout) — one screen, the selection tool, the action bar, block chrome, the whisper layer
- [D. What changes in code](#d-what-changes-in-code) — file by file: built, modified, deleted, untouched
- [E. Seven-day plan, with the Thursday gate](#e-seven-day-plan-with-the-thursday-gate)
- [F. Video storyboard and report framing](#f-video-storyboard-and-report-framing) — 16 beats, the evidence tiers, the follow-up script
- [G. Open questions for Lucas](#g-open-questions-for-lucas)

**The five decisions this specification makes, stated up front so they can be overruled in one reading:**

1. **The learner's selection opens every conversation.** No pre-annotation anywhere (§B0 R1). Joshi &
   Vogel found learners preferred selecting the passage themselves; Houde et al. found a proactive agent
   was read as *"a pedantic student who wouldn't create space for others to participate."*
2. **An annotation is a message.** `messages.anchor_id` is the whole pivot; the actor, orchestrator,
   timer, ledger, whisper scoping and `ScriptedClient` are untouched because none of them care where a
   message is drawn (§A0).
3. **Item (1), *Ask here*, is the entry gesture and never the graded interaction.** It is system-voiced,
   capped at 120 words, cannot move a ledger row, and ends by handing the work back (§B1). If item (1)
   leads the video, the report argues against its own design goal.
4. **What you wrote is in the document; what the agents wrote is beside it.** The learner's explanation
   is an inline block; agent turns are margin blocks; no operation edits either the page or the
   learner's own words (§B2, §C4).
5. **One agent turn in flight, document-wide.** A document has N threads and therefore N floors; the
   anti-dog-pile rule, the disagreement quota and the anti-chorus cap are all re-expressed spatially
   (§B10).



## A. Document model

### A0. The definition, in one paragraph

**A ChatterED document is a source PDF plus an ordered list of blocks.** The source PDF is identified by
its path and its SHA-256 and is **never written to**. Blocks of kind `page` render the original page
through pdf.js and **cannot be edited — there is no operation that edits them** (this is safeguard S5,
*the slide is the arbiter*, encoded in the data model rather than in a prompt). Every other block was
created by the learner or by an agent, carries an **anchor** saying what region of the document it is
about, and carries a **slot** saying where it is drawn. Closing the app and reopening the file restores
the block list, its order, its collapse states, its ledger states and its privacy layer — because the
conversation is saved with the document, not with a session.

**The architectural move that makes the whole pivot cheap: an annotation *is* a message.** Add
`anchor_id` to `messages` and an anchored thread becomes `SELECT … FROM messages WHERE anchor_id = ?`.
The room actor, the orchestrator, the silence timer, the ledger gates, the whisper scoping and the
`ScriptedClient` all keep working unchanged, because none of them care where a message is drawn.

---

### A1. Block kinds

| Kind | Author | Backed by | Default slot | Editable | Purpose |
|---|---|---|---|---|---|
| `page` | the source | — (renders from the PDF) | — | **never** | One rendered PDF page. Immutable. Its anchor is the whole page. |
| `learner_note` | learner | a `messages` row (or a `whispers` row when private) | `inline` | yes, by the learner | The learner's own explanation or reply (primitive 2), and private notes (primitive 5). |
| `agent_note` | `ellie` \| `max` \| `theo` | a `messages` row | `margin` | no; only deletable | A single anchored agent turn: an elaboration request, a probe (primitive 3), a silence-timer nudge. |
| `thread` | — (container) | — | `margin` | — | The container for a multi-turn exchange on one anchor. Its turns are `messages` with the same `anchor_id`; the block row exists to carry presentation state (`slot`, `collapsed`, `pinned`). |
| `answer` | `reference` (the system voice) | a `messages` row | `inline` | no; deletable | The inserted answer for primitive 1. Never worn by a persona (§B1). |
| `teach_back` | — (container) | — | `inline` | — | The page-scoped Theo exchange (primitive 6). Turns are `messages` anchored to the page anchor. |

**One new participant row per room.** `messages.participant_id` is `NOT NULL`, so the `reference` voice
needs a participant. Create a fourth participant with `role = 'reference'` alongside `ellie`, `max` and
`theo` when a document's room is created. It has no persona prompt, no latency band beyond 2–3 s, and
the orchestrator never selects it — only primitive 1 writes as `reference`.

---

### A2. Anchors

**Three anchor kinds, in a redundancy cascade** — the Hypothesis model, which is the most-deployed
annotation client in the world and is worth copying exactly rather than improvising
(`pivot-integrated-document.md` §D1, §D5).

| Kind | When used | What is stored | Survives |
|---|---|---|---|
| `box` | **the A1 primary.** Box-select on a rendered page. | `page` (1-based) + `x0,y0,x1,y1` **normalised 0–1 against the PDF page box**, plus the page `rotation` at capture. This is Hypothesis's `ShapeSelector` (`anchor:'page'`, coordinates normalised 0–1), which is precisely how they anchor to a figure or an equation with no extractable text. | Zoom, window resize, `devicePixelRatio`, re-render. **Not** re-pagination. |
| `quote` | **secondary, and only when a text layer exists** — which is A2 (`app/docs/STATUS.md`: *"a pdf.js page is a canvas"*). Written now so the column exists and the migration is not repeated. | W3C `TextQuoteSelector`: `quote` + `prefix`/`suffix` (±32 chars) + `text_pos` as a **hint, never authoritative**. | Re-pagination, re-render, minor edits. |
| `page` | **fallback, always available.** The whole-page anchor. Used by `teach_back`, by the silence timer when no thread has been touched, and as the landing place for any anchor that cannot be re-placed. | `page` only. | Everything except the page being deleted. |

**Store the rectangle normalised, never in CSS pixels.** The conversion, both directions, lives in one
module (`src/renderer/lib/anchor.ts`, §D2) and nowhere else.

**`region_text`.** Every anchor caches the extracted text lying under its rectangle, capped at 1,500
characters **in the main process** (the same cap and the same place as `message_refs.selection`). With
no text layer, the box is intersected against the per-item bounding boxes that `vault/pdf.ts` already
computes while joining page text. If the intersection is empty — a diagram, an equation set as vector
art — `region_text` is empty and the context builder falls back to the whole page (§D4). **An empty
`region_text` is normal on slides and must not be treated as an error.**

---

### A3. Save format

Three layers, and only one of them is the source of truth. This is Zotero's published reasoning and
MarginNote's shipped architecture, and it transfers exactly (`pivot-integrated-document.md` §C10, §C12,
§D6).

| Layer | Role |
|---|---|
| **SQLite `app.db`, migration 009** | **Source of truth.** Transactional, already has a migration and repository layer, and the room actor already writes there. |
| **`<name>.chattered.json` beside the PDF** | **Derived mirror, written on save and on close.** The vault root is the student's OneDrive folder, so a sidecar syncs across machines and survives a reinstall. **Never read back as authoritative**; on open, it is used only to re-seed a document whose `app.db` row is missing. Known risk: OneDrive conflict copies. |
| **pdf-lib flatten into a *copy* of the PDF** | **Export only, lossy by design, and a stretch (§E Day 5).** A PDF `/Annot` carries `/QuadPoints` — page-space geometry and no text anchor — and cannot express a thread, an agent identity, a ledger state or a private layer. Good for *"give me a PDF with my notes for revision"*; fatal as a store. **Never writes over the learner's original file**; output goes to `~/Documents/ChatterED/<name>-annotated.pdf`. |

#### Migration `009_documents_blocks_anchors.sql`

Current `user_version` is **8** (`src/main/db/migrations/`, forward-only, keyed on `PRAGMA user_version`,
files named `NNN_name.sql`, never edited after shipping). Add exactly one file.

```sql
-- 009_documents_blocks_anchors.sql — the integrated-document pivot (issue #23).
--
-- A document is a source PDF plus an ordered block list. The PDF is never written to; `page`
-- blocks have no mutation path, which is safeguard S5 expressed in the schema.

CREATE TABLE documents (
  id           TEXT PRIMARY KEY,
  room_id      TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  -- The vault file. Nullable and deliberately NOT a foreign key, for the same reason as
  -- `message_refs.file_id` and `materials.file_id`: a re-scan may remove the row, and the
  -- document must still open.
  file_id      TEXT,
  rel_path     TEXT NOT NULL,
  file_name    TEXT NOT NULL,
  content_sha  TEXT NOT NULL,          -- SHA-256 of the PDF bytes; the anchor-validity key
  page_count   INTEGER NOT NULL,
  -- Presentation state that must survive a close/reopen (ui-review-code.md §5.5).
  scroll_top   INTEGER NOT NULL DEFAULT 0,
  fit_mode     TEXT NOT NULL DEFAULT 'page' CHECK (fit_mode IN ('page','width','manual')),
  zoom         REAL NOT NULL DEFAULT 1.0,
  active_anchor_id TEXT,
  whisper_layer_open INTEGER NOT NULL DEFAULT 0,
  -- Houde controls (§B11), per document.
  mute_ellie   INTEGER NOT NULL DEFAULT 0,
  mute_max     INTEGER NOT NULL DEFAULT 0,
  chatter      TEXT NOT NULL DEFAULT 'normal' CHECK (chatter IN ('quiet','normal','more')),
  write_scope  TEXT NOT NULL DEFAULT 'selected' CHECK (write_scope IN ('selected','page')),
  opened_at    TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (room_id)
);
CREATE INDEX documents_by_file ON documents (file_id);

CREATE TABLE anchors (
  id           TEXT PRIMARY KEY,
  document_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  -- Carried on the anchor, not only on the document: an anchor captured against one revision of
  -- the file must be able to say so after the file changes underneath it (§A5).
  content_sha  TEXT NOT NULL,
  page         INTEGER NOT NULL,                       -- 1-based
  kind         TEXT NOT NULL CHECK (kind IN ('box','quote','page')),
  -- kind='box': normalised 0..1 against the PDF page box, at `rotation`. Never CSS pixels.
  x0 REAL, y0 REAL, x1 REAL, y1 REAL,
  rotation     INTEGER NOT NULL DEFAULT 0,
  -- kind='quote': W3C TextQuoteSelector. `text_pos` is a hint; the quote is authoritative.
  quote        TEXT,
  prefix       TEXT,
  suffix       TEXT,
  text_pos     INTEGER,
  -- Extracted text under the region, capped at 1500 chars in the MAIN process. Empty is normal
  -- on slides (vector-art equations, diagrams) and is not an error.
  region_text  TEXT NOT NULL DEFAULT '',
  label        TEXT NOT NULL DEFAULT '',               -- ~40 chars, for stubs and breadcrumbs
  element_id   TEXT,                                   -- concept-pack element, assigned lazily
  state        TEXT NOT NULL DEFAULT 'anchored' CHECK (state IN ('anchored','orphan')),
  no_annotate  INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);
CREATE INDEX anchors_by_page ON anchors (document_id, page, y0);

CREATE TABLE blocks (
  id           TEXT PRIMARY KEY,
  document_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  anchor_id    TEXT REFERENCES anchors(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN
                 ('page','learner_note','agent_note','thread','answer','teach_back')),
  page         INTEGER NOT NULL,
  -- Fractional index. A `page` block has ord = its page number; blocks inserted beneath page N
  -- take ord in (N, N+1), ordered by their anchor's y0. Inserting between two blocks is one
  -- write and never renumbers the list.
  ord          REAL NOT NULL,
  slot         TEXT NOT NULL CHECK (slot IN ('inline','margin')),
  collapsed    INTEGER NOT NULL DEFAULT 0,
  pinned       INTEGER NOT NULL DEFAULT 0,
  author       TEXT NOT NULL CHECK (author IN
                 ('source','learner','ellie','max','theo','reference')),
  -- The text lives in `messages` (shared) or `whispers` (private). A container block
  -- (`thread`, `teach_back`, `page`) has neither.
  message_id   TEXT REFERENCES messages(id) ON DELETE CASCADE,
  whisper_id   TEXT REFERENCES whispers(id) ON DELETE CASCADE,
  visibility   TEXT NOT NULL DEFAULT 'shared' CHECK (visibility IN ('shared','private')),
  private_with TEXT,                                   -- participant id, when visibility='private'
  relayed_from TEXT,                                   -- block id of the private note it came from
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX blocks_by_order  ON blocks (document_id, ord);
CREATE INDEX blocks_by_anchor ON blocks (anchor_id);

-- An annotation IS a message. This one column is why the pivot is a rendering change.
ALTER TABLE messages ADD COLUMN anchor_id TEXT REFERENCES anchors(id) ON DELETE SET NULL;
CREATE INDEX messages_by_anchor ON messages (anchor_id, seq);

-- Private notes are anchored too, and stay in their own table — the structural separation that
-- the leak-canary test already guards.
ALTER TABLE whispers ADD COLUMN anchor_id TEXT REFERENCES anchors(id) ON DELETE SET NULL;
CREATE INDEX whispers_by_anchor ON whispers (anchor_id, seq);

-- The ledger becomes keyed by region. `ledger` currently declares UNIQUE (session_id,
-- element_id) inline, which SQLite cannot drop in place, so the table is rebuilt (the standard
-- 12-step ALTER) and the constraint is re-expressed as an index over IFNULL(anchor_id,'') so
-- that pre-pivot rows (anchor_id NULL) keep exactly their old uniqueness.
CREATE TABLE ledger_new (
  id               TEXT PRIMARY KEY,
  session_id       TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  anchor_id        TEXT REFERENCES anchors(id) ON DELETE CASCADE,
  element_id       TEXT NOT NULL,
  level            INTEGER NOT NULL CHECK (level BETWEEN 0 AND 4),
  level_proposed   INTEGER NOT NULL,
  confidence       REAL,
  evidence_text    TEXT,
  evidence_msg_id  TEXT REFERENCES messages(id),
  evidence_seq     INTEGER,
  defended_against TEXT,
  revisit          INTEGER NOT NULL DEFAULT 0,
  contested        INTEGER NOT NULL DEFAULT 0,
  misconceptions_open     TEXT NOT NULL DEFAULT '[]',
  misconceptions_resolved TEXT NOT NULL DEFAULT '[]',
  updated_at       TEXT NOT NULL
);
INSERT INTO ledger_new (id, session_id, anchor_id, element_id, level, level_proposed, confidence,
  evidence_text, evidence_msg_id, evidence_seq, defended_against, revisit, contested,
  misconceptions_open, misconceptions_resolved, updated_at)
SELECT id, session_id, NULL, element_id, level, level_proposed, confidence,
  evidence_text, evidence_msg_id, evidence_seq, defended_against, revisit, contested,
  misconceptions_open, misconceptions_resolved, updated_at FROM ledger;
DROP TABLE ledger;
ALTER TABLE ledger_new RENAME TO ledger;
CREATE UNIQUE INDEX ledger_by_region ON ledger (session_id, IFNULL(anchor_id, ''), element_id);

ALTER TABLE ledger_history ADD COLUMN anchor_id TEXT;
```

**Two rules for whoever writes this migration.** (1) `PRAGMA foreign_keys` must be **off** for the
`ledger` rebuild and restored afterwards — the runner already wraps each file in `BEGIN`/`COMMIT`
(`src/main/db/migrations.ts`), so add the pragma pair inside the file. (2) Nothing here touches
`materials`, so the frozen prompt prefix and its `prefix_sha256` assertion are unaffected.

#### The `.chattered.json` sidecar

Written next to the PDF on close and on every ⌘S. Derived; never authoritative.

```jsonc
{
  "schema": "chattered.v1",
  "source": { "file": "Lecture4-convexity.pdf", "sha256": "b3f1…", "pages": 24 },
  "saved_at": "2026-09-20T14:02:11Z",
  "anchors": [
    { "id": "a_7c21", "page": 4, "kind": "box",
      "rect": [0.118, 0.402, 0.664, 0.447], "rotation": 0,
      "label": "∇²f(x) is PSD for every x ∈ S", "element_id": "R1", "state": "anchored" }
  ],
  "blocks": [
    { "id": "b_41aa", "anchor": "a_7c21", "kind": "learner_note", "ord": 4.10,
      "slot": "inline", "collapsed": false, "author": "learner",
      "text": "If the Hessian is PSD then f is convex…", "at": "2026-09-20T13:44:02Z" },
    { "id": "b_41ab", "anchor": "a_7c21", "kind": "agent_note", "ord": 4.11,
      "slot": "margin", "collapsed": false, "author": "max",
      "text": "You might not like this next question…", "at": "2026-09-20T13:44:19Z" }
  ],
  "ledger": [
    { "anchor": "a_7c21", "element_id": "R1", "level": 4, "state": "defended",
      "evidence": "it has to be PSD everywhere on S", "defended_against": "max" }
  ],
  "controls": { "mute_ellie": false, "mute_max": false,
                "chatter": "normal", "write_scope": "selected" }
}
```

**Private notes are absent from the sidecar, always.** The whisper layer has no representation in any
exported artefact (§B5). Assert it in the leak-canary test.

---

### A4. State that must persist

Everything below survives quit, relaunch and reopening the same file. A coding agent should treat this
as the acceptance checklist for Day 2.

| State | Where it lives |
|---|---|
| **Block order** | `blocks.ord` (fractional index), per document. Re-ordering writes one row. |
| **Slot** — inline vs margin, learner-overridable | `blocks.slot` |
| **Collapsed / expanded**, and pinned-open | `blocks.collapsed`, `blocks.pinned` |
| **Which thread is active** | `documents.active_anchor_id` |
| **Ledger states** per region | `ledger.(session_id, anchor_id, element_id)`, with the full move history in `ledger_history.anchor_id` |
| **Whisper privacy** — which notes are private and with whom | `whispers` (a separate table, never joined into group context) + `blocks.visibility`, `blocks.private_with`; layer open/closed in `documents.whisper_layer_open` |
| **Relay provenance** | `blocks.relayed_from` + the existing `messages.promoted_from_whisper` / `whispers.promoted_message_id` pair |
| **Agent controls** | `documents.mute_ellie`, `mute_max`, `chatter`, `write_scope` |
| **Reading position** | `documents.scroll_top`, `fit_mode`, `zoom` — closes `ui-review-code.md` §5.5 |
| **Anchor validity** | `documents.content_sha` vs `anchors.content_sha` (§A5) |

---

### A5. Anchoring when the source changes — a policy, not an afterthought

`vault/repo.ts#sync` keys on `(size, mtime_ms)` and a changed file **loses its `indexed_*` stamp and its
FTS rows**. That is correct for an index and catastrophic for annotations, because the anchors hold the
learner's own explanations.

1. Every anchor carries `content_sha` (SHA-256 of the file bytes) alongside `document_id`.
2. **On open, hash matches** → rectangles are authoritative; render directly. This is the only path A1
   exercises and it must be fast.
3. **Hash differs** → re-anchor with the cascade, cheapest and most precise first: (a) the stored
   rectangle, *then verify `region_text` still matches what is under it*; (b) global character offsets
   into the flattened page text; (c) fuzzy search for `prefix`/`suffix`, validating the text between;
   (d) fuzzy search for `quote` alone, **biased toward the stored position** — which is what makes it
   work when the quote occurs many times in one document. Stages (b)–(d) require a text layer and are
   therefore **A2**; in A1, a hash mismatch goes straight to step 4 for any anchor whose `region_text`
   no longer matches.
4. **Anything unmatched becomes a visible orphan** — `anchors.state = 'orphan'` — listed in a panel
   (*"3 notes could not be placed — here they are"*), rendered at the page-level anchor, **never deleted
   and never silently dropped.** Design the orphan state in from day one rather than treating it as a bug.
5. **Re-indexing may drop FTS rows freely. It may never touch `anchors` or `blocks`.** Assert this in a
   test, in the same spirit as the existing whisper-leak canary.

---

### A6. What is deliberately not in the model

- **No text layer, so no real text selection, in A1.** `box` is the primary anchor and `quote` columns
  exist unused. Adding pdf.js's `TextLayer` is the first A2 item and everything box-anchored keeps working.
- **No conversion.** The PDF stays a PDF. Marker / MinerU / Docling is the A2 upgrade; Docling is
  interesting there as an **anchor oracle** (it returns `(page, bbox)` provenance per paragraph, table
  and figure) rather than as a replacement document.
- **No CRDT, no block editor, no reordering of pages.** `ord` is a fractional index, not a document tree.
- **No cloud, no upload button, no account.** Unchanged from P6.



## B. Interaction spec — the seven primitives

### B0. The five rules that govern all seven

State these once; every primitive below inherits them.

| # | Rule | Enforcement |
|---|---|---|
| **R1** | **The learner's selection opens every conversation.** No agent writes on a region the learner has not selected, on a page the learner has not opened, or before the learner has written something. There is **no pre-annotation** anywhere in A1. | Orchestrator gate. `pivot-integrated-document.md` §B4(d); Joshi & Vogel CHI 2026 (participants preferred selecting the passage themselves). |
| **R2** | **One agent turn in flight, document-wide.** At most one agent may be generating or holding a reply anywhere in the document at any instant. The anti-dog-pile rule is global, not per thread. | `orchestrator` in-flight token, §B8. |
| **R3** | **The learner opens and closes every thread.** No agent may post the last turn of a thread; no agent may summarise what a thread concluded. | Existing turn rules 1/5, safeguard S7. |
| **R4** | **The page is structurally immutable.** No operation exists that edits a `page` block. Safeguard S5 ("the slide is the arbiter") is encoded in the data model rather than in a prompt. | No mutation path in the block repository. |
| **R5** | **Nothing an agent writes may be the learner's evidence.** Ledger advances require a verbatim substring of a *learner* message (`progress-tracking.md` §4.4 rule 1). Inserted answers, agent notes and whispers never advance a row. | Ledger handler, existing evidence check. |

**Anchor vocabulary used throughout.** *Region* = one anchor (a box on a page, or a page as a whole).
*Slot* = where a block is drawn: `inline` (full width, immediately beneath the page block that carries
the anchor, ordered by anchor `y0`, with a 2 px connector rule running from the anchor rectangle to the
block's top-left corner) or `margin` (right column, top-aligned to the anchor's `y0`, pushed down to
avoid collision with the block above it).

---

### B1. Primitive (1) — **Ask here**

*The entry gesture, not the interaction.* (`pivot-integrated-document.md` §A3, §F3.)

| | |
|---|---|
| **Trigger** | Box-select a region → floating action bar → **Ask** (`⌘⇧A`). A single-line prompt field opens *at the selection* (the Cursor ⌘K gesture, brief §C8), pre-focused, placeholder `Ask about this…`. `Esc` cancels and discards the anchor. |
| **System response** | One `answer` block, authored by **the system**, not by Ellie or Max. Held 2–3 s (this is retrieval, not deliberation — it must not borrow the Challenger's considered pacing). Capped at **120 words**, hard-truncated in code, then a rule, then the hand-back line and one button. |
| **Turn-taking rule** | An `answer` is **not an agent turn**. It does not take the document-wide floor (R2), does not count toward the S2 disagreement quota, does not reset the silence timer's stage counter, and **neither Ellie nor Max may post into an `answer` block's thread until the learner has pressed "Explain it back"** — enforce in code, not in the prompt. |
| **What is inserted, where** | `answer` block, slot `inline`, beneath the page that carries the anchor. Author label `REFERENCE` in neutral grey — deliberately not one of the three personas, because a persona that supplies the target explanation has broken its contract (`design-brief.md` §D1). |
| **Ledger** | The region's row is created at `·` *not yet* and **stays there**. An answer block can never move a row (R5). This is the mechanism that converts item (1) from the disease into the hook. |

**Why the answer is system-voiced.** Ellie may never supply a complete correct explanation and Max may
never state the answer. If the inserted answer wore either face, every subsequent turn from that agent
would be read against a broken persona contract. A neutral `REFERENCE` voice keeps both contracts intact
and makes the visual difference between *what the machine knows* and *what my study partners think*
structural rather than tonal.

```
              ┌ page 4 (immutable) ──────────────────────────────┐
              │   Theorem 3.2. A twice-differentiable f is       │
              │   convex on an open convex S iff ∇²f(x) is       │
   ·  ────────┼─▷ ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓  for all x∈S.   │
  gutter      │   ┃ positive semidefinite      ┃  ← box-select   │
              │   ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛                 │
              │        ╭──────────────────────────────────╮      │
              │        │ Ask about this…            ⏎     │      │  ← prompt at the selection
              │        ╰──────────────────────────────────╯      │
              └──────────────────────────────────────────────────┘
                 │ connector
              ┌──┴───────────────────────────────────────────────┐
              │  REFERENCE                            · inline   │
              │  A symmetric matrix H is positive semidefinite   │
              │  when zᵀHz ≥ 0 for every vector z. It is not a   │
              │  statement about the entries of H.               │
              │  ───────────────────────────────────────────     │
              │  Now say it back in your own words and I'll      │
              │  tell you what's missing.                        │
              │             [ Explain it back → ]   [ ✕ Remove ] │
              └──────────────────────────────────────────────────┘
                 ledger gutter still reads  ·  — nothing you read
                 moves a row.
```

Pressing **Explain it back →** converts the anchor in place into primitive (2): the `answer` block
collapses to one line, a `learner_note` composer opens beneath it on the same anchor, and Ellie and Max
become eligible on that anchor for the first time.

---

### B2. Primitive (2) — **Explain this**

*The graded interaction. This is the one that must show ≥ 6 turns on a single anchor.*

| | |
|---|---|
| **Trigger** | Box-select a region → **Explain** (`⌘⇧E`); or **Explain it back →** from an `answer` block. |
| **System response** | (a) An empty `learner_note` block, slot `inline`, opens beneath the page with the composer focused and the placeholder `Explain this in your own words…`. (b) Nothing else happens until the learner submits. The 8 s floor-yield window then runs before any agent may reply. |
| **Turn-taking rule** | Inside the thread, `design-brief.md` §D2 rules 1–7 apply unchanged: one agent per beat, no agent-to-agent volley longer than one exchange, default order Peer → learner → Challenger → learner, learner closes. Across threads, R2. |
| **What is inserted, where** | The learner's explanation is an **inline** block in the document body, indigo-tinted, full width — *their* writing is in the document. Every agent turn is a `margin` block inside the `thread` on the same anchor. The asymmetry is the design: the learner writes in the document, the agents annotate beside it. |
| **Region permission** | A `learner_note` is permanently `no_annotate` in the sense that matters: **no operation exists that edits or corrects it in place.** Agents may only respond in the margin thread anchored to it. This is Koala's *who has access* cell relocated from people to places (`pivot-integrated-document.md` §E3 control 4), and it costs nothing because there is no edit path to build. |
| **Ledger** | The region's row moves ○ → ◐ → ● by the existing five gates, unchanged, keyed by `anchor_id` rather than by session. |

**The canonical six-to-eight turn shape** (this is what the video films, §F):

1. learner — `learner_note`, inline: their explanation.
2. **Ellie** — margin, held 4–6 s: acknowledge + one request for elaboration.
3. learner — margin reply. **Gutter glyph ○ → ◐, animated during Max's hold.**
4. **Max** — margin, held 9–12 s, preemptive framing (S6), quoting the learner's own words.
5. learner — margin reply, the defence.
6. **Max** — margin, held 9–12 s, one follow-up probe of a different Socratic type. **Glyph ◐ → ●.**
7. **Ellie** — margin, held 4–6 s: visible disagreement with Max, co-located in the same thread (S2).
8. learner — closes (R3).

```
 ┌ vault ┬ gutter ┬──────── document ────────────┬───── margin ─────┐
 │       │        │ ┌ page 4 ─────────────────┐  │                  │
 │ MA3236│   ●  ──┼─┼─▷┏━━━━━━━━━━━━━━━━━━━┓  │  │ ╔══════════════╗ │
 │  L3   │        │ │  ┃ ∇²f(x) is PSD for ┃  │  │ ║ ELLIE · peer ║ │ ← thread, active,
 │  L4 ▸ │        │ │  ┃ every x ∈ S       ┃  │  │ ║ So when you  ║ │   y-aligned to the
 │       │        │ │  ┗━━━━━━━━━━━━━━━━━━━┛  │  │ ║ say "check   ║ │   anchor
 │       │        │ └─────────────────────────┘  │ ║ it's PSD" —  ║ │
 │       │        │    │                         │ ║ check it     ║ │
 │       │        │ ┌──┴──────────────────────┐  │ ║ where?       ║ │
 │       │        │ │ YOU              inline │  │ ╟──────────────╢ │
 │       │        │ │ If the Hessian is PSD   │  │ ║ YOU          ║ │
 │       │        │ │ then f is convex. You   │  │ ║ At the point ║ │
 │       │        │ │ compute ∇²f, check it's │  │ ║ you're check ║ │
 │       │        │ │ PSD, and you're done.   │  │ ╟──────────────╢ │
 │       │        │ └─────────────────────────┘  │ ║ MAX ·chal ⟳9s║ │ ← held, counter
 │       │        │                              │ ║ ● ● ●        ║ │   climbing
 │       │        │                              │ ╚══════════════╝ │
 └───────┴────────┴──────────────────────────────┴──────────────────┘
```

---

### B3. Primitive (3) — **Get challenged**

*Max plants one probe on a region the learner has not explained.*

| | |
|---|---|
| **Trigger** | **Learner-invoked only in A1.** Box-select a region → **Challenge me** (`⌘⇧C`). There is no unsolicited pre-annotation path; see R1. |
| **System response** | Exactly one `agent_note` by Max, kind `probe`, held 9–12 s behind the anchor glyph (§B7). It opens with the reactance-reducing line (S6) and carries exactly one Socratic question drawn from the five types (`design-brief.md` §D1), seeded from the concept pack's `probe_seeds` for the element nearest this region. |
| **Turn-taking rule** | The probe **takes the document-wide floor** (R2) for its hold. Ellie may not post anywhere in the document while it is held. After it lands, the floor returns to the learner; Max may not post again on this anchor until the learner has replied. |
| **What is inserted, where** | `agent_note`, slot `margin`, on the anchor, expanded. **Density cap, enforced in code:** at most **one** un-replied agent note per anchor and at most **two** per page. A third is refused with a one-line reason in the dev log, not queued. |
| **Ledger** | Creates the region's row at `·` if it does not exist. The learner's reply is scored by the existing gates. Because the reply follows a Challenger probe, ● is reachable in two turns — which is exactly why this primitive exists and why a quiz cannot substitute for it. |

```
   ┌ page 4 ───────────────────────────┐        ┌──────────────────────┐
   │  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━┓    │        │ MAX · challenger     │
 · ─┼─▷┃ …on an OPEN convex set S ┃    │────────│ You might not like   │
   │  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━┛    │        │ this, and that's     │
   │       ▲ amber ring while held      │        │ fine — I'm testing  │
   └───────────────────────────────────┘        │ the statement, not   │
                                                │ you. Why "open"?     │
                                                │ What breaks at the   │
                                                │ boundary?            │
                                                │ ┌──────────────────┐ │
                                                │ │ Answer here…     │ │
                                                │ └──────────────────┘ │
                                                │ [ ✕ not useful ]     │  ← reject, logged
                                                └──────────────────────┘
```

---

### B4. Primitive (4) — **Margin thread**

*Agents' and the learner's notes side by side, in one anchored, turn-taking exchange.*

| | |
|---|---|
| **Trigger** | Click the anchor rectangle, its gutter glyph, or any note on it. The thread becomes **active**. |
| **System response** | The active thread expands in the margin column, y-aligned to the anchor's `y0`; the anchor rectangle gains a 2 px indigo outline; a connector rule joins the two. Every other thread on the visible pages **collapses to a two-line stub**: author of the last turn, first ~40 characters, and a turn count (`ELLIE · 6 turns ›`). |
| **Turn-taking rule** | **Exactly one thread is active at a time**, and only the active thread may receive an agent turn. A learner reply typed into a collapsed thread expands it and makes it active, which yields the previous thread's floor. Combined with R2 this gives the document a single floor, which is what `design-brief.md` §D2's rules were written against. |
| **What is inserted, where** | Nothing new; this is the container. Turns are `messages` rows with `anchor_id` set, rendered in the margin in `created_at` order. |

**The Houde reconciliation, stated explicitly because two of our own documents disagree.**
`pivot-integrated-document.md` §B4(a) says *do not collapse threads by default* — Koala's participants
predicted threading would reduce distraction and then found it "detracted from their ability to
collaborate" (Houde et al. §7.2.3). Issue #23's direction says *collapsed by default*. Both are right
about different failure modes: a margin of numbered pins is Koala's failure; a 24-page deck with 24 open
margins is the density failure (§B4(b)). **The resolution built here: one thread is always fully open
and it is the one the learner last touched; the rest collapse to a stub that still shows who spoke last
and how many turns it holds.** No exchange is ever reduced to a pin with no content. The learner can
pin a thread open (`⌥` click) to keep two visible side by side. Flagged as §G Q2 because it is the one
interaction decision here that Koala's data actively warns about.

```
 ── margin column ───────────────
 ╔══════════════════════════════╗
 ║ ▾ p.4 "PSD for every x ∈ S"  ║   ← ACTIVE: full turns, composer at the foot
 ║   ELLIE · peer          4s   ║
 ║   So when you say "check…    ║
 ║   YOU                        ║
 ║   At the point you're…       ║
 ║   MAX · challenger     11s   ║
 ║   PSD where? Your sentence…  ║
 ║   ┌────────────────────────┐ ║
 ║   │ Reply…                 │ ║
 ║   └────────────────────────┘ ║
 ╚══════════════════════════════╝
 ┌──────────────────────────────┐
 │ ▸ p.4 "open convex set"      │   ← collapsed stub
 │   MAX · 2 turns            › │
 └──────────────────────────────┘
 ┌──────────────────────────────┐
 │ ▸ p.4 "Hessian ∇²f"          │
 │   YOU · 1 turn             › │
 └──────────────────────────────┘
```

---

### B5. Primitive (5) — **Ask privately**

*The whisper channel, relocated as a private note layer.*

| | |
|---|---|
| **Trigger** | **Private note** in the floating action bar, or `⌘K` anywhere. Opens a private note on the current anchor, addressed to one agent (Ellie by default; the addressee is a two-option segmented control in the note's header). |
| **System response** | A `learner_note` with `visibility='private'` and `private_with` set to the agent, drawn in the **whisper layer**: the margin column's background goes to the whisper tint, shared notes dim to 35 %, and a persistent `◐ private with Ellie` chip appears in the top bar. Reply held 1–2 s. |
| **Turn-taking rule** | A whisper turn **does not take the document-wide floor** (R2) and does not reset the silence timer. Whispering while Max's probe is held is legal and is the intended behaviour. |
| **What is inserted, where** | Slot `margin`, private layer only. Invisible when the layer is toggled off. Never rendered inline in the document body, ever — the shared document is the artefact the learner would show a tutor. |
| **Ledger** | **Never.** `progress-tracking.md` §4.5, unchanged. |

**The T4 invariant, restated in full because it is the one thing in the product that must not leak.**

> A whisper is visible to the learner and to exactly one agent. Its text never enters the shared
> document, never enters the other agent's context, never enters the group context builder, never
> appears in an export, and never advances the ledger. The only path from private to shared is the
> **relay**, and the relay is a learner-approved action that **creates a new block** in the shared
> layer; it never moves or reveals the private one.

The whisper agent's opening line states its own limits, verbatim, on the first private note per document
(Setlur & Tory's maxims of quality and relation; the fix for the developer's own `/btw` T4 finding):

> *"I can see the shared document and this thread, and I can explain background bits. I can't answer
> this for you, and nothing here reaches Max unless you send it over."*

**Relay.** Any private note carries `[ Raise this in the margin ▸ ]` with three options —
*raise it as my question* · *let Ellie raise it as her own* · *keep it here*. Approving inserts a new
shared `learner_note` or `agent_note` on the same anchor, with `relayed_from` recording the private
block id (kept for the export's provenance, never rendered).

**Enforcement, in code, not in the prompt.** The existing whisper-scoping separation
(`src/room/context.whisper.ts` vs `context.group.ts`) and its leak-canary test are extended: the canary
must now also assert that no message with `visibility='private'` reaches the block renderer's shared
layer, the `.chattered.json` sidecar, or the pdf-lib export.

```
   [ shared ● ]  [ private ○ ]        ← whisper layer toggle, top bar
   ┌──────────────────────────────────┐
   │ ░░ shared notes dim to 35% ░░    │
   ╔══════════════════════════════════╗
   ║ ◐ PRIVATE WITH ELLIE    [Ellie|Max]║
   ║ YOU                              ║
   ║ ok slightly embarrassing but does║
   ║ PSD just mean all entries ≥ 0?   ║
   ║ ELLIE                       2s   ║
   ║ Not embarrassing. Quick answer:  ║
   ║ no. Two things first — nothing   ║
   ║ here reaches Max unless you send ║
   ║ it over… try A = [[1,2],[2,1]].  ║
   ║ [ Raise this in the margin ▸ ]   ║
   ╚══════════════════════════════════╝
```

---

### B6. Primitive (6) — **Teach this page**

*Theo, invited only. The page is the unit.*

| | |
|---|---|
| **Trigger** | Gated, then offered — never auto-started. The offer appears at the foot of a `page` block when **every** ledger row anchored on that page is `●` **and** the page's lowest Bloom rung is `analyse` (`progress-tracking.md` §6.5, the M9 fix). Declining hides it for the session; it can be re-opened from the page's glyph stack. |
| **System response** | A `teach_back` block, slot `inline`, at the foot of the page. Ellie's and Max's margin notes on this page dim to 35 % with the line *"sitting this one out"*; both are **muted document-wide** for the duration (S1 — the group never exceeds two voices). Theo's turns are held 2–3 s. |
| **Turn-taking rule** | Theo asks, the learner teaches, the learner ends the block. Theo may not post the last turn. Ellie and Max are hard-muted at the orchestrator, not asked to be quiet. |
| **What is inserted, where** | One `teach_back` block containing the whole exchange, inline, full width, plum rule, at the page foot. It is a block, not a thread, because its anchor is the page, not a region. |
| **Ledger** | Advances the page's Bloom rung only. No claim row changes state during a teach-back. |

```
   └──────────── page 4 ends ────────────┘
   ┌─────────────────────────────────────┐
   │ THEO · first year        teach-back │
   │ ok so I've not done this module —   │
   │ why does it have to be PSD          │
   │ everywhere and not just at the      │
   │ minimum?                            │
   │                                     │
   │ YOU                                 │
   │ Because…                            │
   │ ┌─────────────────────────────────┐ │
   │ │ Teach it…                       │ │
   │ └─────────────────────────────────┘ │
   │ Ellie and Max are sitting this one  │
   │ out.                   [ I'm done ] │
   └─────────────────────────────────────┘
```

---

### B7. Primitive (7) — **Coverage map**

*The Explanation Ledger, re-projected onto the page. This replaces the ledger rail and the recap screen.*

| | |
|---|---|
| **Trigger** | None — derived. It is a view, not an interaction (`pivot-integrated-document.md` §A2). |
| **System response** | A 28 px **gutter column** to the left of the document column carries one glyph per anchored region, at the anchor's `y0`. Glyph set unchanged from `product-design.md` §D2: `·` not yet · `○` stated · `◐` justified · `●` defended, monochrome, plus the `revisit` chevron and the `⚑ contested by me` flag (S8). |
| **Interaction** | Hover a glyph → its anchor rectangle highlights on the page and its thread stub lifts in the margin. Click → the thread becomes active (primitive 4). Hover the anchor → the glyph lifts. The mapping is bidirectional and needs no ids, which dissolves `ui-review-ux.md` m4 outright. |
| **Roll-up** | Each `page` block carries a small glyph stack at its top-left corner (`●●◐·`) so a page's state is legible while scrolling past it, and the vault sidebar shows the same stack per file. |
| **Animation** | Unchanged from `product-design.md` §D3: 400 ms `ease-out`, ring fills clockwise, scheduled to play **inside the next agent's hold**, never while the learner is typing. Two simultaneous moves animate 120 ms apart. No sound, no colour, no confetti. |
| **What it replaces** | `RecapCard.svelte` and `LedgerRail.svelte` both go (§D). The document is the recap: scroll it and you see what you defended. Layers 3 and 4 (act profile, unaided seconds) move to a **Close-out sheet** reachable from the top bar, unchanged in content. |

```
 gutter │ document
   ●  ──┼─ "∇²f(x) is PSD for every x ∈ S"      defended
   ◐  ──┼─ "positive semidefinite"              justified
   ○  ──┼─ "open convex set S"                  stated
   ·  ──┼─ "twice-differentiable"               not yet
   ⚑  ──┼─ "…openness is doing real work"       contested by me
```

---

### B8. The silence timer, redefined for a document

**The problem.** "Idle" currently means *no keystrokes in the composer* (`design-brief.md` §D3) — the
property that distinguishes thinking from disengaging. A document has no single composer.

**The new definition, to implement literally:**

> **idle** = (no keystroke in *any* open thread composer, including the whisper composer)
> **AND** (no selection change — no new box drawn, no anchor focused, no thread activated)
> for **45 s** continuous. Stage 2 at **90 s** cumulative idle. Maximum **2 fires per page**
> (the page is what replaces "a round" — §G Q3).

**Scroll is deliberately excluded.** The exploration brief's proposal (§E1) also required *no scroll*.
Do not implement that clause: re-reading a slide by scrolling is precisely the behaviour the timer must
not punish, and including scroll would make the timer un-fireable on a long page and trigger-happy on a
short one. Zoom and page navigation are likewise excluded. **Selection change is the document's analogue
of a keystroke** — it is the gesture that says "I am still working this passage" — and that is the
substitution the report should defend in one sentence.

**Where the nudge lands.** As an `agent_note` by Ellie, slot `margin`, on **the anchor of the thread the
learner last touched**. If no thread has ever been touched in this document, it lands on the
**whole-page anchor of the page currently filling the viewport**, as a single note at the page foot. It
**never** lands on a region the learner has not selected (R1) and never appears on a page other than the
one on screen — a nudge that arrives off-screen reads as the agent wandering off, not as company.

**Content is unchanged.** Stage 1 is content-free (*"Still turning it over? Happy to wait — or I can
make the question smaller."*). Stage 2 is a deliberately incomplete, hedged scaffold. The Challenger
never fires the timer. `Hold` and `Wait for me` survive as controls on the note itself.

```
   0–34 s    the active thread's composer shows its placeholder, nothing else
   35–44 s   a hairline under the composer fills left→right, unlabelled
   45 s      ┌─────────────────────────────┐
             │ ELLIE · peer                │  ← lands in the ACTIVE thread,
             │ Still turning it over?      │    never elsewhere
             │ Happy to wait — or I can    │
             │ make the question smaller.  │
             │ [ hold on ] [ wait for me ] │
             └─────────────────────────────┘
```

---

### B9. Latency legibility — the anchor glyph

**The problem.** A held reply in a chat is legible because a typing indicator sits at the bottom of the
one column you are reading. A note that appears in a margin nine seconds later, possibly off-screen, is
indistinguishable from lag or from nothing (`pivot-integrated-document.md` §E1).

**Three devices, all required:**

1. **The anchor glyph.** While an agent turn is held, the anchor rectangle on the page gains a
   **1.5 px ring in that agent's hue** with a slow 1.6 s pulse, and a small label chip at its
   top-right: `Max is reading…` (Max *reads* and *thinks*; Ellie *types* — the verb difference does the
   persona work for free, `product-design.md` §C3, extended for the document: what Max is doing first is
   reading your region). The glyph is on the **page**, so it is visible even when the margin is
   scrolled out of view.
2. **The reserved slot.** The margin thread reserves the block the note will occupy, at its final
   width, with the three-dot indicator and — **for Max only** — an elapsed-seconds counter starting at
   3 s. The wait has a location before it has content.
3. **The off-screen breadcrumb.** If the held anchor is scrolled out of the viewport, a single chip
   docks at the edge of the gutter nearest it: `↑ Max is reading p.4`. Clicking it scrolls the anchor
   back into view. One chip maximum — R2 guarantees there can never be two.

Cancellation is unchanged: a learner message cancels a held reply rather than queueing it (turn rule 6).
The ring, the slot and the breadcrumb all disappear without ceremony and no apology is posted.

---

### B10. The anti-dog-pile rule across parallel threads

`design-brief.md` §D2 was written against one ordered stream. A document has N threads and therefore N
floors, and the rules stop binding. Three amendments, all in the orchestrator:

| Rule | Chat form | Document form |
|---|---|---|
| **Anti-dog-pile** | Never two agent messages between two learner messages | **One agent turn in flight document-wide** (R2). A single in-flight token, taken before generation and released on post or cancel. A second agent's turn is **dropped, not queued** — a queued turn lands after the learner has moved to another page and reads as litter. |
| **S2 disagreement quota** | Ellie and Max must visibly disagree once per five agent turns | **A disagreement counts only if it is co-located**: two notes in the *same* thread, adjacent, with no learner turn between them other than the one being discussed. A disagreement rendered twelve pages apart is never seen and does not count. Enforce in the quota accounting, not in the prompt. |
| **S1 "two voices, never a chorus"** | Two standing agents | **Plus a spatial cap**: never render two agent notes adjacent in the margin without a learner turn between them, and at most one un-replied agent note per anchor / two per page (§B3). Three notes stacked beside one paragraph *look* like a chorus even though they arrived minutes apart; spatial adjacency manufactures the group identity S3 bans. |

---

### B11. Learner controls over where and how much the agents write

Houde et al.'s taxonomy (§7.2, Fig. 7) has three aspects — **when**, **what**, **where** — and three ways
to control them — **how specified**, **who has access**, **how implemented**. Annotation is *litter* in a
way a chat message is not: a chat message scrolls away, a badly placed note sits in the learner's own
document until removed. The A1 control set, all in one **Agents** popover in the top bar, all persisted
per document:

| Control | Koala cell | Values | Default | Implementation |
|---|---|---|---|---|
| **Reject this note** | *what* / repair | one click on any agent note | — | Deletes the block, logs `note.rejected {agent, anchor_id, reason?}`. **Mandatory, not optional**: nothing else on this list matters if the learner cannot undo an agent's intrusion into their own file. |
| **Per-agent mute, per document** | *when* — proactive/reactive, per agent | `Ellie ▢ / Max ▢` | both on | Hard gate in the orchestrator before speaker selection. "Max, not on this file." |
| **Quieter · normal · more** | *when* — Koala's 90/75/50 contribution threshold, renamed | 3-way | normal | Scales (a) the silence-timer thresholds ×1.6 / ×1 / ×0.7, (b) the per-page unsolicited note cap 1 / 2 / 3, (c) Ellie's elaboration frequency. **External logic, never a prompt instruction** — Koala §7.2.6 is the evidence that a prompt will not hold this line. |
| **Where agents may write** | *where* — the genuinely new cell | `only on regions I select` / `anywhere on the page I'm reading` | **only on regions I select** | The default is R1. The second value permits the silence-timer nudge and `Challenge me` to take a whole-page anchor on the current page. There is no third value; agents can never write on a page the learner is not reading. |
| **Length cap on inserted blocks** | *what* — Koala's truncation control | 120 words (answer) / 90 words (agent note) | fixed | Hard truncation in the block writer. In a document an over-long insertion **physically moves the page**; this is not a comfort feature. |

**Deferred to A2, named so the report can say they were chosen rather than missed:** region-level
`no_annotate` as a learner-set property (A1 has it only as a structural property of `learner_note`),
and natural-language steering ("be quieter", typed into any thread) with the one-line confirmation of
how it was interpreted that Houde §7.2.4 proposes — wanted by their P2.1 and doubted by their P2.3.



## C. Screens and layout

### C0. There is one screen

**The document is the screen.** A ChatterED window after the pivot has exactly three persistent
regions and no mode switching between them:

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ●●●   MA3236 · Lecture 4 — Convexity          [shared ●][private ○]  [Agents ▾]  │ ← title bar
├────────────┬───┬──────────────────────────────────────────┬──────────────────────┤
│  VAULT     │ g │            DOCUMENT COLUMN               │    MARGIN COLUMN     │
│  240 px    │ u │            flexible, centred             │       320 px         │
│            │ t │                                          │                      │
│ MA3236   ● │ t │  ┌────────── page 3 (immutable) ──────┐  │ ┌──────────────────┐ │
│  L3    ●●◐ │ e │  │                                    │  │ │ ▸ p.3 "epigraph" │ │
│  L4 ▸ ●◐·· │ r │  │                                    │  │ │   ELLIE · 4 turns│ │
│ CS4246     │   │  └────────────────────────────────────┘  │ └──────────────────┘ │
│  MDP       │ ● │  ┌────────── page 4 ─────────────────┐   │ ╔══════════════════╗ │
│            │ ◐ │  │   ┏━━━━━━━━━━━━━━━━━┓             │   │ ║ ▾ p.4 "PSD …"    ║ │
│            │ ○ │  │   ┗━━━━━━━━━━━━━━━━━┛ ←anchor     │   │ ║ ELLIE · peer     ║ │
│            │ · │  └────────────────────────────────────┘  │ ║ …                ║ │
│            │   │  ┌ YOU ── inline learner_note ───────┐   │ ║ MAX · challenger ║ │
│            │   │  │ If the Hessian is PSD then…       │   │ ║ …                ║ │
│            │   │  └────────────────────────────────────┘  │ ║ ┌──────────────┐ ║ │
│            │   │  ┌────────── page 5 ─────────────────┐   │ ║ │ Reply…       │ ║ │
│            │   │  │                                    │  │ ║ └──────────────┘ ║ │
│ + Add vault│   │  └────────────────────────────────────┘  │ ╚══════════════════╝ │
├────────────┴───┴──────────────────────────────────────────┴──────────────────────┤
│  p. 4 of 24   [Fit page ▾]  −  100 %  +      1 m 52 s unaided      [ Close out ]  │ ← status bar
└──────────────────────────────────────────────────────────────────────────────────┘
```

**There is no chat pane, and that is the point.** Three of the four complaints in
`ui-review-ux.md` reduce to "the pane that carries the product was never put back". The pivot removes
the need for one: if the conversation lives in the document, there is no third pane to miss, no split
to balance, and no "which of these two things am I looking at". Say this in the report — the pivot is
the cheaper fix to the UX problem as well as the more interesting product.

**Chrome is unchanged.** NUSSync's shell: 11 px small-caps speaker labels above blocks (never bubbles),
3 px left rule in the speaker's hue, indigo `#4F46E5` reserved for the learner and for primary actions,
Ellie teal `#0F7B6C`, Max amber `#B45309`, Theo plum `#7C3AED`, `Enter` sends / `Shift+Enter` newline,
course-dot colour coding in the sidebar. No red anywhere (P5). No score, no streak, no confetti.

---

### C1. Column geometry, and what happens when the window is narrow

| Region | Width | Behaviour |
|---|---|---|
| **Vault sidebar** | 240 px, collapsible to 0 | Unchanged from today except that each file now carries its coverage glyph stack. This is the merged single sidebar from `ui-review-code.md` §3 — `NavRail` and the COURSES list fold into it; there is no second column. |
| **Gutter** | 28 px, always present | Coverage glyphs (§B7). Never collapses — it is the progress mechanism and the marker is looking for it. |
| **Document column** | flexible, page centred, `scrollbar-gutter: stable` | The single scrolling canvas. Fit mode defaults to **fit-page** (`ui-review-code.md` §1 fix) so a slide is a glance, not a scroll. |
| **Margin column** | 320 px fixed | Threads and agent notes. Below **1100 px** total window width the margin **docks under the document column** as a full-width strip beneath the page carrying the anchor, and the connector rule becomes a short vertical stub. No thread is ever hidden to save space. |

**The one layout invariant.** A margin block is top-aligned to its anchor's `y0` in viewport
coordinates, then pushed down if it would collide with the block above it. It is never pushed *up* —
a note must never render above the thing it is about. If pushing down carries a note past the bottom of
its page block, it stays there and the connector rule lengthens; the connector is what preserves the
relationship, not the alignment.

---

### C2. The selection tool

**Box-select on the canvas, in page space.** The learner drags a rectangle over any page. There is no
text layer in A1 (`app/docs/STATUS.md`: *"a pdf.js page is a canvas"*), so the rectangle is the
primitive — which is also the right primitive for slides, where the interesting content is equations
and diagrams set as vector art.

- **Modifier-free drag on a page starts a selection.** Drag on empty canvas background scrolls. Hold
  `⇧` while dragging to constrain to a whole text line's height (a convenience, not a requirement).
- **Live feedback:** a 1.5 px indigo rectangle with 12 % indigo fill; the dimensions are not shown
  (a pixel readout invites precision the anchor does not need).
- **Minimum size:** 24 × 12 CSS px. A smaller drag is treated as a click and clears the selection.
- **Snap:** none in A1. `Docling`-style semantic region snapping is an A2 idea (`pivot-integrated-document.md` §D2).
- **Release** → the floating action bar appears (C3). `Esc` clears. Clicking elsewhere clears.
- **An existing anchor is re-selectable**: clicking inside a stored anchor rectangle selects it rather
  than starting a new drag, so the learner adds to a conversation instead of accidentally forking one.

Coordinate handling is specified in §D2; the rule to remember here is that **the rectangle is stored
normalised 0–1 against the PDF page box and never in CSS pixels**, so zoom, window width and
`devicePixelRatio` cannot move it.

---

### C3. The floating action bar

Appears on selection release, 8 px below the rectangle's bottom-left corner (flipped above if it would
fall off the viewport), 40 px tall, one row, no overflow menu.

```
   ┏━━━━━━━━━━━━━━━━━━━━━━━┓
   ┃  selected region      ┃
   ┗━━━━━━━━━━━━━━━━━━━━━━━┛
   ╭───────────────────────────────────────────────────────╮
   │  Ask   │  Explain   │  Challenge me   │  Private note │
   │  ⌘⇧A   │   ⌘⇧E      │      ⌘⇧C        │      ⌘K       │
   ╰───────────────────────────────────────────────────────╯
        ↑ neutral    ↑ INDIGO, primary   ↑ amber tint   ↑ whisper tint
```

**Explain is the primary action and is visually the primary action** — filled indigo, the other three
are ghost buttons. This is a one-pixel decision with a four-mark consequence: the first gesture a
grader sees should be the learner writing, not the machine writing (`pivot-integrated-document.md` §F5.4).
Shortcuts are shown inline, not on hover, because the video needs them legible.

If the region already carries a thread, the bar's labels change to `Open thread · 6 turns`, `Explain
again`, `Challenge me`, `Private note`.

---

### C4. Block chrome

Every inserted block, inline or margin, carries the same four-part chrome:

```
 ┌───────────────────────────────────────────────────────────────┐
 │ ELLIE · peer                     p.4 ▸    ▾    ⋯              │ ← 1  2      3  4
 ├───────────────────────────────────────────────────────────────┤
 │ So when you say "check it's PSD" — check it where? Your        │
 │ sentence works for a single point.                             │
 └───────────────────────────────────────────────────────────────┘
```

1. **Author label** — 11 px small-caps in the author's hue, with the role word (`· peer`,
   `· challenger`, `· first year`, `REFERENCE` for a system answer, `YOU` for the learner). The role
   word is the standing reminder of what each agent is for and the cheapest defence against the two
   agents blurring into "the AI" — the perceptual precondition for the chorus effect (S3).
2. **Anchor breadcrumb** — `p.4 ▸`. Clicking it scrolls the anchor into view and flashes the rectangle.
   On an orphaned block (§A5) this reads `p.4 · could not be placed` in muted type.
3. **Collapse** — `▾`/`▸`, persisted per block (§A4). Collapsed shows the author line plus ~40
   characters.
4. **Overflow `⋯`** — for a learner block: `Move to margin` / `Insert into document`, `Copy`, `Delete`.
   For an agent block: `Not useful ✕` (the reject control, logged), `Move to margin` /
   `Insert into document`, `Mute Ellie on this file`.

**`Insert into document` vs `Keep in margin` is a real, learner-operable toggle, not a system decision.**
Defaults: `learner_note` and `answer` → inline; `agent_note` and every `thread` turn → margin;
`teach_back` → inline. The learner can move any block either way and the choice persists
(`blocks.slot`). The default asymmetry is the ownership argument made visible: **what you wrote is in
the document; what the agents wrote is beside it.**

---

### C5. The whisper layer toggle

A two-state segmented control in the title bar: `[ shared ● ] [ private ○ ]`. It is a *layer*, not a
pane, and it is additive: turning `private` on tints the margin column, dims shared notes to 35 % and
reveals private notes in place. Turning it off hides private notes completely — including from
screenshots and from the export.

A persistent chip sits beside it whenever a private note is focused: `◐ private with Ellie`, with
Max's hue absent from the entire layer while it is up. `⌘K` toggles the layer and opens a private note
on the current anchor in one gesture; `⌘K` again closes without discarding.

**`⌘K` needs one line of care in `App.svelte`.** Today the binding is scoped: inside a room it is the
whisper and `Room.svelte` owns it; everywhere else it is the vault finder, and `App.svelte` stands down
when `store.screen === 'room'`. The canvas replaces the room, so the guard becomes
`store.screen === 'document'` and `DocumentCanvas.svelte` owns `⌘K`. The two scopes still cannot
overlap, which is why this is a rename rather than a conflict.

**The one thing the toggle must not do** is offer a "show everything" state. There is no combined view,
because a combined view is a screenshot that leaks the private layer into a shared artefact.

---

### C6. What a fresh open looks like

There is no session-setup screen (§D5). Opening a file from the vault:

1. The document column renders pages 1–2 (lazy, unchanged).
2. Stored anchors for this `content_sha` are drawn; the gutter fills with their glyphs; margin threads
   render as stubs with the last-touched one active. Scroll position is restored
   (`ui-review-code.md` §5.5).
3. If no anchors exist, a single ghost line sits under page 1's top edge:
   *"Drag a box over anything on this page to start."* It disappears on the first selection and never
   returns for this file.
4. **The concept pack is not requested and no dialog appears.** Elements are extracted lazily — per
   region on first anchor, falling back to per page (§D4). The learner never confirms 3–5 claims in a
   modal before they are allowed to read.



## D. What changes in code

Paths are relative to `/Users/lohzh/ChatterED/app`. **This section assumes the `ui-review-code.md`
§1/§5 fixes have landed** — they have: `PdfViewer.svelte` already has `fitMode`, per-page `sizes`,
`release()` canvas eviction, a geometric `pageAtViewportTop`, `validateRange`, `initialScroll`
restoration and a derived `boxes` array of laid-out page positions. **`boxes` is the single most
useful thing the fix delivered for this pivot**: it is exactly the page-top/height table the block
canvas and the margin's y-alignment need, computed rather than read back out of the DOM.

---

### D1. The viewer becomes a block canvas

**`src/renderer/components/PdfViewer.svelte` — modified, not replaced.** It stops being the screen and
becomes the renderer for `page` blocks plus the owner of the scroll container and the geometry.

| Change | Detail |
|---|---|
| Export the geometry | `boxes: PageBox[]` becomes a `$bindable` prop (or is emitted through a callback). The parent needs `{page, top, height}` and the live `scale` to place everything else. |
| Interleave non-page blocks | The page loop gains inserted `inline` blocks between page boxes. `boxes` must account for their measured heights, so `PageBox` grows to `{ kind: 'page' | 'block', id, top, height }` and `boxes` is computed from `sizes` **and** a `blockHeights: Record<string, number>` map filled by a `ResizeObserver` on each inline block. |
| Selection overlay | A new absolutely-positioned `<div class="sel">` layer per page, above the canvas, `pointer-events: auto`, owning `pointerdown`/`pointermove`/`pointerup`. Existing anchors render here as 1.5 px rectangles. |
| Remove | The page-range toolbar (`pageFrom`/`pageTo`, "Start here"/"End here") and `locked`/`pageWindow` go with "Show the room" (§D7). `validateRange` and `markStart` in `lib/pdfview.ts` go with them. |

**New: `src/renderer/lib/anchor.ts`** — the only module allowed to convert between coordinate spaces.
Everything else passes normalised rectangles around.

```ts
/** A rectangle normalised 0..1 against the PDF page box. The stored form. Never CSS pixels. */
export interface NormRect { x0: number; y0: number; x1: number; y1: number }

/** Viewport (client) px → page-local CSS px → normalised. */
export function toNorm(
  ev: { clientX: number; clientY: number },
  pageEl: HTMLElement,          // the .page div, whose CSS size is Math.round(size.w * scale)
  size: PageSize,               // the page's own size in PDF points, from `sizes`
  scale: number,                // pdf.js user-space → CSS scale, NOT multiplied by dpr
): { x: number; y: number } {
  const r = pageEl.getBoundingClientRect();
  return {
    x: clamp01((ev.clientX - r.left) / (size.w * scale)),
    y: clamp01((ev.clientY - r.top)  / (size.h * scale)),
  };
}

/** Normalised → CSS px for drawing, at the current scale. */
export function toCss(rect: NormRect, size: PageSize, scale: number) {
  return {
    left:   rect.x0 * size.w * scale,
    top:    rect.y0 * size.h * scale,
    width:  (rect.x1 - rect.x0) * size.w * scale,
    height: (rect.y1 - rect.y0) * size.h * scale,
  };
}
```

**Three coordinate rules, each of which is a bug if broken.**

1. **`devicePixelRatio` never enters an anchor.** `draw()` already keeps the two apart correctly —
   `const dpr = Math.min(2, window.devicePixelRatio || 1)`, backing store at `scale * dpr`, CSS box at
   `viewport.width / dpr`. The anchor layer uses **`scale` only**. Anyone who writes `scale * dpr` into
   `anchor.ts` has introduced a bug that only appears on an external monitor.
2. **Use the page's own size, not page 1's.** `sizeOf(n)` from the §5.8 fix. A portrait cover sheet in
   front of landscape slides is common in course material, and normalising against the wrong page box
   puts every anchor on that page in the wrong place.
3. **Round to CSS pixels at the last possible moment.** Store floats; round only in `toCss`, and derive
   the drawn rectangle and the page box from the same rounded integer, exactly as `draw()` now derives
   `canvas.width` and `canvas.style.width` from one `cssW`.

**New components** (all in `src/renderer/components/`):

| File | Responsibility |
|---|---|
| `DocumentCanvas.svelte` | Replaces `Room.svelte` as the screen. Owns the three-column grid (§C0), mounts `PdfViewer`, `CoverageGutter`, `MarginColumn`; holds the active anchor. |
| `SelectionOverlay.svelte` | Box-select per page: drag, minimum size, existing-anchor hit-testing, `Esc`. Emits a `NormRect` + page number. |
| `ActionBar.svelte` | The four-button floating bar (§C3) with its flip-above logic. |
| `Block.svelte` | One inserted block: chrome (§C4), body, collapse, overflow menu. Delegates to the existing `Message.svelte` for the body so the speaker-label/rule/hue treatment is not re-implemented. |
| `MarginColumn.svelte` | Stacks thread and note blocks; top-aligns to `anchor.y0` in viewport space; pushes down on collision, never up; draws connectors. Docks below the document under 1100 px. |
| `CoverageGutter.svelte` | The 28 px glyph column, hover linkage both ways, the 400 ms fill animation. |
| `AgentsPopover.svelte` | Mute, quiet/normal/more, where-agents-may-write (§B11). |

---

### D2. Migrations and repositories

- **New:** `src/main/db/migrations/009_documents_blocks_anchors.sql` — the DDL is given in full in §A3.
- **New:** `src/main/db/repos/documents.ts` — `documents`, `anchors`, `blocks`. Follows the shape of
  `repos/core.ts`. Minimum surface: `openDocument(fileId)`, `listAnchors(documentId)`,
  `createAnchor(input)`, `listBlocks(documentId)`, `createBlock(input)`, `setSlot(blockId, slot)`,
  `setCollapsed(blockId, on)`, `deleteBlock(blockId)`, `setControls(documentId, patch)`,
  `setViewState(documentId, { scrollTop, fitMode, zoom, activeAnchorId })`, `orphan(anchorId)`.
- **Modified:** `src/main/db/repos/core.ts` — `MessagesRepo.insert(row)` already takes a whole
  `MessageRow`, so the only change is the new `anchor_id` field on `MessageRow`; add
  `forAnchor(anchorId): MessageRow[]` alongside the existing `forRoom` / `forRoomUpToSeq` / `tail`.
- **Modified:** `src/main/db/repos/whispers.ts` — `anchor_id` on `WhisperRow`, plus
  `forAnchor(anchorId)`.
- **Modified:** `LedgerRepo` — `forSession(sessionId)` stays (the whole document's rows); add
  `forAnchor(sessionId, anchorId)` and `forPage(sessionId, page)`, the latter being what the
  teach-back gate and the page glyph stack read. `upsert(row)` now writes the three-part key.
- **Modified:** `src/room/ports.ts` — the new `DocumentsRepo`, `AnchorsRepo` and `BlocksRepo` join
  `Store`. **They must join `GroupStore` too** (blocks and anchors are public, like `message_refs`),
  and **`GroupStore` must still not carry `whispers`** — that structural separation is the whisper
  invariant, and `context.test.ts` asserts it over the import graph.
- **New fractional-index helper:** inserting a block beneath page *N* takes
  `ord = N + (rank of its anchor by y0 among that page's anchors) / 1000`, then midpoints on any
  subsequent insert. Never renumber.

**One decision to make explicit for the implementer:** a document opens **one room and one session**,
created on first open and reused thereafter (`documents.room_id`, `UNIQUE(room_id)`). This keeps the
actor, the ledger, the events table and the outbox working exactly as they do now, and makes "the
conversation is saved with the document" true without touching `sessions`.

---

### D3. Context builder — the anchored region and its neighbours

**`src/room/context.group.ts` — modified.** `buildGroupContext` already has the right mechanism and it
must be reused rather than re-invented: reference text goes **in the message stream, after every cache
breakpoint**, never into `system[0]`, because the prefix is frozen and hashed at confirmation.

```ts
export interface GroupContextInput {
  roomId: string;
  speaker: AgentProfile;
  roster: AgentProfile[];
  pack: ConceptPack;
  directive: TurnDirective;
  /** NEW — the region this turn is about. */
  anchor?: AnchorContext;
  maxTokens?: number;
}

export interface AnchorContext {
  anchorId: string;
  page: number;
  label: string;
  /** Text under the box. May be '' — normal for a vector-art equation or a diagram. */
  regionText: string;
  /** The anchors immediately above and below this one on the same page, by y0. */
  neighbours: { above?: string; below?: string };
  /** Whole-page text, used ONLY when regionText is empty. */
  pageText?: string;
}
```

`anchorBlock(anchor)` renders, appended to the last `user` turn immediately before the turn directive
(which stays last, per the cache rule "the volatile part goes after every breakpoint"):

```
[Region — page 4, "∇²f(x) is PSD for every x ∈ S"]
…the text under the selected box…

[Just above on the page] …600 chars…
[Just below on the page] …600 chars…
```

**Caps, all applied in the main process, matching the existing `message_refs.selection` discipline:**
region 1,500 chars · each neighbour 600 · whole-page fallback 4,000. **Why neighbours at all:** a box
drawn round one line of a theorem loses the quantifier in the line above it, and an agent that cannot
see the quantifier will probe the wrong thing. Two neighbours is the cheapest fix and it is bounded.

**`src/room/context.whisper.ts` — the same `anchorBlock` addition, and nothing else changes.** The
whisper builder keeps its own store view. The leak-canary test gains two assertions: no
`visibility='private'` block reaches the shared renderer payload, and no whisper text reaches the
`.chattered.json` writer.

---

### D4. Orchestrator — anchor awareness and the document-wide floor

**`src/room/orchestrator.ts` — modified.** The rules-then-model shape is unchanged and is the thing the
report cites Houde et al. §7.2.6 to defend (*"we resorted to using external decision logic"*). What is
added is a set of **hard gates that run before `ruleDecision`** and can only ever say *no*:

```ts
export interface DecisionInput {
  // …existing fields…
  /** NEW */
  anchorId: string | null;
  anchorPage: number | null;
  /** NEW — the document-wide floor. Non-null ⇒ every agent is refused. */
  inFlight: { agentKey: string; anchorId: string } | null;
  /** NEW — per-document Houde controls. */
  controls: { muteEllie: boolean; muteMax: boolean;
              chatter: 'quiet' | 'normal' | 'more';
              writeScope: 'selected' | 'page' };
  /** NEW — density accounting. */
  unrepliedOnAnchor: number;
  unrepliedOnPage: number;
  /** NEW — whether the learner has ever selected this anchor themselves (rule R1). */
  learnerSelected: boolean;
}
```

| Gate | Rule | Returns |
|---|---|---|
| **G1 in-flight** | `inFlight !== null` → refuse. One agent turn document-wide (§B10). The token is taken in `actor.ts` *before* generation and released on post **or** cancel; a refused turn is **dropped, not queued**. | silence |
| **G2 mute** | The chosen agent is muted on this document → refuse, and do not fall through to the other agent (a mute that reroutes to Max is not a mute). | silence |
| **G3 scope** | `writeScope === 'selected'` and `!learnerSelected` → refuse. This is rule R1 in code. `writeScope === 'page'` additionally permits a whole-page anchor on the page currently in the viewport. | silence |
| **G4 density** | `unrepliedOnAnchor >= 1` or `unrepliedOnPage >= cap(chatter)` where cap = 1 / 2 / 3 → refuse. **External logic, not a prompt line** — Koala §7.2.6 is the evidence a prompt will not hold this. | silence |
| **G5 answer-block** | The anchor's only block is an `answer` and the learner has not pressed *Explain it back* → refuse (§B1). | silence |
| **G6 no-annotate** | `anchors.no_annotate = 1` → refuse. | silence |

**S2 co-location.** `DISAGREEMENT_QUOTA = 5` is unchanged, but the quota counter only accepts a
disagreement whose `anchor_id` equals the anchor of the turn it disagrees with, **and** whose target
turn is the immediately preceding agent turn in that thread. Add `disagreementOnAnchor` to the
accounting and assert it in `orchestrator`'s tests. A disagreement twelve pages apart is never seen and
must not count.

**Target selection.** `TurnDecision.targetElementId` is now resolved from `anchors.element_id` when the
anchor has one, instead of from the ledger alone — the anchor *is* the address
(`progress-tracking.md` §6.1: a probe is only sharp when aimed at a specific element × level, and an
anchor supplies that address without an LLM guessing it).

**`src/room/actor.ts` — modified.** Every `messages.insert` carries `anchorId`. The actor owns the
in-flight token, and the existing cancellation path (a learner message cancels a held reply rather than
queueing it) also releases it.

**`src/room/timer.ts` — modified.** `TimerHooks` gains `onSelectionChange()` alongside the existing
typing hook; `isIdle` becomes *no typing* **and** *no selection change*. Scroll, zoom and page
navigation are **not** inputs (§B8). Constants — 45 s / 90 s, `HOLD_MS = 60_000`,
`LATE_FIRE_CUTOFF_MS = 120_000`, ≤2 fires per round — are **unchanged**; "round" is read as "page"
(§G Q3). The fire target becomes `{ anchorId }`, defaulting to the page anchor of the page filling the
viewport.

---

### D5. Ledger keyed by region

**`src/room/ledger.ts` — modified, minimally.** `applyLedgerRules` is pure and its four hard rules are
the most valuable code in the repo; do not touch them. Changes:

- `ApplyInput` and `ApplyResult` carry `anchorId`.
- The row key becomes `(session_id, anchor_id, element_id)` (§A3).
- `levelToState`, `bloomRung`, `coverage`, `CONFIDENCE_FLOOR = 0.6`, `normalise`, `isAgreementOnly` —
  **all unchanged**.
- `bloomRung(rows)` gains a per-page caller for the teach-back gate: `bloomRung(rowsOnPage(page))`.
- Rule 1 (evidence must be a verbatim substring of a **student** message) now also rejects evidence
  drawn from an `answer` block or a whisper — both are already non-student, so this is an assertion,
  not a new rule. **Add the assertion anyway**, because `answer` blocks are a new way to get
  agent-authored text into the document and the ledger must not be able to read it.

**`src/renderer/components/LedgerRail.svelte` and `LedgerRow.svelte` — deleted.** The gutter replaces
them. Their glyph set, wording and animation move verbatim into `CoverageGutter.svelte`; nothing about
the visual language changes (`product-design.md` §D2, §D3).

---

### D6. `ScriptedClient` replays the §G script as an anchored thread — the video's insurance

**`src/room/llm/scripted.ts` and `script.psd-hessian.ts` — extended, not rewritten.** The script is
already data: `SCRIPT_BEATS` with cues `open`, `student:1…5`, `silence:1`, `silence:2`, and
`SCRIPT_WHISPERS` with `whisper:1`, `whisper:2`. `ScriptedClient` answers all four scopes
(`orchestrator`, `group`, `ledger`, `whisper`) from `request.meta.scriptCue`, and the ledger's evidence
is lifted **verbatim from what the learner actually typed** — so rule 1 really passes and the quote in
the gutter is really theirs.

The only change needed: **`ScriptedBeat` gains an optional `anchor` field**, and the actor passes it
through to the block writer.

```ts
export interface ScriptedBeat {
  cue: string;
  decision: ScriptedDecision;
  text?: string;
  disagreement?: { marker: …; targetRole: AgentRole };
  ledger?: { … };
  /** NEW — where this beat lands in the document. */
  anchor?: {
    /** Stable key into the demo document's seeded anchors. */
    ref: 'R1' | 'R2' | 'R3';
    slot: 'inline' | 'margin';
  };
}
```

and a **seed fixture**, `src/room/llm/script.psd-hessian.anchors.ts`, mapping `R1`/`R2`/`R3` to three
normalised rectangles on page 4 of the demo PDF, so a fresh install can replay the whole exchange with
no hand-drawn boxes:

```ts
export const DEMO_ANCHORS = [
  { ref: 'R1', page: 4, rect: { x0: 0.118, y0: 0.402, x1: 0.664, y1: 0.447 },
    label: '∇²f(x) is PSD for every x ∈ S', elementId: 'R1' },
  { ref: 'R2', page: 4, rect: { x0: 0.118, y0: 0.451, x1: 0.512, y1: 0.489 },
    label: 'positive semidefinite',        elementId: 'R2' },
  { ref: 'R3', page: 4, rect: { x0: 0.118, y0: 0.352, x1: 0.588, y1: 0.396 },
    label: 'on an open convex set S',      elementId: 'R3' },
];
```

**Every beat of the §G script maps onto the document with no rewriting**, which is the point:

| Cue | Lands as | Anchor |
|---|---|---|
| `open` | Ellie's opener, `agent_note`, margin | R1 |
| `student:1` | learner's explanation, `learner_note`, **inline** | R1 |
| `student:2` | Max's assumptions probe, margin | R1 |
| `silence:1` | Ellie's content-free nudge, margin, in the active thread | R1 |
| `whisper:1`,`whisper:2` | private notes in the whisper layer, with the relay offer | R2 |
| `student:3` | the relayed question, then the learner's self-correction, inline | R2 |
| `student:4` | Max's implications probe → the `x³` counterexample | R3 |
| `student:5` | Ellie's co-located disagreement with Max, then the learner closes | R1 |

Set **Settings ▸ Backend = `scripted`** (the switch already exists: `resolveBackend` in
`src/main/llm/backend.ts` treats `'scripted'` as a first-class choice, and `modeFor()` reports it to the
UI) and the demo runs through the real actor, the real 45 s timer, the real ledger gates and the real whisper scoping, with **zero model
calls and zero network risk on recording day**. This is the single most valuable asset the pivot
inherits and it survives untouched, because the script produces *messages* and messages do not care
where they are drawn.

---

### D7. What is deleted

| Deleted | Why | Notes |
|---|---|---|
| **"Show the room · p. N"** — `store.showTheRoom()` (`store.svelte.ts:451`), `IPC.showDocument`, its `main/ipc.ts` handler, and the CTAs in `DocumentPane.svelte` | It is what the whole app now does. Selecting a region *is* showing the room. | **Do not drop the `message_refs` table** — existing transcripts must still render. Stop writing new rows; `referenceBlock()` stays in `prompts.ts` for them. **This is a feature deleted by the pivot, which is evidence the pivot is a simplification rather than an addition — say so in the report.** |
| **`RoundCard.svelte`, `src/room/roundcard.ts`, `roundcard.test.ts`** | A round card is a system message in a stream that no longer exists. | Its content becomes a **one-time first-open strip** above page 1, dismissible, remembered per vault. The copy already exists as `SCRIPT_ROUND_CARD` in `src/room/llm/script.psd-hessian.ts` — reuse its `body` verbatim, changing only "they'll disagree with each other sometimes" to name the margin. **The pacing disclosure is a rubric and ethics requirement** (`design-brief.md` §D4: undisclosed pacing is *performative deliberation*) and must not be lost with the card. |
| **`RecapCard.svelte`** and the recap overlay | The document *is* the recap: scroll it and you see what you defended. The 408 × 2043 px overlay showing three zeroes goes. | Layers 3 and 4 (act profile, unaided seconds) and the **correction block** move to a **Close-out sheet** on the status bar. The correction block is non-negotiable: a session that ends with a learner confidently wrong is the primary harm this design can cause. |
| **`SessionSetup.svelte`**, `store.goSetup()`, `store.setupFrom`, `IPC.draftConcept` as a *blocking* step | A document opens straight into the canvas. No modal asks the learner to confirm 3–5 claims before they are allowed to read. | `draftConcept` survives as a **lazy, per-region call** (§D8). `IPC.createSession` survives, called implicitly on first open. |
| **`LedgerRail.svelte`, `LedgerRow.svelte`** | Replaced by `CoverageGutter.svelte`. | Glyphs, wording and animation are carried over verbatim. |
| **`SourcePane.svelte`**, and `PdfViewer`'s `locked` / `pageWindow` props | The room's locked "slide you are explaining" pane has no job when the document is the room. | |
| **`Room.svelte`** | Replaced by `DocumentCanvas.svelte`. | `Thread.svelte`, `Composer.svelte`, `Message.svelte`, `ThinkingIndicator.svelte`, `WaitLine.svelte`, `Divider.svelte`, `RelayOffer.svelte` are all **kept and re-slotted** into margin blocks — they need a slot, not a rewrite. |
| **The page-range toolbar** — `pageFrom`/`pageTo`, "Start here"/"End here", `validateRange`, `markStart` | Superseded by box-select. | Deleting this also closes `ui-review-code.md` §5.4 by removing the surface that had the bug. |
| **`store.docFrom` / `docTo` / `pendingPage` range plumbing** | Same. | `store.docScroll` and `docPage` are **kept** — they become `documents.scroll_top` (§A4). |

### D8. What is kept untouched

Do not open these files except to add a field.

| Kept | Why it survives |
|---|---|
| `src/room/timer.ts` — the 45/90 s machine, `HOLD_MS`, `LATE_FIRE_CUTOFF_MS`, typing-awareness, `Hold`, `Wait for me` | Only the idle *predicate* changes (a new hook), not the machine or the constants. |
| `src/room/context.whisper.ts`, `context.group.ts`'s `GroupStore` separation, and the **leak-canary test** | The whisper invariant is the product's most novel component and its most dangerous failure. Extend the canary; never relax it. |
| `src/main/apikey.ts` + `apikey.test.ts` | Untouched. |
| `src/main/llm/claude-cli.ts`, `backend.ts`, `detect.ts` | The CLI client and backend detection are orthogonal to where messages are drawn. |
| `src/main/vault/*` — scan, finder, `pdf.ts` extraction, `service.ts`, the FTS5 `file_text` index | 100 % carry-over. **One new file only:** `src/main/vault/regions.ts`, which intersects a normalised rectangle against the per-item boxes `pdf.ts` already computes, to produce `anchors.region_text`. |
| `src/renderer/components/VaultSidebar.svelte`, `VaultBrowser.svelte`, `FileTree.svelte`, `Finder.svelte`, `Library.svelte` | The vault sidebar stays. It gains one thing: a coverage glyph stack per file. |
| `src/room/prompts.ts`, `prompts.whisper.ts`, `agents.ts`, personas, the three-hue palette, `vault/palette.ts` | Copy and tone are unchanged by the pivot. `anchorBlock()` is the only new renderer in `prompts.ts`. |
| `src/room/mailbox.ts`, `records.ts`, `views.ts`, the outbox, `events` | Unchanged. |
| `src/main/db/migrations.ts` and every shipped `.sql` | Forward-only. 009 is added; 001–008 are never edited. |

### D9. Lazy concept extraction

The concept pack stops being a set-up step and becomes a background call.

1. **On first anchor on a page**, fire one `draftConcept`-style Sonnet call over that page's extracted
   text, producing 3–5 elements in the existing Concept Pack schema (`progress-tracking.md` §3), stored
   with `pack_provenance = 'elicited'`.
2. **Assign `anchors.element_id`** by matching the anchor's `region_text` against the returned element
   labels; on no match, create a one-off element for that region from its own text.
3. **If the call fails or times out (>6 s), the gutter shows `·` and the conversation continues.** The
   document never blocks on the ledger or on the pack — a progress display that can stall the
   conversation is worse than no progress display.
4. **Fallback when `region_text` is empty** (a vector-art equation, a diagram): the element is created
   from the *page's* text and labelled with the page, and the gutter glyph is drawn at the anchor.



## E. Seven-day plan, with the Thursday gate

**Working days:** Tue 16 → Mon 22 Sep 2026. **Submission:** Mon 22 Sep 23:59.

**Day 0 (tonight, Mon 15).** The `ui-review-code.md` §1 and §5 fixes are landing in `app/` right now.
**Do not start Day 1 against an unfixed viewer** — `boxes`, `sizes`, `fitMode` and `release()` are the
foundation the block canvas is built on. Tonight's only pivot work: answer §G Q1 and Q2, and send the
§F3 follow-up to two participants so it has 48 h to come back.

---

### Day 1 — Tue 16 · Migration, anchors, box-select

| | |
|---|---|
| **Build** | `009_documents_blocks_anchors.sql` (§A3) + `repos/documents.ts`. `src/renderer/lib/anchor.ts` with unit tests for `toNorm`/`toCss` round-tripping at scale 0.6 / 1.0 / 2.4 and dpr 1 / 2. `SelectionOverlay.svelte`: drag a box on a page, minimum size, `Esc`, existing-anchor hit-test. Persist the anchor. `src/main/vault/regions.ts` for `region_text`. |
| **Real** | The migration, the anchor record, the rectangle, `region_text`, redraw on reopen. |
| **Mocked** | Everything else. No blocks, no agents, no gutter. |
| **Gate** | **An anchor drawn on page 4 survives quit and relaunch, and lands on the same pixels at a different zoom, a different window width and on an external monitor (dpr 1).** If the rectangle moves when the monitor changes, `dpr` has leaked into `anchor.ts` — fix it tonight, not Wednesday. |

### Day 2 — Wed 17 · The block canvas

| | |
|---|---|
| **Build** | `DocumentCanvas.svelte` — the three-column grid (§C0). `PdfViewer` exports `boxes` and interleaves `inline` blocks. `Block.svelte` with the §C4 chrome, wrapping the existing `Message.svelte`. `MarginColumn.svelte` with y-alignment, collision push-down and connectors. `ActionBar.svelte`. Blocks persist with `ord`, `slot`, `collapsed`. `App.svelte` routes a vault file straight to `DocumentCanvas` (§D7: `SessionSetup` out). |
| **Real** | The whole layout. A learner can select a region, type a note into it, and find it in the same place after a relaunch. Inline/margin toggle works. |
| **Mocked** | Agent turns — use a hard-coded stub note for Ellie so the margin geometry can be seen. No orchestrator, no timer. |
| **Gate** | **A learner-written note renders inline beneath page 4 with a connector to its box; a stub margin note sits beside it, y-aligned; both survive relaunch; nothing overlaps at 900 px, 1320 px and 1800 px window widths.** |

### Day 3 — Thu 18 · Threads through the real actor · **⟵ FALLBACK GATE**

| | |
|---|---|
| **Build** | `messages.anchor_id` end to end: `actor.ts` writes it, `messages.forAnchor` reads it, `MarginColumn` renders it. `context.group.ts` + `anchorBlock()` (§D3). Orchestrator gates G1 (in-flight) and G3 (scope) (§D4). Wire `ScriptedClient` with `DEMO_ANCHORS` (§D6). Then **primitive (1) Ask here**: the prompt-at-selection, the `reference` participant, the 120-word cap, the *Explain it back* hand-back and gate G5. |
| **Real** | A full anchored exchange: learner writes inline, Ellie and Max reply in the margin, the turns are real `messages` rows through the real actor and the real latency holds. Ask here inserts a real `answer` block that cannot move a ledger row. |
| **Mocked** | Coverage glyphs (draw `·` for everything). Silence timer still using the old idle predicate. Whisper still the old pane. |
| **Gate** | **HARD GATE, called by 22:00 Thu 18: does a complete scripted exchange of ≥ 6 turns play inside the margin on one anchor, twice in a row, without a restart?** Yes → continue to Day 4. **No → fall back tonight (§E-F below), and do not spend Friday trying to rescue it.** |

### Day 4 — Fri 19 · Coverage, pacing, privacy

| | |
|---|---|
| **Build** | `CoverageGutter.svelte` — glyphs from the live ledger keyed by `anchor_id` (§D5), the 400 ms fill animation scheduled inside the next hold, bidirectional hover. `timer.ts` `onSelectionChange` hook and the new idle predicate (§B8); the nudge lands in the active thread. Latency legibility: the anchor ring, the reserved margin slot with Max's counter, the off-screen breadcrumb (§B9). The whisper **layer**: toggle, tint, dim, `⌘K`, the relay with attribution, `whispers.anchor_id`. Orchestrator gates G2/G4/G6 and `AgentsPopover.svelte` (§B11). Extend the leak-canary test. |
| **Real** | ○ → ◐ → ● moving on camera. 45 s idle with the new predicate. Private notes anchored, toggleable, absent from the sidecar. Mute / quiet-normal-more / where-agents-may-write. |
| **Mocked** | Primitive (6) Teach this page — **storyboarded, not built** (the gate is one `bloomRung(rowsOnPage)` call, but Theo's turns are a day this week does not have). Orphan handling — the column exists, the panel does not. |
| **Gate** | **A glyph moves from ○ to ● on camera during a live scripted run, and a private note is provably absent from `<name>.chattered.json`.** |

### Day 5 — Sat 20 · The demo path, and the sidecar

| | |
|---|---|
| **Build** | `.chattered.json` write-on-close (§A3). The one-time first-open strip carrying the house rules and the **pacing disclosure** rescued from the dead round card (§D7). The Close-out sheet (act profile, unaided seconds, correction block). Run the §F1 storyboard end to end **five times** and fix only what breaks. Storyboards for primitive (6) and for orphan handling, labelled as storyboards. **Stretch, only if everything above is green by 16:00:** pdf-lib flatten to `~/Documents/ChatterED/<name>-annotated.pdf`. |
| **Real** | The full 16-beat path, twice without a restart. |
| **Mocked** | Teach-back, orphans, pdf-lib (unless the stretch lands). |
| **Gate** | **Two clean end-to-end runs, no restart, no console errors, and the ZIP builds.** Freeze the code at 22:00. No commits on Sunday. |

### Day 6 — Sun 21 · Record

| | |
|---|---|
| **Do** | Record the §F1 storyboard. One page, one anchor, camera still, face visible throughout. Re-record once, keep the better take. Write `README.md` for the prototype ZIP: prototyping method, how to run (`npm i`, `npm run dev`, then Settings ▸ Backend = `scripted`), what is real and what is scripted, and where in `src/` each beat lives. Assemble the ZIP: source, this spec, the concept pack, the storyboards, the §F3 follow-up script and its answers. |
| **Gate** | **Video under 10 min and under 200 MB. ZIP opens on a machine that is not this one.** |

### Day 7 — Mon 22 · Report buffer

| | |
|---|---|
| **Do** | 2,000 words, Steps 1–4 in order, to the §F2 budget. Appendices (excluded from the count): the §F1 script, the §A3 schema, the safeguards table, the §D comparison of document approaches. Submit by 18:00, six hours early. |
| **Gate** | **Submitted.** Nothing else ships today — Monday is a buffer, not a build day. |

---

### E-F. The fallback, defined now so it can be taken without deliberating

**Trigger:** the Day 3 gate fails at 22:00 Thu 18. Also take it unilaterally if, at any point,
`DocumentCanvas` cannot render a real agent message in the margin.

**What the fallback is: a rendering-only overlay on the current viewer** — approach (i-a) from
`pivot-integrated-document.md` §D1, which is a strict subset of everything above, so **nothing built on
Days 1–3 is thrown away.**

| Keep | Drop back to |
|---|---|
| `Room.svelte` and the chat thread as the conversation surface | — |
| Box-select, `anchors`, `anchors.region_text`, `messages.anchor_id` — all shipped on Days 1–3 | — |
| The gutter glyphs on the document pane | — |
| `DocumentCanvas`, inserted inline blocks, the margin column | **Drop.** Each chat message renders its anchor as a breadcrumb chip (`p.4 ▸ "PSD for every x ∈ S"`) that scrolls the document pane to the box and flashes it. Clicking a box filters the chat to that anchor's turns. |
| `SessionSetup`, the round card, the recap | **Restore** — they still exist on Thursday morning, so this is a revert, not a rebuild. |

**Cost:** about four hours on Friday morning. **What the video then shows:** the chat exchange, with the
document pane highlighting the region under discussion as each turn lands, and the gutter glyphs moving
on the slide. **What the report then says:** exactly what it says anyway — the interaction model is
unchanged, the surface changed, and this specification is the Step 3 implementation plan with two days
of it built. Steps 1 and 2 are identical either way, which is why this fallback costs almost nothing.

**The one thing the fallback must not become:** a decision deferred to Friday afternoon. Call it
Thursday at 22:00, out loud, in the issue.



## F. Video storyboard and report framing

### F1. Video storyboard — 16 beats, 10 minutes

**Subject:** the anchored thread on *"a twice-differentiable f is convex on an open convex S iff ∇²f(x)
is PSD for every x ∈ S"* (`design-brief.md` §G), played **inside the document** on page 4.

**Three filming rules, non-negotiable.**
1. **One page, one anchor, camera still.** Do not scroll during a turn. A margin conversation is
   harder to film than a chat because a chat is a vertical list in reading order; turns scattered
   across a scrolling page lose the viewer within two exchanges. The whole exchange stays in one frame.
2. **The first frame is the learner writing, not the machine writing.** If the grader's first sight is
   an AI writing a paragraph into a PDF, the pedagogy has to be argued uphill for nine minutes.
3. **Say "scripted" the first time something is scripted, then stop apologising.** `ScriptedClient`
   replays real turns through the real actor, timer, gates and whisper scoping. A scripted turn
   presented as scripted costs nothing; a scripted turn presented as live costs the ownership mark.

| # | t | Frame | What happens | What you say |
|---|---|---|---|---|
| 1 | 0:00 | **Face** | Name, module, one sentence. | "One learning task: reading a lecture slide in non-linear optimisation and being able to defend what it says. Three students, all of whom can get an answer and none of whom can explain it." |
| 2 | 0:40 | **Face + one slide of quotes** | Step 1 in 40 s: who the three participants were (programme, year), the difficulty, one verbatim quote. | "*[verbatim: 'I can get an answer for ___, but I still can't ___ on my own.']* That is 'uncritical use of AI output', and it is the difficulty I designed against." |
| 3 | 1:20 | **Two screenshots side by side** | Old: PDF left, chat right. New: the document with the margin. | "Everything they showed me was this shape — the material on one side, the conversation on the other, and the answer ends up in neither. So I moved the conversation into the document." |
| 4 | 2:00 | **App, real** | Open the file from the vault. Scroll to page 4. | "This is their own lecture slide, out of their own folder. No upload step. The turns you're about to see are a scripted transcript replayed through the real turn-taking engine — the pacing, the gates and the private channel are live." |
| 5 | 2:20 | **Drag a box** | Box-select `∇²f(x) is PSD for every x ∈ S`. Action bar appears. Press **Explain**, not Ask. | "Selecting is a turn. The assignment's own definition counts what the learner *does*, not only what they type — and this one gesture supplies the referent, the scope and the retrieval context for free." |
| 6 | 2:50 | **Inline learner block** | The learner's explanation is typed into the document, indigo, full width. | "The learner writes first, in the document. Everything the agents write goes in the margin. That asymmetry is the design." |
| 7 | 3:20 | **Margin, Ellie** | Held 4–6 s, then Ellie's elaboration request lands, y-aligned. | "Four seconds, deliberately. Fast enough to read as a study buddy." |
| 8 | 3:50 | **Gutter glyph** | `○ → ◐` animates while Max's hold runs. | "That's the progress mechanism, and it is *in the margin of the claim it is about*. Three states: stated, justified, defended." |
| 9 | 4:20 | **Anchor ring + Max** | Amber ring pulses on the anchor, `Max is reading…`, counter climbing, then the probe lands. | "Eleven seconds, on purpose. Tan et al. found two-second replies get read as less thoughtful; nine seconds got the best usefulness ratings. Max picked *probing assumptions* because her sentence was missing a quantifier — not from a script." |
| 10 | 5:00 | **Silence timer** | Learner's pointwise answer, then 45 s idle, then Ellie's nudge in the same thread. | "Forty-five seconds with no typing *and no new selection*. Scrolling doesn't count — re-reading the slide is the behaviour I don't want to punish. And notice the nudge contains no mathematics." |
| 11 | 5:30 | **Whisper layer** | Toggle `private`, the PSD-entries question, Ellie's `A = [[1,2],[2,1]]` counterexample, the relay with its attribution choice. | "This is the feature from my Critique 1. `/btw` claimed it could send something back to the main session and couldn't. This one can — with her permission, and she chooses whose name is on it." |
| 12 | 6:10 | **Relay lands** | Ellie's relayed question appears as a shared margin note; the learner self-corrects. Two glyphs move. | "That's a self-correction. The ledger scores it as a win, not a mistake — and the private channel can never move a glyph, so whispering is never the efficient path to progress." |
| 13 | 6:40 | **Max, probe 2** | Implications probe; learner gives `f(x) = x³`; `◐ → ●` on two rows. | "Only a challenge can produce the filled circle. That is the answer to 'could a quiz do this?' — no, because the terminal state is defined by responsiveness to challenge." |
| 14 | 7:10 | **Ellie disagrees** | Ellie's dissent renders directly beneath Max's probe, in the same thread. | "The agents are required to disagree with each other, and it only counts if it happens in the same place. Song et al. showed agreeing agents create pressure to conform without making anything more accurate." |
| 15 | 7:35 | **Close and scroll** | Learner closes the thread. Scroll away and back; quit and relaunch; the thread is still in the middle of page 4. | "She gets the last word — no agent may summarise the conclusion. And the conversation is saved with the document, not with a session." |
| 16 | 8:00 | **Face, 2 min** | Division of labour · one design decision · one limitation · what was real vs scripted. | Design decision: *"An agent may only write on a region she selected. There is no pre-annotation anywhere, because Joshi & Vogel found learners preferred selecting the passage themselves."* Limitation: *"The nearest study to this found margin notes were preferred and produced more ownership — and had no measurable effect on delayed comprehension. My measure isn't comprehension; it's defended explanation. That's a different construct, and it's unvalidated."* |

**Fallback storyboard**, if the Thursday gate (§E) fails: beats 1–3 unchanged; beats 4–15 are filmed on
the existing chat app with the document pane open, and beat 3 becomes *"here is the design response I
specified and the first two days of it that I built"*, shown as this specification plus the working
box-select. Beat 16 is unchanged. The report's Steps 1 and 2 are identical either way.

---

### F2. Report framing — presenting the pivot as a design response

**The one sentence that protects four marks, and it goes in Step 3, not Step 1:**

> *The interaction model is unchanged. The surface changed.*

The difficulty (*uncritical use of AI output*), the learning goal, the division of labour and DG1–DG5
are all identical before and after the pivot; what moved is where the conversation is drawn. Saying that
plainly stops a grader reading the pivot as a late change of subject.

**The honesty constraint.** The three interviews were run about the *chat* workflow. Do **not** present
the pivot as an interview finding unless the transcripts actually contain the workflow complaint. Three
tiers, in descending order of what the evidence will support — pick the highest one the data honestly
reaches:

| Tier | Requires | How to write it |
|---|---|---|
| **1 — user-grounded** | A participant volunteered something about the *split*: copy-pasting between the PDF and the chat window, screenshotting a slide, losing track of which answer went with which slide, the answer ending up somewhere other than the material. | Put it in Step 1 under *User needs* as a fourth need ("the answer lives away from the material"), and the pivot becomes the strongest paragraph in the report. |
| **2 — behaviourally grounded** | The Block 1 workflow walkthroughs show the behaviour even if nobody named it — e.g. a participant pasting a screenshot rather than typing the claim, or scrolling back and forth between two windows during the think-aloud. | Report it as an **observed behaviour**, which the 4.0-mark criterion explicitly accepts alongside quotes ("direct user quotes, observed behaviors, or documented responses"). Then Step 3 says the surface was chosen to remove a step you watched them take. |
| **3 — designer-led** | Neither of the above. | Say so in one clause — *"no participant raised the split-screen workflow; this is a design decision, not a finding"* — and carry it on external evidence. **A stated designer-led decision costs nothing; an undeclared one presented as a finding costs the evidence mark.** |

**The three quotes to lean on regardless of tier**, because all three survive the pivot unchanged:

1. **Uncritical copying** — Block 3's killer question and the Block 5 completion (*"I can get an answer
   for ___, but I still can't ___ on my own"*), plus whatever broke during the 30-second
   explain-without-the-screen attempt. This is Step 1's spine and the pivot does not touch it.
2. **Pressure to answer / holding back in a group chat** — §6a's "what fraction of the questions you
   have do you actually post?" and "what gets DM'd instead of asked?". Grounds DG4 and the whisper
   layer (primitive 5), which the pivot *strengthens*: the private note is now a layer you can toggle
   off before you show anyone your marked-up slide.
3. **Wanting to stay in the material** — any Block 1 answer about pasting the slide, screenshotting it,
   or reading with the AI open beside it. This is the quote that promotes the report from tier 3 to
   tier 1, and it is the one to go looking for in the transcripts before writing Step 1.

**External warrants, for the Step 2/Step 3 paragraph** (`pivot-integrated-document.md` §C16, §C17):

- **Joshi & Vogel, CHI 2026** (arXiv 2509.09840): AI margin notes anchored inside the document, compared
  against detached side-panel chat. Participants **preferred the integrated margin notes over chat**;
  they **preferred selecting the text themselves** over AI-chosen selection; and **lower AI involvement
  produced stronger psychological ownership**. Those three findings map onto, respectively: the pivot
  itself, rule R1 (no pre-annotation), and DG1.
- **Fang et al. 2025** (arXiv 2510.15234): N = 46, two weeks, no-agent vs single-agent vs multi-agent
  in-situ exchanges while reading papers. Agent-mediated exchange **significantly improved critical
  thinking**; **multi-agent produced more active engagement and more comparing of perspectives**. This
  is the only citation anywhere that answers *"why two agents in a margin?"* — without it that question
  is unanswered in the report.
- **Houde et al., IUI '25** (arXiv 2501.17258): ship learner-operable participation controls or the
  agents will dominate; and their own §7.2.6 — *"its decision-making quality was poor. We resorted to
  using external decision logic"* — is external, peer-reviewed validation of ChatterED's rules-then-model
  orchestrator. One sentence, and it converts an implementation detail into a defended decision.
- **The novelty claim, retargeted** (§C0): every shipped system either keeps the conversation and
  inserts a citation pointer, or inserts the artefact and lets the conversation evaporate at *Accept*.
  **Nobody makes the anchored thread the object.** Stronger and more precise than "nobody puts two
  personas in one learner conversation".

**The limitation that must be stated, not hidden.** Joshi & Vogel found **no measurable effect on
reading comprehension at a 2 h delay**. A report claiming comprehension gains that a grader can check
loses marks. State it and answer it: ChatterED's outcome measure is not comprehension but **defended
explanation** — the ledger's `●`, which is unreachable without a Challenger probe. Naming a null result
in the nearest prior work and explaining why your construct differs is worth more than the sentence costs.

**Revised word budget** (`design-brief.md` §G2, adjusted for the pivot; references and appendices are
excluded from the 2,000):

| Step | Words | Note |
|---|---|---|
| Step 1 | 500 | Unchanged. Quotes are worth the space. |
| Step 2 | 550 | Learning goal, division of labour, why conversational, DG1/DG2/DG4, the ledger as a coverage map. |
| Step 3 | 400 | Of which **≤150 for the document-format argument**, stated as a decision with one reason (fidelity on slides) — the four-approach comparison is appendix material. |
| Step 4 | 450 | The anchored thread, compressed, with the annotations. |
| Limitations | 100 | The Joshi & Vogel null result + the untested idle definition. |

---

### F3. Follow-up script — 3 questions, async, for 1–2 participants

**Purpose.** To move the report from tier 3 to tier 1 or 2 (F2) with about five minutes of a
participant's time. Send as plain text in Telegram/WhatsApp. **Do not send anything that describes the
new design before Q1 and Q2** — describing it first turns the answers into agreement with you, which is
worth nothing.

**Preamble (send first, wait for a reply):**

> Hi — quick follow-up to the chat we had about [module] and AI, three questions, text answers are
> perfect, 5 minutes max. Same terms as before: no names in anything I write up, you can skip any
> question, and tell me if you'd rather not. Reply "ok" and I'll send them.

**Q1 — where the answer ends up** *(tests: does the split-screen workflow cost them anything?)*

> Think about the last time you asked an AI something about a lecture slide or a page of notes.
> Where did the answer end up — the chat window, your own notes, a screenshot, nowhere? And if you
> went back to that slide two weeks later, would you be able to find what it said?

**Q2 — who picks the passage** *(tests Joshi & Vogel's "participants preferred selecting the text
themselves"; ask it without naming the finding)*

> When you ask about a slide, what do you actually give it — the whole slide, a screenshot, or do you
> retype just the line you're stuck on? If you could drag a box around exactly the line you're stuck on
> instead of typing or pasting it, would you use that, or would it be more faff than it's worth?

**Q3 — margin notes vs chat** *(tests Joshi & Vogel's "integrated preferred over chat"; the forced
choice plus the objection is the part that is actually informative)*

> Two versions of the same tool. **(a)** The slide on the left, a chat on the right, like now.
> **(b)** No chat window at all — you drag a box round a line, write what you think it means right
> there in the page, and two AI study-mates argue with you in the margin next to it, and it's all still
> there next time you open the file.
> Which is closer to how you'd actually work the night before a tutorial — and what's the *first* thing
> that would annoy you about the one you didn't pick?

**How to use the answers.** Q1 and Q2 are Step 1 material (a user need and an observed workflow cost)
and can be quoted verbatim. Q3 is **Step 3 material, not Step 1** — it is a reaction to a described
design, not evidence of an unprompted need, and must be labelled as such in the report ("asked as a
design probe after the interviews"). The objection in Q3's second half is the strongest candidate for
the video's *one current limitation* (beat 16), because a limitation in your own participant's words is
where the ownership mark lives.

**If neither participant replies by Fri 19 Sep**, write the report at tier 3 and cite Joshi & Vogel for
the two claims Q2 and Q3 were going to test locally. Do not hold the report for the follow-up.



## G. Open questions for Lucas

Five, ordered by how much rides on the answer and by how soon it blocks the build.

---

**Q1. Do the three interview transcripts contain anything about the split-screen workflow itself —
and will you send the §F3 follow-up tonight?** *(Blocks the report, not the build. Answer by Tue 16.)*

Any quote or observed behaviour about copy-pasting between a PDF and a chat window, screenshotting a
slide, losing track of which answer went with which slide, or the answer ending up somewhere other than
the material. If yes, the pivot is user-grounded and becomes the strongest paragraph in Step 1
(§F2 tier 1). If no, it is a designer-led Step-3 decision and must be written as one. **Four marks turn
on this.** The §F3 script exists to convert tier 3 into tier 1 or 2 for five minutes of one
participant's time, and it needs ~48 h of slack to come back. *Recommendation: re-read the transcripts
for tier-2 behaviours before assuming tier 3, and send §F3 to two participants on Tue 16.*

---

**Q2. Does the whisper stay ephemeral?** *(Blocks migration 009 — decide before Day 1 ends.)*

`design-brief.md` §D5 clears whisper history at the end of a round on Dennis et al.'s *ephemerality*.
A document that saves state saves everything. The three options, and each is defensible:

| Option | Consequence |
|---|---|
| **(a) Private notes persist with the document** | Simplest schema, and the better interaction — a private margin you can re-open next week. DG4's grounding in ephemerality weakens and the report must say so. |
| **(b) Private notes are the one layer that is not persisted** | Keeps Dennis et al. intact and is a genuinely interesting sentence in the report ("the only thing this document forgets"). Costs a `visibility='private'` purge on close, and the learner will lose Ellie's counterexample. |
| **(c) Persist, with a visible "clear private notes on this page" control** | The compromise this spec currently assumes. Ephemerality becomes an affordance rather than a rule; the report says that plainly. |

*Recommendation: (c).* It is one button, it is honest in the report, and it does not throw away the
learner's own material. **Do not let this be decided by the schema.**

---

**Q3. What replaces "a round"?** *(Blocks the timer and the ledger gates — decide by Day 4.)*

A round is temporal; a document is spatial. Four rules hang off it: ≤2 silence fires per round, the S2
disagreement-quota window, the ledger's Theo gate, and whisper clearing (Q2). This spec assumes
**a round is a page** throughout (§B6, §B8, §B10). The alternative is *a round is an anchor*, which
makes the S2 quota nearly unreachable (five agent turns on one region is a long thread) and makes the
timer fire twice per region on a 24-page deck — i.e. 48 nudges. *Recommendation: confirm "a round is a
page", and say so in one line of the report; it is the kind of substitution a grader notices you made
deliberately.*

---

**Q4. Collapsed-by-default margin threads — is the §B4 reconciliation what you meant?**
*(Blocks nothing; changes one default.)*

Issue #23's direction says collapsed by default. `pivot-integrated-document.md` §B4(a) says the
opposite, on Koala's evidence: Houde et al.'s participants *predicted* threading would reduce
distraction and then found it "detracted from their ability to collaborate" (§7.2.3) — a margin of
numbered pins is the same mistake. §B4 of this spec splits the difference: **the active thread is always
fully open, every other thread collapses to a stub carrying the last speaker and a turn count, and no
exchange is ever reduced to a content-free pin.** Confirm, or tell me to collapse everything including
the active thread. *This is the one interaction decision in the spec that our own cited evidence
actively warns against, so it should be a decision rather than a default.*

---

**Q5. Does the annotated document need to leave ChatterED?** *(Costs a day if yes — decide by Day 5.)*

If a student must hand a marked-up PDF to a tutor, or open it in Preview or Zotero, that forces
`pdf-lib` write-back into PDF `/Annot` objects and a lossy export path — a `/Annot` carries
`/QuadPoints` geometry and cannot express a thread, an agent identity, a ledger state or a private
layer. If it only has to survive reopening in ChatterED and syncing through OneDrive, the SQLite source
of truth plus the `.chattered.json` sidecar (§A3) is enough and is a day cheaper. *Recommendation: no
for A1 — the sidecar ships, pdf-lib flattening stays the §E Day 5 stretch and the A2 item.*

---

### Appendix — what this specification does not settle

- **The new idle definition** (§B8) is an untested guess in exactly the way 45 s was. `interview-guide.md`
  §6b already collects a tolerance number for chatting; it has never been asked about *reading*.
- **Whether a margin thread reads as a conversation to a first-time user at all**, or as a pile of
  comments. This needs no build to test — a printed slide with sticky notes answers it in ten minutes,
  and it is the single cheapest de-risking act available before Sunday's recording.
- **Anchor durability across a real semester**, where a lecturer re-uploads slides with a page inserted
  at the front. §A5 is a policy; it has not been measured.

