/**
 * ScriptedClient — a fake LLM, not a fake app.
 *
 * It answers all four scopes (orchestrator decision, agent turn, ledger update, whisper reply)
 * from design-brief.md §G, so the room actor, the latency buffer, the silence timer, the
 * ledger's four hard rules and the whisper scoping all run for real. It makes no network call,
 * which is also why every test in this repo can use it.
 *
 * One detail matters for honesty: the ledger's evidence is lifted **verbatim from whatever the
 * learner actually typed**, not from the script. The learner's side of the demo is live
 * (product-design.md §G3), so the quote in the rail is really theirs and rule 1 really passes.
 */
import type { AgentProfile } from '../../shared/types.js';
import { fillAgentNames, rosterFor } from '../agents.js';
import type { LLMClient, LlmRequest, LlmResult } from './types.js';
import { EMPTY_USAGE, LlmAbortedError } from './types.js';
import type { ScriptSource } from './script.psd-hessian.js';
import { PSD_HESSIAN_SCRIPT, pickScript, scriptNameForRequest, SCRIPTS } from './scripts.js';

export { PSD_HESSIAN_SCRIPT };

export interface ScriptedClientOptions {
  /** Simulated time to first token. The *hold* is the room actor's job, not the client's. */
  ttftMs?: number;
  /**
   * Which script to replay, when the caller already knows. Setting it pins the client: no
   * material is consulted and no request is sniffed.
   */
  script?: ScriptSource;
  /**
   * What the session was started from. `scripts.ts` picks `critique1` for the fixture deck and
   * `psd-hessian` for anything else (flow-build-plan.md §4.4).
   */
  material?: { fileName?: string | null; contentSha?: string | null };
  /** A Settings override — a script name. It wins over `material`. */
  override?: string | null;
  /**
   * Milliseconds between the word chunks a scripted turn is streamed in.
   *
   * **Zero by default, and that is deliberate.** Every test in this repo runs the actor on a fake
   * clock; a real timer inside the client would either hang those tests or make them wait real
   * seconds. So the default streams the chunks back to back — still many `onDelta` calls in
   * order, still the same text — and the app asks for a plausible rate (`llm/backend.ts`), which
   * is what makes scripted mode *look* like the live one rather than merely behave like it.
   */
  chunkMs?: number;
  /**
   * The roster the room is actually running, so a beat that names the *other* agent — the
   * Tester's question, a whisper reply — is filled from it rather than from a literal in the
   * script (`agents.fillAgentNames`). Defaults to the pinned roster (#32), which is what every
   * room gets; a caller that has the live one should still pass it.
   */
  roster?: readonly AgentProfile[];
}

export class ScriptedClient implements LLMClient {
  readonly kind = 'scripted' as const;
  #ttftMs: number;
  /** Set when the script is known up front; null while the client is still sniffing. */
  #pinned: ScriptSource | null;
  /**
   * The last script a request was recognised as. One recognised request keeps the whole sitting
   * on the right script, so a reference call over a single segment — which may carry no marker
   * at all — still gets the right voice.
   */
  #latched: ScriptSource | null = null;
  #roster: readonly AgentProfile[];
  #chunkMs: number;

  constructor(opts: ScriptedClientOptions = {}) {
    this.#ttftMs = opts.ttftMs ?? 900;
    this.#chunkMs = Math.max(0, opts.chunkMs ?? 0);
    this.#roster = opts.roster ?? rosterFor();
    this.#pinned =
      opts.script ??
      (opts.material || opts.override ? pickScript({ ...opts.material, override: opts.override }) : null);
  }

  /** Which script is answering right now. Exposed for the actor's relay draft and for tests. */
  get script(): ScriptSource {
    return this.#pinned ?? this.#latched ?? PSD_HESSIAN_SCRIPT;
  }

  /**
   * The relay draft that goes with a whisper turn, taken from **whichever script is live**. The
   * actor asks the client for it rather than importing one script directly: in scripted mode the
   * offer is part of the beat, and a client replaying the Critique 1 deck must not hand back the
   * PSD/Hessian draft (`actor.ts` `#relayOfferFor`).
   */
  relayOfferFor(turn: number): { draftText: string; defaultAttribution: 'as_me' | 'as_agent' } | null {
    return this.script.whisperBeatFor(`whisper:${turn}`)?.relayOffer ?? null;
  }

  async complete(request: LlmRequest, onDelta?: (text: string) => void, signal?: AbortSignal): Promise<LlmResult> {
    const cue = request.meta.scriptCue ?? 'open';
    // Names last, over whatever the beat produced: a decision or a ledger blob has no name in it
    // and is untouched, and a turn's prose gets the roster's spelling of it.
    const text = fillAgentNames(this.#textFor(request, cue), this.#roster);
    /**
     * Prose is streamed in word chunks; a JSON object is not. An orchestrator or ledger reply is
     * parsed, never rendered, and chunking it would only invite a half-object to be parsed by
     * some future caller that forgot the difference.
     */
    if (onDelta) {
      if (request.meta.scope === 'orchestrator' || request.meta.scope === 'ledger') onDelta(text);
      else await this.#streamWords(text, onDelta, signal);
    }
    return {
      text,
      model: `scripted:${request.model}`,
      usage: { ...EMPTY_USAGE },
      ttftMs: this.#ttftMs,
      backend: 'scripted',
    };
  }

  /** ~4 words at a time, which is about what a real stream delivers per event. */
  async #streamWords(text: string, onDelta: (text: string) => void, signal?: AbortSignal): Promise<void> {
    const parts = text.split(/(\s+)/);
    for (let i = 0; i < parts.length; i += 8) {
      // Stop works in scripted mode too, or the control could not be demonstrated on the video.
      if (signal?.aborted) throw new LlmAbortedError();
      const chunk = parts.slice(i, i + 8).join('');
      if (chunk.length === 0) continue;
      onDelta(chunk);
      if (this.#chunkMs > 0) await new Promise((resolve) => setTimeout(resolve, this.#chunkMs));
    }
  }

  /**
   * Resolve the script for one request, and remember the answer. A request the sniffer does not
   * recognise never *un*-latches: the deck does not change inside a sitting, and a single
   * segment's reference call can legitimately carry no marker.
   */
  #scriptFor(request: LlmRequest): ScriptSource {
    if (this.#pinned) return this.#pinned;
    const name = scriptNameForRequest(request);
    if (name) this.#latched = SCRIPTS[name];
    return this.#latched ?? PSD_HESSIAN_SCRIPT;
  }

  #textFor(request: LlmRequest, cue: string): string {
    const script = this.#scriptFor(request);
    switch (request.meta.scope) {
      case 'orchestrator':
        return JSON.stringify(decisionFor(cue, script));
      case 'ledger':
        return JSON.stringify(ledgerFor(cue, lastStudentText(request), script));
      case 'whisper':
        return script.whisperBeatFor(cue)?.text ?? 'Still read-only over here.';
      // Not an agent turn, and deliberately not a persona: the register of the deck, never a
      // voice (pivot-spec.md §B1). The 120-word cap is applied by `reference.ts`, in code.
      case 'reference':
        return script.referenceBeatFor(cue)?.text ?? '';
      case 'group':
      default:
        return script.beatFor(cue)?.text ?? '';
    }
  }
}

export function decisionFor(cue: string, script: ScriptSource = PSD_HESSIAN_SCRIPT): Record<string, unknown> {
  const beat = script.beatFor(cue);
  const d = beat?.decision;
  return {
    speak: d?.role !== null && d !== undefined,
    role: d?.role ?? null,
    move_type: d?.move ?? 'yield',
    probe_type: d?.probeType ?? null,
    target_element_id: d?.targetElementId ?? null,
    challenges: d?.challenges ?? (d?.targetElementId ? [d.targetElementId] : []),
    rationale: d?.rationale ?? 'No scripted beat for this cue; the room stays quiet.',
  };
}

export function ledgerFor(
  cue: string,
  studentText: string,
  script: ScriptSource = PSD_HESSIAN_SCRIPT,
): Record<string, unknown> {
  const beat = script.beatFor(cue);
  const quote = verbatimQuote(studentText);
  const elements = (beat?.ledger?.elements ?? []).map((e) => ({
    id: e.id,
    level: e.level,
    evidence: e.evidence === 'last_student' ? quote : null,
    confidence: e.confidence,
    misconceptions_present: e.misconceptions_present ?? [],
    misconceptions_resolved: e.misconceptions_resolved ?? [],
  }));
  return {
    schema: 'ledger.v1',
    // The script says which pack its element ids belong to (#32: there are two decks now).
    concept_id: script.conceptId ?? 'psd-hessian-convexity-v1',
    message_id: '',
    elements,
    suggested_target_element: beat?.ledger?.suggestedTargetElement ?? null,
    suggested_probe_type: beat?.ledger?.suggestedProbeType ?? null,
    notes_for_agents: beat?.ledger?.notesForAgents ?? '',
  };
}

/**
 * The longest sentence the learner actually wrote, which is a verbatim substring of their
 * message and therefore passes the ledger's evidence check honestly.
 */
export function verbatimQuote(text: string, maxChars = 160): string {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const longest = sentences.sort((a, b) => b.length - a.length)[0] ?? text.trim();
  return longest.length > maxChars ? longest.slice(0, maxChars).trimEnd() : longest;
}

function lastStudentText(request: LlmRequest): string {
  for (let i = request.messages.length - 1; i >= 0; i -= 1) {
    const m = request.messages[i]!;
    if (m.role !== 'user') continue;
    // Strip the turn directive and any speaker labels the context builder added.
    const withoutDirective = m.content.replace(/\n*\[[^\]]*\]\s*$/, '');
    const lines = withoutDirective.split('\n\n').filter((l) => l.trim().length > 0);
    for (let j = lines.length - 1; j >= 0; j -= 1) {
      const line = lines[j]!;
      if (line.startsWith('Student: ')) return line.slice('Student: '.length);
      // The transcript labels agents by their *display* role (agents.ts ROLE_LABEL), which is
      // teacher/tester since #32. The old spellings stay so a historical room still parses.
      if (!/^[A-Z][\w ]+ \((teacher|tester|peer|challenger|first year)\):/.test(line)) return line;
    }
  }
  return '';
}
