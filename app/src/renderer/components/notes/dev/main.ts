/**
 * The notes surface's own dev entry (`vite dev` → `/components/notes/dev/index.html`).
 *
 * T4 owns `components/notes/**` and must not touch `App.svelte` or `mockBridge.ts`, so the way
 * to *look* at this surface before the shell mounts it is a second HTML entry of its own. It
 * runs against T5's real mock bridge — the fixture notes doc, the ingest windows, the saves —
 * and adds the buttons that fire the events a build cannot otherwise produce on demand.
 *
 * Not shipped: `vite build` only bundles `index.html`, and this file is never imported by it.
 */
import '../../../styles/app.css';
import { mount } from 'svelte';
import DevHarness from './DevHarness.svelte';

const target = document.getElementById('app');
if (target) mount(DevHarness, { target });
