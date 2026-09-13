/**
 * The renderer's only door to the main process. Everything the UI can do is in
 * ChatterEdApi (shared/ipc.ts); nothing else is reachable from here.
 *
 * When `window.chattered` is absent — i.e. `vite dev` without Electron — we fall
 * back to the scripted mock so the UI is still exercisable. See mockBridge.ts.
 */
import type { ChatterEdApi } from '../../shared/ipc.js';
import { createMockBridge } from './mockBridge.js';

function injected(): ChatterEdApi | undefined {
  return (globalThis as { chattered?: ChatterEdApi }).chattered;
}

let cached: ChatterEdApi | null = null;

export function bridge(): ChatterEdApi {
  if (!cached) cached = injected() ?? createMockBridge();
  return cached;
}

/** True when we are running against the dev mock rather than the real main process. */
export const usingMock = (): boolean => injected() === undefined;
