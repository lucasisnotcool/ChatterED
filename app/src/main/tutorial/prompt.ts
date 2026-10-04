/**
 * **What the tutorial calls say to the model, and the JSON they must answer in**
 * (`docs/research/tutorials.md` §3, §5; `TUTORIAL-CONTRACT.md` S3, S4).
 *
 * Four calls, each schema-bound on the overview's client:
 *
 *  1. **Read** the sheet: its blocks copied faithfully, its parts and their answer slots, and per
 *     part a hidden key, the notes blocks and lecture pages it draws on, and the objectives it
 *     exercises. Formal problems are *stated* (`formalCheck`) for code to solve.
 *  2. **Re-solve** the non-formal parts independently, without the key.
 *  3. **Compare** each re-solved answer with the key: agreement sets the key's confidence.
 *  4. **Judge** a learner's answer against the key, when no code check decides it.
 *
 * And a fifth, **keys from solutions**: the official answers rewrite the key of every part.
 *
 * Every object is `additionalProperties: false`, as the API's structured output requires; that is
 * why a formal check travels as a JSON *string* (its shape is too open for a strict schema) and
 * is parsed and validated in code (`core/planning.ts` `validateCheck`).
 */

/** `notes_docs.ingest_version` on a tutorial's doc. Moves when the read changes shape. */
export const TUTORIAL_PROMPT_VERSION = 1;

const PAGE = { type: 'integer', description: 'The page of the tutorial sheet, 1-based.' };
const STRINGS = { type: 'array', items: { type: 'string' } };
const RECT = {
  type: ['object', 'null'],
  additionalProperties: false,
  required: ['x0', 'y0', 'x1', 'y1'],
  properties: { x0: { type: 'number' }, y0: { type: 'number' }, x1: { type: 'number' }, y1: { type: 'number' } },
  description: 'Fractions of the page, 0..1, top-left origin. Prefer one of the candidate boxes given.',
};

/** A block of the sheet's own words. Fields a type does not use are null. */
const BLOCK_PROPERTIES = {
  type: { type: 'string', enum: ['heading', 'paragraph', 'list', 'math', 'code', 'figure'] },
  page: PAGE,
  text: { type: ['string', 'null'], description: 'heading, paragraph, code: the words, in the inline subset.' },
  level: { type: ['integer', 'null'], description: 'heading: 2 for a problem, 3 below it.' },
  ordered: { type: ['boolean', 'null'] },
  items: { type: ['array', 'null'], items: { type: 'string' }, description: 'list: one string per item.' },
  tex: { type: ['string', 'null'], description: 'math: display LaTeX, without dollar signs.' },
  rect: RECT,
  caption: { type: ['string', 'null'], description: 'figure: what it shows, in a few words.' },
  admin: { type: ['boolean', 'null'], description: 'True for housekeeping: sign-up, deadlines, submission rules.' },
};

const BLOCK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'page'],
  properties: BLOCK_PROPERTIES,
};

const ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'page'],
  properties: {
    ...BLOCK_PROPERTIES,
    type: { type: 'string', enum: ['heading', 'paragraph', 'list', 'math', 'code', 'figure', 'part'] },
    id: { type: ['string', 'null'], description: 'part: the sheet\'s address, stable: P1a, P3A.i, P3B.' },
    label: { type: ['string', 'null'], description: 'part: as the learner would say it, "Problem 3 A) i."' },
    prompt: { type: ['array', 'null'], items: BLOCK_SCHEMA, description: 'part: the sheet\'s words for this part.' },
    answer: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['kind'],
      properties: {
        kind: { type: 'string', enum: ['text', 'code', 'tree', 'sequence', 'blanks', 'choice'] },
        multi: { type: ['boolean', 'null'], description: 'choice: may more than one be ticked.' },
        options: {
          type: ['array', 'null'],
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'text'],
            properties: { id: { type: 'string' }, text: { type: 'string' } },
          },
        },
      },
    },
  },
};

const KEY_PROPERTIES = {
  partId: { type: 'string' },
  answer: { type: 'string', description: 'A model answer, complete, in the inline subset.' },
  blanks: {
    type: 'array',
    description: 'blanks parts: every blank id with its accepted answers, canonical first. Else [].',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'accepted'],
      properties: { id: { type: 'string' }, accepted: STRINGS },
    },
  },
  correct: { ...STRINGS, description: 'choice parts: the option ids that are correct. Else [].' },
  steps: { ...STRINGS, description: 'Two to four sub-steps, as short labels.' },
  mistakes: { ...STRINGS, description: 'Mistakes a learner is likely to make, one line each.' },
  prerequisites: { ...STRINGS, description: 'What a learner must already know, one line each.' },
};

export const TUTORIAL_JSON_SCHEMA: Record<string, unknown> = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  additionalProperties: false,
  required: ['title', 'blocks', 'parts'],
  properties: {
    title: { type: 'string', description: 'The sheet\'s own title.' },
    blocks: { type: 'array', items: ITEM_SCHEMA, description: 'The whole sheet, in order.' },
    parts: {
      type: 'array',
      description: 'One per part in `blocks`, same ids.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [...Object.keys(KEY_PROPERTIES), 'formalCheck', 'notesBlockIds', 'pages', 'objectiveIds'],
        properties: {
          ...KEY_PROPERTIES,
          formalCheck: {
            type: ['string', 'null'],
            description: 'A FormalCheck as a JSON string, only for a formal planning part. Else null.',
          },
          notesBlockIds: { ...STRINGS, description: 'Ids from the notes outline whose material this part uses.' },
          pages: { type: 'array', items: { type: 'integer' }, description: 'Lecture pages (notebook pages) it uses.' },
          objectiveIds: { ...STRINGS, description: 'Ids from the objectives list this part exercises.' },
        },
      },
    },
  },
};

export const TUTORIAL_SYSTEM = `You read a university tutorial (problem) sheet into a structured document that a learner completes beside their lecture notes.

COPY THE SHEET FAITHFULLY. Its words, in its order: headings, paragraphs, lists, display maths, code, figures. Do not summarise, reword, solve or add anything to the sheet's own text. Inline text uses only **bold**, *italic*, \`code\` and $inline TeX$. Mark housekeeping (team sign-up, deadlines, submission rules, marks) as admin: true.

PARTS. Every thing the learner must answer is one block of type "part", never nested: a sub-part is its own part ("Problem 3 A) i." is part P3A.i). Give each a short stable id built from the sheet's numbering (P1a, P2, P3A.i, P3B) and a label as a learner would say it. Its prompt holds the sheet's words for that part only. Choose its answer kind:
- code: a formal answer in a code block (PDDL, a program);
- tree: a nested list (a search tree, a decomposition);
- sequence: a numbered list (a plan, an ordering);
- blanks: the sheet leaves blanks in its own line ("Effect: ____"). Write each blank in the prompt as {{blank:ID}} with a short id, exactly where the sheet has the rule;
- choice: the sheet lists options to tick. Give the options with the sheet's own ids (i, ii, a, b) and say whether more than one may be ticked;
- text: anything else, answered in paragraphs.

FIGURES. A figure block crops a diagram from a page: give its page and a rectangle, preferring one of the candidate boxes listed for that page. Never describe a figure in place of copying text the sheet prints.

FOR EACH PART, a hidden key the learner never sees until they give up: a complete model answer; for blanks every blank's accepted answers; for choice the correct option ids; two to four sub-steps as short labels; likely mistakes; prerequisites. Work it out carefully.

FORMAL PARTS. Where a part is classical planning that code can check, also state it as formalCheck, a JSON string of one of:
{"type":"plan","domain":{"objects":[...],"actions":[ActionSchema],"static":[Literal]},"init":[Literal],"goal":[Literal]} — the answer is a sequence of ground actions;
{"type":"sequences","actions":[ActionSchema],"hlas":[{"name":"H1","implementations":[["P1","P3"]]}],"init":[Literal],"goal":[Literal],"options":[{"id":"i","steps":["H1(P1,P3)"]}]} — a choice part whose options are action sequences;
{"type":"hla_schema","actions":[ActionSchema],"hlas":[...],"blanks":{"BLANK_ID":{"hla":"H1","field":"precond"|"effect"}}} — a blanks part asking for an HLA's precondition or effect.
Model the domain exactly as the sheet states it: the sheet's own action names and parameters (if it defines Move(x, fr, to), use one Move action, not extra ones such as MoveToTable), and every fact the sheet says is always true (e.g. Clear(Table)) in "static", never in "init", so no effect can delete it.
Literal: {"pred":"On","args":["A","B"],"neg":false}. ActionSchema: {"name":"Move","params":["b","from","to"],"pre":[Literal],"eff":[Literal],"distinct":[["b","to"]]}; eff literals with neg true delete. Otherwise formalCheck is null.

LINKS. For each part, name the notes blocks (ids from the notes outline only) and the lecture pages (from the lecture page ranges only) whose material it draws on, and the objective ids (from the objectives list only) it exercises. Leave a list empty rather than guess.`;

/** The sheet, and what it is read against. */
export function tutorialMessage(input: {
  sourceName: string;
  pageCount: number;
  sheetText: string;
  figures: string;
  notesOutline: string;
  objectives: string;
  lecturePages: string;
  imagePages: readonly number[];
}): string {
  return [
    `TUTORIAL SHEET: ${input.sourceName} (${input.pageCount} page${input.pageCount === 1 ? '' : 's'}). Its pages are numbered 1..${input.pageCount} below; a block's page is one of these.`,
    input.imagePages.length > 0
      ? `Page images are attached for sheet pages ${input.imagePages.join(', ')}: read the maths, tables and figures from them.`
      : 'No page images are attached: read the text as it is.',
    '',
    input.sheetText,
    '',
    'FIGURE CANDIDATES (sheet page: boxes found on the page, x0 y0 x1 y1):',
    input.figures || '(none found)',
    '',
    'THE LEARNER\'S NOTES OUTLINE (block id | pages | where | text). Link parts to these ids only:',
    input.notesOutline || '(no notes yet: leave notesBlockIds empty)',
    '',
    'LECTURE PAGE RANGES (notebook pages). Link parts to these pages only:',
    input.lecturePages || '(no lecture source: leave pages empty)',
    '',
    'OBJECTIVES (id: title). Link parts to these ids only:',
    input.objectives || '(none yet: leave objectiveIds empty)',
  ].join('\n');
}

// ── the independent re-solve and the comparison ─────────────────────────────────────────────

export const RESOLVE_JSON_SCHEMA: Record<string, unknown> = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  additionalProperties: false,
  required: ['answers'],
  properties: {
    answers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['partId', 'answer'],
        properties: { partId: { type: 'string' }, answer: { type: 'string' } },
      },
    },
  },
};

export const RESOLVE_SYSTEM = `You solve the parts of a university tutorial sheet, each independently and carefully. For each part give a complete, concise answer. For a blanks part give each blank as "ID: value" on its own line; for a choice part give the ids of the correct options.`;

export function resolveMessage(parts: readonly { partId: string; label: string; kind: string; prompt: string; options: string }[]): string {
  return parts
    .map((p) => [`PART ${p.partId} (${p.label}; answer kind: ${p.kind})`, p.prompt, p.options].filter(Boolean).join('\n'))
    .join('\n\n');
}

export const COMPARE_JSON_SCHEMA: Record<string, unknown> = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  additionalProperties: false,
  required: ['parts'],
  properties: {
    parts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['partId', 'agree'],
        properties: { partId: { type: 'string' }, agree: { type: 'boolean' } },
      },
    },
  },
};

export const COMPARE_SYSTEM = `Two people answered the same tutorial parts independently. For each part, say whether the two answers agree in substance (the same result, or equivalent ones; notation and wording do not matter). Be strict about results, lenient about form.`;

export function compareMessage(parts: readonly { partId: string; prompt: string; first: string; second: string }[]): string {
  return parts.map((p) => `PART ${p.partId}\n${p.prompt}\n--- first ---\n${p.first}\n--- second ---\n${p.second}`).join('\n\n');
}

// ── judging a learner's answer ──────────────────────────────────────────────────────────────

export const JUDGE_JSON_SCHEMA: Record<string, unknown> = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'detail'],
  properties: {
    verdict: { type: 'string', enum: ['complete', 'partial', 'not_yet'] },
    detail: {
      type: 'string',
      description: 'For the tutor only: what is right, and what is missing or wrong, without the missing piece itself.',
    },
  },
};

export const JUDGE_SYSTEM = `You mark one learner's answer to one tutorial part against a hidden key. complete: correct in substance (any valid answer counts, not only the key's). partial: on the right track with something missing or wrong. not_yet: wrong or not yet an answer. In detail, say what is right and what is missing or wrong, in one or two sentences, without stating the missing piece itself. When the key is marked low-confidence, judge on the problem itself and do not mark an answer down only for differing from the key.`;

export function judgeMessage(input: {
  label: string;
  prompt: string;
  kind: string;
  answer: string;
  /** What the app's simulation of a plan answer said, when it rejected it (`check.ts`). */
  simulation?: string | null;
  key: { answer: string; steps: string[]; mistakes: string[]; confidence: 'high' | 'low'; blanks?: Record<string, string[]>; correct?: string[] };
}): string {
  const key = input.key;
  const simulated = input.simulation
    ? [
        '',
        `THE APP SIMULATED THIS PLAN under the key's own model of the domain and rejected it: ${input.simulation}`,
        "That model may differ from the sheet's stated assumptions (for example, a fact the sheet says is always true). Judge against the sheet: if the plan is valid under the sheet's assumptions, it is complete.",
      ]
    : [];
  return [
    ...simulated,
    `PART: ${input.label} (answer kind: ${input.kind})`,
    input.prompt,
    '',
    `KEY (${key.confidence}-confidence${key.confidence === 'low' ? ': a second solver disagreed' : ''}):`,
    key.answer,
    key.blanks ? `Accepted blanks: ${Object.entries(key.blanks).map(([id, v]) => `${id} = ${v.join(' | ')}`).join('; ')}` : '',
    key.correct ? `Correct options: ${key.correct.join(', ')}` : '',
    key.steps.length > 0 ? `Steps: ${key.steps.join(' → ')}` : '',
    key.mistakes.length > 0 ? `Likely mistakes: ${key.mistakes.join('; ')}` : '',
    '',
    'THE LEARNER\'S ANSWER:',
    input.answer || '(empty)',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

// ── keys from the official solutions ────────────────────────────────────────────────────────

export const SOLUTIONS_JSON_SCHEMA: Record<string, unknown> = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  additionalProperties: false,
  required: ['parts'],
  properties: {
    parts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: Object.keys(KEY_PROPERTIES),
        properties: KEY_PROPERTIES,
      },
    },
  },
};

export const SOLUTIONS_SYSTEM = `You are given a tutorial sheet's parts and its OFFICIAL SOLUTIONS. For each part, write the hidden key from the solutions: the solutions' answer (complete, in the inline subset: **bold**, *italic*, \`code\`, $TeX$), for blanks each blank's accepted answers, for choice the correct option ids, two to four sub-steps, likely mistakes and prerequisites. The solutions are ground truth: never contradict them. A part the solutions do not answer is left out.`;

export function solutionsMessage(input: {
  parts: readonly { partId: string; label: string; kind: string; prompt: string; options: string; blanks: string[] }[];
  solutionsText: string;
}): string {
  return [
    'THE PARTS:',
    ...input.parts.map((p) =>
      [`PART ${p.partId} (${p.label}; answer kind: ${p.kind}${p.blanks.length > 0 ? `; blank ids: ${p.blanks.join(', ')}` : ''})`, p.prompt, p.options]
        .filter(Boolean)
        .join('\n'),
    ),
    '',
    'THE OFFICIAL SOLUTIONS:',
    input.solutionsText,
  ].join('\n');
}
