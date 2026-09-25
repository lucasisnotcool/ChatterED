<script lang="ts">
  /**
   * The trial notice's body, drawn from `shared/trial.ts` — the one place the wording lives. Used
   * by the consent screen and by the notice the "Experimental trial" label re-opens.
   */
  import { NOTICE_INTRO, NOTICE_SECTIONS } from '../../shared/trial.js';
</script>

<div class="notice">
  <p class="intro">{NOTICE_INTRO}</p>
  {#each NOTICE_SECTIONS as section (section.heading)}
    <h3>{section.heading}</h3>
    {#each section.paragraphs ?? [] as para, i (i)}
      <p>{para}</p>
    {/each}
    {#if section.bullets?.length}
      <ul>
        {#each section.bullets as bullet, i (i)}
          <li>{bullet}</li>
        {/each}
      </ul>
    {/if}
  {/each}
</div>

<style>
  .notice { font-size: 13px; line-height: 1.65; color: var(--text); }
  .intro { margin: 0 0 14px; }
  h3 { margin: 16px 0 4px; font-size: 12px; font-weight: 600; letter-spacing: 0.02em; }
  p { margin: 0 0 8px; }
  ul { margin: 0 0 8px; padding-left: 20px; }
  li { margin: 2px 0; }
</style>
