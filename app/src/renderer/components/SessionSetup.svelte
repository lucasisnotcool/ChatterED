<script lang="ts">
  /** Turn a slide into a room (product-design.md §B2). */
  import type { ConceptDraft } from '../../shared/types.js';
  import { store } from '../lib/store.svelte.js';

  // "Paste text instead" on the Notebooks home is the only way here since notebooks (#58): the
  // file-and-page-range seed of #22 went with the vault, so a session here is always pasted text.
  let text = $state(store.setupSeed);
  /**
   * The module code, **empty unless the learner types one**. It used to default to the literal
   * `'MA3236'`, so every session started without one was stamped with a real module the learner
   * had never taken, and it then showed up as a course in the nav rail (ui-review-ux.md M2).
   */
  let moduleCode = $state('');
  let draft = $state<ConceptDraft | null>(null);
  let loading = $state(false);
  let opening = $state(false);
  let title = $state('');
  /**
   * `learnerLabel` is the short handle the ledger rail shows. It is edited here, beside the
   * claim, because the rail is 260 px wide and the claim is a sentence — §D1's whole argument
   * for a live rail is that it can be scanned in half a second (ui-review-ux.md B5, M7).
   */
  let claims = $state<{ id: string; label: string; learnerLabel: string }[]>([]);

  /**
   * A textarea that grows with what is in it. The claim rows were single-line `<input>`s and
   * the claims are now paragraphs, so the confirmation step the spec calls "the learner's first
   * act of ownership" was asking them to confirm five things they could not read.
   */
  function autogrow(node: HTMLTextAreaElement): { destroy: () => void } {
    const fit = (): void => {
      node.style.height = 'auto';
      node.style.height = `${node.scrollHeight}px`;
    };
    fit();
    node.addEventListener('input', fit);
    // The rows are filled in from a model response after mount, not typed, so the first fit has
    // to happen once the value has landed too.
    const observer = new MutationObserver(fit);
    observer.observe(node, { attributes: true, attributeFilter: ['value'] });
    const frame = requestAnimationFrame(fit);
    return {
      destroy: () => {
        node.removeEventListener('input', fit);
        observer.disconnect();
        cancelAnimationFrame(frame);
      },
    };
  }

  const tooFew = $derived(claims.length > 0 && claims.length < 3);
  const tooMany = $derived(claims.length > 6);
  const canOpen = $derived(!!draft && claims.length >= 3 && title.trim().length > 0 && !opening);

  async function extract(): Promise<void> {
    if (!text.trim()) return;
    loading = true;
    const result = await store.draftConcept({ moduleCode: moduleCode.trim(), title: '', text });
    loading = false;
    if (!result) return;
    draft = result;
    title = result.title;
    claims = result.claims.map((c) => ({ id: c.id, label: c.label, learnerLabel: c.learnerLabel }));
  }

  async function open(): Promise<void> {
    if (!draft) return;
    opening = true;
    await store.createSession({
      moduleCode: moduleCode.trim(),
      title: title.trim(),
      text,
      conceptId: draft.conceptId,
      claims: claims.map((c) => ({ id: c.id, label: c.label.trim(), learnerLabel: c.learnerLabel.trim() })),
      sourceKind: 'pasted_text',
    });
    opening = false;
  }

  function addClaim(): void {
    claims = [...claims, { id: `R${claims.length + 1}`, label: '', learnerLabel: '' }];
  }
</script>

<div class="screen">
  <div class="col source">
    <h1>Set up this session</h1>
    <label class="field">
      <span>Module <span class="opt">optional</span></span>
      <input bind:value={moduleCode} spellcheck="false" placeholder="e.g. CS3249" />
    </label>
    <label class="field grow">
      <span>Paste the statement you want to explain</span>
      <textarea bind:value={text} placeholder="Paste text from your slide…"></textarea>
    </label>
    <div class="acts">
      <button type="button" class="btn-primary" onclick={() => void extract()} disabled={!text.trim() || loading}>
        Use this text
      </button>
    </div>
  </div>

  <div class="col card">
    {#if loading}
      <p class="caption">Pulling the claims out of your slide…</p>
      <div class="shimmer"></div>
      <div class="shimmer"></div>
      <div class="shimmer"></div>
    {:else if !draft}
      <p class="caption">Pick the pages you want to explain — usually one slide is enough.</p>
    {:else}
      <h2 class="label-caps">Concept</h2>
      <input class="title" bind:value={title} aria-label="Concept title" />

      <h2 class="label-caps">What you'll explain</h2>
      <p class="caption">These become your ledger. Edit anything that's wrong.</p>

      {#each claims as claim, i (claim.id)}
        <div class="claim">
          <span class="cid">{claim.id}</span>
          <div class="fields">
            <textarea
              class="ctext"
              rows="2"
              bind:value={claims[i]!.label}
              aria-label="Claim {i + 1}"
              use:autogrow
            ></textarea>
            <input
              class="clabel"
              bind:value={claims[i]!.learnerLabel}
              aria-label="Short label for claim {i + 1}"
              placeholder="short label for the rail"
              maxlength="60"
            />
          </div>
          <button
            type="button"
            class="del"
            aria-label="Delete claim {i + 1}"
            onclick={() => (claims = claims.filter((_, j) => j !== i))}>✕</button
          >
        </div>
      {/each}
      <button type="button" class="add" onclick={addClaim}>+ Add a claim</button>

      {#if tooFew}
        <p class="note">I could only find {claims.length} clear claims here — add one, or paste a bit more.</p>
      {:else if tooMany}
        <p class="note">That's more than six. Trim it back so the ledger stays scannable.</p>
      {/if}

      <hr class="hairline" />
      <h2 class="label-caps">House rules</h2>
      <ul class="rules">
        <li>They won't answer for you.</li>
        <li>They'll disagree with each other sometimes.</li>
        <li>
          Replies here are deliberately paced so you get room to think first. You can speed this up
          in Settings.
        </li>
        <li>You have the last word.</li>
      </ul>

      <button type="button" class="btn-primary wide" onclick={() => void open()} disabled={!canOpen}>
        Open the room
      </button>
    {/if}
  </div>
</div>

<style>
  .screen { flex: 1; display: flex; min-width: 0; }
  .col { padding: 20px 24px; overflow-y: auto; }
  .source { flex: 1; display: flex; flex-direction: column; gap: 14px; border-right: 1px solid var(--hairline); }
  .card { width: clamp(320px, 34vw, 420px); flex: none; background: var(--pane); border-left: 1px solid var(--hairline); }

  h1 { margin: 0; font-size: 16px; font-weight: 600; }
  h2 { margin: 18px 0 6px; color: var(--muted); font-size: 10px; }
  .field { display: flex; flex-direction: column; gap: 6px; font-size: 11px; color: var(--text-2); }
  .field.grow { flex: 1; }
  .field input, .field textarea, .title, .claim .ctext, .claim .clabel {
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--pane);
    padding: 8px 10px;
    font-size: 13px;
    width: 100%;
  }
  .field textarea { flex: 1; min-height: 220px; resize: none; line-height: 1.6; }
  .acts { display: flex; }

  .caption { margin: 0 0 10px; font-size: 12px; color: var(--text-2); line-height: 1.55; }
  .claim { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 10px; }
  .claim .fields { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .claim .ctext { resize: none; overflow: hidden; line-height: 1.5; min-height: 2.6em; }
  .claim .clabel { font-size: 11px; padding: 4px 8px; color: var(--text-2); }
  .cid { font-size: 10px; color: var(--muted); padding-top: 10px; font-variant-numeric: tabular-nums; }
  .opt { color: var(--muted); }
  .del { color: var(--muted); font-size: 11px; padding: 4px; }
  .del:hover { color: var(--text-2); }
  .add { font-size: 11px; color: var(--text-2); margin-top: 2px; }
  .add:hover { color: var(--indigo); }
  .note { margin: 10px 0 0; font-size: 11px; color: var(--text-2); line-height: 1.5; }

  .rules { margin: 0; padding-left: 16px; font-size: 12px; color: var(--text-2); line-height: 1.6; }
  .rules li { margin-bottom: 4px; }
  .wide { width: 100%; margin-top: 20px; }

  .shimmer {
    height: 30px;
    border-radius: 6px;
    background: linear-gradient(90deg, #f1f1f6, #e9e9f2, #f1f1f6);
    background-size: 200% 100%;
    animation: sweep 1.4s linear infinite;
    margin-bottom: 8px;
  }
  @keyframes sweep {
    from { background-position: 200% 0; }
    to { background-position: -200% 0; }
  }
</style>
