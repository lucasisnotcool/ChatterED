/**
 * View-layer naming. Agent names and hues always come from AgentProfile data at
 * runtime — nothing here hardcodes Ellie, Max or Theo (product-design.md §C2).
 */
import type {
  AgentProfile,
  AgentRole,
  BloomRung,
  LedgerState,
  MessageView,
  VaultFileKind,
} from '../../shared/types.js';

/** The role word printed in every agent label — the standing reminder of the contract (§C1). */
export function roleWord(role: AgentRole): string {
  switch (role) {
    case 'peer':
      return 'peer';
    case 'challenger':
      return 'challenger';
    case 'tutee':
      return 'first year';
    default:
      return '';
  }
}

export function speakerLabel(m: MessageView): string {
  if (m.speaker.kind === 'student') return 'You';
  // The neutral voice is labelled by what it is, with no role word — it has no role, which is
  // the point of it (`pivot-spec.md` §C4: `REFERENCE` for a system answer).
  if (m.speaker.kind === 'reference') return 'REFERENCE';
  const word = roleWord(m.speaker.role);
  return word ? `${m.speaker.displayName} · ${word}` : m.speaker.displayName;
}

/**
 * "Ellie and Max" — the two agents who would be in the room, for the primary action that opens
 * one. Read off the live roster, never hardcoded (§C2), and the tutee is never named: Theo is
 * invited at the end of a round and never co-occurs with them (§P2).
 *
 * Exported because the Library's `Explain p. 3 with Ellie and Max` button is the one place the
 * learner is told what the button actually does before they press it (ui-review-ux.md B2).
 */
export function agentNames(agents: readonly AgentProfile[] | undefined, fallback = 'your study group'): string {
  const names = (agents ?? [])
    .filter((a) => a.role === 'peer' || a.role === 'challenger')
    .map((a) => a.displayName);
  if (names.length === 0) return fallback;
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

export function monogram(displayName: string): string {
  return displayName.trim().charAt(0).toUpperCase();
}

/** Monochrome, and a progression rather than a traffic light (§D2). */
export const LEDGER_GLYPH: Record<LedgerState, string> = {
  not_yet: '·',
  stated: '○',
  justified: '◐',
  defended: '●',
};

export const LEDGER_WORD: Record<LedgerState, string> = {
  not_yet: 'not yet',
  stated: 'stated',
  justified: 'justified',
  defended: 'defended',
};

export const BLOOM_RUNGS: BloomRung[] = ['remember', 'understand', 'apply', 'analyse'];

/** Colour is never the only cue, so every glyph carries a text equivalent (§C10). */
export function glyphAlt(state: LedgerState): string {
  return LEDGER_WORD[state];
}

/**
 * A neutral glyph per file kind for the vault tree (issue #22 decision 2). Text, not colour:
 * product-design.md §C2 rule 1 says hue is never the only cue, and rule 2 reserves every hue
 * that would otherwise be tempting here.
 */
export const KIND_GLYPH: Record<VaultFileKind, string> = {
  pdf: '▤',
  markdown: '▦',
  text: '≡',
  code: '‹›',
  image: '▣',
  other: '□',
};
