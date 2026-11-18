/**
 * **Which builds this install has run**, in the settings table (`app.builds`): one entry per build,
 * with the time it first launched. It outlives log rotation, and the research export puts it in its
 * manifest (`app.builds`), so analysis can tell which build a session ran on.
 */
import type { SettingsRepo } from './db/repos/core.js';

export const BUILD_HISTORY_SETTING = 'app.builds';
const MAX_ENTRIES = 200;

export interface BuildEntry {
  build: number;
  sha: string;
  firstLaunchAt: string;
}

export function readBuildHistory(settings: Pick<SettingsRepo, 'get'>): BuildEntry[] {
  try {
    const raw = JSON.parse(settings.get(BUILD_HISTORY_SETTING) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (e): e is BuildEntry =>
        !!e && typeof e === 'object' && Number.isInteger((e as BuildEntry).build) && typeof (e as BuildEntry).firstLaunchAt === 'string',
    );
  } catch {
    return [];
  }
}

/** Add this launch's build if it is not the latest entry already. A return to an older build is a new entry. */
export function recordBuild(settings: Pick<SettingsRepo, 'get' | 'set'>, b: { build: number; sha: string; at: string }): BuildEntry[] {
  const list = readBuildHistory(settings);
  const last = list[list.length - 1];
  if (last && last.build === b.build && last.sha === b.sha) return list;
  const next = [...list, { build: b.build, sha: b.sha.slice(0, 40), firstLaunchAt: b.at }].slice(-MAX_ENTRIES);
  settings.set(BUILD_HISTORY_SETTING, JSON.stringify(next), b.at);
  return next;
}
