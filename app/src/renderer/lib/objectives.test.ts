import { describe, expect, it } from 'vitest';
import {
  OBJECTIVE_GLYPH,
  backendNote,
  buildTree,
  firstRef,
  glyphFor,
  isOnline,
  levelsById,
  moveFocus,
  newlyOnline,
  nodeIndex,
  objectivesForSegment,
  treeCount,
  onlineLabel,
  panelStatus,
  refLabel,
  resolveRefSegment,
  teachAnchorRef,
  teachPrefill,
  visibleRows,
  walk,
  wordFor,
  type LearningObjective,
  type LearningObjectiveState,
  type LearningTree,
  type ObjectiveLevel,
} from './objectives.js';

function obj(id: string, over: Partial<LearningObjective> = {}): LearningObjective {
  return {
    id,
    fileId: 'f1',
    title: id.toUpperCase(),
    kind: 'objective',
    statement: `what ${id} is`,
    criteria: ['one', 'two'],
    quizSeeds: [`ask about ${id}`],
    refs: [{ page: 1 }],
    parentId: null,
    requires: [],
    assumedByDeck: false,
    order: 0,
    ...over,
  };
}

function state(objectiveId: string, level: ObjectiveLevel): LearningObjectiveState {
  return { objectiveId, fileId: 'f1', level, evidenceMessageIds: [], lastMovedAt: null, taughtAt: null };
}

describe('buildTree', () => {
  it('nests sub-objectives under their parentId and keeps deck order among siblings', () => {
    const tree = buildTree([
      obj('b', { order: 2 }),
      obj('a', { order: 1 }),
      obj('a2', { parentId: 'a', order: 5 }),
      obj('a1', { parentId: 'a', order: 3 }),
    ]);
    expect(tree.map((n) => n.objective.id)).toEqual(['a', 'b']);
    expect(tree[0]!.children.map((n) => n.objective.id)).toEqual(['a1', 'a2']);
    expect(tree[0]!.depth).toBe(1);
    expect(tree[0]!.children[0]!.depth).toBe(2);
  });

  it('hangs a prerequisite under the objective that requires it', () => {
    const tree = buildTree([
      obj('mdp', { kind: 'prerequisite', assumedByDeck: true, refs: [], order: 1 }),
      obj('bellman', { order: 2, requires: ['mdp'] }),
    ]);
    expect(tree.map((n) => n.objective.id)).toEqual(['bellman']);
    expect(tree[0]!.children.map((n) => n.objective.id)).toEqual(['mdp']);
    expect(tree[0]!.children[0]!.parentId).toBe('bellman');
  });

  it('gives a prerequisite required twice to the earliest requirer', () => {
    const tree = buildTree([
      obj('p', { kind: 'prerequisite', assumedByDeck: true, refs: [] }),
      obj('late', { order: 9, requires: ['p'] }),
      obj('early', { order: 2, requires: ['p'] }),
    ]);
    const early = tree.find((n) => n.objective.id === 'early')!;
    const late = tree.find((n) => n.objective.id === 'late')!;
    expect(early.children.map((n) => n.objective.id)).toEqual(['p']);
    expect(late.children).toEqual([]);
  });

  it('lets an explicit parentId win over a requires edge', () => {
    const tree = buildTree([
      obj('root'),
      obj('p', { kind: 'prerequisite', parentId: 'root', refs: [] }),
      obj('needs', { order: 4, requires: ['p'] }),
    ]);
    const root = tree.find((n) => n.objective.id === 'root')!;
    expect(root.children.map((n) => n.objective.id)).toEqual(['p']);
  });

  it('puts a prerequisite before a sibling objective that shares its order', () => {
    const tree = buildTree([
      obj('parent'),
      obj('kid', { parentId: 'parent', order: 3 }),
      obj('pre', { parentId: 'parent', order: 3, kind: 'prerequisite', assumedByDeck: true, refs: [] }),
    ]);
    expect(tree[0]!.children.map((n) => n.objective.id)).toEqual(['pre', 'kid']);
  });

  it('promotes a node whose parent is not in the list rather than dropping it', () => {
    const tree = buildTree([obj('orphan', { parentId: 'gone' })]);
    expect(tree.map((n) => n.objective.id)).toEqual(['orphan']);
    expect(tree[0]!.parentId).toBeNull();
  });

  it('survives a cycle, with every objective still reachable', () => {
    const tree = buildTree([obj('a', { parentId: 'b' }), obj('b', { parentId: 'a' })]);
    expect(walk(tree).map((n) => n.objective.id).sort()).toEqual(['a', 'b']);
  });

  it('carries each objective its state, and 0 when it has none', () => {
    const tree = buildTree([obj('a'), obj('b', { order: 1 })], [state('a', 2)]);
    expect(tree[0]!.level).toBe(2);
    expect(tree[0]!.state?.level).toBe(2);
    expect(tree[1]!.level).toBe(0);
    expect(tree[1]!.state).toBeNull();
  });
});

describe('glyphs and the count', () => {
  it('is the ledger vocabulary with a dim state under it', () => {
    expect(OBJECTIVE_GLYPH).toEqual(['·', '○', '◐', '●']);
    expect(glyphFor(0)).toBe('·');
    expect(glyphFor(3)).toBe('●');
    expect(wordFor(2)).toBe('online');
  });

  it('is online at justified, and stays online at defended', () => {
    expect(isOnline(1)).toBe(false);
    expect(isOnline(2)).toBe(true);
    expect(isOnline(3)).toBe(true);
  });

  it('counts prerequisites in "n of m online"', () => {
    const objectives = [obj('a'), obj('b'), obj('p', { kind: 'prerequisite', refs: [] })];
    const count = treeCount(objectives, [state('a', 2), state('b', 1), state('p', 3)]);
    expect(count).toEqual({ online: 2, total: 3 });
    expect(onlineLabel(count)).toBe('2 of 3 online');
  });

  it('reports only the nodes that just crossed into online', () => {
    const before = levelsById([state('a', 1), state('b', 2), state('c', 0)]);
    const after = levelsById([state('a', 2), state('b', 3), state('c', 1)]);
    expect(newlyOnline(before, after)).toEqual(['a']);
  });
});

describe('refs and where a click goes', () => {
  it('prints de-duplicated pages in order', () => {
    expect(refLabel([{ page: 14 }, { page: 12 }, { page: 12 }])).toBe('p. 12, p. 14');
    expect(refLabel([])).toBe('');
    expect(refLabel([{ page: 1 }, { page: 2 }, { page: 3 }, { page: 4 }, { page: 5 }])).toBe(
      'p. 1, p. 2, p. 3, p. 4 +1',
    );
  });

  it('takes the earliest page as the first ref', () => {
    expect(firstRef(obj('a', { refs: [{ page: 9 }, { page: 3 }] }))?.page).toBe(3);
    expect(firstRef(obj('a', { refs: [] }))).toBeNull();
  });

  it('prefers a live segmentId and falls back to the first card on the page', () => {
    const cards = [
      { segmentId: 's1', page: 1 },
      { segmentId: 's2', page: 3 },
      { segmentId: 's3', page: 3 },
    ];
    expect(resolveRefSegment({ page: 3, segmentId: 's3' }, cards)).toBe('s3');
    // The segment was split away since the tree was cached: the page still answers.
    expect(resolveRefSegment({ page: 3, segmentId: 'gone' }, cards)).toBe('s2');
    expect(resolveRefSegment({ page: 9 }, cards)).toBeNull();
    expect(resolveRefSegment(null, cards)).toBeNull();
  });

  it('gives a card the objectives it teaches, in deck order', () => {
    const objectives = [
      obj('late', { order: 5, refs: [{ page: 2 }] }),
      obj('early', { order: 1, refs: [{ page: 2 }] }),
      obj('elsewhere', { refs: [{ page: 7 }] }),
      obj('byid', { order: 9, refs: [{ page: 99, segmentId: 's2' }] }),
    ];
    const got = objectivesForSegment(objectives, [state('early', 3)], { segmentId: 's2', page: 2 });
    expect(got.map((o) => o.id)).toEqual(['early', 'late', 'byid']);
    expect(got[0]!.level).toBe(3);
  });

  it('anchors Teach me this to the nearest ancestor the deck actually teaches', () => {
    const tree = buildTree([
      obj('top', { refs: [{ page: 4 }] }),
      obj('mid', { parentId: 'top', refs: [] }),
      obj('pre', { parentId: 'mid', kind: 'prerequisite', assumedByDeck: true, refs: [] }),
    ]);
    const index = nodeIndex(tree);
    expect(teachAnchorRef(index.get('pre')!, index)?.page).toBe(4);
    const loose = buildTree([obj('only', { kind: 'prerequisite', refs: [] })]);
    expect(teachAnchorRef(loose[0]!, nodeIndex(loose))).toBeNull();
    expect(teachPrefill('What an MDP is')).toBe('Explain What an MDP is to me');
  });
});

describe('the keyboard model', () => {
  const tree = buildTree([
    obj('a', { order: 1 }),
    obj('a1', { parentId: 'a', order: 2 }),
    obj('a1x', { parentId: 'a1', order: 3 }),
    obj('b', { order: 4 }),
  ]);

  it('hides collapsed children from the rows an arrow moves through', () => {
    expect(visibleRows(tree).map((r) => r.id)).toEqual(['a', 'a1', 'a1x', 'b']);
    expect(visibleRows(tree, new Set(['a'])).map((r) => r.id)).toEqual(['a', 'b']);
    const rows = visibleRows(tree);
    expect(rows[0]!.hasChildren).toBe(true);
    expect(rows[2]!.hasChildren).toBe(false);
    expect(rows[2]!.depth).toBe(3);
  });

  it('moves down and up, and stops at both ends', () => {
    const rows = visibleRows(tree);
    expect(moveFocus(rows, 'a', 'ArrowDown').focusId).toBe('a1');
    expect(moveFocus(rows, 'b', 'ArrowDown').focusId).toBe('b');
    expect(moveFocus(rows, 'a1', 'ArrowUp').focusId).toBe('a');
    expect(moveFocus(rows, 'a', 'ArrowUp').focusId).toBe('a');
    expect(moveFocus(rows, null, 'ArrowDown').focusId).toBe('a');
    expect(moveFocus(rows, 'a1', 'Home').focusId).toBe('a');
    expect(moveFocus(rows, 'a', 'End').focusId).toBe('b');
    expect(moveFocus([], 'a', 'ArrowDown').focusId).toBeNull();
  });

  it('opens a closed node on →, then walks into it', () => {
    const closed = visibleRows(tree, new Set(['a']));
    expect(moveFocus(closed, 'a', 'ArrowRight')).toEqual({ focusId: 'a', expand: 'a' });
    const open = visibleRows(tree);
    expect(moveFocus(open, 'a', 'ArrowRight').focusId).toBe('a1');
    expect(moveFocus(open, 'a1x', 'ArrowRight').focusId).toBe('a1x');
  });

  it('closes an open node on ←, and otherwise goes to the parent', () => {
    const open = visibleRows(tree);
    expect(moveFocus(open, 'a1', 'ArrowLeft')).toEqual({ focusId: 'a1', collapse: 'a1' });
    expect(moveFocus(open, 'a1x', 'ArrowLeft').focusId).toBe('a1');
    expect(moveFocus(open, 'b', 'ArrowLeft').focusId).toBe('b');
  });
});

describe('the header', () => {
  function tree(status: LearningTree['status'], error?: string): LearningTree {
    return {
      fileId: 'f1',
      contentSha: 'sha',
      generatedAt: '2026-09-16T00:00:00.000Z',
      model: 'sonnet',
      version: 1,
      objectives: [],
      status,
      ...(error ? { error } : {}),
    };
  }

  it('says who is reading while the ingest runs, and offers a retry when it failed', () => {
    expect(panelStatus(tree('pending'))).toEqual({
      text: 'Ellie is reading the deck…',
      pending: true,
      retry: false,
    });
    expect(panelStatus(tree('failed', 'the model timed out')).retry).toBe(true);
    expect(panelStatus(tree('failed', 'the model timed out')).text).toBe('the model timed out');
    expect(panelStatus(tree('ready')).text).toBeNull();
    expect(panelStatus(null).text).toBeNull();
  });

  it('says a scripted deck with nothing to show needs a live backend, and says nothing otherwise', () => {
    expect(backendNote({ backend: 'scripted', status: null, fromFixture: false })).toMatch(/live backend/);
    // A tree left pending on the scripted backend is a spinner that can never resolve.
    expect(backendNote({ backend: 'scripted', status: 'pending', fromFixture: false })).toMatch(/live backend/);
    expect(backendNote({ backend: 'scripted', status: 'ready', fromFixture: true })).toBeNull();
    expect(backendNote({ backend: 'scripted', status: 'ready', fromFixture: false })).toBeNull();
    // On a live backend the tree's own status says everything there is to say.
    expect(backendNote({ backend: 'claude_cli', status: null, fromFixture: false })).toBeNull();
  });
});
