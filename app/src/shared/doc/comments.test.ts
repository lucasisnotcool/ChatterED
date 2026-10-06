import { describe, expect, it } from 'vitest';
import { blockIdsInDoc, explainPlainText } from './comments.js';

describe('explainPlainText', () => {
  it('takes the markers off and keeps the TeX source', () => {
    expect(explainPlainText('**Admissible** means $h(s) \\le h^*(s)$, *never* `over`.')).toBe(
      'Admissible means h(s) \\le h^*(s), never over.',
    );
    expect(explainPlainText('Two:\n\n- one\n2. two\n$$\\sum_i x_i$$')).toBe('Two:\none\ntwo\n\\sum_i x_i');
  });
});

describe('blockIdsInDoc', () => {
  it('finds every block id at any depth, from JSON or its string', () => {
    const d = {
      type: 'doc',
      content: [
        {
          type: 'bullet_list',
          attrs: { blockId: 'l' },
          content: [{ type: 'list_item', attrs: { blockId: 'li' }, content: [{ type: 'paragraph', attrs: { blockId: '' } }] }],
        },
      ],
    };
    expect([...blockIdsInDoc(d)]).toEqual(['l', 'li']);
    expect([...blockIdsInDoc(JSON.stringify(d))]).toEqual(['l', 'li']);
    expect(blockIdsInDoc('not json').size).toBe(0);
  });
});
