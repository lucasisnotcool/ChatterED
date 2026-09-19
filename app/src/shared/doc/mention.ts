/**
 * `@Ellie …` / `@Max …` — who the learner is talking to (§4.2).
 *
 * The rule the mention decides is in `src/room`, not here: no mention means Ellie answers in
 * full and Max asks one follow-up; a mention means that agent only, and no follow-up. This file
 * answers one question — *is there a mention, and what is left of the message without it* — and
 * it answers it the way a person typing would expect:
 *
 *  - **Case-insensitive.** `@max`, `@Max`, `@MAX`.
 *  - **Punctuation after the name is punctuation, not part of it.** `@Ellie,` and `@Max:` are
 *    mentions; the comma goes with the marker, so `rest` does not open on a comma.
 *  - **An email address is not a mention.** `a@max.com` names nobody; the `@` has a word
 *    character in front of it, and `.com` follows the name. Both are ruled out below.
 *  - **The first mention wins.** "@Ellie ask @Max" is addressed to Ellie, and Max's name stays
 *    in the sentence where she can read it.
 */

import type { AgentAuthor, Mention } from './types.js';

/**
 * `@ellie` or `@max`, not preceded by a word character (so `a@max…` cannot match) and not
 * followed by one (so `@maximum` cannot). A trailing `,.:;!?` is taken with the marker, but only
 * when the message ends or a space follows — which is what keeps `@max.com` out while letting
 * `@Max.` at the end of a sentence in.
 */
const MENTION = /(^|[^\w@.])@(ellie|max)(?=$|[^\w.]|\.(?=\s|$))([,.:;!?]?)(?=\s|$|[^\w.])/i;

export function parseMention(text: string): Mention | null {
  const match = MENTION.exec(text);
  if (!match) return null;
  const agent = (match[2] ?? '').toLowerCase() as AgentAuthor;
  const at = match.index + (match[1] ?? '').length;
  const rest = `${text.slice(0, at)}${text.slice(at + match[0].length - (match[1] ?? '').length)}`;
  return {
    agent,
    // Whitespace tidied, not the words: "@Max   why?" is "why?", and a message that was only a
    // mention has an empty `rest`, which the caller reads as "they said the name and nothing
    // else" rather than as "no mention".
    rest: rest.replace(/\s+/g, ' ').trim(),
  };
}
