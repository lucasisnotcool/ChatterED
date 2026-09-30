/**
 * The region matcher and the hotspot builder (`cite.ts`).
 *
 * The slide used for the matcher is page 4 of the committed fixture deck, as `notes:pageLines`
 * returns its lines (the texts are verbatim; the boxes are simplified to one column, because the
 * matcher only ever unions them).
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_QUOTE_LINES,
  MIN_SCORE,
  bestRegion,
  contentWords,
  hotspotQuestion,
  hotspotsIn,
  isLabel,
  type PageLine,
} from './cite.js';

const column = (texts: string[]): PageLine[] =>
  texts.map((text, i) => ({ text, rect: { x: 0.6, y: 0.1 + i * 0.05, w: 0.3, h: 0.04 } }));

const SLIDE = column([
  '/btw vs. texting in a meeting (or, students chatting with lecturer is talking)',
  'Asking in main conversation may be disruptive',
  'Silent Whispering (Dennis et al., 2010):Agent did not need interjection, user was able to receive clarification',
  'Instant Messaging at a meeting',
  'Silent Whispering (p. 849-850):',
  '1. Interactivity – able to engage at any moment',
  '2. Polychronic – hold conversation in parallel',
  '3. Ephemeral – remarks are tentative',
  'Benefits of Silent Whispers (p. 864-868):',
  '1. Participation – members unable to get air time',
  'can engage at the sidelines',
  '2. Satisfaction – able to seek clarification and',
  'contribute their remarks',
  '3. Efficiency – Steps and decisions made in',
  'parallel within meeting',
  '4. Politeness – avoid “rude” interruption',
]);

describe('contentWords', () => {
  it('drops case, stop words, possessives, single characters and a plural s', () => {
    expect([...contentWords("Nielsen's ten Heuristics are the rules of a UI")]).toEqual([
      'nielsen',
      'ten',
      'heuristic',
      'rule',
      'ui',
    ]);
  });

  it('keeps a word that only looks plural', () => {
    expect([...contentWords('the class is a process')]).toEqual(['class', 'process']);
  });
});

describe('bestRegion', () => {
  it('finds the one line a short block restates', () => {
    const region = bestRegion('Asking in the main conversation can be disruptive.', SLIDE);
    expect(region?.quote).toBe('Asking in main conversation may be disruptive');
    expect(region?.rect).toEqual(SLIDE[1]!.rect);
    expect(region?.score).toBe(1);
  });

  it('takes a run of adjacent lines when the block paraphrases a list', () => {
    const region = bestRegion(
      'Silent whispering has three properties. It is interactive, so anyone can engage at any moment; ' +
        'polychronic, because a conversation is held in parallel; and ephemeral, since remarks are tentative.',
      SLIDE,
    );
    expect(region).not.toBeNull();
    // Lines 4 to 7: the list's own heading and its three items, and nothing of the next list.
    expect(region!.rect.y).toBeCloseTo(SLIDE[4]!.rect.y);
    expect(region!.rect.y + region!.rect.h).toBeCloseTo(SLIDE[7]!.rect.y + SLIDE[7]!.rect.h);
    expect(region!.score).toBeGreaterThan(0.6);
    // Four lines matched, three quoted, and the quote says there was more.
    expect(region!.quote.split('\n')).toHaveLength(MAX_QUOTE_LINES);
    expect(region!.quote.startsWith('Silent Whispering (p. 849-850):\n1. Interactivity')).toBe(true);
    expect(region!.quote.endsWith(' …')).toBe(true);
  });

  it('returns null for a block the slide does not say', () => {
    expect(
      bestRegion('Gradient descent updates the weights against the slope of the loss, one small step at a time.', SLIDE),
    ).toBeNull();
  });

  it('returns null when only one or two common words are shared', () => {
    // "engage" and "meeting" are both on the slide, in different places: not a region.
    expect(
      bestRegion('The whisper is a side channel: it lets a learner engage without stopping the meeting.', SLIDE),
    ).toBeNull();
    expect(bestRegion('Why a side channel', SLIDE)).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(bestRegion('', SLIDE)).toBeNull();
    expect(bestRegion('of the and', SLIDE)).toBeNull();
    expect(bestRegion('Silent whispering', [])).toBeNull();
  });

  it('never returns a region under the threshold', () => {
    for (const line of SLIDE) {
      const region = bestRegion(line.text, SLIDE);
      if (region) expect(region.score).toBeGreaterThanOrEqual(MIN_SCORE);
    }
  });

  it('prefers the shorter run on a tie', () => {
    const lines = column(['Working memory holds seven items', '—', 'Long-term memory is unbounded']);
    const region = bestRegion('Working memory holds about seven items.', lines);
    expect(region?.quote).toBe('Working memory holds seven items');
  });
});

describe('isLabel', () => {
  it('skips single characters, punctuation and bare numbers', () => {
    for (const no of ['x', ' • ', '—', '→ →', '12', '3.5 %', '(1)', '2010–2026', '']) {
      expect(isLabel(no), no).toBe(false);
    }
    for (const yes of ['CPU', 'Working memory', 'T1', 'n = 5', '/btw']) expect(isLabel(yes), yes).toBe(true);
  });

  it('skips a sentence of body text', () => {
    expect(isLabel('word '.repeat(30))).toBe(false);
  });
});

describe('hotspotsIn', () => {
  // A 16:9 page. Heights of 0.04 are about 22 pt; an `x` gap of 0.004 is a word space and one of
  // 0.1 is the gap between two boxes of a diagram.
  const item = (text: string, x: number, y: number, w: number, h = 0.04): PageLine => ({ text, rect: { x, y, w, h } });

  it('merges adjacent items on one line and keeps far ones apart', () => {
    const items = [
      item('Working', 0.2, 0.3, 0.08),
      item('memory', 0.286, 0.3, 0.07),
      item('Long-term', 0.6, 0.3, 0.09),
      item('store', 0.696, 0.3, 0.05),
    ];
    expect(hotspotsIn(items, null).map((h) => h.label)).toEqual(['Working memory', 'Long-term store']);
  });

  it('joins a style run that touches without a space, and one that ends in a space with one', () => {
    expect(hotspotsIn([item('f', 0.2, 0.3, 0.01), item('(x)', 0.2101, 0.3, 0.03)], null)[0]!.label).toBe('f(x)');
    expect(hotspotsIn([item('Input ', 0.2, 0.3, 0.06), item('layer', 0.26, 0.3, 0.05)], null)[0]!.label).toBe(
      'Input layer',
    );
  });

  it('does not merge across lines', () => {
    const items = [item('Encoder', 0.2, 0.3, 0.08), item('Decoder', 0.2, 0.36, 0.08)];
    expect(hotspotsIn(items, null).map((h) => h.label)).toEqual(['Encoder', 'Decoder']);
  });

  it('keeps only what is inside the crop, relative to it', () => {
    const items = [item('Title of the slide', 0.05, 0.05, 0.4), item('Encoder', 0.5, 0.5, 0.1), item('Decoder', 0.7, 0.7, 0.1)];
    const spots = hotspotsIn(items, { x: 0.4, y: 0.4, w: 0.5, h: 0.5 });
    expect(spots.map((h) => h.label)).toEqual(['Encoder', 'Decoder']);
    expect(spots[0]!.rect.x).toBeCloseTo(0.2);
    expect(spots[0]!.rect.y).toBeCloseTo(0.2);
    expect(spots[0]!.rect.w).toBeCloseTo(0.2);
    expect(spots[0]!.rect.h).toBeCloseTo(0.08);
  });

  it('clips a label that runs past the crop edge', () => {
    const [spot] = hotspotsIn([item('Attention', 0.7, 0.5, 0.3)], { x: 0.4, y: 0.4, w: 0.5, h: 0.5 });
    expect(spot!.rect.x + spot!.rect.w).toBeCloseTo(1);
  });

  it('skips numbers, punctuation and single characters, and gives a textless crop nothing', () => {
    const items = [item('1', 0.1, 0.1, 0.01), item('•', 0.1, 0.2, 0.01), item('42 %', 0.1, 0.3, 0.04), item('y', 0.1, 0.4, 0.01)];
    expect(hotspotsIn(items, null)).toEqual([]);
    expect(hotspotsIn([], null)).toEqual([]);
    expect(hotspotsIn([item('Encoder', 0.5, 0.5, 0.1)], { x: 0, y: 0, w: 0.3, h: 0.3 })).toEqual([]);
  });

  it('comes out in reading order', () => {
    const items = [item('Output', 0.6, 0.7, 0.08), item('Input', 0.1, 0.2, 0.06), item('Hidden', 0.4, 0.2, 0.07)];
    expect(hotspotsIn(items, null).map((h) => h.label)).toEqual(['Input', 'Hidden', 'Output']);
  });
});

describe('hotspotQuestion', () => {
  it('names the label and the page', () => {
    expect(hotspotQuestion('Working memory', 12)).toBe('What is "Working memory" in this figure on p. 12?');
  });
});
