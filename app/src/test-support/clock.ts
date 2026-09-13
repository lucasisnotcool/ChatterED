import type { Clock } from '../room/ports.js';

/** A fake clock: nothing in the timer tests waits on real time. */
export class FakeClock implements Clock {
  #now: number;
  #intervals: { ms: number; fn: () => void; next: number }[] = [];
  #timeouts: { at: number; fn: () => void }[] = [];

  constructor(start = Date.parse('2026-09-13T10:00:00.000Z')) {
    this.#now = start;
  }

  now(): number {
    return this.#now;
  }

  setInterval(fn: () => void, ms: number): () => void {
    const entry = { ms, fn, next: this.#now + ms };
    this.#intervals.push(entry);
    return () => {
      this.#intervals = this.#intervals.filter((i) => i !== entry);
    };
  }

  setTimeout(fn: () => void, ms: number): () => void {
    const entry = { at: this.#now + ms, fn };
    this.#timeouts.push(entry);
    return () => {
      this.#timeouts = this.#timeouts.filter((t) => t !== entry);
    };
  }

  /** Advance time, running every interval tick and timeout in order, as the real clock would. */
  advance(ms: number): void {
    const target = this.#now + ms;
    for (;;) {
      const nextInterval = this.#intervals.reduce<number | null>(
        (acc, i) => (acc === null || i.next < acc ? i.next : acc),
        null,
      );
      const nextTimeout = this.#timeouts.reduce<number | null>((acc, t) => (acc === null || t.at < acc ? t.at : acc), null);
      const next = [nextInterval, nextTimeout].filter((n): n is number => n !== null).sort((a, b) => a - b)[0];
      if (next === undefined || next > target) break;
      this.#now = next;
      for (const i of [...this.#intervals]) {
        if (i.next <= this.#now) {
          i.next = this.#now + i.ms;
          i.fn();
        }
      }
      for (const t of [...this.#timeouts]) {
        if (t.at <= this.#now) {
          this.#timeouts = this.#timeouts.filter((x) => x !== t);
          t.fn();
        }
      }
    }
    this.#now = target;
  }

  /**
   * Advance time the way an async test needs it: in small steps, yielding to the real event
   * loop between them so awaited promises (the latency hold, the model call) can settle.
   */
  async run(ms: number, stepMs = 250): Promise<void> {
    let left = ms;
    while (left > 0) {
      const step = Math.min(stepMs, left);
      this.advance(step);
      left -= step;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  /** Simulate sleep / quit: time moves but no tick runs. */
  sleep(ms: number): void {
    this.#now += ms;
    for (const i of this.#intervals) i.next = this.#now + i.ms;
  }
}
