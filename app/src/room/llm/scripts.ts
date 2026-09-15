/**
 * Which script `ScriptedClient` replays — `flow-build-plan.md` §4.4's last loose end.
 *
 * Two scripts ship. `script.psd-hessian.ts` is `design-brief.md` §G and is what `actor.test.ts`
 * runs on; `script.critique1.ts` is the A1 video path over the Critique 1 deck. Picking between
 * them is deliberately **not** a setting the presenter has to remember on recording day: a
 * session started from the fixture deck replays the fixture's script, and everything else falls
 * back to the original one. A settings override exists for the rehearsal case, and it wins.
 *
 * Kept as pure functions over a couple of strings so the choice is testable without a database,
 * an Electron window, or a file on disk.
 */
import type { LlmRequest } from './types.js';
import { CRITIQUE1_SCRIPT } from './script.critique1.js';
import { beatFor, referenceBeatFor, whisperBeatFor, type ScriptSource } from './script.psd-hessian.js';

export type ScriptName = 'psd-hessian' | 'critique1';

/** The default script: `design-brief.md` §G, the one `actor.test.ts` runs on. */
export const PSD_HESSIAN_SCRIPT: ScriptSource = {
  conceptId: 'psd-hessian-convexity-v1',
  beatFor,
  referenceBeatFor,
  whisperBeatFor,
};

export const SCRIPTS: Record<ScriptName, ScriptSource> = {
  'psd-hessian': PSD_HESSIAN_SCRIPT,
  critique1: CRITIQUE1_SCRIPT,
};

/**
 * How the fixture deck is recognised.
 *
 * `fileName` is the cheap, obvious signal and catches a copy in any folder. `contentShas` is the
 * honest one: `docs/SEGMENTS.md` keys the segment cache on the file's own bytes, and this is the
 * same digest — `shasum -a 256` over the committed PDF. A renamed copy still matches on it.
 *
 * Note which hash this is **not**: `materials.file_sha256` is a digest of the *extracted text*
 * (`main/sessions.ts`), which depends on the extractor and is therefore not pinned here. Pass
 * whichever you have; both are checked against the same set.
 */
export const CRITIQUE1_FIXTURE = {
  /** `A0282987E_LohZhengLucas_Critique1_slides (1).pdf`, and any copy of it. */
  fileNamePattern: /critique1[_\s-]*slides/i,
  contentShas: new Set(['ac803b62d7b4d76926eaa1f5c80341a17729ea687a064278a8051a925005ea33']),
  /**
   * Last resort: a phrase that appears in the deck's own extracted text and in nothing else in
   * the corpus. Used only to sniff a request when the caller could not say which material it
   * came from — see `scriptNameForRequest`.
   */
  textMarkers: ['/btw', 'Silent Whispering', 'whispering with your agent'],
};

export interface PickScriptInput {
  /** `materials.file_path` — the deck's file name, if the session came from a file. */
  fileName?: string | null;
  /** The file's content hash, or the material's, whichever the caller has. */
  contentSha?: string | null;
  /** A Settings override. It wins over both signals; an unknown name is ignored. */
  override?: string | null;
}

export function pickScriptName(input: PickScriptInput): ScriptName {
  const override = input.override;
  if (override === 'critique1' || override === 'psd-hessian') return override;
  if (input.contentSha && CRITIQUE1_FIXTURE.contentShas.has(input.contentSha)) return 'critique1';
  if (input.fileName && CRITIQUE1_FIXTURE.fileNamePattern.test(input.fileName)) return 'critique1';
  return 'psd-hessian';
}

export function pickScript(input: PickScriptInput): ScriptSource {
  return SCRIPTS[pickScriptName(input)];
}

/**
 * The fallback path: recognise the deck from the request itself.
 *
 * `createClient()` builds one `ScriptedClient` per app, before any material exists, and the IPC
 * layer that knows the material is owned by another piece of work this week. Rather than thread
 * the material through it, the client sniffs: a group or reference request carries the deck's own
 * text (the frozen prefix, or the segment the learner asked on), so two markers from the fixture
 * appearing together are enough to switch scripts — and the client latches the answer, so one
 * recognised request keeps the whole sitting on the right script.
 *
 * Two markers, not one, on purpose: `/btw` alone appears in this repo's own research notes.
 * Returns `null` for "nothing recognised", which is *not* the same as "use the default".
 */
export function scriptNameForRequest(request: LlmRequest): ScriptName | null {
  const haystack = `${request.system.map((b) => b.text).join('\n')}\n${request.messages
    .map((m) => m.content)
    .join('\n')}`;
  const hits = CRITIQUE1_FIXTURE.textMarkers.filter((m) => haystack.toLowerCase().includes(m.toLowerCase()));
  if (hits.length >= 2) return 'critique1';
  if (CRITIQUE1_FIXTURE.fileNamePattern.test(haystack)) return 'critique1';
  return null;
}
