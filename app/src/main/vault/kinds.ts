/**
 * What a file in the vault *is*, and what the scan refuses to look at (issue #22 decision 1).
 *
 * Pure: no fs, no SQLite, no Electron. Everything here is decided from a file name and a size,
 * which is what makes the skip rules testable without a fixture tree.
 */

export type FileKind = 'pdf' | 'markdown' | 'text' | 'code' | 'image' | 'other';

/**
 * The cap from issue #22. It is a *scan* rule, not an index rule: a 200 MB file is not listed
 * at all, because the thing a student has that is over 200 MB is a video or a disk image, and
 * putting it in the tree costs a stat, a row and a line of screen for something with no viewer.
 */
export const MAX_FILE_BYTES = 200 * 1024 * 1024;

/** Anything bigger than this is listed but never text-extracted (a 40 MB .log is not reading). */
export const MAX_INDEX_BYTES = 32 * 1024 * 1024;

const MARKDOWN = new Set(['md', 'markdown', 'mdx', 'mdown']);
const TEXT = new Set(['txt', 'text', 'rtf', 'log', 'csv', 'tsv', 'tex', 'bib', 'org', 'rst']);
const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'heic', 'avif']);
const CODE = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'ipynb', 'r', 'jl', 'm', 'c', 'h', 'cc', 'cpp',
  'hpp', 'java', 'kt', 'swift', 'go', 'rs', 'rb', 'php', 'sh', 'zsh', 'bash', 'sql', 'html',
  'css', 'scss', 'json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'cfg', 'gradle', 'lua', 'pl',
]);

/** Lower-cased extension without the dot. '' for a name with no extension. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

export function kindFor(name: string): FileKind {
  const ext = extensionOf(name);
  if (ext === 'pdf') return 'pdf';
  if (MARKDOWN.has(ext)) return 'markdown';
  if (IMAGE.has(ext)) return 'image';
  if (CODE.has(ext)) return 'code';
  if (TEXT.has(ext)) return 'text';
  return 'other';
}

/** The three kinds the full-text indexer can read. Images and `other` are listed, never indexed. */
export function isIndexable(kind: FileKind): boolean {
  return kind === 'pdf' || kind === 'markdown' || kind === 'text' || kind === 'code';
}

/**
 * Directory names the scan never descends into. The issue says ".gitignore-ish defaults"; this
 * is that list, kept fixed rather than parsed out of a .gitignore, because a vault is a
 * *student's notes folder*, not a repository, and the only .gitignore it is likely to contain
 * belongs to one project buried three levels down — whose rules would then be applied to the
 * whole vault. A fixed list is wrong in the same way every time, which is debuggable.
 */
export const SKIPPED_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', '.venv', 'venv', '__pycache__', '.mypy_cache',
  '.pytest_cache', '.tox', 'dist', 'build', 'out', 'target', '.next', '.nuxt', '.cache',
  '.gradle', '.idea', '.vscode', 'Pods', 'DerivedData', '.Trash', '.DS_Store',
]);

export interface SkipReason {
  reason: 'dotfile' | 'denylisted' | 'too-big' | 'not-a-file' | 'too-deep';
  detail?: string;
}

/** Dotfiles and dot-directories are skipped wholesale: nothing a learner studies starts with '.'. */
export function skipDir(name: string): SkipReason | null {
  if (name.startsWith('.')) return { reason: 'dotfile' };
  if (SKIPPED_DIRS.has(name)) return { reason: 'denylisted' };
  return null;
}

export function skipFile(name: string, size: number): SkipReason | null {
  if (name.startsWith('.')) return { reason: 'dotfile' };
  if (SKIPPED_DIRS.has(name)) return { reason: 'denylisted' };
  if (size > MAX_FILE_BYTES) return { reason: 'too-big', detail: `${Math.round(size / 1048576)} MB` };
  return null;
}
