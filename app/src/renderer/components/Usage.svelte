<script lang="ts">
  /**
   * **The Usage page** (issue #42 item D) — where all of it went.
   *
   * ────────────────────────────────────────────────────────────────────────────────────────────
   * THE RULE THE WHOLE PAGE IS BUILT AROUND
   * ────────────────────────────────────────────────────────────────────────────────────────────
   *
   * On the default backend — the learner's own Claude Code subscription (#19) — **nobody is being
   * billed per token at all**. Every dollar figure here is arithmetic this app did against a rate
   * card it cached on a date it can name, and it is labelled *API-equivalent* by `usdLabel()`
   * wherever it appears. An unlabelled `$1.45` on a page a cohort of students installs is a claim
   * that a student owes money. Tokens lead; the estimate follows, hedged; the CLI's own figure
   * stands beside it under its own name and is never added to it.
   *
   * That is also why the five-hour window gets the prominence a bill would get elsewhere: on a
   * subscription the rolling window, not a dollar total, is the constraint that actually bites.
   *
   * ────────────────────────────────────────────────────────────────────────────────────────────
   * THE SHAPE
   * ────────────────────────────────────────────────────────────────────────────────────────────
   *
   * One filter row above everything it scopes, then one grid of panels — so every chart, stat and
   * table on the page is drawn from the same `CostAnalytics` and two of them cannot come to
   * describe different slices. A filter change goes through `store.loadAnalytics()`, which also
   * records the query, so a live `cost.updated` refreshes exactly what the learner is looking at.
   *
   * Three empty states, and they are three different facts: the channel is missing (an older
   * main process), the ledger is empty (nothing ingested yet), or the filters matched nothing
   * (the learner can fix that one). A single greyed "No data" would tell them none of it.
   *
   * No learner text reaches this page. `CostAnalytics` has no field that carries words beyond a
   * document title, which is a filename the learner chose, and nothing here asks for more.
   */
  import { store } from '../lib/store.svelte.js';
  import {
    FILTER_EMPTY_NOTE,
    LEDGER_EMPTY_NOTE,
    backendWord,
    emptyNote,
    isLedgerEmpty,
    queryFor,
    rateCardNote,
    scopeWord,
    type RangeValue,
  } from '../lib/usageview.js';
  import type { CostBackend } from '../../shared/cost.js';
  import CachePanel from './usage/CachePanel.svelte';
  import CallsTable from './usage/CallsTable.svelte';
  import DayColumns from './usage/DayColumns.svelte';
  import DocumentBars from './usage/DocumentBars.svelte';
  import OutcomesPanel from './usage/OutcomesPanel.svelte';
  import Panel from './usage/Panel.svelte';
  import PerMessagePanel from './usage/PerMessagePanel.svelte';
  import SliceBars from './usage/SliceBars.svelte';
  import TotalsPanel from './usage/TotalsPanel.svelte';
  import UsageFilters from './usage/UsageFilters.svelte';
  import WindowPanel from './usage/WindowPanel.svelte';

  let range = $state<RangeValue>('all');
  let fileId = $state('');
  let backend = $state('');
  let exporting = $state(false);
  let exported = $state('');

  const analytics = $derived(store.costAnalytics);
  /**
   * The backend menu lists only what is actually in the ledger. A three-item menu on an install
   * where one backend has ever run is three ways to ask a question with one answer.
   */
  const backends = $derived<CostBackend[]>((analytics?.byBackend ?? []).map((s) => s.key as CostBackend));

  function apply(next: { range: RangeValue; fileId: string; backend: string }): void {
    range = next.range;
    fileId = next.fileId;
    backend = next.backend;
    void store.loadAnalytics(
      queryFor({ range, fileId: fileId || null, backend: (backend || null) as CostBackend | null }),
    );
  }

  /**
   * On the Electron path `cost:export` writes the file itself and returns where it put it; the
   * `vite dev` fallback returns the CSV. Either way the learner is told something specific —
   * "Exported" with no destination is the confirmation that sends somebody hunting.
   */
  async function exportCsv(): Promise<void> {
    exporting = true;
    const result = await store.exportCost();
    exporting = false;
    if (result === null) {
      exported = 'Nothing to export yet.';
      return;
    }
    exported = result.includes('\n')
      ? `Exported ${result.split('\n').length - 2} calls.`
      : `Saved to ${result}`;
  }
</script>

<main class="usage">
  <div class="sheet">
    <header>
      <h1>Information and usage</h1>
      <p class="quiet">
        What ChatterED has asked a model to do, and what the rate card makes of it. Tokens are the
        fact; the dollars are this app's own arithmetic.
      </p>
    </header>

    {#if !store.analyticsOn}
      <!-- An older main process without the channel. A page that half-rendered against a missing
           API would be worse than one that says plainly it is not here. -->
      <p class="flat">
        This build cannot read the usage ledger — the analytics channel is not available. Settings ▸
        Usage still shows the running totals.
      </p>
    {:else}
      <UsageFilters
        {range}
        {fileId}
        {backend}
        {backends}
        files={analytics?.knownFiles ?? []}
        busy={store.costAnalyticsBusy}
        {exporting}
        {exported}
        onchange={apply}
        onexport={() => void exportCsv()}
      />

      {#if !analytics}
        <p class="flat">{store.costAnalyticsBusy ? 'Reading the ledger…' : 'Nothing to show yet.'}</p>
      {:else if isLedgerEmpty(analytics)}
        <p class="flat">{LEDGER_EMPTY_NOTE}</p>
      {:else}
        <!-- Refetch holds the previous render at reduced opacity: no skeleton, no layout jump. -->
        <div class="grid" class:busy={store.costAnalyticsBusy}>
          <div class="summary-card">
            <Panel title="Everything in this range">
              <TotalsPanel {analytics} />
            </Panel>
          </div>

          {#if analytics.total.calls === 0}
            <p class="flat span">{FILTER_EMPTY_NOTE}</p>
          {/if}

          {#if analytics.cliWindow}
            <WindowPanel burn={analytics.cliWindow} mode={analytics.mode} />
          {/if}

          <Panel
            wide
            title="Which documents cost the most"
            note="Setup is the two-pass lecture-notes ingest, the concept pack and the objectives tree — paid once per deck, before a word is said. Everything after that is conversation."
            empty={emptyNote('documents', analytics.documents.length > 0)}
          >
            <DocumentBars rows={analytics.documents} />
          </Panel>

          <Panel
            wide
            title="Over time"
            note="Tokens per day, oldest on the left. The days are UTC, the same buckets the ledger groups on — not your local calendar."
            empty={emptyNote('days', analytics.byDay.length > 0)}
          >
            <DayColumns rows={analytics.byDay} />
          </Panel>

          <Panel title="Where the tokens go" empty={emptyNote('scope', analytics.byScope.length > 0)}>
            <SliceBars slices={analytics.byScope} word={scopeWord} caption="Tokens by what the call was for" />
          </Panel>

          <Panel title="By model" empty={emptyNote('model', analytics.byModel.length > 0)}>
            <SliceBars slices={analytics.byModel} caption="Tokens by model" />
          </Panel>

          <Panel title="By backend" empty={emptyNote('backend', analytics.byBackend.length > 0)}>
            <SliceBars slices={analytics.byBackend} word={backendWord} caption="Tokens by backend" />
          </Panel>

          <Panel
            title="Cache hit share"
            note="On the Claude Code path this is substantially the whole cost: a panel showing only fresh input tokens would be describing a rounding error."
            empty={emptyNote('cache', analytics.cache.cacheRead + analytics.cache.freshInput > 0)}
          >
            <CachePanel cache={analytics.cache} />
          </Panel>

          <Panel
            title="Per message"
            empty={emptyNote('perMessage', analytics.perMessage.learnerMessages + analytics.perMessage.agentMessages > 0)}
          >
            <PerMessagePanel stats={analytics.perMessage} mode={analytics.mode} />
          </Panel>

          <Panel title="How calls ended" empty={emptyNote('outcomes', analytics.outcomes.length > 0)}>
            <OutcomesPanel rows={analytics.outcomes} />
          </Panel>

          <Panel
            wide
            title="Recent calls"
            note="The slowest and the most expensive of the last calls in this range. Sizes and timings only — the ledger has no column that carries what was said."
            empty={emptyNote('calls', analytics.slowest.length + analytics.priciest.length > 0)}
          >
            <div class="two">
              <div>
                <h3>Slowest</h3>
                <CallsTable calls={analytics.slowest} mode={analytics.mode} />
              </div>
              <div>
                <h3>Most expensive</h3>
                <CallsTable calls={analytics.priciest} mode={analytics.mode} showUsd />
              </div>
            </div>
          </Panel>
        </div>

        <p class="footnote">{rateCardNote(analytics.rateCardDate)}</p>
      {/if}
    {/if}
  </div>
</main>

<style>
  .usage {
    flex: 1;
    overflow-y: auto;
    padding: 28px 32px 60px;
    min-width: 0;

    /* ── The chart palette ──────────────────────────────────────────────────
       Two slots, validated against this surface (adjacent and all-pairs CVD, the
       normal-vision floor, the chroma floor and 3:1 contrast all pass). Slot 1 is the app's
       own accent, so the page introduces exactly one colour that is not already a token —
       and only ever inside a mark, never as text. */
    --series-1: var(--indigo);
    --series-2: #eb6834;
  }
  .sheet { max-width: 1160px; margin: 0 auto; }

  header { margin-bottom: 20px; }
  h1 { margin: 0 0 3px; font-size: 16px; font-weight: 600; }
  .quiet { margin: 0; color: var(--text-2); font-size: 12px; max-width: 76ch; }

  .grid {
    display: grid;
    /* Panels wrap, never clip: at the app's ~1100px floor this is three columns, at 1440 it is
       three wider ones, and a panel that cannot reach 320px stacks instead of squeezing. */
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 14px;
    align-items: start;
    transition: opacity 120ms linear;
  }
  .busy { opacity: 0.55; }
  .span { grid-column: 1 / -1; }
  .summary-card { grid-column: 1 / -1; width: min(100%, 880px); }

  .two { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 22px; }
  h3 {
    margin: 0 0 6px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-2);
  }

  .flat { margin: 0; padding: 18px 0; font-size: 12.5px; color: var(--text-2); }
  .footnote {
    margin: 20px 0 0;
    font-size: 11px;
    line-height: 1.6;
    color: var(--text-2);
    max-width: 82ch;
  }
</style>
