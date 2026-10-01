/**
 * **A room per document, created lazily** (`flow-build-plan.md` §3.3, §4.5).
 *
 * The setup screen is gone. `SessionSetup.svelte` asked the learner to paste text, confirm three
 * claims and press a button before anything could be said; in the flow the first "+ Ask here" in
 * a file is that button, and the answer arrives before the learner has finished reading the
 * slide. That is the whole change, and this file is all of it:
 *
 *  - **the key is the document's bytes.** `materials.file_id` + `materials.file_sha256`, with the
 *    sha being the same `content_sha` the segment cache is keyed on, so asking a second question
 *    in the same deck reopens the room rather than starting a second one — and editing the deck
 *    correctly starts a new one, because a transcript about the old bytes is about a different
 *    document (the argument migration 010 already makes for `anchor_id`).
 *  - **the creation path is `createSession`, unchanged.** No second ingest, no second way to make
 *    a room. It is called with a material assembled from what the vault already knows, which is
 *    exactly what `sessionSeed` + `SessionSetup` used to hand it.
 *  - **the flow session survives a quit.** `RoomActor.flowSnapshot()` is small — one session row,
 *    a handful of taught items and at most one pending quiz — so it is stored as one settings
 *    row rather than earning a table. `flow.ts`'s `tickSession` then closes a sitting whose gap
 *    elapsed while the app was shut, which is why it has to be restored rather than reset.
 */
import { createHash } from 'node:crypto';
import { rosterFor } from '../room/agents.js';
import type { ConceptPack } from '../room/records.js';
import type { CreateSessionInput, FlowRoomView, FlowThreadView, RolePairing } from '../shared/types.js';
import { groupByAnchor } from '../shared/flowthread.js';
import type { SegmentView } from '../shared/segment/index.js';
import type { RoomActor } from '../room/actor.js';
import type { FlowSession, PendingQuiz, TaughtItem } from '../room/flow.js';
import type { MaterialRow } from '../room/records.js';
import type { ReferenceAnswerState } from '../room/reference.js';
import { BTW_SIDE_CHANNEL_V1 } from '../room/concepts/btw-side-channel-v1.js';
import { matchFixtureDeck } from '../room/llm/scripts.js';
import { PSD_HESSIAN_CONVEXITY_V1 } from '../room/concepts/psd-hessian-convexity-v1.js';
import type { LLMClient } from '../room/llm/types.js';
import type { ModelPlan } from '../room/llm/models.js';
import type { LocalStore } from './db/store.js';
import { log } from './log.js';
import { guessScope, scopeShownFor, DECK_ANCHOR_ID, type AskScope } from '../shared/scope.js';
import { segmentContext, type ReferenceContext } from '../room/reference.js';
import { createSession, frozenPrefix } from './sessions.js';
import type { SegmentService } from './vault/segments.js';
import type { VaultService } from './vault/service.js';
import type { NotebookHostImpl } from './notebooks/host.js';
import { isNotebookId } from '../shared/notebook.js';

export interface FlowRoomDeps {
  store: LocalStore;
  segments: SegmentService;
  vault: VaultService;
  pairing: RolePairing;
  appVersion: string;
  osVersion: string;
  mode: 'scripted' | 'live';
  backend: string;
  models: ModelPlan;
  /** Null in scripted mode: nothing is drafted, the fixture pack is used. */
  llm: LLMClient | null;
  /**
   * Notebooks as subjects (contract C2, C4). A notebook id (`nb_…`) passed where a file id was
   * opens the notebook's room, whose material is its ticked sources. Optional only so the tests
   * that predate notebooks build without it; the app always passes it.
   */
  notebooks?: Pick<NotebookHostImpl, 'subject' | 'deckText' | 'outline' | 'scriptMaterial'>;
}

export interface FlowRoom {
  roomId: string;
  /** True when this call is what made the room. The event log wants to know. */
  created: boolean;
}

/**
 * The room for this document, opened or made.
 *
 * Deliberately **not** idempotent-by-accident: the lookup is by (file, bytes) and the insert is
 * inside `createSession`'s own transaction, so two "+ Ask here" clicks a frame apart on a fresh
 * deck can only produce one room.
 */
export async function openOrCreateFlowRoom(deps: FlowRoomDeps, fileId: string): Promise<FlowRoom> {
  if (isNotebookId(fileId)) return openOrCreateNotebookRoom(deps, fileId);
  const view = await deps.segments.document(fileId);
  const sha = view.contentSha;
  const existing = deps.store.materials.forFile(fileId, sha);
  if (existing) {
    const room = deps.store.rooms.get(roomIdForMaterial(deps.store, existing.id) ?? '');
    if (room) {
      await reextractIfTruncated(deps, fileId, existing, room.topic);
      return { roomId: room.id, created: false };
    }
  }

  const file = deps.vault.fileRow(fileId);
  if (!file) throw new Error('That file is not in the vault any more.');
  // The whole document's text, **uncapped**, plus its outline. It is the material the agents
  // see; the *segment* text is what a page-scoped REFERENCE call sees, resolved per question in
  // `segmentText()`. `deckText()` rather than `textFor()` is the whole of issue #35's first
  // defect: `textFor` applies `REFERENCE_TEXT_CAP`, the per-selection cap, and on the 58-page
  // CS4246 deck that left 5,724 of 27,948 characters here.
  const { text, outline } = await deckMaterial(deps, fileId);

  const input: CreateSessionInput = {
    moduleCode: deps.vault.moduleCodeFor(file.topic_id) ?? '',
    title: titleFor(file.name, view.segments),
    text,
    sourceKind: 'pdf_pages',
    fileId,
    fileName: file.name,
    fileSha: sha,
    // The whole document, because in the flow the material *is* the document: there is no page
    // range to mark any more, and 001_init.sql's CHECK on `pdf_pages` requires a `page_from`.
    pageFrom: 1,
    pageTo: Math.max(1, view.pageCount),
    ...(outline ? { outline } : {}),
    ...(deps.vault.topicContext(file.topic_id) ? { topic: deps.vault.topicContext(file.topic_id)! } : {}),
    ...conceptFor(deps, { fileName: file.name, contentSha: sha }),
  };

  // **The claims are not drafted here any more** (issue #35). `draftConcept` is a 37-second
  // Sonnet call and it was awaited inside the first "+ Ask here" — a REFERENCE answer needs no
  // pack whatsoever, and was queued behind one. The room opens on `pendingPack()` and
  // `src/main/pack.ts` drafts the real one in the background, swapping it in at the next turn.

  const created = createSession(
    {
      store: deps.store,
      pairing: deps.pairing,
      appVersion: deps.appVersion,
      osVersion: deps.osVersion,
      mode: deps.mode,
      backend: deps.backend,
      models: deps.models,
    },
    input,
  );
  return { roomId: created.roomId, created: true };
}

// ── a notebook's room (`docs/research/notebooks.md`, contract C2, C4) ──────

/**
 * **The room for a notebook, opened or made.** One per notebook, keyed exactly as a file's is —
 * `materials.file_id` = the notebook id, `materials.file_sha256` = its content key `nb:<id>` —
 * and that key never changes when the sources do, so ticking, adding or removing a source keeps
 * the room, the transcript and the sitting.
 *
 * What changes is the material: the ticked, ready sources' text (`NotebookHost.deckText`, each
 * page under its notebook page marker) and their outline. When either differs from what the
 * material holds, it is **re-frozen in place** before the next turn — the same move
 * `reextractIfTruncated` makes for a file, for the same reason (the room is the learner's
 * record; a re-frozen prefix costs one full-price turn on the API path and nothing on the CLI).
 * The actor reads the material from SQLite every turn, so the write is all it takes.
 */
async function openOrCreateNotebookRoom(deps: FlowRoomDeps, notebookId: string): Promise<FlowRoom> {
  const host = deps.notebooks;
  if (!host) throw new Error('Notebooks are not available here.');
  const subject = host.subject(notebookId);
  if (!subject) throw new Error('That notebook no longer exists.');
  const existing = deps.store.materials.forFile(notebookId, subject.contentKey);
  if (existing) {
    const room = deps.store.rooms.get(roomIdForMaterial(deps.store, existing.id) ?? '');
    if (room) {
      refreezeNotebookMaterial(deps, notebookId, existing, room.topic);
      return { roomId: room.id, created: false };
    }
  }

  const { text } = host.deckText(notebookId);
  const outline = host.outline(notebookId);
  const input: CreateSessionInput = {
    moduleCode: '',
    title: subject.name,
    text,
    sourceKind: 'pdf_pages',
    fileId: notebookId,
    // `file_path` is what the scripted backend recognises a deck by and what the CHECK on a
    // `pdf_pages` material requires; for a notebook it is the notebook's name.
    fileName: subject.name,
    fileSha: subject.contentKey,
    pageFrom: 1,
    pageTo: Math.max(1, subject.pageCount),
    ...(outline ? { outline } : {}),
    // A fixture deck in a notebook still replays its script: recognised by its first source.
    ...conceptFor(deps, host.scriptMaterial(notebookId)),
  };
  const created = createSession(
    {
      store: deps.store,
      pairing: deps.pairing,
      appVersion: deps.appVersion,
      osVersion: deps.osVersion,
      mode: deps.mode,
      backend: deps.backend,
      models: deps.models,
    },
    input,
  );
  log().info('notebook.room_created', {
    notebook_id: notebookId,
    room_id: created.roomId,
    sources: subject.sources.filter((s) => s.enabled && s.status === 'ready').length,
    chars: text.length,
  });
  return { roomId: created.roomId, created: true };
}

/**
 * **Re-freeze a notebook room's material when its context changed** (C4). A no-op when the ticked
 * sources' text and outline are what the material already holds, so it is cheap to call before
 * every turn; `DocHost.openFlowRoom` and `roomForFile` both do.
 */
export function refreezeNotebookMaterial(
  deps: Pick<FlowRoomDeps, 'store' | 'pairing' | 'models' | 'notebooks'>,
  notebookId: string,
  material: MaterialRow,
  topic: string,
): boolean {
  const host = deps.notebooks;
  if (!host) return false;
  const { text, truncated } = host.deckText(notebookId);
  const outline = host.outline(notebookId);
  if (text === material.extracted_text && outline === material.outline) return false;

  const before = material.extracted_text.length;
  const patched: MaterialRow = { ...material, extracted_text: text, outline };
  const pack = JSON.parse(material.concept_pack) as ConceptPack;
  const roster = rosterFor(deps.pairing, deps.models.agent);
  const frozen = frozenPrefix(patched, pack, roster, topic);
  deps.store.materials.refreeze(material.id, { extracted_text: text, outline, ...frozen });
  log().info('notebook.material_refrozen', {
    material_id: material.id,
    notebook_id: notebookId,
    chars_before: before,
    chars_after: text.length,
    truncated,
    fingerprint: host.subject(notebookId)?.fingerprint.slice(0, 200) ?? null,
    prefix_sha256: frozen.prefix_sha256.slice(0, 12),
  });
  return true;
}

// ── the deck, whole ─────────────────────────────────────────────────────────

/**
 * The material a flow room is made of: **the document's whole text and its outline**.
 *
 * The outline is the segmentation's own labels with their page numbers, which on a slide deck
 * are the slide titles the pipeline lifted from the title band. When a document has no
 * segmentation yet (the first question can arrive before the pipeline has run) it falls back to
 * the first line of each indexed page, which is the same sentence read from the other end.
 * Nothing here is generated: an outline is what the document says about itself.
 */
export async function deckMaterial(
  deps: Pick<FlowRoomDeps, 'segments' | 'vault'>,
  fileId: string,
): Promise<{ text: string; outline: string; pages: number }> {
  const [{ text, pages }, view] = await Promise.all([deps.vault.deckText(fileId), deps.segments.document(fileId)]);
  let outline = outlineFromSegments(view.segments);
  if (outline.length === 0) {
    outline = (await deps.vault.pageHeads(fileId)).map((h) => outlineLine(h.page, h.head)).join('\n');
  }
  return { text, outline, pages };
}

/** `p. 14 — A* search`, one per segment, consecutive repeats collapsed. */
export function outlineFromSegments(segments: readonly SegmentView[]): string {
  const lines: string[] = [];
  let last = '';
  for (const s of segments) {
    const label = s.label.trim();
    if (label.length === 0) continue;
    const line = outlineLine(s.page, label);
    // A slide split into three crops keeps one line: the outline is a table of contents, not a
    // second copy of the flow.
    if (line === last) continue;
    lines.push(line);
    last = line;
  }
  return lines.join('\n');
}

function outlineLine(page: number | null, label: string): string {
  return page === null ? label : `p. ${page} — ${label}`;
}

/**
 * **The migration for rooms that already exist**, run on every reopen and a no-op after the
 * first: a flow room created before issue #35 holds a material truncated at
 * `REFERENCE_TEXT_CAP` and no outline. Re-extract the deck, re-freeze the prefix, and write a
 * **new `prefix_sha256`**.
 *
 * Re-creating the room instead was the alternative, and it is the wrong one: the room *is* the
 * learner's transcript, their ledger, their cards and their sitting, and none of that is about
 * the bug. What a re-freeze costs is the cached prefix — and for a flow room on the CLI backend
 * it costs nothing at all, because `--system-prompt` takes one string and the CLI drops cache
 * breakpoints (`segmentation-cost.md` §1.4), so these prefixes were never cache-eligible on the
 * path they actually run on. On the API path it is one full-price turn. That is the whole bill.
 */
async function reextractIfTruncated(
  deps: FlowRoomDeps,
  fileId: string,
  material: MaterialRow,
  topic: string,
): Promise<void> {
  // Only a whole-document material is re-extracted. A room opened on a page range asked for
  // those pages and must keep them.
  if (material.source_kind !== 'pdf_pages' || material.page_from !== 1) return;
  const fresh = await deckMaterial(deps, fileId);
  if (fresh.text.length === 0) return;
  if (fresh.text === material.extracted_text && fresh.outline === material.outline) return;

  const before = material.extracted_text.length;
  const patched: MaterialRow = { ...material, extracted_text: fresh.text, outline: fresh.outline };
  const pack = JSON.parse(material.concept_pack) as ConceptPack;
  const roster = rosterFor(deps.pairing, deps.models.agent);
  const frozen = frozenPrefix(patched, pack, roster, topic);
  deps.store.materials.refreeze(material.id, {
    extracted_text: fresh.text,
    outline: fresh.outline,
    ...frozen,
  });
  log().info('material.reextracted', {
    material_id: material.id,
    file_id: fileId,
    chars_before: before,
    chars_after: fresh.text.length,
    outline_lines: fresh.outline ? fresh.outline.split('\n').length : 0,
    pages: fresh.pages,
    prefix_sha256: frozen.prefix_sha256.slice(0, 12),
  });
}

/**
 * Which pack a session opens on: **a fixture's, or none**.
 *
 * `pickScriptName()` was the recogniser here, and it has a *default* — a deck it does not
 * recognise comes back `'psd-hessian'`, which is the right answer to "which script does the
 * scripted client replay" and the wrong answer to "whose claims are these". The old code only
 * checked for `'critique1'`, so every other deck fell through to `{}` and `packFor()`'s own
 * base, which is the PSD/Hessian fixture. That is how a 58-page CS4246 planning deck came to be
 * scored against claims about positive semidefinite Hessians (`whole-file-context.md` §1).
 *
 * `matchFixtureDeck()` has no default. A deck that is not a fixture gets `pending`: an empty
 * rail that says "no concepts yet", and a background ingest that fills it from this deck's own
 * text. A fixture's claims are bound to the fixture's bytes, in scripted mode only — that is
 * what makes a fresh install replay the A1 video with nothing hand-made.
 */
function conceptFor(
  deps: FlowRoomDeps,
  input: { fileName: string; contentSha: string },
): { conceptId?: string; pending?: boolean } {
  if (deps.mode !== 'scripted') return { pending: true };
  const fixture = matchFixtureDeck(input);
  if (fixture === 'critique1') return { conceptId: BTW_SIDE_CHANNEL_V1.concept_id };
  if (fixture === 'psd-hessian') return { conceptId: PSD_HESSIAN_CONVEXITY_V1.concept_id };
  return { pending: true };
}

/** The deck's own first slide title if the pipeline found one; otherwise the file name. */
export function titleFor(fileName: string, segments: readonly SegmentView[]): string {
  const first = segments.find((s) => s.label.trim().length > 0)?.label.trim();
  return first && first.length <= 80 ? first : fileName.replace(/\.pdf$/i, '');
}

function roomIdForMaterial(store: LocalStore, materialId: string): string | null {
  // Rooms are not indexed by material, and there are tens of them, not thousands. A scan is
  // honest here and needs no migration; it becomes a query the day that stops being true.
  const open = store.rooms.openOrScheduled().find((r) => r.material_id === materialId);
  return open?.id ?? null;
}

// ── the segment a question is about ─────────────────────────────────────────

/**
 * The text a REFERENCE call sees: **this segment's page**, not the whole deck.
 *
 * It is the page rather than the rectangle, and that is a known approximation: the geometry
 * pipeline keeps its text boxes in the main process and does not send them over IPC
 * (`SEGMENTS.md` §2), so cropping the text to the segment's box would mean a second geometry
 * pass per question. A slide page is ~120 words; the rectangle would be fewer, and the cost of
 * the difference is that a question about the lower half of a slide can see the upper half too.
 * That is the safe direction to be wrong in. Cropping properly is an A2 line.
 */
export async function segmentText(
  deps: Pick<FlowRoomDeps, 'segments' | 'vault'>,
  fileId: string,
  segmentId: string,
): Promise<{ text: string; page: number | null }> {
  const view = await deps.segments.document(fileId);
  const segment = view.segments.find((s) => s.id === segmentId);
  if (!segment) return { text: '', page: null };
  const text = await deps.vault.textFor({ fileId, pageFrom: segment.page, pageTo: segment.page });
  return { text, page: segment.page };
}

// ── what one question is answered from ──────────────────────────────────────

export interface ReferenceContextInput {
  fileId: string;
  /** The segment the learner asked on; null for the deck line at the top of the flow. */
  segmentId: string | null;
  question: string;
  /** The learner's override, when the scope chip was used. Omitted ⟹ the rule decides. */
  scope?: AskScope;
  /** The deck's outline, frozen on the material (migration 013). */
  outline: string;
}

export interface ResolvedReferenceContext extends ReferenceContext {
  /** What the rule guessed, whether or not the learner overrode it. Logged, not rendered. */
  guessed: AskScope;
  overridden: boolean;
}

/**
 * **The one resolver.** What the REFERENCE call is given, and what the card's footer says about
 * it, decided together (`whole-file-context.md` §3 and §4 recommendations 3, 4 and 6).
 *
 * Three strategies, and the log says which ran every time:
 *
 *  - `page` — the segment's page text, **plus the outline**, so a page answer can still say
 *    where the page sits without being handed the other fifty-seven;
 *  - `whole` — the outline and the entire document, which for every deck in the local corpus is
 *    7–20 K tokens and is simply affordable (`whole-file-context.md` §2);
 *  - `retrieval` — for a document over `DECK_TEXT_CAP`, the outline plus the FTS5 top-k **whole
 *    pages** for this question. The index already exists; §5 of the same note explains why this
 *    is not vector retrieval.
 */
export async function referenceContext(
  deps: Pick<FlowRoomDeps, 'segments' | 'vault'>,
  input: ReferenceContextInput,
): Promise<ResolvedReferenceContext> {
  const guess = guessScope({ question: input.question, anchorId: input.segmentId });
  const scope: AskScope = input.scope ?? guess.scope;
  const overridden = input.scope !== undefined && input.scope !== guess.scope;
  const outline = input.outline.trim();

  let context: ReferenceContext;
  let strategy: 'page' | 'whole' | 'retrieval';
  let pages = 0;

  if (scope === 'segment' && input.segmentId !== null) {
    const { text, page } = await segmentText(deps, input.fileId, input.segmentId);
    // The learner's own label for the segment, so the Teacher can name where they are (#41).
    // Best-effort: a document whose segment cache has moved on still answers, without the label.
    let label: string | null = null;
    try {
      const view = await deps.segments.document(input.fileId);
      label = view.segments.find((sg) => sg.id === input.segmentId)?.label ?? null;
    } catch {
      label = null;
    }
    context = segmentContext({ text, page, outline, label });
    strategy = 'page';
    pages = 1;
  } else {
    const deck = await deps.vault.deckText(input.fileId);
    if (deck.truncated) {
      const hits = deps.vault.topPages(input.fileId, input.question);
      const retrievedPages = hits.map((h) => h.page).filter((p): p is number => p !== null);
      const body = hits.map((h) => (h.page === null ? h.body : `[p. ${h.page}]\n${h.body}`)).join('\n\n');
      context = {
        scope: 'deck',
        // A document too large for the prefix falls back to its own index rather than to
        // nothing — and never silently: `context.retrieval` is in the log beside the answer.
        passageText: body || deck.text,
        outline,
        retrievedPages,
        scopeShown: scopeShownFor({ scope: 'deck', retrievedPages }),
      };
      strategy = 'retrieval';
      pages = hits.length;
      log().info('context.retrieval', {
        file_id: input.fileId,
        deck_chars: deck.text.length,
        deck_pages: deck.pages,
        kept_pages: retrievedPages,
        chars: body.length,
      });
    } else {
      context = {
        scope: 'deck',
        passageText: deck.text,
        outline,
        retrievedPages: [],
        scopeShown: scopeShownFor({ scope: 'deck' }),
      };
      strategy = 'whole';
      pages = deck.pages;
    }
  }

  log().info('context.built', {
    scope: context.scope,
    chars: context.passageText.length + outline.length,
    pages,
    strategy,
    guessed: guess.scope,
    guess_reason: guess.reason,
    overridden,
  });

  return { ...context, guessed: guess.scope, overridden };
}

// ── the flow session across a quit ──────────────────────────────────────────

export interface StoredFlowState {
  session: FlowSession | null;
  taught: TaughtItem[];
  /**
   * The Tester's open question. **A row written before issue #47 has no `attempts` and no
   * `answerShown`**, and `flow.ts` reads both as absent rather than as zero-by-luck
   * (`attemptsOf`, `answerShownOf`): the answer stays withheld until the learner does something,
   * which is the safe end of the lock.
   */
  pendingQuiz: PendingQuiz | null;
  answers: ReferenceAnswerState[];
  /** anchorId → the highest `seq` the learner has seen there (audit §7). Absent in old rows. */
  seen?: Record<string, number>;
  /** anchorId → the card's `collapsed` / `removed`, so a dismissed card stays dismissed. */
  cards?: Record<string, { collapsed?: boolean; removed?: boolean }>;
}

/** One settings row per room. Small by construction — see the header. */
export function flowStateKey(roomId: string): string {
  return `flow_state:${roomId}`;
}

export function loadFlowState(store: LocalStore, roomId: string): StoredFlowState | undefined {
  const raw = store.settings.get(flowStateKey(roomId));
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as StoredFlowState;
  } catch {
    // A corrupt row is a sitting that did not survive, not a room that cannot open.
    return undefined;
  }
}

export function saveFlowState(store: LocalStore, roomId: string, state: StoredFlowState): void {
  store.settings.set(flowStateKey(roomId), JSON.stringify(state), new Date().toISOString());
}

// ── the view ────────────────────────────────────────────────────────────────

/**
 * The room, plus its threads. The threads are ids only: the messages themselves are already on
 * `room.messages`, and two copies of one turn is two things that can disagree.
 */
export function flowRoomView(actor: RoomActor, lockedByAnchor: Map<string, string>): FlowRoomView {
  const room = actor.snapshot();
  const seen = actor.seenSnapshot();
  const cards = actor.cardStateSnapshot();
  /**
   * **The open Tester question, in the thread it was asked in** (issue #47, `attempt-first.md`
   * §2.4). At most one is open at a time — `PendingQuiz` is one object per room — so this is a
   * single lookup rather than a map, and every other thread reports `null`. The renderer reads it
   * for the composer's *"Max won't give the answer until you've tried once"* line, for **Show the
   * answer** (`attempts >= 1 && !answerShown`) and for **Try another** (after `feedbackGiven`).
   */
  const pendingQuiz = actor.pendingQuizView();
  const threadView = (anchorId: string, messageIds: string[]): FlowThreadView => ({
    anchorId,
    messageIds,
    lockedByAnswerId: lockedByAnchor.get(anchorId) ?? null,
    quiz: pendingQuiz?.anchorId === anchorId ? pendingQuiz.quiz : null,
    lastSeenSeq: seen[anchorId] ?? 0,
    collapsed: cards[anchorId]?.collapsed ?? false,
    removed: cards[anchorId]?.removed ?? false,
  });
  const threads: FlowThreadView[] = groupByAnchor(room.messages).map((t) => threadView(t.anchorId, t.messageIds));
  // A thread can be locked before it has any message the renderer has seen (the question and the
  // answer land in the same tick), so a locked anchor with no group is still reported.
  for (const anchorId of lockedByAnchor.keys()) {
    if (!threads.some((t) => t.anchorId === anchorId)) {
      threads.push(threadView(anchorId, []));
    }
  }
  /**
   * **The deck thread comes first** (issue #35). `flow:askDeck` anchors its answers to the
   * synthetic `deck` anchor, and a deck-level question belongs above the flow rather than under
   * whichever slide happens to sit at that index — that it had nowhere to go *is* the defect.
   * `groupByAnchor` returns threads in first-message order, so without this a deck question
   * asked after a page question would render below it.
   */
  const deckIndex = threads.findIndex((t) => t.anchorId === DECK_ANCHOR_ID);
  if (deckIndex > 0) threads.unshift(...threads.splice(deckIndex, 1));
  return { room, threads };
}

/** The sha the flow keys a room on, for callers that already hold the text rather than the file. */
export function shaOfText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
