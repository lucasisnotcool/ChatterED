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
import type { CreateSessionInput, FlowRoomView, FlowThreadView, RolePairing } from '../shared/types.js';
import { groupByAnchor } from '../shared/flowthread.js';
import type { SegmentView } from '../shared/segment/index.js';
import type { RoomActor } from '../room/actor.js';
import type { FlowSession, PendingQuiz, TaughtItem } from '../room/flow.js';
import type { ReferenceAnswerState } from '../room/reference.js';
import { BTW_SIDE_CHANNEL_V1 } from '../room/concepts/btw-side-channel-v1.js';
import { pickScriptName } from '../room/llm/scripts.js';
import type { LLMClient } from '../room/llm/types.js';
import type { ModelPlan } from '../room/llm/models.js';
import type { LocalStore } from './db/store.js';
import { createSession, draftConcept } from './sessions.js';
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
    if (room) return { roomId: room.id, created: false };
  }

  const file = deps.vault.fileRow(fileId);
  if (!file) throw new Error('That file is not in the vault any more.');
  // The whole document's text. It is the material the agents see; the *segment* text is what a
  // REFERENCE call sees, and that is resolved per question in `segmentText()`.
  const text = await deps.vault.textFor({ fileId, pageFrom: null, pageTo: null });

  const input: CreateSessionInput = {
    moduleCode: deps.vault.moduleCodeFor(file.topic_id) ?? '',
    title: titleFor(file.name, view.segments),
    text,
    sourceKind: 'pdf_pages',
    fileId,
    fileName: file.name,
    fileSha: sha,
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
  const threads: FlowThreadView[] = groupByAnchor(room.messages).map((t) => ({
    anchorId: t.anchorId,
    messageIds: t.messageIds,
    lockedByAnswerId: lockedByAnchor.get(t.anchorId) ?? null,
  }));
  // A thread can be locked before it has any message the renderer has seen (the question and the
  // answer land in the same tick), so a locked anchor with no group is still reported.
  for (const [anchorId, answerId] of lockedByAnchor) {
    if (!threads.some((t) => t.anchorId === anchorId)) {
      threads.push({ anchorId, messageIds: [], lockedByAnswerId: answerId });
    }
  }
  return { room, threads };
}

/** The sha the flow keys a room on, for callers that already hold the text rather than the file. */
export function shaOfText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
