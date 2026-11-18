/** Evidence from a linked answer sheet. This module never guesses from the question itself. */
import type { TutorialOption } from '../../shared/tutorial.js';

export interface SolutionPage {
  fileId: string;
  /** Page within the solution source, starting at one. */
  page: number;
  text: string;
}

export interface ChoiceEvidence {
  fileId: string;
  page: number;
  correct: string[];
  method: 'text';
}

/** Text as a quote is compared: soft hyphens gone, all whitespace one space, lower case. */
function squash(text: string): string {
  return text.replace(/\u00ad/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * The quote is on the page: the same characters, whatever the spacing, line breaks and
 * indentation between them (a PDF's text layer breaks a worked answer over lines, and lays code
 * and tables out with spaces the model does not copy). Six characters at least, spaces aside.
 */
export function quoteOnPage(pageText: string, quote: string): boolean {
  const tight = (t: string) => squash(t).replace(/\s+/g, '');
  const page = tight(pageText);
  if (tight(quote).length < 6) return false;
  // A quote the model stitched from lines of one passage, skipping a label between them
  // ("Base condition:" … "Recursive return:"): every line of it on the page, in order.
  const pieces = quote.split(/\n|…|\.\.\./).map(tight).filter((piece) => piece.length >= 3);
  if (pieces.length === 0 || !pieces.some((piece) => piece.length >= 6)) return false;
  let at = 0;
  for (const piece of pieces) {
    const found = page.indexOf(piece, at);
    if (found < 0) return false;
    at = found + piece.length;
  }
  return true;
}

/** Why a proposed key was not taken, for a debug log line (never the text). */
export type QuoteMiss = 'no_quote' | 'quote_not_on_page' | 'quote_without_answer';

/** A source quote must carry some of the proposed answer, not merely repeat the question. */
export function quoteSupportsAnswer(quote: string, answer: string): boolean {
  if (/^-?\d+(?:\.\d+)?$/.test(answer.trim())) return quote.includes(answer.trim());
  const a = squash(answer);
  if (a.length >= 3 && squash(quote).includes(a)) return true;
  if (numbersInOrder(quote, answer)) return true;
  const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  const terms = (s: string) => [...new Set(words(s)
    .filter((w) => w.length >= 3 && !['the', 'and', 'for', 'with', 'from', 'that', 'this', 'are', 'not'].includes(w)))];
  const wanted = terms(answer);
  const found = new Set(words(quote));
  // An answer of short tokens only ("1 2 4 8 16", "i=8, j=0, k=14", "6 7"): every one is quoted.
  if (wanted.length === 0) {
    const all = words(answer);
    return all.length > 0 && all.every((w) => found.has(w));
  }
  return wanted.filter((w) => found.has(w)).length >= Math.min(2, Math.ceil(wanted.length / 2));
}

/**
 * A trace, a table or printed lines: the answer's numbers are the quote's, in the quote's order
 * (three at least; all of up to eight, three in four of a longer trace, so labels such as
 * "Iteration 2" may be extra). A trace in a different order does not pass.
 */
function numbersInOrder(quote: string, answer: string): boolean {
  const nums = (s: string) => s.match(/-?\d+(?:\.\d+)?/g) ?? [];
  const a = nums(answer);
  const q = nums(quote);
  if (a.length < 3 || q.length < 3) return false;
  // An answer that restates what it quotes ("x[0] == -5 and x[1] == -5, i.e. x = {-5, -5}"): the
  // quote's numbers in the answer's order, and no number of the answer's that the quote lacks.
  const quoted = new Set(q);
  if (a.every((n) => quoted.has(n))) {
    let i = 0;
    for (const n of a) if (n === q[i]) i += 1;
    if (i === q.length) return true;
  }
  // Longest common subsequence, small inputs only.
  const prev = new Array<number>(q.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = 0;
    for (let j = 1; j <= q.length; j += 1) {
      const up = prev[j]!;
      prev[j] = a[i - 1] === q[j - 1] ? diag + 1 : Math.max(prev[j]!, prev[j - 1]!);
      diag = up;
    }
  }
  // A short answer must be quoted whole; a long trace may carry a few labels the quote does not.
  return prev[q.length]! >= (a.length <= 8 ? a.length : Math.ceil(a.length * 0.75));
}

/** Cut off the next numbered question so its ticks cannot contaminate this one's key. */
function questionSection(text: string, question: number): string | null {
  const header = /(?:^|\n)\s*(?:question\s*(?:#|number|no\.)?\s*[:.]?\s*)(\d+)\b/gi;
  const matches = [...text.matchAll(header)];
  const at = matches.findIndex((m) => Number(m[1]) === question);
  if (at >= 0) {
    const start = matches[at]!.index!;
    return text.slice(start, matches[at + 1]?.index ?? text.length);
  }
  return bareSection(text, question);
}

/**
 * An answer sheet numbered "12." on a line of its own (the CS1010 practice solutions, 2026-11-18).
 * Only numbers that run in order count as headers, so a "3." inside question 2's working is not
 * taken for question 3.
 */
function bareSection(text: string, question: number): string | null {
  const headers: { n: number; index: number }[] = [];
  for (const m of text.matchAll(/(?:^|\n)[ \t]*(\d{1,3})\.[ \t]*(?=\n|$)/g)) {
    const n = Number(m[1]);
    const last = headers.at(-1);
    if (!last || n === last.n + 1) headers.push({ n, index: m.index! });
  }
  const at = headers.findIndex((h) => h.n === question);
  if (at < 0) return null;
  return text.slice(headers[at]!.index, headers[at + 1]?.index ?? text.length);
}

/**
 * An answer led by its option ids, the solutions' own first word: "A. Each division is integer
 * division…", "A and D. A states when…". Only in a section that does not reprint the options (a
 * reprint lists every option the same way), and only ids that are options of the question.
 */
function ledByOptions(section: string, valid: ReadonlySet<string>): string[] | null {
  const lines = section.split('\n').slice(1);
  // "A.", "A and D.", "B, C, and D.", "A, B, D, and E.", "C only."
  const led = lines
    .map((l) => /^\s*([A-Za-z](?:\s*(?:,\s*and|,|and|&)\s*[A-Za-z])*)(?:\s+only)?\s*\.(?:\s+\S|\s*$)/i.exec(l)?.[1])
    .filter((v): v is string => v !== undefined);
  if (led.length !== 1) return null;
  const ids = led[0]!.split(/\s*(?:,\s*and|,|and|&)\s*/i).map((id) => id.trim().toUpperCase());
  if (ids.length === 0 || new Set(ids).size !== ids.length || ids.some((id) => !valid.has(id))) return null;
  return ids;
}

function matchesChoiceWording(section: string, options: readonly TutorialOption[]): boolean {
  const terms = (value: string) => new Set((value.toLowerCase().match(/[a-z0-9_]{2,}/g) ?? [])
    .filter((word) => !['the', 'and', 'for', 'with', 'from', 'that', 'this', 'are', 'not', 'option', 'either'].includes(word)));
  const wanted = new Set(options.flatMap((o) => [...terms(o.text)]));
  const found = terms(section);
  return wanted.size >= 3 && [...wanted].filter((word) => found.has(word)).length >= Math.max(3, Math.ceil(wanted.size * 0.3));
}

/** Question numbers are the only safe implicit map for a numbered exam answer sheet. */
export function questionNumber(partId: string, label: string): number | null {
  const labelMatch = label.match(/\bquestion\s*(?:#\s*)?(\d+)\b/i);
  if (labelMatch) return Number(labelMatch[1]);
  const idMatch = partId.match(/^P(\d+)$/i);
  return idMatch ? Number(idMatch[1]) : null;
}

/**
 * The CS2102 sheet's ✓A. format and explicit "Answer: A, D, G" lines are read in code.
 * Every id must be an option on the ingested question. Ambiguous or partial markings fail closed.
 */
export function choiceEvidenceFromText(
  pages: readonly SolutionPage[],
  partId: string,
  label: string,
  options: readonly TutorialOption[],
): ChoiceEvidence | null {
  const number = questionNumber(partId, label);
  if (number === null || options.length < 2) return null;
  const valid = new Set(options.map((o) => o.id.toUpperCase()));
  for (const page of pages) {
    const section = questionSection(page.text, number);
    if (!section) continue;
    if (!matchesChoiceWording(section, options)) {
      const led = ledByOptions(section, valid);
      if (led) return { fileId: page.fileId, page: page.page, correct: led, method: 'text' };
      continue;
    }
    // pdf.js extracts the checkmark in the CS2102 answer PDF as a leading "3" (3A., 3D.).
    // Interpret that glyph artifact only for single-letter option lists, with every option present.
    const artifact = [...valid].every((id) => /^[A-Z]$/.test(id));
    const marker = artifact ? '[✓✔☑3]' : '[✓✔☑]';
    const marks = [...section.matchAll(new RegExp(`^\\s*${marker}\\s*([A-Za-z0-9]+)\\s*[.)]`, 'gm'))]
      .map((m) => m[1]!.toUpperCase());
    const listed = [...section.matchAll(new RegExp(`^\\s*(?:${marker}\\s*)?([A-Za-z0-9]+)\\s*[.)]\\s+\\S`, 'gm'))]
      .map((m) => m[1]!.toUpperCase());
    const allOptionsListed = [...valid].every((id) => listed.includes(id));
    let correct = marks;
    if (correct.length === 0) {
      const line = section.match(/(?:^|\n)\s*(?:correct\s+)?answers?\s*[:-]\s*([A-Za-z0-9,\s&]+)(?:\n|$)/i)?.[1] ?? '';
      correct = line.match(/[A-Za-z0-9]+/g)?.map((id) => id.toUpperCase()) ?? [];
      // No ticks and no "Answer:" line: an answer led by its option, whose explanation repeats
      // the options' words (CS1010 Q35, "A. moo writes beyond the allocated array…").
      if (correct.length === 0) correct = ledByOptions(section, valid) ?? [];
    } else if (!allOptionsListed) {
      continue;
    }
    if (correct.length === 0 || new Set(correct).size !== correct.length || correct.some((id) => !valid.has(id))) continue;
    return { fileId: page.fileId, page: page.page, correct, method: 'text' };
  }
  return null;
}

/**
 * **The answer-sheet pages a part's answer is on**: the pages whose text opens the part's
 * question number, and the page after each (an answer runs on). Null when the part has no
 * question number or no page names it, and the caller then sends every page (2026-11-18: each
 * solutions batch used to carry all thirteen page images).
 */
export function pagesForPart(pages: readonly SolutionPage[], partId: string, label: string): SolutionPage[] | null {
  // A sub-part's answer is under its question's number: P9a, "Problem 9 (a)".
  const fromLabel = label.match(/\b(?:question|problem|q)\s*#?\s*(\d+)/i)?.[1];
  const fromId = partId.match(/^P(\d+)/i)?.[1];
  const number = fromLabel ? Number(fromLabel) : fromId ? Number(fromId) : null;
  if (number === null) return null;
  const hit = new Set<SolutionPage>();
  pages.forEach((page, i) => {
    if (!questionSection(page.text, number)) return;
    hit.add(page);
    const next = pages[i + 1];
    if (next && next.fileId === page.fileId) hit.add(next);
  });
  return hit.size > 0 ? [...hit] : null;
}
