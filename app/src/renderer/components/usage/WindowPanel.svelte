<script lang="ts">
  /**
   * **The rolling five hours** (`shared/cost.ts` `CliWindowBurn`).
   *
   * On a subscription nobody is billed per token, so a dollar figure is not the constraint — the
   * rolling usage window is, and it is the thing that fails invisibly on the evening the A1 video
   * is recorded. That is why this panel is given the prominence a bill would get elsewhere.
   *
   * There is **no meter and no percentage**, on purpose: Claude Code's own limit is not a number
   * this app can see, and a gauge drawn against a guessed ceiling would present a guess as a
   * fact. What the app knows exactly is what it has put through, and that is what it shows.
   *
   * The panel is absent, not empty, on an install with no CLI calls — `cliWindow` is null there
   * and a greyed "0 of 5 hours" card would invent a constraint that does not apply.
   */
  import {
    CLI_WINDOW_HOURS,
    REPORTED_USD_LABEL,
    formatUsd,
    totalTokens,
    type CliWindowBurn,
    type CostMode,
  } from '../../../shared/cost.js';
  import { tokensLabel, usdWithLabel, windowLine } from '../../lib/cost.js';
  import { callsWord } from '../../lib/usageview.js';

  let { burn, mode }: { burn: CliWindowBurn; mode: CostMode } = $props();

  const money = $derived(usdWithLabel(burn.estimatedUsd, mode));
  /**
   * The figure alone, with no "over N of M calls": `CliWindowBurn` carries no `reportedCalls`,
   * and inventing a denominator so the line matches the totals panel's would be a claim about
   * coverage this shape cannot support.
   */
  const reported = $derived(burn.reportedUsd === null ? null : formatUsd(burn.reportedUsd));
  const line = $derived(windowLine(burn, mode) ?? '');
</script>

<section class="window" aria-label="The rolling {burn.hours || CLI_WINDOW_HOURS}-hour window">
  <h2>The last {burn.hours || CLI_WINDOW_HOURS} hours</h2>
  <div class="row">
    <p class="figure" title={line}>
      <strong>{tokensLabel(totalTokens(burn.tokens))}</strong> tokens
    </p>
    <p class="under">
      {callsWord(burn.calls)}{money ? ` · ${money}` : ''}
      {#if reported}<br />{REPORTED_USD_LABEL} {reported}{/if}
    </p>
  </div>
  <p class="note">
    Rolling from now, not from a fixed boundary. On Claude Code this window — not a bill — is the
    thing that runs out, and it is not narrowed by the filters above: it is a property of this Mac,
    not of one document.
  </p>
</section>

<style>
  .window {
    grid-column: 1 / -1;
    background: var(--indigo-tint);
    border: 1px solid #ddd9f6;
    border-radius: var(--radius);
    padding: 16px 18px 18px;
  }
  h2 {
    margin: 0 0 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-2);
  }
  .row { display: flex; align-items: baseline; gap: 28px; flex-wrap: wrap; }
  .figure { margin: 0; font-size: 14px; color: var(--text-2); }
  .figure strong { font-size: 28px; font-weight: 600; letter-spacing: -0.02em; color: var(--text); }
  .under { margin: 0; font-size: 12px; line-height: 1.55; color: var(--text-2); }
  .note { margin: 10px 0 0; font-size: 11.5px; line-height: 1.55; color: var(--text-2); max-width: 92ch; }
</style>
