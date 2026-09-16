/**
 * **What comes back from the model, turned into something the panel cannot be broken by.**
 *
 * `docs/research/learning-objectives.md` §3 asks the ingest for 6–20 objectives, at most three
 * levels deep, each with at least one ref unless it is a prerequisite the deck assumes, and a
 * `requires` graph that is acyclic. A JSON schema can ask for all of that and enforce almost
 * none of it: `minItems` is honoured, "acyclic" is not expressible, and the local CLI path is a
 * prompt with a schema pasted into it rather than the structured-output API, so even the
 * expressible half is advisory there.
 *
 * So this file is the enforcement, and it is **pure** — a function from what the model said to
 * what is stored, with no database, no clock and no model call in it, which is what makes the
 * cycle case and the depth case testable at all.
 *
 * **It repairs rather than rejects.** A tree with one cycle in it is a tree with nineteen good
 * nodes; throwing it away would cost the learner the panel and would cost another minute of
 * Sonnet to find out whether the second attempt was any better. Every repair is counted and
 * returned in `notes`, which is what goes in the log line beside the ingest's duration.
 */
import { createHash } from 'node:crypto';
import {
  MAX_CRITERIA,
  MAX_OBJECTIVES,
  MAX_QUIZ_SEEDS,
  MAX_TITLE_WORDS,
  MAX_TREE_DEPTH,
  type LearningObjective,
  type ObjectiveRef,
} from '../../shared/objectives.js';

/**
 * What the model is asked for, one node at a time.
 *
 * The edges are **keys, not ids**: an id is `sha1(content_sha + normalised title)` and a model
 * asked to compute one would either get it wrong or, worse, get it plausibly wrong. It names its
 * nodes with slugs it chooses, the slugs are resolved here, and anything that does not resolve
 * is dropped rather than left dangling.
 */
export interface RawObjective {
  key?: unknown;
  title?: unknown;
  kind?: unknown;
  statement?: unknown;
  criteria?: unknown;
  quiz_seeds?: unknown;
  refs?: unknown;
  parent_key?: unknown;
  requires_keys?: unknown;
}

export interface RepairNotes {
  /** Nodes the model returned, before anything was dropped. */
  received: number;
  kept: number;
  prerequisites: number;
  assumed: number;
  droppedUntitled: number;
  droppedDuplicate: number;
  droppedOverCap: number;
  danglingParents: number;
  danglingRequires: number;
  cyclesCut: number;
  depthClamped: number;
  seededQuiz: number;
}

export interface RepairResult {
  objectives: LearningObjective[];
  notes: RepairNotes;
}

/** `sha1(content_sha + normalised title)` — §2's id, stable for as long as both are. */
export function objectiveIdFor(contentSha: string, title: string): string {
  return createHash('sha1').update(`${contentSha}\u0000${normaliseTitle(title)}`).digest('hex').slice(0, 16);
}

/** Lower-cased, punctuation-trimmed, whitespace-collapsed: the id must survive a re-read. */
export function normaliseTitle(title: string): string {
  return title.toLowerCase().replace(/[\s\u00a0]+/g, ' ').trim().replace(/[.,;:!?]+$/, '').trim();
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[\s\u00a0]+/g, ' ').trim() : '';
}

/** §2: "≤ 12 words". Cut on a word boundary — a title is a handle, not a sentence. */
function capTitle(title: string): string {
  const words = title.split(' ');
  return words.length <= MAX_TITLE_WORDS ? title : words.slice(0, MAX_TITLE_WORDS).join(' ');
}

function strings(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const s = text(item);
    if (s.length > 0 && !out.includes(s)) out.push(s);
    if (out.length === cap) break;
  }
  return out;
}

function refs(value: unknown): ObjectiveRef[] {
  if (!Array.isArray(value)) return [];
  const out: ObjectiveRef[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const page = Number(row.page);
    if (!Number.isFinite(page) || page < 1) continue;
    const ref: ObjectiveRef = { page: Math.round(page) };
    const quote = text(row.quote);
    if (quote.length > 0) ref.quote = quote.slice(0, 240);
    if (!out.some((r) => r.page === ref.page)) out.push(ref);
  }
  return out.sort((a, b) => a.page - b.page);
}

/**
 * **A Tester with nothing to ask is a Tester that invents a question.** §4 has it quizzing from
 * `quizSeeds`, so a node that came back without one is given a stem built from its own title
 * rather than left for the model to improvise around.
 */
function seedFor(title: string): string {
  const stem = title.replace(/^(state|name|explain|describe|identify|define)\s+/i, '').trim();
  return `In your own words: ${stem || title.toLowerCase()}.`;
}

export function repairTree(input: {
  fileId: string;
  contentSha: string;
  raw: readonly RawObjective[];
}): RepairResult {
  const notes: RepairNotes = {
    received: input.raw.length,
    kept: 0,
    prerequisites: 0,
    assumed: 0,
    droppedUntitled: 0,
    droppedDuplicate: 0,
    droppedOverCap: 0,
    danglingParents: 0,
    danglingRequires: 0,
    cyclesCut: 0,
    depthClamped: 0,
    seededQuiz: 0,
  };

  // ── pass 1: the nodes themselves, and the key → id map the edges are resolved through ──
  interface Draft extends LearningObjective {
    key: string;
    parentKey: string | null;
    requiresKeys: string[];
  }
  const drafts: Draft[] = [];
  const idByKey = new Map<string, string>();
  const seenIds = new Set<string>();

  for (const raw of input.raw) {
    const title = capTitle(text(raw.title));
    if (title.length === 0) {
      notes.droppedUntitled += 1;
      continue;
    }
    const id = objectiveIdFor(input.contentSha, title);
    if (seenIds.has(id)) {
      // Two nodes with the same normalised title are one node: they would collide on the id
      // anyway, and the second would silently overwrite the first's state.
      notes.droppedDuplicate += 1;
      continue;
    }
    seenIds.add(id);
    const key = text(raw.key) || title.toLowerCase();
    const nodeRefs = refs(raw.refs);
    const kind = text(raw.kind) === 'prerequisite' ? 'prerequisite' : 'objective';
    const quizSeeds = strings(raw.quiz_seeds, MAX_QUIZ_SEEDS);
    if (quizSeeds.length === 0) {
      quizSeeds.push(seedFor(title));
      notes.seededQuiz += 1;
    }
    idByKey.set(key, id);
    drafts.push({
      id,
      fileId: input.fileId,
      title,
      kind,
      statement: text(raw.statement) || title,
      criteria: strings(raw.criteria, MAX_CRITERIA),
      quizSeeds,
      refs: nodeRefs,
      parentId: null,
      requires: [],
      // §2's rule, applied here rather than trusted: a prerequisite the deck never points at is
      // one the deck assumes, and that is the whole of what the "assumed by the deck" tag means.
      assumedByDeck: kind === 'prerequisite' && nodeRefs.length === 0,
      order: 0,
      key,
      parentKey: text(raw.parent_key) || null,
      requiresKeys: strings(raw.requires_keys, 8),
    });
  }

  // ── pass 2: the cap. Objectives with the earliest refs survive; §3's 20 is a hard ceiling. ──
  if (drafts.length > MAX_OBJECTIVES) {
    const ranked = [...drafts].sort((a, b) => firstPage(a) - firstPage(b));
    const keep = new Set(ranked.slice(0, MAX_OBJECTIVES).map((d) => d.id));
    for (let i = drafts.length - 1; i >= 0; i -= 1) {
      if (keep.has(drafts[i]!.id)) continue;
      idByKey.delete(drafts[i]!.key);
      drafts.splice(i, 1);
      notes.droppedOverCap += 1;
    }
  }

  const byId = new Map(drafts.map((d) => [d.id, d]));

  // ── pass 3: the edges, resolved; anything dangling is dropped, not left pointing nowhere ──
  for (const draft of drafts) {
    if (draft.parentKey !== null) {
      const parentId = idByKey.get(draft.parentKey) ?? null;
      if (parentId === null || parentId === draft.id) notes.danglingParents += 1;
      else draft.parentId = parentId;
    }
    for (const key of draft.requiresKeys) {
      const id = idByKey.get(key);
      if (id === undefined || id === draft.id) {
        notes.danglingRequires += 1;
        continue;
      }
      if (!draft.requires.includes(id)) draft.requires.push(id);
    }
  }

  // ── pass 4: cycles. Both graphs, because either can come back with one. ──
  notes.cyclesCut += cutParentCycles(drafts, byId);
  notes.cyclesCut += cutRequiresCycles(drafts, byId);

  // ── pass 5: depth. §3's "≤ 3 levels deep", re-parented rather than dropped. ──
  for (const draft of drafts) {
    const chain = ancestors(draft, byId);
    if (chain.length + 1 <= MAX_TREE_DEPTH) continue;
    // Re-attach to the ancestor that leaves it at exactly the maximum depth. Promoting to the
    // root instead would lose the one thing the edge was carrying — what it is a part of.
    draft.parentId = chain[chain.length - MAX_TREE_DEPTH + 1]?.id ?? null;
    notes.depthClamped += 1;
  }

  // ── pass 6: order. Deck order of the first ref, prerequisites before their dependants. ──
  const sortKey = new Map<string, number>();
  for (const draft of drafts) sortKey.set(draft.id, firstPage(draft));
  for (const draft of drafts) {
    if (draft.refs.length > 0) continue;
    // An assumed prerequisite has no ref to take an order from, so it takes its earliest
    // dependant's and sits just in front of it: you meet the assumption where it first bites.
    const requirers = drafts.filter((d) => d.requires.includes(draft.id));
    if (requirers.length === 0) continue;
    sortKey.set(draft.id, Math.min(...requirers.map((r) => firstPage(r))) - 0.5);
  }
  const ordered = [...drafts].sort((a, b) => {
    const ka = sortKey.get(a.id)!;
    const kb = sortKey.get(b.id)!;
    if (ka !== kb) return ka - kb;
    return drafts.indexOf(a) - drafts.indexOf(b);
  });
  ordered.forEach((draft, i) => {
    draft.order = i + 1;
  });

  const objectives: LearningObjective[] = ordered.map(({ key: _k, parentKey: _p, requiresKeys: _r, ...rest }) => rest);
  notes.kept = objectives.length;
  notes.prerequisites = objectives.filter((o) => o.kind === 'prerequisite').length;
  notes.assumed = objectives.filter((o) => o.assumedByDeck).length;
  return { objectives, notes };
}

/** A node with no ref sorts to the end of the deck unless a dependant pulls it forward. */
function firstPage(draft: { refs: ObjectiveRef[] }): number {
  return draft.refs[0]?.page ?? Number.MAX_SAFE_INTEGER;
}

function ancestors<T extends { id: string; parentId: string | null }>(node: T, byId: Map<string, T>): T[] {
  const chain: T[] = [];
  const seen = new Set<string>([node.id]);
  let at = node.parentId;
  while (at !== null && !seen.has(at)) {
    const parent = byId.get(at);
    if (!parent) break;
    chain.unshift(parent);
    seen.add(at);
    at = parent.parentId;
  }
  return chain;
}

function cutParentCycles<T extends { id: string; parentId: string | null }>(
  nodes: readonly T[],
  byId: Map<string, T>,
): number {
  let cut = 0;
  for (const node of nodes) {
    const seen = new Set<string>([node.id]);
    let at = node.parentId;
    while (at !== null) {
      if (seen.has(at)) {
        // The edge out of *this* node is the one cut, so the rest of the chain survives.
        node.parentId = null;
        cut += 1;
        break;
      }
      seen.add(at);
      at = byId.get(at)?.parentId ?? null;
    }
  }
  return cut;
}

/**
 * `requires` is a DAG or it is nothing: the panel draws a prerequisite under the objective that
 * needs it, and a cycle there is two nodes each drawn inside the other. Depth-first, and a
 * back-edge is removed rather than the node.
 */
function cutRequiresCycles<T extends { id: string; requires: string[] }>(
  nodes: readonly T[],
  byId: Map<string, T>,
): number {
  let cut = 0;
  const state = new Map<string, 'open' | 'done'>();
  const visit = (node: T): void => {
    state.set(node.id, 'open');
    for (let i = node.requires.length - 1; i >= 0; i -= 1) {
      const next = byId.get(node.requires[i]!);
      if (!next) continue;
      const seen = state.get(next.id);
      if (seen === 'open') {
        node.requires.splice(i, 1);
        cut += 1;
        continue;
      }
      if (seen === undefined) visit(next);
    }
    state.set(node.id, 'done');
  };
  for (const node of nodes) if (!state.has(node.id)) visit(node);
  return cut;
}
