/**
 * **The study build, renderer side**: whether this is one, the unlock, and the credit left
 * (`shared/study.ts`).
 *
 * Its own store, like the trial's, because the main store never needs to know a study exists: an
 * ordinary build answers `available: false` and every study surface stays hidden.
 */
import { bridge } from './bridge.js';
import { LOW_CREDIT_FRACTION, NO_STUDY, type StudyStatus } from '../../shared/study.js';

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

class StudyStore {
  status: StudyStatus = $state({ ...NO_STUDY });
  loaded = $state(false);
  unlocking = $state(false);
  unlockError: string | null = $state(null);
  /** The "credit used up" sheet, once dismissed, stays closed until the next launch. */
  usedUpDismissed = $state(false);

  #wired = false;

  /** A study build whose code has not been entered yet. */
  get needsCode(): boolean {
    return this.status.available && !this.status.unlocked;
  }

  /** The bar is worth showing: a code was entered and the study key is still the one in use. */
  get showCredit(): boolean {
    return this.status.unlocked && this.status.active;
  }

  get low(): boolean {
    return this.showCredit && !this.status.exhausted && this.status.fraction >= LOW_CREDIT_FRACTION;
  }

  get usedUpOpen(): boolean {
    return this.showCredit && this.status.exhausted && !this.usedUpDismissed;
  }

  async load(): Promise<void> {
    this.#wire();
    try {
      this.status = await bridge().study.status();
    } catch {
      // A failed read leaves the ordinary-build answer, which hides every study surface.
      this.status = { ...NO_STUDY };
    }
    this.loaded = true;
  }

  async unlock(code: string): Promise<boolean> {
    if (this.unlocking) return false;
    this.unlocking = true;
    this.unlockError = null;
    try {
      const outcome = await bridge().study.unlock({ code });
      if (outcome.ok) {
        this.status = outcome.status;
        this.usedUpDismissed = false;
        return true;
      }
      this.unlockError = outcome.error;
      return false;
    } catch (err) {
      this.unlockError = message(err);
      return false;
    } finally {
      this.unlocking = false;
    }
  }

  #wire(): void {
    if (this.#wired) return;
    this.#wired = true;
    bridge().study.onChanged((status) => {
      this.status = status;
    });
  }
}

export const study = new StudyStore();
