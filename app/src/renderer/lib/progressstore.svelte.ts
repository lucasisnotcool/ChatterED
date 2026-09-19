/**
 * Progress renderer state (#48, `docs/research/collab-doc.md` §6). **Track T5 owns this file.**
 *
 * The bar in the doc header, the lesson cards behind it, and the one gesture that starts a
 * lesson. It holds the `ProgressView` the main process sends and three purely local things: is
 * the popover open, which segment just moved (so the bar can animate *that* one), and whether
 * the completion moment has already been marked.
 *
 * The counting is `progressview.ts`'s and the fills are the main process's. Nothing here decides
 * what an objective is worth — §6's rule is that only the learner's own words move it, and a
 * renderer that could compute a fill could quietly disagree with the ledger.
 */

import { bridge } from './bridge.js';
import { isComplete, movedObjectives } from './progressview.js';
import type { ProgressView } from '../../shared/doc/types.js';
import type { RoomEvent } from '../../shared/types.js';

export class ProgressStore {
  fileId: string | null = $state(null);
  view: ProgressView | null = $state(null);
  busy = $state(false);
  /** The lesson cards. One popover, opened from the bar or from the count beside it. */
  open = $state(false);
  /** The card whose **Start** is in flight — named, so the button that was pressed says so. */
  starting: string | null = $state(null);
  /**
   * The segments that just changed, with a token so the same segment moving twice animates
   * twice. Same shape as `store.ledgerPulse`, and for the same reason.
   */
  moved: { ids: string[]; token: number } = $state({ ids: [], token: 0 });
  /**
   * The completion moment fires **once per file**. A celebration that re-fired on every refresh
   * of an already-complete deck would be the childish version of it.
   */
  celebrated = $state(false);

  /**
   * Ask for the file's progress.
   *
   * `progress:get` is `status: 'none'` with `total: 0` until the objective tree has been derived
   * from the slides, **and asking is what starts that ingest** — so this is called on open, and
   * the bar draws its own "Ellie is still reading the deck…" line rather than nothing.
   */
  async load(fileId: string): Promise<void> {
    if (this.fileId !== fileId) {
      this.view = null;
      this.moved = { ids: [], token: 0 };
      this.celebrated = false;
      this.open = false;
    }
    this.fileId = fileId;
    this.busy = true;
    const view = await bridge()
      .progressGet({ fileId })
      .catch(() => null);
    this.busy = false;
    if (!view || this.fileId !== fileId) return;
    this.#take(view);
  }

  close(): void {
    this.fileId = null;
    this.view = null;
    this.open = false;
    this.starting = null;
    this.moved = { ids: [], token: 0 };
    this.celebrated = false;
  }

  /**
   * **Start** on a lesson card (§6).
   *
   * Three things happen and only the first is this store's: Ellie posts her intro in the doc
   * chat. The other two — scrolling the document, and focusing the chat — are returned to the
   * caller, because where the document goes is T4's and which tab is on screen is the chat's.
   */
  async start(objectiveId: string): Promise<{ threadId: string; blockId: string | null } | null> {
    const fileId = this.fileId;
    if (!fileId) return null;
    this.starting = objectiveId;
    const result = await bridge()
      .progressStart({ fileId, objectiveId })
      .catch(() => null);
    this.starting = null;
    if (!result) return null;
    this.open = false;
    // `blockId` is null for an objective with no refs, or before the notes doc exists. The
    // lesson still starts; there is simply nowhere to scroll to.
    return { threadId: result.threadId, blockId: result.blockId };
  }

  toggle(): void {
    this.open = !this.open;
  }

  apply(e: RoomEvent): void {
    if (e.type === 'progress.updated') {
      if (this.fileId !== null && e.fileId !== this.fileId) return;
      this.#take(e.progress);
      return;
    }
    /**
     * The objective tree landing is the other half of `progress:get`'s answer: the first call
     * returns `status: 'none'` and *starts* the ingest, and this event is the only word that it
     * finished. Without this the bar would stay on "still reading" until the learner's next turn.
     */
    if (e.type === 'objectives.tree' && this.fileId !== null && e.fileId === this.fileId) {
      void this.refresh();
    }
  }

  async refresh(): Promise<void> {
    const fileId = this.fileId;
    if (!fileId) return;
    const view = await bridge()
      .progressGet({ fileId })
      .catch(() => null);
    if (!view || this.fileId !== fileId) return;
    this.#take(view);
  }

  #take(next: ProgressView): void {
    const moved = movedObjectives(this.view, next);
    const wasComplete = isComplete(this.view);
    this.view = next;
    if (moved.length > 0) this.moved = { ids: moved, token: this.moved.token + 1 };
    if (!wasComplete && isComplete(next) && !this.celebrated) this.celebrated = true;
  }
}
