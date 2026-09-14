/**
 * "Is there a local Claude CLI, and is it logged in?" — asked once, cached, and never on the
 * critical path of a turn.
 *
 * Finding the binary is cheap (a few `access()` calls). Proving the login is not: it costs one
 * real round trip. So the probe runs once, its verdict goes in the settings table, and the room
 * reads the cache. It is re-run when the learner presses "Check again" in Settings, or when the
 * cache is older than `MAX_CACHE_AGE_MS` — long enough that launching the app does not cost a
 * model call, short enough that a login that has since expired is noticed the same day.
 *
 * The probe is the cheapest call that still exercises auth (issue #19):
 *
 *   claude -p "ping" --model haiku --tools "" --output-format json --no-session-persistence
 *
 * `--output-format json` (not stream-json) so no `--verbose` is needed and the whole answer is
 * one object. 30 s timeout: a cold CLI on a busy Mac has been seen to take ~8 s.
 */
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { buildPath, looksNotLoggedIn, resolveClaudeBinary } from './claude-cli.js';
import type { CliStatus } from '../../shared/types.js';
import type { SettingsRepo } from '../db/repos/core.js';

export const DETECT_TIMEOUT_MS = 30_000;
export const MAX_CACHE_AGE_MS = 12 * 60 * 60 * 1000;

export const SETTINGS_KEYS = {
  backend: 'llm_backend',
  cliPathOverride: 'claude_cli_path',
  cliAgentModel: 'cli_model_agents',
  cliOrchestratorModel: 'cli_model_orchestrator',
  detection: 'claude_cli_detection',
} as const;

/** The plain shape the renderer sees, so a detection can cross IPC unchanged. */
export type CliDetection = CliStatus;

export const NOT_FOUND: CliDetection = {
  found: false,
  path: null,
  loggedIn: null,
  detail: 'Claude Code was not found on this Mac.',
  checkedAt: '',
};

export const NOT_LOGGED_IN_HINT = 'Claude Code is installed but not logged in — run `claude` once in Terminal and sign in.';

export interface DetectDeps {
  settings: SettingsRepo;
  now: () => string;
  env?: NodeJS.ProcessEnv;
  /** Injectable so the tests can point at a fake binary without a temp PATH dance. */
  probe?: (binary: string, env: NodeJS.ProcessEnv) => Promise<ProbeResult>;
}

export interface ProbeResult {
  ok: boolean;
  loggedIn: boolean;
  detail: string | null;
}

export function readCachedDetection(settings: SettingsRepo): CliDetection | null {
  const raw = settings.get(SETTINGS_KEYS.detection);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CliDetection;
    if (typeof parsed.found !== 'boolean') return null;
    return parsed;
  } catch {
    return null;
  }
}

function isFresh(detection: CliDetection, now: number): boolean {
  const at = Date.parse(detection.checkedAt);
  return Number.isFinite(at) && now - at < MAX_CACHE_AGE_MS;
}

/**
 * Returns the cached verdict when it is fresh and the binary is still where it was, and runs
 * the probe otherwise. `force` is the "Check again" button.
 */
export async function detectClaudeCli(deps: DetectDeps, force = false): Promise<CliDetection> {
  const env = deps.env ?? process.env;
  const override = deps.settings.get(SETTINGS_KEYS.cliPathOverride) ?? null;
  const path = resolveClaudeBinary({ override, env });

  if (!path) {
    const verdict: CliDetection = {
      ...NOT_FOUND,
      detail:
        (override ?? '').trim().length > 0
          ? `The Claude CLI path in Settings (${override}) is not an executable file.`
          : NOT_FOUND.detail,
      checkedAt: deps.now(),
    };
    writeDetection(deps, verdict);
    return verdict;
  }

  const cached = readCachedDetection(deps.settings);
  if (!force && cached && cached.found && cached.path === path && isFresh(cached, Date.now())) return cached;

  const probe = deps.probe ?? probeLogin;
  let result: ProbeResult;
  try {
    result = await probe(path, env);
  } catch (err) {
    result = { ok: false, loggedIn: false, detail: (err as Error).message };
  }

  const verdict: CliDetection = {
    found: true,
    path,
    loggedIn: result.loggedIn,
    detail: result.loggedIn ? null : (result.detail ?? NOT_LOGGED_IN_HINT),
    checkedAt: deps.now(),
  };
  writeDetection(deps, verdict);
  return verdict;
}

function writeDetection(deps: DetectDeps, verdict: CliDetection): void {
  deps.settings.set(SETTINGS_KEYS.detection, JSON.stringify(verdict), deps.now());
}

/** One real `haiku` round trip. The cheapest call that still proves the subscription answers. */
export function probeLogin(binary: string, env: NodeJS.ProcessEnv = process.env): Promise<ProbeResult> {
  const args = [
    '-p',
    'ping',
    '--model',
    'haiku',
    '--tools',
    '',
    '--output-format',
    'json',
    '--no-session-persistence',
    '--strict-mcp-config',
    '--setting-sources',
    '',
    '--disable-slash-commands',
  ];
  return new Promise<ProbeResult>((resolve) => {
    const child = spawn(binary, args, {
      cwd: tmpdir(),
      env: { ...env, PATH: buildPath(env) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    let settled = false;
    const done = (result: ProbeResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      done({ ok: false, loggedIn: false, detail: `The Claude CLI did not answer within ${DETECT_TIMEOUT_MS / 1000}s.` });
    }, DETECT_TIMEOUT_MS);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (c: string) => {
      out += c;
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c: string) => {
      err += c;
    });
    child.on('error', (e) => done({ ok: false, loggedIn: false, detail: (e as Error).message }));
    child.on('close', (code) => done(readProbe(code, out, err)));
  });
}

/** Split out from the spawn so the unit tests can drive every branch without a process. */
export function readProbe(code: number | null, stdout: string, stderr: string): ProbeResult {
  const combined = `${stdout}\n${stderr}`;
  if (looksNotLoggedIn(combined)) return { ok: false, loggedIn: false, detail: NOT_LOGGED_IN_HINT };
  if (code !== 0) {
    return { ok: false, loggedIn: false, detail: `The Claude CLI exited ${code}: ${stderr.trim().slice(0, 200) || 'no output'}` };
  }
  try {
    const parsed = JSON.parse(stdout.trim()) as { is_error?: boolean; result?: string; subtype?: string };
    if (parsed.is_error === true) {
      const detail = (parsed.result ?? '').trim();
      if (looksNotLoggedIn(detail)) return { ok: false, loggedIn: false, detail: NOT_LOGGED_IN_HINT };
      return { ok: false, loggedIn: false, detail: detail.slice(0, 200) || 'The Claude CLI reported an error.' };
    }
    return { ok: true, loggedIn: true, detail: null };
  } catch {
    return { ok: false, loggedIn: false, detail: `The Claude CLI answered with something that is not JSON: ${stdout.trim().slice(0, 120)}` };
  }
}
