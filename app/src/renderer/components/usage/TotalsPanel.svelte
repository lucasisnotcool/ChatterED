<script lang="ts">
  /**
   * **Everything in the filters, and this run of the app.**
   *
   * Tokens lead and they are the hero figure, because tokens are the fact: `estimatedUsd` is
   * arithmetic this app did against a cached rate card (`shared/cost.ts` note 1). On the CLI
   * path the money tile is labelled **API-equivalent** by `usdLabel()` and never "spent" — an
   * unlabelled dollar figure in a student-facing app is a claim that a student owes money.
   *
   * The **CLI-reported** figure stands in its own tile beside the estimate and is never added to
   * it: the two disagreed by ~1.7× on the one measurement anybody has made, and a sum of them
   * would describe nothing at all.
   */
  import { totalTokens, usdLabel, type CostAnalytics } from '../../../shared/cost.js';
  import { tokensLabel, usdApprox, usdWithLabel } from '../../lib/cost.js';
  import { SESSION_NOTE, callsWord, reportedParts } from '../../lib/usageview.js';
  import Stat from './Stat.svelte';

  let { analytics }: { analytics: CostAnalytics } = $props();

  const total = $derived(analytics.total);
  const reported = $derived(reportedParts(total.reportedUsd, total.reportedCalls, total.calls));
  const money = $derived(analytics.mode === 'none' ? '' : usdApprox(total.estimatedUsd));
  const sessionLine = $derived(usdWithLabel(analytics.session.estimatedUsd, analytics.mode));
</script>

<div class="totals">
  <Stat
    hero
    label="Tokens in this range"
    value={tokensLabel(totalTokens(total.tokens))}
    sub={callsWord(total.calls)}
  />

  {#if money}
    <Stat label={usdLabel(analytics.mode)} value={money} sub="rate-card arithmetic, not a bill" />
  {/if}

  {#if reported}
    <!-- Its own tile, deliberately: beside the estimate, never summed with it. -->
    <Stat label={reported.label} value={reported.figure} sub={reported.over} />
  {/if}
</div>

<hr class="hairline" />

<p class="session">
  This session · {tokensLabel(totalTokens(analytics.session.tokens))} tokens ·
  {callsWord(analytics.session.calls)}{sessionLine ? ` · ${sessionLine}` : ''}
</p>
<p class="quiet">{SESSION_NOTE}</p>

<style>
  .totals { display: flex; gap: 40px; flex-wrap: wrap; align-items: flex-end; margin-bottom: 16px; }
  hr { margin-bottom: 12px; }
  .session { margin: 0; font-size: 13px; }
  .quiet { margin: 2px 0 0; font-size: 11.5px; color: var(--text-2); }
</style>
