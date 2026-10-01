/**
 * The five blocks the Insert menu offers (notebooks §5.3), and the words that go with them.
 *
 * Pure so the words can be tested: `InsertControl.svelte` is glue, and a refusal the learner reads
 * should not be wrong for one of five kinds because the fifth was added in a template.
 */

import type { GeneratedBlockKind } from '../../shared/doc/types.js';

/** In menu order. */
export const BLOCK_KINDS: readonly GeneratedBlockKind[] = ['table', 'diagram', 'flashcards', 'quiz', 'infographic'];

const LABELS: Record<GeneratedBlockKind, string> = {
  table: 'Table',
  diagram: 'Diagram',
  flashcards: 'Flashcards',
  quiz: 'Quiz',
  infographic: 'Infographic',
};

export function blockKindLabel(kind: GeneratedBlockKind): string {
  return LABELS[kind];
}

/** What Ellie says when she looked at the section and found nothing worth that block. */
export function declinedLine(kind: GeneratedBlockKind): string {
  switch (kind) {
    case 'table':
      return 'Ellie found nothing in this section to put in a table.';
    case 'diagram':
      return 'Ellie found nothing in this section to draw.';
    case 'flashcards':
      return 'Ellie found too little in this section to make flashcards from.';
    case 'quiz':
      return 'Ellie found too little in this section to quiz you on.';
    case 'infographic':
      return 'Ellie found nothing in this section to lay out as an infographic.';
  }
}
