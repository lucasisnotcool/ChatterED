import { describe, expect, it } from 'vitest';
import { GROUP_MAX_WORDS, hashText, normalise, noteChunks, pageChunks, stripQPreamble } from './chunk.js';
import {
  blank,
  diagram,
  doc,
  figure,
  flashcards,
  h,
  infographic,
  list,
  math,
  objectives,
  p,
  qBlock,
  quiz,
  slot,
  table,
  text,
  wordsOf,
} from './fixtures.test-support.js';

const NB = 'nb_1';
const O = { notebookId: NB, title: 'Lecture-complex v4.0' };
const chunksOf = (d: unknown) => noteChunks(d, O).chunks;

// ── rule 1: normalising ──────────────────────────────────────────────────────────────────────

describe('normalise', () => {
  it('folds PDF math italics and ligatures with NFKC', () => {
    expect(normalise('𝐹𝑙𝑦(𝑃, 𝑆𝐹𝑂, 𝑆𝐼𝑁)')).toBe('Fly(P, SFO, SIN)');
    expect(normalise('ﬁnd the ﬂow')).toBe('find the flow');
  });

  it('collapses KaTeX copy-paste doubling once', () => {
    expect(normalise('so h(s)≤h∗(s)h(s)≤h∗(s) holds')).toBe('so h(s)≤h∗(s) holds');
    // Three characters repeated is an ordinary word, not doubling.
    expect(normalise('a tsetse fly')).toBe('a tsetse fly');
  });

  it('turns nbsp into a space, drops zero-width characters, collapses spaces and tabs', () => {
    expect(normalise('  a\u00A0b\u200Bc \t\t d  ')).toBe('a bc d');
  });

  it('keeps newlines, trimming each line', () => {
    expect(normalise('  first line  \r\n   second\tline ')).toBe('first line\nsecond line');
  });
});

// ── hashing ──────────────────────────────────────────────────────────────────────────────────

describe('hashText', () => {
  it('is FNV-1a 64 over UTF-8', () => {
    expect(hashText('')).toBe('cbf29ce484222325');
    expect(hashText('a')).toBe('af63dc4c8601ec8c');
    expect(hashText('foobar')).toBe('85944171f73967e8');
  });

  it('is stable and tells apart texts that differ by one character, astral ones included', () => {
    expect(hashText('h(s) ≤ h*(s) 𝐹')).toBe(hashText('h(s) ≤ h*(s) 𝐹'));
    expect(hashText('heuristic')).not.toBe(hashText('hueristic'));
    expect(hashText('𝐹')).toMatch(/^[0-9a-f]{16}$/);
  });
});

// ── rules 2 and 3: headers and groups ────────────────────────────────────────────────────────

describe('noteChunks: headers and block groups', () => {
  it('heads every chunk with the title and the path below the H1, and embeds header + text', () => {
    const [chunk] = chunksOf(
      doc(h('t', 1, 'Lecture 4 notes'), h('s', 2, 'Heuristics for search-based planning', [12]), p('b1', wordsOf(45), [13])),
    );
    expect(chunk!.section).toEqual(['Heuristics for search-based planning']);
    expect(chunk!.embedText).toBe(`Lecture-complex v4.0 › Heuristics for search-based planning\n${wordsOf(45)}`);
    expect(chunk!.text).toBe(wordsOf(45));
    expect(chunk!.kind).toBe('note');
    expect(chunk!.page).toBeNull();
    expect(chunk!.key).toBe(`note:${NB}:b1`);
    expect(chunk!.hash).toBe(hashText(chunk!.embedText));
  });

  it('merges consecutive blocks until a group reaches 40 words', () => {
    const chunks = chunksOf(
      doc(
        h('s', 2, 'Search'),
        p('a', wordsOf(15, 'a')),
        p('b', wordsOf(15, 'b')),
        p('c', wordsOf(15, 'c')),
        p('d', wordsOf(15, 'd')),
      ),
    );
    expect(chunks.map((c) => c.blockIds)).toEqual([['a', 'b', 'c'], ['d']]);
    expect(chunks[0]!.text).toBe([wordsOf(15, 'a'), wordsOf(15, 'b'), wordsOf(15, 'c')].join('\n'));
  });

  it('starts a new group rather than pass the 220-word cap, and leaves one long block whole', () => {
    const chunks = chunksOf(
      doc(p('a', wordsOf(30, 'a')), p('b', wordsOf(200, 'b')), p('c', wordsOf(300, 'c')), p('d', wordsOf(10, 'd'))),
    );
    expect(chunks.map((c) => c.blockIds)).toEqual([['a'], ['b'], ['c'], ['d']]);
    expect(30 + 200).toBeGreaterThan(GROUP_MAX_WORDS);
  });

  it('never crosses a heading, and the H1 is context, not a section', () => {
    const chunks = chunksOf(
      doc(
        h('t', 1, 'Title'),
        p('lede', wordsOf(8, 'l')),
        h('s1', 2, 'One'),
        p('a', wordsOf(8, 'a')),
        h('s1a', 3, 'One point one'),
        p('b', wordsOf(8, 'b')),
        h('s2', 2, 'Two'),
        p('c', wordsOf(8, 'c')),
      ),
    );
    expect(chunks.map((c) => [c.blockIds, c.section])).toEqual([
      [['lede'], []],
      [['a'], ['One']],
      [['b'], ['One', 'One point one']],
      [['c'], ['Two']],
    ]);
    expect(chunks[0]!.embedText.split('\n')[0]).toBe('Lecture-complex v4.0');
  });

  it('treats a second H1 as an ordinary section', () => {
    const chunks = chunksOf(doc(h('t', 1, 'Title'), h('t2', 1, 'Second source'), p('a', wordsOf(8))));
    expect(chunks[0]!.section).toEqual(['Second source']);
  });

  it('ends a group at a blank paragraph, and at an empty note slot', () => {
    const chunks = chunksOf(
      doc(p('a', wordsOf(8, 'a')), blank('x'), p('b', wordsOf(8, 'b')), slot('y', [4]), p('c', wordsOf(8, 'c'))),
    );
    expect(chunks.map((c) => c.blockIds)).toEqual([['a'], ['b'], ['c']]);
  });

  it('skips blocks with no text without breaking the group', () => {
    const chunks = chunksOf(doc(p('a', wordsOf(8, 'a')), figure('f', 5, ''), list('l', ['']), p('b', wordsOf(8, 'b'))));
    expect(chunks.map((c) => c.blockIds)).toEqual([['a', 'b']]);
  });

  it('indexes a written note slot as the learner wrote it', () => {
    const filled = { ...slot('y', [4]), content: [text('My own summary of admissibility goes here.', 'user')] };
    expect(chunksOf(doc(filled))[0]!.text).toBe('My own summary of admissibility goes here.');
  });

  it('drops exact-duplicate blocks after the first, as a repeated ingest window would make', () => {
    const chunks = chunksOf(
      doc(
        h('s', 2, 'Planning graphs'),
        p('a', 'A planning graph alternates state and action levels.'),
        h('s_dup', 2, 'Planning graphs'),
        p('a_dup', 'A planning  graph alternates state and action levels.'),
        p('b', 'Mutex links record pairs that cannot hold together.'),
      ),
    );
    expect(chunks.map((c) => c.blockIds)).toEqual([['a'], ['b']]);
  });

  it('skips the objectives list and its heading', () => {
    const chunks = chunksOf(
      doc(
        h('t', 1, 'Title'),
        h('obh', 3, 'By the end you can', [], 'objectives'),
        objectives('ob', ['Define an admissible heuristic', 'Run A* by hand'], [1, 2, 3]),
        h('s', 2, 'Heuristics'),
        p('a', wordsOf(8)),
      ),
    );
    expect(chunks.map((c) => c.blockIds)).toEqual([['a']]);
    expect(chunks[0]!.section).toEqual(['Heuristics']);
  });
});

// ── provenance ───────────────────────────────────────────────────────────────────────────────

describe('noteChunks: pages', () => {
  it("unions the members' pages, and a block with none takes its section heading's", () => {
    const chunks = chunksOf(
      doc(
        h('s', 2, 'Relaxation', [21, 22]),
        h('s1', 3, 'Ignore delete lists'),
        p('a', wordsOf(8, 'a'), [24]),
        p('b', wordsOf(8, 'b'), [], 'user'),
        figure('f', 23, 'The relaxed planning graph'),
      ),
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.pages).toEqual([21, 22, 23, 24]);
  });

  it('is empty when neither the block nor any heading above it cites a page', () => {
    expect(chunksOf(doc(p('a', wordsOf(8), [], 'user')))[0]!.pages).toEqual([]);
  });
});

// ── rule 4: labels ───────────────────────────────────────────────────────────────────────────

describe('noteChunks: the learner’s labels', () => {
  const labelled = doc(
    h('t', 1, 'Lecture-complex'),
    h('s', 2, 'Heuristics for search-based planning', [12]),
    p('lab', 'PREREQ: HUERISTICS', [], 'user'),
    list('l1', ['Consistent: h(n) ≤ c(n, a, n′) + h(n′)'], [], { ordered: true, by: 'user' }),
    list('l2', ['Admissible: never overestimates the true cost'], [], { ordered: true, by: 'user' }),
    list('l3', ['Informative: closer to h* prunes more of the search'], [], { ordered: true, by: 'user' }),
    blank('x'),
    p('after', 'After the blank line, the label no longer applies to this text.'),
  );

  it('heads the blocks after a short unpunctuated paragraph, and is a member itself', () => {
    const chunks = chunksOf(labelled);
    const first = chunks[0]!;
    expect(first.blockIds).toEqual(['lab', 'l1', 'l2', 'l3']);
    expect(first.section).toEqual(['Heuristics for search-based planning', 'PREREQ: HUERISTICS']);
    expect(first.embedText.split('\n')[0]).toBe(
      'Lecture-complex v4.0 › Heuristics for search-based planning › PREREQ: HUERISTICS',
    );
    expect(first.text).toBe(
      [
        'PREREQ: HUERISTICS',
        '• Consistent: h(n) ≤ c(n, a, n′) + h(n′)',
        '• Admissible: never overestimates the true cost',
        '• Informative: closer to h* prunes more of the search',
      ].join('\n'),
    );
    expect(first.pages).toEqual([12]);
  });

  it('stops at a blank paragraph', () => {
    const after = chunksOf(labelled).find((c) => c.blockIds.includes('after'))!;
    expect(after.section).toEqual(['Heuristics for search-based planning']);
  });

  it('stops at a heading, and a new label replaces the old', () => {
    const chunks = chunksOf(
      doc(
        p('lab1', 'Key terms'),
        p('a', wordsOf(8, 'a')),
        p('lab2', 'Worked example'),
        p('b', wordsOf(8, 'b')),
        h('s', 2, 'Next'),
        p('c', wordsOf(8, 'c')),
      ),
    );
    expect(chunks.map((c) => [c.blockIds, c.section])).toEqual([
      [['lab1', 'a'], ['Key terms']],
      [['lab2', 'b'], ['Worked example']],
      [['c'], ['Next']],
    ]);
  });

  it('is not a label when it ends a sentence or runs past five words', () => {
    const chunks = chunksOf(doc(p('a', 'Heuristics matter.'), p('b', 'one two three four five six'), p('c', wordsOf(8))));
    expect(chunks[0]!.section).toEqual([]);
    expect(chunks[0]!.blockIds).toEqual(['a', 'b', 'c']);
  });
});

// ── rule 5: Q blocks ─────────────────────────────────────────────────────────────────────────

describe('noteChunks: Q blocks', () => {
  it("drops Max's opening sentence and keeps the question, the learner's answer and the feedback", () => {
    const q = qBlock('q1', [
      p(
        'q1_q',
        "Here's a question on the p. 17 example, so it's the statement I'm testing, not you. Why must h never overestimate for A* to stay optimal?",
        [17],
        'max',
      ),
      p('q1_a', 'Because otherwise A* could skip the cheaper path.', [], 'user'),
      p('q1_f', 'You got this: an overestimate can close the optimal node too late.', [], 'max'),
    ]);
    const [chunk] = chunksOf(doc(q));
    expect(chunk!.blockIds).toEqual(['q1']);
    expect(chunk!.text).toBe(
      [
        'Why must h never overestimate for A* to stay optimal?',
        'Because otherwise A* could skip the cheaper path.',
        'You got this: an overestimate can close the optimal node too late.',
      ].join('\n'),
    );
    expect(chunk!.pages).toEqual([17]);
  });

  it('strips the other openings that end "not you", and nothing else', () => {
    expect(stripQPreamble('This one tests the statement, not you, so take your time. What is h_max?')).toBe('What is h_max?');
    expect(stripQPreamble("Here's one on relaxation — not you. Which lists are dropped?")).toBe('Which lists are dropped?');
    expect(stripQPreamble("You might not like this next question, and that's fine — I'm testing the statement, not you. Why?")).toBe(
      'Why?',
    );
    expect(stripQPreamble('Why is it the planner and not you that picks the action?')).toBe(
      'Why is it the planner and not you that picks the action?',
    );
    expect(stripQPreamble('What does h_add add?\nIt is not you.')).toBe('What does h_add add?\nIt is not you.');
  });
});

// ── rule 6: composite blocks ─────────────────────────────────────────────────────────────────

describe('noteChunks: flashcards and tables are split', () => {
  it('indexes one chunk per card with the set title, and flushes the open group first', () => {
    const chunks = chunksOf(
      doc(
        h('s', 2, 'Assumptions'),
        p('a', wordsOf(8, 'a')),
        flashcards('fc', 'Classical assumptions', [
          ['Closed world assumption', 'Anything not stated true is false', [9]],
          ['Static', 'Nothing changes but by the agent'],
        ]),
        p('b', wordsOf(8, 'b')),
      ),
    );
    expect(chunks.map((c) => c.key)).toEqual([`note:${NB}:a`, `note:${NB}:fc#0`, `note:${NB}:fc#1`, `note:${NB}:b`]);
    const card = chunks[1]!;
    expect(card.text).toBe('Classical assumptions: Closed world assumption — Anything not stated true is false');
    expect(card.blockIds).toEqual(['fc']);
    expect(card.pages).toEqual([9]);
    expect(card.section).toEqual(['Assumptions']);
    expect(chunks[2]!.pages).toEqual([6]);
  });

  it('indexes one chunk per body row with the caption and the header row', () => {
    const chunks = chunksOf(
      doc(
        table(
          'tb',
          ['Heuristic', 'Admissible', 'Cost'],
          [
            ['h_max', 'yes', 'cheap'],
            ['h_add', 'no', 'cheap'],
          ],
          { caption: 'Relaxation heuristics', rowPages: [[25], []] },
        ),
      ),
    );
    expect(chunks.map((c) => c.key)).toEqual([`note:${NB}:tb#0`, `note:${NB}:tb#1`]);
    expect(chunks[0]!.text).toBe('Relaxation heuristics\nHeuristic | Admissible | Cost\nh_max | yes | cheap');
    expect(chunks[0]!.pages).toEqual([25]);
    expect(chunks[1]!.text).toBe('Relaxation heuristics\nHeuristic | Admissible | Cost\nh_add | no | cheap');
    expect(chunks[1]!.pages).toEqual([6]);
  });

  it('emits no block unit for a split block', () => {
    const { units } = noteChunks(doc(flashcards('fc', null, [['front side', 'back side']])), O);
    expect(units).toEqual([]);
  });
});

// ── rule 7: units ────────────────────────────────────────────────────────────────────────────

describe('noteChunks: block units', () => {
  it("emits one unit per member, each with the group's header", () => {
    const { chunks, units } = noteChunks(
      doc(h('s', 2, 'Heuristics'), p('lab', 'PREREQ: HUERISTICS', [], 'user'), list('l1', ['Consistent'], [], { ordered: true })),
      O,
    );
    expect(chunks).toHaveLength(1);
    expect(units).toEqual([
      {
        notebookId: NB,
        blockId: 'lab',
        embedText: 'Lecture-complex v4.0 › Heuristics › PREREQ: HUERISTICS\nPREREQ: HUERISTICS',
        hash: hashText('Lecture-complex v4.0 › Heuristics › PREREQ: HUERISTICS\nPREREQ: HUERISTICS'),
      },
      {
        notebookId: NB,
        blockId: 'l1',
        embedText: 'Lecture-complex v4.0 › Heuristics › PREREQ: HUERISTICS\n• Consistent',
        hash: hashText('Lecture-complex v4.0 › Heuristics › PREREQ: HUERISTICS\n• Consistent'),
      },
    ]);
  });
});

// ── other block types ────────────────────────────────────────────────────────────────────────

describe('noteChunks: other block types', () => {
  it('reads a formula as its TeX, a figure as its caption, a diagram as its title and labels', () => {
    const chunks = chunksOf(
      doc(
        math('m', 'h(s) \\le h^*(s)'),
        blank('x1'),
        figure('f', 30, 'The air cargo problem'),
        blank('x2'),
        diagram('d', 'Hierarchy', ['HLA', 'Refinement', 'Primitive action']),
      ),
    );
    expect(chunks.map((c) => c.text)).toEqual([
      'h(s) \\le h^*(s)',
      'The air cargo problem',
      'Hierarchy: HLA, Refinement, Primitive action',
    ]);
    expect(chunks[1]!.pages).toEqual([30]);
  });

  it("reads a quiz and an infographic through the schema's text helpers", () => {
    const chunks = chunksOf(
      doc(
        quiz('qz', 'Check', 'Which heuristic is admissible?', [['h_max', true], ['h_add', false]], 'h_max never overestimates.'),
        blank('x'),
        infographic('ig', 'HTN loop', [['1', 'Pick', 'Choose an HLA'], ['', 'Refine', 'Replace it with a refinement']]),
      ),
    );
    // The answer key and the explanation are hidden until the learner answers: not indexed.
    expect(chunks[0]!.text).toBe('Check: Which heuristic is admissible? [h_max / h_add]');
    expect(chunks[0]!.pages).toEqual([6, 7]);
    expect(chunks[1]!.text).toBe('HTN loop (steps): 1 Pick: Choose an HLA || Refine: Replace it with a refinement');
  });

  it('tolerates a node type this schema does not know, reading its caption and page', () => {
    const para = {
      type: 'paragraph',
      attrs: { blockId: 'img', pages: [], reason: 'pasted', objectiveIds: [] },
      content: [
        text('See the figure', 'user'),
        { type: 'slide_image', attrs: { page: 31, rect: null, width: null, caption: 'HTN algorithm' } },
        text('for the loop.', 'user'),
      ],
    };
    const [chunk] = chunksOf(doc(para, { type: 'callout_box', attrs: { blockId: 'cb' }, content: [p('cb_p', 'Remember the loop.')] }));
    expect(chunk!.text).toBe('See the figure HTN algorithm for the loop.\nRemember the loop.');
    expect(chunk!.blockIds).toEqual(['img', 'cb']);
    expect(chunk!.pages).toEqual([31]);
  });

  it('accepts the stored JSON string, and yields nothing for garbage', () => {
    const d = doc(p('a', wordsOf(8)));
    expect(noteChunks(JSON.stringify(d), O).chunks).toEqual(noteChunks(d, O).chunks);
    expect(noteChunks('{not json', O)).toEqual({ chunks: [], units: [] });
    expect(noteChunks(null, O)).toEqual({ chunks: [], units: [] });
  });
});

// ── stability ────────────────────────────────────────────────────────────────────────────────

describe('noteChunks: keys and hashes are stable', () => {
  const base = (lastText: string) =>
    doc(h('s', 2, 'One'), p('a', wordsOf(45, 'a')), h('s2', 2, 'Two'), p('b', wordsOf(8, 'b')), p('c', lastText));

  it('gives the same keys and hashes on a re-run', () => {
    expect(chunksOf(base('Last line.'))).toEqual(chunksOf(base('Last line.')));
  });

  it('changes only the edited group', () => {
    const before = chunksOf(base('Last line.'));
    const after = chunksOf(base('Last line, edited.'));
    expect(after.map((c) => c.key)).toEqual(before.map((c) => c.key));
    expect(after[0]!.hash).toBe(before[0]!.hash);
    expect(after[1]!.hash).not.toBe(before[1]!.hash);
  });
});

// ── pages ────────────────────────────────────────────────────────────────────────────────────

describe('pageChunks', () => {
  const deck = { notebookId: NB, title: 'Lecture-classic' };

  it('strips a footer repeated across the deck, page-number lines, and normalises with NFKC', () => {
    const bodies = ['Time and resources', 'Job-shop scheduling', 'Air cargo actions', 'Critical path method', 'Slack'];
    const pages = bodies.map((body, i) => ({
      page: 41 + i,
      text: `${body}\n${i === 2 ? '𝐹𝑙𝑦(𝑃, 𝑆𝐹𝑂, 𝑆𝐼𝑁)\n' : ''}Real World Planning and Acting ${String(29 + i)}\n${String(29 + i)}`,
    }));
    const chunks = pageChunks(pages, deck);
    expect(chunks.map((c) => c.text)).toEqual([
      'Time and resources',
      'Job-shop scheduling',
      'Air cargo actions\nFly(P, SFO, SIN)',
      'Critical path method',
      'Slack',
    ]);
    const third = chunks[2]!;
    expect(third.key).toBe(`page:${NB}:43`);
    expect(third.kind).toBe('page');
    expect(third.page).toBe(43);
    expect(third.pages).toEqual([43]);
    expect(third.blockIds).toEqual([]);
    expect(third.section).toEqual([]);
    expect(third.embedText).toBe('Lecture-classic — slide 43\nAir cargo actions\nFly(P, SFO, SIN)');
    expect(third.hash).toBe(hashText(third.embedText));
  });

  it('keeps a line on fewer than 40% of pages, and strips nothing but numbers from a short deck', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ page: i + 1, text: `Topic ${'abcdefghij'[i]!}${i < 3 ? '\nSee also' : ''}` }));
    expect(pageChunks(many, deck)[0]!.text).toBe('Topic a\nSee also');
    const short = [1, 2, 3].map((n) => ({ page: n, text: `Body\nFooter ${String(n)}\n${String(n)}` }));
    expect(pageChunks(short, deck).map((c) => c.text)).toEqual(['Body\nFooter 1', 'Body\nFooter 2', 'Body\nFooter 3']);
  });

  it('skips a page with no text left', () => {
    const pages = [
      { page: 1, text: 'Intro' },
      { page: 2, text: '  \n 2 ' },
    ];
    expect(pageChunks(pages, deck).map((c) => c.page)).toEqual([1]);
  });
});
