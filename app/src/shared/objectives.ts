/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THE LEARNING-OBJECTIVE CONTRACT (issue #38; `docs/research/learning-objectives.md` §2 and §6)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * **This file lands before the main-process half that fills it, on purpose** — the same order
 * `shared/scope.ts` shipped in for issue #35. The panel is being built in parallel against
 * §2's shapes, declared locally in `renderer/lib/objectives.ts` with a note saying they are
 * deleted the day this module exists. So the field spellings below are **§2's, verbatim**, and
 * the swap on that side is one `import` line, not a rewrite.
 *
 * ## What the renderer can rely on
 *
 *  - The five shapes: `ObjectiveRef`, `LearningObjective`, `LearningObjectiveState`,
 *    `LearningTree`, `ObjectiveLevel`. Identical to §2 field for field.
 *  - The five channels on `IPC` (`shared/ipc.ts`): `objectives:tree`, `objectives:states`,
 *    `objectives:regenerate`, `objectives:reset`, `objectives:teach`, with the typed methods on
 *    `ChatterEdApi` beside them and the preload allowlist already carrying them.
 *  - Two events on `RoomEvent` (`shared/types.ts`): `objectives.tree` on every **status** change
 *    (`pending` → `ready` / `failed`, and a Regenerate going back to `pending`), and
 *    `objectives.state` once per node that moved, carrying the learner message ids that moved it.
 *  - `flow:askHere` takes an optional `objectiveId`, so a thread opened from a node is tagged
 *    with the node (§5's click path). The main process writes it on the messages of that thread.
 *
 * ## Deviations from the spec, stated where the spec can see them
 *
 *  1. **`objectives:tree` may return `null`.** §6 writes it as `→ LearningTree`, but a file the
 *     flow has never opened has no row at all, and inventing an empty `pending` tree for one
 *     would make "Ellie is reading the deck…" appear for a deck nobody is reading. `null` means
 *     *no ingest has ever been asked for this file*; every other state is a real tree with a
 *     `status`.
 *  2. **`objectives:reset` returns the reset states** rather than nothing, so the panel redraws
 *     from the answer instead of racing the per-node events it would otherwise have to wait for.
 *  3. **The `RoomEvent` union is the carrier.** §6 does not say which stream the two events ride
 *     on, and there is exactly one push channel to the renderer (`IPC.event`). `roomId` is
 *     `null` when the file has no room yet — the ingest starts on first open, which is before
 *     the first question, which is what creates the room.
 *
 * Portable and dependency-free, like `shared/scope.ts` and for the same reason: the main process
 * mints and validates trees, the renderer draws them, and neither may hold a second copy of what
 * a level means.
 */

/** 0 untouched · 1 stated · 2 justified (**online**) · 3 defended — §2, and the ledger's rules. */
export type ObjectiveLevel = 0 | 1 | 2 | 3;

export interface ObjectiveRef {
  page: number;
  segmentId?: string;
  quote?: string;
}

export interface LearningObjective {
  /** Stable per file: `sha1(content_sha + normalised title)` (§2), minted in the main process. */
  id: string;
  fileId: string;
  /** ≤ 12 words, a claim or a skill: "State the Bellman optimality equation". */
  title: string;
  kind: 'objective' | 'prerequisite';
  /** One or two sentences: what the learner must be able to do or say. */
  statement: string;
  /** 2–4 checkable criteria — what a correct demonstration contains. */
  criteria: string[];
  /** 1–3 question stems the Tester may use, one per criterion at most. */
  quizSeeds: string[];
  /** Where the deck teaches it. Empty for a prerequisite the deck only assumes. */
  refs: ObjectiveRef[];
  /** Tree edge: this objective is a sub-objective of `parentId`. */
  parentId: string | null;
  /** Prerequisite edges (ids), acyclic. */
  requires: string[];
  /** `kind = 'prerequisite'` and `refs = []` → true. */
  assumedByDeck: boolean;
  /** Deck order of the first ref; prerequisites before their dependants. */
  order: number;
}

export interface LearningObjectiveState {
  objectiveId: string;
  fileId: string;
  level: ObjectiveLevel;
  /** The learner's **own** messages (the ledger's verbatim-evidence rule, R1). */
  evidenceMessageIds: string[];
  lastMovedAt: string | null;
  /** When the Teacher last taught it. Feeds `flow.ts`'s taught set. */
  taughtAt: string | null;
}

export type LearningTreeStatus = 'pending' | 'ready' | 'failed';

export interface LearningTree {
  fileId: string;
  contentSha: string;
  generatedAt: string;
  model: string;
  /** The prompt version the tree was generated under — half of the cache key (§3). */
  version: number;
  objectives: LearningObjective[];
  status: LearningTreeStatus;
  error?: string;
}

// ── the shape the ingest must produce ───────────────────────────────────────

/**
 * §3's bounds, here rather than only in the prompt, because a schema is a request and these are
 * enforced: `repairTree()` clamps to them before anything is stored.
 */
export const MIN_OBJECTIVES = 6;
export const MAX_OBJECTIVES = 20;
/** "≤ 3 levels deep" (§3). Depth 1 is a root objective. */
export const MAX_TREE_DEPTH = 3;
export const MIN_CRITERIA = 2;
export const MAX_CRITERIA = 4;
export const MAX_QUIZ_SEEDS = 3;
/** §2: "≤ 12 words". */
export const MAX_TITLE_WORDS = 12;

// ── the two levels that matter ──────────────────────────────────────────────

/**
 * **Online is level 2** — Lucas's decision of 2026-09-16: an objective is online once the
 * learner has explained it *in their own words*, which is the ledger's `justified`. Level 3
 * (`defended`, survived a Tester question) is a fuller state on top, not a different meaning.
 */
export const ONLINE_LEVEL = 2;

export function isOnline(level: ObjectiveLevel): boolean {
  return level >= ONLINE_LEVEL;
}

/**
 * The ledger's 0–4 scale, as an objective level.
 *
 * The ledger scores five rungs (0 not yet, 1 stated, 2 explained, 3 applied, 4 examined) and the
 * panel shows four. They agree exactly where it matters — `levelToState()` in `room/ledger.ts`
 * already calls anything ≥ 3 `defended` — so this is a clamp and not a re-scaling, and there is
 * only ever one number behind both surfaces.
 */
export function objectiveLevelFromLedger(level: number): ObjectiveLevel {
  const n = Math.max(0, Math.min(3, Math.round(level)));
  return n as ObjectiveLevel;
}

/** How many of a file's objectives are online, for §5's "n of m online" header. */
export function onlineCount(states: readonly LearningObjectiveState[]): number {
  return states.filter((s) => isOnline(s.level)).length;
}
