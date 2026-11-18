/**
 * **What a build carries about itself**, baked at compile time by `scripts/copy-assets.mjs` into
 * `dist/main/update/baked.json` (inside app.asar, so the asar integrity fuse covers it):
 *
 *  - `build` and `sha`: the build number `tools/release.sh` allocated and the git commit;
 *  - `channel`: the update channel, or null (`install-local.sh` and plain `npm run build`: no updates);
 *  - `keys`: the trusted public keys, from `app/build/update-keys/{active,cold}.pub.pem`;
 *  - `manifestUrls`: where the channel's manifest is;
 *  - `test`: set only by a test build (`CHATTERED_UPDATE_TEST_BUILD=1`, never by a release):
 *    http allowed and the helper's tools replaceable. A release refuses to publish a build that has it.
 *
 * Nothing here can be changed at run time: no environment variable or setting swaps a key or a URL.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_ID, type TrustedKey } from './manifest.js';
import type { Fault } from './runtime.js';

const FAULTS: readonly Fault[] = [
  'crash-at-launch',
  'crash-at-launch-live',
  'fail-migration',
  'fail-migration-live',
  'hang-boot',
  'hang-boot-live',
  'never-healthy-live',
];

export const RELEASES_REPO = 'lucasisnotcool/ChatterED-releases';
/** The fixed per-channel tag whose manifest assets are replaced on each publish. */
export function channelTag(channel: string): string {
  return `${channel}-channel`;
}
export function manifestUrl(channel: string): string {
  return `https://github.com/${RELEASES_REPO}/releases/download/${channelTag(channel)}/${channel}-manifest-v1.json`;
}

export interface Baked {
  /** `sg.nus.chattered`, or `sg.nus.chattered.test` for the test variant. */
  appId: string;
  /** `ChatterED`, or `ChatterED Test`. */
  productName: string;
  /** `production` or `test`. Only `test` may set `test`, http URLs and a fault. */
  variant: 'production' | 'test';
  /** Test variant only: a deliberate fault (`runtime.ts`), for the E2E campaign's bad releases. */
  fault: Fault | null;
  build: number;
  sha: string;
  channel: string | null;
  keys: TrustedKey[];
  manifestUrls: string[];
  test: boolean;
}

export const NOT_BAKED: Baked = { appId: APP_ID, productName: 'ChatterED', variant: 'production', fault: null, build: 0, sha: 'unknown', channel: null, keys: [], manifestUrls: [], test: false };

export function parseBaked(text: string): Baked {
  try {
    const b = JSON.parse(text) as Partial<Baked>;
    const keys = Array.isArray(b.keys)
      ? b.keys.filter((k): k is TrustedKey => !!k && typeof k.pem === 'string' && typeof k.id === 'string' && (k.role === 'active' || k.role === 'cold'))
      : [];
    const channel = typeof b.channel === 'string' && /^[a-z0-9-]{1,32}$/.test(b.channel) ? b.channel : null;
    const variant = b.variant === 'test' ? 'test' : 'production';
    const test = variant === 'test' && b.test === true;
    // A production build reads only https URLs, whatever the file says.
    const urls = Array.isArray(b.manifestUrls)
      ? b.manifestUrls.filter((u): u is string => typeof u === 'string' && (test || u.startsWith('https://')))
      : [];
    const appId = variant === 'test' ? `${APP_ID}.test` : APP_ID;
    return {
      appId,
      productName: variant === 'test' ? 'ChatterED Test' : 'ChatterED',
      variant,
      fault: test && FAULTS.includes(b.fault as Fault) ? (b.fault as Fault) : null,
      build: Number.isInteger(b.build) ? (b.build as number) : 0,
      sha: typeof b.sha === 'string' ? b.sha.slice(0, 40) : 'unknown',
      channel,
      keys,
      manifestUrls: urls.length ? urls : channel ? [manifestUrl(channel)] : [],
      test,
    };
  } catch {
    return NOT_BAKED;
  }
}

export function readBaked(dir: string): Baked {
  try {
    return parseBaked(readFileSync(join(dir, 'baked.json'), 'utf8'));
  } catch {
    return NOT_BAKED;
  }
}
