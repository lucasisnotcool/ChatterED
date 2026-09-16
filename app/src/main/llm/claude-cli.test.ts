/**
 * The Claude CLI backend, tested against a **fake `claude` binary** — a shell script on a temp
 * PATH that prints canned stream-json. No network call, no real model call, no login required,
 * which is the same rule every other test in this repo follows.
 *
 * What is worth testing here is not "does Claude answer" but "does this client survive the
 * five ways a local subprocess goes wrong": it is not on the PATH, it is there but not logged
 * in, it exits non-zero, it prints something that is not JSON, and it never returns at all.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import {
  buildPath,
  ClaudeCliClient,
  ClaudeCliNotLoggedInError,
  flattenMessages,
  looksNotLoggedIn,
  modelFromResultForTest,
  normaliseCliUsage,
  OWN_TURN_PREFIX,
  promptFor,
  resolveClaudeBinary,
  systemTextFor,
} from './claude-cli.js';
import { readProbe } from './detect.js';
import { AnthropicClient } from '../../room/llm/anthropic.js';
import type { LlmRequest } from '../../room/llm/types.js';

let root: string;
let binDir: string;
let fakeClaude: string;

/**
 * One script, several behaviours, chosen by `FAKE_MODE` in the child's environment — which is
 * also a test that the client passes its `env` through to the child at all.
 */
const FAKE = String.raw`#!/bin/sh
CAPTURE="$FAKE_CAPTURE"
[ -z "$CAPTURE" ] && CAPTURE=/dev/null
{ echo "ARGS:$*"; echo "PATH:$PATH"; } >> "$CAPTURE"
STDIN=$(cat)
printf 'STDIN_BEGIN\n%s\nSTDIN_END\n' "$STDIN" >> "$CAPTURE"

MODE="$FAKE_MODE"
[ -z "$MODE" ] && MODE=ok
case "$MODE" in
  ok)
    echo '{"type":"system","subtype":"init","model":"claude-sonnet-5-20260301","tools":[]}'
    echo '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}}'
    echo 'a stray line the CLI printed that is not JSON at all'
    echo '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" there"}}}'
    echo '{"type":"result","subtype":"success","is_error":false,"result":"Hello there","ttft_ms":42,"total_cost_usd":0.0031,"usage":{"input_tokens":11,"output_tokens":5,"cache_read_input_tokens":7,"cache_creation_input_tokens":3},"modelUsage":{"claude-sonnet-5-20260301":{"costUSD":0.0031}}}'
    ;;
  notloggedin)
    echo 'Not logged in. Run claude to log in.' >&2
    exit 1
    ;;
  fail)
    echo 'something went wrong deep inside' >&2
    exit 3
    ;;
  garbage)
    echo 'this is not json'
    echo '{"type":"stream_event","event":{"type":"content_block_delta"'
    ;;
  iserror)
    echo '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"the model refused","usage":{}}'
    ;;
  schema)
    echo '{"type":"result","subtype":"success","is_error":false,"result":"{\"speak\":true,\"role\":\"peer\"}","usage":{"input_tokens":3,"output_tokens":4,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}'
    ;;
  repair)
    COUNT_FILE="$FAKE_COUNT"
    N=$(cat "$COUNT_FILE" 2>/dev/null || echo 0)
    N=$((N + 1))
    echo "$N" > "$COUNT_FILE"
    if [ "$N" = "1" ]; then
      echo '{"type":"result","subtype":"success","is_error":false,"result":"Sure! Here is the object: not-json","usage":{}}'
    else
      echo '{"type":"result","subtype":"success","is_error":false,"result":"{\"speak\":false}","usage":{}}'
    fi
    ;;
  hang)
    sleep 30
    ;;
esac
exit 0
`;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'chattered-cli-'));
  binDir = join(root, 'home', '.local', 'bin');
  mkdirSync(binDir, { recursive: true });
  fakeClaude = join(binDir, 'claude');
  writeFileSync(fakeClaude, FAKE, 'utf8');
  chmodSync(fakeClaude, 0o755);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function capture(): string {
  const file = join(root, `capture-${Math.random().toString(36).slice(2)}.txt`);
  writeFileSync(file, '', 'utf8');
  return file;
}

function client(mode: string, extra: Record<string, string> = {}, timeoutMs = 10_000): ClaudeCliClient {
  return new ClaudeCliClient({
    binary: fakeClaude,
    timeoutMs,
    cwd: root,
    env: { ...process.env, FAKE_MODE: mode, ...extra },
  });
}

function request(overrides: Partial<LlmRequest> = {}): LlmRequest {
  return {
    model: 'sonnet',
    max_tokens: 400,
    system: [
      { type: 'text', text: 'SHARED BLOCK', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'ROLE BLOCK' },
    ],
    messages: [{ role: 'user', content: 'Student: a PSD Hessian means convex.' }],
    meta: { scope: 'group' },
    ...overrides,
  };
}

describe('PATH and binary resolution', () => {
  it('puts the explicit directories first, because Finder-launched apps get launchd PATH', () => {
    const path = buildPath({ HOME: '/Users/x', PATH: '/somewhere/else' });
    expect(path.split(':').slice(0, 3)).toEqual(['/opt/homebrew/bin', '/usr/local/bin', '/Users/x/.local/bin']);
    expect(path.split(':')).toContain('/somewhere/else');
  });

  it('deduplicates, so a PATH that already lists ~/.local/bin does not list it twice', () => {
    const dirs = buildPath({ HOME: '/Users/x', PATH: '/Users/x/.local/bin:/usr/bin' }).split(':');
    expect(dirs.filter((d) => d === '/Users/x/.local/bin')).toHaveLength(1);
  });

  it('finds ~/.local/bin/claude even when PATH is empty', () => {
    expect(resolveClaudeBinary({ env: { HOME: join(root, 'home'), PATH: '' } })).toBe(fakeClaude);
  });

  it('finds claude on the PATH when it is not in ~/.local/bin', () => {
    expect(resolveClaudeBinary({ env: { HOME: '/nonexistent', PATH: binDir } })).toBe(fakeClaude);
  });

  it('prefers the Settings override', () => {
    expect(resolveClaudeBinary({ override: fakeClaude, env: { HOME: '/nonexistent', PATH: '' } })).toBe(fakeClaude);
  });

  it('reports a bad override as "no binary" rather than silently searching on', () => {
    expect(resolveClaudeBinary({ override: join(root, 'nope'), env: { HOME: join(root, 'home'), PATH: binDir } })).toBeNull();
  });

  it('returns null when there is nothing to find', () => {
    expect(resolveClaudeBinary({ env: { HOME: '/nonexistent', PATH: '/nonexistent' } })).toBeNull();
  });
});

describe('a successful turn', () => {
  it('streams deltas, returns the text, the model, the usage and a real TTFT', async () => {
    const deltas: string[] = [];
    const result = await client('ok').complete(request(), (d) => deltas.push(d));

    expect(deltas).toEqual(['Hello', ' there']);
    expect(result.text).toBe('Hello there');
    expect(result.model).toBe('claude-sonnet-5-20260301');
    expect(result.backend).toBe('claude-cli');
    expect(result.usage).toEqual({
      input_tokens: 11,
      output_tokens: 5,
      cache_read_input_tokens: 7,
      cache_creation_input_tokens: 3,
    });
    expect(result.ttftMs).toBeGreaterThanOrEqual(0);
    expect(result.costUsd).toBeCloseTo(0.0031);
  });

  it('builds the verified command line, with --verbose and without --bare', async () => {
    const file = capture();
    await client('ok', { FAKE_CAPTURE: file }).complete(request());
    const args = readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith('ARGS:'))!;

    expect(args).toContain('-p');
    expect(args).toContain('--model sonnet');
    expect(args).toContain('--output-format stream-json');
    expect(args).toContain('--include-partial-messages');
    // `-p` + stream-json exits 1 without it. Verified against Claude Code 2.1.259.
    expect(args).toContain('--verbose');
    expect(args).toContain('--no-session-persistence');
    expect(args).toContain('--system-prompt');
    // --bare makes auth strictly ANTHROPIC_API_KEY and breaks the subscription login.
    expect(args).not.toContain('--bare');
  });

  it('sends the prompt on stdin, never in argv', async () => {
    const file = capture();
    const body = 'Student: ' + 'x'.repeat(5000);
    await client('ok', { FAKE_CAPTURE: file }).complete(request({ messages: [{ role: 'user', content: body }] }));
    const captured = readFileSync(file, 'utf8');

    expect(captured).toContain('STDIN_BEGIN');
    expect(captured.split('STDIN_BEGIN\n')[1]!.split('\nSTDIN_END')[0]).toBe(body);
    expect(captured.split('\n').find((l) => l.startsWith('ARGS:'))).not.toContain('xxxxxxxxxx');
  });

  it('hands the child an explicit PATH', async () => {
    const file = capture();
    await client('ok', { FAKE_CAPTURE: file }).complete(request());
    const path = readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith('PATH:'))!;
    expect(path).toContain('/opt/homebrew/bin');
    expect(path).toContain('/usr/local/bin');
  });
});

describe('the five ways a local subprocess goes wrong', () => {
  it('"Not logged in" comes back as its own error, so the UI can show the Terminal hint', async () => {
    await expect(client('notloggedin').complete(request())).rejects.toBeInstanceOf(ClaudeCliNotLoggedInError);
  });

  it('a non-zero exit carries the exit code and the stderr', async () => {
    await expect(client('fail').complete(request())).rejects.toThrow(/exited 3.*something went wrong/s);
  });

  it('output with no parseable result event is an error, not a silent empty turn', async () => {
    await expect(client('garbage').complete(request())).rejects.toThrow(/no parseable result/);
  });

  it('an is_error result is an error even though the process exited 0', async () => {
    await expect(client('iserror').complete(request())).rejects.toThrow(/the model refused/);
  });

  it('a CLI that never returns is killed at the timeout', async () => {
    await expect(client('hang', {}, 300).complete(request())).rejects.toThrow(/did not answer within/);
  });

  it('a missing binary is reported, not thrown as ENOENT', async () => {
    const missing = new ClaudeCliClient({ binary: join(root, 'definitely-not-here'), cwd: root });
    await expect(missing.complete(request())).rejects.toThrow(/not found/i);
  });
});

describe('structured output', () => {
  const schema = { type: 'object', properties: { speak: { type: 'boolean' } }, required: ['speak'] };

  it('passes --json-schema and returns the object as text the caller can JSON.parse', async () => {
    const file = capture();
    const result = await client('schema', { FAKE_CAPTURE: file }).complete(request({ jsonSchema: schema }));
    expect(readFileSync(file, 'utf8')).toContain('--json-schema');
    expect(JSON.parse(result.text)).toEqual({ speak: true, role: 'peer' });
  });

  it('does not pass --json-schema on an ordinary agent turn', async () => {
    const file = capture();
    await client('ok', { FAKE_CAPTURE: file }).complete(request());
    expect(readFileSync(file, 'utf8')).not.toContain('--json-schema');
  });

  it('retries once with a repair instruction when the answer is not JSON', async () => {
    const counter = join(root, `count-${Math.random().toString(36).slice(2)}`);
    const file = capture();
    const result = await client('repair', { FAKE_COUNT: counter, FAKE_CAPTURE: file }).complete(
      request({ jsonSchema: schema }),
    );
    expect(JSON.parse(result.text)).toEqual({ speak: false });
    expect(readFileSync(counter, 'utf8').trim()).toBe('2');
    expect(readFileSync(file, 'utf8')).toContain('was not valid JSON');
  });
});

describe('the transcript the two backends send', () => {
  const shared: LlmRequest = request({
    messages: [
      { role: 'user', content: 'Student: a PSD Hessian means convex.' },
      { role: 'assistant', content: 'Everywhere on S, or just at the minimum?' },
      { role: 'user', content: 'Max (challenger): which z are you quantifying over?\n\nStudent: all of them.\n\n[Respond as the peer.]' },
    ],
  });

  it('flattens losslessly: every body survives, in order, byte for byte', () => {
    const prompt = promptFor(shared);
    let cursor = 0;
    for (const m of shared.messages) {
      const at = prompt.indexOf(m.content, cursor);
      expect(at, `message body missing from the flattened prompt: ${m.content.slice(0, 40)}`).toBeGreaterThanOrEqual(0);
      cursor = at + m.content.length;
    }
  });

  it("marks the speaker's own turns, which arrive unlabelled because the API path attributes them by role", () => {
    expect(flattenMessages([{ role: 'assistant', content: 'mine' }])).toBe(`${OWN_TURN_PREFIX}mine`);
    expect(flattenMessages([{ role: 'user', content: 'Student: theirs' }])).toBe('Student: theirs');
  });

  it('gives both clients the same system text and the same transcript content', async () => {
    const sent: { system: string; messages: string[] } = { system: '', messages: [] };
    const fake = {
      messages: {
        stream(params: { system: { text: string }[]; messages: { content: string }[] }) {
          sent.system = params.system.map((b) => b.text).join('\n\n');
          sent.messages = params.messages.map((m) => m.content);
          return Object.assign(
            (async function* () {
              yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } };
            })(),
            {
              finalMessage: async () => ({ content: [{ type: 'text', text: 'ok' }], model: 'claude-haiku-4-5', usage: {} }),
            },
          );
        },
      },
    } as unknown as Anthropic;

    await new AnthropicClient({ apiKey: 'sk-ant-test', client: fake }).complete(shared);
    const file = capture();
    await client('ok', { FAKE_CAPTURE: file }).complete(shared);
    const captured = readFileSync(file, 'utf8');
    const stdin = captured.split('STDIN_BEGIN\n')[1]!.split('\nSTDIN_END')[0]!;

    // Same system prompt, byte for byte — the cache breakpoints are the only API-path extra.
    expect(systemTextFor(shared)).toBe(sent.system);
    expect(captured).toContain(sent.system);
    // Same transcript: every message the API path sent is in the CLI path's single prompt.
    for (const content of sent.messages) {
      expect(stdin).toContain(content);
    }
    expect(sent.messages).toEqual(shared.messages.map((m) => m.content));
  });
});

describe('login-state reading', () => {
  it('recognises the phrasings the CLI uses when it is not logged in', () => {
    expect(looksNotLoggedIn('Error: Not logged in')).toBe(true);
    expect(looksNotLoggedIn('invalid api key · Please run /login')).toBe(true);
    expect(looksNotLoggedIn('OAuth token has expired')).toBe(true);
    expect(looksNotLoggedIn('all good')).toBe(false);
  });

  it('reads a successful probe', () => {
    expect(readProbe(0, '{"type":"result","subtype":"success","is_error":false,"result":"pong"}', '')).toEqual({
      ok: true,
      loggedIn: true,
      detail: null,
    });
  });

  it('reads a not-logged-in probe out of either stream', () => {
    expect(readProbe(1, '', 'Not logged in').loggedIn).toBe(false);
    expect(readProbe(0, '{"is_error":true,"result":"Not logged in"}', '').loggedIn).toBe(false);
  });

  it('reads a non-JSON probe answer as a failure with the text attached', () => {
    const result = readProbe(0, 'command not found', '');
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('command not found');
  });
});

describe('usage normalisation', () => {
  it('maps the CLI usage onto the four numbers the message row stores', () => {
    expect(normaliseCliUsage({ input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4, extra: 'x' })).toEqual(
      { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 },
    );
  });

  it('treats a missing usage block as zeroes rather than NaN', () => {
    expect(normaliseCliUsage(undefined)).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    });
  });
});

describe('which model answered', () => {
  it('picks the entry that wrote the answer, not the first key', () => {
    // The CLI runs auxiliary Haiku calls alongside the request, so `modelUsage` has more than
    // one entry; taking the first reported `claude-haiku-4-5` for a `--model sonnet` call, and
    // that id went onto `messages.model`, i.e. into the research record.
    expect(
      modelFromResultForTest({
        modelUsage: {
          'claude-haiku-4-5-20251001': { outputTokens: 12 },
          'claude-sonnet-5-20260401': { outputTokens: 2_095 },
        },
      }),
    ).toBe('claude-sonnet-5-20260401');
    expect(modelFromResultForTest({})).toBeNull();
  });
});
