/**
 * The ledger's own prompt — the one the call actually gets since issue #35 item 5(b).
 *
 * The number that matters is the size: 15,090 system characters of room prefix for a call that
 * does not speak, measured on `room_6a9609d5c6fb` on 16 Sep. What it needs is the rubric.
 */
import { describe, expect, it } from 'vitest';
import { PSD_HESSIAN_CONVEXITY_V1 } from './concepts/psd-hessian-convexity-v1.js';
import { pendingPack } from './concepts/pending.js';
import { sharedBlock } from './prompts.js';
import { LEDGER_LEVEL_SCALE, ledgerSystemBlock } from './prompts.ledger.js';
import { rosterFor } from './agents.js';
import type { MaterialRow } from './records.js';

const block = ledgerSystemBlock(PSD_HESSIAN_CONVEXITY_V1);

describe('what the ledger call is given', () => {
  it('is the rubric and the claims, and not the room', () => {
    expect(block).toContain('0 not yet');
    expect(block).toContain('4 examined');
    for (const element of PSD_HESSIAN_CONVEXITY_V1.elements) {
      expect(block).toContain(element.id);
      expect(block).toContain(element.criteria['3']);
    }
    // Not a turn: none of the things that make one.
    expect(block).not.toContain('HOUSE RULES');
    expect(block).not.toContain('You are Ellie');
    expect(block).not.toContain('about 80 words');
  });

  it('is a fraction of the prefix it replaced', () => {
    const material = {
      module_code: 'CS4246',
      title: 'Search and planning',
      extracted_text: 'x'.repeat(27_948),
      topic_context: '',
      outline: '',
      padding_text: '',
    } as unknown as MaterialRow;
    const prefix = sharedBlock({
      material,
      pack: PSD_HESSIAN_CONVEXITY_V1,
      topic: 'search',
      roster: rosterFor('ellie_peer'),
    });
    expect(block.length).toBeLessThan(prefix.length / 4);
  });

  it('spends its longest paragraph on the rule that is checked in code', () => {
    expect(block).toContain('character for character');
    expect(block).toContain('Copy, never paraphrase.');
  });

  it('tells a pending pack’s ledger that an empty array is the answer', () => {
    expect(ledgerSystemBlock(pendingPack('Search and planning'))).toContain('empty array');
  });

  it('keeps its scale in step with the room’s own', () => {
    // Two copies exist because `prompts.ts` phrases the scale for a speaker and this one
    // phrases it for a judge. They must still describe the same five rungs.
    const shared = sharedBlock({
      material: { module_code: '', title: 't', extracted_text: '', topic_context: '', outline: '', padding_text: '' } as unknown as MaterialRow,
      pack: PSD_HESSIAN_CONVEXITY_V1,
      topic: 't',
      roster: rosterFor('ellie_peer'),
    });
    for (const line of LEDGER_LEVEL_SCALE.split('\n').slice(1)) {
      expect(shared).toContain(line);
    }
  });
});
