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
import { pickScriptName } from '../room/llm/scripts.js';
import type { LLMClient } from '../room/llm/types.js';
import type { ModelPlan } from '../room/llm/models.js';
import type { LocalStore } from './db/store.js';
import { log } from './log.js';
import { createSession, draftConcept, frozenPrefix } from './sessions.js';
import type { SegmentService } from './vault/segments.js';
import type { VaultService } from './vault/service.js';

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

  // The claims. Live: the ingest path that has always drafted them, now with nothing to confirm —
  // the flow has no screen on which to confirm anything, and the learner edits a claim by
  // explaining it, not by editing a row. Scripted: the committed fixed pack, which is what the
  // video is filmed on and what makes a fresh install replay with nothing hand-made.
  if (deps.llm && deps.mode === 'live') {
    const draft = await draftConcept(deps.llm, { moduleCode: input.moduleCode, title: input.title, text }, deps.models);
    input.conceptId = draft.conceptId;
    input.title = draft.title || input.title;
    input.claims = draft.claims.map((c) => ({
      id: c.id,
      label: c.label,
      learnerLabel: c.learnerLabel,
    }));
  }

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
 * Which fixed pack a scripted session opens on.
 *
 * Reuses `pickScriptName()` rather than inventing a second way to recognise the fixture: if the
 * deck is the one the script replays, its claims must be the ones the script's turns are about,
 * or the ledger would score Max's questions about `/btw` against claims about Hessians. One
 * recogniser, two consumers.
 */
function conceptFor(deps: FlowRoomDeps, input: { fileName: string; contentSha: string }): { conceptId?: string } {
  if (deps.mode !== 'scripted') return {};
  return pickScriptName(input) === 'critique1' ? { conceptId: BTW_SIDE_CHANNEL_V1.concept_id } : {};
}

/** The deck's own first slide title if the pipeline found one; otherwise the file name. */
function titleFor(fileName: string, segments: readonly SegmentView[]): string {
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

// ── the flow session across a quit ──────────────────────────────────────────

export interface StoredFlowState {
  session: FlowSession | null;
  taught: TaughtItem[];
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
  const threadView = (anchorId: string, messageIds: string[]): FlowThreadView => ({
    anchorId,
    messageIds,
    lockedByAnswerId: lockedByAnchor.get(anchorId) ?? null,
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
  return { room, threads };
}

/** The sha the flow keys a room on, for callers that already hold the text rather than the file. */
export function shaOfText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
