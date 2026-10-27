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

/** A source quote must carry some of the proposed answer, not merely repeat the question. */
export function quoteSupportsAnswer(quote: string, answer: string): boolean {
  if (/^-?\d+(?:\.\d+)?$/.test(answer.trim())) return quote.includes(answer.trim());
  const terms = (s: string) => [...new Set((s.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? [])
    .filter((w) => !['the', 'and', 'for', 'with', 'from', 'that', 'this', 'are', 'not'].includes(w)))];
  const wanted = terms(answer);
  const found = new Set(terms(quote));
  return wanted.length > 0 && wanted.filter((w) => found.has(w)).length >= Math.min(2, Math.ceil(wanted.length / 2));
}

/** Cut off the next numbered question so its ticks cannot contaminate this one's key. */
function questionSection(text: string, question: number): string | null {
  const header = /(?:^|\n)\s*(?:question\s*(?:#|number|no\.)?\s*[:.]?\s*)(\d+)\b/gi;
  const matches = [...text.matchAll(header)];
  const at = matches.findIndex((m) => Number(m[1]) === question);
  if (at < 0) return null;
  const start = matches[at]!.index!;
  return text.slice(start, matches[at + 1]?.index ?? text.length);
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
    if (!section || !matchesChoiceWording(section, options)) continue;
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
    } else if (!allOptionsListed) {
      continue;
    }
    if (correct.length === 0 || new Set(correct).size !== correct.length || correct.some((id) => !valid.has(id))) continue;
    return { fileId: page.fileId, page: page.page, correct, method: 'text' };
  }
  return null;
}
