<script lang="ts">
  /** One turn in the group thread. Anatomy is product-design.md §C1 exactly. */
  import type { AgentProfile, MessageView } from '../../shared/types.js';
  import { monogram, roleWord, speakerLabel } from '../lib/labels.js';
  import { store } from '../lib/store.svelte.js';
  import { clockTime } from '../lib/time.js';
  import Divider from './Divider.svelte';
  import DocumentCard from './DocumentCard.svelte';

  let {
    message,
    agents,
    sameSpeaker = false,
  }: { message: MessageView; agents: AgentProfile[]; sameSpeaker?: boolean } = $props();

  const agent = $derived(message.speaker.kind === 'agent' ? message.speaker : null);
  const hue = $derived(agent ? agent.colour : 'var(--indigo)');
  const isChallenger = $derived(agent?.role === 'challenger');
  const isTutee = $derived(agent?.role === 'tutee');
  const marker = $derived(message.disagreement);
  const targetName = $derived(
    agents.find((a) => a.key === marker?.targetAgentKey)?.displayName ?? 'the other',
  );
</script>

{#if message.divider}
  <!-- `don't do this` turns the nudge off for the rest of the round, with an undo
       in the wait-line. Settings is not in this build. -->
  <Divider divider={message.divider} paused={store.room?.nudgesPaused ?? false} onComplain={(next) => store.pauseNudges(next)} />
{/if}

<article
  class="msg"
  class:mine={!agent}
  class:tutee={isTutee}
  class:challenger={isChallenger}
  class:tight={sameSpeaker && !message.divider}
  data-msg-id={message.id}
  style="--hue: {hue}"
>
  {#if marker}
    <!-- §C6: the connector is drawn only for disagreement, never for agreement.
         Its height is measured by Thread.svelte from the contested message. -->
    <span
      class="connector"
      data-connector
      data-target-id={marker.targetMessageId ?? ''}
      aria-hidden="true"
    ></span>
  {/if}

  <span class="sr-only">
    {agent ? `${agent.displayName}, ${roleWord(agent.role)}, says:` : 'You said:'}
  </span>

  <div class="head">
    {#if agent}
      <span class="avatar" class:ringed={isChallenger} aria-hidden="true">{monogram(agent.displayName)}</span>
    {/if}
    <span class="label-caps label">{speakerLabel(message)}</span>
    {#if marker}
      <span class="marker">↔ {marker.marker} {targetName}</span>
    {/if}
  </div>

  <div class="block">
    <p>{message.body}</p>
    {#if message.reference}
      <DocumentCard reference={message.reference} />
    {/if}
  </div>

  <div class="meta" aria-hidden="true">
    <span>{clockTime(message.createdAt)}</span>
    {#if message.ttftActualMs !== null}<span>· {Math.round(message.ttftActualMs / 1000)}s</span>{/if}
  </div>
</article>

<style>
  .msg {
    position: relative;
    margin-top: 16px;
    max-width: 72ch;
  }
  .msg.tight { margin-top: 6px; }
  .msg.tutee { margin-left: 24px; }
  .msg.mine { margin-left: auto; text-align: right; }

  .head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
  .mine .head { justify-content: flex-end; }

  .label { color: var(--hue); }

  .marker {
    font-size: 11px;
    color: var(--hue);
    letter-spacing: 0.01em;
  }

  .avatar {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--hue);
    color: #fff;
    font-size: 10px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
  }
  /* Non-colour cue for the challenger: dashed rule + ringed avatar (§C1). */
  .avatar.ringed {
    background: transparent;
    color: var(--hue);
    border: 1.5px solid var(--hue);
  }

  .block {
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-left: 3px solid var(--hue);
    border-radius: var(--radius);
    padding: 10px 14px;
    text-align: left;
  }
  .block p { margin: 0; font-size: 14px; line-height: 1.62; white-space: pre-wrap; }

  /* Non-colour cue: the challenger's rule is dashed (§C1). */
  .challenger .block { border-left-style: dashed; }

  .mine .block {
    background: var(--indigo-tint);
    border: 1px solid transparent;
    border-right: 3px solid var(--indigo);
    border-left: none;
  }

  .meta {
    font-size: 11px;
    color: var(--muted);
    margin-top: 3px;
    opacity: 0;
    transition: opacity 120ms ease-out;
  }
  .msg:hover .meta { opacity: 1; }

  .connector {
    position: absolute;
    left: -14px;
    top: calc(-1 * var(--connector-h, 28px));
    height: calc(var(--connector-h, 28px) + 9px);
    width: 10px;
    border-left: 1px solid var(--hue);
    border-bottom: 1px solid var(--hue);
    border-bottom-left-radius: 6px;
  }
</style>
