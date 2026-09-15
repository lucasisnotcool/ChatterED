import { describe, expect, it } from 'vitest';
import type { AgentProfile } from '../../shared/types.js';
import { ROLE_LABEL } from '../../room/agents.js';
import { agentNames, roleWord } from './labels.js';

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

/**
 * The role word is the standing reminder of each agent's contract (§C1). It changed with #32 —
 * Ellie is a Teacher now and Max a Tester — and the renderer had kept saying peer/challenger
 * while `ROLE_LABEL` in `src/room/agents.ts` said teacher/tester. Two labels for one contract is
 * one label too many, so they are asserted against each other here.
 */
describe('the role word', () => {
  it('says teacher and tester, matching ROLE_LABEL', () => {
    expect(roleWord('peer')).toBe(ROLE_LABEL.peer);
    expect(roleWord('challenger')).toBe(ROLE_LABEL.challenger);
    expect(roleWord('peer')).toBe('teacher');
    expect(roleWord('challenger')).toBe('tester');
  });

  it('leaves the stored role strings alone — this is a display mapping only', () => {
    // A test that would fail if someone "fixed" the column instead of the label.
    expect(agent('peer', 'Ellie').role).toBe('peer');
  });
});
