/**
 * The vault service: everything the Library screen and the document pane can ask for
 * (issue #22 decisions 1–3), assembled from the scan, the repository and the extractors.
 *
 * Main-process only. It owns the filesystem and pdf.js; the renderer addresses a file by an
 * opaque id and never by a path, so it cannot ask this to open something it was not handed
 * (the same reasoning as the preload allowlist in src/main/ipc.ts).
 */
import { existsSync } from 'node:fs';
import { basename, join, sep } from 'node:path';
import type {
  DocumentReference,
  DocumentView,
  FinderHitView,
  IndexStatus,
  SearchHitView,
  TopicCandidateView,
  VaultFileView,
  VaultTopicView,
  VaultTreeNode,
  VaultView,
} from '../../shared/types.js';
import { readFile } from 'node:fs/promises';
import { capText, extractFile } from './extract.js';
import { rankFiles } from './finder.js';
import { isIndexable, type FileKind } from './kinds.js';
import { topicColour } from './palette.js';
import { createVaultRepo, newVaultId, type FileRow, type VaultRepo } from './repo.js';
import { scanVault, topicCandidates, topicForPath } from './scan.js';
import type { SqlDatabase } from '../db/driver.js';
import type { SettingsRepo } from '../db/repos/core.js';

/** The selection cap from issue #22 decision 4. Characters, not tokens: it is a UI promise. */
export const SELECTION_CAP = 1_500;
/** How much extracted page text a reference may attach. ~2 slide pages of prose. */
export const REFERENCE_TEXT_CAP = 6_000;
/** The topic file list in the room's system context. Names only, and not many of them (§E.2). */
export const TOPIC_FILE_LIST_CAP = 40;

const SETTINGS_VAULT_ID = 'vault_id';

export interface VaultDeps {
  db: SqlDatabase;
  settings: SettingsRepo;
  now?: () => string;
  /** Pushed whenever the view changes: a scan finished, or the indexer advanced. */
  onChanged?: (view: VaultView) => void;
}

export class VaultService {
  readonly #repo: VaultRepo;
  readonly #settings: SettingsRepo;
  readonly #now: () => string;
  readonly #onChanged: (view: VaultView) => void;

  #indexing = false;
  #indexCurrent: string | null = null;
  #stopped = false;

  constructor(deps: VaultDeps) {
    this.#repo = createVaultRepo(deps.db);
    this.#settings = deps.settings;
    this.#now = deps.now ?? (() => new Date().toISOString());
    this.#onChanged = deps.onChanged ?? (() => undefined);
  }

  // ── Identity ─────────────────────────────────────────────────────────────

  activeVaultId(): string | null {
    return this.#settings.get(SETTINGS_VAULT_ID) ?? null;
  }

  #requireVault(): { id: string; root: string } {
    const id = this.activeVaultId();
    const row = id ? this.#repo.vaults.get(id) : undefined;
    if (!row) throw new Error('No vault is open.');
    return { id: row.id, root: row.root_path };
  }

  /** Absolute path for a file id, checked against the vault root before it is ever used. */
  #absPath(file: FileRow): string {
    const vault = this.#repo.vaults.get(file.vault_id);
    if (!vault) throw new Error('That file belongs to a vault that is no longer open.');
    const abs = join(vault.root_path, ...file.rel_path.split('/'));
    // Belt and braces: rel_path comes from our own scan, but the day it comes from anywhere
    // else this is the line that stops `../../.ssh/id_ed25519` being readable over IPC.
    if (!abs.startsWith(vault.root_path + sep)) throw new Error('That file is outside the vault.');
    return abs;
  }

  // ── Opening and scanning ─────────────────────────────────────────────────

  /**
   * Point the Library at a folder. Re-opening a folder that is already a vault keeps its topics
   * and its index — the learner is choosing the same shelf, not clearing it.
   */
  open(rootPath: string): VaultView {
    const existing = this.#repo.vaults.byPath(rootPath);
    const id = existing?.id ?? newVaultId('vault');
    if (!existing) {
      this.#repo.vaults.insert({
        id,
        root_path: rootPath,
        display_name: basename(rootPath) || rootPath,
        created_at: this.#now(),
        last_scan_at: null,
      });
    }
    this.#settings.set(SETTINGS_VAULT_ID, id, this.#now());
    // §F.4 L1247's `slides_folder` still answers "where did the learner last point us", and the
    // first-run copy refers to it, so it is kept in step rather than orphaned.
    this.#settings.set('slides_folder', rootPath, this.#now());
    this.rescan();
    return this.view();
  }

  /** Re-walk the vault and reconcile. Cheap enough to run on app focus (issue #22 decision 1). */
  rescan(): VaultView {
    const { id, root } = this.#requireVault();
    if (!existsSync(root)) return this.view();
    const scan = scanVault(root);
    const topics = this.#repo.topics.forVault(id);
    const relPaths = topics.map((t) => t.rel_path);
    const byRelPath = new Map(topics.map((t) => [t.rel_path, t.id]));
    this.#repo.files.sync(
      id,
      scan.files,
      (rel) => {
        const owner = topicForPath(rel, relPaths);
        return owner === null ? null : (byRelPath.get(owner) ?? null);
      },
      this.#now(),
    );
    this.#kickIndexer();
    return this.view();
  }

  /** The depth-1 folders on offer, with the ones already promoted ticked. */
  candidates(): TopicCandidateView[] {
    const { id, root } = this.#requireVault();
    if (!existsSync(root)) return [];
    const promoted = new Set(this.#repo.topics.forVault(id).map((t) => t.rel_path));
    return topicCandidates(scanVault(root, { maxDepth: 2 })).map((c) => ({
      ...c,
      promoted: promoted.has(c.relPath),
    }));
  }

  /**
   * Set the promoted set, exactly. Anything not in `relPaths` is demoted, and its files fall
   * back to "Other" rather than disappearing — the vault is browsable whether or not the
   * learner has made up their mind (issue #22 decision 1).
   */
  promote(relPaths: string[]): VaultView {
    const { id } = this.#requireVault();
    const wanted = [...new Set(relPaths.filter((p) => p.length > 0))].sort();
    const current = this.#repo.topics.forVault(id);
    for (const t of current) if (!wanted.includes(t.rel_path)) this.#repo.topics.remove(t.id);
    wanted.forEach((relPath, i) => {
      if (current.some((t) => t.rel_path === relPath)) return;
      const name = relPath.split('/').pop() ?? relPath;
      this.#repo.topics.insert({
        id: newVaultId('topic'),
        vault_id: id,
        rel_path: relPath,
        name,
        // A folder called MA3236 is a module code; anything else is just a name, and guessing
        // harder than this would be guessing.
        module_code: /^[A-Z]{2,3}\d{4}[A-Z]?$/.test(name) ? name : null,
        colour: topicColour(relPath, i),
        sort_order: i,
        promoted_at: this.#now(),
      });
    });
    return this.rescan();
  }

  // ── Views ────────────────────────────────────────────────────────────────

  view(): VaultView {
    const id = this.activeVaultId();
    const row = id ? this.#repo.vaults.get(id) : undefined;
    if (!row) {
      return {
        rootPath: null,
        displayName: '',
        topics: [],
        otherCount: 0,
        totalFiles: 0,
        lastScanAt: null,
        index: { total: 0, done: 0, failed: 0, running: false, current: null },
      };
    }
    const counts = this.#repo.files.countsByTopic(row.id);
    const topics: VaultTopicView[] = this.#repo.topics.forVault(row.id).map((t) => ({
      id: t.id,
      name: t.name,
      relPath: t.rel_path,
      colour: t.colour,
      moduleCode: t.module_code,
      fileCount: counts.get(t.id) ?? 0,
    }));
    let total = 0;
    for (const n of counts.values()) total += n;
    return {
      rootPath: row.root_path,
      displayName: row.display_name,
      topics,
      otherCount: counts.get(null) ?? 0,
      totalFiles: total,
      lastScanAt: row.last_scan_at,
      index: this.indexStatus(),
    };
  }

  indexStatus(): IndexStatus {
    const id = this.activeVaultId();
    if (!id) return { total: 0, done: 0, failed: 0, running: false, current: null };
    const p = this.#repo.files.indexProgress(id);
    return { ...p, running: this.#indexing, current: this.#indexCurrent };
  }

  /** The file tree under one topic, or under "Other" when `topicId` is null. */
  tree(topicId: string | null): VaultTreeNode[] {
    const { id } = this.#requireVault();
    const topic = topicId === null ? null : this.#repo.topics.forVault(id).find((t) => t.id === topicId);
    if (topicId !== null && !topic) return [];
    const prefix = topic ? `${topic.rel_path}/` : '';
    const files = this.#repo.files.forTopic(topicId, id);

    const root: VaultTreeNode = { name: '', relPath: '', dir: true, children: [], file: null };
    for (const f of files) {
      const rel = f.rel_path.startsWith(prefix) ? f.rel_path.slice(prefix.length) : f.rel_path;
      const parts = rel.split('/');
      let node = root;
      for (let i = 0; i < parts.length - 1; i += 1) {
        const name = parts[i]!;
        const childPath = node.relPath ? `${node.relPath}/${name}` : name;
        let next = node.children.find((c) => c.dir && c.name === name);
        if (!next) {
          next = { name, relPath: childPath, dir: true, children: [], file: null };
          node.children.push(next);
        }
        node = next;
      }
      node.children.push({
        name: f.name,
        relPath: f.rel_path,
        dir: false,
        children: [],
        file: fileView(f),
      });
    }
    sortTree(root);
    return root.children;
  }

  find(query: string, limit = 40): FinderHitView[] {
    const id = this.activeVaultId();
    if (!id) return [];
    const topics = new Map(this.#repo.topics.forVault(id).map((t) => [t.id, t.name]));
    const files = this.#repo.files.forVault(id);
    return rankFiles(
      files.map((f) => ({ id: f.id, name: f.name, relPath: f.rel_path, row: f })),
      query,
      limit,
    ).map((hit) => ({
      fileId: hit.item.id,
      name: hit.item.name,
      relPath: hit.item.relPath,
      topicName: hit.item.row.topic_id ? (topics.get(hit.item.row.topic_id) ?? null) : null,
      kind: hit.item.row.kind,
      positions: hit.positions,
    }));
  }

  search(query: string, limit = 60): SearchHitView[] {
    const id = this.activeVaultId();
    if (!id) return [];
    const topics = new Map(this.#repo.topics.forVault(id).map((t) => [t.id, t.name]));
    const hits = this.#repo.text.search(id, query, limit);
    const out: SearchHitView[] = [];
    for (const hit of hits) {
      const file = this.#repo.files.get(hit.file_id);
      if (!file) continue;
      out.push({
        fileId: file.id,
        name: file.name,
        relPath: file.rel_path,
        topicName: file.topic_id ? (topics.get(file.topic_id) ?? null) : null,
        kind: file.kind,
        page: hit.page,
        snippet: hit.snippet,
      });
    }
    return out;
  }

  // ── One file ─────────────────────────────────────────────────────────────

  async document(fileId: string): Promise<DocumentView> {
    const file = this.#repo.files.get(fileId);
    if (!file) throw new Error('That file is not in the vault any more.');
    const absPath = this.#absPath(file);
    const base = {
      fileId: file.id,
      name: file.name,
      relPath: file.rel_path,
      absPath,
      kind: file.kind,
      ext: file.ext,
      size: file.size,
      pageCount: file.page_count,
    };
    try {
      if (file.kind === 'pdf' || file.kind === 'image') {
        const bytes = await readFile(absPath);
        return { ...base, text: null, bytes: new Uint8Array(bytes), error: null };
      }
      if (file.kind === 'other') return { ...base, text: null, bytes: null, error: null };
      const bytes = await readFile(absPath);
      return { ...base, text: bytes.toString('utf8'), bytes: null, error: null };
    } catch (err) {
      return { ...base, text: null, bytes: null, error: (err as Error).message };
    }
  }

  fileRow(fileId: string): FileRow | undefined {
    return this.#repo.files.get(fileId);
  }

  revealPath(fileId: string): string {
    const file = this.#repo.files.get(fileId);
    if (!file) throw new Error('That file is not in the vault any more.');
    return this.#absPath(file);
  }

  /**
   * The text a reference or a session carries. Prefers the FTS index (already extracted, so no
   * second pdf.js run on the click); falls back to reading the file when the page has not been
   * indexed yet, because "the app stays usable while it indexes" is a decision, not a hope.
   */
  async textFor(ref: { fileId: string; pageFrom: number | null; pageTo: number | null }): Promise<string> {
    const file = this.#repo.files.get(ref.fileId);
    if (!file) return '';
    const indexed = this.#repo.text.pages(ref.fileId, ref.pageFrom, ref.pageTo);
    if (indexed.length > 0) return capText(indexed.map((c) => c.body).join('\n\n'), REFERENCE_TEXT_CAP);
    try {
      const extracted = await extractFile(this.#absPath(file), file.kind);
      const wanted =
        ref.pageFrom === null || ref.pageTo === null
          ? extracted.chunks
          : extracted.chunks.filter((c) => c.page !== null && c.page >= ref.pageFrom! && c.page <= ref.pageTo!);
      return capText(wanted.map((c) => c.body).join('\n\n'), REFERENCE_TEXT_CAP);
    } catch {
      return '';
    }
  }

  /**
   * The topic block for the room's system prefix (issue #22 decision 5). Sorted and capped, so
   * it is byte-stable: it sits before the last cache breakpoint, where architecture-mac.md §E.2
   * forbids anything volatile. Names only — never paths, never text.
   */
  topicContext(topicId: string | null): { name: string; fileNames: string[] } | null {
    const id = this.activeVaultId();
    if (!id || topicId === null) return null;
    const topic = this.#repo.topics.forVault(id).find((t) => t.id === topicId);
    if (!topic) return null;
    const names = this.#repo.files
      .forTopic(topic.id, id)
      .map((f) => f.name)
      .sort((a, b) => (a < b ? -1 : 1))
      .slice(0, TOPIC_FILE_LIST_CAP);
    return { name: topic.name, fileNames: names };
  }

  /** The module code of a topic, when its folder name looked like one. */
  moduleCodeFor(topicId: string | null): string | null {
    const id = this.activeVaultId();
    if (!id || topicId === null) return null;
    return this.#repo.topics.forVault(id).find((t) => t.id === topicId)?.module_code ?? null;
  }

  topicForFile(fileId: string): string | null {
    return this.#repo.files.get(fileId)?.topic_id ?? null;
  }

  // ── The background indexer ───────────────────────────────────────────────

  /**
   * Incremental, one file at a time, yielding to the event loop between files. It is started by
   * a scan and by `open`, and it stops when there is nothing stale left. Single-flight: a second
   * call while it is running is a no-op, because the loop re-queries for stale files each round.
   */
  #kickIndexer(): void {
    if (this.#indexing || this.#stopped) return;
    this.#indexing = true;
    void this.#indexLoop().finally(() => {
      this.#indexing = false;
      this.#indexCurrent = null;
      this.#onChanged(this.view());
    });
  }

  async #indexLoop(): Promise<void> {
    for (;;) {
      if (this.#stopped) return;
      const id = this.activeVaultId();
      if (!id) return;
      const batch = this.#repo.files.stale(id, 8);
      if (batch.length === 0) return;
      for (const file of batch) {
        if (this.#stopped) return;
        if (!isIndexable(file.kind)) continue;
        this.#indexCurrent = file.name;
        await this.indexOne(file);
        // Yield, so a 400-file vault does not hold the main process through 400 extractions.
        await new Promise((r) => setImmediate(r));
      }
      this.#onChanged(this.view());
    }
  }

  /** Exposed for tests and for a "read this one now" path; safe to call on any file. */
  async indexOne(file: FileRow): Promise<void> {
    try {
      const result = await extractFile(this.#absPath(file), file.kind as FileKind);
      this.#repo.text.replace(file.id, file.name, result.chunks);
      this.#repo.files.markIndexed(file.id, {
        at: this.#now(),
        size: result.size,
        mtimeMs: result.mtimeMs,
        pageCount: result.pageCount,
        sha256: result.sha256,
      });
    } catch (err) {
      this.#repo.text.remove(file.id);
      this.#repo.files.markFailed(file.id, this.#now(), (err as Error).message);
    }
  }

  /** Drain the queue synchronously-ish. Tests use it; the app never waits on the indexer. */
  async indexAll(): Promise<void> {
    const id = this.activeVaultId();
    if (!id) return;
    for (;;) {
      const batch = this.#repo.files.stale(id, 32);
      if (batch.length === 0) return;
      for (const f of batch) await this.indexOne(f);
    }
  }

  dispose(): void {
    this.#stopped = true;
  }
}

function fileView(f: FileRow): VaultFileView {
  return {
    id: f.id,
    name: f.name,
    relPath: f.rel_path,
    kind: f.kind,
    size: f.size,
    mtimeMs: f.mtime_ms,
    topicId: f.topic_id,
    pageCount: f.page_count,
    indexed: f.indexed_at !== null && f.index_error === null,
    indexError: f.index_error,
  };
}

/** Folders before files, then by name. The same order every time, for the same reason as scan. */
function sortTree(node: VaultTreeNode): void {
  node.children.sort((a, b) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1;
    return a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' });
  });
  for (const child of node.children) if (child.dir) sortTree(child);
}

export type { DocumentReference };
