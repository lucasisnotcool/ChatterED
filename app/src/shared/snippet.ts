/**
 * How a full-text snippet crosses the IPC boundary (issue #22 decision 2).
 *
 * SQLite's `snippet()` wraps each matched term in a pair of delimiters we choose. They are two
 * Private Use Area code points, because those cannot occur in a PDF text layer, in Markdown or
 * in source code, so the renderer can split on them with nothing escaped first.
 *
 * The delimiters are deliberately *not* `<b>` and `</b>`. A search result is untrusted file
 * content — whatever happens to be on the learner's disk — and a main process that handed the
 * renderer HTML to inject would be an injection point. The renderer splits and renders each run
 * as text.
 *
 * Shared rather than duplicated: the main process writes them, the renderer reads them, and a
 * disagreement about which character it is would show up as a snippet with two invisible boxes
 * in it, which is exactly the kind of bug nobody files.
 */
export const SNIPPET_OPEN = '\uE000';
export const SNIPPET_CLOSE = '\uE001';

export interface SnippetRun {
  text: string;
  match: boolean;
}

export function splitSnippet(snippet: string): SnippetRun[] {
  const out: SnippetRun[] = [];
  let rest = snippet;
  for (;;) {
    const open = rest.indexOf(SNIPPET_OPEN);
    if (open === -1) break;
    const close = rest.indexOf(SNIPPET_CLOSE, open);
    if (close === -1) break;
    if (open > 0) out.push({ text: rest.slice(0, open), match: false });
    out.push({ text: rest.slice(open + SNIPPET_OPEN.length, close), match: true });
    rest = rest.slice(close + SNIPPET_CLOSE.length);
  }
  if (rest.length > 0) out.push({ text: rest, match: false });
  return out;
}
