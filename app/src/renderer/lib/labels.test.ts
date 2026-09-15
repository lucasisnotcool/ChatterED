import { describe, expect, it } from 'vitest';
import type { AgentProfile } from '../../shared/types.js';
import { agentNames } from './labels.js';

const agent = (role: AgentProfile['role'], displayName: string): AgentProfile => ({
  key: `${role}.${displayName.toLowerCase()}`,
  role,
  displayName,
  colour: '#000',
  verb: 'typing',
  model: 'test',
  latency: { ttftMinMs: 0, ttftMaxMs: 0 },
});

/**
 * The Library's primary action reads "Explain p. 3 with Ellie and Max" (ui-review-ux.md B2).
 * The names have to come off the live roster: the role–name pairing is randomised at install
 * (§C2, #16), so a hardcoded "Ellie and Max" would be wrong for half of all installs the moment
 * anyone looked at which of them was the challenger.
 */
describe('agentNames', () => {
  const roster = [agent('peer', 'Ellie'), agent('challenger', 'Max'), agent('tutee', 'Theo')];

  it('names the peer and the challenger', () => {
    expect(agentNames(roster)).toBe('Ellie and Max');
  });

  it('never names the tutee — Theo is invited at the end of a round, not in it', () => {
    expect(agentNames(roster)).not.toContain('Theo');
    expect(agentNames([agent('tutee', 'Theo')])).toBe('your study group');
  });

  it('follows the roster rather than a hardcoded pair', () => {
    expect(agentNames([agent('peer', 'Max'), agent('challenger', 'Ellie')])).toBe('Max and Ellie');
  });

  it('says something usable before the roster has loaded', () => {
    expect(agentNames(undefined)).toBe('your study group');
    expect(agentNames([])).toBe('your study group');
  });

  it('handles one agent without an orphan conjunction', () => {
    expect(agentNames([agent('peer', 'Ellie')])).toBe('Ellie');
  });
});
