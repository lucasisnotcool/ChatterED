/**
 * **Maths pasted from a rendered page, read back as TeX** (2026-10-03).
 *
 * A formula on a web page is drawn twice, once as MathML for screen readers and once as styled
 * spans, so its plain text comes out doubled and garbled ("lim⁡x→a… \lim_{x\to a}…", the ChatGPT
 * page selected and copied). Every renderer that matters also keeps the source somewhere, and this
 * reads it from there, before ProseMirror parses the HTML:
 *
 *  1. **KaTeX** (ChatGPT, Claude.ai, this app's own chat): `annotation[encoding="application/x-tex"]`
 *     inside `.katex`; `.katex-display` says it was a display formula.
 *  2. **MathJax 2** (StackExchange, arXiv listings): `<script type="math/tex">`, `; mode=display`
 *     for display. Its rendered copies are dropped.
 *  3. **MathJax 3** (`mjx-container`) and **MathML** (Wikipedia, most of the rest): the TeX
 *     annotation or `alttext` when there is one, and otherwise the MathML converted
 *     (`mathml-to-latex`). Wikipedia's fallback image goes with it.
 *
 * Each becomes what `schema.ts` parses: `<span data-tex>` for inline maths and
 * `<div data-math-block>` for display. Word's own equations (OMML in conditional comments) are not
 * read: Word pastes a picture of them, which is noted as a limitation.
 */

import { MathMLToLaTeX } from 'mathml-to-latex';

const TEX_ANNOTATION = 'annotation[encoding="application/x-tex"], annotation[encoding="TeX"]';

/** Wikipedia wraps every formula's TeX in `{\displaystyle …}`; the notes say which kind it is. */
function unwrap(tex: string): string {
  const match = /^\{\\(?:displaystyle|textstyle)\s*([\s\S]*)\}$/.exec(tex.trim());
  return (match?.[1] ?? tex).trim();
}

function texOfMath(math: Element): string | null {
  const annotated = math.querySelector(TEX_ANNOTATION)?.textContent?.trim();
  if (annotated) return unwrap(annotated);
  const alt = math.getAttribute('alttext')?.trim();
  if (alt) return unwrap(alt);
  try {
    const converted = MathMLToLaTeX.convert(math.outerHTML).trim();
    return converted.length > 0 ? converted : null;
  } catch {
    return null;
  }
}

function replaceWithMath(doc: Document, target: Element, tex: string, display: boolean): void {
  if (display) {
    const div = doc.createElement('div');
    div.setAttribute('data-math-block', '');
    div.setAttribute('data-tex', tex);
    target.replaceWith(div);
    return;
  }
  const span = doc.createElement('span');
  span.setAttribute('data-tex', tex);
  span.textContent = tex;
  target.replaceWith(span);
}

/** True when the HTML has any rendered maths this file reads. A cheap test before parsing. */
function mayHaveMath(html: string): boolean {
  return /katex|math\/tex|<math|mjx-container|data-tex/i.test(html);
}

export function normalisePastedMathHtml(html: string): string {
  if (!mayHaveMath(html) || typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // 1. KaTeX: display first, so its inner `.katex` is not read as a second, inline formula.
  for (const display of Array.from(doc.querySelectorAll('.katex-display'))) {
    const tex = display.querySelector(TEX_ANNOTATION)?.textContent?.trim();
    if (tex) replaceWithMath(doc, display, tex, true);
  }
  for (const inline of Array.from(doc.querySelectorAll('.katex'))) {
    const tex = inline.querySelector(TEX_ANNOTATION)?.textContent?.trim();
    if (tex) replaceWithMath(doc, inline, tex, false);
  }

  // 2. MathJax 2: the script is the source; its rendered copies are noise.
  const scripts = Array.from(doc.querySelectorAll('script[type^="math/tex"]'));
  if (scripts.length > 0) {
    for (const rendered of Array.from(doc.querySelectorAll('.MathJax_Preview, .MathJax, .MathJax_Display, .MathJax_CHTML, .MathJax_SVG, .MathJax_SVG_Display'))) {
      rendered.remove();
    }
    for (const script of scripts) {
      const tex = script.textContent?.trim();
      const display = /mode=display/.test(script.getAttribute('type') ?? '');
      if (tex) replaceWithMath(doc, script, tex, display);
      else script.remove();
    }
  }

  // 3. MathJax 3 and Wikipedia wrap their MathML; the wrapper goes, with its picture.
  for (const container of Array.from(doc.querySelectorAll('mjx-container, .mwe-math-element'))) {
    const math = container.querySelector('math');
    const tex = math ? texOfMath(math) : container.querySelector('img[alt]')?.getAttribute('alt')?.trim();
    if (!tex) continue;
    const display =
      container.getAttribute('display') === 'true' ||
      math?.getAttribute('display') === 'block' ||
      container.querySelector('.mwe-math-fallback-image-display') !== null;
    replaceWithMath(doc, container, tex, display);
  }
  // Bare MathML, whatever is left.
  for (const math of Array.from(doc.querySelectorAll('math'))) {
    const tex = texOfMath(math);
    if (tex) replaceWithMath(doc, math, tex, math.getAttribute('display') === 'block');
  }

  return doc.body.innerHTML;
}
