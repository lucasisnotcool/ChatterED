<script lang="ts">
  /**
   * Promote a whisper to the group (product-design.md §C8).
   * The agent may offer; it may never send. Preview is mandatory, and the
   * message that lands in the thread carries no badge and no provenance marker.
   */
  import { untrack } from 'svelte';
  import type { AgentProfile, RelayAttribution, WhisperTurnView } from '../../shared/types.js';
  import { monogram, roleWord } from '../lib/labels.js';

  let {
    turn,
    agent,
    otherName,
    onsend,
  }: {
    turn: WhisperTurnView;
    agent: AgentProfile;
    otherName: string;
    onsend: (attribution: RelayAttribution, text: string) => void;
  } = $props();

  let stage = $state<'offer' | 'preview' | 'edit' | 'sent'>('offer');
  // The offer is fixed for the life of this card (the list is keyed by turn id),
  // so seeding from the initial value is deliberate.
  let attribution = $state<RelayAttribution>(
    untrack(() => turn.relayOffer?.defaultAttribution) ?? 'as_agent',
  );
  let text = $state(untrack(() => turn.relayOffer?.draftText) ?? '');
</script>

{#if stage === 'offer'}
  <div class="card">
    <p class="q">Raise this in the group?</p>
    <label>
      <input type="radio" name="attr-{turn.id}" value="as_me" bind:group={attribution} />
      <span>As my question</span>
    </label>
    <label>
      <input type="radio" name="attr-{turn.id}" value="as_agent" bind:group={attribution} />
      <span>Let {agent.displayName} raise it as their own</span>
    </label>
    <div class="acts">
      <button type="button" class="btn-primary small" onclick={() => (stage = 'preview')}>
        Preview &amp; send
      </button>
      <button type="button" class="ghost" onclick={() => (stage = 'sent')}>Keep it here</button>
    </div>
  </div>
{:else if stage === 'preview' || stage === 'edit'}
  <div class="card">
    <p class="q">This will appear in the group</p>
    <div class="preview" style="--hue: {attribution === 'as_agent' ? agent.colour : 'var(--indigo)'}">
      <div class="phead">
        {#if attribution === 'as_agent'}
          <span class="avatar" aria-hidden="true">{monogram(agent.displayName)}</span>
          <span class="label-caps">{agent.displayName} · {roleWord(agent.role)}</span>
        {:else}
          <span class="label-caps">You</span>
        {/if}
      </div>
      {#if stage === 'edit'}
        <textarea bind:value={text} rows="4" aria-label="Edit the message"></textarea>
      {:else}
        <p class="ptext">{text}</p>
      {/if}
    </div>
    <p class="note">{otherName} will see this message. {otherName} won't see anything else from this whisper.</p>
    <div class="acts">
      <button
        type="button"
        class="btn-primary small"
        onclick={() => {
          onsend(attribution, text.trim());
          stage = 'sent';
        }}
      >
        Send to the group
      </button>
      {#if stage === 'preview'}
        <button type="button" class="ghost" onclick={() => (stage = 'edit')}>Edit</button>
      {:else}
        <button type="button" class="ghost" onclick={() => (stage = 'preview')}>Done editing</button>
      {/if}
      <button type="button" class="ghost" onclick={() => (stage = 'offer')}>Cancel</button>
    </div>
  </div>
{/if}

<style>
  .card {
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--ground);
    padding: 10px 12px;
    margin-top: 8px;
  }
  .q { margin: 0 0 7px; font-size: 12px; color: var(--text); }
  label { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--text-2); padding: 2px 0; }
  input[type='radio'] { accent-color: var(--indigo); margin: 0; }
  .acts { display: flex; align-items: center; gap: 10px; margin-top: 10px; flex-wrap: wrap; }
  .small { padding: 5px 12px; font-size: 12px; }
  .ghost { font-size: 11px; color: var(--text-2); border-bottom: 1px solid transparent; }
  .ghost:hover { color: var(--indigo); border-bottom-color: var(--indigo); }

  .preview {
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-left: 3px solid var(--hue);
    border-radius: 6px;
    padding: 8px 10px;
  }
  .phead { display: flex; align-items: center; gap: 5px; margin-bottom: 4px; color: var(--hue); }
  .avatar {
    width: 15px; height: 15px; border-radius: 50%; background: var(--hue); color: #fff;
    font-size: 9px; display: inline-flex; align-items: center; justify-content: center;
  }
  .ptext { margin: 0; font-size: 13px; line-height: 1.55; }
  .preview textarea {
    width: 100%; resize: vertical; border: 1px solid var(--hairline);
    border-radius: 5px; padding: 6px 8px; font-size: 13px;
  }
  .note { margin: 8px 0 0; font-size: 11px; color: var(--muted); line-height: 1.45; }
</style>
