/**
 * The log's one hard promise, and its rotation.
 *
 * `actor.test.ts`'s "writes an event stream with no message bodies in it" is the model for the
 * first half: the SQLite event stream has carried that guarantee since evaluation-plan.md §7.2,
 * and a log file that leaks what the event stream will not is the same breach one layer down —
 * worse, in fact, because the log is the thing **Copy diagnostics** puts on a clipboard.
 */
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KEEP, Logger, MAX_BYTES, fileSink, redact, tailLog, errorClass } from './log.js';

const SECRET = 'So manhattan distance is not admissible, while straight line is admissible?';
const KEY = 'sk-ant-api03-DEADBEEFnotarealkey';

function capture(level: 'debug' | 'info' = 'debug'): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  return { logger: new Logger({ sink: { write: (l) => lines.push(l) }, level, now: () => 0 }), lines };
}

describe('the log never carries what the learner or the agents wrote', () => {
  it('drops a forbidden field and keeps only its length', () => {
    const out = redact({ body: SECRET, prompt: SECRET, apiKey: KEY, model: 'sonnet', ms: 20_013 });
    expect(JSON.stringify(out)).not.toContain('manhattan');
    expect(JSON.stringify(out)).not.toContain('sk-ant');
    expect(out.body_chars).toBe(SECRET.length);
    expect(out.apiKey_chars).toBe(KEY.length);
    // What is left is what a log is for.
    expect(out.model).toBe('sonnet');
    expect(out.ms).toBe(20_013);
  });

  it('drops them at any nesting depth, and never writes them to the sink', () => {
    const { logger, lines } = capture();
    logger.info('llm.request', { scope: 'group', usage: { input_tokens: 5 }, meta: { text: SECRET } });
    logger.info('turn.dispatched', { reply_chars: 412, body: SECRET, note: SECRET });
    const written = lines.join('');
    expect(written).not.toContain('manhattan');
    expect(written).not.toContain('straight line');
    expect(written).toContain('"text_chars":75');
  });

  /**
   * `cause` is the one free-text field, and it is not ours: it carries the tail of the child
   * process's own stderr, because "exited 1" without the line it printed is a dead end. So it
   * is capped, and a key-shaped token is removed from *any* string, not only from a field that
   * happens to be called `key`.
   */
  it('caps the one free-text field and scrubs a key out of any string', () => {
    const { logger, lines } = capture();
    logger.error('llm.error', { cause: `auth failed for ${KEY} at 03:11`, stdout: KEY });
    const written = lines.join('');
    expect(written).not.toContain('DEADBEEF');
    expect(written).toContain('sk-ant-[redacted]');
    lines.length = 0;
    logger.error('llm.error', { cause: 'x'.repeat(5_000) });
    expect(lines[0]!.length).toBeLessThan(600);
  });

  /** BYOK (2026-09-25): every provider's key shape, and the generic places a key is written. */
  it('scrubs OpenAI, Gemini and bearer-token keys out of any string', () => {
    const openai = 'sk-proj-AbCdEf0123456789_ghIJklMNopQRstuv';
    const legacy = 'sk-0123456789abcdefABCDEF0123456789';
    const gemini = 'AIzaSyD-0123456789abcdefghijklmnopqrstu';
    const bearer = 'my-local-token.0123456789';
    const out = redact({
      cause: `401 for ${openai} and ${legacy}`,
      detail: `Gemini said: key ${gemini} invalid`,
      header: `Authorization: Bearer ${bearer}`,
      url: `https://example.test/v1?key=${bearer}`,
      header2: `x-goog-api-key: ${bearer}`,
    });
    const text = JSON.stringify(out);
    for (const secret of [openai, legacy, gemini, bearer, 'AbCdEf0123456789', '0123456789abcdefghij']) {
      expect(text).not.toContain(secret);
    }
    expect(out.cause).toBe('401 for sk-[redacted] and sk-[redacted]');
    expect(out.detail).toBe('Gemini said: key AIza[redacted] invalid');
    expect(out.header).toBe('Authorization: Bearer [redacted]');
    expect(out.url).toBe('https://example.test/v1?key=[redacted]');
    expect(out.header2).toBe('x-goog-api-key: [redacted]');
  });

  it('still marks an Anthropic key as one, and leaves ordinary text alone', () => {
    expect(redact({ cause: `bad ${KEY}` }).cause).toBe('bad sk-ant-[redacted]');
    expect(redact({ cause: 'gpt-6-sol answered in 812 ms; task-skeleton ok' }).cause).toBe('gpt-6-sol answered in 812 ms; task-skeleton ok');
  });

  it('caps any other long string rather than trusting the call site', () => {
    const out = redact({ cause: 'y'.repeat(2_000) });
    expect((out.cause as string).length).toBeLessThanOrEqual(301);
  });
});

describe('the format', () => {
  it('is one JSON object per line, with a level, an event name and a correlation id', () => {
    const { logger, lines } = capture();
    const turn = logger.child('turn_7');
    turn.info('turn.start', { trigger: 'student_message' });
    turn.info('orchestrator.response', { ms: 20_013, parsed_ok: false, chosen_role: null });
    const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(parsed).toHaveLength(2);
    for (const line of parsed) {
      expect(line.turn).toBe('turn_7');
      expect(line.ts).toBe('1970-01-01T00:00:00.000Z');
      expect(typeof line.event).toBe('string');
      expect(line.level).toBe('info');
    }
    expect(parsed[1]!.chosen_role).toBeNull();
    // Every line ends in a newline, so `tail -f | jq` works on a live file.
    for (const l of lines) expect(l.endsWith('\n')).toBe(true);
  });

  it('honours the level threshold', () => {
    const { logger, lines } = capture('info');
    logger.debug('llm.stream.chunk', { chunks: 12 });
    expect(lines).toHaveLength(0);
    logger.info('llm.complete', {});
    expect(lines).toHaveLength(1);
  });
});

describe('rotation', () => {
  it('rolls the file at the size cap and keeps a bounded number of them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chattered-log-'));
    const sink = fileSink(dir);
    // Seed a file that is already at the cap, then write once: that write must roll it.
    writeFileSync(join(dir, 'main.log'), 'x'.repeat(MAX_BYTES));
    sink.write('{"event":"after"}\n');
    expect(readdirSync(dir).sort()).toEqual(['main.1.log', 'main.log']);
    expect(readFileSync(join(dir, 'main.log'), 'utf8')).toContain('after');

    for (let i = 0; i < KEEP + 2; i += 1) {
      writeFileSync(join(dir, 'main.log'), 'x'.repeat(MAX_BYTES));
      sink.write(`{"event":"roll${i}"}\n`);
    }
    // main.log plus at most KEEP archives, forever.
    expect(readdirSync(dir).length).toBe(KEEP + 1);
  });

  it('reads back the tail for Copy diagnostics, and an absent log is empty, not a throw', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chattered-log-'));
    expect(tailLog(dir)).toEqual([]);
    const sink = fileSink(dir);
    for (let i = 0; i < 80; i += 1) sink.write(`{"event":"e${i}"}\n`);
    const tail = tailLog(dir, 50);
    expect(tail).toHaveLength(50);
    expect(tail.at(-1)).toContain('e79');
  });
});

describe('errorClass', () => {
  it('names the class a grep would want, without the message', () => {
    expect(errorClass(new Error('The Claude CLI exited 1: boom'))).toBe('CliExitError');
    expect(errorClass(new Error('The Claude CLI did not answer within 120s.'))).toBe('TimeoutError');
    expect(errorClass(new Error('no JSON object in orchestrator response'))).toBe('ParseError');
    const named = new Error('x');
    named.name = 'ClaudeCliNotLoggedInError';
    expect(errorClass(named)).toBe('ClaudeCliNotLoggedInError');
  });
});
