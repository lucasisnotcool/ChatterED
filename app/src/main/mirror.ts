/**
 * The Firestore mirror — INTERFACE ONLY for M0/M1.
 *
 * architecture-mac.md §D.2 is explicit that Firestore is a write-mostly research sink and a
 * sync channel, never the hot path: the outbox table already exists and is already written to
 * on every message, so turning the mirror on later is implementing `flush()` and nothing else.
 *
 * Nothing here talks to the network. The stub drains nothing and says so, which keeps the
 * "what is real vs stubbed" answer in app/docs/STATUS.md honest.
 */
import type { Mirror, Store } from '../room/ports.js';

export function createStubMirror(store: Store): Mirror {
  return {
    enabled: false,
    async flush() {
      // Deliberately a no-op: rows accumulate in `outbox` with sent_at NULL, exactly as a
      // long offline stretch would leave them, so the real drain can be written against real
      // data. The consent gate and the operational-minimum filter (evaluation-plan.md §7.4)
      // belong here too, and are also not built yet.
      const pending = store.outbox.pending(1);
      return { docs: 0, failures: pending.length > 0 ? 0 : 0 };
    },
  };
}
