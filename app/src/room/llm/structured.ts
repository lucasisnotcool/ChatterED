/**
 * **Structured output, when the provider cannot promise it.**
 *
 * The Claude CLI enforces `LlmRequest.jsonSchema`, and the Anthropic API does unless the schema is
 * too large to compile (`anthropic.ts`, which then falls back to `schemaInstruction`). OpenAI
 * and Gemini do too when the schema is inside what their constrained decoder accepts; an
 * arbitrary OpenAI-compatible endpoint (Ollama, LM Studio, a vLLM box, a router) may accept
 * `json_schema`, may accept only `json_object`, or may reject both. Every caller of a structured
 * call already treats an unparseable answer as "stay quiet" (the orchestrator, the ledger, the
 * doc-edit planner) — so the job here is to make an unparseable answer rare, not impossible:
 *
 *  - `schemaInstruction()` — the schema, stated in the prompt, for the endpoints that cannot be
 *    told it any other way;
 *  - `extractJson()` — the first balanced `{…}` (or `[…]`) in a reply that wrapped it in prose
 *    or a code fence, which is the same unwrapping `claude-cli.ts` does as its last resort.
 *
 * Portable, no imports.
 */

/** True when `text` is valid JSON as it stands. */
export function parsesAsJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * The JSON inside a reply, or null. Tries, in order: the text itself; the body of a ```json
 * fence; the first balanced object or array that parses. Strings are respected, so a `}` inside a
 * quoted value does not end the object early.
 */
export function extractJson(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  if (parsesAsJson(trimmed)) return trimmed;

  const fence = /```(?:json)?\s*\n?([\s\S]*?)```/i.exec(trimmed);
  if (fence && parsesAsJson(fence[1]!.trim())) return fence[1]!.trim();

  for (let start = 0; start < trimmed.length; start += 1) {
    const open = trimmed[start];
    if (open !== '{' && open !== '[') continue;
    const candidate = balancedFrom(trimmed, start);
    if (candidate && parsesAsJson(candidate)) return candidate;
  }
  return null;
}

function balancedFrom(text: string, start: number): string | null {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return null;
      if (stack.length === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * The instruction that goes into the system prompt when the endpoint cannot be handed the schema
 * as a parameter (or refused it). Worded as a contract, not a request, and it names the schema in
 * full: a model that has to guess the field names will guess differently from the parser.
 */
export function schemaInstruction(schema: Record<string, unknown>): string {
  return [
    'Reply with a single JSON value that validates against this JSON Schema.',
    'Output the JSON only: no prose before or after it, and no code fence.',
    '',
    JSON.stringify(schema),
  ].join('\n');
}

/**
 * Whether a JSON Schema already satisfies OpenAI's **strict** structured-output rules, so it can
 * be sent with `strict: true` unchanged: every object lists all of its properties in `required`
 * and sets `additionalProperties: false`, and no keyword outside the supported subset appears.
 *
 * Deliberately a *check*, not a rewrite. The usual rewrite — make every optional property
 * required-and-nullable — changes what the model sends (`null` where the caller expects the key
 * to be absent), and the parsers downstream were written against the schema as it is. A schema
 * that fails the check goes with `strict: false`, which OpenAI still uses to steer the output;
 * the caller's own parse-failure path covers the rest.
 */
export function isStrictCompatible(schema: unknown): boolean {
  const UNSUPPORTED = new Set(['patternProperties', 'if', 'then', 'else', 'not', 'dependentRequired', 'dependentSchemas', 'unevaluatedProperties']);
  const visit = (node: unknown): boolean => {
    if (Array.isArray(node)) return node.every(visit);
    if (!node || typeof node !== 'object') return true;
    const obj = node as Record<string, unknown>;
    for (const key of Object.keys(obj)) if (UNSUPPORTED.has(key)) return false;
    const type = obj.type;
    const isObject = type === 'object' || (Array.isArray(type) && type.includes('object')) || 'properties' in obj;
    if (isObject) {
      const props = (obj.properties ?? {}) as Record<string, unknown>;
      if (obj.additionalProperties !== false) return false;
      const required = Array.isArray(obj.required) ? (obj.required as string[]) : [];
      for (const key of Object.keys(props)) if (!required.includes(key)) return false;
      if (!Object.values(props).every(visit)) return false;
    }
    for (const key of ['items', 'anyOf', 'allOf', 'oneOf', 'prefixItems', '$defs', 'definitions']) {
      const child = obj[key];
      if (child === undefined) continue;
      if (key === '$defs' || key === 'definitions') {
        if (!Object.values(child as Record<string, unknown>).every(visit)) return false;
      } else if (!visit(child)) return false;
    }
    return true;
  };
  return visit(schema);
}
