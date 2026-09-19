<script lang="ts">
  /**
   * **The number a course-wide deployment is budgeted from** (#42 item B's totals, one level up).
   *
   * Mean *and* median, and they are deliberately of different things: the mean is over **learner
   * messages**, which is the denominator a "what would 200 students cost" estimate divides by and
   * which must include the setup, because a student who opens a deck pays for it. The median is
   * over **agent replies**, the distribution that has a middle worth quoting.
   *
   * Four tiles rather than two, because tokens lead here as everywhere: the dollar figure is rate
   * card arithmetic and the token figure is the fact behind it.
   */
  import { tokensLabel, usdWithLabel } from '../../lib/cost.js';
  import { PER_MESSAGE_NOTE } from '../../lib/usageview.js';
  import type { CostMode, CostPerMessageStats } from '../../../shared/cost.js';
  import Stat from './Stat.svelte';

  let { stats, mode }: { stats: CostPerMessageStats; mode: CostMode } = $props();
</script>

<div class="tiles">
  <Stat
    label="Mean per learner message"
    value={`${tokensLabel(stats.meanTokensPerLearnerMessage)} tokens`}
    sub={usdWithLabel(stats.meanUsdPerLearnerMessage, mode)}
  />
  <Stat
    label="Median per agent reply"
    value={`${tokensLabel(stats.medianTokensPerAgentMessage)} tokens`}
    sub={usdWithLabel(stats.medianUsdPerAgentMessage, mode)}
  />
</div>

<p class="counts">
  {stats.learnerMessages.toLocaleString('en-US')} learner
  {stats.learnerMessages === 1 ? 'message' : 'messages'} ·
  {stats.agentMessages.toLocaleString('en-US')} model-written
  {stats.agentMessages === 1 ? 'reply' : 'replies'} in this range.
</p>
<p class="note">{PER_MESSAGE_NOTE}</p>

<style>
  .tiles { display: flex; gap: 12px 36px; flex-wrap: wrap; }
  .counts { margin: 14px 0 0; font-size: 11.5px; color: var(--text-2); }
  .note { margin: 6px 0 0; font-size: 11px; line-height: 1.6; color: var(--text-2); }
</style>
