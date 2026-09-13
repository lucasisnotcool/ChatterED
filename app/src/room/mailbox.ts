/**
 * The room's mailbox: one writer per room, guaranteed by arithmetic rather than by a
 * deployment flag (architecture-mac.md §B.1, requirement R1).
 *
 * Every state mutation for a room goes through `enqueue`, which chains onto a promise, so two
 * IPC calls arriving in the same tick cannot interleave a read-modify-write. Long waits — the
 * latency hold, the model call — deliberately run OUTSIDE the mailbox, because the floor
 * belongs to the learner: a student message must be able to arrive (and cancel a held reply)
 * while an agent turn is in flight (product-design.md §C3, turn rule 6).
 */
export class Mailbox {
  #tail: Promise<unknown> = Promise.resolve();
  #depth = 0;

  get depth(): number {
    return this.#depth;
  }

  enqueue<T>(task: () => T | Promise<T>): Promise<T> {
    this.#depth += 1;
    const run = this.#tail.then(task, task);
    // Keep the chain alive even when a task rejects; the caller still sees the rejection.
    this.#tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run.finally(() => {
      this.#depth -= 1;
    }) as Promise<T>;
  }

  /** Resolves when everything currently queued has settled. Used by tests and by shutdown. */
  async drain(): Promise<void> {
    await this.#tail;
  }
}
