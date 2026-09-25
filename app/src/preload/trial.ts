/**
 * `window.chattered.trial` — the experimental trial's slice of the preload allowlist
 * (`shared/trial.ts`). Fixed channels only, like everything else in `preload/index.ts`.
 */
import { ipcRenderer } from 'electron';
import { TRIAL_IPC, type ExportProgress, type TrialApi } from '../shared/trial.js';

export const trialApi: TrialApi = {
  status: () => ipcRenderer.invoke(TRIAL_IPC.status),
  accept: (input) => ipcRenderer.invoke(TRIAL_IPC.accept, input),
  quit: () => ipcRenderer.invoke(TRIAL_IPC.quit),
  summary: () => ipcRenderer.invoke(TRIAL_IPC.summary),
  exportData: () => ipcRenderer.invoke(TRIAL_IPC.exportData),
  reveal: () => ipcRenderer.invoke(TRIAL_IPC.reveal),
  email: () => ipcRenderer.invoke(TRIAL_IPC.email),
  onExportProgress: (listener) => {
    const handler = (_event: unknown, payload: ExportProgress) => listener(payload);
    ipcRenderer.on(TRIAL_IPC.exportProgress, handler);
    return () => {
      ipcRenderer.removeListener(TRIAL_IPC.exportProgress, handler);
    };
  },
};
