/**
 * A small tutorial sheet in the shape the ingest returns, written for the tests (not any course's
 * sheet): a blocks-world plan, an explanation, HLA blanks, and a choose-all over HLA sequences.
 * Pages are the tutorial file's own, 1-based.
 */

import type { FormalCheck } from '../../core/planning.js';
import type { PartKey, TutorialSheet } from '../tutorial.js';

export const FIXTURE_SHEET: TutorialSheet = {
  title: 'Tutorial 9: Planning practice',
  blocks: [
    { type: 'heading', level: 2, text: 'Before you start', page: 1, admin: true },
    { type: 'paragraph', text: 'Work in pairs and bring your answers to class.', page: 1, admin: true },
    { type: 'heading', level: 2, text: 'Problem 1 – Two towers', page: 1 },
    { type: 'paragraph', text: 'Block **X** sits on block **Y**, which sits on the Table. Put **Y** on **X**.', page: 1 },
    { type: 'figure', page: 2, rect: { x0: 0.3, y0: 0.08, x1: 0.7, y1: 0.24 }, caption: 'Initial and goal states' },
    {
      type: 'part',
      id: 'P1a',
      label: 'Problem 1 a.',
      page: 2,
      prompt: [{ type: 'paragraph', text: 'Write the domain and problem in PDDL, with `Move(b, from, to)`.', page: 2 }],
      answer: { kind: 'code' },
    },
    {
      type: 'part',
      id: 'P1b',
      label: 'Problem 1 b.',
      page: 2,
      prompt: [{ type: 'paragraph', text: 'Give a valid plan.', page: 2 }],
      answer: { kind: 'sequence' },
    },
    { type: 'heading', level: 2, text: 'Problem 2 – Relaxation', page: 2 },
    {
      type: 'part',
      id: 'P2',
      label: 'Problem 2',
      page: 2,
      prompt: [{ type: 'paragraph', text: 'Why does ignoring delete lists give an admissible heuristic?', page: 2 }],
      answer: { kind: 'text' },
    },
    { type: 'heading', level: 2, text: 'Problem 3 – HLAs', page: 3 },
    {
      type: 'list',
      ordered: false,
      items: ['Action(Q1, Precond: $\\neg F$, Effect: $F$)', 'Action(Q2, Precond: $F$, Effect: $G$)', 'Action(Q3, Precond: $F$, Effect: $\\neg G$)'],
      page: 3,
    },
    {
      type: 'part',
      id: 'P3A.i',
      label: 'Problem 3 A) i.',
      page: 3,
      prompt: [
        { type: 'paragraph', text: 'Action(K1, Precond: $\\neg F$, Effect: {{blank:eff}})', page: 3 },
        { type: 'paragraph', text: 'Implementations: [Q1, Q2] · [Q1, Q3]', page: 3 },
      ],
      answer: { kind: 'blanks', blanks: ['eff'] },
    },
    {
      type: 'part',
      id: 'P3B',
      label: 'Problem 3 B)',
      page: 3,
      prompt: [{ type: 'paragraph', text: 'From $\\neg F$, which reach $G$? Choose all that apply.', page: 3 }],
      answer: {
        kind: 'choice',
        multi: true,
        options: [
          { id: 'i', text: 'K1 (Q1, Q2)' },
          { id: 'ii', text: 'K1 (Q1, Q3)' },
        ],
      },
    },
  ],
};

const lit = (pred: string, args: string[] = [], neg = false) => ({ pred, args, neg });

const Q_ACTIONS = [
  { name: 'Q1', params: [], pre: [lit('F', [], true)], eff: [lit('F')] },
  { name: 'Q2', params: [], pre: [lit('F')], eff: [lit('G')] },
  { name: 'Q3', params: [], pre: [lit('F')], eff: [lit('G', [], true)] },
];
const K_HLAS = [{ name: 'K1', implementations: [['Q1', 'Q2'], ['Q1', 'Q3']] }];

export const FIXTURE_CHECKS: Record<string, FormalCheck> = {
  P1b: {
    type: 'plan',
    domain: {
      objects: ['X', 'Y', 'Table'],
      actions: [
        {
          name: 'Move',
          params: ['b', 'from', 'to'],
          pre: [lit('On', ['b', 'from']), lit('Clear', ['b']), lit('Clear', ['to'])],
          eff: [lit('On', ['b', 'to']), lit('On', ['b', 'from'], true), lit('Clear', ['from']), lit('Clear', ['to'], true)],
          distinct: [
            ['b', 'from'],
            ['b', 'to'],
            ['from', 'to'],
          ],
        },
      ],
      static: [lit('Clear', ['Table'])],
    },
    init: [lit('On', ['X', 'Y']), lit('On', ['Y', 'Table']), lit('Clear', ['X'])],
    goal: [lit('On', ['Y', 'X'])],
  },
  'P3A.i': { type: 'hla_schema', actions: Q_ACTIONS, hlas: K_HLAS, blanks: { eff: { hla: 'K1', field: 'effect' } } },
  P3B: {
    type: 'sequences',
    actions: Q_ACTIONS,
    hlas: K_HLAS,
    init: [],
    goal: [lit('G')],
    options: [
      { id: 'i', steps: ['K1(Q1,Q2)'] },
      { id: 'ii', steps: ['K1(Q1,Q3)'] },
    ],
  },
};

export const FIXTURE_KEYS: PartKey[] = [
  { partId: 'P1b', answer: 'Move(X, Y, Table), Move(Y, Table, X)', steps: ['Clear Y', 'Stack Y on X'], mistakes: ['Moving Y while X is on it'], prerequisites: ['Preconditions must hold before an action'], check: FIXTURE_CHECKS.P1b, confidence: 'high', from: 'model' },
  { partId: 'P3A.i', answer: '$F \\wedge \\sim\\pm G$', blanks: { eff: ['F ∧ ∼±G'] }, steps: ['Effects of each implementation', 'Combine'], mistakes: ['Writing G'], prerequisites: ['Angelic semantics'], check: FIXTURE_CHECKS['P3A.i'], confidence: 'high', from: 'model' },
  { partId: 'P3B', answer: 'i', correct: ['i'], steps: ['Simulate each option'], mistakes: [], prerequisites: [], check: FIXTURE_CHECKS.P3B, confidence: 'high', from: 'model' },
];
