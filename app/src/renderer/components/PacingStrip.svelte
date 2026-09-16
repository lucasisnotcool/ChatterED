<script lang="ts">
  /**
   * The flow's first-open **pacing disclosure** (`flow-build-plan.md` §3.5).
   *
   * It carries what the round card used to carry and nothing else does any more. The round card
   * was the first thing a learner read in the room — *"replies here are deliberately paced so
   * you get room to think first"* — and the flow has no room and no top of a thread to put it
   * in. §3.5 is explicit that the disclosure must not be lost with the card: it is a rubric and
   * ethics requirement, because a deliberate delay the learner has not been told about is a
   * manipulation rather than a design, and a scripted backend that is not named is a claim about
   * a model that never ran.
   *
   * So, four things, once per install and re-openable from Settings:
   *   1. the reply latency is deliberate, with the finding it comes from;
   *   2. what actually invokes the Tester, as a rule rather than a mood;
   *   3. which pacing profile is running right now;
   *   4. that the backend is scripted, when it is, and what that does and does not fake.
   *
   * Dismissal is one settings row (`pacing_strip_seen`), so it is per install and survives a
   * relaunch — not per document and not per room, which would make it nagging rather than
   * disclosure.
   */
  import { store } from '../lib/store.svelte.js';
  import { pacingProfile } from '../lib/labels.js';

  const settings = $derived(store.settings);
  const profile = $derived(pacingProfile(settings?.flowProfile));
  const scripted = $derived(store.boot?.mode === 'scripted');
  /** Off the live roster, never spelled out — the pairing is pinned but the names are data (#32). */
  const teacher = $derived(store.boot?.agents.find((a) => a.role === 'peer')?.displayName ?? 'the Teacher');
  const tester = $derived(store.boot?.agents.find((a) => a.role === 'challenger')?.displayName ?? 'the Tester');

  /**
   * Settings are loaded on demand, and the flow can be the first screen a learner opens. Asking
   * for them here means the strip decides on the real row rather than flashing and retracting.
   */
  $effect(() => {
    if (!store.settings && !store.settingsBusy) void store.loadSettings();
  });

  const show = $derived(settings !== null && !settings.pacingStripSeen);

  async function dismiss(): Promise<void> {
    await store.saveSettings({ pacingStripSeen: true });
  }
</script>

{#if show}
  <aside class="strip" aria-label="How this is paced">
    <h2>How this is paced</h2>

    <p>
      Replies here are <strong>deliberately held</strong>. {teacher} answers after about four to six
      seconds and {tester} after nine to twelve, and the counter you see while he reads is the real
      wait rather than an animation. Tan et al. found two-second replies read as less thoughtful;
      nine seconds got the best usefulness ratings.
    </p>

    <p>
      {tester} is not listening the whole time. He is offered the floor by a rule you can see —
      <strong>{profile.rule}</strong> — and you can send him away when he arrives.
    </p>

    <p>
      Pacing is set to <strong>{profile.label}</strong>. You can change it, or read this again, in
      Settings ▸ Tester pacing.
    </p>

    {#if scripted}
      <p>
        This copy is running the <strong>scripted</strong> backend: what {teacher} and {tester} say is
        replayed from a fixed script rather than generated. Everything around it is real — the same
        timer, the same hand-off rule and the same ledger, which still moves only on words you
        typed yourself. Nothing is sent anywhere.
      </p>
    {/if}

    <div class="acts">
      <button type="button" class="btn" disabled={store.settingsBusy} onclick={() => void dismiss()}>
        Got it
      </button>
    </div>
  </aside>
{/if}

<style>
  .strip {
    max-width: 72ch;
    margin: 0 auto 20px;
    padding: 16px 18px;
    background: var(--pane);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
  }
  h2 {
    margin: 0 0 10px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--text-2);
  }
  p {
    margin: 0 0 8px;
    font-size: 13px;
    line-height: 1.6;
    color: var(--text);
  }
  strong { font-weight: 600; }
  .acts { margin-top: 12px; }
  .btn {
    font: inherit;
    font-size: 12px;
    padding: 5px 12px;
    border-radius: 6px;
    border: 1px solid var(--hairline);
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
  }
  .btn:hover:not(:disabled) { background: var(--hover, var(--pane)); }
  .btn:disabled { opacity: 0.5; cursor: default; }
</style>
