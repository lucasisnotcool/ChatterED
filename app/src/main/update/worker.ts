/**
 * **The updater's utilityProcess.** Checks, downloads, verifies and smoke-launches while the main
 * process is busy, hung or broken, so a fix is staged even when the app's own code is not
 * working; the next launch's bootstrap swaps it in. Imports the engine only.
 *
 * Main sends `{ type: 'config', config }` once, then `{ type: 'check', reason }` whenever it wants
 * a check now. The worker posts `{ type: 'staged', build }` and `{ type: 'checked', staged }`.
 */
import { execFile } from 'node:child_process';
import { UpdateEngine, type EngineConfig } from './engine.js';
import { CHECK_EVERY_MS, FIRST_CHECK_MS, jitter } from './plan.js';

interface ParentPort {
  on(event: 'message', fn: (e: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

const port = (process as unknown as { parentPort?: ParentPort }).parentPort;
let engine: UpdateEngine | null = null;
let timer: NodeJS.Timeout | null = null;

function schedule(ms: number): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void run('timer'), ms);
}

async function run(reason: string): Promise<void> {
  if (!engine) return;
  const staged = await engine.check(reason);
  const s = engine.readStaged();
  if (staged && s) port?.postMessage({ type: 'staged', build: s.build });
  port?.postMessage({ type: 'checked', staged });
  schedule(jitter(CHECK_EVERY_MS, 30 * 60_000, Math.random()));
}

/** Once per worker: whether the Mac is managed, which can block ad-hoc builds (logged, never acted on). */
function logEnvironment(e: UpdateEngine): void {
  execFile('/usr/bin/profiles', ['status', '-type', 'enrollment'], { timeout: 10_000 }, (err, stdout) => {
    const mdm = err ? 'unknown' : /MDM enrollment:\s*Yes/i.test(stdout) ? 'enrolled' : 'not_enrolled';
    execFile('/usr/sbin/spctl', ['--status'], { timeout: 10_000 }, (err2, out2) => {
      const gk = err2 ? 'unknown' : /enabled/.test(out2) ? 'enabled' : 'disabled';
      e.log('info', 'update.env', { mdm, gatekeeper: gk, location: e.location() });
    });
  });
}

port?.on('message', (e) => {
  const msg = e.data as { type?: string; config?: EngineConfig; reason?: string };
  if (msg.type === 'config' && msg.config && !engine) {
    engine = new UpdateEngine({ ...msg.config, role: 'worker' });
    logEnvironment(engine);
    schedule(msg.config.firstCheckMs ?? jitter(FIRST_CHECK_MS, FIRST_CHECK_MS / 2, Math.random()));
  } else if (msg.type === 'check') {
    void run(typeof msg.reason === 'string' ? msg.reason.slice(0, 20) : 'asked');
  }
});
