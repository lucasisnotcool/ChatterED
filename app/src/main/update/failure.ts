/**
 * **"ChatterED could not start"**, for `failBoot` and for a bootstrap whose `index.js` would not
 * load. Starts repair mode (a fix is checked for and swapped in, or the build is rolled back) and,
 * meanwhile, shows one native dialog with **Copy debug info**: the app's own debug report
 * (`src/main/debug/`, loaded only here and only if it loads), or the bootstrap's minimal one.
 */
import { app, clipboard, dialog } from 'electron';
import { runtime } from './runtime.js';

/** The full debug report if the debug module loads and runs; else the bootstrap's own. */
export function debugReport(error: string): string {
  try {
    // A plain require, inside try: a broken debug module must not break this dialog.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('../debug/index.js') as { buildDebugReport?: () => string };
    if (typeof m.buildDebugReport === 'function') return `${m.buildDebugReport()}\n\nstartup error: ${error}\n`;
  } catch {
    /* fall through */
  }
  return runtime().bootstrapReport(error);
}

/**
 * Repair first (it may exit the app to swap), the dialog meanwhile. Never resolves into a
 * running app: it ends in `app.exit`.
 */
export async function startupFailed(message: string, logDir: string): Promise<void> {
  const rt = runtime();
  let exiting = false;
  const repairing = rt
    .repair(message)
    .then((x) => {
      exiting = x;
    })
    .catch(() => undefined);
  if (rt.smoke) {
    await repairing;
    app.exit(1);
    return;
  }
  const name = app.getName();
  const { response } = await dialog.showMessageBox({
    type: 'error',
    message: `${name} could not start`,
    detail:
      `${message}\n\nNothing has been deleted. ${name} is checking for a fix and reopens by itself if it finds one.\n\n` +
      `If it does not, click Copy debug info and paste it into a message to the research team.\n\nThe log is in:\n${logDir}`,
    buttons: ['Quit', 'Copy debug info'],
    defaultId: 1,
    cancelId: 0,
  });
  if (exiting) return;
  if (response === 1) {
    clipboard.writeText(debugReport(message));
    await dialog.showMessageBox({
      type: 'info',
      message: 'Debug info copied',
      detail: 'Paste it into an email or chat message to the research team. It has no notes, no study code and no API key in it.',
      buttons: ['Quit'],
    });
  }
  if (!exiting) app.exit(1);
}
