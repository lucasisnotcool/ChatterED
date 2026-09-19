/**
 * **The editor pane, if it is there yet** (#48, T4 ↔ T5).
 *
 * The contract has T4 export `components/notes/NotesPane.svelte` taking `{ fileId }`, and has
 * this track mount it in the middle column. The two are built in parallel, so for as long as
 * that file does not exist the shell has to compile, run and be looked at without it.
 *
 * A plain `await import('../notes/NotesPane.svelte')` cannot do that: Vite resolves dynamic
 * imports at transform time and a missing module is a build error, not a rejected promise.
 * `import.meta.glob` is the one form that answers *"is this file here?"* — it returns an empty
 * record when nothing matches and a loader the moment the file lands, with no change here.
 *
 * The cast is because the renderer's tsconfig does not pull in `vite/client`. It survives the
 * type check and disappears before Vite sees the file: esbuild strips the annotation, so what
 * the import analyser gets is the literal `import.meta.glob('…')` it requires.
 */

interface GlobbingMeta {
  glob(pattern: string): Record<string, () => Promise<Record<string, unknown>>>;
}

/** A Svelte component, as much of one as this file needs to know. */
export type PaneComponent = unknown;

export async function loadNotesPane(): Promise<PaneComponent | null> {
  const found = (import.meta as unknown as GlobbingMeta).glob('../notes/NotesPane.svelte');
  const loader = found['../notes/NotesPane.svelte'];
  if (!loader) return null;
  const module = await loader();
  return module.default ?? null;
}
