// Capture per-turn metadata (times, models, prompts, file names) for the Perplexity
// threads in the survey CSV, via a *headed* Chrome (Cloudflare blocks headless).
// The thread API response is reduced to an allowlist in memory, the same one as
// sanitise_perplexity.py. Account fields and pre-signed S3 URLs never touch disk.
//
//   node scripts/fetch_perplexity.cjs     (from docs/research/ai-use-transcripts/)
//
// Needs playwright-core. Any local install works: set PLAYWRIGHT_CORE=/path/to/playwright-core.
// Writes raw/r3-perplexity/thread-meta.json and raw/r4-perplexity/thread-meta.json,
// in CSV order. The answer text comes from the thread's "Export → Markdown" (export.md).
const fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const fname = u => { try { return new URL(u).pathname.split('/').pop(); } catch { return u; } };
const sanitise = d => ({ turns: (d.entries || []).map(e => ({
  created: e.entry_created_datetime, model: e.display_model, user_selected_model: e.user_selected_model,
  mode: e.mode, prompt: e.query_str, attachments: (e.attachments || []).map(fname),
  sources: (e.blocks || []).flatMap(b => ((b.web_result_block || {}).web_results || []).map(w => w.name || fname(w.url))),
})) });

(async () => {
  const rows = fs.readFileSync('raw/survey/form-responses-1.csv', 'utf8').split('\n');
  const ids = rows.map(r => (r.match(/perplexity\.ai\/search\/([0-9a-f-]{36})/) || [])[1]).filter(Boolean);
  const dirs = ['raw/r3-perplexity', 'raw/r4-perplexity'];
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync('/tmp/pplx-'), {
    headless: false, channel: 'chrome', args: ['--disable-blink-features=AutomationControlled'] });
  const page = ctx.pages()[0] || await ctx.newPage();
  for (const [k, id] of ids.entries()) {
    let meta = null;
    page.removeAllListeners('response');
    page.on('response', async r => {
      if (!r.url().includes('/rest/thread/')) return;
      try { const d = JSON.parse(await r.text()); if (d.entries) meta = sanitise(d); } catch {}
    });
    await page.goto('https://www.perplexity.ai/search/' + id, { waitUntil: 'domcontentloaded', timeout: 60000 });
    for (let i = 0; i < 40 && !meta; i++) await page.waitForTimeout(1500);
    if (!meta) { console.error(`no thread data for ${dirs[k]}`); continue; }
    fs.writeFileSync(`${dirs[k]}/thread-meta.json`, JSON.stringify(meta, null, 1));
    console.log(dirs[k], meta.turns.length, 'turns');
  }
  await ctx.close();
})().catch(e => { console.error(e); process.exit(1); });
