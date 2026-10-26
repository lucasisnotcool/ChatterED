<script lang="ts">
  /**
   * The chat column's composer (#48, §4.2 and §4.4).
   *
   * Two things beyond a textarea, and both are rules made visible rather than hidden:
   *
   *  1. **`@Ellie` / `@Max`.** Typing `@` offers the two of them; a recognised mention is drawn
   *     as a coloured token, and the line under the box says what naming someone *does* — that
   *     agent only, and no follow-up (`rule:mention`). The highlighting runs on
   *     `shared/doc/mention.ts`, the same function the actor decides with, so the token cannot
   *     say one thing and the room do another.
   *  2. **Max's open question.** The placeholder becomes *Your answer…*, **Pass** appears, and
   *     the quiet line says that saying "I don't know" is a way out that works (§4.4). The
   *     learner is told before they are stuck, because a give-up that releases the answer and
   *     lowers the next question is a design decision they should be able to use on purpose.
   *
   * The token layer is a mirror of the textarea's text under a transparent textarea — the way
   * every editor with inline highlighting does it. The two share a font, a padding and a
   * line-height, and the mirror is `aria-hidden`: the textarea is still the real control, so
   * selection, undo, IME and a screen reader all behave exactly as they would in a plain box.
   */
  import { AGENT_HUE, AGENT_NAME, mentionMatches, mentionPieces, mentionQuery, parseMention } from '../../lib/chatview.js';
  import type { AgentAuthor } from '../../../shared/doc/types.js';
  import { noteDraft } from '../../lib/quiethelp.js';

  let {
    placeholder,
    note = null,
    /** §4.4's control, shown only while a question is open and unreleased. */
    pass = false,
    /** Max has offered the answer (D3, 2026-10-06): Pass reads *Show me*, emphasised. Same handler. */
    showMe = false,
    passing = false,
    busy = false,
    disabled = false,
    autofocus = false,
    onsend,
    onpass,
    oncancel,
    /** What the Esc key and the cancel affordance are called, when there is one. */
    cancelLabel = null,
  }: {
    placeholder: string;
    note?: string | null;
    pass?: boolean;
    showMe?: boolean;
    passing?: boolean;
    busy?: boolean;
    disabled?: boolean;
    autofocus?: boolean;
    onsend: (text: string) => void;
    onpass?: () => void;
    oncancel?: () => void;
    cancelLabel?: string | null;
  } = $props();

  let text = $state('');
  let box = $state<HTMLTextAreaElement | null>(null);
  let caret = $state(0);
  /** The `@` menu: open only while the caret is inside a half-typed mention. */
  let menuIndex = $state(0);

  const pieces = $derived(mentionPieces(text));
  const query = $derived(mentionQuery(text, caret));
  const options = $derived(query ? mentionMatches(query.query) : []);
  const menuOpen = $derived(options.length > 0);
  const mention = $derived(parseMention(text));

  $effect(() => {
    if (autofocus && box) box.focus();
  });

  /**
   * **Text here is not quiet** (decision 7, 6 Oct): while this box has text, the open question's
   * clock in the rail does not count towards offering Hint and Show me (`quiethelp.ts`).
   */
  const draftSource = `composer:${globalThis.crypto.randomUUID()}`;
  $effect(() => {
    noteDraft(draftSource, text.trim().length > 0);
    return () => noteDraft(draftSource, false);
  });

  function sync(e: Event): void {
    const el = e.currentTarget as HTMLTextAreaElement;
    caret = el.selectionStart ?? el.value.length;
    menuIndex = 0;
  }

  function choose(agent: AgentAuthor): void {
    const q = query;
    if (!q) return;
    const before = text.slice(0, q.from);
    const after = text.slice(caret);
    const inserted = `@${AGENT_NAME[agent]} `;
    text = `${before}${inserted}${after}`;
    const at = q.from + inserted.length;
    queueMicrotask(() => {
      box?.focus();
      box?.setSelectionRange(at, at);
      caret = at;
    });
  }

  function submit(): void {
    const body = text.trim();
    if (body.length === 0 || busy || disabled) return;
    onsend(body);
    text = '';
    caret = 0;
    box?.focus();
  }

  function onkeydown(e: KeyboardEvent): void {
    // The composer owns its own keys: ⌘K, Ctrl+E and the shell's shortcuts must not fire while
    // the learner is writing a sentence that contains those letters.
    e.stopPropagation();
    if (menuOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        menuIndex = (menuIndex + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length;
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        choose(options[menuIndex]!);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        caret = -1;
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === 'Escape' && oncancel) {
      e.preventDefault();
      oncancel();
    }
  }
</script>

<div class="composer">
  <p class="destination">{placeholder}</p>
  <div class="field">
    <!-- The token mirror. Purely decorative: it repeats what the textarea holds, in the same
         metrics, so the coloured `@Max` sits exactly under the characters it is about. -->
    <div class="mirror" aria-hidden="true">
      {#each pieces as piece, i (i)}
        {#if piece.kind === 'mention'}
          <span class="token" style="--hue: {AGENT_HUE[piece.agent]}">{piece.text}</span>
        {:else}
          <span>{piece.text}</span>
        {/if}
      {/each}
      <!-- A trailing newline collapses in a block box; this keeps the mirror as tall as the box. -->
      <span>&#8203;</span>
    </div>

    <textarea
      bind:this={box}
      bind:value={text}
      rows="3"
      placeholder="Type a message…"
      {disabled}
      aria-label={placeholder}
      onkeydown={onkeydown}
      oninput={sync}
      onclick={sync}
      onkeyup={sync}
      onblur={() => (caret = -1)}
    ></textarea>
    <button type="button" class="send" aria-label={busy ? 'Sending message' : 'Send message'} title="Send message" disabled={text.trim().length === 0 || busy || disabled} onclick={submit}>
      <span aria-hidden="true">➤</span><span class="sr-only">{busy ? 'Sending…' : 'Send'}</span>
    </button>

    {#if menuOpen}
      <ul class="menu" role="listbox" aria-label="Who to ask">
        {#each options as agent, i (agent)}
          <li>
            <button
              type="button"
              class="option"
              class:on={i === menuIndex}
              role="option"
              aria-selected={i === menuIndex}
              onmousedown={(e) => {
                e.preventDefault();
                choose(agent);
              }}
            >
              <span class="dot" style="background: {AGENT_HUE[agent]}" aria-hidden="true"></span>
              <span class="who">{AGENT_NAME[agent]}</span>
              <span class="what">{agent === 'ellie' ? 'answers, and nobody follows up' : 'asks you one, directly'}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  {#if note}
    <!-- The rule, stated before it bites. Italic and muted, like every other line in which the
         app says what it will and will not do — a different voice from anything an agent says. -->
    <p class="note">{note}</p>
  {:else if mention}
    <p class="note">
      {AGENT_NAME[mention.agent]} only — no follow-up from the other one.
    </p>
  {/if}

  <div class="foot">
    <span class="hint">
      Enter sends · ⇧Enter newline{cancelLabel ? ` · Esc ${cancelLabel}` : ''}
    </span>
    <span class="gap"></span>
    {#if pass}
      <!-- No confirm. The learner has decided, and asking "are you sure?" of a decision §4.4
           hands them on purpose is the app second-guessing its own design. -->
      <!-- Show me (D3): the same release, offered by Max once smaller questions have run out, so
           it is the emphasised way on rather than the quiet way out. -->
      <button
        type="button"
        class="ctrl"
        class:show-me={showMe}
        disabled={passing}
        title={showMe
          ? 'Max shows you the answer. It fills nothing on your progress.'
          : 'Max gives the full answer. It fills nothing on your progress, and the next question on this will be smaller.'}
        onclick={() => onpass?.()}
      >{passing ? (showMe ? 'Showing…' : 'Passing…') : showMe ? 'Show me' : 'Pass'}</button>
    {/if}
  </div>
</div>

<style>
  .composer { margin: 8px 0 2px; }
  .destination { margin: 0 0 5px; color: var(--text-2); font-size: 11px; }
  .field { position: relative; }

  /* The two layers share every metric that affects where a character lands. */
  .mirror, textarea {
    font: inherit;
    font-size: 13px;
    line-height: 1.55;
    padding: 9px 42px 9px 11px;
    border: 1px solid transparent;
    border-radius: var(--radius);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .mirror {
    position: absolute;
    inset: 0;
    color: transparent;
    pointer-events: none;
    overflow: hidden;
  }
  .token {
    color: var(--hue);
    background: color-mix(in srgb, var(--hue) 11%, transparent);
    border-radius: 4px;
    font-weight: 600;
  }

  textarea {
    position: relative;
    width: 100%;
    resize: none;
    background: transparent;
    border-color: var(--hairline);
    /* Over the mirror, with the text itself visible: the token's tint shows through. */
    background-color: transparent;
  }
  .field::before {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--pane);
    border-radius: var(--radius);
  }
  textarea::placeholder { color: var(--muted); }
  textarea:focus { border-color: var(--indigo); outline: none; }
  textarea:disabled { color: var(--muted); }

  .menu {
    position: absolute;
    left: 6px;
    bottom: calc(100% + 4px);
    z-index: 5;
    margin: 0;
    padding: 4px;
    list-style: none;
    min-width: 260px;
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    box-shadow: 0 6px 20px rgb(27 27 34 / 12%);
  }
  .option {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    padding: 5px 8px;
    border-radius: 5px;
    text-align: left;
  }
  .option.on, .option:hover { background: var(--ground); }
  .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
  .who { font-size: 12.5px; font-weight: 600; }
  .what { font-size: 11px; color: var(--muted); }

  .note {
    margin: 6px 0 0;
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--muted);
    font-style: italic;
  }

  .foot { display: flex; align-items: center; gap: 10px; margin-top: 7px; }
  .gap { flex: 1; }
  .hint { font-size: 10.5px; color: var(--muted); }
  .ctrl {
    font-size: 11px;
    color: var(--text-2);
    border: 1px solid var(--hairline);
    border-radius: 5px;
    padding: 2px 10px;
  }
  .ctrl:hover:not(:disabled) { border-color: var(--challenger); color: var(--challenger); }
  .ctrl:disabled { color: var(--muted); cursor: default; }
  .ctrl.show-me {
    color: var(--challenger);
    border-color: var(--challenger);
    font-weight: 600;
    padding: 3px 12px;
  }
  .ctrl.show-me:hover:not(:disabled) { background: color-mix(in srgb, var(--challenger) 10%, transparent); }
  .ctrl.show-me:disabled { color: var(--muted); border-color: var(--hairline); }
  .send {
    position: absolute;
    z-index: 2;
    right: 9px;
    bottom: 10px;
    width: 29px;
    height: 29px;
    display: grid;
    place-items: center;
    font-size: 14px;
    color: var(--text);
    background: var(--studio-accent);
    border-radius: 50%;
  }
  .send:disabled { background: var(--hairline); color: var(--text-2); cursor: default; }
</style>
