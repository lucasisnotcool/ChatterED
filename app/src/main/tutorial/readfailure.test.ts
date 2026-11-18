/**
 * What the learner reads when a sheet's read stops (`ingest.ts` `readFailure`; the acceptance
 * test's cases, 2026-11-19): a true, plain sentence, never the CLI's exit line or an SDK's JSON.
 */
import { describe, expect, it } from 'vitest';
import { CliExitError, cliFailureKind } from '../llm/claude-cli.js';
import { readFailure } from './ingest.js';

const cli = (detail: string, tag: string | null) => new CliExitError(1, detail, cliFailureKind(detail, tag), true);

describe('why a read stopped, in a sentence', () => {
  it.each([
    ['the CLI cannot reach the network', cli('API Error: Connection refused — a firewall or proxy may be blocking it (ECONNREFUSED)', 'server_error'), /^Couldn't finish reading this sheet: the connection to Claude was refused\. Retry in a minute; the pages already read are kept\.$/],
    ['the CLI is signed out', cli('API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth token has expired"}}', 'authentication_failed'), /^Claude Code is signed out\. Open Terminal and run claude/],
    ['the CLI is at its limit', cli("You've hit your limit · resets 3pm", 'rate_limit'), /^Your Claude usage limit is reached for now \(it resets 3pm\)\./],
    ['the CLI is not installed', Object.assign(new Error('spawn /Users/x/.local/bin/claude ENOENT'), { code: 'ENOENT' }), /^Claude Code isn't installed on this Mac/],
    ['the API rate limits', Object.assign(new Error('429 {"type":"error","error":{"type":"rate_limit_error"}}'), { status: 429 }), /^Couldn't finish reading this sheet: Claude is limiting how fast this key can ask\./],
    ['the API refuses the request', Object.assign(new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long"}}'), { status: 400 }), /^Claude couldn't accept this request \(error 400\)\./],
    ['something else', cli('Something odd {"x":1}', null), /^Couldn't read this sheet \(Something odd\)\. Retry to try again\.$/],
  ])('when %s', (_what, err, sentence) => {
    const said = readFailure(err);
    expect(said).toMatch(sentence);
    expect(said).not.toMatch(/exited 1|\{"/);
  });
});
