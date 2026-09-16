/**
 * The learning-objective tree, as the panel needs it
 * (`docs/research/learning-objectives.md` — §2 the object, §5 the panel).
 *
 * Every number and every ordering decision the panel makes is here, and only here, because the
 * panel is a tree of buttons and a tree of buttons is exactly the kind of component that grows
 * an untested `sort()` in a `{#each}`.
 *
 * ## Why the shapes are declared here and not imported
 *
 * §2's object is the main process's to own: when `src/shared/objectives.ts` lands (the schema,
 * the ingest, the IPC of §6) these interfaces are deleted and the import moves one directory up.
 * Until then the renderer builds against the **spec's** shapes rather than against nothing, and
 * `store.objectivesLive` decides whether the tree on screen came from `objectives:tree` or from
 * the committed fixture. The names and the field spellings here are §2's, verbatim, so that
 * swap is an import change and not a rewrite.
 */

/** 0 untouched · 1 stated · 2 justified (**online**) · 3 defended — §2, and the ledger's rules. */
export type ObjectiveLevel = 0 | 1 | 2 | 3;

export interface ObjectiveRef {
  page: number;
  segmentId?: string;
  quote?: string;
}

export interface LearningObjective {
  id: string;
  fileId: string;
  title: string;
  kind: 'objective' | 'prerequisite';
  statement: string;
  criteria: string[];
  quizSeeds: string[];
  /** Where the deck teaches it. Empty for a prerequisite the deck only assumes. */
  refs: ObjectiveRef[];
  parentId: string | null;
  /** Prerequisite edges (ids), acyclic. */
  requires: string[];
  assumedByDeck: boolean;
  /** Deck order of the first ref; prerequisites before their dependants. */
  order: number;
}

export interface LearningObjectiveState {
  objectiveId: string;
  fileId: string;
  level: ObjectiveLevel;
  evidenceMessageIds: string[];
  lastMovedAt: string | null;
  taughtAt: string | null;
}

export interface LearningTree {
  fileId: string;
  contentSha: string;
  generatedAt: string;
  model: string;
  version: number;
  objectives: LearningObjective[];
  status: 'pending' | 'ready' | 'failed';
  error?: string;
}

/**
 * `LedgerRow`'s vocabulary, extended down by one (§5: "dim / outline / half / full, reusing
 * `LedgerRow`'s ○◐● vocabulary plus a dim state"). The same four marks the rail has used since
 * the room shipped, so a learner who has read the rail already knows what a half-filled node
 * means — and monochrome, because a progression is not a traffic light.
 */
export const OBJECTIVE_GLYPH: readonly string[] = ['·', '○', '◐', '●'];

/**
 * The word beside the glyph. Level 2 is `justified` in the ledger and **online** in the panel:
 * Lucas's word, the one the header counts ("n of m online"), and the one decision of
 * 2026-09-16 that says what lighting a node means — the learner has explained it in their own
 * words. One object, two surfaces, so the panel says the panel's word and nothing renames the
 * ledger's column.
 */
export const OBJECTIVE_WORD: readonly string[] = ['not yet', 'stated', 'online', 'defended'];

export function glyphFor(level: ObjectiveLevel): string {
  return OBJECTIVE_GLYPH[level] ?? OBJECTIVE_GLYPH[0]!;
}

export function wordFor(level: ObjectiveLevel): string {
  return OBJECTIVE_WORD[level] ?? OBJECTIVE_WORD[0]!;
}

/** Online is level 2 — explained in the learner's own words. Level 3 is a fuller state on top. */
export function isOnline(level: ObjectiveLevel): boolean {
  return level >= 2;
}

// ── The tree ────────────────────────────────────────────────────────────────

export interface ObjectiveNode {
  objective: LearningObjective;
  level: ObjectiveLevel;
  state: LearningObjectiveState | null;
  /** 1-based, and what `aria-level` is set from. */
  depth: number;
  /** The node it hangs off in *this* tree — `parentId`, or the requirer of a prerequisite. */
  parentId: string | null;
  children: ObjectiveNode[];
}

export function stateMap(states: readonly LearningObjectiveState[]): Record<string, LearningObjectiveState> {
  const out: Record<string, LearningObjectiveState> = {};
  for (const s of states) out[s.objectiveId] = s;
  return out;
}

/**
 * Deck order among siblings, with two tie-breaks that matter on screen.
 *
 * `order` is "deck order of first ref, prerequisites before their dependants" (§2), so it is
 * normally decisive. When two nodes share it — an assumed prerequisite has no ref to take an
 * order from, so a tree may hand several of them the same number — the prerequisite goes first
 * (you cannot demonstrate the objective without it) and then the title, so the panel is stable
 * across re-fetches rather than reordering itself under the learner's cursor.
 */
function compareSiblings(a: ObjectiveNode, b: ObjectiveNode): number {
  if (a.objective.order !== b.objective.order) return a.objective.order - b.objective.order;
  const pa = a.objective.kind === 'prerequisite' ? 0 : 1;
  const pb = b.objective.kind === 'prerequisite' ? 0 : 1;
  if (pa !== pb) return pa - pb;
  return a.objective.title.localeCompare(b.objective.title);
}

/**
 * Who a node hangs off.
 *
 * `parentId` wins when it names a real objective — that is the tree edge §2 defines. A
 * prerequisite with no parent hangs off **the objective that requires it** (§5: "prerequisites
 * shown under the objective that requires them"), and when more than one objective requires it
 * the earliest in the deck gets it, so the learner meets the assumption where it first bites.
 */
function effectiveParent(o: LearningObjective, byId: Map<string, LearningObjective>, all: readonly LearningObjective[]): string | null {
  if (o.parentId !== null && o.parentId !== o.id && byId.has(o.parentId)) return o.parentId;
  const requirers = all.filter((r) => r.id !== o.id && r.requires.includes(o.id));
  if (requirers.length === 0) return null;
  let best = requirers[0]!;
  for (const r of requirers.slice(1)) {
    if (r.order < best.order || (r.order === best.order && r.id < best.id)) best = r;
  }
  return best.id;
}

/**
 * Build the panel's tree from the flat list §2 defines.
 *
 * Ingest is a model call with a forced schema, which is to say it is a place where a cycle or a
 * dangling `parentId` will eventually arrive. Neither may cost the learner the panel: a node
 * whose parent chain comes back to itself, or names something that is not in the list, is
 * promoted to the root rather than dropped, so **every objective is always reachable on screen**.
 */
export function buildTree(
  objectives: readonly LearningObjective[],
  states: readonly LearningObjectiveState[] = [],
): ObjectiveNode[] {
  const byId = new Map(objectives.map((o) => [o.id, o]));
  const levels = stateMap(states);

  const parents = new Map<string, string | null>();
  for (const o of objectives) parents.set(o.id, effectiveParent(o, byId, objectives));

  // Cycle guard: walk up from each node, and cut any edge that leads back to where it started.
  for (const o of objectives) {
    const seen = new Set<string>([o.id]);
    let at = parents.get(o.id) ?? null;
    while (at !== null) {
      if (seen.has(at)) {
        parents.set(o.id, null);
        break;
      }
      seen.add(at);
      at = parents.get(at) ?? null;
    }
  }

  const nodes = new Map<string, ObjectiveNode>();
  for (const o of objectives) {
    const state = levels[o.id] ?? null;
    nodes.set(o.id, {
      objective: o,
      level: state?.level ?? 0,
      state,
      depth: 1,
      parentId: parents.get(o.id) ?? null,
      children: [],
    });
  }

  const roots: ObjectiveNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId === null ? null : (nodes.get(node.parentId) ?? null);
    if (parent) parent.children.push(node);
    else {
      node.parentId = null;
      roots.push(node);
    }
  }

  const sortDeep = (list: ObjectiveNode[], depth: number): void => {
    list.sort(compareSiblings);
    for (const n of list) {
      n.depth = depth;
      sortDeep(n.children, depth + 1);
    }
  };
  sortDeep(roots, 1);
  return roots;
}

/** Every node in the tree, in the order the panel prints them. */
export function walk(nodes: readonly ObjectiveNode[]): ObjectiveNode[] {
  const out: ObjectiveNode[] = [];
  const visit = (list: readonly ObjectiveNode[]): void => {
    for (const n of list) {
      out.push(n);
      visit(n.children);
    }
  };
  visit(nodes);
  return out;
}

// ── The header's count ──────────────────────────────────────────────────────

export interface OnlineCount {
  online: number;
  total: number;
}

/**
 * "n of m online" (§5).
 *
 * Every node counts, prerequisites included: an assumed prerequisite is a thing the learner has
 * to be able to say, and a count that quietly excluded the hard ones would be the flattering
 * kind of progress bar this app does not want.
 */
export function onlineCount(
  objectives: readonly LearningObjective[],
  states: readonly LearningObjectiveState[],
): OnlineCount {
  const levels = stateMap(states);
  let online = 0;
  for (const o of objectives) if (isOnline(levels[o.id]?.level ?? 0)) online += 1;
  return { online, total: objectives.length };
}

export function onlineLabel(count: OnlineCount): string {
  return `${count.online} of ${count.total} online`;
}

/**
 * The ids that have just crossed into `online` — what animates once, and what the panel's live
 * region announces. A level that moves 2 → 3 is not "just lit": it was already lit.
 */
export function newlyOnline(
  before: Record<string, ObjectiveLevel>,
  after: Record<string, ObjectiveLevel>,
): string[] {
  const out: string[] = [];
  for (const [id, level] of Object.entries(after)) {
    if (isOnline(level) && !isOnline(before[id] ?? 0)) out.push(id);
  }
  return out;
}

export function levelsById(states: readonly LearningObjectiveState[]): Record<string, ObjectiveLevel> {
  const out: Record<string, ObjectiveLevel> = {};
  for (const s of states) out[s.objectiveId] = s.level;
  return out;
}

// ── Refs, and where a click goes ────────────────────────────────────────────

/**
 * "p. 12, p. 14" (§5's own example). Pages, de-duplicated and in order, because two refs to the
 * same page is a detail of how the tree was built and not something the learner needs told.
 */
export function refLabel(refs: readonly ObjectiveRef[], max = 4): string {
  const pages = [...new Set(refs.map((r) => r.page))].sort((a, b) => a - b);
  if (pages.length === 0) return '';
  const shown = pages.slice(0, max).map((p) => `p. ${p}`);
  return pages.length > max ? `${shown.join(', ')} +${pages.length - max}` : shown.join(', ');
}

/** The ref a click scrolls to: the earliest page, and within it the first one listed. */
export function firstRef(objective: LearningObjective): ObjectiveRef | null {
  if (objective.refs.length === 0) return null;
  return [...objective.refs].sort((a, b) => a.page - b.page)[0] ?? null;
}

/**
 * The card a ref means.
 *
 * `segmentId` is authoritative when the tree has one and the flow still has that segment — but
 * a segment id is only stable until the learner splits or merges the card it names, and the
 * tree is cached by `content_sha` for the life of the file. So the page is the fallback, and it
 * is the one the fixture uses: the first card on that page, in flow order, always exists.
 */
export function resolveRefSegment(
  ref: ObjectiveRef | null,
  cards: readonly { segmentId: string; page: number }[],
): string | null {
  if (!ref) return null;
  if (ref.segmentId && cards.some((c) => c.segmentId === ref.segmentId)) return ref.segmentId;
  return cards.find((c) => c.page === ref.page)?.segmentId ?? null;
}

/**
 * The objectives a card teaches, for the glyph strip on the card itself (§5: "Cards keep their
 * glyphs; the glyph now means the objectives the card's segment teaches").
 */
export interface SegmentObjective {
  id: string;
  title: string;
  level: ObjectiveLevel;
}

export function objectivesForSegment(
  objectives: readonly LearningObjective[],
  states: readonly LearningObjectiveState[],
  card: { segmentId: string; page: number },
): SegmentObjective[] {
  const levels = stateMap(states);
  return objectives
    .filter((o) =>
      o.refs.some((r) => (r.segmentId ? r.segmentId === card.segmentId : r.page === card.page)),
    )
    .sort((a, b) => a.order - b.order)
    .map((o) => ({ id: o.id, title: o.title, level: levels[o.id]?.level ?? 0 }));
}

/**
 * Where **Teach me this** lands while `objectives:teach` does not exist yet.
 *
 * §5 anchors the Teacher's turn to "the requiring objective's segment", and a prerequisite that
 * offers the button has no ref of its own by definition — so the anchor is its parent's first
 * ref, walking up until something has one. Null when nothing in the chain is in the deck, which
 * is the case where the button has nowhere to go and is not offered.
 */
export function teachAnchorRef(
  node: ObjectiveNode,
  byId: Map<string, ObjectiveNode>,
): ObjectiveRef | null {
  const seen = new Set<string>();
  let at: ObjectiveNode | null = node;
  while (at && !seen.has(at.objective.id)) {
    seen.add(at.objective.id);
    const ref = firstRef(at.objective);
    if (ref) return ref;
    at = at.parentId ? (byId.get(at.parentId) ?? null) : null;
  }
  return null;
}

export function nodeIndex(nodes: readonly ObjectiveNode[]): Map<string, ObjectiveNode> {
  return new Map(walk(nodes).map((n) => [n.objective.id, n]));
}

/** The pre-filled question the fallback opens the Ask composer with. */
export function teachPrefill(title: string): string {
  return `Explain ${title} to me`;
}

// ── Keyboard: the rows, and where a key goes ───────────────────────────────

export interface ObjectiveRow {
  id: string;
  node: ObjectiveNode;
  depth: number;
  parentId: string | null;
  hasChildren: boolean;
  expanded: boolean;
}

/** The rows actually on screen, which is what an arrow key moves between. */
export function visibleRows(
  nodes: readonly ObjectiveNode[],
  collapsed: ReadonlySet<string> = new Set(),
): ObjectiveRow[] {
  const out: ObjectiveRow[] = [];
  const visit = (list: readonly ObjectiveNode[]): void => {
    for (const n of list) {
      const hasChildren = n.children.length > 0;
      const expanded = hasChildren && !collapsed.has(n.objective.id);
      out.push({ id: n.objective.id, node: n, depth: n.depth, parentId: n.parentId, hasChildren, expanded });
      if (expanded) visit(n.children);
    }
  };
  visit(nodes);
  return out;
}

export type TreeKey = 'ArrowDown' | 'ArrowUp' | 'ArrowRight' | 'ArrowLeft' | 'Home' | 'End';

export interface TreeMove {
  /** The row that should hold focus after the key. */
  focusId: string | null;
  /** Set when the key's job was to open or close a node rather than to move. */
  expand?: string;
  collapse?: string;
}

/**
 * The `tree` role's keyboard model (WAI-ARIA APG), narrowed to the six keys this panel has.
 *
 * ← is the one worth stating: on an open node it closes it, and on a closed or childless one it
 * goes to the parent — which is how a learner backs out of a prerequisite without hunting for
 * the row it hangs off.
 */
export function moveFocus(rows: readonly ObjectiveRow[], currentId: string | null, key: TreeKey): TreeMove {
  if (rows.length === 0) return { focusId: null };
  const at = rows.findIndex((r) => r.id === currentId);
  const first = rows[0]!.id;
  const last = rows[rows.length - 1]!.id;
  switch (key) {
    case 'Home':
      return { focusId: first };
    case 'End':
      return { focusId: last };
    case 'ArrowDown':
      if (at < 0) return { focusId: first };
      return { focusId: rows[Math.min(at + 1, rows.length - 1)]!.id };
    case 'ArrowUp':
      if (at < 0) return { focusId: first };
      return { focusId: rows[Math.max(at - 1, 0)]!.id };
    case 'ArrowRight': {
      if (at < 0) return { focusId: first };
      const row = rows[at]!;
      if (!row.hasChildren) return { focusId: row.id };
      if (!row.expanded) return { focusId: row.id, expand: row.id };
      return { focusId: rows[at + 1]?.id ?? row.id };
    }
    case 'ArrowLeft': {
      if (at < 0) return { focusId: first };
      const row = rows[at]!;
      if (row.hasChildren && row.expanded) return { focusId: row.id, collapse: row.id };
      return { focusId: row.parentId ?? row.id };
    }
  }
}

// ── The header's status line (§5) ──────────────────────────────────────────

export interface PanelStatus {
  /** The sentence under the header, or null when there is nothing to say. */
  text: string | null;
  /** True while the tree is being ingested — the header shows a spinner, not a retry. */
  pending: boolean;
  /** True when the tree failed and **Try again** should be offered. */
  retry: boolean;
}

/**
 * What the header says, and it is the Teacher's name that says it: "Ellie is reading the deck…"
 * is §5's own copy, and the point of it is that an empty panel on a freshly opened deck is
 * something *happening*, not something broken.
 */
export function panelStatus(tree: LearningTree | null, teacherName = 'Ellie'): PanelStatus {
  if (!tree) return { text: null, pending: false, retry: false };
  if (tree.status === 'pending') {
    return { text: `${teacherName} is reading the deck…`, pending: true, retry: false };
  }
  if (tree.status === 'failed') {
    return {
      text: tree.error ?? `${teacherName} could not read this deck.`,
      pending: false,
      retry: true,
    };
  }
  return { text: null, pending: false, retry: false };
}

/**
 * The scripted backend's honest sentence (§3: "the fixture deck gets a committed fixture tree;
 * other decks get `pending` with a 'needs a live backend' note").
 *
 * A pending spinner that will never resolve is the worst of both: it says work is happening when
 * none is. So on a scripted backend, a deck with no fixture says so in one line instead.
 */
export function backendNote(input: { backend: string | null; hasFixture: boolean; live: boolean }): string | null {
  if (input.live) return null;
  if (input.backend !== 'scripted') return null;
  if (input.hasFixture) return null;
  return 'Objectives for this deck need a live backend — the scripted demo ships one worked example.';
}
