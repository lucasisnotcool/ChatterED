<script lang="ts">
  /**
   * A private thread with one agent (#48, §4.1) — the whisper, kept, and now with Max in it too.
   *
   * Two properties the learner has to be able to *see*, not infer:
   *
   *  1. **It is private, and the other one cannot read it.** Said once at the top of the thread,
   *     in the app's own voice, naming the agent who is not here. It is the same disclosure the
   *     whisper popover carried and it is load-bearing: the reason a learner asks the
   *     embarrassing question here is that they believe this.
   *  2. **Nothing here touches the document unless the learner says so.** *Insert into the
   *     document* is the one path from private to shared (§4.1), it sits on the turn it is about,
   *     and it puts the text where the learner's caret is — they are saying *put it here*.
   *
   * These threads never edit the document by themselves, and no agent's prompt is given a
   * private turn: `context.test.ts` in `src/room` is the canary for that and it is the main
   * process's to keep, not this component's.
   */
  import type { AgentAuthor } from '../../../shared/doc/types.js';
  import { AGENT_HUE, AGENT_NAME, AGENT_ROLE_WORD } from '../../lib/chatview.js';
  import { paragraphs } from '../../lib/aitext.js';
  import { monogram } from '../../lib/labels.js';
  import { clockTime } from '../../lib/time.js';
  import { store } from '../../lib/store.svelte.js';
  import MentionComposer from './MentionComposer.svelte';

  let { agent }: { agent: AgentAuthor } = $props();

  const chat = store.chat;
  const channel = $derived(chat.channel(agent));
  const other = $derived<AgentAuthor>(agent === 'ellie' ? 'max' : 'ellie');
  const hue = $derived(AGENT_HUE[agent]);
  let scroller = $state<HTMLElement | null>(null);
  let inserted = $state<Record<string, boolean>>({});

  $effect(() => {
    void chat.fileId;
    void chat.tab;
    if (chat.tab === agent) void chat.openPrivate(agent);
  });

  $effect(() => {
    void channel.turns.length;
    void channel.thinking;
    const el = scroller;
    if (!el) return;
    queueMicrotask(() => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }));
  });

  async function insert(turnId: string): Promise<void> {
    // Where the learner is reading. Asked of the editor at the moment of the click, not held:
    // "here" is wherever the caret is now.
    const anchorBlockId = store.doc.caretBlockId();
    const ok = await chat.insertIntoDoc({ agent, turnId, anchorBlockId });
    if (ok) inserted = { ...inserted, [turnId]: true };
  }
</script>

<div class="private" style="--hue: {hue}">
  <div class="scroll" bind:this={scroller}>
    <p class="limits">
      <strong>Private</strong> — {AGENT_NAME[other]} can't see this. {AGENT_NAME[agent]} can see
      the document and the shared chat, and {agent === 'ellie'
        ? "won't answer Max's question for you"
        : 'will explain what a question is asking without answering it'}. Nothing here reaches
      the document unless you put it there.
    </p>

    {#if channel.turns.length === 0 && !channel.opening}
      <p class="empty">Ask {AGENT_NAME[agent]} anything. It stays here.</p>
    {/if}

    {#each channel.turns as turn (turn.id)}
      {#if turn.role === 'learner'}
        <article class="mine" class:sending={turn.id.startsWith('local-')}>
          <header><span class="label-caps">You</span></header>
          <p>{turn.text}</p>
        </article>
      {:else}
        <article class="theirs">
          <header>
            <span class="avatar" class:ringed={agent === 'max'} aria-hidden="true">{monogram(AGENT_NAME[agent])}</span>
            <span class="label-caps name">{AGENT_NAME[agent]} · {AGENT_ROLE_WORD[agent]}</span>
            <span class="gap"></span>
            <span class="time" aria-hidden="true">{clockTime(turn.createdAt)}</span>
          </header>
          <div class="body">
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html paragraphs(turn.text)}
          </div>
          <div class="acts">
            {#if turn.insertedEditId || inserted[turn.id]}
              <span class="done">In the document ✓</span>
            {:else}
              <button
                type="button"
                class="chip"
                disabled={chat.inserting === turn.id}
                title="Puts this into the notes where your caret is. It becomes an ordinary agent edit you can remove."
                onclick={() => void insert(turn.id)}
              >{chat.inserting === turn.id ? 'Inserting…' : 'Insert into the document'}</button>
            {/if}
          </div>
        </article>
      {/if}
    {/each}

    {#if channel.thinking}
      <p class="waiting" role="status">{AGENT_NAME[agent]} is {agent === 'ellie' ? 'typing' : 'reading'}…</p>
    {/if}
  </div>

  <div class="foot">
    <MentionComposer
      placeholder={`Ask ${AGENT_NAME[agent]}, privately…`}
      disabled={channel.threadId === null}
      onsend={(text) => chat.sendPrivate(agent, text)}
    />
  </div>
</div>

<style>
  .private { display: flex; flex-direction: column; min-height: 0; height: 100%; }
  .scroll { flex: 1; overflow-y: auto; min-height: 0; padding: 10px 14px 4px; }
  .foot { flex: none; padding: 0 14px 10px; border-top: 1px solid var(--hairline); }

  /* The disclosure. Dashed, muted and at the top of the thread — the app's voice, not an
     agent's, which is why it is not a card with an avatar on it. */
  .limits {
    margin: 2px 0 12px;
    padding: 8px 10px;
    border: 1px dashed var(--hairline);
    border-radius: var(--radius);
    font-size: 11.5px;
    line-height: 1.55;
    color: var(--muted);
  }
  .limits strong { color: var(--hue); font-weight: 600; }

  .empty { margin: 16px 2px; font-size: 12.5px; color: var(--muted); }

  .mine {
    margin: 10px 0;
    padding: 8px 12px;
    background: var(--indigo-tint);
    border-right: 3px solid var(--indigo);
    border-radius: var(--radius);
  }
  .mine header { margin-bottom: 3px; }
  .mine .label-caps { color: var(--indigo); }
  .mine p { margin: 0; font-size: 13px; line-height: 1.55; white-space: pre-wrap; }
  .mine.sending { opacity: 0.58; }

  .theirs {
    margin: 10px 0;
    padding: 8px 12px 10px;
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-left: 3px solid var(--hue);
    border-radius: var(--radius);
  }
  .theirs header { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; }
  .gap { flex: 1; }
  .name { color: var(--hue); }
  .time { font-size: 10px; color: var(--muted); opacity: 0; transition: opacity 120ms ease-out; }
  .theirs:hover .time { opacity: 1; }
  .avatar {
    width: 17px; height: 17px; border-radius: 50%;
    background: var(--hue); color: #fff; font-size: 9.5px; font-weight: 600;
    display: inline-flex; align-items: center; justify-content: center; flex: none;
  }
  .avatar.ringed { background: transparent; color: var(--hue); border: 1.5px solid var(--hue); }

  .body :global(p) { margin: 0 0 8px; font-size: 13px; line-height: 1.6; }
  .body :global(p:last-child) { margin-bottom: 0; }
  .body :global(strong) { font-weight: 600; }
  .body :global(em) { font-style: italic; }
  .body :global(.katex) { font-family: inherit; font-size: 1em; }

  .acts { margin-top: 9px; }
  .chip {
    font-size: 11.5px;
    color: var(--indigo);
    background: var(--indigo-tint);
    border: 1px solid var(--indigo);
    border-radius: 999px;
    padding: 3px 12px;
  }
  .chip:disabled { color: var(--muted); background: transparent; border-color: var(--hairline); cursor: default; }
  .done { font-size: 11px; color: var(--muted); }

  .waiting { margin: 8px 2px; font-size: 11.5px; color: var(--muted); font-style: italic; }
</style>
