/**
 * `window.chattered.study` — the study build's slice of the preload allowlist (`shared/study.ts`).
 * Fixed channels only, like everything else in `preload/index.ts`.
 */
import { ipcRenderer } from 'electron';
import { STUDY_IPC, type StudyApi, type StudyStatus } from '../shared/study.js';

export const studyApi: StudyApi = {
  status: () => ipcRenderer.invoke(STUDY_IPC.status),
  unlock: (input) => ipcRenderer.invoke(STUDY_IPC.unlock, input),
  onChanged: (listener) => {
    const handler = (_event: unknown, payload: StudyStatus) => listener(payload);
    ipcRenderer.on(STUDY_IPC.changed, handler);
    return () => {
      ipcRenderer.removeListener(STUDY_IPC.changed, handler);
    };
  },
};
