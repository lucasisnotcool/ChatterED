/**
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * READ A SECTION ALOUD (2026-10-01)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The header's **Listen** reads the section the cursor is in with the system's own voices, through
 * the Web Speech API (`window.speechSynthesis`). No model call, no network, no dependency, and it
 * never edits the document: what is being read is shown by a decoration (`pm/readaloud.ts`).
 *
 * Two halves, both free of the DOM so both are tested in node:
 *
 *  1. **What to say** — `sectionRange`, `readQueue`, `splitForSpeech`. Pure functions of the
 *     document. One queue item per block, so the highlight is exact without leaning on
 *     word-boundary events, which not every voice fires.
 *  2. **Saying it** — `ReadAloud`, a small state machine around a synthesis object that is
 *     **passed in**, so a test hands it a fake. The Chromium quirks it works around are listed on
 *     the class.
 */

import type { Node } from 'prosemirror-model';
import { blockAttrs, diagramSpec, flashcardsSpec, infographicSpec, optionLabel, quizSpec, tableGrid } from '../../shared/doc/schema.js';

// ── what to say ─────────────────────────────────────────────────────────────────────────────

/** One thing to speak, and the block to highlight while it is spoken. */
export interface ReadItem {
  blockId: string;
  text: string;
}

/** What a display formula is read as. TeX aloud is noise; the learner can see the formula. */
export const FORMULA_WORD = 'formula';

/** Blocks that are pictures of the deck: nothing in them is the notes' own words. */
const SILENT = new Set(['slide_figure']);

/** Containers whose children are read one by one, each under its own block id. */
const READ_CHILDREN = new Set(['bullet_list', 'ordered_list', 'q_block']);

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** The text with a full stop after it unless it already ends a sentence: the pause a voice needs. */
const stop = (text: string): string => (/[.!?:]$/.test(text) ? text : `${text}.`);

/**
 * A text block as it should be heard: its characters, and nothing of its marks.
 *
 * Inline maths and inline code are marks over plain text (`schema.ts`), so they read as that
 * text. A pending suggestion's *insertion* is skipped: it is not in the notes until the learner
 * accepts it, and the text it would replace (`suggest_del`) is still what the notes say.
 */
function spokenText(block: Node): string {
  let out = '';
  block.forEach((child) => {
    if (!child.isText) {
      out += ' ';
      return;
    }
    if (child.marks.some((mark) => mark.type.name === 'suggest_ins')) return;
    out += child.text ?? '';
  });
  return squash(out);
}

/**
 * A table, row by row: the caption, the heading row, then each row. The comma between cells is
 * there for the pause it makes, and an empty cell is left out rather than read as a gap.
 */
function tableRows(table: Node): string[] {
  const { caption, columns, rows } = tableGrid(table);
  const lines = [...(columns.length > 0 ? [columns] : []), ...rows]
    .map((cells) => cells.map(squash).filter((cell) => cell.length > 0).join(', '))
    .filter((line) => line.length > 0)
    .map((line) => `${line}.`);
  return caption && squash(caption) ? [`${squash(caption)}.`, ...lines] : lines;
}

/**
 * A diagram as its title and its labels, in the order they were written. The edges are left to
 * the eye: "A arrow B" for every edge is a long way to say what the picture shows at a glance.
 */
function diagramWords(diagram: Node): string {
  const { title, nodes } = diagramSpec(diagram);
  const labels = nodes.map((node) => squash(node.label)).filter((label) => label.length > 0);
  const head = title && squash(title) ? `Diagram: ${squash(title)}.` : 'Diagram.';
  return labels.length > 0 ? `${head} ${labels.join(', ')}.` : title ? head : '';
}

/**
 * A deck: the fronts, then the backs. Said in that order so a listener can answer each front in
 * their head before the backs come round, which is what a deck is for.
 */
function flashcardLines(deck: Node): string[] {
  const { title, cards } = flashcardsSpec(deck);
  const fronts = cards.map((c) => squash(c.front)).filter((t) => t.length > 0);
  const backs = cards.map((c) => squash(c.back)).filter((t) => t.length > 0);
  const head = title && squash(title) ? `Flashcards: ${squash(title)}.` : 'Flashcards.';
  return [
    ...(fronts.length > 0 ? [`${head} Fronts. ${fronts.map(stop).join(' ')}`] : []),
    ...(backs.length > 0 ? [`Backs. ${backs.map(stop).join(' ')}`] : []),
  ];
}

/**
 * A quiz: each question and then its options, lettered. **Never the answers or explanations**: they
 * are held back on the page until the learner answers, and reading them out would give them away.
 */
function quizLines(quiz: Node): string[] {
  const { title, questions } = quizSpec(quiz);
  const lines: string[] = [];
  if (title && squash(title)) lines.push(`Quiz: ${squash(title)}.`);
  questions.forEach((q, i) => {
    const options = q.options.map((o, k) => [k, squash(o)] as const).filter(([, o]) => o.length > 0).map(([k, o]) => stop(`${optionLabel(k)}, ${o}`));
    const prompt = squash(q.prompt);
    if (prompt.length === 0) return;
    lines.push(`Question ${String(i + 1)}. ${stop(prompt)}${options.length > 0 ? ` Options. ${options.join(' ')}` : ''}`);
  });
  return lines;
}

/** An infographic: its title, then each panel as value, heading and body. */
function infographicLines(info: Node): string[] {
  const { title, panels } = infographicSpec(info);
  const lines: string[] = [];
  lines.push(title && squash(title) ? `Infographic: ${squash(title)}.` : 'Infographic.');
  for (const panel of panels) {
    const line = [panel.value, panel.heading, panel.body].map(squash).filter((t) => t.length > 0).map(stop).join(' ');
    if (line.length > 0) lines.push(line);
  }
  return lines;
}

/**
 * One block into the queue. `fallbackId` is the nearest id above it: a `list_item` whose id has
 * not been minted yet highlights its list, which is better than highlighting nothing.
 */
function readBlock(node: Node, fallbackId: string, out: ReadItem[]): void {
  const name = node.type.name;
  if (SILENT.has(name)) return;
  const blockId = blockAttrs(node).blockId || fallbackId;
  const say = (text: string): void => {
    if (text.length > 0) out.push({ blockId, text });
  };

  if (name === 'math_block') return say(FORMULA_WORD);
  if (node.isTextblock) return say(spokenText(node));
  if (name === 'table') return tableRows(node).forEach(say);
  if (name === 'diagram') return say(diagramWords(node));
  if (name === 'flashcards') return flashcardLines(node).forEach(say);
  if (name === 'quiz') return quizLines(node).forEach(say);
  if (name === 'infographic') return infographicLines(node).forEach(say);
  // Any other atom is a picture of something: there are no words in it to read.
  if (node.isLeaf) return;
  if (name === 'list_item') {
    // The item is what is highlighted, not the paragraph inside it (which has an id of its own):
    // the bullet belongs to the item. A list nested in the item is read under its own items.
    node.forEach((child) => {
      if (child.isTextblock && child.type.name !== 'code_block') say(spokenText(child));
      else readBlock(child, blockId, out);
    });
    return;
  }
  if (READ_CHILDREN.has(name)) {
    // A Q block is read whole: the question, then whatever is written under it (the learner's
    // answer and Max's resolution are both on the page, so both are read).
    node.forEach((child) => readBlock(child, blockId, out));
    return;
  }
  // A container this file has not met: its text, under its own id.
  say(squash(node.textBetween(0, node.content.size, ', ', ' ')));
}

/**
 * The section around `pos`, as a half-open range of the document's **top-level child indices**.
 *
 * From the nearest heading at or above the position to the next heading of the same or a higher
 * level (a lower number). Above the first heading there is no section to belong to, so it is the
 * opening of the document, up to that first heading. `null` is "no cursor": the top.
 */
export function sectionRange(doc: Node, pos: number | null): { from: number; to: number } {
  const count = doc.childCount;
  if (count === 0) return { from: 0, to: 0 };
  const at = pos === null ? 0 : Math.min(Math.max(0, pos), doc.content.size);
  const index = Math.min(doc.resolve(at).index(0), count - 1);
  const levelAt = (i: number): number | null => {
    const child = doc.child(i);
    return child.type.name === 'heading' ? (child.attrs.level as number) : null;
  };

  let from = 0;
  let level = Number.POSITIVE_INFINITY;
  for (let i = index; i >= 0; i--) {
    const found = levelAt(i);
    if (found === null) continue;
    from = i;
    level = found;
    break;
  }
  // Nothing between `from` and the cursor is a heading (the scan above stopped at the nearest),
  // so the end is looked for after the cursor.
  let to = count;
  for (let i = index + 1; i < count; i++) {
    const found = levelAt(i);
    if (found !== null && found <= level) {
      to = i;
      break;
    }
  }
  return { from, to };
}

/** What to speak for the section around `pos`, in document order. Empty blocks are skipped. */
export function readQueue(doc: Node, pos: number | null): ReadItem[] {
  const { from, to } = sectionRange(doc, pos);
  const out: ReadItem[] = [];
  for (let i = from; i < to; i++) readBlock(doc.child(i), '', out);
  return out;
}

/**
 * The longest single utterance. Chromium stalls on, or cuts off, an utterance of more than a few
 * hundred characters; a sentence-sized one also makes Pause and a rate change take effect soon.
 */
export const MAX_UTTERANCE_CHARS = 200;

/** Pack `parts` greedily into chunks of at most `max`, splitting an oversized part with `finer`. */
function pack(parts: string[], max: number, finer: (part: string) => string[]): string[] {
  const chunks: string[] = [];
  let open = '';
  const close = (): void => {
    if (open) chunks.push(open);
    open = '';
  };
  for (const part of parts) {
    if (part.length > max) {
      close();
      chunks.push(...finer(part));
    } else if (open && open.length + 1 + part.length > max) {
      close();
      open = part;
    } else {
      open = open ? `${open} ${part}` : part;
    }
  }
  close();
  return chunks;
}

/**
 * A block's text as utterances of at most `max` characters: whole when it fits, otherwise cut at
 * sentence ends, then at commas, then at spaces, and only a single unbroken run is cut mid-word.
 * The split wants whitespace after the punctuation, so `3.5` and `e.g.` inside a word survive.
 */
export function splitForSpeech(text: string, max = MAX_UTTERANCE_CHARS): string[] {
  const clean = squash(text);
  if (clean.length === 0) return [];
  if (clean.length <= max) return [clean];
  const hard = (part: string): string[] => {
    const out: string[] = [];
    for (let i = 0; i < part.length; i += max) out.push(part.slice(i, i + max));
    return out;
  };
  const words = (part: string): string[] => pack(part.split(' '), max, hard);
  const clauses = (part: string): string[] => pack(part.split(/(?<=,)\s+/), max, words);
  return pack(clean.split(/(?<=[.!?;:。！？]["')\]]?)\s+/), max, clauses);
}

// ── saying it ───────────────────────────────────────────────────────────────────────────────

/** As much of `SpeechSynthesisVoice` as the choice of a voice reads. */
export interface SpeechVoice {
  readonly name: string;
  readonly lang: string;
  readonly localService: boolean;
  readonly default: boolean;
}

/** As much of `SpeechSynthesisUtterance` as the controller touches. */
export interface SpeechUtterance {
  voice: SpeechVoice | null;
  lang: string;
  rate: number;
  addEventListener(type: string, listener: (event: unknown) => void): void;
}

/** As much of `SpeechSynthesis` as the controller touches. A test passes a fake. */
export interface SpeechSynth {
  speak(utterance: SpeechUtterance): void;
  cancel(): void;
  pause(): void;
  resume(): void;
  getVoices(): SpeechVoice[];
  addEventListener?(type: string, listener: () => void): void;
  removeEventListener?(type: string, listener: () => void): void;
}

export type ReadAloudState = 'idle' | 'speaking' | 'paused';

export const RATES = [0.8, 1, 1.25, 1.5] as const;
export const DEFAULT_RATE = 1;
export const RATE_KEY = 'chattered.readaloud.rate';

/** How long a Resume may stay silent before the sentence is started again (see `resume`). */
export const RESUME_WATCHDOG_MS = 1_200;

/**
 * macOS lists its novelty voices (Bells, Zarvox, Whisper…) beside the real ones, in alphabetical
 * order and with the same flags, so without this "Albert" wins a tie for English.
 */
const NOVELTY =
  /^(albert|bad news|bahh|bells|boing|bubbles|cellos|fred|good news|jester|junior|kathy|organ|ralph|superstar|trinoids|whisper|wobble|zarvox)\b/i;

const primary = (lang: string): string => lang.toLowerCase().replace('_', '-').split('-')[0] ?? '';

/**
 * The best voice for `lang`, or null when none speaks it (the utterance then carries the language
 * alone and the system chooses).
 *
 * Only voices of the same primary language are candidates. Among them: a voice the list calls
 * Premium, then Enhanced (macOS puts the quality in the name), then an on-device voice over a
 * network one (nothing here may need the network), then the exact region, then the system's own
 * default. The first of equals wins, so the order of the system's list breaks the last tie.
 */
export function pickVoice(voices: readonly SpeechVoice[], lang: string): SpeechVoice | null {
  const wanted = lang.toLowerCase().replace('_', '-');
  let best: SpeechVoice | null = null;
  let bestScore = -1;
  for (const voice of voices) {
    if (primary(voice.lang) !== primary(wanted)) continue;
    let score = 0;
    if (/premium/i.test(voice.name)) score += 40;
    else if (/enhanced/i.test(voice.name)) score += 30;
    if (voice.localService) score += 16;
    if (!NOVELTY.test(voice.name)) score += 8;
    if (voice.lang.toLowerCase().replace('_', '-') === wanted) score += 4;
    if (voice.default) score += 2;
    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  }
  return best;
}

export interface ReadAloudOptions {
  /** Builds one utterance. The component passes `(text) => new SpeechSynthesisUtterance(text)`. */
  utterance: (text: string) => SpeechUtterance;
  /** The notes' language, as a BCP 47 tag. */
  lang?: string;
  /** Where the rate is kept. Null in a test, or where `localStorage` is denied. */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** Anything the control draws has changed: state, rate, availability. */
  onChange?: () => void;
  /** The block being read has changed; null when nothing is. Drives the highlight. */
  onBlock?: (blockId: string | null) => void;
}

function readRate(storage: ReadAloudOptions['storage']): number {
  try {
    const raw = Number(storage?.getItem(RATE_KEY));
    return (RATES as readonly number[]).includes(raw) ? raw : DEFAULT_RATE;
  } catch {
    return DEFAULT_RATE;
  }
}

/**
 * The controller: `start(queue)`, `pause`, `resume`, `stop`, and what the control draws.
 *
 * **One utterance is in the synthesiser at a time**, and the next is spoken from the last one's
 * `end`. Queueing them all at once would be less code, but then `cancel()` is the only way to
 * change anything and the block being read would have to be inferred from events.
 *
 * The Chromium quirks, and what is done about each:
 *
 *  - *A long utterance stalls or is cut off.* Every block is split by `splitForSpeech`; the
 *    pieces keep the block's id, so the highlight does not move between them.
 *  - *`cancel()` still fires `end` or `error` on the utterance it cancelled*, sometimes late.
 *    Every utterance is spoken under a token, and an event under an old token is ignored.
 *  - *The engine can stay paused after `pause()` then `cancel()`*, and then every later `speak()`
 *    is silent. `stop()` always cancels and resets, and every cancel here is followed by a
 *    `resume()`, which is a no-op when nothing is paused.
 *  - *`resume()` sometimes does nothing.* A watchdog: if no event arrives from the utterance
 *    within `RESUME_WATCHDOG_MS` of a Resume, the sentence is started again.
 *  - *An utterance nobody holds can be collected before its `end` fires*, and the reading stops
 *    dead. The current one is kept in a field.
 *  - *The voice list is empty until `voiceschanged`.* It is re-read then, and again on `start`.
 */
export class ReadAloud {
  state: ReadAloudState = 'idle';
  /** The block being read, or null. */
  blockId: string | null = null;
  rate: number;

  #synth: SpeechSynth | null;
  #options: ReadAloudOptions;
  #voices: SpeechVoice[] = [];
  #chunks: ReadItem[] = [];
  #index = 0;
  /** Bumped whenever what is in the synthesiser stops being ours to listen to. */
  #token = 0;
  #current: SpeechUtterance | null = null;
  /** True once the current utterance has been heard from since the last Resume. */
  #alive = false;
  /** The rate changed while paused: Resume starts the sentence again at the new rate. */
  #restartOnResume = false;
  #watchdog: ReturnType<typeof setTimeout> | null = null;
  #onVoices = (): void => {
    this.#loadVoices();
    this.#options.onChange?.();
  };

  constructor(synth: SpeechSynth | null | undefined, options: ReadAloudOptions) {
    this.#synth = synth ?? null;
    this.#options = options;
    this.rate = readRate(options.storage);
    this.#loadVoices();
    try {
      this.#synth?.addEventListener?.('voiceschanged', this.#onVoices);
    } catch {
      // No event: `start` reads the list again.
    }
  }

  /** False when there is no speech here, or no voice to speak with. The control is then hidden. */
  get available(): boolean {
    return this.#synth !== null && this.#voices.length > 0;
  }

  #loadVoices(): void {
    try {
      this.#voices = [...(this.#synth?.getVoices() ?? [])];
    } catch {
      this.#voices = [];
    }
  }

  /** Read this queue from its start, replacing whatever was being read. False when it cannot. */
  start(queue: readonly ReadItem[]): boolean {
    this.#loadVoices();
    if (!this.#synth || this.#voices.length === 0) return false;
    const chunks = queue.flatMap((item) =>
      splitForSpeech(item.text).map((text) => ({ blockId: item.blockId, text })),
    );
    this.#silence();
    if (chunks.length === 0) {
      this.#idle();
      return false;
    }
    this.#chunks = chunks;
    this.#index = 0;
    this.state = 'speaking';
    this.#speak();
    this.#options.onChange?.();
    return true;
  }

  pause(): void {
    if (this.state !== 'speaking' || !this.#synth) return;
    this.#clearWatchdog();
    this.#synth.pause();
    this.state = 'paused';
    this.#options.onChange?.();
  }

  resume(): void {
    if (this.state !== 'paused' || !this.#synth) return;
    this.state = 'speaking';
    if (this.#restartOnResume) {
      this.#respeak();
    } else {
      this.#alive = false;
      const token = this.#token;
      this.#synth.resume();
      this.#clearWatchdog();
      this.#watchdog = setTimeout(() => {
        this.#watchdog = null;
        if (token === this.#token && this.state === 'speaking' && !this.#alive) this.#respeak();
      }, RESUME_WATCHDOG_MS);
    }
    this.#options.onChange?.();
  }

  /** Always cancels and always resets, whatever state the synthesiser thinks it is in. */
  stop(): void {
    this.#silence();
    this.#idle();
  }

  setRate(rate: number): void {
    if (!(RATES as readonly number[]).includes(rate) || rate === this.rate) return;
    this.rate = rate;
    try {
      this.#options.storage?.setItem(RATE_KEY, String(rate));
    } catch {
      // A denied store costs the preference, not the reading.
    }
    // An utterance's rate is fixed once it is spoken, so the sentence is started again.
    if (this.state === 'speaking') this.#respeak();
    else if (this.state === 'paused') this.#restartOnResume = true;
    this.#options.onChange?.();
  }

  /** 0.8 → 1 → 1.25 → 1.5 → 0.8: the header's one small button. */
  cycleRate(): void {
    const at = (RATES as readonly number[]).indexOf(this.rate);
    this.setRate(RATES[(at + 1) % RATES.length]!);
  }

  /** Stop, and stop listening for voices. The component calls this when it is destroyed. */
  dispose(): void {
    this.stop();
    try {
      this.#synth?.removeEventListener?.('voiceschanged', this.#onVoices);
    } catch {
      // Nothing to remove.
    }
  }

  /** Empty the synthesiser and disown whatever it was saying. */
  #silence(): void {
    this.#token++;
    this.#clearWatchdog();
    this.#current = null;
    this.#restartOnResume = false;
    try {
      this.#synth?.cancel();
      this.#synth?.resume();
    } catch {
      // A synthesiser that throws on cancel has nothing left to cancel.
    }
  }

  #idle(): void {
    this.#chunks = [];
    this.#index = 0;
    const changed = this.state !== 'idle' || this.blockId !== null;
    this.state = 'idle';
    if (this.blockId !== null) {
      this.blockId = null;
      this.#options.onBlock?.(null);
    }
    if (changed) this.#options.onChange?.();
  }

  #clearWatchdog(): void {
    if (this.#watchdog) clearTimeout(this.#watchdog);
    this.#watchdog = null;
  }

  /** Say the current sentence again from its start. */
  #respeak(): void {
    this.#silence();
    this.#speak();
  }

  #speak(): void {
    const synth = this.#synth;
    const chunk = this.#chunks[this.#index];
    if (!synth || !chunk) {
      // Past the last one: the section has ended, and nothing is left in the synthesiser.
      this.#current = null;
      this.#idle();
      return;
    }
    const token = ++this.#token;
    const voice = pickVoice(this.#voices, this.#options.lang ?? 'en');
    const utterance = this.#options.utterance(chunk.text);
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang ?? this.#options.lang ?? 'en';
    utterance.rate = this.rate;
    const heard = (): void => {
      if (token === this.#token) this.#alive = true;
    };
    utterance.addEventListener('start', heard);
    utterance.addEventListener('boundary', heard);
    utterance.addEventListener('resume', heard);
    utterance.addEventListener('end', () => {
      if (token !== this.#token) return;
      this.#clearWatchdog();
      this.#index++;
      this.#speak();
    });
    utterance.addEventListener('error', () => {
      // A cancel of ours arrives under an old token; anything else is the voice failing, and a
      // reading that has failed stops rather than sitting on "Pause" in silence.
      if (token === this.#token) this.stop();
    });
    this.#current = utterance;
    if (this.blockId !== chunk.blockId) {
      this.blockId = chunk.blockId;
      this.#options.onBlock?.(chunk.blockId);
    }
    try {
      synth.speak(utterance);
    } catch {
      this.stop();
    }
  }

  /** For tests: the utterance the synthesiser is holding. */
  get current(): SpeechUtterance | null {
    return this.#current;
  }
}
