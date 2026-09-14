<script lang="ts">
  /**
   * Images (issue #22 decision 3). The bytes arrive over IPC, so they become an object URL here
   * rather than a file:// path: the renderer never learns where the file is, and the CSP only
   * has to allow `blob:` for images.
   */
  let { bytes, ext, name }: { bytes: Uint8Array; ext: string; name: string } = $props();

  const MIME: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    avif: 'image/avif',
    // SVG is served as an image, never inlined into the DOM: an <img> cannot run its scripts.
    svg: 'image/svg+xml',
  };

  let url = $state('');
  let zoom = $state(1);

  $effect(() => {
    const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: MIME[ext] ?? 'application/octet-stream' });
    const made = URL.createObjectURL(blob);
    url = made;
    return () => URL.revokeObjectURL(made);
  });
</script>

<div class="wrap">
  <div class="bar">
    <button type="button" class="step" onclick={() => (zoom = Math.max(0.25, zoom / 1.25))} aria-label="Zoom out">⊟</button>
    <span class="pct">{Math.round(zoom * 100)}%</span>
    <button type="button" class="step" onclick={() => (zoom = Math.min(8, zoom * 1.25))} aria-label="Zoom in">⊞</button>
    <button type="button" class="step wide" onclick={() => (zoom = 1)}>Fit</button>
  </div>
  <div class="stage">
    {#if url}
      <img src={url} alt={name} style="width: {zoom === 1 ? 'auto' : `${zoom * 100}%`}" class:fit={zoom === 1} />
    {/if}
  </div>
</div>

<style>
  .wrap { display: flex; flex-direction: column; min-height: 0; height: 100%; }
  .bar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--hairline);
  }
  .step { padding: 3px 7px; border-radius: 5px; font-size: 12px; color: var(--text-2); }
  .step.wide { font-size: 11px; }
  .step:hover { background: var(--ground); color: var(--text); }
  .pct { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }

  .stage { flex: 1; overflow: auto; min-height: 0; background: #ecedf2; display: flex; padding: 16px; }
  img { margin: auto; display: block; box-shadow: 0 1px 4px rgba(27, 27, 34, 0.16); background: #fff; }
  img.fit { max-width: 100%; max-height: 100%; object-fit: contain; }
</style>
