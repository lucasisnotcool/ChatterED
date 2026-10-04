/**
 * **Classical planning, checked by code** (2026-10-03, `docs/research/tutorials.md` §6).
 *
 * A tutorial part is judged by Max against a hidden key the model wrote. Where the problem is
 * formal — a plan in a STRIPS-style domain, an HLA's precondition and effect, which sequences of
 * actions reach a goal — the model only *states* the problem here (`FormalCheck`) and code decides,
 * so a learner's correct plan is never marked wrong by a model that miscounted (Pardos & Bhandari
 * 2024: hint errors fell to near zero where answers were checked by computation).
 *
 * The same check is run on the model's own key at ingest: a key that fails its own simulation is
 * marked low-confidence, and the simulation's answer wins.
 *
 * Pure: no clock, no I/O, nothing outside `core/`.
 */

// ── Types (frozen by `app/docs/TUTORIAL-CONTRACT.md`) ────────────────────────────────────────

/**
 * A literal: `On(A, B)`, `¬Clear(A)`, or a propositional fluent `A` (no args). Names compare
 * case-insensitively after trimming; the original spelling is kept for display.
 */
export interface Literal {
  pred: string;
  args: string[];
  neg: boolean;
}

/**
 * An action schema. `params` are variable names used in `pre` and `eff` args; anything in an args
 * list that is not a param is a constant. `eff` literals with `neg: true` delete, the rest add.
 * `distinct` lists param pairs that may not be bound to the same object (`Move(x, fr, to)`: x≠fr,
 * x≠to, fr≠to). A propositional action (the HLA primitives `P1`…`P10`) has no params.
 */
export interface ActionSchema {
  name: string;
  params: string[];
  pre: Literal[];
  eff: Literal[];
  distinct?: [string, string][];
}

export interface StripsDomain {
  /** Every object a parameter may be bound to. */
  objects: string[];
  actions: ActionSchema[];
  /**
   * Literals that are always true and that no effect deletes: `Clear(Table)` in a blocks world
   * whose table always has room. An effect that would delete one is ignored for it.
   */
  static?: Literal[];
}

/** A high-level action and its possible refinements, each a sequence of primitive action names. */
export interface HlaSpec {
  name: string;
  implementations: string[][];
}

/**
 * **What the model states about a formal part**, for code to decide with.
 *
 * - `plan` — the learner's answer is a sequence of ground actions (`Move(A, B, Table)`, one per
 *   line or comma-separated); correct when every step is applicable in turn from `init` and the
 *   final state satisfies `goal`. Closed world: a literal not in the state is false.
 * - `sequences` — a `choice` part whose options are action sequences (primitives, or HLAs written
 *   `H1(P1,P3)` with the implementation named); code works out which options reach `goal`.
 * - `hla_schema` — a `blanks` part asking for an HLA's precondition or effect; code derives each
 *   from the primitives (angelic semantics: `∼+X` possibly adds, `∼−X` possibly deletes, `∼±X`
 *   either) and compares the learner's literal set to it, in any order and notation.
 */
export type FormalCheck =
  | { type: 'plan'; domain: StripsDomain; init: Literal[]; goal: Literal[] }
  | {
      type: 'sequences';
      actions: ActionSchema[];
      hlas: HlaSpec[];
      init: Literal[];
      goal: Literal[];
      options: { id: string; steps: string[] }[];
    }
  | {
      type: 'hla_schema';
      actions: ActionSchema[];
      hlas: HlaSpec[];
      blanks: Record<string, { hla: string; field: 'precond' | 'effect' }>;
    };

/** The three verdicts a check gives; the same values as `shared/tutorial`'s `QuizVerdict3`. */
export type CoreVerdict = 'complete' | 'partial' | 'not_yet';

// ── Literals: reading what a learner (or the model) wrote ────────────────────────────────────

/**
 * How an effect literal changes its fluent. Certain effects are `add` / `del`; the angelic
 * possibly-effects of an HLA are `maybe_add` (`∼+X`), `maybe_del` (`∼−X`) and `maybe` (`∼±X`).
 */
export type EffectMode = 'add' | 'del' | 'maybe_add' | 'maybe_del' | 'maybe';

/**
 * A literal as read from text. `mode` is set only where the text said more than a sign: a
 * possibly-marker, or the words "add X" / "delete X". `neg` stays meaningful throughout:
 * `maybe_del` carries `neg: true`, the other two possibly-modes `neg: false`.
 */
export interface ParsedLiteral extends Literal {
  mode?: EffectMode;
}

const low = (s: string): string => s.trim().toLowerCase();

/** The identity of a literal's atom, sign and mode aside: `on(a,b)`, `a()`. Case-insensitive. */
export function atomKey(l: Pick<Literal, 'pred' | 'args'>): string {
  return `${low(l.pred)}(${l.args.map(low).join(',')})`;
}

/** What an effect literal does to its fluent: its `mode`, or its sign when it has none. */
export function effectKind(l: ParsedLiteral): EffectMode {
  return l.mode ?? (l.neg ? 'del' : 'add');
}

/**
 * **Notation, made one notation.** Learners write `¬`, `~`, `!`, `not`, `-` for negation; `∧`,
 * `^`, `&`, `,`, `and`, `/\` for conjunction; `∼±`, `~+-`, `+-`, "possibly add or delete" for the
 * angelic either-way effect; and some of them write it in TeX (`$\neg A \wedge \sim\pm B$`),
 * because that is how the sheet printed it. All of it is rewritten here to one small ASCII-ish
 * alphabet that the conjunct reader below understands: `!` negation, `∧` conjunction, `~+`,
 * `~-`, `~+-` and `+-` possibly-markers, `+` an explicit add.
 *
 * A TeX `~` (a non-breaking space) is read as negation. No learner types a TeX space into a
 * precondition; many type a tilde for "not".
 */
function normaliseNotation(raw: string): string {
  let s = raw;
  s = s.replace(/\$+/g, ' ').replace(/\/\\/g, '∧');
  s = s.replace(/\\(?:left|right|bigg?|Bigg?)(?![a-zA-Z])/g, '');
  s = s.replace(/\\(?:neg|lnot)(?![a-zA-Z])/g, '¬');
  s = s.replace(/\\(?:wedge|land)(?![a-zA-Z])/g, '∧');
  s = s.replace(/\\sim(?![a-zA-Z])/g, '∼');
  s = s.replace(/\\(?:pm|mp)(?![a-zA-Z])/g, '±');
  s = s.replace(/\\(?:emptyset|varnothing)(?![a-zA-Z])/g, '∅');
  s = s.replace(/\\top(?![a-zA-Z])/g, ' true ');
  s = s.replace(/\\(?:text|textit|textrm|textsf|textbf|mathrm|mathit|mathsf|mathbf|operatorname)(?![a-zA-Z])/g, '');
  s = s.replace(/\\(?:lbrace|rbrace|quad|qquad)(?![a-zA-Z])/g, ' ');
  s = s.replace(/\\_/g, '_');
  s = s.replace(/\\[{},;:! ]/g, ' ');
  s = s.replace(/[{}]/g, ' ');
  s = s.replace(/[∼˜～〜]/g, '~').replace(/[−–—]/g, '-');
  s = s.replace(/[±∓]/g, '+-').replace(/¬/g, '!');
  s = s.replace(/&&?/g, '∧').replace(/[\^⋀]/g, '∧');
  // Words. The possibly-phrases first, so that their "add"/"delete" are not read as certain.
  const MAY = String.raw`\b(?:possibly|maybe|may|might)\s+(?:be\s+)?`;
  const ADD = String.raw`(?:add(?:s|ed)?|made\s+true|true)`;
  const DEL = String.raw`(?:delete[sd]?|del|remove[sd]?|made\s+false|false)`;
  s = s.replace(new RegExp(String.raw`${MAY}(?:${ADD}\s*(?:or|\/)\s*${DEL}|${DEL}\s*(?:or|\/)\s*${ADD})\b`, 'gi'), ' ~+- ');
  s = s.replace(new RegExp(String.raw`${MAY}${ADD}\b`, 'gi'), ' ~+ ');
  s = s.replace(new RegExp(String.raw`${MAY}${DEL}\b`, 'gi'), ' ~- ');
  // A bare "possibly X" possibly adds X; "possibly not X" possibly deletes it.
  s = s.replace(/\b(?:possibly|maybe)\s+/gi, ' ~+');
  s = s.replace(/\bnot\s+/gi, '!');
  s = s.replace(/\b(?:add|adds)\s+(?=[A-Za-z_])/gi, '+');
  s = s.replace(/\b(?:delete|deletes|del|remove|removes)\s+(?=[A-Za-z_])/gi, '!');
  s = s.replace(/\band\b/gi, '∧');
  // Markers, with any spacing collapsed: `~ + -` is `~+-`, `+/-` is `+-`, `~¬` is `~-`.
  s = s.replace(/~\s*(?:\+\s*\/?\s*-|-\s*\/?\s*\+)/g, '~+-');
  s = s.replace(/\+\s*\/\s*-/g, '+-');
  s = s.replace(/~\s*\+(?!-)/g, '~+');
  s = s.replace(/~\s*[-!]/g, '~-');
  return s;
}

/** Strips brackets that wrap the whole of `s`: `(A ∧ B)`, `[A, B]`. */
function unwrap(s: string): string {
  let t = s.trim();
  for (;;) {
    const open = t[0];
    const close = open === '(' ? ')' : open === '[' ? ']' : null;
    if (!close || t[t.length - 1] !== close) return t;
    // Only when the opening bracket closes at the very end: not `(A) ∧ (B)`.
    let depth = 0;
    let wraps = true;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      if (depth === 0 && i < t.length - 1) {
        wraps = false;
        break;
      }
    }
    if (!wraps) return t;
    t = t.slice(1, -1).trim();
  }
}

/** Splits `s` at separator characters outside brackets. Empty pieces are dropped. */
function splitTopLevel(s: string, isSep: (c: string) => boolean): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const c of s) {
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
    if (depth === 0 && isSep(c)) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((p) => p.trim()).filter((p) => p.length > 0);
}

const NAME = String.raw`[A-Za-z_][\w']*`;
const ARG_RE = /^[A-Za-z0-9_][\w']*$/;
const LITERAL_RE = new RegExp(String.raw`^(${NAME})\s*(?:\(([^()]*)\))?$`);
const EMPTY_RE = /^(?:|true|none|nothing|empty|∅|n\/a|no\s+effects?|no\s+preconditions?)$/i;
const LABEL_RE = /^\s*(?:pre(?:cond(?:ition)?s?)?|eff(?:ect)?s?)\s*[:=]\s*/i;

function readConjunct(raw: string): ParsedLiteral | null {
  let t = unwrap(raw);
  const m = /^(~\+-|~\+|~-|~|\+-|\+|-|!)?\s*/.exec(t);
  const marker = m?.[1] ?? '';
  t = t.slice(m?.[0].length ?? 0);
  let flips = 0;
  while (/^[!~-]/.test(t)) {
    flips++;
    t = t.slice(1).trimStart();
  }
  t = unwrap(t);
  const pm = LITERAL_RE.exec(t);
  if (!pm || !pm[1]) return null;
  const argText = pm[2];
  const args = argText === undefined || argText.trim() === '' ? [] : argText.split(',').map((a) => a.trim());
  if (!args.every((a) => ARG_RE.test(a))) return null;
  const pred = pm[1];
  const odd = flips % 2 === 1;
  switch (marker) {
    case '~+-':
    case '+-':
      return { pred, args, neg: false, mode: 'maybe' };
    case '~+':
      return odd ? { pred, args, neg: true, mode: 'maybe_del' } : { pred, args, neg: false, mode: 'maybe_add' };
    case '~-':
      return odd ? { pred, args, neg: false, mode: 'maybe_add' } : { pred, args, neg: true, mode: 'maybe_del' };
    case '+':
      return odd ? { pred, args, neg: true, mode: 'del' } : { pred, args, neg: false, mode: 'add' };
    case '~':
    case '-':
    case '!':
      return { pred, args, neg: !odd };
    default:
      return { pred, args, neg: odd };
  }
}

/**
 * **Reads a conjunction of literals** in whatever notation the learner used: `¬A ∧ ∼±B`,
 * `~A ^ +-B`, `not A and possibly add or delete B`, `$\neg A \wedge \sim\pm B$`, `On(A, B),
 * Clear(A)`. Names keep their spelling (comparison is case-insensitive elsewhere). "true",
 * "none", "∅", `{}` and an empty string are the empty conjunction. A leading `Precond:` or
 * `Effect:` label is ignored. Disjunction is not part of the language: `A or B` is not `ok`.
 *
 * `ok` is false when any conjunct could not be read; `literals` then holds the ones that could.
 */
export function parseLiterals(text: string): { literals: ParsedLiteral[]; ok: boolean } {
  const s = unwrap(normaliseNotation(text).replace(LABEL_RE, ''));
  if (EMPTY_RE.test(s.trim())) return { literals: [], ok: true };
  const pieces = splitTopLevel(s, (c) => c === '∧' || c === ',' || c === ';' || c === '\n');
  const literals: ParsedLiteral[] = [];
  let ok = true;
  for (const p of pieces) {
    if (/^(?:true|∅)$/i.test(p)) continue;
    const l = readConjunct(p);
    if (l) literals.push(l);
    else ok = false;
  }
  return { literals, ok };
}

/** One literal in the canonical display notation: `On(A, B)`, `¬A`, `∼+A`, `∼−A`, `∼±A`. */
export function formatLiteral(l: ParsedLiteral): string {
  const atom = l.args.length > 0 ? `${l.pred}(${l.args.join(', ')})` : l.pred;
  if (!l.mode) return l.neg ? `¬${atom}` : atom;
  switch (l.mode) {
    case 'add':
      return atom;
    case 'del':
      return `¬${atom}`;
    case 'maybe_add':
      return `∼+${atom}`;
    case 'maybe_del':
      return `∼−${atom}`;
    case 'maybe':
      return `∼±${atom}`;
  }
}

/** A conjunction in the canonical notation, joined with ` ∧ `; the empty one is `∅`. */
export function formatLiterals(lits: readonly ParsedLiteral[]): string {
  return lits.length === 0 ? '∅' : lits.map(formatLiteral).join(' ∧ ');
}

// ── STRIPS: states, ground actions, plans ───────────────────────────────────────────────────

/**
 * A state, closed world: the atoms that are true, by `atomKey`, each with the literal that made
 * it true (for its spelling). Anything absent is false.
 */
export type PlanningState = ReadonlyMap<string, Literal>;

/** A schema with its parameters bound. `clash` names a `distinct` pair bound to one object. */
export interface GroundAction {
  name: string;
  args: string[];
  pre: Literal[];
  eff: Literal[];
  clash?: [string, string];
}

/** The state in which exactly the positive literals of `lits` (and the statics) are true. */
export function stateFrom(lits: readonly Literal[], statics: readonly Literal[] = []): PlanningState {
  const s = new Map<string, Literal>();
  for (const l of [...statics, ...lits]) if (!l.neg) s.set(atomKey(l), { pred: l.pred, args: [...l.args], neg: false });
  return s;
}

/** Whether `l` holds in `state` (closed world: a negative literal holds when its atom is absent). */
export function holds(state: PlanningState, l: Literal): boolean {
  return state.has(atomKey(l)) !== l.neg;
}

/** The literals of `lits` that do not hold in `state`, in order. */
export function unmetLiterals(state: PlanningState, lits: readonly Literal[]): Literal[] {
  return lits.filter((l) => !holds(state, l));
}

/** Whether every literal of `goal` holds in `state`. */
export function satisfies(state: PlanningState, goal: readonly Literal[]): boolean {
  return goal.every((l) => holds(state, l));
}

/** `Move(X, Y, Table)`, or the bare name of an action with no arguments. */
export function formatAction(a: Pick<GroundAction, 'name' | 'args'>): string {
  return a.args.length > 0 ? `${a.name}(${a.args.join(', ')})` : a.name;
}

/**
 * Binds `schema`'s parameters to `objects`, in order. Parameters match case-insensitively; an arg
 * that is not a parameter is a constant and stays as written.
 */
export function groundAction(schema: ActionSchema, objects: readonly string[]): GroundAction {
  const bind = new Map<string, string>();
  schema.params.forEach((p, i) => bind.set(low(p), objects[i] ?? p));
  const sub = (l: Literal): Literal => ({ pred: l.pred, args: l.args.map((a) => bind.get(low(a)) ?? a), neg: l.neg });
  const g: GroundAction = {
    name: schema.name,
    args: schema.params.map((p) => bind.get(low(p)) ?? p),
    pre: schema.pre.map(sub),
    eff: schema.eff.map(sub),
  };
  for (const [p, q] of schema.distinct ?? []) {
    const a = bind.get(low(p));
    const b = bind.get(low(q));
    if (a !== undefined && b !== undefined && low(a) === low(b)) {
      g.clash = [p, q];
      break;
    }
  }
  return g;
}

/** Every grounding of every schema over the domain's objects that respects `distinct`. */
export function groundActions(domain: StripsDomain): GroundAction[] {
  const out: GroundAction[] = [];
  for (const schema of domain.actions) {
    const n = schema.params.length;
    const idx = new Array<number>(n).fill(0);
    const total = domain.objects.length ** n;
    for (let k = 0; k < total; k++) {
      let r = k;
      for (let i = n - 1; i >= 0; i--) {
        idx[i] = r % domain.objects.length;
        r = Math.floor(r / domain.objects.length);
      }
      const g = groundAction(schema, idx.map((i) => domain.objects[i] ?? ''));
      if (!g.clash) out.push(g);
    }
  }
  return out;
}

/** The first precondition of `a` that does not hold in `state`, or null. */
export function unmetPrecondition(state: PlanningState, a: GroundAction): Literal | null {
  return a.pre.find((l) => !holds(state, l)) ?? null;
}

/** Whether `a` can run in `state`: every precondition holds and no `distinct` pair clashes. */
export function applicable(state: PlanningState, a: GroundAction): boolean {
  return !a.clash && unmetPrecondition(state, a) === null;
}

/**
 * The state after `a`: deletes, then adds (so an action that both deletes and adds an atom leaves
 * it true). A static literal is never deleted.
 */
export function apply(state: PlanningState, a: GroundAction, statics: readonly Literal[] = []): PlanningState {
  const fixed = new Set(statics.filter((l) => !l.neg).map(atomKey));
  const next = new Map(state);
  for (const e of a.eff) if (e.neg && !fixed.has(atomKey(e))) next.delete(atomKey(e));
  for (const e of a.eff) if (!e.neg) next.set(atomKey(e), { pred: e.pred, args: [...e.args], neg: false });
  return next;
}

export interface RunResult {
  /** Every step could run. Whether the goal holds is a separate question (`satisfies`). */
  ok: boolean;
  /** The 0-based index of the first step that could not run. */
  failedAt: number | null;
  /** Why, in a sentence that names the step and the precondition, never the fix. */
  reason: string | null;
  /** The state after the last step that ran. */
  state: PlanningState;
}

function whyNot(state: PlanningState, a: GroundAction): string | null {
  if (a.clash) return `${formatAction(a)} binds ${a.clash[0]} and ${a.clash[1]} to the same object`;
  const miss = unmetPrecondition(state, a);
  if (!miss) return null;
  return `${formatAction(a)} cannot run: it needs ${formatLiteral(miss)}, which is ${miss.neg ? 'true' : 'false'} at that point`;
}

/** Runs `plan` from `init` (closed world, the domain's statics always true). */
export function runPlan(domain: StripsDomain, init: readonly Literal[], plan: readonly GroundAction[]): RunResult {
  const statics = domain.static ?? [];
  let state = stateFrom(init, statics);
  for (let i = 0; i < plan.length; i++) {
    const a = plan[i];
    if (!a) continue;
    const why = whyNot(state, a);
    if (why) return { ok: false, failedAt: i, reason: why, state };
    state = apply(state, a, statics);
  }
  return { ok: true, failedAt: null, reason: null, state };
}

/** Words a learner puts around a step's objects: "Move A from B to the Table". */
const FILLER = new Set(['from', 'to', 'onto', 'on', 'the', 'block', 'top', 'of']);
const NUMBERING = /^\s*(?:step\s*\d+\s*[.:)-]?|\(?\d+\s*[.:)\]]|[-*•·])\s*/i;

/** Splits a written sequence into its steps: lines, `;`, arrows, "then", commas outside brackets. */
function splitSteps(text: string): string[] {
  let s = text.replace(/\$+/g, ' ');
  s = s.replace(/^\s*(?:plan|answer|sequence)\s*:\s*/i, '');
  s = s.replace(/(?<!\bstep)\s+(?=(?:step\s*)?\d+\s*[.:)]\s)/gi, '\n');
  s = s.replace(/→|⟶|⇒|->|=>|\bthen\b|\|/gi, '\n');
  s = unwrap(s.trim());
  return splitTopLevel(s, (c) => c === ',' || c === ';' || c === '\n')
    .map((p) => p.replace(NUMBERING, '').replace(/[.]+$/, '').trim())
    .filter((p) => p.length > 0);
}

/** A step read as a name and arguments: `Move(A, B, C)`, `H1 (P1,P3)`, `H1[P1, P3]`, `Move A B C`. */
function readCall(piece: string): { name: string; args: string[] | null } | null {
  const t = piece.trim();
  const m = new RegExp(String.raw`^(${NAME})\s*[([]([^()[\]]*)[)\]]$`).exec(t);
  if (m && m[1]) return { name: m[1], args: (m[2] ?? '').split(/[,\s]+/).filter(Boolean) };
  const words = t.split(/[\s,]+/).filter(Boolean);
  const head = words[0];
  if (!head || !new RegExp(`^${NAME}$`).test(head)) return null;
  return { name: head, args: words.length > 1 ? words.slice(1) : null };
}

/**
 * **Reads a learner's plan** against a domain: `1. Move(X, Y, Table)\n2. Move(Y, Table, X)`,
 * `Move(X,Y,Table) → Move(Y,Table,X)`, `Step 1: move x from y to table, ...`. Action and object
 * names match case-insensitively and take the domain's spelling. A step that names no known
 * action, has the wrong number of objects, or names an object not in the domain is `unparsed`.
 */
export function parsePlan(text: string, domain: StripsDomain): { steps: GroundAction[]; unparsed: string[] } {
  const steps: GroundAction[] = [];
  const unparsed: string[] = [];
  const objectOf = (w: string) => domain.objects.find((o) => low(o) === low(w));
  for (const piece of splitSteps(text)) {
    const call = readCall(piece);
    const schema = call && domain.actions.find((a) => low(a.name) === low(call.name));
    if (!call || !schema) {
      unparsed.push(piece);
      continue;
    }
    const args = (call.args ?? []).filter((w) => objectOf(w) !== undefined || !FILLER.has(low(w)));
    const objs = args.map(objectOf);
    if (objs.length !== schema.params.length || objs.some((o) => o === undefined)) {
      unparsed.push(piece);
      continue;
    }
    steps.push(groundAction(schema, objs as string[]));
  }
  return { steps, unparsed };
}

/** The most states the search visits before giving up. Tutorial domains are far smaller. */
const MAX_NODES = 200_000;

function stateKey(s: PlanningState): string {
  return [...s.keys()].sort().join('|');
}

/**
 * **A shortest plan**, by breadth-first search, or null when none exists within `maxDepth` steps
 * (or within the node budget). Used to verify a key, never shown to a learner before a release.
 */
export function solvePlan(
  domain: StripsDomain,
  init: readonly Literal[],
  goal: readonly Literal[],
  maxDepth = 12,
): GroundAction[] | null {
  const statics = domain.static ?? [];
  const acts = groundActions(domain);
  const start = stateFrom(init, statics);
  if (satisfies(start, goal)) return [];
  const seen = new Set([stateKey(start)]);
  let frontier: { state: PlanningState; plan: GroundAction[] }[] = [{ state: start, plan: [] }];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next: typeof frontier = [];
    for (const node of frontier) {
      for (const a of acts) {
        if (!applicable(node.state, a)) continue;
        const s = apply(node.state, a, statics);
        const k = stateKey(s);
        if (seen.has(k)) continue;
        seen.add(k);
        const plan = [...node.plan, a];
        if (satisfies(s, goal)) return plan;
        if (seen.size > MAX_NODES) return null;
        next.push({ state: s, plan });
      }
    }
    frontier = next;
  }
  return null;
}

// ── HLAs: angelic summaries and sequences ───────────────────────────────────────────────────

export interface HlaSummary {
  precond: Literal[];
  effect: ParsedLiteral[];
}

const findAction = (actions: readonly ActionSchema[], name: string) => actions.find((a) => low(a.name) === low(name));
const findHla = (hlas: readonly HlaSpec[], name: string) => hlas.find((h) => low(h.name) === low(name));

/**
 * **An HLA's precondition and effect, derived from its implementations** (angelic semantics,
 * AIMA §11.4). Each implementation is simulated symbolically from an unknown start:
 *
 * - its **precondition** is what its steps need from the start, i.e. a step's precondition on a
 *   fluent that no earlier step of the same implementation has set (or already required). The
 *   HLA's precondition is what every implementation needs: the intersection.
 * - its **effect** on a fluent is the value the last step to touch it left, or "unchanged". Across
 *   implementations: all set it true → `X`; all false → `¬X`; some true and the rest unchanged →
 *   `∼+X`; some false and the rest unchanged → `∼−X`; some true and some false → `∼±X`.
 *
 * Implementations name primitive actions without parameters; an unknown name is skipped
 * (`validateCheck` refuses it first). Literals come out in order of first appearance.
 */
export function hlaSummary(actions: readonly ActionSchema[], hla: HlaSpec): HlaSummary {
  const impls = hla.implementations.map((impl) => {
    const known = new Map<string, boolean>();
    const required = new Map<string, Literal>();
    const changed = new Map<string, { lit: Literal; value: boolean }>();
    for (const name of impl) {
      const a = findAction(actions, name);
      if (!a) continue;
      for (const p of a.pre) {
        const k = atomKey(p);
        if (known.has(k)) continue;
        required.set(k, p);
        known.set(k, !p.neg);
      }
      for (const e of a.eff) {
        const k = atomKey(e);
        known.set(k, !e.neg);
        changed.set(k, { lit: e, value: !e.neg });
      }
    }
    return { required, changed };
  });
  const first = impls[0];
  if (!first) return { precond: [], effect: [] };
  const precond = [...first.required.entries()]
    .filter(([k, l]) => impls.every((i) => i.required.get(k)?.neg === l.neg))
    .map(([, l]) => ({ pred: l.pred, args: [...l.args], neg: l.neg }));
  const order = new Map<string, Literal>();
  for (const i of impls) for (const [k, c] of i.changed) if (!order.has(k)) order.set(k, c.lit);
  const effect: ParsedLiteral[] = [];
  for (const [k, l] of order) {
    const values = impls.map((i) => i.changed.get(k)?.value);
    const atom = { pred: l.pred, args: [...l.args] };
    const someTrue = values.includes(true);
    const someFalse = values.includes(false);
    if (values.every((v) => v === true)) effect.push({ ...atom, neg: false, mode: 'add' });
    else if (values.every((v) => v === false)) effect.push({ ...atom, neg: true, mode: 'del' });
    else if (someTrue && someFalse) effect.push({ ...atom, neg: false, mode: 'maybe' });
    else if (someTrue) effect.push({ ...atom, neg: false, mode: 'maybe_add' });
    else effect.push({ ...atom, neg: true, mode: 'maybe_del' });
  }
  return { precond, effect };
}

/**
 * Expands one step of a sequence into primitive ground actions: a primitive (`P1`, or `Move(A, B,
 * C)` for one with parameters), or an HLA with its implementation named (`H1(P1,P3)`), which must
 * be one of the HLA's own. An error is a sentence for the learner (or for the ingest's log).
 */
function expandStep(
  step: string,
  actions: readonly ActionSchema[],
  hlas: readonly HlaSpec[],
): { prims: GroundAction[] } | { error: string } {
  const call = readCall(step);
  if (!call) return { error: `"${step}" is not a step` };
  const hla = findHla(hlas, call.name);
  if (hla) {
    const args = call.args ?? [];
    if (args.length === 0) return { error: `${hla.name} needs its implementation named, as ${hla.name}(…)` };
    const impl = hla.implementations.find((im) => im.length === args.length && im.every((n, i) => low(n) === low(args[i] ?? '')));
    if (!impl) return { error: `(${args.join(', ')}) is not one of ${hla.name}'s implementations` };
    const prims: GroundAction[] = [];
    for (const n of impl) {
      const a = findAction(actions, n);
      if (!a) return { error: `${hla.name} uses ${n}, which is not an action` };
      prims.push(groundAction(a, []));
    }
    return { prims };
  }
  const a = findAction(actions, call.name);
  if (!a) return { error: `${call.name} is neither an action nor an HLA` };
  const args = call.args ?? [];
  if (args.length !== a.params.length) return { error: `${a.name} takes ${a.params.length} argument(s), not ${args.length}` };
  return { prims: [groundAction(a, args)] };
}

/**
 * **Runs a sequence of steps** (`['K1(Q1,Q3)', 'K2(Q6)', 'K3(Q8,Q9)']`) from `init`, closed world.
 * An HLA step runs its named implementation's primitives in turn. `failedAt` is the index of the
 * step (not the primitive) that could not run; `reason` names the primitive and what it needed.
 */
export function runSequence(
  actions: readonly ActionSchema[],
  hlas: readonly HlaSpec[],
  init: readonly Literal[],
  steps: readonly string[],
): RunResult {
  let state = stateFrom(init);
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] ?? '';
    const ex = expandStep(step, actions, hlas);
    if ('error' in ex) return { ok: false, failedAt: i, reason: ex.error, state };
    for (const a of ex.prims) {
      const why = whyNot(state, a);
      if (why) return { ok: false, failedAt: i, reason: ex.prims.length > 1 ? `in ${step}, ${why}` : why, state };
      state = apply(state, a);
    }
  }
  return { ok: true, failedAt: null, reason: null, state };
}

/**
 * Reads an option's text into steps: `"K1 (Q1,Q3), K2 (Q6), K3 (Q8,Q9)"` →
 * `['K1(Q1,Q3)', 'K2(Q6)', 'K3(Q8,Q9)']`. Arrows, `;`, lines and "then" separate steps too. A
 * piece that is not a call is passed through as written, for `runSequence` to refuse.
 */
export function parseSteps(text: string): string[] {
  return splitSteps(text).map((p) => {
    const c = readCall(p);
    if (!c) return p;
    return c.args === null ? c.name : `${c.name}(${c.args.join(',')})`;
  });
}

// ── Validating what the model wrote ─────────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isName = (v: unknown): v is string => typeof v === 'string' && new RegExp(`^${NAME}$`).test(v.trim());

/**
 * **Structural validation of a model-written check.** Returns a clean copy, or null with the
 * problems: unknown action names, a predicate used with different arities, an argument that is
 * neither a parameter nor an object, `distinct` pairs naming no parameter, empty implementations,
 * an option step that names no action or no implementation of its HLA, a blank naming an unknown
 * HLA. Literal lists may be given as text (`"¬A ∧ B"`); they are read with `parseLiterals`.
 *
 * Whether the check is *solvable* is not structural; `solveCheck` answers that.
 */
export function validateCheck(raw: unknown): { check: FormalCheck | null; issues: string[] } {
  const issues: string[] = [];
  const arity = new Map<string, { n: number; pred: string }>();

  const noteArity = (l: Literal) => {
    const k = low(l.pred);
    const seen = arity.get(k);
    if (!seen) arity.set(k, { n: l.args.length, pred: l.pred });
    else if (seen.n !== l.args.length) {
      const msg = `${seen.pred} is used with ${seen.n} and ${l.args.length} arguments`;
      if (!issues.includes(msg)) issues.push(msg);
    }
  };

  const readLiterals = (v: unknown, where: string): Literal[] => {
    if (v === undefined || v === null) return [];
    if (typeof v === 'string') {
      const r = parseLiterals(v);
      if (!r.ok) issues.push(`${where}: could not read "${v}"`);
      if (r.literals.some((l) => l.mode && l.mode !== 'add' && l.mode !== 'del')) issues.push(`${where}: possibly-effects belong to HLAs, not here`);
      const out = r.literals.map((l) => ({ pred: l.pred, args: l.args, neg: l.neg }));
      out.forEach(noteArity);
      return out;
    }
    if (!Array.isArray(v)) {
      issues.push(`${where}: not a list of literals`);
      return [];
    }
    const out: Literal[] = [];
    for (const item of v) {
      if (typeof item === 'string') {
        out.push(...readLiterals(item, where));
        continue;
      }
      if (!isObj(item) || !isName(item.pred)) {
        issues.push(`${where}: a literal without a predicate name`);
        continue;
      }
      const args = item.args === undefined ? [] : item.args;
      if (!Array.isArray(args) || !args.every((a) => typeof a === 'string' && ARG_RE.test(a.trim()))) {
        issues.push(`${where}: ${item.pred} has malformed arguments`);
        continue;
      }
      const l = { pred: item.pred.trim(), args: args.map((a: string) => a.trim()), neg: item.neg === true };
      noteArity(l);
      out.push(l);
    }
    return out;
  };

  const readActions = (v: unknown, objects: string[] | null): ActionSchema[] => {
    if (!Array.isArray(v) || v.length === 0) {
      issues.push('no actions');
      return [];
    }
    const out: ActionSchema[] = [];
    const names = new Set<string>();
    for (const a of v) {
      if (!isObj(a) || !isName(a.name)) {
        issues.push('an action without a name');
        continue;
      }
      const name = a.name.trim();
      if (names.has(low(name))) issues.push(`action ${name} is defined twice`);
      names.add(low(name));
      const params = a.params === undefined ? [] : a.params;
      if (!Array.isArray(params) || !params.every(isName)) {
        issues.push(`${name}: malformed parameters`);
        continue;
      }
      const ps = params.map((p: string) => p.trim());
      if (new Set(ps.map(low)).size !== ps.length) issues.push(`${name}: a parameter is named twice`);
      const pre = readLiterals(a.pre, `${name} precondition`);
      const eff = readLiterals(a.eff, `${name} effect`);
      const pset = new Set(ps.map(low));
      for (const l of [...pre, ...eff]) {
        for (const arg of l.args) {
          if (pset.has(low(arg))) continue;
          if (objects && !objects.some((o) => low(o) === low(arg)))
            issues.push(`${name}: "${arg}" in ${formatLiteral(l)} is neither a parameter nor an object`);
        }
      }
      const schema: ActionSchema = { name, params: ps, pre, eff };
      if (a.distinct !== undefined) {
        const d = a.distinct;
        if (!Array.isArray(d) || !d.every((pair) => Array.isArray(pair) && pair.length === 2 && pair.every((p: unknown) => typeof p === 'string' && pset.has(low(p))))) {
          issues.push(`${name}: distinct must pair its own parameters`);
        } else schema.distinct = d.map((pair: string[]) => [pair[0] ?? '', pair[1] ?? ''] as [string, string]);
      }
      out.push(schema);
    }
    return out;
  };

  const groundIn = (lits: Literal[], objects: string[], where: string) => {
    for (const l of lits)
      for (const arg of l.args)
        if (!objects.some((o) => low(o) === low(arg))) issues.push(`${where}: "${arg}" in ${formatLiteral(l)} is not an object`);
  };

  const readHlas = (v: unknown, actions: ActionSchema[]): HlaSpec[] => {
    if (!Array.isArray(v) || v.length === 0) {
      issues.push('no HLAs');
      return [];
    }
    const out: HlaSpec[] = [];
    for (const h of v) {
      if (!isObj(h) || !isName(h.name)) {
        issues.push('an HLA without a name');
        continue;
      }
      const name = h.name.trim();
      if (findAction(actions, name)) issues.push(`${name} is both an action and an HLA`);
      if (findHla(out, name)) issues.push(`HLA ${name} is defined twice`);
      const impls = h.implementations;
      if (!Array.isArray(impls) || impls.length === 0) {
        issues.push(`${name}: no implementations`);
        continue;
      }
      const clean: string[][] = [];
      for (const im of impls) {
        if (!Array.isArray(im) || im.length === 0 || !im.every((s) => typeof s === 'string')) {
          issues.push(`${name}: an empty or malformed implementation`);
          continue;
        }
        for (const s of im as string[]) {
          const a = findAction(actions, s);
          if (!a) issues.push(`${name}: ${s} is not an action`);
          else if (a.params.length > 0) issues.push(`${name}: ${a.name} has parameters; implementations take primitives without them`);
        }
        clean.push((im as string[]).map((s) => s.trim()));
      }
      out.push({ name, implementations: clean });
    }
    return out;
  };

  if (!isObj(raw)) return { check: null, issues: ['not an object'] };
  let check: FormalCheck | null = null;
  switch (raw.type) {
    case 'plan': {
      const d = raw.domain;
      if (!isObj(d)) {
        issues.push('plan: no domain');
        break;
      }
      const objects = Array.isArray(d.objects) && d.objects.every((o) => typeof o === 'string' && ARG_RE.test(o.trim())) ? d.objects.map((o: string) => o.trim()) : null;
      if (!objects || objects.length === 0) {
        issues.push('plan: no objects');
        break;
      }
      if (new Set(objects.map(low)).size !== objects.length) issues.push('plan: an object is listed twice');
      const actions = readActions(d.actions, objects);
      const statics = readLiterals(d.static, 'static');
      groundIn(statics, objects, 'static');
      if (statics.some((l) => l.neg)) issues.push('static: a static literal must be positive');
      const init = readLiterals(raw.init, 'init');
      const goal = readLiterals(raw.goal, 'goal');
      groundIn(init, objects, 'init');
      groundIn(goal, objects, 'goal');
      if (goal.length === 0) issues.push('goal is empty');
      const domain: StripsDomain = { objects, actions };
      if (statics.length > 0) domain.static = statics;
      check = { type: 'plan', domain, init, goal };
      break;
    }
    case 'sequences': {
      const actions = readActions(raw.actions, null);
      const hlas = raw.hlas === undefined || (Array.isArray(raw.hlas) && raw.hlas.length === 0) ? [] : readHlas(raw.hlas, actions);
      const init = readLiterals(raw.init, 'init');
      const goal = readLiterals(raw.goal, 'goal');
      if (goal.length === 0) issues.push('goal is empty');
      const options: { id: string; steps: string[] }[] = [];
      if (!Array.isArray(raw.options) || raw.options.length === 0) issues.push('no options');
      else
        for (const o of raw.options) {
          if (!isObj(o) || typeof o.id !== 'string' || o.id.trim() === '') {
            issues.push('an option without an id');
            continue;
          }
          const id = o.id.trim();
          if (options.some((x) => low(x.id) === low(id))) issues.push(`option ${id} is listed twice`);
          const steps = typeof o.steps === 'string' ? parseSteps(o.steps) : Array.isArray(o.steps) && o.steps.every((s) => typeof s === 'string') ? (o.steps as string[]).flatMap(parseSteps) : null;
          if (!steps || steps.length === 0) {
            issues.push(`option ${id}: no steps`);
            continue;
          }
          for (const s of steps) {
            const ex = expandStep(s, actions, hlas);
            if ('error' in ex) issues.push(`option ${id}: ${ex.error}`);
          }
          options.push({ id, steps });
        }
      check = { type: 'sequences', actions, hlas, init, goal, options };
      break;
    }
    case 'hla_schema': {
      const actions = readActions(raw.actions, null);
      const hlas = readHlas(raw.hlas, actions);
      const blanks: Record<string, { hla: string; field: 'precond' | 'effect' }> = {};
      if (!isObj(raw.blanks) || Object.keys(raw.blanks).length === 0) issues.push('no blanks');
      else
        for (const [id, b] of Object.entries(raw.blanks)) {
          if (!isObj(b) || typeof b.hla !== 'string' || (b.field !== 'precond' && b.field !== 'effect')) {
            issues.push(`blank ${id}: needs an hla and a field (precond or effect)`);
            continue;
          }
          const h = findHla(hlas, b.hla);
          if (!h) issues.push(`blank ${id}: ${b.hla} is not an HLA`);
          blanks[id] = { hla: h?.name ?? b.hla, field: b.field };
        }
      check = { type: 'hla_schema', actions, hlas, blanks };
      break;
    }
    default:
      issues.push(`unknown check type ${JSON.stringify(raw.type)}`);
  }
  return issues.length > 0 ? { check: null, issues } : { check, issues };
}

// ── Solving and judging ─────────────────────────────────────────────────────────────────────

export interface CheckSolution {
  /** `plan`: a shortest plan, formatted; absent when none was found. */
  plan?: string[];
  /** `sequences`: the ids of the options that reach the goal. */
  correct?: string[];
  /** `hla_schema`: each blank's answer in the canonical notation. */
  blanks?: Record<string, string>;
}

function reachesGoal(check: Extract<FormalCheck, { type: 'sequences' }>, steps: readonly string[]): RunResult & { reaches: boolean } {
  const r = runSequence(check.actions, check.hlas, check.init, steps);
  return { ...r, reaches: r.ok && satisfies(r.state, check.goal) };
}

function blankAnswer(check: Extract<FormalCheck, { type: 'hla_schema' }>, id: string): ParsedLiteral[] | null {
  const b = check.blanks[id];
  const h = b && findHla(check.hlas, b.hla);
  if (!b || !h) return null;
  const s = hlaSummary(check.actions, h);
  return b.field === 'precond' ? s.precond : s.effect;
}

/** **What code says the answer is**, for the key at ingest. Run `validateCheck` first. */
export function solveCheck(check: FormalCheck): CheckSolution {
  switch (check.type) {
    case 'plan': {
      const p = solvePlan(check.domain, check.init, check.goal);
      return p ? { plan: p.map(formatAction) } : {};
    }
    case 'sequences':
      return { correct: check.options.filter((o) => reachesGoal(check, o.steps).reaches).map((o) => o.id) };
    case 'hla_schema': {
      const blanks: Record<string, string> = {};
      for (const id of Object.keys(check.blanks)) {
        const lits = blankAnswer(check, id);
        if (lits) blanks[id] = formatLiterals(lits);
      }
      return { blanks };
    }
  }
}

export interface FormalAnswer {
  /** The answer slot's text (`plan`). */
  text: string;
  /** Each blank's text, by blank id (`hla_schema`). */
  blanks: Record<string, string>;
  /** The ticked option ids (`sequences`). */
  picked: string[];
}

export interface FormalJudgement {
  verdict: CoreVerdict;
  /** What is right and what is wrong, for Max to voice. Never the missing piece itself. */
  detail: string;
  /** False when part of the answer was ignored (an unknown option id); the verdict still stands. */
  parsed: boolean;
}

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];
const count = (n: number): string => NUMBER_WORDS[n] ?? String(n);
const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** A list in prose: `i`, `i and ii`, `i, ii and iii`. */
function prose(xs: readonly string[]): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

/**
 * What is wrong with a learner's literal set, by *kind* only: never which literal is missing, and
 * never what a wrong one should have been. Each message takes a count.
 */
function literalDiff(expected: readonly ParsedLiteral[], got: readonly ParsedLiteral[], field: 'precond' | 'effect'): string[] {
  const kindOf = (l: ParsedLiteral, certainOnly: boolean): EffectMode => (certainOnly ? (l.neg ? 'del' : 'add') : effectKind(l));
  const exp = new Map(expected.map((l) => [atomKey(l), kindOf(l, field === 'precond')]));
  const mine = new Map<string, Set<EffectMode>>();
  for (const l of got) {
    const k = atomKey(l);
    const set = mine.get(k) ?? new Set<EffectMode>();
    set.add(effectKind(l));
    mine.set(k, set);
  }
  const tally = new Map<string, number>();
  const note = (key: string) => tally.set(key, (tally.get(key) ?? 0) + 1);
  const certain = (k: EffectMode) => k === 'add' || k === 'del';
  for (const [k, want] of exp) {
    const have = mine.get(k);
    if (!have) {
      note('missing');
      continue;
    }
    if (have.size > 1) {
      note('twice');
      continue;
    }
    const kind = [...have][0] as EffectMode;
    if (kind === want) continue;
    if (field === 'precond') note(certain(kind) ? 'sign' : 'precond_possible');
    else if (certain(want) && certain(kind)) note('sign');
    else if (certain(want)) note('possible_not_certain');
    else if (certain(kind)) note('certain_not_possible');
    else if (want === 'maybe') note('one_way');
    else if (kind === 'maybe') note('both_ways');
    else note('wrong_way');
  }
  for (const k of mine.keys()) if (!exp.has(k)) note('extra');
  const noun = field === 'precond' ? 'precondition literal' : 'effect';
  const MESSAGES: Record<string, (n: number) => string> = {
    missing: (n) => `${count(n)} ${n === 1 ? 'literal is' : 'literals are'} missing`,
    extra: (n) => `${count(n)} ${n === 1 ? 'literal does' : 'literals do'} not belong in it`,
    twice: (n) => `${count(n)} ${n === 1 ? 'literal is' : 'literals are'} given twice, in different forms`,
    sign: (n) => `${count(n)} ${noun}${n === 1 ? ' has' : 's have'} the wrong sign`,
    precond_possible: (n) => `${count(n)} precondition ${n === 1 ? 'literal is' : 'literals are'} marked possible, but a precondition is always certain`,
    possible_not_certain: (n) => `${count(n)} ${n === 1 ? 'effect is' : 'effects are'} marked possible where ${n === 1 ? 'it is' : 'they are'} certain`,
    certain_not_possible: (n) => `${count(n)} ${n === 1 ? 'effect is' : 'effects are'} certain where ${n === 1 ? 'it' : 'they'} should be possible`,
    one_way: (n) => `${count(n)} possible ${n === 1 ? 'effect goes' : 'effects go'} only one way where ${n === 1 ? 'it' : 'they'} can go either way`,
    both_ways: (n) => `${count(n)} possible ${n === 1 ? 'effect goes' : 'effects go'} either way where ${n === 1 ? 'it' : 'they'} can go only one way`,
    wrong_way: (n) => `${count(n)} possible ${n === 1 ? 'effect goes' : 'effects go'} the wrong way`,
  };
  return [...tally.entries()].map(([k, n]) => MESSAGES[k]?.(n) ?? k);
}

/**
 * **Judges a learner's answer by computation**, or returns null when the answer could not be read
 * (the caller then asks the model, as for any part without a check):
 *
 * - `plan` — complete iff every step runs and the goal holds at the end; otherwise not yet. The
 *   detail names the learner's own first failing step and the precondition it lacked, or the goal
 *   literals that do not hold, and never a step of the right plan. Null when a step cannot be read.
 * - `sequences` — complete iff the ticked set is exactly the set that reaches the goal; partial
 *   when it shares at least one; otherwise not yet. Says which ticks are right, why a wrong tick
 *   fails, and how many correct options are unticked (never which).
 * - `hla_schema` — per blank, the literal sets are compared in any order and notation; a
 *   possibly-marker mismatch (`B` for `∼±B`) is wrong for that literal. All blanks right →
 *   complete, some → partial. The detail says, per blank, right or what *kind* of thing is off.
 */
export function judgeFormal(check: FormalCheck, answer: FormalAnswer): FormalJudgement | null {
  switch (check.type) {
    case 'plan': {
      const { steps, unparsed } = parsePlan(answer.text, check.domain);
      if (steps.length === 0 || unparsed.length > 0) return null;
      const run = runPlan(check.domain, check.init, steps);
      if (!run.ok && run.failedAt !== null)
        return {
          verdict: 'not_yet',
          detail: `Step ${run.failedAt + 1}, ${run.reason}.${run.failedAt > 0 ? ' The steps before it run.' : ''}`,
          parsed: true,
        };
      const unmet = unmetLiterals(run.state, check.goal);
      if (unmet.length > 0)
        return {
          verdict: 'not_yet',
          detail: `Every step runs, but at the end ${prose(unmet.map((l) => formatLiteral(l)))} ${unmet.length === 1 ? 'does' : 'do'} not hold.`,
          parsed: true,
        };
      const shorter = steps.length > 1 ? solvePlan(check.domain, check.init, check.goal, steps.length - 1) : null;
      return {
        verdict: 'complete',
        detail: `Every step runs and the goal holds at the end.${shorter ? ` A plan with fewer steps (${shorter.length}) also exists.` : ''}`,
        parsed: true,
      };
    }
    case 'sequences': {
      const known = answer.picked.map((p) => check.options.find((o) => low(o.id) === low(p))).filter((o) => o !== undefined);
      const picked = [...new Set(known)];
      if (picked.length === 0) return null;
      const runs = new Map(check.options.map((o) => [o.id, reachesGoal(check, o.steps)]));
      const correct = check.options.filter((o) => runs.get(o.id)?.reaches).map((o) => o.id);
      const right = picked.filter((o) => correct.includes(o.id)).map((o) => o.id);
      const wrong = picked.filter((o) => !correct.includes(o.id));
      const missed = correct.filter((id) => !picked.some((o) => o.id === id)).length;
      const lines: string[] = [];
      if (right.length > 0) lines.push(`${prose(right)} ${right.length === 1 ? 'reaches' : 'reach'} the goal.`);
      for (const o of wrong) {
        const r = runs.get(o.id);
        if (r && !r.ok) lines.push(`${o.id} does not: at step ${(r.failedAt ?? 0) + 1}, ${r.reason}.`);
        else lines.push(`${o.id} does not: every step runs, but the goal does not hold at the end.`);
      }
      if (missed > 0) lines.push(`${capitalise(count(missed))} more ${missed === 1 ? 'option reaches' : 'options reach'} it.`);
      const verdict: CoreVerdict = wrong.length === 0 && missed === 0 ? 'complete' : right.length > 0 ? 'partial' : 'not_yet';
      return { verdict, detail: lines.join(' '), parsed: picked.length === answer.picked.length };
    }
    case 'hla_schema': {
      const ids = Object.keys(check.blanks);
      let rightCount = 0;
      const lines: string[] = [];
      for (const id of ids) {
        const field = check.blanks[id]?.field ?? 'effect';
        const expected = blankAnswer(check, id);
        if (!expected) return null;
        const text = answer.blanks[id] ?? '';
        if (text.trim() === '') {
          lines.push(`${id}: still empty.`);
          continue;
        }
        const r = parseLiterals(text);
        if (!r.ok) return null;
        const diff = literalDiff(expected, r.literals, field);
        if (diff.length === 0) {
          rightCount++;
          lines.push(`${id}: right.`);
        } else lines.push(`${id}: not yet — ${diff.join('; ')}.`);
      }
      const verdict: CoreVerdict = rightCount === ids.length ? 'complete' : rightCount > 0 ? 'partial' : 'not_yet';
      return { verdict, detail: lines.join(' '), parsed: true };
    }
  }
}
