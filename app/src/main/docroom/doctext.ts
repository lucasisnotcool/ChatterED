/**
 * **Is what the learner just wrote in the document an attempt?** (brief §6; architect §E4.)
 * **Track T6.**
 *
 * The renderer reports `notes:docText` every time the learner pauses after typing in the doc. Most
 * of those pauses are not attempts: half a sentence, a heading they retitled, "ok makes sense", or
 * the same paragraph they already had assessed a minute ago. Deciding which are is a *rule*, so it
 * is here, in code, pure, and tested — not a prompt, and not "ask Max and see what he says", which
 * would cost a model call per pause and put a verdict on a half-typed line.
 *
 * The floor is the ledger's own (`isAgreementOnly`, eight content words and the agreement
 * phrases): the doc text becomes a learner *message* and is scored by exactly the rules a chat
 * message is, so a span that could never move the ledger must not become a question Max marks.
 * One definition, imported rather than restated.
 */

import { createHash } from 'node:crypto';
import { isAgreementOnly, normalise } from '../../room/ledger.js';

/**
 * Why a pause was not assessed. Returned to the renderer as `reason`, which shows nothing for it:
 * this is for the log, and for T5's tests.
 */
export type DocTextRefusal =
  /** Fewer than the ledger's eight content words, or agreement rather than a claim. */
  | 'too_short'
  /** No sentence yet: no terminal punctuation and not long enough to be one without it. */
  | 'no_sentence'
  /** The block's pages are taught by no objective, or by more than one (`doc.ts`). */
  | 'no_objective'
  /** Byte-for-byte what was last assessed for this block. */
  | 'unchanged'
  /** Max is still marking the previous pause on this block. */
  | 'in_flight'
  /** The file has no ingested document, so no block has pages and nothing maps. */
  | 'no_doc';

export interface DocTextGateInput {
  text: string;
  /** Resolved by the caller from the block's pages (`objectiveForBlock`). */
  objectiveId: string | null;
  /** The hash of the text last assessed for this block, if any. */
  lastHash?: string | null;
  /** True while an earlier assessment of this block has not come back. */
  inFlight?: boolean;
}

export interface DocTextGateResult {
  assessed: boolean;
  reason: DocTextRefusal | null;
  /** Set whenever the text is long enough to have one — stored once the assessment is started. */
  hash: string;
  /** The text as it will be inserted: trimmed, otherwise verbatim (the ledger's rule R1). */
  verbatim: string;
  objectiveId: string | null;
}

/**
 * Long enough to be a sentence without punctuation.
 *
 * A learner who ends a thought with a full stop has said so; one who does not has to have written
 * enough that a half-typed line is not a plausible reading. Sixteen words is two lines of the
 * editor — above the ledger's eight-word floor, below any real explanation. The cost of being
 * wrong here is a pause that waits for the next one, which is the safe direction.
 */
const UNPUNCTUATED_SENTENCE_WORDS = 16;

/** `.`, `!`, `?` — and a closing quote or bracket after one, as a real paragraph has. */
const TERMINATOR = /[.!?]["'’”)\]]*\s*$|[.!?]\s+\S/;

function contentWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => /[a-z0-9]/i.test(w)).length;
}

/** The dedupe key: normalised, so a trailing space or a re-indent is not a new attempt. */
export function docTextHash(text: string): string {
  return createHash('sha256').update(normalise(text)).digest('hex').slice(0, 16);
}

/**
 * The gate. Pure: every input is an argument and the only output is this object.
 *
 * Order matters only for which refusal is reported, and it is cheapest-and-most-specific first:
 * a learner watching the log should see *why* their paragraph did not get marked, and "it is the
 * same paragraph as last time" is more useful than "an assessment is in flight" when both are
 * true.
 */
export function docTextGate(input: DocTextGateInput): DocTextGateResult {
  const verbatim = input.text.trim();
  const hash = docTextHash(verbatim);
  const refuse = (reason: DocTextRefusal): DocTextGateResult => ({
    assessed: false,
    reason,
    hash,
    verbatim,
    objectiveId: input.objectiveId,
  });

  // The ledger's floor, and its agreement rule, in one call so the two cannot drift apart.
  if (isAgreementOnly(verbatim)) return refuse('too_short');
  if (!TERMINATOR.test(verbatim) && contentWords(verbatim) < UNPUNCTUATED_SENTENCE_WORDS) {
    return refuse('no_sentence');
  }
  if (!input.objectiveId) return refuse('no_objective');
  if (input.lastHash && input.lastHash === hash) return refuse('unchanged');
  if (input.inFlight) return refuse('in_flight');

  return { assessed: true, reason: null, hash, verbatim, objectiveId: input.objectiveId };
}
