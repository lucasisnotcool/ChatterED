/**
 * **The managed vault: where notebook sources live** (`docs/research/notebooks.md` §1,
 * `NOTEBOOK-CONTRACT.md` C3).
 *
 * A notebook source is a file the learner added, *copied* into app storage (answer C). The copy
 * is still a `files` row, so the FTS index, page geometry, segments, `textFor` and the cost joins
 * keep working by file id; those rows need a `vaults` row to hang off (`files.vault_id` is NOT
 * NULL), and this is it: one synthetic vault, fixed id, whose root is `<userData>/notebooks`.
 * A source's copy is at `<root>/<notebook id>/<file id>-<safe name>`.
 *
 * Three things must never happen to it, and each is guarded where it would happen:
 *
 *  - **it is never scanned** (`VaultService.rescan` returns early): `files.sync` reconciles by
 *    path and would delete every row whose copy it did not expect, and re-mint ids for the rest;
 *  - **it is never the active vault** (`VaultService.open` refuses its root), so the folder
 *    vault's background indexer, which chunks text files as one page-less chunk, never reaches
 *    a notebook source — the notebook service writes those rows itself, one per page;
 *  - **its rows never adopt or get adopted** (`adopt.ts`): a notebook copy shares its bytes with
 *    the folder-vault file it was copied from, and adoption by sha would otherwise move that
 *    file's room, tree and progress onto the copy (or, after the legacy import, the reverse).
 */
import type { SqlDatabase } from '../db/driver.js';

/** Fixed, so every module can recognise it without a settings read. */
export const MANAGED_VAULT_ID = 'vault_notebooks';

export function isManagedVault(vaultId: string | null | undefined): boolean {
  return vaultId === MANAGED_VAULT_ID;
}

/**
 * Create the managed vault's row, or point it at `root` if the app's data directory moved.
 * Idempotent; called at boot before anything can add a source.
 */
export function ensureManagedVault(db: SqlDatabase, root: string, now: string): void {
  const row = db
    .prepare('SELECT root_path FROM vaults WHERE id = @id')
    .get<{ root_path: string }>({ id: MANAGED_VAULT_ID });
  if (!row) {
    db.prepare(
      `INSERT INTO vaults (id, root_path, display_name, created_at, last_scan_at)
       VALUES (@id, @root, 'Notebooks', @now, NULL)`,
    ).run({ id: MANAGED_VAULT_ID, root, now });
    return;
  }
  if (row.root_path !== root) {
    db.prepare('UPDATE vaults SET root_path = @root WHERE id = @id').run({ id: MANAGED_VAULT_ID, root });
  }
}
