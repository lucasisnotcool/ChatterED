<script lang="ts">
  /** The recap (product-design.md §B6, §D4). Slides in over the thread; the thread
   *  stays visible and scrollable behind it. */
  import type { RecapView } from '../../shared/types.js';
  import { LEDGER_GLYPH, glyphAlt } from '../lib/labels.js';
  import { minsSecs } from '../lib/time.js';

  let { recap, onclose }: { recap: RecapView; onclose: () => void } = $props();

  const established = $derived(recap.after.filter((r) => r.state === 'justified' || r.state === 'defended'));
  const moved = $derived(
    recap.after.some((r, i) => r.state !== (recap.before[i]?.state ?? 'not_yet')),
  );
  const acts = $derived(
    recap.actProfile.map((a) => `${a.count} ${a.label}`).join(' · '),
  );
</script>

<div class="wrap">
  <section class="card" aria-label="Session recap">
    <header>
      <h2>{recap.conceptTitle} — round recap</h2>
      <button type="button" class="x" onclick={onclose} aria-label="Close the recap">✕</button>
    </header>

    <h3 class="label-caps">Where you started → where you got to</h3>
    <div class="delta">
      {#each recap.after as row, i (row.elementId)}
        {@const before = recap.before[i]}
        <div class="drow">
          <span class="dlabel">{row.learnerLabel}</span>
          <span class="pair">
            <span class="g">{LEDGER_GLYPH[before?.state ?? 'not_yet']}</span>
            <span class="sr-only">{glyphAlt(before?.state ?? 'not_yet')} to</span>
            <span class="arrow" aria-hidden="true">→</span>
            <span class="g">{LEDGER_GLYPH[row.state]}</span>
            <span class="w">{glyphAlt(row.state)}</span>
          </span>
        </div>
      {/each}
      <p class="ladder">ladder: {recap.bloom}</p>
      {#if !moved}
        <p class="flat">Nothing moved states this round. That happens — the transcript is still yours.</p>
      {/if}
    </div>

    {#if established.length > 0}
      <h3 class="label-caps">What you established</h3>
      <ul class="quotes">
        {#each established as row (row.elementId)}
          <li>
            <span class="qlabel">{row.learnerLabel}</span>
            <span class="g">{LEDGER_GLYPH[row.state]}</span>
            {#if row.evidenceText}<p>“{row.evidenceText}”</p>{/if}
            {#if row.defendedAgainst}<span class="because">{row.defendedAgainst}</span>{/if}
          </li>
        {/each}
      </ul>
    {/if}

    {#if recap.openQuestions.length > 0}
      <h3 class="label-caps">What stayed open</h3>
      {#each recap.openQuestions as q, i (i)}<p class="body">{q}</p>{/each}
    {/if}

    {#if recap.corrections.length > 0}
      <h3 class="label-caps">Worth correcting</h3>
      {#each recap.corrections as c, i (i)}
        <p class="body">
          {#if c.caughtByLearner}<strong>You caught this yourself.</strong> {/if}{c.text}
        </p>
      {/each}
    {/if}

    <h3 class="label-caps">This round</h3>
    <p class="body">
      {acts}. You explained for {minsSecs(recap.unaidedMs)} before asking for any help.
    </p>

    {#if recap.teachbackOffer}
      <hr class="hairline" />
      <p class="body">{recap.teachbackOffer.blurb}</p>
      <div class="acts">
        <button type="button" class="btn-primary">Yes, invite {recap.teachbackOffer.displayName}</button>
        <button type="button" class="btn" onclick={onclose}>Not now</button>
      </div>
    {/if}
  </section>
</div>

<style>
  .wrap {
    position: absolute;
    inset: 0 0 0 40%;
    display: flex;
    justify-content: flex-end;
    pointer-events: none;
    z-index: 20;
  }
  .card {
    pointer-events: auto;
    width: 100%;
    overflow-y: auto;
    background: var(--pane);
    border-left: 1px solid var(--hairline);
    box-shadow: -12px 0 40px rgb(27 27 34 / 8%);
    padding: 20px 26px 32px;
    animation: slide 260ms ease-out;
  }
  @keyframes slide {
    from { transform: translateY(16px); opacity: 0; }
    to { transform: none; opacity: 1; }
  }
  header { display: flex; align-items: baseline; gap: 12px; }
  h2 { margin: 0; font-size: 14px; font-weight: 600; }
  .x { margin-left: auto; color: var(--muted); }
  h3 { margin: 24px 0 8px; color: var(--text-2); font-size: 11px; }

  .drow { display: flex; align-items: baseline; gap: 12px; padding: 4px 0; }
  .dlabel { flex: 1; font-size: 12px; }
  .pair { display: inline-flex; align-items: baseline; gap: 7px; }
  .g { color: var(--glyph); }
  .w { font-size: 11px; color: var(--text-2); }
  .arrow { color: var(--muted); }
  .ladder { margin: 10px 0 0; font-size: 11px; color: var(--text-2); }
  .flat { margin: 8px 0 0; font-size: 12px; color: var(--text-2); }

  .quotes { list-style: none; margin: 0; padding: 0; }
  .quotes li { padding: 8px 0; border-bottom: 1px solid var(--hairline); }
  .qlabel { font-size: 12px; margin-right: 8px; }
  .quotes p { margin: 5px 0 0; font-size: 13px; line-height: 1.6; }
  .because { display: block; margin-top: 4px; font-size: 11px; color: var(--text-2); }

  .body { margin: 0 0 8px; font-size: 13px; line-height: 1.65; max-width: 68ch; }
  .acts { display: flex; gap: 10px; margin-top: 12px; }
</style>
