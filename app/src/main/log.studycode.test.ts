import { describe, expect, it } from 'vitest';
import { redact, scrub } from './log.js';

describe('study codes never reach the log', () => {
  it('scrubs a code from any string field', () => {
    expect(scrub('unlock failed for S07-K3QX-9MZT-4HRA today')).toBe('unlock failed for S..-[redacted] today');
    expect(redact({ cause: 'code S12-AAAA-BBBB-CCCC' })).toEqual({ cause: 'code S..-[redacted]' });
  });
});
