/**
 * Labels, from the text layer only — no model call (issue #25 decision 4).
 *
 * A whole-page segment is labelled with the **slide title**: the tagged `H1`–`H6` box if the
 * PDF is tagged (§B1.4 — PowerPoint marks the title `H2`), otherwise the largest font on the
 * page, tie-broken topmost. After a split, a sub-segment takes its **first text line**.
 *
 * The lazy-split brief §3.2 is honest that first-line labels are mediocre; they are editable,
 * and "Suggest names" is the A2 upgrade. What matters here is that a label is never empty and
 * never invents anything the page does not say.
 */
import { containsPoint } from './boxes.js';
import type { Box, PageGeometry, TextBox } from './types.js';

/** Labels are one line in a strip above the crop; longer than this and it truncates anyway. */
export const LABEL_CAP = 80;

const HEADING = /^H[1-6]$/;

function tidy(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= LABEL_CAP ? t : `${t.slice(0, LABEL_CAP - 1).trimEnd()}…`;
}

/** Boxes sharing a baseline with `first`, left to right — pdf.js emits one item per run. */
function lineFrom(boxes: TextBox[], first: TextBox): string {
  const tol = Math.max(0.004, (first.y1 - first.y0) * 0.5);
  return boxes
    .filter((b) => Math.abs(b.y0 - first.y0) <= tol)
    .sort((a, b) => a.x0 - b.x0)
    .map((b) => b.text)
    .join(' ');
}

function topMost(a: TextBox, b: TextBox): number {
  return a.y0 - b.y0 || a.x0 - b.x0;
}

/** The slide title, or `''` when the page has no text at all (a scan, a full-bleed figure). */
export function slideTitle(page: PageGeometry): string {
  const body = page.textBoxes.filter((b, i) => !page.chrome[i] && b.text.trim() !== '');
  if (body.length === 0) return '';

  const tagged = (page.struct ?? [])
    .filter((s) => HEADING.test(s.role))
    .map((s) => page.textBoxes[s.box])
    .filter((b): b is TextBox => b !== undefined && b.text.trim() !== '');
  if (tagged.length > 0) {
    const first = [...tagged].sort(topMost)[0]!;
    return tidy(lineFrom(body, first));
  }

  const maxFont = Math.max(...body.map((b) => b.fontPt));
  const biggest = body.filter((b) => b.fontPt >= maxFont - 0.01).sort(topMost)[0]!;
  return tidy(lineFrom(body, biggest));
}

/** The first text line inside a rectangle — the label a sub-segment gets after a split. */
export function firstLineIn(page: PageGeometry, box: Box): string {
  const inside = page.textBoxes
    .filter((b, i) => !page.chrome[i] && b.text.trim() !== '')
    .filter((b) => containsPoint(box, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2));
  if (inside.length === 0) return '';
  const first = [...inside].sort(topMost)[0]!;
  return tidy(lineFrom(inside, first));
}

/**
 * The label for any rectangle on a page: the slide title when the rectangle is (almost) the
 * whole page, the first line inside it otherwise, and a page chip as the last resort — a
 * segment always has *something* to show in its strip.
 */
export function labelFor(page: PageGeometry, box: Box): string {
  const wholePage = box.x1 - box.x0 > 0.98 && box.y1 - box.y0 > 0.98;
  const label = wholePage ? slideTitle(page) : firstLineIn(page, box);
  return label !== '' ? label : `Page ${page.page}`;
}
