/**
 * A notebook with **every row family the app keeps for one**, for the research-exclusion and
 * duplicate tests: its sources (files, FTS rows, copies on disk), its notes doc and a tutorial's,
 * their per-doc tables (a stored explain comment included), its objective tree, search rows, and a room with a whole chat record
 * under it (participants, a session, messages and a revision, a private turn, a turn decision,
 * events, ledger rows, a ref, an outbox row), progress rows and usage rows.
 *
 * Every id is derived from `tag` (`nb_<tag>`, `f_<tag>`, `room_<tag>` …), and every text value
 * carries `MARK_<tag>`, so a test can search a whole export for one notebook's trace.
 * Test-only: this directory is excluded from the main-process build.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SqlDatabase } from '../main/db/driver.js';

export const SEED_T = '2026-10-07T01:00:00.000Z';
export const MANAGED = 'vault_notebooks';

export interface SeededNotebook {
  notebookId: string;
  lectureFile: string;
  tutorialFile: string;
  docId: string;
  tutorialDocId: string;
  roomId: string;
  sessionId: string;
  mark: string;
}

function put(db: SqlDatabase, table: string, row: Record<string, unknown>): void {
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`).run(row);
}

export function seedManagedVault(db: SqlDatabase, root: string): void {
  db.prepare(`INSERT OR IGNORE INTO vaults (id, root_path, display_name, created_at) VALUES (@id, @root, 'Notebooks', @t)`).run({
    id: MANAGED,
    root,
    t: SEED_T,
  });
}

export function seedFolder(db: SqlDatabase, id: string, name: string, parentId: string | null = null, researchExclude = false): void {
  put(db, 'folders', { id, parent_id: parentId, name, ord: 0, created_at: SEED_T, updated_at: SEED_T, research_exclude: researchExclude ? 1 : 0 });
}

/**
 * Seed one notebook. `root`, when given, gets the source copies on disk, as the app lays them
 * out: `<root>/<nb>/<fileId>-<name>`.
 */
export function seedNotebook(
  db: SqlDatabase,
  tag: string,
  opts: { folderId?: string | null; researchExclude?: boolean; root?: string } = {},
): SeededNotebook {
  const nb = `nb_${tag}`;
  const lec = `f_${tag}lec`;
  const tut = `f_${tag}tut`;
  const doc = `doc_${tag}`;
  const tdoc = `doc_${tag}tut`;
  const mat = `mat_${tag}`;
  const room = `room_${tag}`;
  const sess = `sess_${tag}`;
  const turn = `turn_${tag}`;
  const mark = `MARK_${tag}`;
  const key = `nb:${nb}`;
  const tkey = `nb:${nb}:tut:${tut}`;
  const fk = db.prepare('PRAGMA foreign_keys').get<{ foreign_keys: number }>()?.foreign_keys ?? 1;
  // The chat tables reference users and agents a notebook test has no use for.
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    put(db, 'notebooks', {
      id: nb,
      name: `Notebook ${mark}`,
      created_at: SEED_T,
      updated_at: SEED_T,
      folder_id: opts.folderId ?? null,
      research_exclude: opts.researchExclude ? 1 : 0,
    });
    const files: [string, string, string, number, number, string][] = [
      [lec, `Lecture ${tag}.pdf`, 'lecture', 0, 3, `sha_${tag}_lecture`],
      [tut, `Tutorial ${tag}.pdf`, 'tutorial', 3, 2, `sha_${tag}_tutorial`],
    ];
    for (const [id, name, role, base, pages, sha] of files) {
      const rel = `${nb}/${id}-${name}`;
      put(db, 'files', {
        id,
        vault_id: MANAGED,
        rel_path: rel,
        name,
        ext: 'pdf',
        kind: 'pdf',
        size: 10,
        mtime_ms: 1,
        sha256: sha,
        page_count: pages,
        indexed_at: SEED_T,
      });
      put(db, 'notebook_sources', {
        file_id: id,
        notebook_id: nb,
        display_name: name,
        page_base: base,
        page_count: pages,
        enabled: 1,
        ord: base,
        status: 'ready',
        added_at: SEED_T,
        role,
        key_for: null,
      });
      for (let p = 1; p <= pages; p++) {
        db.prepare(`INSERT INTO file_text (body, name, file_id, page) VALUES (@b, @n, @f, @p)`).run({
          b: `page ${p} of ${name} about markovian ${mark}`,
          n: name,
          f: id,
          p,
        });
      }
      if (opts.root) {
        mkdirSync(join(opts.root, nb), { recursive: true });
        writeFileSync(join(opts.root, nb, `${id}-${name}`), `%PDF-1.4 bytes of ${name}`);
      }
    }
    put(db, 'settings', { key: `notebook_page_hwm:${nb}`, value: '5', updated_at: SEED_T });

    const docJson = (who: string) =>
      JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: `b_${tag}1`, pages: [1] }, content: [{ type: 'text', text: `${who} ${mark}` }] }] });
    put(db, 'notes_docs', {
      id: doc,
      content_sha: key,
      file_id: nb,
      title: `Notes ${mark}`,
      page_count: 5,
      version: 7,
      doc_json: docJson('notes'),
      ingest_status: 'ready',
      ingest_version: 1,
      learner_touched: 1,
      created_at: SEED_T,
      updated_at: SEED_T,
      overview_json: JSON.stringify({ fingerprint: `${lec}@0`, greeting: `hi ${mark}` }),
    });
    put(db, 'notes_docs', {
      id: tdoc,
      content_sha: tkey,
      file_id: tut,
      title: `Tutorial ${mark}`,
      page_count: 2,
      version: 3,
      doc_json: docJson('tutorial'),
      ingest_status: 'ready',
      ingest_version: 1,
      learner_touched: 0,
      created_at: SEED_T,
      updated_at: SEED_T,
    });
    put(db, 'notes_slide_groups', { doc_id: doc, page: 2, group_key: `b_${tag}1`, group_title: `Group ${mark}`, at: SEED_T });
    put(db, 'notes_objective_blocks', { doc_id: doc, objective_id: `obj_${tag}`, block_id: `b_${tag}1`, ord: 0 });
    // Migration 033: a stored explain comment on the notes doc's block.
    put(db, 'block_comments', {
      doc_id: doc,
      block_id: `b_${tag}1`,
      kind: 'explain',
      body: `explain ${mark}`,
      text_sha: 'sha',
      model: 'sonnet',
      created_at: SEED_T,
      updated_at: SEED_T,
    });
    put(db, 'tutorial_parts', { doc_id: tdoc, part_id: 'P1a', key_json: JSON.stringify({ answer: mark }), status: 'correct', updated_at: SEED_T });
    put(db, 'learning_trees', {
      file_id: nb,
      content_sha: key,
      prompt_version: 1,
      model: 'm',
      status: 'ready',
      json: JSON.stringify([{ id: `obj_${tag}`, fileId: nb, title: `Objective ${mark}` }]),
      created_at: SEED_T,
      updated_at: SEED_T,
    });
    put(db, 'learning_objective_states', { objective_id: `obj_${tag}`, file_id: nb, level: 1, evidence_message_ids: JSON.stringify([`msg_${tag}1`]) });
    put(db, 'search_chunks', {
      key: `page:${nb}:1`,
      notebook_id: nb,
      kind: 'page',
      text: `chunk ${mark}`,
      embed_text: `chunk ${mark}`,
      hash: 'h',
      vec: Buffer.from([1, 2, 3, 4]),
      updated_at: SEED_T,
    });
    put(db, 'search_state', { notebook_id: nb, doc_version: 7, sources_sig: `${lec}:ready|${tut}:ready`, updated_at: SEED_T });

    // ── The room and its whole record ──
    put(db, 'materials', {
      id: mat,
      module_code: 'CS4246',
      title: `Material ${mark}`,
      source_kind: 'pasted_text',
      extracted_text: `slides ${mark}`,
      extract_engine: 'paste',
      concept_pack: '{}',
      pack_provenance: 'fixed',
      token_count: 10,
      cache_eligible: 0,
      prefix_sha256: 'x',
      created_at: SEED_T,
      file_id: nb,
      file_sha256: key,
    });
    put(db, 'rooms', { id: room, module_code: 'CS4246', material_id: mat, topic: `Topic ${mark}`, state: 'open', config: '{}', created_at: SEED_T });
    put(db, 'participants', { id: `p_${tag}s`, room_id: room, kind: 'student', user_id: 'u_test', display_name: 'You', joined_at: SEED_T });
    put(db, 'participants', { id: `p_${tag}a`, room_id: room, kind: 'agent', display_name: 'Ellie', joined_at: SEED_T });
    put(db, 'sessions', {
      id: sess,
      room_id: room,
      user_id: 'u_test',
      latency_profile: '{}',
      silence_ms: 1,
      app_version: '0',
      os_version: '0',
      started_at: SEED_T,
    });
    put(db, 'messages', { id: `msg_${tag}1`, room_id: room, participant_id: `p_${tag}s`, seq: 1, body: `question ${mark}`, created_at: SEED_T, turn_id: turn, anchor_id: 'doc' });
    put(db, 'messages', { id: `msg_${tag}2`, room_id: room, participant_id: `p_${tag}a`, seq: 2, body: `answer ${mark}`, created_at: SEED_T, turn_id: turn, anchor_id: 'doc' });
    // A rewritten body files a revision (migration 029's trigger).
    db.prepare('UPDATE messages SET body = @b WHERE id = @id').run({ b: `answer, revised ${mark}`, id: `msg_${tag}2` });
    put(db, 'whispers', {
      id: `w_${tag}`,
      room_id: room,
      thread_id: `priv_${tag}`,
      student_participant_id: `p_${tag}s`,
      agent_participant_id: `p_${tag}a`,
      seq: 1,
      sender: 'student',
      body: `private ${mark}`,
      group_seq_snapshot: 0,
      created_at: SEED_T,
    });
    put(db, 'notes_threads', { thread_id: 'doc', room_id: room, doc_id: doc, kind: 'doc', created_at: SEED_T });
    put(db, 'notes_doc_edits', {
      edit_id: `e_${tag}`,
      doc_id: doc,
      room_id: room,
      author: 'ellie',
      cause: 'answer_missing',
      ops_json: JSON.stringify([{ text: mark }]),
      status: 'applied',
      created_at: SEED_T,
    });
    put(db, 'notes_suggestions', { suggestion_id: `s_${tag}`, doc_id: doc, edit_id: `e_${tag}`, author: 'max', block_id: `b_${tag}1`, status: 'open', note: mark, created_at: SEED_T });
    put(db, 'turn_decisions', { id: `td_${tag}`, room_id: room, trigger: 'student', decided_by: 'rule', rationale: mark, created_at: SEED_T });
    put(db, 'events', { room_id: room, session_id: sess, seq: 1, actor: 'student', type: 'msg', envelope: '{}', payload: JSON.stringify({ m: mark }), server_ts: SEED_T });
    put(db, 'ledger', { id: `l_${tag}`, session_id: sess, element_id: 'e1', level: 1, level_proposed: 1, evidence_text: mark, updated_at: SEED_T });
    put(db, 'ledger_history', { session_id: sess, message_id: `msg_${tag}1`, element_id: 'e1', level_before: 0, level_proposed: 1, level_after: 1, created_at: SEED_T });
    put(db, 'rubric_scores', { id: `rs_${tag}`, session_id: sess, dimension: 'd', score: 1, justification: mark, scored_by: 'm', created_at: SEED_T });
    put(db, 'message_refs', {
      id: `mr_${tag}`,
      message_id: `msg_${tag}1`,
      room_id: room,
      file_id: lec,
      file_name: `Lecture ${tag}.pdf`,
      rel_path: `x ${mark}`,
      kind: 'pdf',
      page_text: 'p',
      created_at: SEED_T,
    });
    put(db, 'outbox', { collection: 'messages', doc_path: `rooms/${room}/messages/1`, op: 'set', body: mark, enqueued_at: SEED_T });
    put(db, 'settings', { key: `flow_state:${room}`, value: mark, updated_at: SEED_T });
    put(db, 'quiz_outcomes', { id: `qo_${tag}`, content_sha: key, room_id: room, question_id: `q_${tag}`, kind: 'verdict', verdict: 'complete', created_at: SEED_T });
    put(db, 'quiz_outcomes', { id: `qot_${tag}`, content_sha: tkey, room_id: room, question_id: `qt_${tag}`, kind: 'verdict', verdict: 'partial', created_at: SEED_T });
    put(db, 'objective_activity', { id: `oa_${tag}`, content_sha: key, room_id: room, objective_id: `obj_${tag}`, kind: 'explain', created_at: SEED_T });
    // Usage filed three ways: by the notebook, by the room, and by a turn alone.
    put(db, 'llm_usage', { id: `u_${tag}1`, created_at: SEED_T, file_id: nb, scope: `ingest ${mark}`, model: 'm', backend: 'b' });
    put(db, 'llm_usage', { id: `u_${tag}2`, created_at: SEED_T, room_id: room, scope: `turn ${mark}`, model: 'm', backend: 'b' });
    put(db, 'llm_usage', { id: `u_${tag}3`, created_at: SEED_T, turn_id: turn, scope: `turn ${mark}`, model: 'm', backend: 'b' });
  } finally {
    db.exec(`PRAGMA foreign_keys = ${fk ? 'ON' : 'OFF'}`);
  }
  return { notebookId: nb, lectureFile: lec, tutorialFile: tut, docId: doc, tutorialDocId: tdoc, roomId: room, sessionId: sess, mark };
}
