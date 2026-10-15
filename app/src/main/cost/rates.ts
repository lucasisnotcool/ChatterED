/**
 * **The rate card, and the one honest sentence about it.**
 *
 * Every dollar figure in this app is arithmetic against this table. Nobody was charged these
 * amounts; they are what the same tokens *would* have cost on api.anthropic.com. On the default
 * backend — the learner's own logged-in Claude Code subscription (issue #19) — nobody is charged
 * per token at all, which is why `src/shared/cost.ts` makes "API-equivalent" part of the wire
 * shape rather than a renderer's choice of wording.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * PRICES, AND WHERE THEY CAME FROM
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Input and output are the `claude-api` skill's model table, **cached 2026-06-24** — the same
 * source and the same date `docs/research/segmentation-cost.md` §0 prices its columns from, so
 * the two documents cannot drift apart. Not fetched live: this is a desktop app that must price
 * a call with the network off.
 *
 * Cache write and cache read are the skill's documented multipliers rather than a second table:
 * **write = 1.25× input** at the 5-minute TTL, **2× input** at the 1-hour TTL, **read = 0.1×
 * input**. Derived rather than transcribed so a price change touches one number per model.
 *
 * **Which write rate depends on the backend** (#49). This app's own API path sets
 * `cache_control: {type:'ephemeral'}` with no `ttl`, so it writes at 5 minutes. The CLI path does
 * not use this app's breakpoints at all: Claude Code caches around its own prompt, and for a
 * logged-in subscriber it asks for the **1-hour** TTL (`reason: "subscriber"` in the CLI's own
 * TTL choice). This card priced both at 1.25× until 27 Sep, and over 386 Sonnet 5 CLI calls in
 * `main.log` came out **28% below** the CLI's own `total_cost_usd`, with not one call within 2%;
 * at 2× the total is 6% below and 24 calls agree to 2%. So `estimateUsd` prices a `claude-cli`
 * row's cache writes at `cacheWrite1hPerMTok`.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THREE THINGS THAT MAKE THESE NUMBERS APPROXIMATE, RECORDED RATHER THAN SMOOTHED OVER
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * 1. **The CLI disagrees with this table.** `segmentation-cost.md` §UNVERIFIED 6: the CLI's own
 *    `total_cost_usd` came out at $0.0057 against this card's $0.0033 for the same image call —
 *    ~1.7×. Unreconciled. The likeliest reasons are that the CLI bills the ~6,680-token Claude
 *    Code system prompt that §1.4 measured, and that its `result.usage` may aggregate the
 *    auxiliary Haiku calls it makes alongside the request. Neither is checkable from here, so
 *    the ledger stores **both** numbers per row and never adds them.
 * 2. **The CLI path caches, and almost everything it spends is cache.** `claude-cli.ts` drops
 *    *this app's* cache breakpoints (§1.4's secondary finding), which is true and was read here
 *    as "no caching on that path" — the real database says otherwise. Over the 43 calls the
 *    backfill recovered from the installed build: **86 plain input tokens, 166,555 cache
 *    creation, 288,291 cache read.** Claude Code does its own caching around the prompt it
 *    builds, so the 1.25× and 0.1× multipliers are not a rounding detail on this path, they are
 *    substantially the whole bill — pricing cache tokens at the input rate would have
 *    over-stated it by roughly 3×. Recorded here because §1.4 reads the other way.
 * 3. **An unknown Claude model is priced at Sonnet 5 and says so.** A learner may type any id into the
 *    Settings free-text field. Refusing to price it would put a blank where a number belongs;
 *    pricing it silently at zero would understate the burn. `rateFor()` returns `exact: false`
 *    for those, and the summary carries the count so a renderer can footnote it.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * OPENAI AND GEMINI (BYOK, priced 2026-09-25)
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Transcribed from developers.openai.com/api/docs/pricing and ai.google.dev/gemini-api/docs/pricing
 * on 2026-09-25, standard tier. Each provider publishes its own cached-input price, so those rows
 * give the cache-read rate explicitly rather than by multiplier; neither bills a separate cache
 * *write* for the automatic caching these clients rely on, so cache write is priced at input.
 * Two caveats, recorded rather than smoothed over:
 *  - Gemini 3.6–3.8 Flash are at a promotional price **through 2026-12-31** ($0.75 / $3.75),
 *    doubling on 2027-01-01. The card carries the current price; the override box is the fix on
 *    the day it changes.
 *  - Gemini 3.1 Pro (preview) and 2.5 Pro are tiered by prompt size; the ≤200k-token tier is the
 *    one on the card, because no call this app makes comes near 200k.
 *
 * **An unknown non-Claude model is not priced at all.** A learner can type any id for OpenAI or
 * Gemini, and an OpenAI-compatible endpoint can be anything from a free local Ollama to a paid
 * router. Pricing those at Sonnet 5 would invent a bill; so `rateFor(model, card, backend)` on a
 * non-Anthropic backend returns a zero rate with `exact: false` — "cost unknown", which the ledger
 * stores as `rate_exact = 0` and the export says so.
 */
import type { CostTokens } from '../../shared/cost.js';

/** The date the `claude-api` skill's model table was cached. Shown wherever a dollar figure is. */
export const RATE_CARD_DATE = '2026-10-15';

/** Dollars per million tokens. `cacheWrite`/`cacheRead` are derived unless a model overrides. */
export interface ModelRate {
  /** The canonical id this rate is for. */
  model: string;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWritePerMTok: number;
  cacheReadPerMTok: number;
  /**
   * The 1-hour-TTL write, which is what the CLI path pays (see the header). Absent on the
   * provider-published rows, which bill no separate write; `cacheWritePerMTok` is used then.
   */
  cacheWrite1hPerMTok?: number;
}

/** 5-minute TTL: this app's own API path. */
const CACHE_WRITE_MULTIPLIER = 1.25;
/** 1-hour TTL: what Claude Code asks for on a subscriber's login, i.e. the CLI path. */
const CACHE_WRITE_1H_MULTIPLIER = 2;
const CACHE_READ_MULTIPLIER = 0.1;

function rate(model: string, input: number, output: number, readMultiplier = CACHE_READ_MULTIPLIER): ModelRate {
  return {
    model,
    inputPerMTok: input,
    outputPerMTok: output,
    cacheWritePerMTok: round6(input * CACHE_WRITE_MULTIPLIER),
    cacheReadPerMTok: round6(input * readMultiplier),
    cacheWrite1hPerMTok: round6(input * CACHE_WRITE_1H_MULTIPLIER),
  };
}

/**
 * The three models this app runs on, plus the two it could be pointed at by a typed id.
 *
 * Fable is **not** here and must never be: CLAUDE.md's hard invariant keeps it out of the
 * dropdown and `isBlockedModelId()` rejects it from the free-text field, so a row priced at
 * Fable rates would mean the invariant had already been broken somewhere upstream. A
 * `claude-fable-*` id therefore falls to the default and is flagged inexact, which is the
 * loudest thing a price table can do about it.
 */
export const RATE_CARD: readonly ModelRate[] = [
  rate('claude-haiku-4-5', 1.0, 5.0),
  rate('claude-sonnet-5', 2.0, 10.0),
  rate('claude-opus-5', 5.0, 25.0),
  // The Claude 5.5 generation (2026-10-15; the study build runs Sonnet 5.5 on the API path).
  // After the 5.0 rows so a bare CLI alias (`sonnet`) still prices as it did; an exact id finds
  // its own row either way, because matching is longest-prefix.
  rate('claude-haiku-5-5', 0.1, 0.5),
  rate('claude-sonnet-5-5', 2.0, 10.0),
  rate('claude-opus-5-5', 4.0, 20.0, 0.05), // cache reads $0.20, half the usual 10%
  // Previous generation. Reachable only by typing the id into Settings; priced so that a room
  // played on one is not silently free.
  rate('claude-sonnet-4-6', 3.0, 15.0),
  rate('claude-opus-4-8', 5.0, 25.0),

  // OpenAI, standard tier, 2026-09-25. (input, cached input, output)
  listed('gpt-6-astra', 10.0, 1.0, 50.0),
  listed('gpt-6-sol', 2.0, 0.2, 10.0),
  listed('gpt-6-luna', 0.1, 0.01, 0.5),
  listed('gpt-5.5', 5.0, 0.5, 30.0),
  listed('gpt-5.4', 2.5, 0.25, 15.0),
  listed('gpt-5.4-mini', 0.75, 0.075, 4.5),
  listed('gpt-5.4-nano', 0.2, 0.02, 1.25),
  listed('gpt-5', 1.25, 0.125, 10.0),
  listed('gpt-5-mini', 0.25, 0.025, 2.0),
  listed('gpt-5-nano', 0.05, 0.005, 0.4),
  listed('gpt-4.1', 2.0, 0.5, 8.0),
  listed('gpt-4.1-mini', 0.4, 0.1, 1.6),
  listed('gpt-4o', 2.5, 1.25, 10.0),
  listed('gpt-4o-mini', 0.15, 0.075, 0.6),

  // Gemini, paid tier, 2026-09-25. Text/image input price; see the header for the two caveats.
  listed('gemini-3.8-flash', 0.75, 0.075, 3.75),
  listed('gemini-3.7-flash', 0.75, 0.075, 3.75),
  listed('gemini-3.6-flash', 0.75, 0.075, 3.75),
  listed('gemini-3.5-flash-lite', 0.3, 0.03, 2.5),
  listed('gemini-3.1-flash-lite', 0.25, 0.025, 1.5),
  listed('gemini-3.1-pro-preview', 2.0, 0.2, 12.0),
  listed('gemini-2.5-pro', 1.25, 0.125, 10.0),
  listed('gemini-2.5-flash', 0.3, 0.03, 2.5),
];

/** A provider-published row: its own cached-input price, and no separate cache-write charge. */
function listed(model: string, input: number, cachedInput: number, output: number): ModelRate {
  return { model, inputPerMTok: input, outputPerMTok: output, cacheWritePerMTok: input, cacheReadPerMTok: cachedInput };
}

/**
 * What an unrecognised non-Claude id is priced at: nothing, flagged inexact. See the header —
 * a zero here means "unknown", never "free", and `rate_exact = 0` is what says which.
 */
export const UNKNOWN_RATE: ModelRate = { model: 'unknown', inputPerMTok: 0, outputPerMTok: 0, cacheWritePerMTok: 0, cacheReadPerMTok: 0 };

/** The backends whose unknown models get `UNKNOWN_RATE` rather than the Sonnet 5 fallback. */
const UNPRICED_WHEN_UNKNOWN = new Set(['openai', 'gemini', 'openai-compatible']);

/** What an unrecognised id is priced at. Sonnet 5 is the app's own default model on both paths. */
export const FALLBACK_RATE_MODEL = 'claude-sonnet-5';

export interface ResolvedRate {
  rate: ModelRate;
  /** False when the id was not in the card and the fallback was used. Surfaced, never hidden. */
  exact: boolean;
}

/**
 * **Which rate prices this call.**
 *
 * Three spellings reach here and all three have to work:
 *  - the API path's exact ids (`claude-haiku-4-5`) — a direct hit;
 *  - the CLI's aliases (`sonnet`), which is what `models.ts` stores when the learner picks from
 *    the dropdown and what `argsFor()` passes as `--model`;
 *  - a dated id the CLI reports back from `modelUsage` (`claude-sonnet-4-5-20250929`), which is
 *    a *different* string from anything this app asked for.
 *
 * Matching is therefore by family and generation rather than by equality: the id is lower-cased,
 * a trailing `-YYYYMMDD` is dropped, and the longest card entry that is a prefix of what remains
 * wins. `claude-sonnet-4-5-20250929` finds nothing (4-5 is not on the card) and lands on the
 * fallback with `exact: false`, which is correct — this app does not know what Sonnet 4.5 costs.
 */
export function rateFor(model: string, card: readonly ModelRate[] = RATE_CARD, backend?: string | null): ResolvedRate {
  const id = normaliseForPricing(model);
  let best: ModelRate | null = null;
  for (const entry of card) {
    const key = entry.model.toLowerCase();
    if (id === key || id.startsWith(`${key}-`)) {
      if (best === null || key.length > best.model.length) best = entry;
    }
  }
  if (best) return { rate: best, exact: true };
  // Aliases are a Claude CLI spelling; on the other providers an id that missed is unknown.
  if (backend && UNPRICED_WHEN_UNKNOWN.has(backend)) return { rate: UNKNOWN_RATE, exact: false };

  // The CLI aliases. `haiku` alone means "the current Haiku", which is what the CLI resolves it
  // to, so it prices as the card's Haiku rather than as an unknown.
  const alias = card.find((entry) => entry.model.toLowerCase().includes(`-${id}-`) || entry.model.toLowerCase() === `claude-${id}`);
  if (alias) return { rate: alias, exact: true };
  if (id === 'haiku' || id === 'sonnet' || id === 'opus') {
    const byFamily = card.find((entry) => entry.model.toLowerCase().startsWith(`claude-${id}-`));
    if (byFamily) return { rate: byFamily, exact: true };
  }

  const fallback = card.find((entry) => entry.model === FALLBACK_RATE_MODEL) ?? card[0]!;
  return { rate: fallback, exact: false };
}

/** Lower-case, trim, and drop a trailing date suffix the provider added to an id we asked for. */
export function normaliseForPricing(model: string): string {
  return (model ?? '')
    .trim()
    .toLowerCase()
    .replace(/-\d{8}$/, '');
}

export interface Estimate {
  usd: number;
  /** The rate that produced it, for the drawer's tooltip and for the CSV. */
  rate: ModelRate;
  exact: boolean;
}

/**
 * The whole of the dollar arithmetic, in one place: four token counts against four per-MTok
 * prices. `input` deliberately excludes the cache counts, exactly as the provider's own `usage`
 * object does — adding them in here is the double-count this function exists to prevent.
 */
export function estimateUsd(
  model: string,
  tokens: CostTokens,
  card: readonly ModelRate[] = RATE_CARD,
  backend?: string | null,
): Estimate {
  const { rate: r, exact } = rateFor(model, card, backend);
  const writePerMTok = backend === 'claude-cli' ? (r.cacheWrite1hPerMTok ?? r.cacheWritePerMTok) : r.cacheWritePerMTok;
  const usd =
    (tokens.input * r.inputPerMTok +
      tokens.output * r.outputPerMTok +
      tokens.cacheWrite * writePerMTok +
      tokens.cacheRead * r.cacheReadPerMTok) /
    1_000_000;
  return { usd: round6(usd), rate: r, exact };
}

// ── the settings override ───────────────────────────────────────────────────

/** The settings row the override lives in. JSON, because a price table is not a scalar. */
export const RATE_CARD_SETTING = 'cost_rate_card';

/**
 * **A learner-supplied rate card, merged over the built-in one.**
 *
 * Why it exists: these prices are cached, not fetched, and this app ships unsigned to a cohort
 * for a semester. When Anthropic changes a price the correct fix is a new build, but the
 * correct *fallback* is a settings row, so that a number on screen being wrong is something the
 * owner can correct in an afternoon rather than a reason to distrust the whole panel.
 *
 * Shape: `{"claude-sonnet-5": {"input": 2, "output": 10}}`. `cacheWrite` / `cacheWrite1h` /
 * `cacheRead` are optional and derive from `input` when omitted, the same way the built-in card
 * does. An entry
 * for a model that is not on the card **adds** it. Anything malformed is ignored entry by entry
 * rather than throwing: a typo in one line must not blank the whole panel.
 */
export function parseRateCardOverride(json: string | undefined | null): { card: readonly ModelRate[]; errors: string[] } {
  if (json === undefined || json === null || json.trim().length === 0) return { card: RATE_CARD, errors: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return { card: RATE_CARD, errors: [`not JSON: ${(err as Error).message}`] };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { card: RATE_CARD, errors: ['expected an object of model id → prices'] };
  }

  const errors: string[] = [];
  const merged = new Map(RATE_CARD.map((r) => [r.model, r]));
  for (const [model, raw] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null) {
      errors.push(`${model}: expected an object`);
      continue;
    }
    const v = raw as Record<string, unknown>;
    const input = num(v.input);
    const output = num(v.output);
    if (input === null || output === null) {
      errors.push(`${model}: input and output are required and must be non-negative numbers`);
      continue;
    }
    const base = rate(model, input, output);
    merged.set(model, {
      ...base,
      cacheWritePerMTok: num(v.cacheWrite) ?? base.cacheWritePerMTok,
      cacheReadPerMTok: num(v.cacheRead) ?? base.cacheReadPerMTok,
      cacheWrite1hPerMTok: num(v.cacheWrite1h) ?? base.cacheWrite1hPerMTok,
    });
  }
  return { card: [...merged.values()], errors };
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

/** Money is stored to the micro-dollar. Below that, floating point is louder than the price. */
function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
