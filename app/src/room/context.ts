/**
 * One door into prompt assembly, with scope as a required choice.
 *
 * The two builders live in separate modules on purpose: `buildGroupContext` must not even be
 * able to *reach* the whispers repository through its import graph (architecture-mac.md §D.4).
 * Importing this file gives you both; importing `context.group.js` gives you only the safe one.
 */
export { buildGroupContext, type GroupContextInput } from './context.group.js';
export { buildWhisperContext, type WhisperContextInput } from './context.whisper.js';
