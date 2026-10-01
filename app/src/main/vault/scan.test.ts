/**
 * The scan and its skip rules (issue #22 decision 1).
 *
 * Against a real temp tree rather than a mocked fs: the rules being tested are about symlinks,
 * dot-directories and file sizes, and a mock of `readdirSync` would be a test of my idea of
 * what `readdirSync` does. The same reasoning is why claude-cli.test.ts builds a real binary
 * on a real temp PATH.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, extensionOf, kindFor, skipDir } from './kinds.js';
import { scanVault, topicForPath } from './scan.js';

let root = '';

function write(rel: string, body = 'x'): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, body);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'chattered-vault-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('kindFor', () => {
  it('classifies the kinds the viewers exist for', () => {
    expect(kindFor('lecture.pdf')).toBe('pdf');
    expect(kindFor('NOTES.MD')).toBe('markdown');
    expect(kindFor('brief.txt')).toBe('text');
    expect(kindFor('solve.py')).toBe('code');
    expect(kindFor('figure.SVG')).toBe('image');
    expect(kindFor('lecture.key')).toBe('other');
    expect(kindFor('Makefile')).toBe('other');
  });

  it('reads the extension off the last dot only', () => {
    expect(extensionOf('week 4 (final).v2.pdf')).toBe('pdf');
    expect(extensionOf('Makefile')).toBe('');
    expect(extensionOf('.gitignore')).toBe('');
    expect(extensionOf('trailing.')).toBe('');
  });
});

describe('scanVault', () => {
  it('walks recursively and reports POSIX-relative paths, sorted', () => {
    write('MA3236/Week 4/lecture.pdf');
    write('MA3236/notes.md');
    write('CS3249/brief.txt');
    write('readme.md');

    const scan = scanVault(root);
    expect(scan.files.map((f) => f.relPath)).toEqual([
      'CS3249/brief.txt',
      'MA3236/Week 4/lecture.pdf',
      'MA3236/notes.md',
      'readme.md',
    ]);
    expect(scan.files.find((f) => f.name === 'lecture.pdf')?.kind).toBe('pdf');
  });

  it('is byte-stable across two scans of an unchanged tree', () => {
    write('b.md');
    write('a.md');
    write('Zed/c.md');
    const first = scanVault(root).files.map((f) => f.relPath);
    const second = scanVault(root).files.map((f) => f.relPath);
    expect(second).toEqual(first);
    // The topic file list reaches a cached prompt prefix; §E.2 forbids volatility before the
    // last breakpoint, and an unsorted directory listing is exactly that.
    expect(first).toEqual([...first].sort());
  });

  it('skips node_modules, .git, dotfiles and dot-directories', () => {
    write('MA3236/keep.md');
    write('MA3236/node_modules/pkg/index.js');
    write('.git/config');
    write('.obsidian/workspace.json');
    write('MA3236/.DS_Store');

    const scan = scanVault(root);
    expect(scan.files.map((f) => f.relPath)).toEqual(['MA3236/keep.md']);
    const reasons = Object.fromEntries(scan.skipped.map((s) => [s.relPath, s.reason]));
    expect(reasons['MA3236/node_modules']).toBe('denylisted');
    expect(reasons['.git']).toBe('dotfile');
    expect(reasons['.obsidian']).toBe('dotfile');
    expect(reasons['MA3236/.DS_Store']).toBe('dotfile');
  });

  it('names the denylist and the dot rule separately, because they are different mistakes', () => {
    expect(skipDir('node_modules')?.reason).toBe('denylisted');
    expect(skipDir('.venv')?.reason).toBe('dotfile');
    expect(skipDir('MA3236')).toBeNull();
  });

  it('does not follow symlinks, in or out of the vault', () => {
    write('MA3236/real.md');
    mkdirSync(join(root, 'MA3236', 'sub'), { recursive: true });
    symlinkSync(join(root, 'MA3236'), join(root, 'loop'), 'dir');
    symlinkSync(join(root, 'MA3236', 'real.md'), join(root, 'alias.md'), 'file');

    const scan = scanVault(root);
    expect(scan.files.map((f) => f.relPath)).toEqual(['MA3236/real.md']);
    expect(scan.skipped.filter((s) => s.detail === 'symlink').map((s) => s.relPath).sort()).toEqual([
      'alias.md',
      'loop',
    ]);
  });

  it('skips a file over the 200 MB cap without skipping its siblings', () => {
    write('MA3236/small.pdf');
    write('MA3236/huge.mov');
    // Sparse: the cap is about st.size, and writing 200 MB of real bytes in a unit test is rude.
    truncateSync(join(root, 'MA3236', 'huge.mov'), MAX_FILE_BYTES + 1);

    const scan = scanVault(root);
    expect(scan.files.map((f) => f.name)).toEqual(['small.pdf']);
    expect(scan.skipped.find((s) => s.relPath === 'MA3236/huge.mov')?.reason).toBe('too-big');
  });

  it('stops at maxDepth rather than descending forever', () => {
    write('a/b/c/d/e/deep.md');
    const scan = scanVault(root, { maxDepth: 3 });
    expect(scan.files).toEqual([]);
    expect(scan.skipped.some((s) => s.reason === 'too-deep')).toBe(true);
  });

  it('honours maxFiles so a vault root of / cannot hang the app', () => {
    for (let i = 0; i < 20; i += 1) write(`bulk/f${String(i).padStart(2, '0')}.md`);
    expect(scanVault(root, { maxFiles: 5 }).files.length).toBeLessThanOrEqual(5);
  });
});

describe('topic promotion', () => {
  it('puts a file under the deepest promoted folder that contains it', () => {
    expect(topicForPath('MA3236/Week 4/x.pdf', ['MA3236'])).toBe('MA3236');
    expect(topicForPath('MA3236/Week 4/x.pdf', ['MA3236', 'MA3236/Week 4'])).toBe('MA3236/Week 4');
    // Not a prefix match on the string: 'MA32' must not swallow 'MA3236'.
    expect(topicForPath('MA3236/x.pdf', ['MA32'])).toBeNull();
    expect(topicForPath('loose.md', ['MA3236'])).toBeNull();
  });
});
