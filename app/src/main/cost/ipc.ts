/**
 * **The two cost channels the collab-doc shell needs** (#42 items B and D, on #48's layout).
 *
 * `cost:summary`, `cost:recent` and `cost:export` are registered in `main/ipc.ts` next to
 * everything else, and stay there. These two are new and live in their own module for the reason
 * the notes and doc modules do: `AppService.register()` is already 200 lines of channel wiring,
 * and a track that adds two channels should add one line to it, not ten.
 *
 * Both are **reads**. The ledger is written only by the client decorator — nothing a renderer
 * can say changes a number here — which is what makes a cost surface trustworthy in a way a
 * settable counter never is.
 */
import type { CostAnalyticsQuery, CostMessageQuery } from '../../shared/cost.js';
import { IPC } from '../../shared/ipc.js';
import type { SqlDatabase } from '../db/driver.js';
import { analytics, messageCosts, type AnalyticsDeps } from './analytics.js';

export interface CostIpcDeps {
  db: SqlDatabase;
  /** When this launch started, for the `session` figure and the `SESSION_WINDOW` sentinel. */
  sessionStart: () => string;
  /** The same `handle` wrapper the rest of `AppService.register()` uses, logging and all. */
  handle: <T>(channel: string, fn: (payload: T) => unknown) => void;
}

export function registerCostIpc(deps: CostIpcDeps): void {
  const at = (): AnalyticsDeps => ({ db: deps.db, sessionStart: deps.sessionStart() });

  /**
   * **`cost:messages`** — what each reply in a room cost, by the `turn_id` join (migration 021).
   *
   * Room-scoped rather than message-scoped: a chat column has twenty cards on screen and twenty
   * round trips to draw twenty meters would put the ledger in front of the conversation. One
   * call answers the whole column, and `cost.updated` keeps it current after that — the event
   * already carries the call's `turnId`, so a renderer holding this map knows which row to
   * refresh without any change to the event's shape.
   */
  deps.handle<CostMessageQuery>(IPC.costMessages, (input) => messageCosts(at(), input));

  /** **`cost:analytics`** — every panel of the Usage page, aggregated in SQLite. */
  deps.handle<CostAnalyticsQuery | undefined>(IPC.costAnalytics, (input) => analytics(at(), input ?? {}));
}
