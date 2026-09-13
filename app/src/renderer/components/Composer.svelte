<script lang="ts">
  /**
   * The group composer (product-design.md §C4, §C3 micro-prompt, §C9 closing mode).
   * Enter sends · ⇧Enter newline. A typing heartbeat goes out at most once per 3 s.
   */
  import type { AgentProfile, RoomSnapshot } from '../../shared/types.js';
  import { store } from '../lib/store.svelte.js';
  import WaitLine from './WaitLine.svelte';

  let { room, onwhisper }: { room: RoomSnapshot; onwhisper: () => void } = $props();

  let text = $state('');
  let closing = $state(false);
  let box = $state<HTMLTextAreaElement | null>(null);
  let lastBeat = 0;

  const peer = $derived(room.agents.find((a) => a.role === 'peer') ?? null);
  const holdingAgent = $derived<AgentProfile | null>(
    room.thinking ? (room.agents.find((a) => a.key === room.thinking?.agentKey) ?? null) : null,
  );
  /** The ghosted micro-prompt only exists during a Challenger hold (§C3). */
  const microPrompt = $derived(
    holdingAgent?.role === 'challenger'
      ? `Anything to add before ${holdingAgent.displayName} replies?`
      : null,
  );
  const placeholder = $derived(
    closing
      ? "Say the whole thing once, in your own words. This is the bit you'll keep."
      : (microPrompt ?? 'Explain it in your own words…'),
  );

  function beat(): void {
    const now = Date.now();
    if (text.trim().length === 0) return;
    if (now - lastBeat < 3000) {
      store.lastTypedAt = now;
      return;
    }
    lastBeat = now;
    store.typing(text.length);
  }

  function submit(): void {
    const body = text.trim();
    if (!body) return;
    store.send(body);
    text = '';
    if (closing) {
      closing = false;
      void store.wrapUp();
    }
  }

  function onkeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  export function focus(): void {
    box?.focus();
  }
</script>

<div class="composer">
  <textarea
    bind:this={box}
    bind:value={text}
    class:closing
    rows={closing ? 4 : 3}
    {placeholder}
    aria-label="Your message"
    oninput={beat}
    {onkeydown}
  ></textarea>

  <WaitLine
    timer={room.timer}
    firingAgent={peer}
    onhold={() => store.hold()}
    onwait={() => store.pauseNudges(!room.nudgesPaused)}
  />

  <div class="foot">
    <span class="hint">Enter sends · ⇧Enter newline</span>
    <button type="button" class="ghost" onclick={onwhisper}>⌘K whisper</button>
    <span class="spacer"></span>
    {#if closing}
      <button type="button" class="ghost" onclick={() => (closing = false)}>Back to the chat</button>
      <button type="button" class="btn" onclick={() => void store.wrapUp()}>Finish the round</button>
    {:else}
      <button type="button" class="ghost" onclick={() => (closing = true)}>Wrap up</button>
    {/if}
  </div>
</div>

<style>
  .composer { padding: 10px 0 14px; }
  textarea {
    width: 100%;
    resize: none;
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    background: var(--pane);
    padding: 10px 12px;
    font-size: 14px;
    line-height: 1.55;
  }
  textarea::placeholder { color: var(--muted); }
  textarea:focus { border-color: #cfcfe0; }
  .closing { min-height: 92px; }

  .foot {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-top: 8px;
  }
  .spacer { flex: 1; }
  .hint { font-size: 11px; color: var(--muted); }
  .ghost { font-size: 11px; color: var(--text-2); border-bottom: 1px solid transparent; }
  .ghost:hover { color: var(--indigo); border-bottom-color: var(--indigo); }
  .btn { font-size: 12px; padding: 5px 12px; }
</style>
