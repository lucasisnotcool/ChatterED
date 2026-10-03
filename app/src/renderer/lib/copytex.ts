/**
 * **Copying rendered maths out of the chat** (2026-10-03).
 *
 * KaTeX draws a formula twice (MathML for screen readers, spans for the eye), so a plain copy of
 * a chat turn put both on the clipboard: "hmax⁡h_{\max}". This puts the TeX back instead, as
 * `$…$` or `$$…$$`, which pastes cleanly into the notes, Notion, Obsidian, Overleaf or a chat. The
 * HTML is left as it is, and it keeps the TeX annotation, which the notes' paste reads
 * (`pm/mathpaste.ts`).
 *
 * KaTeX's own `contrib/copy-tex` does the same but ignores a copy something else has already
 * handled, and the notes editor handles its own (`pm/math.ts`, `clipboardTextSerializer`): so this
 * is that extension, standing aside when the event is already taken.
 */

function closestKatex(node: Node): Element | null {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest('.katex') ?? null;
}

/** A fragment's text, with each KaTeX formula as its TeX in dollars. */
export function textWithTex(fragment: DocumentFragment): string {
  for (const display of Array.from(fragment.querySelectorAll('.katex-display'))) {
    const tex = display.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim();
    if (tex) display.replaceWith(`$$${tex}$$`);
  }
  for (const formula of Array.from(fragment.querySelectorAll('.katex'))) {
    const tex = formula.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim();
    if (tex) formula.replaceWith(`$${tex}$`);
  }
  return fragment.textContent ?? '';
}

export function installCopyTex(): void {
  document.addEventListener('copy', (event: ClipboardEvent) => {
    if (event.defaultPrevented || !event.clipboardData) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0).cloneRange();
    // A selection that starts or ends inside a formula takes the whole formula.
    const start = closestKatex(range.startContainer);
    if (start) range.setStartBefore(start);
    const end = closestKatex(range.endContainer);
    if (end) range.setEndAfter(end);
    const fragment = range.cloneContents();
    if (!fragment.querySelector('.katex-mathml')) return;
    const html = Array.from(fragment.childNodes)
      .map((node) => (node instanceof Element ? node.outerHTML : (node.textContent ?? '')))
      .join('');
    event.clipboardData.setData('text/html', html);
    event.clipboardData.setData('text/plain', textWithTex(fragment));
    event.preventDefault();
  });
}
