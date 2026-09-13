<script lang="ts">
  /** Turn a slide into a room (product-design.md §B2). */
  import type { ConceptDraft } from '../../shared/types.js';
  import { store } from '../lib/store.svelte.js';

  let text = $state(store.setupSeed);
  let moduleCode = $state('MA3236');
  let draft = $state<ConceptDraft | null>(null);
  let loading = $state(false);
  let opening = $state(false);
  let title = $state('');
  let claims = $state<{ id: string; label: string }[]>([]);

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
    claims = result.claims.map((c) => ({ id: c.id, label: c.label }));
  }

  async function open(): Promise<void> {
    if (!draft) return;
    opening = true;
    await store.createSession({
      moduleCode: moduleCode.trim(),
      title: title.trim(),
      text,
      conceptId: draft.conceptId,
      claims: claims.map((c) => ({ id: c.id, label: c.label.trim() })),
      sourceKind: 'pasted_text',
    });
    opening = false;
  }

  function addClaim(): void {
    claims = [...claims, { id: `R${claims.length + 1}`, label: '' }];
  }
</script>

<div class="screen">
  <div class="col source">
    <h1>Set up this session</h1>
    <label class="field">
      <span>Module</span>
      <input bind:value={moduleCode} spellcheck="false" />
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
          <input bind:value={claims[i]!.label} aria-label="Claim {i + 1}" />
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
  .field input, .field textarea, .title, .claim input {
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
  .claim { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
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
