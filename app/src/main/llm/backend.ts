/**
 * Which backend answers, and on which models — resolved in one place so the Room actor can
 * carry on not knowing (issue #19).
 *
 * The order, when the learner has not forced one:
 *
 *   1. **the local Claude CLI**, if it is installed *and* logged in — it costs the learner
 *      nothing per token and needs no key;
 *   2. **the Anthropic API key**, if one has been entered (#15);
 *   3. **the scripted transcript player** — always available, never a network call, and what
 *      the A1 video falls back to.
 *
 * Forcing a backend in Settings overrides the order but not reality: forcing the CLI when it
 * is not installed still lands on Scripted, and the reason comes back with the resolution so
 * the UI can say which of the three is actually running and why.
 */
import { AnthropicClient } from '../../room/llm/anthropic.js';
import { ScriptedClient } from '../../room/llm/scripted.js';
import type { LLMClient } from '../../room/llm/types.js';
import {
  API_PLAN,
  cliPlan,
  DEFAULT_CLI_AGENT_MODEL,
  DEFAULT_CLI_ORCHESTRATOR_MODEL,
  type ModelPlan,
} from '../../room/llm/models.js';
import type { AgentProfile, BackendChoice, BackendKind } from '../../shared/types.js';
import type { SettingsRepo } from '../db/repos/core.js';
import { ClaudeCliClient } from './claude-cli.js';
import { log, type Logger } from '../log.js';
import { loggedClient } from './logged.js';
import { costedClient, type CostSink } from '../cost/client.js';
import { readCachedDetection, SETTINGS_KEYS, type CliDetection } from './detect.js';

export type { BackendChoice, BackendKind };

export interface ResolvedBackend {
  kind: BackendKind;
  /** What the learner asked for in Settings. */
  choice: BackendChoice;
  models: ModelPlan;
  /** Set when the choice could not be honoured, e.g. "forced CLI, but it is not logged in". */
  fellBackBecause: string | null;
  detection: CliDetection | null;
}

export function readBackendChoice(settings: SettingsRepo): BackendChoice {
  const raw = settings.get(SETTINGS_KEYS.backend);
  return raw === 'claude_cli' || raw === 'anthropic' || raw === 'scripted' ? raw : 'auto';
}

export function readCliModels(settings: SettingsRepo): ModelPlan {
  return cliPlan(
    settings.get(SETTINGS_KEYS.cliAgentModel) ?? DEFAULT_CLI_AGENT_MODEL,
    settings.get(SETTINGS_KEYS.cliOrchestratorModel) ?? DEFAULT_CLI_ORCHESTRATOR_MODEL,
  );
}

export interface ResolveInput {
  settings: SettingsRepo;
  /** Whether a usable API key is present. The key itself never comes in here. */
  hasApiKey: boolean;
}

/**
 * Pure: reads settings and the cached detection, decides. Does not spawn anything, so it is
 * safe to call on every bootstrap and on every room open.
 */
export function resolveBackend(input: ResolveInput): ResolvedBackend {
  const choice = readBackendChoice(input.settings);
  const detection = readCachedDetection(input.settings);
  const cliUsable = detection?.found === true && detection.loggedIn === true;
  const cliModels = readCliModels(input.settings);

  const scripted = (fellBackBecause: string | null): ResolvedBackend => ({
    kind: 'scripted',
    choice,
    // Scripted ignores the model id, but recording the plan keeps the session row honest
    // about what *would* have run.
    models: cliUsable || choice === 'claude_cli' ? cliModels : API_PLAN,
    fellBackBecause,
    detection,
  });

  if (choice === 'scripted') return { ...scripted(null), fellBackBecause: null };

  if (choice === 'claude_cli' || choice === 'auto') {
    if (cliUsable) return { kind: 'claude_cli', choice, models: cliModels, fellBackBecause: null, detection };
    if (choice === 'claude_cli') {
      const why = detection?.found
        ? (detection.detail ?? 'Claude Code is installed but not logged in.')
        : 'Claude Code was not found on this Mac.';
      if (input.hasApiKey) return { kind: 'anthropic', choice, models: API_PLAN, fellBackBecause: why, detection };
      return scripted(why);
    }
  }

  if (choice === 'anthropic' || choice === 'auto') {
    if (input.hasApiKey) return { kind: 'anthropic', choice, models: API_PLAN, fellBackBecause: null, detection };
    if (choice === 'anthropic') return scripted('No Anthropic API key has been entered.');
  }

  return scripted(null);
}

export interface CreateClientInput extends ResolveInput {
  resolved: ResolvedBackend;
  /** Read lazily so the plaintext key is fetched only when the API path is actually chosen. */
  apiKey: () => string | null;
  cliTimeoutMs?: number;
  /**
   * What the session was started from, when the caller knows — `materials.file_path` and the
   * material's sha, which for a flow room is the file's own `content_sha`.
   *
   * `scripts.ts` says the client has to sniff because "the IPC layer that knows the material is
   * owned by another piece of work this week". It is not any more: `AppService.openRoom()` has
   * the material row in its hand, so it passes it and the script is **pinned** rather than
   * recognised. Sniffing still runs for every caller that does not pass one, and it is still the
   * only thing standing between a REFERENCE call over one segment and the wrong voice — a
   * single crop of a slide may carry no marker at all, which is exactly what happened on the
   * first live run of this path.
   */
  material?: { fileName?: string | null; contentSha?: string | null };
  /** The live roster, so a scripted beat names the agents the room is actually running (#32). */
  roster?: readonly AgentProfile[];
  /** Injectable so a test can assert what was logged without touching the process-wide one. */
  logger?: () => Logger;
  /**
   * The cost ledger, when there is one. Omit it and nothing is counted — which is what every
   * existing test does, so instrumenting the port costs them nothing.
   */
  cost?: CostSink | null;
}

/**
 * Every backend comes back wrapped in `loggedClient`, so `llm.request`/`first_token`/`complete`/
 * `error` are a property of *calling a model*, not of one implementation remembering to.
 */
/**
 * How fast a scripted turn unrolls, in ms between word chunks. The class defaults to 0 so the
 * fake-clock tests stay instant; the *app* wants a plausible rate, because the point of the
 * scripted backend is that the video and the live session look the same.
 */
const SCRIPTED_CHUNK_MS = 35;

/**
 * `loggedClient` **outside** `costedClient`: the usage row is written before `llm.complete` is
 * logged, so the log line and the ledger row cannot disagree about whether the call happened.
 */
export function createClient(input: CreateClientInput): LLMClient {
  return loggedClient(costedClient(rawClient(input), input.cost ?? null, input.logger ?? log), input.logger ?? log);
}

function rawClient(input: CreateClientInput): LLMClient {
  switch (input.resolved.kind) {
    case 'claude_cli': {
      const binary = input.resolved.detection?.path;
      if (binary) return new ClaudeCliClient({ binary, timeoutMs: input.cliTimeoutMs });
      return new ScriptedClient({ material: input.material, roster: input.roster, chunkMs: SCRIPTED_CHUNK_MS });
    }
    case 'anthropic': {
      const key = input.apiKey();
      return key ? new AnthropicClient({ apiKey: key }) : new ScriptedClient({ material: input.material, roster: input.roster, chunkMs: SCRIPTED_CHUNK_MS });
    }
    default:
      return new ScriptedClient({ material: input.material, roster: input.roster, chunkMs: SCRIPTED_CHUNK_MS });
  }
}

/** 'live' means a real model is answering, whichever backend it is; 'scripted' means the script. */
export function modeFor(kind: BackendKind): 'scripted' | 'live' {
  return kind === 'scripted' ? 'scripted' : 'live';
}
