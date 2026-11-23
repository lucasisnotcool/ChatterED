// Assembles the final group report from the vetted section files into one Word document, which
// Lucas then reviews and edits by hand. Run from the repo root:
//
//   DOCX_MODULE=<folder>/node_modules/docx node docs/group/final-report/build.mjs <out-dir>
//
// `docx` (npm) is not a dependency of this repo: install it in a scratch folder (`npm install
// docx`) and point DOCX_MODULE at it. Markdown is read with the `marked` that the app already has.
//
// What it does, and nothing else:
//   1. strips every HTML comment (the notes for Lucas and Valerie);
//   2. puts the parts in order: title page, abstract, sections 1 to 9, references, appendices;
//   3. gives the appendices their final letters, in order of first mention (LETTERS below);
//   4. replaces the Figure 1 placeholder with the screenshot;
//   5. counts the main text and prints the count on the title page;
//   6. refuses to build while a placeholder such as *[… to complete]* is left, unless --draft.
//
// The section files stay the source of truth for the text as vetted; this script never writes to
// them. Once the Word file has been edited by hand, do not rebuild over it.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { marked } = require(resolve(here, '../../../app/node_modules/marked'));
const D = require(process.env.DOCX_MODULE ?? 'docx');

const args = process.argv.slice(2);
const draft = args.includes('--draft');
const outDir = resolve(args.find((a) => !a.startsWith('--')) ?? 'dist/submission/report');

const GROUP = 'Group 5';
const COURSE = 'CS3249 Conversational User Interfaces';
const KIND = 'Final Project Report';
const AUTHORS = ['Loh Zheng, Lucas', 'Valerie Lim Xuan Yi'];
const DATE = '23 November 2026';

// Working letter in the section files -> final letter, in order of first mention in the text.
const LETTERS = { Y: 'A', X: 'B', W: 'C', Z: 'D' };
const FIGURE1 = '@@FIGURE1@@';

const read = (name) =>
  readFileSync(join(here, name), 'utf8').replace(/<!--[\s\S]*?-->/g, '');

const reletter = (md) =>
  md
    .replace(/\bAppendix ([WXYZ])\b/g, (_, l) => `Appendix ${LETTERS[l]}`)
    .replace(/(^|[\s(])([WXYZ])\.(\d)/gm, (_, pre, l, n) => `${pre}${LETTERS[l]}.${n}`);

// ── The parts ────────────────────────────────────────────────────────────────────────────────
const intro = read('01-introduction-related-work.md');
const title = intro.match(/^# (.+)$/m)[1];
const s12 = intro.replace(/^# .+$/m, '');
let s34 = read('02-user-research-system-design.md');
const s56 = read('03-user-study-results.md');
const s7 = read('04-ethical-design-implications.md');
const last = read('05-conclusion-contributions-abstract.md');

const cut = (md, from, to) => {
  const a = md.indexOf(from);
  const b = to ? md.indexOf(to) : md.length;
  if (a < 0 || b < 0) throw new Error(`cannot find ${from} … ${to}`);
  return md.slice(a, b);
};
const abstract = cut(last, '## Abstract', '## 8.');
const s89 = cut(last, '## 8.', '## References');
const refs = cut(last, '## References');

const fig1 = /\*\[Figure 1\.[\s\S]*?\]\*/;
if (!fig1.test(s34)) throw new Error('Figure 1 placeholder not found in file 02');
s34 = s34.replace(fig1, FIGURE1);

const appendices = [
  'appendix-y-hint-sample.md',
  'appendix-x-attack-test.md',
  'appendix-w-consent-and-log.md',
  'appendix-z-feedback-coding.md',
].map(read);

// ── Word count: main text only ───────────────────────────────────────────────────────────────
// Counted: the abstract and sections 1 to 9. Not counted, as the report brief says: the title
// page, tables, figures and their captions, references and appendices. Headings are left out too.
const countWords = (md) =>
  md
    .split('\n')
    .map((l) => l.trim())
    .filter(
      (l) =>
        l &&
        l !== FIGURE1 &&
        !l.startsWith('#') &&
        !l.startsWith('|') &&
        !/^\*\*(Table|Figure) \d+/.test(l),
    )
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length;

const words = [abstract, s12, s34, s56, s7, s89].reduce((n, md) => n + countWords(md), 0);

// ── Checks ───────────────────────────────────────────────────────────────────────────────────
const body = reletter([abstract, s12, s34, s56, s7, s89].join('\n\n'));
const refsMd = reletter(refs);
const appsMd = appendices.map(reletter);
const all = [body, refsMd, ...appsMd].join('\n\n');

const problems = [];
for (const m of all.matchAll(/\*\[[^\]]*\]\*|\[DATA\]|GROUP_NUMBER|TODO/g)) problems.push(`placeholder: ${m[0]}`);
const tables = [...all.matchAll(/^\*\*Table (\d+)\./gm)].map((m) => +m[1]);
tables.forEach((n, i) => { if (n !== i + 1) problems.push(`Table ${n} is in position ${i + 1}`); });
if (words > 7000) problems.push(`main text is ${words} words, over 7,000`);
if (words < 4000) problems.push(`main text is ${words} words, under 4,000`);
for (const p of problems) console.error(`  ! ${p}`);
if (problems.length && !draft) {
  console.error('Not built. Fix the above, or pass --draft to build anyway.');
  process.exit(1);
}

// ── Markdown tokens -> Word ──────────────────────────────────────────────────────────────────
const BODY_FONT = 'Times New Roman';
const HEAD_FONT = 'Arial';
const PAGE_W = 11906; // A4, in DXA
const MARGIN = 1440; // 1 inch
const TEXT_W = PAGE_W - 2 * MARGIN;

const decode = (s) =>
  s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s*\n\s*/g, ' ');

/** Inline tokens -> TextRuns, carrying bold/italic down. */
const runs = (tokens, fmt = {}) => {
  const out = [];
  for (const t of tokens ?? []) {
    if (t.type === 'strong') out.push(...runs(t.tokens, { ...fmt, bold: true }));
    else if (t.type === 'em') out.push(...runs(t.tokens, { ...fmt, italics: true }));
    else if (t.type === 'codespan') out.push(new D.TextRun({ ...fmt, text: decode(t.text), font: 'Menlo', size: (fmt.size ?? 22) - 3 }));
    else if (t.type === 'link') out.push(...runs(t.tokens, fmt));
    else if (t.type === 'br') out.push(new D.TextRun({ ...fmt, text: ' ' }));
    else if (t.tokens?.length) out.push(...runs(t.tokens, fmt));
    else out.push(new D.TextRun({ ...fmt, text: decode(t.text ?? t.raw ?? '') }));
  }
  return out;
};

const plain = (tokens) =>
  (tokens ?? []).map((t) => (t.tokens?.length ? plain(t.tokens) : decode(t.text ?? t.raw ?? ''))).join('');

const border = { style: D.BorderStyle.SINGLE, size: 4, color: '666666' };
const cellBorders = { top: border, bottom: border, left: border, right: border };

const table = (t) => {
  const cols = t.header.length;
  // Column widths: each column is at least as wide as its longest word, and the space left over
  // is shared in proportion to the longest cell of each column.
  const texts = (c) => [plain(t.header[c].tokens), ...t.rows.map((r) => plain(r[c].tokens))];
  const minW = Array.from({ length: cols }, (_, c) => {
    const word = Math.max(...texts(c).flatMap((s) => s.split(/[\s/]+/).map((w) => w.length)), 1);
    return Math.min(word * 105 + 200, Math.floor(TEXT_W / 2));
  });
  const weight = Array.from({ length: cols }, (_, c) => Math.min(Math.max(...texts(c).map((s) => s.length)), 220) + 1);
  const spare = TEXT_W - minW.reduce((a, b) => a + b, 0);
  const sum = weight.reduce((a, b) => a + b, 0);
  const widths =
    spare >= 0
      ? minW.map((m, c) => m + Math.floor((spare * weight[c]) / sum))
      : minW.map((m) => Math.floor((m * TEXT_W) / (TEXT_W - spare)));
  widths[cols - 1] += TEXT_W - widths.reduce((a, b) => a + b, 0);
  const cell = (c, i, head) =>
    new D.TableCell({
      width: { size: widths[i], type: D.WidthType.DXA },
      borders: cellBorders,
      margins: { top: 40, bottom: 40, left: 80, right: 80 },
      shading: head ? { type: D.ShadingType.CLEAR, fill: 'E6E6E6', color: 'auto' } : undefined,
      children: [
        new D.Paragraph({
          style: 'TableText',
          children: runs(c.tokens, { size: 18, font: HEAD_FONT, bold: head || undefined }),
        }),
      ],
    });
  return new D.Table({
    width: { size: TEXT_W, type: D.WidthType.DXA },
    columnWidths: widths,
    rows: [
      new D.TableRow({ tableHeader: true, cantSplit: true, children: t.header.map((c, i) => cell(c, i, true)) }),
      ...t.rows.map((r) => new D.TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, i, false)) })),
    ],
  });
};

const figure1 = () => [
  new D.Paragraph({
    keepNext: true,
    spacing: { before: 120, after: 60 },
    children: [
      new D.ImageRun({
        type: 'png',
        data: readFileSync(join(here, 'figures/figure1-workspace.png')),
        transformation: { width: 600, height: 356 },
        altText: { title: 'Figure 1', description: 'The ChatterED workspace on one part', name: 'Figure 1' },
      }),
    ],
  }),
  new D.Paragraph({
    style: 'Caption',
    children: [
      new D.TextRun({ text: 'Figure 1. One part of a tutorial in the workspace. ', bold: true }),
      new D.TextRun(
        'On the left, the question, the answer slot, the four controls and the one-line results under the part; ' +
          'on the right, the part’s thread. The homework shown is a sample that we wrote ourselves.',
      ),
    ],
  }),
];

/** Block tokens -> Word blocks. `mode` is 'body', 'refs' or 'appendix'. */
const blocks = (md, mode) => {
  const out = [];
  let first = true;
  for (const t of marked.lexer(md)) {
    if (t.type === 'space') continue;
    if (t.type === 'heading') {
      out.push(
        new D.Paragraph({
          heading: t.depth <= 2 ? D.HeadingLevel.HEADING_1 : D.HeadingLevel.HEADING_2,
          pageBreakBefore: first && mode !== 'body',
          children: runs(t.tokens),
        }),
      );
    } else if (t.type === 'paragraph') {
      const text = plain(t.tokens).trim();
      if (text === FIGURE1) out.push(...figure1());
      else if (/^(Table|Figure) \d+\./.test(text) && t.tokens[0]?.type === 'strong')
        out.push(new D.Paragraph({ style: 'Caption', keepNext: true, children: runs(t.tokens) }));
      else out.push(new D.Paragraph({ style: mode === 'refs' ? 'Reference' : undefined, children: runs(t.tokens) }));
    } else if (t.type === 'table') {
      out.push(table(t), new D.Paragraph({ spacing: { after: 60 }, children: [] }));
    } else if (t.type === 'blockquote') {
      for (const p of t.tokens.filter((x) => x.type === 'paragraph'))
        out.push(new D.Paragraph({ style: 'Quote', children: runs(p.tokens) }));
    } else if (t.type === 'list') {
      for (const item of t.items)
        out.push(new D.Paragraph({ numbering: { reference: 'bullets', level: 0 }, children: runs(item.tokens) }));
    } else {
      throw new Error(`unhandled block: ${t.type}: ${t.raw.slice(0, 60)}`);
    }
    first = false;
  }
  return out;
};

const centred = (text, opts = {}) =>
  new D.Paragraph({
    alignment: D.AlignmentType.CENTER,
    spacing: { before: opts.before ?? 0, after: opts.after ?? 160 },
    children: [new D.TextRun({ text, bold: opts.bold, size: opts.size ?? 24, font: opts.font })],
  });

const titlePage = [
  centred(title, { before: 3600, after: 600, bold: true, size: 44, font: HEAD_FONT }),
  centred(COURSE),
  centred(KIND),
  centred(GROUP, { bold: true, before: 300 }),
  ...AUTHORS.map((a) => centred(a)),
  centred(DATE, { before: 500 }),
  centred(
    `Word count: ${words.toLocaleString('en-GB')} (main text; tables, figures, references and appendices are not counted)`,
    { before: 300, size: 21 },
  ),
  new D.Paragraph({ children: [new D.PageBreak()] }),
];

const heading = (size, before) => ({
  run: { font: HEAD_FONT, size, bold: true, color: '000000' },
  paragraph: { spacing: { before, after: 100 }, keepNext: true },
});

const doc = new D.Document({
  creator: AUTHORS.join('; '),
  title: `${GROUP} Final Report: ChatterED`,
  styles: {
    default: {
      document: { run: { font: BODY_FONT, size: 22 }, paragraph: { spacing: { after: 140, line: 288 } } },
      heading1: heading(28, 320),
      heading2: heading(23, 220),
    },
    paragraphStyles: [
      { id: 'Caption', name: 'Caption', basedOn: 'Normal', run: { font: HEAD_FONT, size: 18 }, paragraph: { spacing: { before: 160, after: 60, line: 240 } } },
      { id: 'TableText', name: 'Table Text', basedOn: 'Normal', run: { font: HEAD_FONT, size: 18 }, paragraph: { spacing: { before: 0, after: 0, line: 240 } } },
      { id: 'Reference', name: 'Reference', basedOn: 'Normal', run: { size: 20 }, paragraph: { indent: { left: 440, hanging: 440 }, spacing: { after: 100, line: 264 } } },
      { id: 'Quote', name: 'Quote', basedOn: 'Normal', run: { size: 20 }, paragraph: { indent: { left: 360 }, spacing: { after: 100, line: 264 }, border: { left: { style: D.BorderStyle.SINGLE, size: 12, color: '999999', space: 8 } } } },
    ],
  },
  numbering: {
    config: [{ reference: 'bullets', levels: [{ level: 0, format: D.LevelFormat.BULLET, text: '•', alignment: D.AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }],
  },
  sections: [
    {
      properties: { page: { margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } }, titlePage: true },
      footers: {
        default: new D.Footer({
          children: [new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [new D.TextRun({ children: [D.PageNumber.CURRENT], size: 18 })] })],
        }),
        first: new D.Footer({ children: [new D.Paragraph({ children: [] })] }),
      },
      children: [
        ...titlePage,
        ...blocks(body, 'body'),
        ...blocks(refsMd, 'refs'),
        ...appsMd.flatMap((a) => blocks(a, 'appendix')),
      ],
    },
  ],
});

mkdirSync(outDir, { recursive: true });
const out = join(outDir, 'Group5_Final_Report.docx');
writeFileSync(out, await D.Packer.toBuffer(doc));
console.log(`words (main text): ${words}`);
console.log(`tables: ${tables.length}; appendices: ${appendices.length}`);
console.log(`wrote ${out}`);
