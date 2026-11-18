/**
 * **The debug report's wire format**: how it is written (`renderReport`), how a paste of it is
 * read back (`parseReport`), and what the researcher should do about it (`diagnose`).
 *
 * Both halves live in this one file so they cannot drift apart. It imports nothing but
 * `node:crypto` and has no relative imports, so `tools/debug-read.mjs` loads it straight from
 * source (`node --experimental-strip-types`) with no build step: keep it that way (no enums, no
 * parameter properties, no imports of the app's own modules).
 *
 * ## The format
 *
 * Plain text, one fact per line, readable by the participant who sends it:
 *
 *     CHATTERED-DEBUG v1
 *     generated: 2026-11-18T15:20:05Z | SGT 2026-11-18 23:20
 *     [app]
 *     version: 0.1.0
 *     …
 *     [problems]
 *     7d: app.start 12, tutorial.ingest 4, …
 *     - 11-18 09:18Z error llm.error CliExitError: …
 *     truncated: 6 lines (problems 6)
 *     sum: 1a2b3c4d len 2210
 *
 * The `sum` is the first 8 hex digits of SHA-256 over the body **with every whitespace character
 * removed and typographic quotes and dashes folded to ASCII** (`canonical`), and `len` is that
 * canonical length. So a paste whose lines were re-wrapped, whose quotes a chat app made "smart",
 * or whose line endings changed still checks out, while a paste that lost its end (no `sum` line)
 * or had a character changed does not.
 *
 * **Telegram's own markup.** Telegram turns `**x**`, `__x__`, `~~x~~`, `||x||` and backticks into
 * formatting when a message is sent, and the characters are gone. `telegramSafe` removes those
 * sequences from every line before the sum is taken, so the report survives being sent.
 */
import { createHash } from 'node:crypto';

export const DEBUG_HEADER = 'CHATTERED-DEBUG v1';
/** One Telegram message is 4,096 characters; this leaves room for a line of their own. */
export const DEBUG_MAX_CHARS = 3500;
/** No single line is longer than this, whatever a source returned. */
export const MAX_LINE = 200;

// ── writing ─────────────────────────────────────────────────────────────────────────────────

/** The text the checksum is taken over: folded to ASCII punctuation, with no whitespace at all. */
export function canonical(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/[\s\u200B-\u200D\uFEFF]+/g, '');
}

export function checksum(body: string): string {
  return createHash('sha256').update(canonical(body), 'utf8').digest('hex').slice(0, 8);
}

/** Removes what Telegram would turn into formatting, and anything that is not one printable line. */
export function telegramSafe(value: string): string {
  // Control characters are exactly what this is for.
  // eslint-disable-next-line no-control-regex
  let out = value.replace(/[\r\n\t\u0000-\u001F\u007F]+/g, ' ').replace(/`/g, "'");
  for (let i = 0; i < 4; i += 1) {
    const next = out.replace(/\*\*+/g, '*').replace(/__+/g, '_').replace(/~~+/g, '~').replace(/\|\|+/g, '|');
    if (next === out) break;
    out = next;
  }
  return out.trimEnd();
}

export interface ReportLine {
  text: string;
  /** Higher survives longer when the report is too long. 100 is never dropped. */
  prio: number;
  /** What a dropped line is counted under in the `truncated:` line. */
  group: string;
}

export interface ReportSection {
  /** `[name]`, or '' for the lines straight under the header. */
  name: string;
  lines: ReportLine[];
}

export const KEEP = 100;

function clip(text: string): string {
  const t = telegramSafe(text);
  return t.length > MAX_LINE ? `${t.slice(0, MAX_LINE - 1)}…` : t;
}

/**
 * The finished report: sections in order, the lowest-priority lines dropped until it fits
 * `max` characters (earliest first among equals, which for the problem list is the oldest), a
 * `truncated:` line saying what went, and the `sum` line.
 */
export function renderReport(sections: readonly ReportSection[], max = DEBUG_MAX_CHARS): string {
  interface Slot {
    section: number;
    line: ReportLine;
    order: number;
    dropped: boolean;
  }
  const slots: Slot[] = [];
  let order = 0;
  sections.forEach((s, i) => {
    for (const line of s.lines) slots.push({ section: i, line: { ...line, text: clip(line.text) }, order: order++, dropped: false });
  });

  const assemble = (): string[] => {
    const out: string[] = [DEBUG_HEADER];
    sections.forEach((s, i) => {
      const kept = slots.filter((x) => x.section === i && !x.dropped);
      if (kept.length === 0) return;
      if (s.name) out.push(`[${s.name}]`);
      for (const x of kept) out.push(x.line.text);
    });
    return out;
  };
  const droppedLine = (): string | null => {
    const gone = slots.filter((x) => x.dropped);
    if (gone.length === 0) return null;
    const by = new Map<string, number>();
    for (const x of gone) by.set(x.line.group, (by.get(x.line.group) ?? 0) + 1);
    return `truncated: ${gone.length} lines (${[...by].map(([g, n]) => `${g} ${n}`).join(', ')})`;
  };
  // The footer is `sum: xxxxxxxx len NNNNN`: 24 characters at most, and a newline.
  const size = (): number => {
    const body = assemble();
    const t = droppedLine();
    return [...body, ...(t ? [t] : [])].join('\n').length + 26;
  };

  while (size() > max) {
    const candidates = slots.filter((x) => !x.dropped && x.line.prio < KEEP);
    if (candidates.length === 0) break;
    candidates.sort((a, b) => a.line.prio - b.line.prio || a.order - b.order);
    candidates[0]!.dropped = true;
  }
  // Only the never-dropped lines are left and it is still too long: cut them shorter.
  if (size() > max) {
    for (const x of slots) if (!x.dropped && x.line.text.length > 80) x.line.text = `${x.line.text.slice(0, 79)}…`;
  }

  const body = assemble();
  const t = droppedLine();
  if (t) body.push(t);
  const text = body.join('\n');
  return `${text}\nsum: ${checksum(text)} len ${canonical(text).length}`;
}

// ── reading ─────────────────────────────────────────────────────────────────────────────────

export type Integrity = 'complete' | 'altered' | 'cut' | 'missing';

export interface ProblemLine {
  ts: string;
  level: string;
  event: string;
  rest: string;
}

export interface ParsedReport {
  /** `complete`: the sum checks out. `altered`: it does not. `cut`: no sum line. `missing`: no header. */
  integrity: Integrity;
  sumExpected: string | null;
  sumActual: string | null;
  lenExpected: number | null;
  lenActual: number | null;
  /** The report's own `truncated:` line: it was shortened on the participant's Mac to fit. */
  truncated: string | null;
  /** Section → key → value. Lines straight under the header are under `''`. */
  sections: Record<string, Record<string, string>>;
  order: string[];
  problems: ProblemLine[];
  /** Every `error:` value, as `section` / `key` / cause. */
  errors: Array<{ section: string; key: string; cause: string }>;
}

const SECTION_RE = /^\[([a-z0-9-]+)\]$/;
const KEY_RE = /^([a-z0-9][a-z0-9.-]*):(?:\s(.*))?$/;

/** Typographic punctuation folded back, line endings unified; the line breaks are kept. */
function normaliseLines(raw: string): string[] {
  return raw
    .normalize('NFKC')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''));
}

function startsLine(line: string): boolean {
  return line === DEBUG_HEADER || SECTION_RE.test(line) || KEY_RE.test(line) || line.startsWith('- ');
}

export function parseReport(raw: string): ParsedReport {
  const lines = normaliseLines(raw);
  const empty: ParsedReport = {
    integrity: 'missing',
    sumExpected: null,
    sumActual: null,
    lenExpected: null,
    lenActual: null,
    truncated: null,
    sections: {},
    order: [],
    problems: [],
    errors: [],
  };
  // A forwarded message may carry a "Name, [date]:" line, and the header may be indented.
  const start = lines.findIndex((l) => l.trim() === DEBUG_HEADER || l.trim().endsWith(DEBUG_HEADER));
  if (start < 0) return empty;

  // Re-join lines a chat app wrapped: every line the report writes starts with one of four shapes.
  const logical: string[] = [DEBUG_HEADER];
  let afterSum = false;
  for (const rawLine of lines.slice(start + 1)) {
    const line = rawLine.trim();
    if (line === '') continue;
    // After the sum line, only its own wrapped tail belongs to the report.
    if (afterSum && startsLine(line)) break;
    if (startsLine(line)) logical.push(line);
    else logical[logical.length - 1] = `${logical[logical.length - 1]} ${line}`;
    if (/^sum:\s/.test(line)) afterSum = true;
  }

  const sumIdx = logical.findIndex((l) => /^sum:\s/.test(l));
  const body = sumIdx >= 0 ? logical.slice(0, sumIdx) : logical;
  const out: ParsedReport = { ...empty, sections: { '': {} }, order: [''] };
  if (sumIdx >= 0) {
    const m = /^sum:\s*([0-9a-f]{8})\s*(?:len\s*(\d+))?/i.exec(logical[sumIdx]!);
    out.sumExpected = m ? m[1]!.toLowerCase() : null;
    out.lenExpected = m?.[2] ? Number(m[2]) : null;
    const text = body.join('\n');
    out.sumActual = checksum(text);
    out.lenActual = canonical(text).length;
    out.integrity = out.sumExpected !== null && out.sumExpected === out.sumActual ? 'complete' : 'altered';
  } else {
    out.integrity = 'cut';
  }

  let section = '';
  for (const line of body.slice(1)) {
    const sec = SECTION_RE.exec(line);
    if (sec) {
      section = sec[1]!;
      if (!out.sections[section]) {
        out.sections[section] = {};
        out.order.push(section);
      }
      continue;
    }
    if (line.startsWith('- ')) {
      const [ts = '', level = '', event = '', ...rest] = line.slice(2).split(' ');
      // A timestamp is `MM-DD HH:MMZ`: two tokens.
      const parts = /^\d\d-\d\d$/.test(ts) ? [`${ts} ${level}`, event, rest[0] ?? '', rest.slice(1).join(' ')] : [ts, level, event, rest.join(' ')];
      out.problems.push({ ts: parts[0]!, level: parts[1]!, event: parts[2]!, rest: parts[3]! });
      continue;
    }
    const kv = KEY_RE.exec(line);
    if (!kv) continue;
    const key = kv[1]!;
    const value = (kv[2] ?? '').trim();
    if (key === 'truncated') {
      out.truncated = value;
      continue;
    }
    out.sections[section]![key] = value;
    if (key === 'error') out.errors.push({ section, key: '', cause: value });
    else if (value.startsWith('error:')) out.errors.push({ section, key, cause: value.slice(6).trim() });
  }
  return out;
}

// ── diagnosing ──────────────────────────────────────────────────────────────────────────────

export type Severity = 'act' | 'warn' | 'info';

export interface Finding {
  severity: Severity;
  title: string;
  /** Why, in a sentence, from the report's own values. */
  detail: string;
  /** What to do. */
  action: string;
  /** A command to run, where there is one. */
  command?: string;
}

export interface DiagnoseContext {
  /** The newest build published on the participant's channel, when the researcher knows it. */
  publishedBuild?: number | null;
  /**
   * The release tool's usage line for a per-install rollout (`… --target <id>`), or null while
   * the release tool has no per-install targeting. Read from `tools/release*.sh` by the CLI.
   */
  targetUsage?: string | null;
  /** The release tool's per-install rollback (`… --rollback-to <N-1> --target <id> …`), or null. */
  rollbackUsage?: string | null;
  /** Ending a per-install target or pin (`… --untarget <id> …`), or null. */
  untargetUsage?: string | null;
  /** The release tool's general publish usage line. */
  publishUsage?: string | null;
  /**
   * The manifest tool's per-install form (`tools/update-tool.mjs manifest … --target <id>=<entry>`),
   * for while the release tool itself has no `--target`.
   */
  manifestTargetUsage?: string | null;
}

function get(r: ParsedReport, section: string, key: string): string | null {
  const v = r.sections[section]?.[key];
  return v === undefined ? null : v;
}

/** `120.3 GB` → bytes. */
export function parseSize(value: string | null): number | null {
  if (!value) return null;
  const m = /^([\d.]+)\s*(B|KB|MB|GB|TB)\b/i.exec(value);
  if (!m) return null;
  const mult: Record<string, number> = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 };
  return Number(m[1]) * mult[m[2]!.toUpperCase()]!;
}

/** `7d: app.start 12, llm.error 3` → counts. */
export function parseCounts(value: string | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of (value ?? '').split(',')) {
    const m = /^\s*([a-z0-9._-]+)\s+(\d+)\s*$/i.exec(part);
    if (m) out[m[1]!] = Number(m[2]);
  }
  return out;
}

export function installIdOf(r: ParsedReport): string | null {
  const raw = (get(r, 'install', 'id') ?? '').replace(/\s+/g, '');
  return /^[A-Za-z0-9_-]{6,64}$/.test(raw) ? raw : null;
}

function rollout(ctx: DiagnoseContext, id: string | null): { command: string; note: string } {
  if (ctx.targetUsage && id) {
    return { command: ctx.targetUsage.replace(/<(install-?id|id)>/gi, id), note: `to this install only (${id})` };
  }
  if (ctx.manifestTargetUsage && id) {
    return {
      command: ctx.manifestTargetUsage.replace(/<(install-?id|id)>/gi, id),
      note: `to this install only (${id}), by hand: tools/release.sh has no --target yet, so write the targeted manifest with the update tool, then sign and upload it`,
    };
  }
  const general = ctx.publishUsage ?? 'tools/release.sh --publish v<version>';
  return {
    command: general,
    note: id
      ? `per-install targeting is not in tools/release.sh yet, so this publishes to everyone; when it lands, target ${id}`
      : 'this report has no install id, so only a general publish can reach it',
  };
}

export function diagnose(r: ParsedReport, ctx: DiagnoseContext = {}): Finding[] {
  const f: Finding[] = [];
  const id = installIdOf(r);
  const slot = get(r, 'study', 'slot');
  const slotNum = slot && /^S?(\d{1,3})$/i.exec(slot)?.[1];

  if (r.integrity === 'missing') {
    return [
      {
        severity: 'act',
        title: 'Not a ChatterED debug report',
        detail: `No "${DEBUG_HEADER}" line in what was pasted.`,
        action: 'Ask them to press ⇧⌘D in ChatterED (or Help ▸ Copy Debug Info for the Team) and paste the result.',
      },
    ];
  }
  if (r.integrity === 'cut') {
    f.push({
      severity: 'act',
      title: 'The paste is cut off',
      detail: 'There is no closing "sum:" line, so the end of the report is missing.',
      action: 'Ask them to press ⇧⌘D again and paste the whole message: it always fits in one Telegram message.',
    });
  } else if (r.integrity === 'altered') {
    f.push({
      severity: 'warn',
      title: 'The checksum does not match',
      detail: `Expected ${r.sumExpected ?? '?'} (len ${r.lenExpected ?? '?'}), got ${r.sumActual} (len ${r.lenActual}). Something was changed or lost in transit.`,
      action: 'Read the values with care, or ask for a fresh paste.',
    });
  }
  if (r.truncated) {
    f.push({
      severity: 'info',
      title: 'Shortened on their Mac to fit one message',
      detail: `truncated: ${r.truncated}.`,
      action: 'The least important lines went first. Ask for the log folder if the missing lines matter.',
    });
  }

  const boot = get(r, 'boot', 'failed');
  if (boot) {
    // The build to go back to: the report's kept N-1, when it has one.
    const previous = (get(r, 'update', 'previous-build') ?? '').trim();
    const rb =
      ctx.rollbackUsage && id
        ? ctx.rollbackUsage.replace(/<(install-?id|id)>/gi, id).replace(/<N-1>/g, /^\d+$/.test(previous) ? previous : '<N-1>')
        : null;
    f.push({
      severity: 'act',
      title: 'ChatterED cannot start',
      detail: `boot failed: ${boot}`,
      action:
        'If this started after an update, roll this install back to the build before it; otherwise fix and push a new build. Nothing has been deleted.',
      ...(rb ? { command: rb } : {}),
    });
  }

  // A per-install target or pin is in force for this install: say how to end it.
  const lm = get(r, 'update', 'last-manifest') ?? '';
  if (/"?targeted"?\s*:\s*true/.test(lm) && id) {
    f.push({
      severity: 'info',
      title: 'This install is on its own target',
      detail: `last manifest: ${lm}`,
      action: 'It gets this build, not the channel default, until you end the target. Pins never expire on their own.',
      ...(ctx.untargetUsage ? { command: ctx.untargetUsage.replace(/<(install-?id|id)>/gi, id) } : {}),
    });
  }

  const location = get(r, 'app', 'location');
  if (location === 'dmg') {
    f.push({
      severity: 'act',
      title: 'Running from the disk image: not installed',
      detail: `bundle: ${get(r, 'app', 'bundle') ?? '?'}`,
      action: 'Ask them to quit ChatterED, drag it from the DMG onto Applications, eject the DMG, and open it from Applications. Updates cannot apply to a copy on a DMG.',
    });
  } else if (location === 'translocated') {
    f.push({
      severity: 'act',
      title: 'macOS is running a translocated copy',
      detail: 'App Translocation runs a quarantined app from a random read-only path, so updates cannot replace it.',
      action: 'Ask them to quit, move ChatterED.app into Applications with Finder (drag it out and back in), and open it from there.',
    });
  }

  if (location === 'other') {
    f.push({
      severity: 'warn',
      title: 'Not installed in Applications',
      detail: `bundle: ${get(r, 'app', 'bundle') ?? '?'}`,
      action: 'Ask them to quit ChatterED and drag it into Applications, then open it from there (and delete the other copy), so updates replace the copy they actually open.',
    });
  }

  // `apps-writable: app in Applications writable; Applications folder read-only` (or, from builds
  // before 2026-11-19, `yes (folder no)`): the copy in /Applications, then /Applications itself.
  const admin = get(r, 'mac', 'admin');
  const writable = get(r, 'mac', 'apps-writable') ?? '';
  const bundleW = /^yes\b/.test(writable) || /^app in Applications writable/.test(writable);
  const folderW = /folder yes/.test(writable) || /Applications folder writable/.test(writable);
  const installed = location === 'applications';
  if (writable && admin === 'no' && installed && (!bundleW || !folderW)) {
    f.push({
      severity: 'act',
      title: 'Updates cannot be applied on this Mac',
      detail: `They are not an administrator and the copy in /Applications cannot be replaced (apps-writable: ${writable}).`,
      action:
        'Ask them to drag ChatterED.app into the Applications folder inside their home folder (~/Applications) and open it from there, or have an administrator give their account write access to /Applications/ChatterED.app.',
    });
  } else if (installed && (/^no\b/.test(writable) || /^app in Applications read-only/.test(writable))) {
    f.push({
      severity: 'warn',
      title: '/Applications/ChatterED.app is not writable',
      detail: `apps-writable: ${writable}. An update will need their password, or fail.`,
      action: 'Ask them to drag ChatterED.app from Applications to the Trash and install the DMG again, signed in as themselves.',
    });
  }

  const free = parseSize(get(r, 'mac', 'disk-free'));
  if (free !== null && free < 2e9) {
    f.push({
      severity: 'act',
      title: 'Low disk space',
      detail: `disk-free: ${get(r, 'mac', 'disk-free')} (an update needs about 1 GB to download and stage).`,
      action: 'Ask them to free a few GB (empty the Trash, remove old downloads) before the next update.',
    });
  }

  const update = r.sections.update ?? {};
  // CFBundleVersion; the updater's own `build` when the bundle's is not a build number.
  const appBuild = (get(r, 'app', 'build') ?? '').split(/\s/)[0] ?? '';
  const buildRaw = /^\d+$/.test(appBuild) ? appBuild : /^\d+$/.test(update.build ?? '') && update.build !== '0' ? update.build! : appBuild;
  const build = /^\d+$/.test(buildRaw) ? Number(buildRaw) : null;
  const noUpdater = (update.update ?? '').startsWith('not available') || !r.sections.update;
  if (noUpdater || build === null) {
    f.push({
      severity: 'act',
      title: 'An old build without the updater',
      detail: `build: ${buildRaw || '?'}; ${noUpdater ? 'update: not available in this build' : 'no build number'}. It cannot update itself.`,
      action: 'Send this participant one new DMG by hand (it keeps their data); every later fix reaches them through the updater.',
      command: slotNum
        ? `cd app && tools/release.sh --study ~/.config/chattered-study/keys.json --preload ${Number(slotNum)}`
        : 'cd app && tools/release.sh --study ~/.config/chattered-study/keys.json',
    });
  } else if (ctx.publishedBuild != null && build < ctx.publishedBuild) {
    const ro = rollout(ctx, id);
    f.push({
      severity: 'warn',
      title: `Behind the published build (${build} < ${ctx.publishedBuild})`,
      detail: `last-check: ${update['last-check'] ?? '?'}; staged: ${update.staged ?? '?'}.`,
      action: `It should pick the update up at its next check. If it does not, push it ${ro.note}.`,
      command: ro.command,
    });
  }

  if (update.enabled === 'no') {
    const reason = update['disabled-reason'] ?? '?';
    f.push({
      severity: location === 'dev' || reason === 'dev' ? 'info' : 'warn',
      title: 'Updates are switched off on this copy',
      detail: `disabled-reason: ${reason}${update['kill-switch'] ? `; kill-switch: ${update['kill-switch']}` : ''}.`,
      action: 'If this is a participant\'s copy, fix the reason (usually where it runs from: see the location finding) so the next update reaches it.',
    });
  }
  if (update['journal-pending'] === 'yes') {
    f.push({
      severity: 'warn',
      title: 'An update swap was interrupted',
      detail: 'journal-pending: yes. The next launch finishes or reverts it.',
      action: 'Ask them to quit ChatterED fully (⌘Q) and open it again, then send a fresh report.',
    });
  }
  if (update.quarantined === 'yes' && location !== 'dmg' && location !== 'translocated') {
    f.push({
      severity: 'info',
      title: 'The app still carries the download quarantine flag',
      detail: 'quarantined: yes. macOS may translocate it if it is moved.',
      action: 'Nothing unless it misbehaves; the self-install clears it when it moves the app.',
    });
  }

  for (const [key, value] of Object.entries(update)) {
    if (key === 'update' || key === 'disabled-reason' || key === 'kill-switch') continue;
    if (key === 'apply-failures' && /^[1-9]/.test(value)) {
      const ro = rollout(ctx, id);
      f.push({
        severity: 'act',
        title: 'Updates fail to apply',
        detail: `apply-failures: ${value}.`,
        action: `Read the last-events line for the stage that fails. If it is permissions, see the apps-writable finding; else republish ${ro.note}.`,
        command: ro.command,
      });
      continue;
    }
    if (key === 'bad-builds' && value && !/^(none|-|\[\]|0)$/i.test(value)) {
      f.push({
        severity: 'warn',
        title: 'Builds failed to start here',
        detail: `bad-builds: ${value}. The updater will not install them again on this Mac.`,
        action: 'Look at why that build failed (the [problems] lines), fix it, and publish a newer build.',
      });
    } else if (/\b(fail|failed|error|refused|invalid)\b/i.test(value)) {
      const ro = rollout(ctx, id);
      f.push({
        severity: 'act',
        title: `Update problem: ${key}`,
        detail: `${key}: ${value}`,
        action: `Check the manifest and the download for this install, then republish ${ro.note}.`,
        command: ro.command,
      });
    }
  }

  const counts = parseCounts(get(r, 'problems', '7d'));
  const failed = counts['tutorial.ingest.failed'] ?? 0;
  const tutorialFails = r.problems.filter((p) => p.event === 'tutorial.ingest.failed');
  const cut = (counts['llm.cut'] ?? 0) > 0 || tutorialFails.some((p) => /too.?long|cut.?off|truncat|max.?tokens|window/i.test(p.rest));
  if (failed >= 2) {
    const ro = rollout(ctx, id);
    f.push({
      severity: 'act',
      title: cut ? 'Tutorial sheets fail to read: answers cut off' : 'Tutorial sheets keep failing to read',
      detail: `tutorial.ingest.failed ${failed} times in 7 days (tutorial.ingest ok ${counts['tutorial.ingest'] ?? 0}; llm.cut ${counts['llm.cut'] ?? 0}).`,
      action: cut
        ? 'The long-sheet read (page windows) fixes cut-off reads: ship a build with it to this install, then ask them to press Read again.'
        : 'Read the causes in [problems]; ask for the sheet\'s page count (not the file) if it looks size-related.',
      command: ro.command,
    });
  }

  const llm = r.problems.filter((p) => p.event === 'llm.error' || p.event === 'ipc.error');
  if (get(r, 'study', 'cap-hit')?.startsWith('yes')) {
    f.push({
      severity: 'act',
      title: 'The study credit is used up',
      detail: `spent ${get(r, 'study', 'spent') ?? '?'}; cap-hit ${get(r, 'study', 'cap-hit')}.`,
      action: 'Either they switch to Claude Code or their own key in Settings, or you issue a new bundle with a larger budget for this slot and send a DMG.',
    });
  } else if (llm.some((p) => /credit|billing|spend.?limit|quota|insufficient|payment/i.test(p.rest))) {
    f.push({
      severity: 'act',
      title: 'The model provider refuses for credit or a spend limit',
      detail: 'llm.error lines name credit, billing or a spend limit.',
      action: `Check slot ${slot ?? '?'}'s workspace in the Anthropic Console (usage and limit).`,
    });
  }
  if (llm.some((p) => /\b429\b|rate.?limit|overloaded|\b529\b/i.test(p.rest))) {
    f.push({
      severity: 'warn',
      title: 'Rate-limited or overloaded',
      detail: 'llm.error lines carry 429/529 or "rate limit".',
      action: 'Usually transient. If it persists, check the workspace\'s rate limits in the Console.',
    });
  }

  const qc = get(r, 'data', 'quick-check');
  if (qc && !/^(ok|skipped)\b/.test(qc)) {
    f.push({
      severity: 'act',
      title: 'The database failed its integrity check',
      detail: `quick-check: ${qc}`,
      action: 'Ask them to quit ChatterED and not delete anything. A copy from before the last schema upgrade is in the backups folder; ask for File ▸ Export Research Data… if the app still opens.',
    });
  }

  const crashes = r.problems.filter((p) => /^(renderer\.gone|renderer\.gave_up|process\.uncaught|child\.gone|preload\.error|renderer\.no_bridge)$/.test(p.event));
  if (crashes.length > 0) {
    f.push({
      severity: 'warn',
      title: 'Crashes in the recent log',
      detail: `${crashes.length} line(s): ${[...new Set(crashes.map((p) => p.event))].join(', ')}.`,
      action: 'Read those lines; ask for the log folder (Settings ▸ Open log folder) if the cause is not there.',
    });
  }

  const backend = get(r, 'study', 'backend') ?? '';
  const keyFiles = get(r, 'study', 'key-files') ?? '';
  if (/^anthropic\b/.test(backend) && !/anthropic/.test(keyFiles)) {
    f.push({
      severity: 'act',
      title: 'Anthropic is selected but there is no Anthropic key file',
      detail: `backend: ${backend}; key-files: ${keyFiles || 'none'}.`,
      action: 'A study copy re-enters its code only before the first unlock; ask them to enter their study code again in Settings, or choose Claude Code there.',
    });
  }
  const studyKey = get(r, 'study', 'study-key');
  if (studyKey && /^ended/.test(studyKey)) {
    f.push({
      severity: 'info',
      title: 'They left the study key',
      detail: `study-key: ${studyKey}. Their spend is no longer counted against the study budget.`,
      action: 'Nothing to fix unless it was a mistake; re-entering the study code resumes the same count.',
    });
  }
  const consent = get(r, 'install', 'consent');
  if (consent && /^(none|-)$/.test(consent)) {
    f.push({
      severity: 'info',
      title: 'The trial notice has not been agreed to',
      detail: 'consent: none. The app stays on the notice until they agree.',
      action: 'Nothing to fix unless they are stuck on that screen.',
    });
  }

  for (const e of r.errors) {
    f.push({
      severity: 'info',
      title: `Could not read ${e.section}${e.key ? ` ${e.key}` : ''}`,
      detail: e.cause,
      action: 'Itself a clue: that part of the app or the Mac was not healthy when the report was made.',
    });
  }

  const rank: Record<Severity, number> = { act: 0, warn: 1, info: 2 };
  return f.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
