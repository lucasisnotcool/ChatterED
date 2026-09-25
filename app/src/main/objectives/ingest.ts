/**
 * **The ingest: a deck, read once by Sonnet, into a tree of learning objectives.**
 *
 * `docs/research/learning-objectives.md` §3. Trigger: the **first open of a PDF in the flow** —
 * not the first Ask. `segments:get` is where a document becomes a flow, so that is where this is
 * called from, and `pending` is on the row before the call returns, which is what lets the panel
 * say "Ellie is reading the deck…" while it happens.
 *
 * ## Four things it deliberately is not
 *
 *  - **Not on any path.** It is fired and not awaited, it runs on the CLI queue's background
 *    lane (`scope: 'ingest'` — priority 2, deferred behind the 1.2 s grace window, and
 *    pre-emptible), and being killed for a learner's question leaves the row exactly where it
 *    started. One minute of Sonnet nobody is waiting for must never be one minute a learner is.
 *  - **Not on the fast lane.** It runs on `models.orchestrator`, which is Sonnet, and not on
 *    `models.fast`. Today those resolve to the same string on both backends
 *    (`ModelPlan.fast` — Haiku measured *slower* on schema-bound calls), so this is a statement
 *    of intent rather than a behaviour change: §3 says Sonnet, and the day `fast` drops to Haiku
 *    again this call must not follow it.
 *  - **Not repeated.** Cached on `content_sha` + `OBJECTIVES_PROMPT_VERSION`; a reopen is a
 *    SQLite read. **Regenerate** is the only thing that re-runs it, and it keeps the states whose
 *    ids still match, which is what makes an id `sha1(content_sha + title)` rather than a rowid.
 *  - **Not trusted.** Whatever comes back goes through `repairTree()` before it is stored: the
 *    schema can ask for "acyclic" and cannot enforce it.
 *
 * A failure is a `failed` row with its reason and a retry, never a broken flow: §3's "the flow
 * works without a tree (the rail says so)".
 */
import {
  MAX_OBJECTIVES,
  MIN_OBJECTIVES,
  type LearningTree,
} from '../../shared/objectives.js';
import type { LearningTreeRecord } from '../db/repos/objectives.js';
import type { LocalStore } from '../db/store.js';
import type { LLMClient } from '../../room/llm/types.js';
import type { ModelPlan } from '../../room/llm/models.js';
import { matchFixtureDeck } from '../../room/llm/scripts.js';
import { log } from '../log.js';
import { critique1Tree } from './critique1.js';
import { repairTree, type RawObjective } from './repair.js';

/**
 * Bump when the prompt or the schema below would produce a different tree for the same bytes.
 * Half the cache key, alongside `content_sha` — a cached tree from an older prompt is
 * regenerated on next open rather than silently kept.
 */
export const OBJECTIVES_PROMPT_VERSION = 2;

/** §3's note for a deck the scripted backend has no fixture for. */
export const NEEDS_LIVE_BACKEND = 'needs a live backend';

const TREE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['objectives'],
  properties: {
    objectives: {
      type: 'array',
      minItems: MIN_OBJECTIVES,
      maxItems: MAX_OBJECTIVES,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'title', 'kind', 'statement', 'criteria', 'quiz_seeds', 'refs'],
        properties: {
          key: {
            type: 'string',
            description: 'A short slug you choose, unique in this list. The other nodes refer to it.',
          },
          title: {
            type: 'string',
            description:
              'At most twelve words, a claim or a skill: "State the Bellman optimality equation". Not a heading.',
          },
          kind: { type: 'string', enum: ['objective', 'prerequisite'] },
          statement: { type: 'string', description: 'One or two sentences: what the learner must be able to do or say.' },
          criteria: {
            type: 'array',
            minItems: 2,
            maxItems: 4,
            items: { type: 'string' },
            description: 'What a correct demonstration contains. Checkable, not a restatement of the title.',
          },
          quiz_seeds: {
            type: 'array',
            minItems: 1,
            maxItems: 3,
            items: { type: 'string' },
            description: 'Question stems a tester could ask. One per criterion at most. Never a yes/no question.',
          },
          refs: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['page'],
              properties: {
                page: { type: 'integer', minimum: 1 },
                quote: { type: 'string' },
              },
            },
            description:
              'Where the deck teaches it, by page. EMPTY only for a prerequisite the deck assumes without teaching.',
          },
          parent_key: {
            type: ['string', 'null'],
            description: 'The key of the objective this is a sub-objective of, or null. At most three levels.',
          },
          requires_keys: {
            type: 'array',
            items: { type: 'string' },
            description: 'Keys of the prerequisites this objective needs. Must not form a cycle.',
          },
          required_by_keys: {
            type: 'array',
            items: { type: 'string' },
            description:
              'ON A PREREQUISITE ONLY, and required there: the keys of the objectives that cannot be ' +
              'demonstrated without it. At least one; a prerequisite nothing needs is not a prerequisite.',
          },
        },
      },
    },
  },
};

const INGEST_SYSTEM = [
  'You read one lecture deck and return the tree of learning objectives it teaches: the defined',
  'pieces of knowledge a student would have to demonstrate to have learned this deck.',
  '',
  'Rules, all of them enforced after you answer:',
  `- Between ${MIN_OBJECTIVES} and ${MAX_OBJECTIVES} nodes. Fewer on a short deck is better than padding.`,
  '- A title is at most twelve words and is a claim or a skill, not a slide heading. "State the',
  '  Bellman optimality equation", not "Bellman equations".',
  '- Every objective carries at least one `refs` page: the page of this deck that teaches it.',
  '  Never invent a page, and never point at a page that does not exist.',
  '- **Prerequisites are the interesting part.** Name the knowledge this deck *assumes without',
  '  teaching* — the thing it uses on a slide as though the reader already has it. Give those',
  '  `kind: "prerequisite"` and an EMPTY `refs`.',
  '- **Every prerequisite must say what needs it**, in its own `required_by_keys`: the keys of the',
  '  objectives that cannot be demonstrated without it. A prerequisite nothing needs is not a',
  '  prerequisite, and one that names nothing is shown to the student in a list of its own with no',
  '  explanation of why it is there. This is the part of the tree the deck itself will not tell',
  '  them, so it is the part worth getting right.',
  '- `requires_keys` must be acyclic and `parent_key` at most three levels deep.',
  '- `quiz_seeds` are stems a tester would actually say out loud. Never a yes/no question, never',
  '  one that contains its own answer.',
  '- Nothing that is not in the deck. If the deck does not teach it, it is not an objective;',
  '  if the deck assumes it, it is a prerequisite.',
  '',
  'Reply with the JSON object and nothing else: no preamble, no reasoning before it, no',
  'commentary after it.',
].join('\n');

export interface IngestDeps {
  store: LocalStore;
  /** Null in scripted mode and whenever the resolved backend cannot ingest. */
  llm: LLMClient | null;
  models: ModelPlan;
  mode: 'scripted' | 'live';
  /** Called on every status change, so the IPC layer can emit `objectives.tree`. */
  onTree?: (tree: LearningTree) => void;
  now?: () => string;
}

export interface IngestInput {
  fileId: string;
  contentSha: string;
  /** The deck's title, as the flow names it. */
  title: string;
  /** The segmentation's own labels with their pages (migration 013). */
  outline: string;
  /** The whole deck text, uncapped (`whole-file-context.md` §4). */
  text: string;
  /** For `matchFixtureDeck` in scripted mode. */
  fileName: string | null;
  /** The deck's page count, so a ref past the last page is dropped by `repairTree`. */
  pageCount?: number | null;
}

/** File ids with an ingest in flight. Module-level: one app, one database, one queue. */
const inFlight = new Set<string>();

/** True when the stored tree is this deck's, under this prompt — i.e. the cache hit of §3. */
export function treeIsCurrent(tree: LearningTree | null, contentSha: string): boolean {
  if (!tree) return false;
  if (tree.contentSha !== contentSha || tree.version !== OBJECTIVES_PROMPT_VERSION) return false;
  return tree.status === 'ready' && tree.objectives.length > 0;
}

/**
 * Ingest this deck if it needs it. Returns true when a tree was written.
 *
 * Safe to call on every `segments:get`: the cache check, the in-flight set and the scripted
 * branch make it a no-op for a deck that already has its tree.
 */
export async function ensureTree(deps: IngestDeps, input: IngestInput, opts: { force?: boolean } = {}): Promise<boolean> {
  const now = deps.now ?? (() => new Date().toISOString());
  const existing = deps.store.objectives.tree(input.fileId);
  if (!opts.force && treeIsCurrent(existing, input.contentSha)) return false;
  if (inFlight.has(input.fileId)) return false;

  // ── the scripted backend: the fixture deck, or an honest "not without a backend" ──
  if (deps.mode !== 'live' || !deps.llm || deps.llm.kind === 'scripted') {
    if (matchFixtureDeck({ fileName: input.fileName, contentSha: input.contentSha }) === 'critique1') {
      const tree = write(deps, {
        fileId: input.fileId,
        contentSha: input.contentSha,
        promptVersion: OBJECTIVES_PROMPT_VERSION,
        model: 'fixture',
        status: 'ready',
        generatedAt: now(),
        error: null,
        objectives: critique1Tree(input.fileId),
      }, now());
      log().info('objectives.fixture', { file_id: input.fileId, objectives: tree.objectives.length });
      return true;
    }
    // Not `failed`: nothing has gone wrong, the deck simply has not been read yet, and the next
    // open on a live backend reads it. The note is what the panel puts on screen.
    if (existing?.status === 'pending' && existing.error === NEEDS_LIVE_BACKEND) return false;
    write(deps, {
      fileId: input.fileId,
      contentSha: input.contentSha,
      promptVersion: OBJECTIVES_PROMPT_VERSION,
      model: deps.models.orchestrator,
      status: 'pending',
      generatedAt: null,
      error: NEEDS_LIVE_BACKEND,
      objectives: [],
    }, now());
    return false;
  }

  inFlight.add(input.fileId);
  const startedAt = Date.now();
  // `pending` is visible at once (§3), before a single token has been asked for.
  write(deps, {
    fileId: input.fileId,
    contentSha: input.contentSha,
    promptVersion: OBJECTIVES_PROMPT_VERSION,
    model: deps.models.orchestrator,
    status: 'pending',
    generatedAt: null,
    error: null,
    objectives: [],
  }, now());
  log().info('objectives.ingest.start', {
    file_id: input.fileId,
    model: deps.models.orchestrator,
    chars: input.text.length,
    outline_lines: input.outline ? input.outline.split('\n').length : 0,
    regenerate: opts.force === true,
  });

  try {
    const raw = await ask(deps, input);
    const { objectives, notes } = repairTree({ fileId: input.fileId, contentSha: input.contentSha, raw, pageCount: input.pageCount ?? null });
    if (objectives.length === 0) throw new Error('the model returned no usable objectives');
    // Regenerate keeps the states whose ids still match (§3); everything else is about an
    // objective that no longer exists and would otherwise sit in the table forever.
    const dropped = deps.store.objectives.pruneStates(input.fileId, objectives.map((o) => o.id));
    write(deps, {
      fileId: input.fileId,
      contentSha: input.contentSha,
      promptVersion: OBJECTIVES_PROMPT_VERSION,
      model: deps.models.orchestrator,
      status: 'ready',
      generatedAt: now(),
      error: null,
      objectives,
    }, now());
    log().info('objectives.ready', {
      file_id: input.fileId,
      ms: Date.now() - startedAt,
      objectives: notes.kept,
      prerequisites: notes.prerequisites,
      assumed: notes.assumed,
      states_dropped: dropped,
      // The repairs, so a prompt that keeps producing cycles is visible without a second run.
      repaired: {
        over_cap: notes.droppedOverCap,
        untitled: notes.droppedUntitled,
        duplicate: notes.droppedDuplicate,
        dangling_parents: notes.danglingParents,
        dangling_requires: notes.danglingRequires,
        cycles_cut: notes.cyclesCut,
        depth_clamped: notes.depthClamped,
        seeded_quiz: notes.seededQuiz,
        orphan_prerequisites: notes.orphanPrerequisites,
        refs_out_of_range: notes.refsOutOfRange,
      },
    });
    if (notes.kept < MIN_OBJECTIVES) {
      // Kept, not rejected: a five-node tree of real objectives beats an empty panel and a
      // second minute of Sonnet. Logged so a deck that keeps under-producing is findable.
      log().warn('objectives.thin', { file_id: input.fileId, objectives: notes.kept });
    }
    return true;
  } catch (err) {
    /**
     * Pre-emption is not a failure (`claude-cli.ts` `CLI_PREEMPTIBLE`): the learner asked
     * something and the lane was taken back for them. The row goes back to `pending` with no
     * error, and the next open — or the next Ask — starts it again.
     */
    if ((err as Error).name === 'CliPreemptedError') {
      log().info('objectives.ingest.preempted', { file_id: input.fileId, ms: Date.now() - startedAt });
      return false;
    }
    write(deps, {
      fileId: input.fileId,
      contentSha: input.contentSha,
      promptVersion: OBJECTIVES_PROMPT_VERSION,
      model: deps.models.orchestrator,
      status: 'failed',
      generatedAt: null,
      error: (err as Error).message,
      objectives: [],
    }, now());
    log().error('objectives.ingest.failed', {
      file_id: input.fileId,
      ms: Date.now() - startedAt,
      cause: (err as Error).message,
    });
    return false;
  } finally {
    inFlight.delete(input.fileId);
  }
}

async function ask(deps: IngestDeps, input: IngestInput): Promise<RawObjective[]> {
  const outline = input.outline.trim() ? `OUTLINE OF THE DECK\n${input.outline.trim()}\n\n` : '';
  const result = await deps.llm!.complete({
    // Sonnet, and named as the orchestrator model rather than the fast lane — see the header.
    model: deps.models.orchestrator,
    // A twenty-node tree with a statement, up to four criteria and up to three stems on each is
    // the biggest object this app asks any model for. A ceiling, not a target.
    max_tokens: 8_000,
    system: [{ type: 'text', text: INGEST_SYSTEM }],
    messages: [
      {
        role: 'user',
        content: `DECK TITLE\n${input.title}\n\n${outline}THE WHOLE DECK\n${input.text}`,
      },
    ],
    jsonSchema: TREE_SCHEMA,
    // `costScope: 'objectives'` rather than `'ingest'`: it shares the ingest lane but it is a
    // separate per-file cost — on the CLI this is the single biggest call the app makes — and a
    // learner asking what a deck cost them has to be able to see it on its own line.
    meta: { scope: 'ingest', costScope: 'objectives', fileId: input.fileId },
  });
  const parsed = JSON.parse(extractJsonObject(result.text)) as { objectives?: unknown };
  return Array.isArray(parsed.objectives) ? (parsed.objectives as RawObjective[]) : [];
}

/**
 * The same unwrapper the decision and ledger paths use: a model that wraps its object in prose
 * under a schema is a known shape, and it is not a reason to throw a minute of Sonnet away.
 */
function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return trimmed;
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end <= start) return trimmed;
  return trimmed.slice(start, end + 1);
}

function write(deps: IngestDeps, record: LearningTreeRecord, now: string): LearningTree {
  const tree = deps.store.objectives.upsertTree(record, now);
  deps.onTree?.(tree);
  return tree;
}
