// KaTeX and highlight.js ship their own stylesheets; without them the maths renders as a pile
// of unstyled spans and the code is monochrome. Both are bundled by Vite as same-origin assets
// (KaTeX's font files included), which is what the renderer's `font-src 'self'` covers.
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github.css';
import './styles/app.css';
import App from './App.svelte';
import { mount } from 'svelte';

mount(App, { target: document.getElementById('app')! });
