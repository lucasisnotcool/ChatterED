/**
 * **Trial consent, as the main process holds it.**
 *
 * Three rows in `settings` (`TRIAL_SETTINGS`): the notice version agreed to, when, and the random
 * participant id. The id is minted on the first agreement and survives a re-prompt — a notice
 * bump asks the same participant again; it does not make a new one.
 *
 * The gate is enforced here as well as in the renderer: until the current notice is agreed to,
 * every IPC channel except `PRE_CONSENT_CHANNELS` is refused, so nothing can open a room, start
 * an ingest or reach a model on the learner's behalf before they have said yes.
 */
import {
  CONSENT_VERSION,
  PRE_CONSENT_CHANNELS,
  TRIAL_CONTACT_EMAIL,
  TRIAL_SETTINGS,
  consentNeeded,
  parseConsentVersion,
  participantIdFrom,
  PARTICIPANT_ID_PATTERN,
  type TrialStatus,
} from '../../shared/trial.js';

/** The slice of `SettingsRepo` this needs — structural, so a test can hand in a Map. */
export interface ConsentSettings {
  get(key: string): string | undefined;
  set(key: string, value: string, now: string): void;
}

export function readTrialStatus(settings: ConsentSettings, current = CONSENT_VERSION): TrialStatus {
  const consentedVersion = parseConsentVersion(settings.get(TRIAL_SETTINGS.consentVersion));
  const rawId = settings.get(TRIAL_SETTINGS.participantId) ?? '';
  return {
    consentVersion: current,
    consentedVersion,
    needsConsent: consentNeeded(consentedVersion, current),
    participantId: PARTICIPANT_ID_PATTERN.test(rawId) ? rawId : null,
    consentedAt: consentedVersion === null ? null : (settings.get(TRIAL_SETTINGS.consentedAt) ?? null),
    contactEmail: TRIAL_CONTACT_EMAIL,
  };
}

export class ConsentVersionError extends Error {
  constructor(shown: number, current: number) {
    super(`The notice you agreed to (version ${shown}) is not the current one (version ${current}). Please read it again.`);
    this.name = 'ConsentVersionError';
  }
}

/**
 * Record agreement to `version`. It must be the version this build shows: a renderer holding an
 * older notice cannot agree to a newer one on the learner's behalf.
 */
export function acceptConsent(
  settings: ConsentSettings,
  input: { version: number; now: string; uuid: () => string },
  current = CONSENT_VERSION,
): TrialStatus {
  if (input.version !== current) throw new ConsentVersionError(input.version, current);
  const existing = settings.get(TRIAL_SETTINGS.participantId) ?? '';
  if (!PARTICIPANT_ID_PATTERN.test(existing)) {
    settings.set(TRIAL_SETTINGS.participantId, participantIdFrom(input.uuid()), input.now);
  }
  settings.set(TRIAL_SETTINGS.consentedAt, input.now, input.now);
  settings.set(TRIAL_SETTINGS.consentVersion, String(current), input.now);
  return readTrialStatus(settings, current);
}

export class ConsentRequiredError extends Error {
  constructor(channel: string) {
    super(`ChatterED needs you to agree to the trial notice before it can do that (${channel}).`);
    this.name = 'ConsentRequiredError';
  }
}

/** One line in `AppService.register()`'s `handle` wrapper. Reads the row each call: it is a PK lookup. */
export function consentGate(settings: ConsentSettings, current = CONSENT_VERSION) {
  const open = new Set(PRE_CONSENT_CHANNELS);
  return {
    allows(channel: string): boolean {
      if (open.has(channel)) return true;
      return !consentNeeded(parseConsentVersion(settings.get(TRIAL_SETTINGS.consentVersion)), current);
    },
    assert(channel: string): void {
      if (!this.allows(channel)) throw new ConsentRequiredError(channel);
    },
  };
}
