/**
 * Topic dot colours (issue #22 decision 2, "NUSSync-style count badges").
 *
 * product-design.md §C2 closes three of the four obvious choices: rule 2 (L689) reserves the
 * agent hues — teal #0F7B6C, amber #B45309, plum #7C3AED — for "that agent's rule, avatar and
 * label" and nothing else; rule 3 reserves indigo #4F46E5 for the learner and primary actions;
 * rule 4 bans red anywhere in the thread or the rail. A topic dot that reused any of them would
 * read as "Max's folder".
 *
 * So this is a separate, named set, picked to be distinguishable under deuteranopia and in
 * greyscale (the lightnesses are deliberately spread) and to sit away from the four reserved
 * hues on the wheel. The dot is never the only cue: the topic name is always next to it.
 */
export const TOPIC_COLOURS = [
  '#2563A8', // slate blue
  '#8A6D1F', // ochre
  '#3F6B4A', // moss
  '#6B4E7A', // mauve
  '#1F6F77', // deep cyan
  '#7A5230', // umber
  '#4A5578', // pewter
  '#66632A', // olive
] as const;

/** Stable per topic path, so a re-scan never re-colours the sidebar. */
export function topicColour(relPath: string, index: number): string {
  let h = index;
  for (const ch of relPath) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TOPIC_COLOURS[h % TOPIC_COLOURS.length]!;
}
