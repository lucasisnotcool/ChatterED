/**
 * Markdown → HTML for the document pane (issue #22 decision 3).
 *
 * Three rules, all of them about a viewer pointed at files nobody vetted:
 *
 *  1. **Raw HTML in the source is dropped, not rendered.** These are the learner's own files,
 *     but "the learner's own files" includes the PDF-to-Markdown export they downloaded and the
 *     shared notes a coursemate sent them. A Markdown viewer that executes embedded HTML is a
 *     script-injection surface in a desktop app with IPC on the other side of it.
 *  2. **Math is rendered by KaTeX**, because NUSSync renders LaTeX and a module like MA3236 is
 *     unreadable without it. `$…$` inline and `$$…$$` display, as a marked extension rather than
 *     a post-pass over the HTML, so a `$` inside a code span is left alone.
 *  3. **Code is highlighted by highlight.js**, common languages only — the full pack is several
 *     megabytes for languages no NUS module uses.
 */
import hljs from 'highlight.js/lib/common';
import katex from 'katex';
import { marked, type Tokens } from 'marked';

export interface MarkdownHeading {
  depth: number;
  text: string;
  id: string;
}

const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-') || 'section';

function renderMath(expression: string, display: boolean): string {
  try {
    return katex.renderToString(expression, { displayMode: display, throwOnError: false, strict: false });
  } catch {
    // A broken formula shows as the source it came from. Never an error card: the rest of the
    // page is still readable, and the learner can see what they typed.
    return `<code class="math-error">${escapeHtml(display ? `$$${expression}$$` : `$${expression}$`)}</code>`;
  }
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let configured = false;

function configure(): void {
  if (configured) return;
  configured = true;

  marked.use({
    gfm: true,
    breaks: false,
    extensions: [
      {
        name: 'mathBlock',
        level: 'block',
        start: (src: string) => src.indexOf('$$'),
        tokenizer(src: string) {
          const match = /^\$\$([\s\S]+?)\$\$(?:\n+|$)/.exec(src);
          if (!match) return undefined;
          return { type: 'mathBlock', raw: match[0], text: (match[1] ?? '').trim() };
        },
        renderer: (token) => `<p class="math-display">${renderMath(String(token.text), true)}</p>`,
      },
      {
        name: 'mathInline',
        level: 'inline',
        start: (src: string) => src.indexOf('$'),
        tokenizer(src: string) {
          // No `$$` (that is the block rule), no space right after the opening `$` (so "$5 and
          // $6" is money, not maths), and no newline inside.
          const match = /^\$(?!\$)((?:[^$\n\\]|\\.)+?)\$(?!\d)/.exec(src);
          if (!match || /^\s/.test(match[1] ?? '')) return undefined;
          return { type: 'mathInline', raw: match[0], text: match[1] ?? '' };
        },
        renderer: (token) => renderMath(String(token.text), false),
      },
    ],
    renderer: {
      // Rule 1: embedded HTML is shown as the text it is, never parsed.
      html: (token: Tokens.HTML | Tokens.Tag) => escapeHtml(token.raw),
      code(token: Tokens.Code) {
        const language = (token.lang ?? '').split(/\s+/)[0] ?? '';
        const known = language && hljs.getLanguage(language);
        const body = known
          ? hljs.highlight(token.text, { language, ignoreIllegals: true }).value
          : escapeHtml(token.text);
        return `<pre class="code"><code class="hljs${known ? ` language-${escapeHtml(language)}` : ''}">${body}</code></pre>`;
      },
      heading(token: Tokens.Heading) {
        const text = this.parser.parseInline(token.tokens);
        return `<h${token.depth} id="${escapeHtml(slug(token.text))}">${text}</h${token.depth}>\n`;
      },
      // A local Markdown file may link to a sibling file or to the web. Neither is followed
      // here: the pane is a reader, not a browser, and a navigating renderer is a way out of
      // the app. The text stays, the destination is shown on hover.
      link(token: Tokens.Link) {
        const label = this.parser.parseInline(token.tokens);
        return `<span class="dead-link" title="${escapeHtml(token.href)}">${label}</span>`;
      },
      image(token: Tokens.Image) {
        return `<span class="dead-image" title="${escapeHtml(token.href)}">[image: ${escapeHtml(token.text || token.href)}]</span>`;
      },
    },
  });
}

export function renderMarkdown(source: string): string {
  configure();
  return marked.parse(source, { async: false });
}

/** The outline for the viewer's jump list. Parsed from the same tokens marked already made. */
export function headings(source: string): MarkdownHeading[] {
  configure();
  const out: MarkdownHeading[] = [];
  for (const token of marked.lexer(source)) {
    if (token.type === 'heading') {
      const heading = token as Tokens.Heading;
      out.push({ depth: heading.depth, text: heading.text, id: slug(heading.text) });
    }
  }
  return out;
}

/** Syntax-highlighted HTML for a whole source file, for the code viewer. */
export function highlightSource(text: string, ext: string): string {
  const language = hljs.getLanguage(ext) ? ext : undefined;
  return language
    ? hljs.highlight(text, { language, ignoreIllegals: true }).value
    : hljs.highlightAuto(text).value;
}
