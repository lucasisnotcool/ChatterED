/**
 * The route from an application-menu item to whichever document viewer is on screen.
 *
 * A plain module registry rather than a store field, on purpose: it holds a function, not
 * state — nothing renders differently because a viewer is registered — and putting a callback
 * in `$state` would make every menu keystroke a reactive update for the whole app.
 *
 * A stack, not a slot. The page viewer and the notes are never mounted together, but the slide
 * modal opens *over* the notes: while it is up, ⌘+ zooms the slide, and when it closes the
 * notes get ⌘+ back without having to re-register. The newest registration always answers; a
 * teardown removes only its own entry, whatever order Svelte tears components down in.
 */
import type { AppCommand } from '../../shared/types.js';

export type ViewerCommand = Extract<
  AppCommand,
  'zoom.in' | 'zoom.out' | 'zoom.reset' | 'fit.width' | 'fit.page' | 'page.next' | 'page.prev'
>;

const VIEWER_COMMANDS: ReadonlySet<string> = new Set<ViewerCommand>([
  'zoom.in',
  'zoom.out',
  'zoom.reset',
  'fit.width',
  'fit.page',
  'page.next',
  'page.prev',
]);

export function isViewerCommand(command: AppCommand): command is ViewerCommand {
  return VIEWER_COMMANDS.has(command);
}

const stack: ((command: ViewerCommand) => void)[] = [];

/** Returns the unregister function, so a component can hand it straight back from `$effect`. */
export function registerViewer(handler: (command: ViewerCommand) => void): () => void {
  stack.push(handler);
  return () => {
    const at = stack.lastIndexOf(handler);
    if (at >= 0) stack.splice(at, 1);
  };
}

/** False when no viewer is open — the caller then knows the keystroke did nothing. */
export function runViewerCommand(command: ViewerCommand): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top(command);
  return true;
}
