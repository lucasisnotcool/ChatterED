/**
 * **The experimental trial, renderer side**: the consent gate, the notice, and the export.
 *
 * Its own store beside `store.svelte.ts` so the gate can sit in front of *everything* — the main
 * store is not even initialised until consent is given (`App.svelte`), and it never has to know
 * the trial exists. The copy it shows is in `shared/trial.ts`.
 */
import { bridge } from './bridge.js';
import type { ExportOutcome, ExportProgress, ExportSummary, TrialStatus } from '../../shared/trial.js';

export type TrialGate = 'loading' | 'consent' | 'open' | 'error';

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

class TrialStore {
  status: TrialStatus | null = $state(null);
  loadError: string | null = $state(null);
  accepting = $state(false);
  /** The "Experimental trial" notice, re-opened from the title bar or Settings. */
  noticeOpen = $state(false);

  summary: ExportSummary | null = $state(null);
  exporting = $state(false);
  progress: ExportProgress | null = $state(null);
  /** The last finished export, for the result dialog. */
  result: Extract<ExportOutcome, { ok: true }> | null = $state(null);
  exportError: string | null = $state(null);

  #opened: Promise<void>;
  #resolveOpened!: () => void;
  #wired = false;

  constructor() {
    this.#opened = new Promise((resolve) => (this.#resolveOpened = resolve));
  }

  get gate(): TrialGate {
    if (this.loadError) return 'error';
    if (!this.status) return 'loading';
    return this.status.needsConsent ? 'consent' : 'open';
  }

  /** Resolves once the current notice has been agreed to — at once, for an install that has. */
  whenOpen(): Promise<void> {
    void this.load();
    return this.#opened;
  }

  async load(): Promise<void> {
    this.#wire();
    try {
      this.loadError = null;
      this.status = await bridge().trial.status();
      if (!this.status.needsConsent) this.#resolveOpened();
    } catch (err) {
      this.loadError = message(err);
    }
  }

  async accept(): Promise<void> {
    if (!this.status || this.accepting) return;
    this.accepting = true;
    try {
      this.status = await bridge().trial.accept({ version: this.status.consentVersion });
      if (!this.status.needsConsent) this.#resolveOpened();
    } catch (err) {
      this.loadError = message(err);
    } finally {
      this.accepting = false;
    }
  }

  async quit(): Promise<void> {
    await bridge().trial.quit();
  }

  async loadSummary(): Promise<void> {
    try {
      this.summary = await bridge().trial.summary();
    } catch {
      this.summary = null;
    }
  }

  async exportData(): Promise<void> {
    if (this.exporting || this.gate !== 'open') return;
    this.exporting = true;
    this.exportError = null;
    this.progress = null;
    try {
      const outcome = await bridge().trial.exportData();
      if (outcome.ok) this.result = outcome;
      else if (!outcome.canceled) this.exportError = outcome.error;
    } catch (err) {
      this.exportError = message(err);
    } finally {
      this.exporting = false;
      this.progress = null;
    }
  }

  reveal(): void {
    void bridge().trial.reveal();
  }

  email(): void {
    void bridge().trial.email();
  }

  /** Once: the export's progress pushes, and File ▸ Export Research Data… from the menu. */
  #wire(): void {
    if (this.#wired) return;
    this.#wired = true;
    bridge().trial.onExportProgress((p) => {
      this.progress = p;
    });
    bridge().onAppCommand((command) => {
      if (command === 'research.export') void this.exportData();
    });
  }
}

export const trial = new TrialStore();
