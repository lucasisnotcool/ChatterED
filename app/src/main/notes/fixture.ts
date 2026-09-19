/**
 * **The scripted backend's notes doc** (#48).
 *
 * Every test in this repo runs the `ScriptedClient` and no test makes a network call, and
 * `vite dev` runs against a mock bridge — so the ingest needs an answer for "there is no live
 * backend" that is a *document*, not an error. This is it: a short, real-looking set of notes
 * with real provenance, for the deck the video is filmed on, and a two-block stand-in for
 * anything else.
 *
 * It is small on purpose. It exists so the editor, the provenance chips, the figures and the
 * agents' edits can all be exercised without a model; it is not a sample of what the ingest
 * produces, and nothing should judge the prompt by it.
 */
import type { DocBlockDraft } from '../../shared/doc/types.js';

/**
 * The Critique 1 deck (`Academia/Sources/btw interaction/…Critique1_slides (1).pdf`), seven
 * pages — the fixture every other scripted path in the app is keyed to.
 */
export function critique1Notes(): DocBlockDraft[] {
  return [
    {
      kind: 'heading',
      level: 2,
      text: 'What `/btw` is',
      prov: { pages: [1, 2], reason: null },
    },
    {
      kind: 'paragraph',
      text:
        '`/btw` is a side channel into an agent that is already working. The learner types a question ' +
        'with `/btw` in front of it, and the agent answers **from the context of the main session ' +
        'only** — no tools, no memory, and nothing the question added is written back into the ' +
        'conversation history.',
      prov: { pages: [2], reason: null },
    },
    {
      kind: 'paragraph',
      text:
        'The point of keeping it out of the history is that the main task is not disturbed. The agent ' +
        'keeps doing what it was told to do, and the side question does not steer it.',
      prov: { pages: [2], reason: 'states the goal the slide only lists' },
    },
    {
      kind: 'heading',
      level: 2,
      text: 'Whispering, as people already do it',
      prov: { pages: [3], reason: null },
    },
    {
      kind: 'paragraph',
      text:
        'The analogy the deck builds is a meeting. Someone notices a problem with a slide, leans over ' +
        'to a neighbour rather than interrupting the speaker, and the correction reaches the room ' +
        'anyway. `/btw` is the same move with an agent in the neighbour\'s seat.',
      prov: { pages: [3], reason: null },
    },
    {
      kind: 'figure',
      page: 3,
      rect: null,
      caption: 'The human-to-human and human-to-AI whisper, drawn as the same four steps.',
      prov: { pages: [3], reason: null },
    },
    {
      kind: 'heading',
      level: 2,
      text: 'Why a side channel helps',
      prov: { pages: [6, 7], reason: null },
    },
    {
      kind: 'bullets',
      items: [
        'It removes the context penalty: asking does not cost the main session anything.',
        'It lowers the cost of participating, so more of the questions people have get asked.',
        'What starts as a whisper can be brought into the room when it turns out to matter.',
      ],
      prov: { pages: [6, 7], reason: null },
    },
  ];
}

/** Anything the scripted backend has no fixture for: honest, short, and provenance-clean. */
export function placeholderNotes(title: string): DocBlockDraft[] {
  return [
    {
      kind: 'paragraph',
      text: `These are placeholder notes for **${title}**.`,
      prov: { pages: [], reason: 'written without a model: no live backend is configured' },
    },
    {
      kind: 'paragraph',
      text:
        'The two-pass ingest needs the Claude CLI or an API key. Set one in Settings and reopen this ' +
        'document, and the real notes are written from the slides.',
      prov: { pages: [], reason: 'written without a model: no live backend is configured' },
    },
  ];
}
