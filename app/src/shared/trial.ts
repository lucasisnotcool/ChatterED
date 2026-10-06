/**
 * **The experimental trial: its consent notice, and the contract for the research export.**
 *
 * The public build of ChatterED is an experimental trial. Using it means agreeing to share
 * anonymised usage data with the research team — by hand: nothing leaves the Mac on its own. The
 * learner exports a zip (File ▸ Export Research Data…, or Settings ▸ Research trial) and emails
 * it to `TRIAL_CONTACT_EMAIL`.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WORDING: THE NOTICE BELOW IS LUCAS'S TO FINALISE with the prof and the TAs (compliance, ethics
 * and PDPA are handled there, per CLAUDE.md). It is plain-language placeholder copy written to
 * describe what the code actually does. It lives in this one module so it can be edited in one
 * place: the consent screen, the "Experimental trial" notice, the export's README.txt and
 * consent-notice.txt all read it from here.
 *
 * **Bump `CONSENT_VERSION` after any material change** — every install is then asked again,
 * before anything else on its next launch (`consentNeeded`).
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Shared by main, preload and renderer, so it imports nothing.
 */

/** Where exports are sent, and where deletion requests go. */
export const TRIAL_CONTACT_EMAIL = 'lucasloh@u.nus.edu';

/** The version of the notice below. An install that agreed to an older one is asked again. */
export const CONSENT_VERSION = 1;

/** The three settings rows consent is kept in (the `settings` table, SettingsRepo). */
export const TRIAL_SETTINGS = {
  consentVersion: 'trial_consent_version',
  consentedAt: 'trial_consent_at',
  participantId: 'trial_participant_id',
} as const;

export interface NoticeSection {
  heading: string;
  /** Paragraphs, in order. */
  paragraphs?: string[];
  /** A bulleted list, drawn after the paragraphs. */
  bullets?: string[];
}

export const NOTICE_TITLE = 'ChatterED is an experimental trial';

export const NOTICE_INTRO =
  'ChatterED is a research prototype from a CS3249 project at the National University of Singapore (NUS). ' +
  'This build is released as an experimental trial. By using it, you agree to share your anonymised usage ' +
  'data with the research team, so we can study how people learn with it.';

export const NOTICE_SECTIONS: readonly NoticeSection[] = [
  {
    heading: 'What is shared',
    paragraphs: ['Everything you do inside ChatterED:'],
    bullets: [
      'everything you type — questions, answers, chat messages, and your own writing in the notes;',
      'the AI’s replies, and the lecture notes it writes for you;',
      'your progress — objectives, quiz questions and how they went;',
      'usage and cost — which model answered, token counts and timings;',
      'the app’s event log and diagnostic logs, and your settings (never API keys).',
    ],
  },
  {
    heading: 'What is not shared',
    bullets: [
      'your lecture PDFs, their text, and the slide images made from them (file names are kept);',
      'API keys or passwords;',
      'anything outside ChatterED — your other files, other apps, your browsing.',
    ],
  },
  {
    heading: 'Nothing is sent automatically',
    paragraphs: [
      'ChatterED has no server and never uploads your trial data. To take part, you export it yourself: ' +
        'File ▸ Export Research Data… (or Settings ▸ Research trial) saves one .zip file, and you email that ' +
        `file to ${TRIAL_CONTACT_EMAIL}.`,
    ],
  },
  {
    heading: 'How the export is anonymised',
    paragraphs: [
      'Your Mac’s username and folder paths are removed, and you are identified only by a random participant ' +
        'ID. What you type is included exactly as you typed it — so don’t type personal details (your name, ' +
        'student ID, contact details) that you don’t want shared.',
      'The export is a .zip of readable files (JSON, CSV, plain text and a SQLite database). You can open it ' +
        'and look through it before you send it.',
    ],
  },
  {
    heading: 'Your AI provider sees what you send it',
    paragraphs: [
      'Separately from this trial, using ChatterED sends the lecture content and what you type to the AI ' +
        'provider you choose — Claude Code / Anthropic, OpenAI, Google Gemini, or a custom OpenAI-compatible ' +
        'endpoint — where it is processed under that provider’s terms. ChatterED itself has no server.',
    ],
  },
  {
    heading: 'Where your data lives',
    paragraphs: [
      'Only on this Mac, in ~/Library/Application Support/ChatterED and ~/Library/Logs/ChatterED. Deleting ' +
        'those two folders and the app removes all of it.',
    ],
  },
  {
    heading: 'Your choices',
    paragraphs: [
      'Taking part is voluntary. You can stop using the app at any time, and you never have to send an export. ' +
        `To have data you have already sent deleted, email ${TRIAL_CONTACT_EMAIL} with your participant ID.`,
    ],
  },
];

export const CONSENT_CHECKBOX = 'I have read this and agree to take part.';
export const CONSENT_AGREE = 'Agree and continue';
export const CONSENT_QUIT = 'Quit';

/** The notice as plain text — the export's `consent-notice.txt`, so the team knows what was agreed. */
export function noticeAsText(): string {
  const out: string[] = [NOTICE_TITLE, '', NOTICE_INTRO, ''];
  for (const s of NOTICE_SECTIONS) {
    out.push(s.heading, '-'.repeat(s.heading.length));
    for (const p of s.paragraphs ?? []) out.push(p, '');
    for (const b of s.bullets ?? []) out.push(`  - ${b}`);
    if (s.bullets?.length) out.push('');
  }
  out.push(`[${CONSENT_CHECKBOX}]`, `Notice version ${CONSENT_VERSION}.`);
  return `${out.join('\n')}\n`;
}

// ── Consent state ──────────────────────────────────────────────────────────────────────────

export interface TrialStatus {
  /** The notice version this build shows. */
  consentVersion: number;
  /** The version this install agreed to, or null if it never has. */
  consentedVersion: number | null;
  /** True until the current version has been agreed to: the app renders nothing else. */
  needsConsent: boolean;
  /** `P-xxxxxxxx`. Minted on first agreement and kept across notice versions. */
  participantId: string | null;
  /** ISO timestamp of the agreement to `consentedVersion`. */
  consentedAt: string | null;
  contactEmail: string;
}

/** A stored version string read defensively: missing or garbled is "never agreed". */
export function parseConsentVersion(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** The whole gate. An older agreement — or none — means the notice is shown again. */
export function consentNeeded(consentedVersion: number | null, current = CONSENT_VERSION): boolean {
  return consentedVersion === null || consentedVersion < current;
}

export const PARTICIPANT_ID_PATTERN = /^P-[0-9a-f]{8}$/;

/** `P-` and the first 8 hex digits of a random UUID: short enough to read out, random enough. */
export function participantIdFrom(uuid: string): string {
  const hex = uuid.replace(/[^0-9a-f]/gi, '').toLowerCase().slice(0, 8);
  if (hex.length < 8) throw new Error('participantIdFrom needs a UUID');
  return `P-${hex}`;
}

// ── The export ─────────────────────────────────────────────────────────────────────────────

/** `ChatterED-research-P-1a2b3c4d-20260925` — the zip's name and the folder inside it. */
export function exportBaseName(participantId: string, now: Date): string {
  const d = now;
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `ChatterED-research-${participantId}-${ymd}`;
}

/**
 * The **Email to the team** link. A `mailto:` cannot carry an attachment, so the body says to
 * attach the file. Built only from the participant id and the file name — nothing else reaches it.
 */
export function researchMailto(participantId: string, fileName: string | null): string {
  const subject = `ChatterED research data — ${participantId}`;
  const body = [
    'Hi,',
    '',
    `Here is my ChatterED research export. Participant ID: ${participantId}.`,
    '',
    fileName
      ? `Please remember to attach the file before sending: ${fileName}`
      : 'Please remember to attach the exported .zip file before sending.',
    '(Your email app cannot attach it automatically.)',
  ].join('\n');
  return `mailto:${TRIAL_CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** What Settings ▸ Research trial says the export will contain. Counts from the live database. */
export interface ExportSummary {
  rooms: number;
  messages: number;
  privateTurns: number;
  notesDocs: number;
  objectiveStates: number;
  usageRows: number;
  events: number;
  /** Notebooks left out by "Exclude from research data" (migration 032), their own or a folder's. */
  excludedNotebooks: number;
  databaseBytes: number;
  logBytes: number;
  logFiles: number;
}

export type ExportStep = 'snapshot' | 'anonymise' | 'readable' | 'logs' | 'manifest' | 'zip' | 'done';

export interface ExportProgress {
  step: ExportStep;
  label: string;
}

export type ExportOutcome =
  | { ok: true; path: string; fileName: string; bytes: number; participantId: string }
  | { ok: false; canceled: true }
  | { ok: false; canceled: false; error: string };

export const TRIAL_IPC = {
  status: 'trial:status',
  accept: 'trial:accept',
  quit: 'trial:quit',
  summary: 'trial:summary',
  exportData: 'trial:export',
  reveal: 'trial:reveal',
  email: 'trial:email',
  /** main → renderer: one push per export step. */
  exportProgress: 'trial:exportProgress',
} as const;

/**
 * The channels that answer **before** consent. Everything else the main process refuses until
 * the current notice has been agreed to (`src/main/research/consent.ts`), so a renderer that
 * somehow drew the app behind the gate still could not open a room or start an ingest.
 */
export const PRE_CONSENT_CHANNELS: readonly string[] = [
  TRIAL_IPC.status,
  TRIAL_IPC.accept,
  TRIAL_IPC.quit,
  'app:logRendererError',
];

/** `window.chattered.trial`. */
export interface TrialApi {
  status(): Promise<TrialStatus>;
  /** Records agreement to `version`, which must be the version this build shows. */
  accept(input: { version: number }): Promise<TrialStatus>;
  quit(): Promise<void>;
  summary(): Promise<ExportSummary>;
  /** Save dialog → snapshot → anonymise → zip. Progress arrives on `onExportProgress`. */
  exportData(): Promise<ExportOutcome>;
  /** Reveal the last export in Finder. */
  reveal(): Promise<void>;
  /** Open a `mailto:` to the team for the last export. */
  email(): Promise<void>;
  onExportProgress(listener: (progress: ExportProgress) => void): () => void;
}
