// `npm run dev` — one command: build main+preload, start Vite for the renderer, launch Electron.
// No extra dependencies: Vite's JS API plus two child processes.
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electronPath from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, args, opts = {}) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { cwd: appDir, stdio: 'inherit', shell: false, ...opts });
    p.on('exit', (code) => (code === 0 ? res() : rej(new Error(`${cmd} exited ${code}`))));
  });
}

console.log('[dev] compiling main + preload…');
await run(process.execPath, [resolve(appDir, 'node_modules/typescript/lib/tsc.js'), '-p', 'tsconfig.main.json']);

const server = await createServer({ configFile: resolve(appDir, 'vite.config.mts') });
await server.listen();
const { port } = server.config.server;
const url = `http://localhost:${port}`;
console.log(`[dev] renderer on ${url}`);

const tscWatch = spawn(
  process.execPath,
  [resolve(appDir, 'node_modules/typescript/lib/tsc.js'), '-p', 'tsconfig.main.json', '--watch', '--preserveWatchOutput'],
  { cwd: appDir, stdio: 'inherit' },
);

// Some terminals (and agent harnesses) export ELECTRON_RUN_AS_NODE=1, which would start
// Electron as a bare Node process with no `app` object. Strip it.
const childEnv = { ...process.env, CHATTERED_DEV_SERVER: url, NODE_ENV: 'development' };
delete childEnv.ELECTRON_RUN_AS_NODE;

const electron = spawn(electronPath, ['.'], {
  cwd: appDir,
  stdio: 'inherit',
  env: childEnv,
});

const shutdown = async () => {
  tscWatch.kill();
  await server.close();
  process.exit(0);
};
electron.on('exit', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
