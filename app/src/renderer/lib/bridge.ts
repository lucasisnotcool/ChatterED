/// <reference types="vite/client" />
/**
 * The renderer's only door to the main process. Everything the UI can do is in
 * ChatterEdApi (shared/ipc.ts); nothing else is reachable from here.
 *
 * When `window.chattered` is absent under `vite dev` without Electron, we fall back to the
 * scripted mock so the UI is still exercisable. See mockBridge.ts.
 *
 * **Never in a production build** (release review P1-5). There, a missing bridge means the
 * preload failed, and a UI running on the mock would look real while every answer the learner
 * typed went nowhere. So production throws `BridgeMissingError`, `main.ts` draws a fatal screen
 * instead of the app, and — because the mock is only reachable behind `import.meta.env.DEV`,
 * which Vite replaces with `false` — the mock and its fixtures are not in the production bundle.
 */
import type { ChatterEdApi } from '../../shared/ipc.js';

export class BridgeMissingError extends Error {
  constructor() {
    super('ChatterED: the preload bridge is missing');
    this.name = 'BridgeMissingError';
  }
}

function injected(): ChatterEdApi | undefined {
  return (globalThis as { chattered?: ChatterEdApi }).chattered;
}

let cached: ChatterEdApi | null = null;

/**
 * Dev only: loads the mock. A dynamic import inside a `DEV` branch is what lets the bundler drop
 * the module (and mockNotes.ts, mockTrial.ts behind it) from a production build entirely.
 */
export async function prepareBridge(): Promise<void> {
  if (cached || injected()) return;
  if (import.meta.env.DEV) {
    const { createMockBridge } = await import('./mockBridge.js');
    cached = createMockBridge();
  }
}

/** True when the real bridge is here, or (dev only) the mock has been prepared. */
export function bridgeAvailable(): boolean {
  return cached !== null || injected() !== undefined;
}

export function bridge(): ChatterEdApi {
  if (cached) return cached;
  const real = injected();
  if (real) {
    cached = real;
    return real;
  }
  throw new BridgeMissingError();
}

/** True when we are running against the dev mock rather than the real main process. */
export const usingMock = (): boolean => injected() === undefined;
