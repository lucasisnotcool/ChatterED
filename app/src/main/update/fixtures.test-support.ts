/**
 * Fixtures for the updater's tests: real ad-hoc signed bundles whose executable is a shell script,
 * a fake fetch over an in-memory map, and an engine wired to a temp folder. Test support only.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';
import { UpdateEngine, type EngineConfig } from './engine.js';
import { APP_ID, keyId, type TrustedKey } from './manifest.js';

export const mac = process.platform === 'darwin' && existsSync('/usr/bin/codesign') && existsSync('/usr/bin/ditto');
const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

export function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'chattered-engine-'));
  roots.push(d);
  return d;
}

export const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
export const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
export const KEYS: TrustedKey[] = [{ id: keyId(pem)!, role: 'active', pem }];

/**
 * A real, ad-hoc signed bundle whose executable is a shell script that answers the smoke launch
 * the way the app's bootstrap does (or fails to, with `smoke: 'fail'`).
 */
export function makeApp(dir: string, build: number, o: { smoke?: 'ok' | 'fail' | 'wrong_build'; study?: boolean; id?: string } = {}): string {
  const app = join(dir, 'ChatterED.app');
  mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true });
  mkdirSync(join(app, 'Contents', 'Resources'), { recursive: true });
  writeFileSync(
    join(app, 'Contents', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${o.id ?? APP_ID}</string>
<key>CFBundleExecutable</key><string>ChatterED</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>${build}</string>
</dict></plist>
`,
  );
  const answer = o.smoke === 'fail' ? '{"ok":false,"stage":"boot"}' : `{"ok":true,"stage":"ready","build":${o.smoke === 'wrong_build' ? build + 1 : build}}`;
  writeFileSync(
    join(app, 'Contents', 'MacOS', 'ChatterED'),
    `#!/bin/bash
for a in "$@"; do case "$a" in --chattered-smoke=*) ok="\${a#--chattered-smoke=}" ;; esac; done
[ -n "\${ok:-}" ] && echo '${answer}' > "$ok"
exit 0
`,
    { mode: 0o755 },
  );
  if (o.study) {
    mkdirSync(join(app, 'Contents', 'Resources', 'study'));
    writeFileSync(join(app, 'Contents', 'Resources', 'study', 'keys.json'), '{}');
  }
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '-s', '-', app], { stdio: 'ignore' });
  return app;
}

export function zipOf(app: string, out: string): Buffer {
  execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, out]);
  return readFileSync(out);
}

export function cdhash(app: string): string {
  const { stderr } = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=4', app], { encoding: 'utf8' });
  return /^CDHash=([0-9a-f]+)$/m.exec(stderr)![1]!;
}

export interface World {
  engine: UpdateEngine;
  userData: string;
  logFile: string;
  spawned: string[][];
  served: Map<string, Buffer>;
  cfg: EngineConfig;
}

export function world(over: Partial<EngineConfig> = {}): World {
  const root = tmp();
  const installed = join(root, 'Applications');
  mkdirSync(installed);
  const bundle = makeApp(installed, 500);
  const userData = join(root, 'userData');
  mkdirSync(userData);
  const served = new Map<string, Buffer>();
  const spawned: string[][] = [];
  const fakeFetch = (async (url: string | URL | Request) => {
    const body = served.get(String(url));
    if (!body) return new Response('missing', { status: 404 });
    return new Response(new Uint8Array(body));
  }) as typeof fetch;
  const cfg: EngineConfig = {
    bundlePath: bundle,
    appId: APP_ID,
    productName: 'ChatterED',
    swapTool: null,
    installId: 'install0001',
    role: 'main',
    userDataDir: userData,
    currentBuild: 500,
    sha: 'abc',
    channel: 'study',
    keys: KEYS,
    manifestUrls: ['https://example.test/study-manifest-v1.json'],
    allowHttp: false,
    osVersion: '15.0',
    logFile: join(root, 'logs', 'main.log'),
    logBase: { build: 500 },
    pid: process.pid,
    fetch: fakeFetch,
    spawnHelper: (_script, args) => spawned.push(args),
    smokeTimeoutSeconds: 20,
    ...over,
  };
  return { engine: new UpdateEngine(cfg), userData, logFile: cfg.logFile, spawned, served, cfg };
}

export function publish(w: World, payloadApp: string, over: Record<string, unknown> = {}): Buffer {
  const zip = zipOf(payloadApp, join(tmp(), 'p.zip'));
  const url = `https://example.test/ChatterED-${String(over.build ?? 501)}.zip`;
  w.served.set(url, zip);
  const m = Buffer.from(
    JSON.stringify({
      format: 'chattered-update',
      schema: 1,
      appId: APP_ID,
      arch: 'arm64',
      channel: 'study',
      build: 501,
      version: '0.1.0',
      url,
      size: zip.length,
      sha256: createHash('sha256').update(zip).digest('hex'),
      cdhash: cdhash(payloadApp),
      minOs: '13.0',
      dbSchema: 34,
      publishedAt: '2026-11-18T00:00:00Z',
      ...over,
    }),
  );
  w.served.set('https://example.test/study-manifest-v1.json', m);
  w.served.set('https://example.test/study-manifest-v1.json.sig', sign('sha256', m, privateKey));
  return m;
}

export function events(w: World): { event: string; [k: string]: unknown }[] {
  if (!existsSync(w.logFile)) return [];
  return readFileSync(w.logFile, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { event: string });
}

