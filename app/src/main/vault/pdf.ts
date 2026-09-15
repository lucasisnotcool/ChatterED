/**
 * Per-page PDF text extraction, in the Electron main process (issue #22).
 *
 * It lives here and not in `src/room` for the reason the ESLint portability rule exists
 * (architecture-mac.md §B.1): the room package receives plain text and must not know that
 * pdf.js, a filesystem or Electron are involved.
 *
 * The awkward part is loading pdf.js at all. pdfjs-dist v4+ is ESM-only, and this file is
 * compiled by `tsc` with `module: "CommonJS"`, which rewrites a literal `import()` into a
 * `require()` — and `require()` cannot load ESM. `new Function('s', 'return import(s)')` is
 * opaque to the compiler, so the emitted JS keeps a real dynamic import.
 *
 * The text this produces is a *record*, not a prompt for reasoning: architecture-mac.md §E.1
 * accepts that "maths and multi-column layouts come out scrambled". That is fine for the search
 * index and for the page text attached to a "Show the room" reference; it is not a substitute
 * for sending Sonnet the actual PDF pages (§E.1 track 2), which remains the concept-pack path.
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import * as vm from 'node:vm';

export interface PdfPage {
  page: number;
  text: string;
}

export interface PdfExtract {
  pageCount: number;
  pages: PdfPage[];
}

/** ESM entry point. The `legacy` build is the one pdf.js supports under Node. */
const PDFJS_ENTRY = 'pdfjs-dist/legacy/build/pdf.mjs';
const PDFJS_WORKER = 'pdfjs-dist/legacy/build/pdf.worker.mjs';

type Importer = (specifier: string) => Promise<PdfjsModule>;

/**
 * `new Function` is opaque to both tsc and Vite, so the emitted JS keeps a real
 * `import()`. It is the fast path (plain Node, Electron main).
 */
const functionImport = new Function('s', 'return import(s)') as Importer;

/**
 * Fallback for hosts that evaluate modules inside a `vm` without a
 * dynamic-import callback (vitest's module runner throws
 * "A dynamic import callback was not specified" on the line above).
 * `runInThisContext` + USE_MAIN_CONTEXT_DEFAULT_LOADER compiles the importer in
 * the main context, which always has one.
 */
function vmImport(specifier: string): Promise<PdfjsModule> {
  const fn = vm.runInThisContext('(s) => import(s)', {
    filename: 'pdfjs-dynamic-import.js',
    importModuleDynamically: (
      vm as unknown as { constants: { USE_MAIN_CONTEXT_DEFAULT_LOADER: symbol } }
    ).constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
  } as vm.RunningScriptOptions) as Importer;
  return fn(specifier);
}

async function importEsm(specifier: string): Promise<PdfjsModule> {
  try {
    return await functionImport(specifier);
  } catch (err) {
    return await vmImport(specifier).catch(() => {
      throw err;
    });
  }
}

/** Absolute on-disk resolution, so the import never depends on cwd or on the host's realm. */
function resolveEsm(specifier: string): string {
  try {
    const base =
      typeof __filename === 'string' ? __filename : `${process.cwd()}/__pdfjs_resolve__.js`;
    const localRequire: NodeRequire | undefined =
      typeof require === 'function' ? require : undefined;
    const req = localRequire ?? createRequire(base);
    return pathToFileURL(req.resolve(specifier)).href;
  } catch {
    return specifier; // bare specifier: let the host resolve it (e.g. inside an asar archive)
  }
}

interface TextItem {
  str: string;
  hasEOL?: boolean;
  transform?: number[];
}

export interface PdfjsModule {
  getDocument(src: Record<string, unknown>): {
    promise: Promise<PdfDocument>;
    destroy(): Promise<void>;
  };
  GlobalWorkerOptions: { workerSrc: string };
  VerbosityLevel: { ERRORS: number; WARNINGS: number; INFOS: number };
}

interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<{
    getTextContent(opts?: Record<string, unknown>): Promise<{ items: Array<TextItem | object> }>;
    cleanup(): void;
  }>;
  cleanup(): Promise<void>;
}

/**
 * pdf.js emits a few `console.log("Warning: ...")` lines while its module body
 * evaluates (e.g. the optional `@napi-rs/canvas` peer is absent, which is what
 * we want — no native modules). That happens before any `verbosity` option can
 * apply, so filter those specific lines for the duration of the import only.
 */
async function withoutPdfjsBanner<T>(fn: () => Promise<T>): Promise<T> {
  const real = { log: console.log, warn: console.warn };
  const filter =
    (fallback: (...a: unknown[]) => void) =>
    (...args: unknown[]): void => {
      if (typeof args[0] === 'string' && args[0].startsWith('Warning: ')) return;
      fallback.apply(console, args);
    };
  console.log = filter(real.log);
  console.warn = filter(real.warn);
  try {
    return await fn();
  } finally {
    console.log = real.log;
    console.warn = real.warn;
  }
}

let pdfjsPromise: Promise<PdfjsModule> | undefined;

/**
 * Load pdf.js once, worker disabled, warnings silenced.
 *
 * Exported because `vault/geometry.ts` (issue #25 Stage 1) needs the *same* module instance and
 * the same ESM-under-CommonJS dance; loading pdf.js twice would parse the 3 MB bundle twice and
 * give two `GlobalWorkerOptions` objects to keep in step.
 */
export function loadPdfjs(): Promise<PdfjsModule> {
  pdfjsPromise ??= (async () => {
    const mod = await withoutPdfjsBanner(() => importEsm(resolveEsm(PDFJS_ENTRY)));
    // Under Node, pdf.js forces its in-process "fake worker" (no worker thread,
    // no child process) and defaults workerSrc to ./pdf.worker.mjs next to
    // pdf.mjs. Pin it to an absolute URL so that in-process load is deterministic.
    const workerSrc = resolveEsm(PDFJS_WORKER);
    if (workerSrc.startsWith('file:')) mod.GlobalWorkerOptions.workerSrc = workerSrc;
    return mod;
  })();
  return pdfjsPromise;
}

/** Join text items into readable lines using hasEOL and y-coordinate breaks. */
function itemsToText(items: Array<TextItem | object>): string {
  const lines: string[] = [];
  let current = '';
  let lastY: number | null = null;

  for (const raw of items) {
    const item = raw as TextItem;
    if (typeof item.str !== 'string') continue; // marked-content items

    const y = Array.isArray(item.transform) ? (item.transform[5] ?? null) : null;
    if (current !== '' && lastY !== null && y !== null && Math.abs(y - lastY) > 1) {
      lines.push(current);
      current = '';
    }
    current += item.str;
    if (y !== null) lastY = y;

    if (item.hasEOL) {
      if (current.trim() !== '') lines.push(current);
      current = '';
      lastY = null;
    }
  }
  if (current.trim() !== '') lines.push(current);

  return lines
    .map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The options every `getDocument` call in this app uses: no worker thread, no network, no
 * canvas, no standard-font fetches. Shared with `vault/geometry.ts` so the two passes cannot
 * drift into reading the same file under different rules.
 */
export function docOptions(bytes: Uint8Array, pdfjs: PdfjsModule): Record<string, unknown> {
  return {
    data: bytes,
    isEvalSupported: false,
    useSystemFonts: false,
    useWorkerFetch: false,
    disableFontFace: true,
    stopAtErrors: false,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  };
}

/** Extract text per page. `range` is 1-indexed inclusive; omit for the whole document. */
export async function extractPdfText(
  filePath: string,
  range?: { from: number; to: number },
): Promise<PdfExtract> {
  const pdfjs = await loadPdfjs();
  const bytes = new Uint8Array(await readFile(filePath));

  const task = pdfjs.getDocument(docOptions(bytes, pdfjs));

  let doc: PdfDocument | undefined;
  try {
    doc = await task.promise;
    const pageCount = doc.numPages;

    const from = Math.max(1, range?.from ?? 1);
    const to = Math.min(pageCount, range?.to ?? pageCount);

    const pages: PdfPage[] = [];
    for (let n = from; n <= to; n += 1) {
      let text = '';
      try {
        const page = await doc.getPage(n);
        try {
          const content = await page.getTextContent({
            includeMarkedContent: false,
            disableNormalization: false,
          });
          text = itemsToText(content.items);
        } finally {
          page.cleanup();
        }
      } catch {
        text = ''; // scanned / damaged page: empty, never a throw
      }
      pages.push({ page: n, text });
    }
    return { pageCount, pages };
  } finally {
    if (doc) await doc.cleanup().catch(() => undefined);
    // Destroying the loading task tears down the document and its transport.
    await task.destroy().catch(() => undefined);
  }
}
