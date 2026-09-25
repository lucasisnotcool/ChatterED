/**
 * The trial's consent gate: nothing is agreed to until the current notice is, a notice bump asks
 * again, the participant id survives the re-prompt, and main refuses every other channel meanwhile.
 */
import { describe, expect, it } from 'vitest';
import { openTestDb } from '../../test-support/db.js';
import {
  CONSENT_VERSION,
  PARTICIPANT_ID_PATTERN,
  TRIAL_IPC,
  TRIAL_SETTINGS,
  consentNeeded,
  exportBaseName,
  noticeAsText,
  parseConsentVersion,
  participantIdFrom,
  researchMailto,
  TRIAL_CONTACT_EMAIL,
} from '../../shared/trial.js';
import { ConsentRequiredError, ConsentVersionError, acceptConsent, consentGate, readTrialStatus } from './consent.js';

const NOW = '2026-09-25T08:00:00.000Z';
const uuid = () => '1a2b3c4d-0000-4000-8000-000000000000';

describe('consent state', () => {
  it('asks a fresh install, and stops asking once the current notice is agreed to', () => {
    const { store } = openTestDb();
    const before = readTrialStatus(store.settings);
    expect(before.needsConsent).toBe(true);
    expect(before.participantId).toBeNull();
    expect(before.consentedAt).toBeNull();

    const after = acceptConsent(store.settings, { version: CONSENT_VERSION, now: NOW, uuid });
    expect(after.needsConsent).toBe(false);
    expect(after.consentedVersion).toBe(CONSENT_VERSION);
    expect(after.consentedAt).toBe(NOW);
    expect(after.participantId).toBe('P-1a2b3c4d');
    expect(after.contactEmail).toBe(TRIAL_CONTACT_EMAIL);
    // Persisted, not just returned.
    expect(readTrialStatus(store.settings).needsConsent).toBe(false);
  });

  it('asks again when CONSENT_VERSION is bumped, and keeps the same participant id', () => {
    const { store } = openTestDb();
    acceptConsent(store.settings, { version: 1, now: NOW, uuid }, 1);
    expect(readTrialStatus(store.settings, 1).needsConsent).toBe(false);

    const bumped = readTrialStatus(store.settings, 2);
    expect(bumped.needsConsent).toBe(true);
    expect(bumped.consentedVersion).toBe(1);
    expect(bumped.participantId).toBe('P-1a2b3c4d');

    const renewed = acceptConsent(
      store.settings,
      { version: 2, now: '2026-10-01T00:00:00.000Z', uuid: () => 'ffffffff-0000-4000-8000-000000000000' },
      2,
    );
    expect(renewed.needsConsent).toBe(false);
    expect(renewed.participantId).toBe('P-1a2b3c4d');
    expect(renewed.consentedAt).toBe('2026-10-01T00:00:00.000Z');
  });

  it('refuses agreement to a notice version other than the one this build shows', () => {
    const { store } = openTestDb();
    expect(() => acceptConsent(store.settings, { version: CONSENT_VERSION + 1, now: NOW, uuid })).toThrow(
      ConsentVersionError,
    );
    expect(() => acceptConsent(store.settings, { version: Number.NaN, now: NOW, uuid })).toThrow(ConsentVersionError);
    expect(readTrialStatus(store.settings).needsConsent).toBe(true);
  });

  it('reads a garbled stored version as never agreed', () => {
    const { store } = openTestDb();
    store.settings.set(TRIAL_SETTINGS.consentVersion, 'yes', NOW);
    expect(readTrialStatus(store.settings).needsConsent).toBe(true);
    expect(parseConsentVersion('')).toBeNull();
    expect(parseConsentVersion('0')).toBeNull();
    expect(parseConsentVersion('3')).toBe(3);
    expect(consentNeeded(null)).toBe(true);
    expect(consentNeeded(1, 1)).toBe(false);
    expect(consentNeeded(1, 2)).toBe(true);
    expect(consentNeeded(3, 2)).toBe(false);
  });

  it('mints participant ids in the documented shape', () => {
    const id = participantIdFrom('0F1E2D3C-4B5A-4000-8000-000000000000');
    expect(id).toBe('P-0f1e2d3c');
    expect(PARTICIPANT_ID_PATTERN.test(id)).toBe(true);
    expect(PARTICIPANT_ID_PATTERN.test(participantIdFrom(crypto.randomUUID()))).toBe(true);
  });
});

describe('the main-process gate', () => {
  it('refuses everything but the trial channels until consent, then opens', () => {
    const { store } = openTestDb();
    const gate = consentGate(store.settings);
    expect(gate.allows(TRIAL_IPC.status)).toBe(true);
    expect(gate.allows(TRIAL_IPC.accept)).toBe(true);
    expect(gate.allows(TRIAL_IPC.quit)).toBe(true);
    for (const channel of ['room:open', 'room:send', 'notes:ingest', 'app:bootstrap', TRIAL_IPC.exportData]) {
      expect(gate.allows(channel)).toBe(false);
      expect(() => gate.assert(channel)).toThrow(ConsentRequiredError);
    }
    acceptConsent(store.settings, { version: CONSENT_VERSION, now: NOW, uuid });
    expect(gate.allows('room:open')).toBe(true);
    expect(gate.allows(TRIAL_IPC.exportData)).toBe(true);
  });

  it('closes again on a notice bump', () => {
    const { store } = openTestDb();
    acceptConsent(store.settings, { version: 1, now: NOW, uuid }, 1);
    expect(consentGate(store.settings, 1).allows('room:open')).toBe(true);
    expect(consentGate(store.settings, 2).allows('room:open')).toBe(false);
  });
});

describe('the notice and the mailto', () => {
  it('names the contact, the version and what is not shared', () => {
    const text = noticeAsText();
    expect(text).toContain(TRIAL_CONTACT_EMAIL);
    expect(text).toContain(`Notice version ${CONSENT_VERSION}`);
    expect(text).toMatch(/lecture PDFs/);
    expect(text).toMatch(/Library\/Application Support\/ChatterED/);
    expect(text).toMatch(/OpenAI/);
  });

  it('builds a mailto to the team with the participant id and nothing else of the learner', () => {
    const url = researchMailto('P-1a2b3c4d', 'ChatterED-research-P-1a2b3c4d-20260925.zip');
    expect(url.startsWith(`mailto:${TRIAL_CONTACT_EMAIL}?subject=`)).toBe(true);
    const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
    expect(params.get('subject')).toBe('ChatterED research data — P-1a2b3c4d');
    expect(params.get('body')).toContain('attach');
    expect(params.get('body')).toContain('ChatterED-research-P-1a2b3c4d-20260925.zip');
  });

  it('names the export by participant and local date', () => {
    expect(exportBaseName('P-1a2b3c4d', new Date(2026, 8, 5, 23, 59))).toBe('ChatterED-research-P-1a2b3c4d-20260905');
  });
});
