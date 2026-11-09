/**
 * **Does each page a reply cites say what the citing sentence says?** (DG3: citations the learner
 * can check; harm: a page given as support that does not support it.)
 *
 * A reply names pages as "p. 42" or "pp. 40–41". A citing sentence is supported by a page when
 * the page's own slide text shares enough of the sentence's content words (`answerguard`'s
 * `contentWords`): at least `CITATION_MIN_SHARED`, and at least `CITATION_MIN_SHARE` of the
 * sentence's words, up to `CITATION_SHARED_CAP`. A range is supported when any page in it is. A
 * page the deck does not have is never supported. A sentence with fewer than
 * `CITATION_MIN_WORDS` content words is not judged: there is too little to compare.
 *
 * Lexical, like the answer guard: it catches a page that is about something else, not a page that
 * uses the same words to say the opposite.
 */
import { contentWords } from './answerguard.js';

export const CITATION_MIN_SHARED = 2;
export const CITATION_MIN_SHARE = 0.2;
export const CITATION_SHARED_CAP = 4;
export const CITATION_MIN_WORDS = 4;

const PAGE_REF = /\b(?:pp?)\.\s?(\d{1,3})(?:\s*[–-]\s*(\d{1,3}))?/gi;

export interface CitationFault {
  /** The pages the reference names (one, or a range). */
  pages: number[];
  /** The reference as written, e.g. "p. 42". */
  ref: string;
  sentence: string;
  /** Content words the sentence shares with the best page it names. */
  shared: number;
}

/** Sentences, with "p. 42" kept whole (a plain splitter breaks it after "p."). */
export function citationSentences(text: string): string[] {
  // A placeholder that is not whitespace (JS counts U+00A0 as `\s`), put back after the split.
  const guarded = text.replace(/\b(pp?)\.\s(?=\d)/gi, '$1.\uE001');
  return guarded
    .split(/(?<=[.!?])\s+(?=[A-Z0-9*("“])|\n+/)
    .map((s) => s.replace(/\uE001/g, ' ').trim())
    .filter((s) => s.length > 0);
}

function refsIn(sentence: string): { ref: string; pages: number[] }[] {
  const out: { ref: string; pages: number[] }[] = [];
  for (const m of sentence.matchAll(PAGE_REF)) {
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    const pages: number[] = [];
    for (let p = Math.min(a, b); p <= Math.max(a, b) && pages.length < 10; p += 1) pages.push(p);
    out.push({ ref: m[0], pages });
  }
  return out;
}

/** How many content words a sentence must share with a page, given its own count. */
export function sharedNeeded(words: number): number {
  return Math.min(CITATION_SHARED_CAP, Math.max(CITATION_MIN_SHARED, Math.ceil(words * CITATION_MIN_SHARE)));
}

/** Every page reference in `text` whose page does not support its sentence. */
export function citationFaults(text: string, pageText: (page: number) => string | null): CitationFault[] {
  const faults: CitationFault[] = [];
  for (const sentence of citationSentences(text)) {
    const refs = refsIn(sentence);
    if (refs.length === 0) continue;
    const words = [...new Set(contentWords(sentence.replace(PAGE_REF, ' ')))];
    if (words.length < CITATION_MIN_WORDS) continue;
    for (const { ref, pages } of refs) {
      let best = 0;
      for (const p of pages) {
        const page = pageText(p);
        if (page === null) continue;
        const have = new Set(contentWords(page));
        best = Math.max(best, words.filter((w) => have.has(w)).length);
      }
      if (best < sharedNeeded(words.length)) faults.push({ pages, ref, sentence, shared: best });
    }
  }
  return faults;
}

/**
 * The reply with the faulted references taken out, the sentences kept: "(p. 42)" goes, "p. 42's"
 * becomes "the slides'", and a bare "p. 42" becomes "the slides".
 */
export function dropCitations(text: string, faults: readonly CitationFault[]): string {
  let out = text;
  for (const f of faults) {
    const fixed = f.sentence
      .split(f.ref)
      .join('\uE000')
      .replace(/\s*\(\s*\uE000\s*\)/g, '')
      .replace(/\uE000['’]s\b/g, 'the slides’')
      .replace(/\uE000/g, 'the slides');
    out = out.replace(f.sentence, fixed);
  }
  return out;
}
