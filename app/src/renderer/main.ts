// KaTeX and highlight.js ship their own stylesheets; without them the maths renders as a pile
// of unstyled spans and the code is monochrome. Both are bundled by Vite as same-origin assets
// (KaTeX's font files included), which is what the renderer's `font-src 'self'` covers.
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github.css';
import './styles/app.css';
import App from './App.svelte';
import { mount } from 'svelte';

/**
 * **Renderer failures go into the same log as everything else.**
 *
 * A throw inside a Svelte effect is invisible to the main process and dies with the window, so a
 * broken render used to be diagnosable only by having DevTools already open. These two listeners
 * forward the class, the message and the source location — never a DOM node, never page text,
 * never the message body the component was rendering — over IPC, where `main.log` puts them
 * beside the turn they broke, on the same clock.
 *
 * Both are best-effort and silent on failure: an app that cannot log must still run.
 */
function forwardErrors(): void {
  const send = (input: Parameters<Window['chattered']['logRendererError']>[0]): void => {
    try {
      void window.chattered?.logRendererError(input).catch(() => undefined);
    } catch {
      /* no bridge (the mock, a test page) — nothing to forward to. */
    }
  };
  window.addEventListener('error', (e) => {
    send({
      kind: 'error',
      name: e.error instanceof Error ? e.error.name : 'Error',
      message: e.message,
      source: e.filename,
      line: e.lineno,
    });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason: unknown = e.reason;
    send({
      kind: 'unhandledrejection',
      name: reason instanceof Error ? reason.name : typeof reason,
      message: reason instanceof Error ? reason.message : String(reason),
    });
  });
}

forwardErrors();
mount(App, { target: document.getElementById('app')! });
