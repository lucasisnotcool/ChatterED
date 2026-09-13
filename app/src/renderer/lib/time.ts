/**
 * Time helpers. The renderer never owns a deadline — it only measures the
 * distance between the main process's clock and its own (product-design.md §C4).
 */
import type { TimerView } from '../../shared/types.js';

export function ts(iso: string | null): number {
  if (!iso) return 0;
  const n = Date.parse(iso);
  return Number.isNaN(n) ? 0 : n;
}

export function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/**
 * The main process's clock, projected forward to `localNow`.
 * `receivedAt` is the local time at which the TimerView arrived.
 */
export function serverNow(timer: TimerView, localNow: number, receivedAt: number): number {
  return ts(timer.now) + (localNow - receivedAt);
}

export interface TimerReading {
  /** 0 → 1 across the silence window. */
  progress: number;
  remainingMs: number;
  active: boolean;
}

export function readTimer(
  timer: TimerView | null,
  localNow: number,
  receivedAt: number,
): TimerReading {
  if (!timer || !timer.deadlineTs || timer.paused || timer.nudgesDone) {
    return { progress: 0, remainingMs: 0, active: false };
  }
  const span = timer.silenceMs > 0 ? timer.silenceMs : 45000;
  const remaining = ts(timer.deadlineTs) - serverNow(timer, localNow, receivedAt);
  return {
    progress: clamp(1 - remaining / span, 0, 1),
    remainingMs: Math.max(0, remaining),
    active: remaining > 0,
  };
}

/** `4:12` — elapsed wall time, for the status bar. */
export function elapsed(sinceIso: string, localNow: number): string {
  const secs = Math.max(0, Math.floor((localNow - ts(sinceIso)) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** `1 m 52 s`, for the recap's unaided line. */
export function minsSecs(ms: number): string {
  const secs = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m} m ${s} s` : `${s} s`;
}

export function relative(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - ts(iso);
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  return `${Math.round(days / 7)} weeks ago`;
}

export function clockTime(iso: string): string {
  const d = new Date(ts(iso));
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
