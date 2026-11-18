/**
 * **The updater's contract: it depends on nothing it could be broken by.** The stage-0 bootstrap
 * and everything under `update/` may import Electron, Node's built-ins and each other, nothing
 * else; `index.js` is reached only by the bootstrap's guarded `import()`, and the debug report
 * only by `failure.ts`'s guarded `require`. `runtime.ts`, which `index.ts` reads, imports nothing.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const HERE = __dirname;
const sources = readdirSync(HERE)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.test-support.ts'))
  .map((f) => join(HERE, f));
sources.push(join(HERE, '..', 'bootstrap.ts'));

function specifiers(file: string): { static: string[]; dynamic: string[] } {
  const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const stat = [...text.matchAll(/^\s*import\s[^'"]*?from\s+['"]([^'"]+)['"]/gm), ...text.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]!);
  const dyn = [...text.matchAll(/(?:import|require)\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]!);
  return { static: stat, dynamic: dyn };
}

describe('the updater imports nothing of the app', () => {
  it.each(sources.map((s) => [s.slice(s.lastIndexOf('/') + 1), s]))('%s', (_name, file) => {
    const { static: stat, dynamic } = specifiers(file);
    const isBootstrap = file.endsWith('bootstrap.ts');
    for (const s of stat) {
      const ok = s === 'electron' || s.startsWith('node:') || (isBootstrap ? s.startsWith('./update/') : s.startsWith('./') && !s.includes('/', 2));
      expect(ok, `${file} imports ${s}`).toBe(true);
    }
    for (const s of dynamic) {
      const ok =
        s.startsWith('node:') ||
        (isBootstrap && (s === './index.js' || s === './debug/index.js' || s === 'better-sqlite3')) ||
        (file.endsWith('failure.ts') && s === '../debug/index.js');
      expect(ok, `${file} loads ${s} at run time`).toBe(true);
    }
  });

  it('runtime.ts imports nothing at all', () => {
    const { static: stat, dynamic } = specifiers(join(HERE, 'runtime.ts'));
    expect([...stat, ...dynamic]).toEqual([]);
  });

  it('package.json starts the app at the bootstrap', () => {
    const pkg = JSON.parse(readFileSync(join(HERE, '..', '..', '..', 'package.json'), 'utf8')) as { main: string };
    expect(pkg.main).toBe('dist/main/bootstrap.js');
  });
});
