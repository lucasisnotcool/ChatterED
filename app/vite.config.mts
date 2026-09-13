import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';

// The renderer is a plain Svelte 5 SPA (no SvelteKit router — one window, no URLs).
// See docs/research/architecture-mac.md "Implementation notes".
export default defineConfig({
  root: resolve(import.meta.dirname, 'src/renderer'),
  base: './',
  plugins: [svelte({ configFile: resolve(import.meta.dirname, 'svelte.config.mjs') })],
  build: {
    outDir: resolve(import.meta.dirname, 'dist/renderer'),
    emptyOutDir: true,
    target: 'chrome130',
  },
  server: { port: 5273, strictPort: true },
});
