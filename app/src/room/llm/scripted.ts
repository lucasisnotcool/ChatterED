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
import type { LLMClient, LlmRequest, LlmResult } from './types.js';
import { EMPTY_USAGE } from './types.js';
import { beatFor, whisperBeatFor } from './script.psd-hessian.js';

export interface ScriptedClientOptions {
  /** Simulated time to first token. The *hold* is the room actor's job, not the client's. */
  ttftMs?: number;
}

export class ScriptedClient implements LLMClient {
  readonly kind = 'scripted' as const;
  #ttftMs: number;

  constructor(opts: ScriptedClientOptions = {}) {
    this.#ttftMs = opts.ttftMs ?? 900;
  }

  async complete(request: LlmRequest, onDelta?: (text: string) => void): Promise<LlmResult> {
    const cue = request.meta.scriptCue ?? 'open';
    const text = this.#textFor(request, cue);
    onDelta?.(text);
    return {
      text,
      model: `scripted:${request.model}`,
      usage: { ...EMPTY_USAGE },
      ttftMs: this.#ttftMs,
      backend: 'scripted',
    };
  }

  #textFor(request: LlmRequest, cue: string): string {
    switch (request.meta.scope) {
      case 'orchestrator':
        return JSON.stringify(decisionFor(cue));
      case 'ledger':
        return JSON.stringify(ledgerFor(cue, lastStudentText(request)));
      case 'whisper':
        return whisperBeatFor(cue)?.text ?? 'Still read-only over here.';
      case 'group':
      default:
        return beatFor(cue)?.text ?? '';
    }
  }
}

export function decisionFor(cue: string): Record<string, unknown> {
  const beat = beatFor(cue);
  const d = beat?.decision;
  return {
    speak: d?.role !== null && d !== undefined,
    role: d?.role ?? null,
    move_type: d?.move ?? 'yield',
    probe_type: d?.probeType ?? null,
    target_element_id: d?.targetElementId ?? null,
    challenges: d?.challenges ?? (d?.targetElementId ? [d.targetElementId] : []),
    rationale: d?.rationale ?? 'No scripted beat for this cue; the room stays quiet.',
    disagreement: beat?.disagreement ?? null,
  };
}

export function ledgerFor(cue: string, studentText: string): Record<string, unknown> {
  const beat = beatFor(cue);
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
    concept_id: 'psd-hessian-convexity-v1',
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
      if (!/^[A-Z][\w ]+ \((peer|challenger|first year)\):/.test(line)) return line;
    }
  }
  return '';
}
