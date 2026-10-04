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
 *
 * **A registration can decline** (2026-10-04). The tutorial sits beside the notes, both on
 * screen at once, and ⌘+ must zoom the one the learner is working in. The tutorial registers
 * with `wants`, true while it is the pane in focus; when it declines, the command falls to the
 * registration below it (the notes). One with no `wants` always answers, as the slide modal does.
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

interface Entry {
  handler: (command: ViewerCommand) => void;
  wants: (() => boolean) | undefined;
}

const stack: Entry[] = [];

/** Returns the unregister function, so a component can hand it straight back from `$effect`. */
export function registerViewer(handler: (command: ViewerCommand) => void, wants?: () => boolean): () => void {
  const entry: Entry = { handler, wants };
  stack.push(entry);
  return () => {
    const at = stack.lastIndexOf(entry);
    if (at >= 0) stack.splice(at, 1);
  };
}

/** False when no viewer took it — the caller then knows the keystroke did nothing. */
export function runViewerCommand(command: ViewerCommand): boolean {
  for (let i = stack.length - 1; i >= 0; i--) {
    const entry = stack[i]!;
    if (entry.wants && !entry.wants()) continue;
    entry.handler(command);
    return true;
  }
  return false;
}
