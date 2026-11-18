/**
 * `window.chattered.debug`: the debug report panel's slice of the preload allowlist
 * (`shared/debug.ts`). Fixed channels only, like everything else in `preload/index.ts`.
 */
import { ipcRenderer } from 'electron';
import { DEBUG_IPC, type DebugApi, type DebugShow } from '../shared/debug.js';

export const debugApi: DebugApi = {
  onShow: (listener) => {
    const handler = (_event: unknown, payload: DebugShow) => listener(payload);
    ipcRenderer.on(DEBUG_IPC.show, handler);
    return () => {
      ipcRenderer.removeListener(DEBUG_IPC.show, handler);
    };
  },
  shown: (token) => ipcRenderer.invoke(DEBUG_IPC.shown, token),
  copy: () => ipcRenderer.invoke(DEBUG_IPC.copy),
};
