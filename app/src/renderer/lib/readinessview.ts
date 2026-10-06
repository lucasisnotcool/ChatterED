/**
 * **"Ready to check this?"**, measured in the renderer (Lucas's decision of 2026-10-06, D2;
 * `collab-doc.md` §6 and `notebooks.md` §5.2, amended 2026-10-06). Pure and tested.
 *
 * `core/readiness.ts` decides; this file gathers what it decides from. Half of the signals are
 * main's (the objective's fill, and the Explain and Example presses on its lines since its last
 * question closed, `ProgressObjectiveView.activity`); the other half only the renderer can see:
 *
 *  - **own words**: what the learner wrote in the section themselves (author mark `user`),
 *    outside any question block;
 *  - **depth opened**: folds opened from the section (its slide strip, a slide window opened from
 *    one of its lines, and later a concept card's depth, through `DocStore.noteDepthOpened`);
 *  - **time on the section**: how long it was the one being read. The clock and the DOM are the
 *    store's (`docstore.svelte.ts`); here it is only a number added to a counter.
 *
 * All of it counts **since the last question on the objective closed** (`activity.since`), as
 * core's docstring says, so a release does not leave the section ready for an immediate re-ask:
 * when `since` moves, the time and the folds start again from zero and the words already written
 * become the baseline.
 *
 * **What a section is** is `notesmap.ts`'s rule (a heading through to the next heading of the same
 * or a higher level), and **which heading** is `lessonBlocks`'s (`main/docroom/doc.ts`): the first
 * heading among the objective's `blockIds`. An objective whose blocks hold no heading takes the
 * heading its first block sits under; one with no heading at all is not offered, because the offer
 * is drawn on a heading and there would be nowhere to put it.
 *
 * The offer only ever **calls Quiz me** on the section's first line. Nothing here asks anything.
 */

import type { Node } from 'prosemirror-model';
import { blockAttrs, blockPos, textRuns } from '../../shared/doc/schema.js';
import type { ProgressObjectiveView } from '../../shared/doc/types.js';
import { offerCheck, type ReadinessSignals } from '../../core/readiness.js';
import { OBJECTIVES_REASON, TITLE_REASON, hasToolbar } from './pm/overview.js';

/** One objective's section in the document as it is now. */
export interface ObjectiveSection {
  objectiveId: string;
  headingBlockId: string;
  /** The heading's position, and the end of the section's last block. */
  from: number;
  to: number;
  /**
   * The line Quiz me is pressed on: the section's first line with the action toolbar, else its
   * first block that is neither a heading nor a question. Null when the section has none.
   */
  target: string | null;
}

interface Top {
  node: Node;
  pos: number;
  blockId: string;
  /** The heading's level, or null for any other block. */
  level: number | null;
}

function topBlocks(doc: Node): { tops: Top[]; index: Map<string, number> } {
  const tops: Top[] = [];
  // Any block id, nested ones too (a list item, a cell), to the top-level block that holds it:
  // an objective's `blockIds` may name a line inside a list.
  const index = new Map<string, number>();
  doc.forEach((node, pos) => {
    const at = tops.length;
    const { blockId } = blockAttrs(node);
    tops.push({ node, pos, blockId, level: node.type.name === 'heading' ? ((node.attrs.level as number) ?? 1) : null });
    if (blockId) index.set(blockId, at);
    node.descendants((child) => {
      const id = blockAttrs(child).blockId;
      if (id && !index.has(id)) index.set(id, at);
      return true;
    });
  });
  return { tops, index };
}

/** The sections of the given objectives, in their order. Objectives with none are left out. */
export function objectiveSections(
  doc: Node,
  objectives: readonly Pick<ProgressObjectiveView, 'objectiveId' | 'blockIds'>[],
): ObjectiveSection[] {
  const { tops, index } = topBlocks(doc);
  const out: ObjectiveSection[] = [];
  for (const objective of objectives) {
    // The first id in the list that is itself a heading (not merely a block inside one's section).
    let head: number | undefined = objective.blockIds
      .map((id) => ({ id, at: index.get(id) }))
      .find(({ id, at }) => at !== undefined && tops[at]!.blockId === id && tops[at]!.level !== null)?.at;
    const first = objective.blockIds.map((id) => index.get(id)).find((at) => at !== undefined);
    if (head === undefined && first !== undefined) {
      for (let i = first; i >= 0; i--) {
        if (tops[i]!.level !== null) {
          head = i;
          break;
        }
      }
    }
    if (head === undefined) continue;
    const heading = tops[head]!;
    if (!heading.blockId || heading.level === null) continue;
    // The overview's title and its "By the end you can" are scaffolding, not a section (C6): the
    // title's "section" would be the whole document.
    const reason = blockAttrs(heading.node).reason;
    if (reason === TITLE_REASON || reason === OBJECTIVES_REASON) continue;
    let end = head + 1;
    while (end < tops.length) {
      const level = tops[end]!.level;
      if (level !== null && level <= heading.level) break;
      end++;
    }
    const body = tops.slice(head + 1, end);
    const target =
      body.find((t) => t.blockId && hasToolbar(t.node))?.blockId ??
      body.find((t) => t.blockId && t.level === null && t.node.type.name !== 'q_block')?.blockId ??
      null;
    const last = tops[end - 1]!;
    out.push({
      objectiveId: objective.objectiveId,
      headingBlockId: heading.blockId,
      from: heading.pos,
      to: last.pos + last.node.nodeSize,
      target,
    });
  }
  return out;
}

const WORDLIKE = /[\p{L}\p{N}]/u;

function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => WORDLIKE.test(word)).length;
}

/**
 * The words the learner typed themselves in one block. Runs a mark boundary split are one span,
 * and an agent's phrase between two of the learner's is a gap: the same rule as `learnerSpans`,
 * so a word is never split in two by a change of mark, nor glued to the agent's words.
 */
export function learnerWords(node: Node): number {
  let words = 0;
  let span = '';
  let end = -1;
  for (const run of textRuns(node, 0)) {
    const mine = run.marks.some((mark) => mark.type.name === 'author' && mark.attrs.by === 'user');
    if (!mine) continue;
    if (run.from !== end) {
      words += countWords(span);
      span = '';
    }
    span += run.text;
    end = run.to;
  }
  return words + countWords(span);
}

/**
 * The learner's own words in a section, **outside any question block**: an answer under Max's
 * question is marked on Submit, and counting it here as well would make answering a question
 * the reason to be offered the next one.
 */
export function sectionOwnWords(doc: Node, section: Pick<ObjectiveSection, 'from' | 'to'>): number {
  let words = 0;
  doc.forEach((node, pos) => {
    if (pos < section.from || pos >= section.to || node.type.name === 'q_block') return;
    words += learnerWords(node);
  });
  return words;
}

/**
 * The objectives with one of Max's questions open in the document: by the Q block's own
 * `objectiveId`, or by where it stands (an open question inside a section is that section's,
 * whatever it was filed under).
 */
export function openQuestionObjectives(doc: Node, sections: readonly ObjectiveSection[]): Set<string> {
  const open = new Set<string>();
  doc.forEach((node, pos) => {
    if (node.type.name !== 'q_block') return;
    if ((node.attrs.askedBy as string) === 'user' || ((node.attrs.status as string) || 'open') !== 'open') return;
    const filed = node.attrs.objectiveId as string | null;
    if (filed) open.add(filed);
    for (const section of sections) if (pos >= section.from && pos < section.to) open.add(section.objectiveId);
  });
  return open;
}

/** The objectives whose sections hold a document position (sections nest: an H2 holds its H3s). */
export function objectivesAt(sections: readonly ObjectiveSection[], pos: number): string[] {
  return sections.filter((s) => pos >= s.from && pos < s.to).map((s) => s.objectiveId);
}

/** The objectives whose sections hold a block, by id. None when the block is gone. */
export function objectivesHolding(doc: Node, sections: readonly ObjectiveSection[], blockId: string): string[] {
  const found = blockPos(doc, blockId);
  return found ? objectivesAt(sections, found.pos) : [];
}

interface Counter {
  /** `activity.since` when last seen; `undefined` until the first look. */
  since: string | null | undefined;
  dwellMs: number;
  depthOpened: number;
  /** The section's own words when its last question closed: only words past these count. */
  wordsBase: number;
}

/**
 * The renderer's half of the signals, per objective. Plain numbers in and out: the store owns the
 * clock and the DOM, and adds to these.
 */
export class ReadinessCounters {
  // A plain Map: nothing renders it, and the store reads it only when it recomputes the offers.
  #by = new Map<string, Counter>();

  #get(objectiveId: string): Counter {
    let counter = this.#by.get(objectiveId);
    if (!counter) {
      counter = { since: undefined, dwellMs: 0, depthOpened: 0, wordsBase: 0 };
      this.#by.set(objectiveId, counter);
    }
    return counter;
  }

  /**
   * Take the objective's `since` and the section's words now. When `since` has moved, a question
   * on it closed: the time and the folds start again and the words now are the new baseline. The
   * first look only records it; there is nothing yet to reset.
   */
  sync(objectiveId: string, since: string | null, ownWordsNow: number): Readonly<Counter> {
    const counter = this.#get(objectiveId);
    if (counter.since === undefined) counter.since = since;
    else if (counter.since !== since) {
      counter.since = since;
      counter.dwellMs = 0;
      counter.depthOpened = 0;
      counter.wordsBase = ownWordsNow;
    }
    return counter;
  }

  addDwell(objectiveIds: readonly string[], ms: number): void {
    if (!(ms > 0)) return;
    for (const id of new Set(objectiveIds)) this.#get(id).dwellMs += ms;
  }

  addDepth(objectiveIds: readonly string[]): void {
    for (const id of new Set(objectiveIds)) this.#get(id).depthOpened += 1;
  }

  clear(): void {
    this.#by.clear();
  }
}

/** One heading's offer. Several objectives may share a section; the offer is drawn once. */
export interface ReadyOffer {
  headingBlockId: string;
  /** Where Quiz me is pressed. */
  target: string;
  objectiveIds: string[];
}

export interface ReadinessInput {
  doc: Node;
  /** The taught objectives (`taughtObjectives`): an assumed one is not this lecture's to check. */
  objectives: readonly ProgressObjectiveView[];
  counters: ReadinessCounters;
  /**
   * A question of Max's is open in a chat thread. **One question at a time**: while one waits,
   * offering a check on another section would invite a second, so nothing is offered.
   */
  threadQuizOpen: boolean;
}

/** The signals `core/readiness` reads, for one objective and its section. */
export function signalsFor(
  objective: ProgressObjectiveView,
  counter: Readonly<Pick<Counter, 'dwellMs' | 'depthOpened' | 'wordsBase'>>,
  ownWordsNow: number,
  questionOpen: boolean,
): ReadinessSignals {
  return {
    done: objective.fill === 1,
    questionOpen,
    explains: objective.activity?.explains ?? 0,
    examples: objective.activity?.examples ?? 0,
    ownWords: Math.max(0, ownWordsNow - counter.wordsBase),
    depthOpened: counter.depthOpened,
    dwellMs: counter.dwellMs,
  };
}

/**
 * The headings that offer a check now. Also brings the counters up to date with each objective's
 * `since`, so call it whenever the progress view may have moved.
 */
export function readyOffers(input: ReadinessInput): ReadyOffer[] {
  const { doc, objectives, counters } = input;
  const sections = objectiveSections(doc, objectives);
  const open = openQuestionObjectives(doc, sections);
  const byHeading = new Map<string, ReadyOffer>();
  for (const section of sections) {
    const objective = objectives.find((o) => o.objectiveId === section.objectiveId);
    if (!objective) continue;
    const words = sectionOwnWords(doc, section);
    const counter = counters.sync(objective.objectiveId, objective.activity?.since ?? null, words);
    const questionOpen = input.threadQuizOpen || open.has(objective.objectiveId);
    if (!section.target || !offerCheck(signalsFor(objective, counter, words, questionOpen))) continue;
    const offer = byHeading.get(section.headingBlockId);
    if (offer) offer.objectiveIds.push(objective.objectiveId);
    else byHeading.set(section.headingBlockId, { headingBlockId: section.headingBlockId, target: section.target, objectiveIds: [objective.objectiveId] });
  }
  return [...byHeading.values()];
}

/** Two offer lists that draw the same: the chrome is rebuilt only when this changes. */
export function offersKey(offers: readonly ReadyOffer[]): string {
  return offers.map((o) => `${o.headingBlockId}>${o.target}`).join('|');
}
