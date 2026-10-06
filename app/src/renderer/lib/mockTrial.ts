/**
 * `trial` for the dev mock (`mockBridge.ts`): consent is asked on every page load, so the gate
 * is always exercisable under `vite dev`, and the export pretends to run.
 */
import {
  CONSENT_VERSION,
  TRIAL_CONTACT_EMAIL,
  type ExportProgress,
  type TrialApi,
  type TrialStatus,
} from '../../shared/trial.js';

export function createMockTrial(): TrialApi {
  let status: TrialStatus = {
    consentVersion: CONSENT_VERSION,
    consentedVersion: null,
    needsConsent: true,
    participantId: null,
    consentedAt: null,
    contactEmail: TRIAL_CONTACT_EMAIL,
  };
  const listeners = new Set<(p: ExportProgress) => void>();
  const push = (p: ExportProgress) => listeners.forEach((l) => l(p));
  return {
    async status() {
      return { ...status };
    },
    async accept({ version }) {
      status = {
        ...status,
        consentedVersion: version,
        needsConsent: false,
        participantId: status.participantId ?? 'P-0000beef',
        consentedAt: new Date().toISOString(),
      };
      return { ...status };
    },
    async quit() {},
    async summary() {
      return {
        rooms: 3,
        messages: 42,
        privateTurns: 6,
        notesDocs: 2,
        explainComments: 14,
        objectiveStates: 9,
        usageRows: 57,
        events: 120,
        excludedNotebooks: 1,
        databaseBytes: 2_400_000,
        logBytes: 180_000,
        logFiles: 1,
      };
    },
    async exportData() {
      for (const step of ['snapshot', 'anonymise', 'readable', 'logs', 'manifest', 'zip'] as const) {
        push({ step, label: `${step}…` });
        await new Promise((r) => setTimeout(r, 150));
      }
      push({ step: 'done', label: 'Done.' });
      const fileName = 'ChatterED-research-P-0000beef-20260925.zip';
      return { ok: true, path: `~/Desktop/${fileName}`, fileName, bytes: 812_000, participantId: 'P-0000beef' };
    },
    async reveal() {},
    async email() {},
    onExportProgress(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
