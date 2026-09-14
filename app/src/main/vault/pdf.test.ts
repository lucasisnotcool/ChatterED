import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractPdfText } from './pdf.js';

const TWO_PAGE_PDF =
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length 42 >>\nstream\nBT /F1 24 Tf 20 100 Td (Challenger) Tj ET\nendstream\nendobj\n5 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>\nendobj\n6 0 obj\n<< /Length 39 >>\nstream\nBT /F1 24 Tf 20 100 Td (Hessian) Tj ET\nendstream\nendobj\n7 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\nxref\n0 8\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000121 00000 n \n0000000247 00000 n \n0000000338 00000 n \n0000000464 00000 n \n0000000552 00000 n \ntrailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n622\n%%EOF\n';

/** A 1-page PDF with no text operators at all (stands in for a scanned page). */
const IMAGE_ONLY_PDF =
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length 26 >>\nstream\n0 0 1 rg 10 10 80 80 re f\n\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000117 00000 n \n0000000210 00000 n \ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n287\n%%EOF\n';

function write(name: string, body: string): string {
  const p = join(mkdtempSync(join(tmpdir(), 'pdffix-')), name);
  writeFileSync(p, Buffer.from(body, 'latin1'));
  return p;
}

describe('extractPdfText', () => {
  it('reads both pages of an inline fixture', async () => {
    const r = await extractPdfText(write('two.pdf', TWO_PAGE_PDF));
    expect(r.pageCount).toBe(2);
    expect(r.pages).toHaveLength(2);
    expect(r.pages[0]!.text).toContain('Challenger');
    expect(r.pages[1]!.text).toContain('Hessian');
  });

  it('honours a 1-indexed inclusive range', async () => {
    const r = await extractPdfText(write('two.pdf', TWO_PAGE_PDF), { from: 2, to: 2 });
    expect(r.pageCount).toBe(2);
    expect(r.pages.map((p) => p.page)).toEqual([2]);
    expect(r.pages[0]!.text).toContain('Hessian');
  });

  it('returns empty text (not a throw) for an image-only page', async () => {
    const r = await extractPdfText(write('img.pdf', IMAGE_ONLY_PDF));
    expect(r.pageCount).toBe(1);
    expect(r.pages[0]!.text).toBe('');
  });
});
