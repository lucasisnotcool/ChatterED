// KaTeX and highlight.js ship their own stylesheets; without them the maths renders as a pile
// of unstyled spans and the code is monochrome. Both are bundled by Vite as same-origin assets
// (KaTeX's font files included), which is what the renderer's `font-src 'self'` covers.
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github.css';
import './styles/app.css';
import App from './App.svelte';
import { mount } from 'svelte';
import { bridgeAvailable, prepareBridge } from './lib/bridge.js';
import { installDropGuard } from './lib/dropguard.js';
import { installCopyTex } from './lib/copytex.js';
import { TRIAL_CONTACT_EMAIL } from '../shared/trial.js';

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

/**
 * **No bridge, no app** (release review P1-5). In a production build a missing
 * `window.chattered` means the preload failed; drawing the app on the dev mock would look real
 * while nothing the learner typed was kept. This screen is plain DOM on purpose — it must not
 * depend on anything that might be what broke. Main logs the preload's own error (`preload.error`).
 */
function fatalScreen(target: HTMLElement): void {
  const box = document.createElement('div');
  box.setAttribute('role', 'alert');
  box.style.cssText =
    'max-width:520px;margin:18vh auto 0;padding:28px 32px;border:1px solid var(--hairline,#ddd);' +
    'border-radius:10px;background:var(--pane,#fff);font:13px/1.7 -apple-system,system-ui,sans-serif;';
  const lines: [string, string][] = [
    ['h1', 'ChatterED could not start'],
    ['p', 'The window could not connect to the rest of the app, so nothing you type here would be kept.'],
    ['p', 'Quit ChatterED (⌘Q) and open it again. Your notes and conversations are safe on this Mac.'],
    [
      'p',
      `If it happens again, use Help ▸ Report a Problem, or email ${TRIAL_CONTACT_EMAIL} and attach ` +
        'the log folder, ~/Library/Logs/ChatterED.',
    ],
  ];
  for (const [tag, text] of lines) {
    const el = document.createElement(tag);
    el.textContent = text;
    el.style.margin = tag === 'h1' ? '0 0 12px' : '0 0 10px';
    if (tag === 'h1') el.style.fontSize = '16px';
    box.appendChild(el);
  }
  target.replaceChildren(box);
}

installDropGuard(window);
// A formula copied out of the chat comes out as its TeX, not KaTeX's doubled text (`copytex.ts`).
installCopyTex();
await prepareBridge(); // dev only: the mock, when there is no Electron
const root = document.getElementById('app')!;
if (bridgeAvailable()) {
  forwardErrors();
  mount(App, { target: root });
} else {
  fatalScreen(root);
}
