/**
 * Classical planning, checked by code (`tutorials.md` §5). The HLA example below is generic
 * textbook logic (ten propositional primitives, three HLAs), written for these tests: it pins the
 * angelic summary (`∼+ ∼− ∼±`), the intersection of preconditions, and which refinements of a
 * sequence reach a goal.
 */
import { describe, expect, it } from 'vitest';
import {
  applicable,
  apply,
  atomKey,
  formatAction,
  formatLiterals,
  groundAction,
  groundActions,
  hlaSummary,
  judgeFormal,
  parseLiterals,
  parsePlan,
  parseSteps,
  runPlan,
  runSequence,
  satisfies,
  solveCheck,
  solvePlan,
  stateFrom,
  validateCheck,
  type ActionSchema,
  type FormalCheck,
  type HlaSpec,
  type Literal,
  type StripsDomain,
} from './planning.js';

const lit = (pred: string, args: string[] = [], neg = false): Literal => ({ pred, args, neg });
const not = (pred: string, args: string[] = []): Literal => lit(pred, args, true);
const fmt = (text: string) => formatLiterals(parseLiterals(text).literals);

// ── The HLA example ──
const prim = (name: string, pre: Literal[], eff: Literal[]): ActionSchema => ({ name, params: [], pre, eff });
const P: ActionSchema[] = [
  prim('Q1', [not('F')], [lit('F')]),
  prim('Q2', [lit('F')], [lit('G')]),
  prim('Q3', [lit('F')], [not('G')]),
  prim('Q4', [not('G')], [lit('F'), lit('M')]),
  prim('Q5', [not('G')], [lit('M')]),
  prim('Q6', [not('G')], [not('M')]),
  prim('Q7', [not('G')], [lit('F'), not('M')]),
  prim('Q8', [not('G'), not('M')], [lit('N')]),
  prim('Q9', [lit('N')], [lit('R')]),
  prim('Q10', [lit('F'), lit('N')], [lit('R')]),
];
const H: HlaSpec[] = [
  { name: 'K1', implementations: [['Q1', 'Q2'], ['Q1', 'Q3']] },
  { name: 'K2', implementations: [['Q4'], ['Q5'], ['Q6'], ['Q7']] },
  { name: 'K3', implementations: [['Q8', 'Q9'], ['Q8', 'Q10']] },
];
const h = (name: string) => H.find((x) => x.name === name) as HlaSpec;

// ── A blocks world ──
const BLOCKS: StripsDomain = {
  objects: ['X', 'Y', 'Table'],
  actions: [
    {
      name: 'Move',
      params: ['b', 'from', 'to'],
      pre: [lit('On', ['b', 'from']), lit('Clear', ['b']), lit('Clear', ['to'])],
      eff: [lit('On', ['b', 'to']), not('On', ['b', 'from']), lit('Clear', ['from']), not('Clear', ['to'])],
      distinct: [
        ['b', 'from'],
        ['b', 'to'],
        ['from', 'to'],
      ],
    },
  ],
  static: [lit('Clear', ['Table'])],
};
const B_INIT = [lit('On', ['X', 'Y']), lit('On', ['Y', 'Table']), lit('Clear', ['X'])];
const B_GOAL = [lit('On', ['Y', 'X'])];
const PLAN_CHECK: FormalCheck = { type: 'plan', domain: BLOCKS, init: B_INIT, goal: B_GOAL };

const SEQ_CHECK: FormalCheck = {
  type: 'sequences',
  actions: P,
  hlas: H,
  init: [not('F'), lit('G')],
  goal: [lit('R')],
  options: [
    { id: 'a', steps: parseSteps('K1 (Q1,Q3), K2 (Q6), K3 (Q8,Q9)') },
    { id: 'b', steps: parseSteps('K1 (Q1,Q3), K2 (Q7), K3 (Q8,Q10)') },
    { id: 'c', steps: parseSteps('K1 (Q1,Q2), K2 (Q4), K3 (Q8,Q9)') },
    { id: 'd', steps: parseSteps('K1 (Q1,Q2), K2 (Q5), K3 (Q8,Q9)') },
  ],
};

const HLA_CHECK: FormalCheck = {
  type: 'hla_schema',
  actions: P,
  hlas: H,
  blanks: {
    pre1: { hla: 'K1', field: 'precond' },
    eff1: { hla: 'K1', field: 'effect' },
    eff2: { hla: 'K2', field: 'effect' },
    pre3: { hla: 'K3', field: 'precond' },
  },
};

const ans = (over: Partial<{ text: string; blanks: Record<string, string>; picked: string[] }>) => ({ text: '', blanks: {}, picked: [], ...over });

describe('parseLiterals', () => {
  it('reads every notation for the same conjunction', () => {
    for (const t of ['¬A ∧ ∼±B', '~A ^ ~+-B', '!A & +-B', 'not A and possibly add or delete B', '$\\neg A \\wedge \\sim\\pm B$', '-A, ±B', '¬A /\\ ∼ ± B', '(¬A ∧ ∼±B)'])
      expect(fmt(t), t).toBe('¬A ∧ ∼±B');
  });

  it('tells possibly-add, possibly-delete and either apart', () => {
    expect(fmt('∼+A ∧ ∼−B ∧ ∼±C')).toBe('∼+A ∧ ∼−B ∧ ∼±C');
    expect(fmt('~+A, ~-B, ~+-C')).toBe('∼+A ∧ ∼−B ∧ ∼±C');
    expect(fmt('possibly add A, possibly delete B, maybe C')).toBe('∼+A ∧ ∼−B ∧ ∼+C');
    expect(fmt('possibly not A')).toBe('∼−A');
    expect(fmt('∼¬A')).toBe('∼−A');
    expect(fmt('$\\sim + A \\land \\sim - B$')).toBe('∼+A ∧ ∼−B');
    expect(fmt('~−A')).toBe('∼−A');
    expect(fmt('add A, delete B')).toBe('A ∧ ¬B');
  });

  it('reads predicates with arguments, keeping commas inside them', () => {
    const r = parseLiterals('On(A, B), ¬Clear(A) ∧ Holding()');
    expect(r.ok).toBe(true);
    expect(r.literals).toEqual([lit('On', ['A', 'B']), not('Clear', ['A']), lit('Holding')]);
    expect(fmt('$\\text{On}(A, \\mathit{Table})$')).toBe('On(A, Table)');
  });

  it('reads the empty set in its usual spellings, and ignores a label', () => {
    for (const t of ['', 'true', 'None', '∅', '{}', '$\\emptyset$', 'Precond: none']) expect(parseLiterals(t)).toEqual({ literals: [], ok: true });
    expect(fmt('Effect: A ∧ ¬B')).toBe('A ∧ ¬B');
  });

  it('is not ok when a conjunct is unreadable, and keeps what it could read', () => {
    expect(parseLiterals('A or B').ok).toBe(false);
    const r = parseLiterals('A ∧ 3+4');
    expect(r.ok).toBe(false);
    expect(r.literals).toEqual([lit('A')]);
  });

  it('double negation cancels', () => {
    expect(fmt('¬¬A')).toBe('A');
  });
});

describe('formatLiterals', () => {
  it('writes the canonical notation and ∅ for nothing', () => {
    expect(formatLiterals([lit('On', ['A', 'B']), { ...not('C'), mode: 'maybe_del' }, { ...lit('D'), mode: 'maybe' }])).toBe('On(A, B) ∧ ∼−C ∧ ∼±D');
    expect(formatLiterals([])).toBe('∅');
  });
});

describe('STRIPS', () => {
  it('grounds actions respecting distinct', () => {
    const all = groundActions(BLOCKS);
    expect(all).toHaveLength(6);
    expect(all.map(formatAction)).toContain('Move(X, Y, Table)');
    expect(groundAction(BLOCKS.actions[0] as ActionSchema, ['X', 'X', 'Y']).clash).toEqual(['b', 'from']);
  });

  it('applies closed world, never deleting a static literal', () => {
    const s0 = stateFrom(B_INIT, BLOCKS.static);
    const toTable = groundAction(BLOCKS.actions[0] as ActionSchema, ['X', 'Y', 'Table']);
    expect(applicable(s0, toTable)).toBe(true);
    const s1 = apply(s0, toTable, BLOCKS.static);
    expect(s1.has(atomKey(lit('Clear', ['Table'])))).toBe(true);
    expect(s1.has(atomKey(lit('On', ['X', 'Y'])))).toBe(false);
    expect(s1.has(atomKey(lit('Clear', ['Y'])))).toBe(true);
    const yOnX = groundAction(BLOCKS.actions[0] as ActionSchema, ['Y', 'Table', 'X']);
    expect(applicable(s0, yOnX)).toBe(false);
    expect(satisfies(apply(s1, yOnX, BLOCKS.static), B_GOAL)).toBe(true);
  });

  it('runs a plan and names the first failing step', () => {
    const good = parsePlan('Move(X, Y, Table), Move(Y, Table, X)', BLOCKS).steps;
    expect(runPlan(BLOCKS, B_INIT, good)).toMatchObject({ ok: true, failedAt: null });
    const bad = parsePlan('Move(Y, Table, X)', BLOCKS).steps;
    const r = runPlan(BLOCKS, B_INIT, bad);
    expect(r.ok).toBe(false);
    expect(r.failedAt).toBe(0);
    expect(r.reason).toContain('Clear(Y)');
  });

  it('parses plans in the ways learners write them', () => {
    const expected = ['Move(X, Y, Table)', 'Move(Y, Table, X)'];
    for (const t of [
      '1. Move(X, Y, Table)\n2. Move(Y, Table, X)',
      'Step 1: move(x,y,table)\nStep 2: MOVE(y, TABLE, x)',
      'Move(X,Y,Table) → Move(Y,Table,X)',
      'Move(X, Y, Table); Move(Y, Table, X).',
      'Move X from Y to the Table, then move Y from Table onto X',
      '1. Move(X, Y, Table) 2. Move(Y, Table, X)',
      '[Move(X, Y, Table), Move(Y, Table, X)]',
      '$Move(X, Y, Table) \\to$ Move(Y, Table, X)'.replace('\\to', '->'),
    ]) {
      const p = parsePlan(t, BLOCKS);
      expect(p.unparsed, t).toEqual([]);
      expect(p.steps.map(formatAction), t).toEqual(expected);
    }
  });

  it('leaves unknown actions, objects and arities unparsed', () => {
    const p = parsePlan('Move(X, Y), Fly(X), Move(X, Z, Table)', BLOCKS);
    expect(p.steps).toEqual([]);
    expect(p.unparsed).toHaveLength(3);
  });

  it('finds a shortest plan by search', () => {
    expect(solvePlan(BLOCKS, B_INIT, B_GOAL)?.map(formatAction)).toEqual(['Move(X, Y, Table)', 'Move(Y, Table, X)']);
    expect(solvePlan(BLOCKS, B_INIT, B_INIT)).toEqual([]);
    expect(solvePlan(BLOCKS, B_INIT, [lit('On', ['X', 'X'])])).toBeNull();
    expect(solvePlan(BLOCKS, B_INIT, B_GOAL, 1)).toBeNull();
  });
});

describe('hlaSummary (angelic semantics)', () => {
  it('K1: precondition ¬F, effect F ∧ ∼±G', () => {
    const s = hlaSummary(P, h('K1'));
    expect(formatLiterals(s.precond)).toBe('¬F');
    expect(formatLiterals(s.effect)).toBe('F ∧ ∼±G');
  });

  it('K2: precondition ¬G, effect ∼+F ∧ ∼±M', () => {
    const s = hlaSummary(P, h('K2'));
    expect(formatLiterals(s.precond)).toBe('¬G');
    expect(formatLiterals(s.effect)).toBe('∼+F ∧ ∼±M');
  });

  it('K3: precondition ¬G ∧ ¬M (N is achieved inside it), effect N ∧ R', () => {
    const s = hlaSummary(P, h('K3'));
    expect(formatLiterals(s.precond)).toBe('¬G ∧ ¬M');
    expect(formatLiterals(s.effect)).toBe('N ∧ R');
  });

  it('possibly-deletes and certain deletes', () => {
    const s = hlaSummary(P, { name: 'H', implementations: [['Q6'], ['Q4', 'Q7']] });
    expect(formatLiterals(s.effect)).toBe('¬M ∧ ∼+F');
    const t = hlaSummary(P, { name: 'H', implementations: [['Q6'], ['Q1']] });
    expect(formatLiterals(t.effect)).toBe('∼−M ∧ ∼+F');
    expect(formatLiterals(t.precond)).toBe('∅');
    expect(hlaSummary(P, { name: 'H', implementations: [] })).toEqual({ precond: [], effect: [] });
  });
});

describe('sequences', () => {
  const run = (text: string) => {
    const r = runSequence(P, H, [not('F'), lit('G')], parseSteps(text));
    return r.ok && satisfies(r.state, [lit('R')]);
  };

  it('parses an option into steps', () => {
    expect(parseSteps('K1 (Q1,Q3), K2 (Q6), K3 (Q8,Q9)')).toEqual(['K1(Q1,Q3)', 'K2(Q6)', 'K3(Q8,Q9)']);
    expect(parseSteps('K1[Q1, Q3] → Q5')).toEqual(['K1(Q1,Q3)', 'Q5']);
  });

  it('decides which refinements reach R from ¬F ∧ G', () => {
    expect(run('K1 (Q1,Q3), K2 (Q6), K3 (Q8,Q9)')).toBe(true);
    expect(run('K1 (Q1,Q3), K2 (Q7), K3 (Q8,Q10)')).toBe(true);
    expect(run('K1 (Q1,Q2), K2 (Q4), K3 (Q8,Q9)')).toBe(false);
    expect(run('K1 (Q1,Q2), K2 (Q5), K3 (Q8,Q9)')).toBe(false);
  });

  it('says why a sequence fails, by step', () => {
    const r = runSequence(P, H, [lit('G')], parseSteps('K1(Q1,Q2), K2(Q4)'));
    expect(r).toMatchObject({ ok: false, failedAt: 1 });
    expect(r.reason).toContain('¬G');
  });

  it('refuses an implementation the HLA does not have, and a bare HLA', () => {
    expect(runSequence(P, H, [], ['K1(Q2,Q1)']).reason).toContain("not one of K1's implementations");
    expect(runSequence(P, H, [], ['K1']).reason).toContain('implementation named');
    expect(runSequence(P, H, [], ['Z9']).reason).toContain('neither an action nor an HLA');
  });
});

describe('validateCheck', () => {
  it('accepts the well-formed checks and returns a clean copy', () => {
    for (const c of [PLAN_CHECK, SEQ_CHECK, HLA_CHECK]) {
      const v = validateCheck(JSON.parse(JSON.stringify(c)));
      expect(v.issues).toEqual([]);
      expect(v.check).toEqual(c);
    }
  });

  it('reads literal lists written as text', () => {
    const v = validateCheck({ type: 'hla_schema', actions: [{ name: 'Q1', pre: '¬F', eff: 'F' }], hlas: [{ name: 'K', implementations: [['Q1']] }], blanks: { e: { hla: 'k', field: 'effect' } } });
    expect(v.issues).toEqual([]);
    expect(v.check).toMatchObject({ actions: [{ name: 'Q1', params: [], pre: [not('F')], eff: [lit('F')] }], blanks: { e: { hla: 'K' } } });
  });

  it('names the structural problems', () => {
    const issues = (c: unknown) => validateCheck(c).issues.join(' | ');
    expect(validateCheck(null).check).toBeNull();
    expect(issues({ type: 'nope' })).toContain('unknown check type');
    expect(issues({ ...PLAN_CHECK, goal: [lit('On', ['Y', 'X', 'Table'])] })).toContain('On is used with 2 and 3 arguments');
    expect(issues({ ...PLAN_CHECK, goal: [lit('On', ['Y', 'Z'])] })).toContain('"Z" in On(Y, Z) is not an object');
    expect(
      issues({ ...PLAN_CHECK, domain: { ...BLOCKS, actions: [{ ...BLOCKS.actions[0], pre: [lit('On', ['b', 'c'])], distinct: [['b', 'q']] }] } }),
    ).toMatch(/"c" in On\(b, c\) is neither a parameter nor an object.*distinct must pair its own parameters/);
    expect(issues({ ...HLA_CHECK, hlas: [{ name: 'K1', implementations: [[]] }] })).toContain('an empty or malformed implementation');
    expect(issues({ ...HLA_CHECK, hlas: [{ name: 'K1', implementations: [['Q1', 'P99']] }] })).toContain('P99 is not an action');
    expect(issues({ ...HLA_CHECK, hlas: [{ name: 'K1', implementations: [['Q1']] }] })).toContain('blank eff2: K2 is not an HLA');
    expect(issues({ ...SEQ_CHECK, options: [{ id: 'a', steps: ['K1(Q2,Q3)'] }] })).toContain("option a: (Q2, Q3) is not one of K1's implementations");
    expect(issues({ ...SEQ_CHECK, goal: [] })).toContain('goal is empty');
  });
});

describe('solveCheck', () => {
  it('solves each kind', () => {
    expect(solveCheck(PLAN_CHECK)).toEqual({ plan: ['Move(X, Y, Table)', 'Move(Y, Table, X)'] });
    expect(solveCheck(SEQ_CHECK)).toEqual({ correct: ['a', 'b'] });
    expect(solveCheck(HLA_CHECK)).toEqual({ blanks: { pre1: '¬F', eff1: 'F ∧ ∼±G', eff2: '∼+F ∧ ∼±M', pre3: '¬G ∧ ¬M' } });
  });
});

describe('judgeFormal', () => {
  describe('plan', () => {
    it('is complete when every step runs and the goal holds', () => {
      expect(judgeFormal(PLAN_CHECK, ans({ text: '1. Move(X, Y, Table)\n2. Move(Y, Table, X)' }))).toMatchObject({ verdict: 'complete', parsed: true });
    });

    it('notes a longer plan works, and that a shorter one exists', () => {
      const j = judgeFormal(PLAN_CHECK, ans({ text: 'Move(X, Y, Table), Move(X, Table, Y), Move(X, Y, Table), Move(Y, Table, X)' }));
      expect(j?.verdict).toBe('complete');
      expect(j?.detail).toContain('fewer steps (2)');
    });

    it('names the learner\'s failing step and its unmet precondition, not the plan', () => {
      const j = judgeFormal(PLAN_CHECK, ans({ text: 'Move(Y, Table, X)' }));
      expect(j?.verdict).toBe('not_yet');
      expect(j?.detail).toContain('Step 1, Move(Y, Table, X)');
      expect(j?.detail).toContain('Clear(Y), which is false');
      expect(j?.detail).not.toContain('Move(X, Y, Table)');
    });

    it('names an unmet goal literal when every step runs', () => {
      const j = judgeFormal(PLAN_CHECK, ans({ text: 'Move(X, Y, Table)' }));
      expect(j).toMatchObject({ verdict: 'not_yet' });
      expect(j?.detail).toContain('On(Y, X) does not hold');
    });

    it('returns null when a step cannot be read', () => {
      expect(judgeFormal(PLAN_CHECK, ans({ text: 'Move(X, Y, Table), then put Y on X somehow' }))).toBeNull();
      expect(judgeFormal(PLAN_CHECK, ans({ text: '' }))).toBeNull();
    });
  });

  describe('sequences', () => {
    it('is complete on exactly the right set', () => {
      expect(judgeFormal(SEQ_CHECK, ans({ picked: ['a', 'b'] }))).toMatchObject({ verdict: 'complete', parsed: true });
    });

    it('is partial on an overlap, without naming what is unticked', () => {
      const j = judgeFormal(SEQ_CHECK, ans({ picked: ['a', 'c'] }));
      expect(j?.verdict).toBe('partial');
      expect(j?.detail).toContain('a reaches the goal');
      expect(j?.detail).toContain('c does not');
      expect(j?.detail).toContain('One more option reaches it');
      expect(j?.detail).not.toMatch(/\bb\b/);
      expect(judgeFormal(SEQ_CHECK, ans({ picked: ['a'] }))?.verdict).toBe('partial');
    });

    it('is not yet with no right pick; null with no known pick', () => {
      expect(judgeFormal(SEQ_CHECK, ans({ picked: ['c', 'd'] }))?.verdict).toBe('not_yet');
      expect(judgeFormal(SEQ_CHECK, ans({ picked: ['zz'] }))).toBeNull();
      expect(judgeFormal(SEQ_CHECK, ans({ picked: ['A', 'b', 'zz'] }))).toMatchObject({ verdict: 'complete', parsed: false });
    });
  });

  describe('hla_schema', () => {
    const blanks = { pre1: '¬F', eff1: 'F ∧ ∼±G', eff2: '∼+F ∧ ∼±M', pre3: '¬G ∧ ¬M' };

    it('is complete in any order and notation', () => {
      expect(judgeFormal(HLA_CHECK, ans({ blanks }))).toMatchObject({ verdict: 'complete' });
      expect(
        judgeFormal(HLA_CHECK, ans({ blanks: { pre1: '$\\neg F$', eff1: '+-g, f', eff2: 'possibly add or delete M and possibly add F', pre3: 'not m, not g' } }))?.verdict,
      ).toBe('complete');
    });

    it('is partial with some blanks right, and says what kind of thing is off', () => {
      const j = judgeFormal(HLA_CHECK, ans({ blanks: { ...blanks, eff1: 'F ∧ G' } }));
      expect(j?.verdict).toBe('partial');
      expect(j?.detail).toContain('pre1: right.');
      expect(j?.detail).toContain('eff1: not yet — one effect is certain where it should be possible.');
    });

    it('describes each kind of mistake without the answer', () => {
      const detail = (b: Partial<typeof blanks>) => judgeFormal(HLA_CHECK, ans({ blanks: { ...blanks, ...b } }))?.detail ?? '';
      expect(detail({ eff1: '∼+F ∧ ∼±G' })).toContain('one effect is marked possible where it is certain');
      expect(detail({ eff1: 'F ∧ ∼+G' })).toContain('one possible effect goes only one way where it can go either way');
      expect(detail({ eff2: '∼±F ∧ ∼±M' })).toContain('one possible effect goes either way where it can go only one way');
      expect(detail({ eff2: '∼−F ∧ ∼±M' })).toContain('one possible effect goes the wrong way');
      expect(detail({ eff1: 'F' })).toContain('one literal is missing');
      expect(detail({ eff1: 'F ∧ ∼±G ∧ N' })).toContain('one literal does not belong in it');
      expect(detail({ pre1: 'F' })).toContain('one precondition literal has the wrong sign');
      expect(detail({ pre1: '∼+F' })).toContain('marked possible, but a precondition is always certain');
      expect(detail({ eff1: 'F ∧ G ∧ ¬G' })).toContain('given twice');
      expect(detail({ pre1: '' })).toContain('pre1: still empty.');
      expect(detail({ eff1: 'F' })).not.toContain('G');
    });

    it('is not yet with every blank wrong; null when a blank cannot be read', () => {
      expect(judgeFormal(HLA_CHECK, ans({ blanks: { pre1: 'F', eff1: 'G', eff2: 'M', pre3: 'N' } }))?.verdict).toBe('not_yet');
      expect(judgeFormal(HLA_CHECK, ans({ blanks: { ...blanks, eff1: 'F or G' } }))).toBeNull();
    });
  });
});
