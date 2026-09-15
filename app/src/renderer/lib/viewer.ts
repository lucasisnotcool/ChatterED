/**
 * The route from an application-menu item to whichever document viewer is on screen.
 *
 * A plain module registry rather than a store field, on purpose: it holds a function, not
 * state — nothing renders differently because a viewer is registered — and putting a callback
 * in `$state` would make every menu keystroke a reactive update for the whole app.
 *
 * Exactly one viewer is ever registered: the Library's document pane and the room's source pane
 * are never both interactive at once, and the room's is `locked` and does not register at all.
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

let active: ((command: ViewerCommand) => void) | null = null;

/** Returns the unregister function, so a component can hand it straight back from `$effect`. */
export function registerViewer(handler: (command: ViewerCommand) => void): () => void {
  active = handler;
  return () => {
    if (active === handler) active = null;
  };
}

/** False when no viewer is open — the caller then knows the keystroke did nothing. */
export function runViewerCommand(command: ViewerCommand): boolean {
  if (!active) return false;
  active(command);
  return true;
}
