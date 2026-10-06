import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mark, Node } from 'prosemirror-model';
import { authorMark, notesSchema } from '../../shared/doc/schema.js';
import { flashcards, infographic, quiz } from '../../shared/doc/fixture.test-support.js';
import {
  FORMULA_WORD,
  MAX_UTTERANCE_CHARS,
  RATE_KEY,
  RESUME_WATCHDOG_MS,
  ReadAloud,
  pickVoice,
  readQueue,
  sectionRange,
  splitForSpeech,
  type SpeechSynth,
  type SpeechUtterance,
  type SpeechVoice,
} from './readaloud.js';

// ── documents ───────────────────────────────────────────────────────────────────────────────

const attrs = (blockId: string) => ({ blockId, pages: [2], reason: null, objectiveIds: [] });
const ingest = authorMark('ingest', null, 1);
const text = (value: string, marks: Mark[] = []): Node => notesSchema.text(value, [ingest, ...marks]);

function heading(blockId: string, level: number, value: string): Node {
  return notesSchema.node('heading', { ...attrs(blockId), level }, text(value));
}

function para(blockId: string, ...content: (string | Node)[]): Node {
  return notesSchema.node(
    'paragraph',
    attrs(blockId),
    content.map((part) => (typeof part === 'string' ? text(part) : part)),
  );
}

function list(blockId: string, ...items: [string, string][]): Node {
  return notesSchema.node(
    'bullet_list',
    attrs(blockId),
    items.map(([id, value]) => notesSchema.node('list_item', { blockId: id }, para(`${id}_p`, value))),
  );
}

function docOf(...blocks: Node[]): Node {
  return notesSchema.node('doc', null, blocks);
}

/** A position inside the top-level block at `index`. */
function inside(doc: Node, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  return pos + 1;
}

const outline = (): Node =>
  docOf(
    heading('h_title', 1, 'Planning'),
    para('p_intro', 'An opening line.'),
    heading('h_a', 2, 'Value iteration'),
    para('p_a', 'Sweep the states.'),
    heading('h_a1', 3, 'Convergence'),
    para('p_a1', 'It converges.'),
    heading('h_b', 2, 'Policy iteration'),
    para('p_b', 'Evaluate, then improve.'),
  );

describe('sectionRange', () => {
  it('runs from the heading above the cursor to the next heading of the same level', () => {
    const doc = outline();
    expect(sectionRange(doc, inside(doc, 3))).toEqual({ from: 2, to: 6 });
  });

  it('keeps a sub-section inside the section that holds it', () => {
    const doc = outline();
    // In the h3: its own section ends at the next h2, which is a higher level.
    expect(sectionRange(doc, inside(doc, 5))).toEqual({ from: 4, to: 6 });
    // In the h2's heading itself: the h3 under it does not end the section.
    expect(sectionRange(doc, inside(doc, 2))).toEqual({ from: 2, to: 6 });
  });

  it('reads to the end of the document from the last section', () => {
    const doc = outline();
    expect(sectionRange(doc, inside(doc, 7))).toEqual({ from: 6, to: 8 });
  });

  it('starts at the top with no cursor', () => {
    const doc = outline();
    // The top block is the h1, and nothing below it is an h1, so its section is everything.
    expect(sectionRange(doc, null)).toEqual({ from: 0, to: 8 });
  });

  it('reads the opening of a document up to its first heading', () => {
    const doc = docOf(para('p_0', 'Before anything.'), para('p_1', 'Still before.'), heading('h', 2, 'First'));
    expect(sectionRange(doc, null)).toEqual({ from: 0, to: 2 });
    expect(sectionRange(doc, inside(doc, 1))).toEqual({ from: 0, to: 2 });
  });

  it('survives a position past the end', () => {
    const doc = outline();
    expect(sectionRange(doc, 10_000)).toEqual({ from: 6, to: 8 });
  });
});

describe('readQueue', () => {
  it('is one item per block, in order, under the block ids', () => {
    const doc = outline();
    expect(readQueue(doc, inside(doc, 3))).toEqual([
      { blockId: 'h_a', text: 'Value iteration' },
      { blockId: 'p_a', text: 'Sweep the states.' },
      { blockId: 'h_a1', text: 'Convergence' },
      { blockId: 'p_a1', text: 'It converges.' },
    ]);
  });

  it('reads a list item by item', () => {
    const doc = docOf(heading('h', 1, 'T'), list('l', ['li_1', 'First point'], ['li_2', 'Second point']));
    expect(readQueue(doc, null).slice(1)).toEqual([
      { blockId: 'li_1', text: 'First point' },
      { blockId: 'li_2', text: 'Second point' },
    ]);
  });

  it('highlights the list when an item has no id yet', () => {
    const doc = docOf(list('l', ['', 'Only point']));
    expect(readQueue(doc, null)).toEqual([{ blockId: 'l', text: 'Only point' }]);
  });

  it('reads a Q block as its question and what is written under it', () => {
    const q = notesSchema.node('q_block', { ...attrs('q'), questionId: 'q_1', status: 'resolved' }, [
      para('q_question', 'Why does it converge?'),
      para('q_resolution', 'Because the backup is a contraction.'),
    ]);
    expect(readQueue(docOf(q), null)).toEqual([
      { blockId: 'q_question', text: 'Why does it converge?' },
      { blockId: 'q_resolution', text: 'Because the backup is a contraction.' },
    ]);
  });

  it('skips slide figures and empty blocks, and says "formula" for display maths', () => {
    const doc = docOf(
      para('p_1', 'Before.'),
      notesSchema.node('slide_figure', { ...attrs('fig'), page: 3, caption: 'A caption' }),
      para('p_empty'),
      para('p_blank', '   '),
      notesSchema.node('math_block', { ...attrs('m'), tex: '\\sum_{s} V^*(s)' }),
      para('p_2', 'After.'),
    );
    expect(readQueue(doc, null)).toEqual([
      { blockId: 'p_1', text: 'Before.' },
      { blockId: 'm', text: FORMULA_WORD },
      { blockId: 'p_2', text: 'After.' },
    ]);
  });

  it('reads inline maths and code as their plain text, with no markers and no TeX', () => {
    const maths = notesSchema.marks.math_inline!.create({ tex: '\\gamma^{t}' });
    const code = notesSchema.marks.code!.create();
    const strong = notesSchema.marks.strong!.create();
    const doc = docOf(
      para('p', 'Discount by ', text('γ^t', [maths]), ' in ', text('backup()', [code]), ', ', text('always', [strong]), '.'),
    );
    expect(readQueue(doc, null)).toEqual([{ blockId: 'p', text: 'Discount by γ^t in backup(), always.' }]);
  });

  it('does not read a suggested insertion, and still reads the text it would replace', () => {
    const ins = notesSchema.marks.suggest_ins!.create({ suggestionId: 's', by: 'max' });
    const del = notesSchema.marks.suggest_del!.create({ suggestionId: 's', by: 'max' });
    const doc = docOf(para('p', 'It is ', text('linear', [del]), text('quadratic', [ins]), '.'));
    expect(readQueue(doc, null)).toEqual([{ blockId: 'p', text: 'It is linear.' }]);
  });

  it('reads a code block as its text', () => {
    const doc = docOf(notesSchema.node('code_block', attrs('c'), text('x = 1')));
    expect(readQueue(doc, null)).toEqual([{ blockId: 'c', text: 'x = 1' }]);
  });

  it('reads a table row by row, the cells parted by a comma', () => {
    const cell = (value: string, header = false): Node =>
      notesSchema.node('table_cell', { header }, value ? text(value) : []);
    const row = (...cells: Node[]): Node => notesSchema.node('table_row', null, cells);
    const table = notesSchema.node('table', { ...attrs('t'), caption: 'Two methods' }, [
      row(cell('Method', true), cell('Cost', true)),
      row(cell('Value iteration'), cell('Cheap sweeps')),
      row(cell('Policy iteration'), cell('')),
    ]);
    expect(readQueue(docOf(table), null)).toEqual([
      { blockId: 't', text: 'Two methods.' },
      { blockId: 't', text: 'Method, Cost.' },
      { blockId: 't', text: 'Value iteration, Cheap sweeps.' },
      { blockId: 't', text: 'Policy iteration.' },
    ]);
  });

  it('reads a diagram as its title and its labels', () => {
    const node = (nodeId: string, label: string): Node =>
      notesSchema.node('diagram_node', { nodeId }, text(label));
    const diagram = notesSchema.node(
      'diagram',
      { ...attrs('d'), title: 'The loop', edges: [{ from: 'a', to: 'b', label: null }] },
      [node('a', 'Evaluate'), node('b', 'Improve')],
    );
    expect(readQueue(docOf(diagram), null)).toEqual([
      { blockId: 'd', text: 'Diagram: The loop. Evaluate, Improve.' },
    ]);
  });
});

describe('readQueue — a concept card (notebooks.md §11.2, amended 2026-10-06)', () => {
  it('reads the core line, then each depth item under its label, each under its own id', () => {
    const card = notesSchema.node('concept', { ...attrs('c'), term: 'Gradient' }, [
      para('c_core', 'Gradient: the direction of steepest ascent.'),
      notesSchema.node('concept_item', { ...attrs('i_ex'), role: 'example' }, [para('i_ex_p', 'For x squared it is 2x.')]),
      notesSchema.node('concept_item', { ...attrs('i_pf'), role: 'pitfall', reason: 'a common slip' }, [
        para('i_pf_p', 'It is not the step size.'),
      ]),
    ]);
    expect(readQueue(docOf(heading('h', 2, 'Descent'), card), null)).toEqual([
      { blockId: 'h', text: 'Descent' },
      { blockId: 'c_core', text: 'Gradient: the direction of steepest ascent.' },
      { blockId: 'i_ex', text: 'Example.' },
      { blockId: 'i_ex_p', text: 'For x squared it is 2x.' },
      { blockId: 'i_pf', text: 'Pitfall.' },
      { blockId: 'i_pf_p', text: 'It is not the step size.' },
    ]);
  });
});

describe('readQueue — flashcards, a quiz, an infographic', () => {
  it('reads the fronts, then the backs, of a deck', () => {
    const deck = flashcards('f', [['Admissible', 'Never overestimates'], ['f(n)', 'g plus h']], { title: 'Terms' });
    expect(readQueue(docOf(deck), null)).toEqual([
      { blockId: 'f', text: 'Flashcards: Terms. Fronts. Admissible. f(n).' },
      { blockId: 'f', text: 'Backs. Never overestimates. g plus h.' },
    ]);
  });

  it('reads each question and its lettered options, and never the answer', () => {
    const quizNode = quiz('q', [
      { prompt: 'Which is admissible?', options: [{ text: 'Manhattan', correct: true }, { text: 'Twice the cost' }], explain: 'SECRET answer' },
      { prompt: 'Why?', explain: 'ALSO secret' },
    ]);
    const queue = readQueue(docOf(quizNode), null);
    expect(queue).toEqual([
      { blockId: 'q', text: 'Question 1. Which is admissible? Options. A, Manhattan. B, Twice the cost.' },
      { blockId: 'q', text: 'Question 2. Why?' },
    ]);
    expect(JSON.stringify(queue)).not.toContain('secret');
  });

  it('reads an infographic as its title, then each panel: value, heading, body', () => {
    const info = infographic(
      'i',
      [{ value: '1968', heading: 'A* published', body: 'Hart et al.' }, { heading: 'Then IDA*', body: 'Linear space.' }],
      { layout: 'timeline', title: 'History' },
    );
    expect(readQueue(docOf(info), null)).toEqual([
      { blockId: 'i', text: 'Infographic: History.' },
      { blockId: 'i', text: '1968. A* published. Hart et al.' },
      { blockId: 'i', text: 'Then IDA*. Linear space.' },
    ]);
  });
});

describe('splitForSpeech', () => {
  it('leaves a short block whole', () => {
    expect(splitForSpeech('One. Two. Three.')).toEqual(['One. Two. Three.']);
  });

  it('is empty for nothing', () => {
    expect(splitForSpeech('  \n ')).toEqual([]);
  });

  it('cuts a long block at sentence ends and loses nothing', () => {
    const sentences = Array.from({ length: 12 }, (_, i) => `Sentence number ${i} is about this long, give or take.`);
    const chunks = splitForSpeech(sentences.join(' '));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= MAX_UTTERANCE_CHARS)).toBe(true);
    expect(chunks.every((chunk) => chunk.endsWith('.'))).toBe(true);
    expect(chunks.join(' ')).toBe(sentences.join(' '));
  });

  it('does not cut at a decimal point or inside an abbreviation', () => {
    const chunks = splitForSpeech('The rate is 3.5 per step, e.g.this one. Next sentence here.', 40);
    expect(chunks).toEqual(['The rate is 3.5 per step, e.g.this one.', 'Next sentence here.']);
  });

  it('falls back to commas, then spaces, then a hard cut', () => {
    expect(splitForSpeech('alpha beta, gamma delta, epsilon zeta', 14)).toEqual([
      'alpha beta,',
      'gamma delta,',
      'epsilon zeta',
    ]);
    expect(splitForSpeech('one two three four', 9)).toEqual(['one two', 'three', 'four']);
    expect(splitForSpeech('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });
});

// ── the controller, against a fake synthesiser ──────────────────────────────────────────────

class FakeUtterance implements SpeechUtterance {
  voice: SpeechVoice | null = null;
  lang = '';
  rate = 1;
  #listeners = new Map<string, ((event: unknown) => void)[]>();
  constructor(readonly text: string) {}
  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
  }
  fire(type: string, event: unknown = {}): void {
    for (const listener of this.#listeners.get(type) ?? []) listener(event);
  }
}

class FakeSynth implements SpeechSynth {
  voices: SpeechVoice[] = [voice('Samantha', 'en-US')];
  spoken: FakeUtterance[] = [];
  calls: string[] = [];
  #voiceListeners: (() => void)[] = [];
  speak(utterance: SpeechUtterance): void {
    this.calls.push('speak');
    this.spoken.push(utterance as FakeUtterance);
  }
  cancel(): void {
    this.calls.push('cancel');
  }
  pause(): void {
    this.calls.push('pause');
  }
  resume(): void {
    this.calls.push('resume');
  }
  getVoices(): SpeechVoice[] {
    return this.voices;
  }
  addEventListener(_type: string, listener: () => void): void {
    this.#voiceListeners.push(listener);
  }
  removeEventListener(_type: string, listener: () => void): void {
    this.#voiceListeners = this.#voiceListeners.filter((l) => l !== listener);
  }
  voicesChanged(): void {
    for (const listener of this.#voiceListeners) listener();
  }
  get last(): FakeUtterance {
    return this.spoken[this.spoken.length - 1]!;
  }
  get listening(): number {
    return this.#voiceListeners.length;
  }
}

function voice(name: string, lang: string, extra: Partial<SpeechVoice> = {}): SpeechVoice {
  return { name, lang, localService: true, default: false, ...extra };
}

function memory(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

function rig(options: { synth?: FakeSynth | null; stored?: Record<string, string> } = {}) {
  const synth = options.synth === undefined ? new FakeSynth() : options.synth;
  const blocks: (string | null)[] = [];
  const storage = memory(options.stored);
  const reader = new ReadAloud(synth, {
    utterance: (value) => new FakeUtterance(value),
    lang: 'en',
    storage,
    onBlock: (blockId) => blocks.push(blockId),
  });
  return { synth: synth as FakeSynth, reader, blocks, storage };
}

const QUEUE = [
  { blockId: 'a', text: 'First block.' },
  { blockId: 'b', text: 'Second block.' },
];

describe('pickVoice', () => {
  it('takes only a voice of the language, and none when there is none', () => {
    expect(pickVoice([voice('Thomas', 'fr-FR')], 'en')).toBeNull();
    expect(pickVoice([voice('Thomas', 'fr-FR'), voice('Daniel', 'en-GB')], 'en')?.name).toBe('Daniel');
  });

  it('prefers Premium, then Enhanced, to the compact voice', () => {
    const voices = [
      voice('Samantha', 'en-US', { default: true }),
      voice('Ava (Enhanced)', 'en-US'),
      voice('Zoe (Premium)', 'en-US'),
    ];
    expect(pickVoice(voices, 'en-US')?.name).toBe('Zoe (Premium)');
    expect(pickVoice(voices.slice(0, 2), 'en-US')?.name).toBe('Ava (Enhanced)');
  });

  it('prefers an on-device voice to a network one', () => {
    const voices = [voice('Google US English', 'en-US', { localService: false }), voice('Samantha', 'en-US')];
    expect(pickVoice(voices, 'en-US')?.name).toBe('Samantha');
  });

  it('prefers the exact region, then the system default', () => {
    const voices = [voice('Samantha', 'en-US', { default: true }), voice('Daniel', 'en-GB')];
    expect(pickVoice(voices, 'en-GB')?.name).toBe('Daniel');
    expect(pickVoice(voices, 'en')?.name).toBe('Samantha');
    expect(pickVoice(voices, 'en_us')?.name).toBe('Samantha');
  });

  it('never picks a novelty voice while a real one exists', () => {
    const voices = [voice('Albert', 'en-US'), voice('Bad News', 'en-US'), voice('Samantha', 'en-US')];
    expect(pickVoice(voices, 'en-US')?.name).toBe('Samantha');
  });
});

describe('ReadAloud', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('speaks one block at a time and goes idle when the section ends', () => {
    const { synth, reader, blocks } = rig();
    expect(reader.start(QUEUE)).toBe(true);
    expect(reader.state).toBe('speaking');
    expect(reader.blockId).toBe('a');
    expect(synth.spoken.map((u) => u.text)).toEqual(['First block.']);
    expect(synth.last.voice?.name).toBe('Samantha');
    expect(synth.last.lang).toBe('en-US');

    synth.last.fire('end');
    expect(reader.blockId).toBe('b');
    expect(synth.spoken.map((u) => u.text)).toEqual(['First block.', 'Second block.']);

    synth.last.fire('end');
    expect(reader.state).toBe('idle');
    expect(reader.blockId).toBeNull();
    expect(blocks).toEqual(['a', 'b', null]);
  });

  it('splits a long block into several utterances under the same block id', () => {
    const { synth, reader, blocks } = rig();
    const long = Array.from({ length: 10 }, (_, i) => `This is sentence ${i} of a long paragraph.`).join(' ');
    reader.start([{ blockId: 'long', text: long }]);
    let guard = 0;
    while (reader.state === 'speaking' && guard++ < 50) synth.last.fire('end');
    expect(synth.spoken.length).toBeGreaterThan(1);
    expect(synth.spoken.every((u) => u.text.length <= MAX_UTTERANCE_CHARS)).toBe(true);
    expect(synth.spoken.map((u) => u.text).join(' ')).toBe(long);
    // The highlight was set once and cleared once: it never moved between the pieces.
    expect(blocks).toEqual(['long', null]);
  });

  it('pauses and resumes', () => {
    const { synth, reader } = rig();
    reader.start(QUEUE);
    reader.pause();
    expect(reader.state).toBe('paused');
    expect(synth.calls.at(-1)).toBe('pause');
    reader.resume();
    expect(reader.state).toBe('speaking');
    expect(synth.calls.at(-1)).toBe('resume');
    synth.last.fire('boundary');
    vi.advanceTimersByTime(RESUME_WATCHDOG_MS * 2);
    // It was heard from, so the sentence was not started again.
    expect(synth.spoken.length).toBe(1);
  });

  it('starts the sentence again when a resume is met with silence', () => {
    const { synth, reader } = rig();
    reader.start(QUEUE);
    reader.pause();
    reader.resume();
    vi.advanceTimersByTime(RESUME_WATCHDOG_MS + 1);
    expect(synth.spoken.map((u) => u.text)).toEqual(['First block.', 'First block.']);
    expect(reader.state).toBe('speaking');
    expect(reader.blockId).toBe('a');
  });

  it('stop always cancels and resets, even when idle or paused', () => {
    const { synth, reader, blocks } = rig();
    reader.stop();
    expect(synth.calls).toEqual(['cancel', 'resume']);

    reader.start(QUEUE);
    reader.pause();
    synth.calls.length = 0;
    reader.stop();
    expect(synth.calls).toEqual(['cancel', 'resume']);
    expect(reader.state).toBe('idle');
    expect(reader.blockId).toBeNull();
    expect(blocks).toEqual(['a', null]);

    // And the pause left nothing behind: a new reading speaks.
    expect(reader.start(QUEUE)).toBe(true);
    expect(reader.state).toBe('speaking');
  });

  it('ignores the end and the error a cancelled utterance fires late', () => {
    const { synth, reader } = rig();
    reader.start(QUEUE);
    const cancelled = synth.last;
    reader.stop();
    cancelled.fire('error', { error: 'canceled' });
    cancelled.fire('end');
    expect(reader.state).toBe('idle');
    expect(synth.spoken.length).toBe(1);

    // A restart: the first reading's late `end` must not advance the second.
    reader.start(QUEUE);
    const first = synth.last;
    reader.start([{ blockId: 'c', text: 'Another section.' }]);
    first.fire('end');
    expect(reader.blockId).toBe('c');
    expect(synth.last.text).toBe('Another section.');
  });

  it('starting again replaces the reading, from the new section', () => {
    const { synth, reader, blocks } = rig();
    reader.start(QUEUE);
    reader.start([{ blockId: 'c', text: 'Another section.' }]);
    expect(synth.calls.filter((call) => call === 'cancel').length).toBe(2);
    expect(blocks).toEqual(['a', 'c']);
  });

  it('stops when the voice fails', () => {
    const { synth, reader } = rig();
    reader.start(QUEUE);
    synth.last.fire('error', { error: 'synthesis-failed' });
    expect(reader.state).toBe('idle');
    expect(reader.blockId).toBeNull();
  });

  it('is unavailable with no synthesiser, and with no voices', () => {
    const none = rig({ synth: null });
    expect(none.reader.available).toBe(false);
    expect(none.reader.start(QUEUE)).toBe(false);
    none.reader.stop();
    expect(none.reader.state).toBe('idle');

    const silent = new FakeSynth();
    silent.voices = [];
    const { reader } = rig({ synth: silent });
    expect(reader.available).toBe(false);
    expect(reader.start(QUEUE)).toBe(false);
    expect(silent.spoken).toEqual([]);
  });

  it('becomes available when the voices load', () => {
    const synth = new FakeSynth();
    synth.voices = [];
    const changes: boolean[] = [];
    const reader: ReadAloud = new ReadAloud(synth, {
      utterance: (value) => new FakeUtterance(value),
      storage: null,
      onChange: () => changes.push(reader.available),
    });
    expect(reader.available).toBe(false);
    synth.voices = [voice('Samantha', 'en-US')];
    synth.voicesChanged();
    expect(reader.available).toBe(true);
    expect(changes).toEqual([true]);
    reader.dispose();
    expect(synth.listening).toBe(0);
  });

  it('has nothing to say for an empty queue', () => {
    const { synth, reader } = rig();
    expect(reader.start([{ blockId: 'a', text: '   ' }])).toBe(false);
    expect(reader.state).toBe('idle');
    expect(synth.spoken).toEqual([]);
  });

  it('reads the rate from storage, keeps it there, and refuses one not on the menu', () => {
    const { reader, storage } = rig({ stored: { [RATE_KEY]: '1.25' } });
    expect(reader.rate).toBe(1.25);
    reader.cycleRate();
    expect(reader.rate).toBe(1.5);
    expect(storage.getItem(RATE_KEY)).toBe('1.5');
    reader.cycleRate();
    expect(reader.rate).toBe(0.8);
    reader.setRate(3);
    expect(reader.rate).toBe(0.8);
    expect(rig({ stored: { [RATE_KEY]: 'fast' } }).reader.rate).toBe(1);
    expect(rig().reader.rate).toBe(1);
  });

  it('applies a new rate at once by starting the sentence again', () => {
    const { synth, reader } = rig();
    reader.start(QUEUE);
    expect(synth.last.rate).toBe(1);
    reader.setRate(1.5);
    expect(synth.spoken.map((u) => [u.text, u.rate])).toEqual([
      ['First block.', 1],
      ['First block.', 1.5],
    ]);
    synth.last.fire('end');
    expect(synth.last.rate).toBe(1.5);
  });

  it('applies a rate chosen while paused on resume', () => {
    const { synth, reader } = rig();
    reader.start(QUEUE);
    reader.pause();
    reader.setRate(0.8);
    expect(synth.spoken.length).toBe(1);
    reader.resume();
    expect(synth.last.rate).toBe(0.8);
    expect(synth.last.text).toBe('First block.');
    expect(reader.state).toBe('speaking');
  });
});
