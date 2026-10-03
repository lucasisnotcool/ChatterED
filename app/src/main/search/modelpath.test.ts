import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODEL_FILES, MODEL_REPO, MODEL_REVISION, resolveModelDir } from './modelpath.js';

describe('resolveModelDir', () => {
  it('reads the bundled copy from Resources in a packaged app', () => {
    expect(
      resolveModelDir({ packaged: true, resourcesPath: '/Applications/ChatterED.app/Contents/Resources', appPath: '/x' }),
    ).toBe('/Applications/ChatterED.app/Contents/Resources/models/embeddinggemma-300m');
  });

  it('reads app/models under npm run dev', () => {
    expect(resolveModelDir({ packaged: false, resourcesPath: '/electron/Resources', appPath: '/repo/app' })).toBe(
      '/repo/app/models/embeddinggemma-300m',
    );
  });
});

describe('the pinned model', () => {
  // scripts/fetch-model.mjs is plain Node and cannot import this module, so the two copies of
  // the pin are checked against each other here.
  const script = readFileSync(join(__dirname, '../../../scripts/fetch-model.mjs'), 'utf8');

  it('is the same repo and revision as scripts/fetch-model.mjs downloads', () => {
    expect(MODEL_REVISION).toMatch(/^[0-9a-f]{40}$/);
    expect(script).toContain(`'${MODEL_REPO}'`);
    expect(script).toContain(`'${MODEL_REVISION}'`);
  });

  it('every file the embedder needs is one the script fetches', () => {
    for (const f of MODEL_FILES) expect(script).toContain(`'${f}'`);
  });
});
