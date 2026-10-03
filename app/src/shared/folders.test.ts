import { describe, expect, it } from 'vitest';
import { childFolders, folderPath, freshFolderName, isFolderId, moveFolderRefusal, subtreeFolderIds, type FolderView } from './folders.js';

const f = (id: string, parentId: string | null, name = id, ord = 0): FolderView => ({
  id,
  parentId,
  name,
  ord,
  createdAt: '2026-10-03T00:00:00.000Z',
  updatedAt: '2026-10-03T00:00:00.000Z',
});

// CS4246 ─┬─ Planning ── Week 3
//         └─ Decision making
// CS3249
const TREE = [
  f('fd_cs4246', null, 'CS4246'),
  f('fd_plan', 'fd_cs4246', 'Planning'),
  f('fd_w3', 'fd_plan', 'Week 3'),
  f('fd_dec', 'fd_cs4246', 'Decision making'),
  f('fd_cs3249', null, 'CS3249'),
];

describe('folders', () => {
  it('recognises its own ids only', () => {
    expect(isFolderId('fd_0123456789ab')).toBe(true);
    expect(isFolderId('nb_0123456789ab')).toBe(false);
    expect(isFolderId('fd_../x')).toBe(false);
    expect(isFolderId(null)).toBe(false);
  });

  it('gives a breadcrumb from the top level down', () => {
    expect(folderPath(TREE, 'fd_w3').map((x) => x.name)).toEqual(['CS4246', 'Planning', 'Week 3']);
    expect(folderPath(TREE, null)).toEqual([]);
    expect(folderPath(TREE, 'fd_gone')).toEqual([]);
  });

  it('does not spin on a loop that should never exist', () => {
    const looped = [f('fd_a', 'fd_b'), f('fd_b', 'fd_a')];
    expect(folderPath(looped, 'fd_a').map((x) => x.id)).toEqual(['fd_b', 'fd_a']);
    expect(subtreeFolderIds(looped, 'fd_a')).toEqual(new Set(['fd_a', 'fd_b']));
  });

  it('takes a folder and everything under it as the search scope', () => {
    expect(subtreeFolderIds(TREE, 'fd_cs4246')).toEqual(new Set(['fd_cs4246', 'fd_plan', 'fd_w3', 'fd_dec']));
    expect(subtreeFolderIds(TREE, 'fd_plan')).toEqual(new Set(['fd_plan', 'fd_w3']));
    expect(subtreeFolderIds(TREE, null).size).toBe(5);
  });

  it('refuses a move that would put a folder inside itself', () => {
    expect(moveFolderRefusal(TREE, 'fd_cs4246', 'fd_w3')).toBe('A folder cannot go inside itself.');
    expect(moveFolderRefusal(TREE, 'fd_plan', 'fd_plan')).toBe('A folder cannot go inside itself.');
    expect(moveFolderRefusal(TREE, 'fd_w3', 'fd_dec')).toBeNull();
    expect(moveFolderRefusal(TREE, 'fd_w3', null)).toBeNull();
    expect(moveFolderRefusal(TREE, 'fd_w3', 'fd_gone')).toBe('That folder no longer exists.');
  });

  it('lists children by the learner’s order, then by name with numbers read as numbers', () => {
    const kids = [f('fd_1', null, 'Week 10'), f('fd_2', null, 'Week 2'), f('fd_3', null, 'Alpha', -1)];
    expect(childFolders(kids, null).map((x) => x.name)).toEqual(['Alpha', 'Week 2', 'Week 10']);
  });

  it('names a new folder so it does not clash with a sibling', () => {
    expect(freshFolderName([])).toBe('Untitled folder');
    expect(freshFolderName([{ name: 'Untitled folder' }, { name: 'untitled folder 2' }])).toBe('Untitled folder 3');
  });
});
