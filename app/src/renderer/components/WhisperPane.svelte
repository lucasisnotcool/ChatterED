<script lang="ts">
  /**
   * The private 1:1 pane (product-design.md §B4, §C7, §C8).
   * It takes the rail's slot; the group thread stays visible and unblurred.
   */
  import type { RoomSnapshot } from '../../shared/types.js';
  import { store } from '../lib/store.svelte.js';
  import RelayOffer from './RelayOffer.svelte';

  let { room }: { room: RoomSnapshot } = $props();

  let text = $state('');

  const thread = $derived(store.whisper);
  const counterparts = $derived(room.agents.filter((a) => a.role === 'peer' || a.role === 'challenger'));
  const otherName = $derived(
    counterparts.find((a) => a.key !== thread?.agent.key)?.displayName ?? 'the others',
  );

  function send(): void {
    const body = text.trim();
    if (!body) return;
    store.sendWhisper(body);
    text = '';
  }
</script>

<aside class="pane" aria-label="Private whisper">
  {#if !thread}
    <header class="pick">
      <span class="title">🔒 Whisper to…</span>
      <button type="button" class="x" onclick={() => (store.whisperOpen = false)} aria-label="Close">✕</button>
    </header>
    <div class="picker">
      {#each counterparts as a (a.key)}
        <button type="button" class="choice" onclick={() => void store.openWhisper(a.key)}>
          <span class="key">{a.displayName.charAt(0).toUpperCase()}</span>
          <span>
            <strong>{a.displayName}</strong>
            <em>
              {a.role === 'peer'
                ? 'background, definitions, the question that feels too basic.'
                : "what they're actually asking, why they pushed on that."}
            </em>
          </span>
        </button>
      {/each}
    </div>
  {:else}
    <header>
      <span class="title">🔒 Private with {thread.agent.displayName}</span>
      <span class="sub">{otherName} can't see this.</span>
      <button type="button" class="x" onclick={() => store.closeWhisper()} aria-label="Close whisper">✕</button>
    </header>

    <div class="turns">
      <!-- The limits statement is always the first thing in the pane (§B4). -->
      <div class="turn agent" style="--hue: {thread.agent.colour}">
        <span class="label-caps lbl">{thread.agent.displayName}</span>
        <p>{thread.limitsLine}</p>
      </div>

      {#each thread.turns as t (t.id)}
        <div
          class="turn"
          class:agent={t.sender === 'agent'}
          class:mine={t.sender === 'student'}
          style="--hue: {thread.agent.colour}"
        >
          {#if t.sender === 'agent'}<span class="label-caps lbl">{thread.agent.displayName}</span>{/if}
          <p>{t.body}</p>
        </div>
        {#if t.relayOffer}
          <RelayOffer
            turn={t}
            agent={thread.agent}
            {otherName}
            onsend={(attribution, body) => store.relay(t.id, attribution, body)}
          />
        {/if}
      {/each}
    </div>

    <div class="composer">
      <div class="row">
        <span class="lock" aria-hidden="true">🔒</span>
        <textarea
          bind:value={text}
          rows="2"
          placeholder="Ask {thread.agent.displayName} privately…"
          aria-label="Private message"
          onkeydown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        ></textarea>
      </div>
      <p class="foot">Enter sends · ⇧Enter newline</p>
      <p class="foot">Clears at the end of the round.</p>
    </div>
  {/if}
</aside>

<style>
  .pane {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--pane);
    border-left: 1px solid var(--hairline);
    min-width: 0;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 8px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--hairline);
  }
  .title { font-size: 12px; font-weight: 600; }
  .sub { font-size: 11px; color: var(--text-2); }
  .x { margin-left: auto; color: var(--muted); font-size: 12px; }
  .x:hover { color: var(--text); }

  .picker { padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
  .choice {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    text-align: left;
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    padding: 9px 11px;
  }
  .choice:hover { border-color: var(--indigo); }
  .key {
    flex: none;
    width: 18px; height: 18px; border-radius: 4px;
    border: 1px solid var(--hairline);
    font-size: 10px; display: inline-flex; align-items: center; justify-content: center;
    color: var(--text-2);
  }
  .choice strong { display: block; font-size: 12px; font-weight: 600; }
  .choice em { display: block; font-style: normal; font-size: 11px; color: var(--text-2); line-height: 1.45; }

  .turns { flex: 1; overflow-y: auto; padding: 12px 14px; }
  .turn { margin-bottom: 12px; }
  .turn p { margin: 0; font-size: 13px; line-height: 1.55; }
  .lbl { color: var(--hue); display: block; margin-bottom: 3px; }
  .agent p {
    background: var(--ground);
    border-left: 2px solid var(--hue);
    border-radius: 5px;
    padding: 8px 10px;
  }
  .mine p {
    background: var(--indigo-tint);
    border-radius: 5px;
    padding: 8px 10px;
    margin-left: 18px;
  }

  .composer { border-top: 1px solid var(--hairline); padding: 10px 14px 12px; }
  .row { display: flex; gap: 7px; align-items: flex-start; }
  .lock { font-size: 11px; padding-top: 8px; }
  textarea {
    flex: 1;
    resize: none;
    border: 1px solid var(--hairline);
    border-radius: 6px;
    padding: 7px 9px;
    font-size: 13px;
    min-width: 0;
  }
  .foot { margin: 5px 0 0; font-size: 10px; color: var(--muted); }
</style>
