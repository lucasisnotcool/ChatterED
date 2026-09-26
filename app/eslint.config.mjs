import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';

export default tseslint.config(
  { ignores: ['dist/**', 'out/**', 'node_modules/**', '*.config.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    // Svelte components and rune modules: TypeScript inside <script lang="ts">.
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.svelte'],
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    files: ['**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'src/room/**/*.ts', 'src/test-support/**/*.ts', 'src/**/*.test.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/renderer/**/*.ts', 'src/renderer/**/*.svelte'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // ── The whisper invariant, as a lint rule (architecture-mac.md §D.4). ──
    // Only src/room/context.ts may import the whispers repository. Everything that
    // assembles a group-scope prompt is therefore structurally unable to see a whisper.
    files: ['src/**/*.ts'],
    ignores: ['src/room/context.whisper.ts', 'src/**/*.test.ts', 'src/test-support/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['**/repos/whispers', '**/repos/whispers.js', '**/prompts.whisper', '**/prompts.whisper.js'],
            message:
              'Only src/room/context.whisper.ts may import the whisper repository or role block (architecture-mac.md §D.4 whisper invariant). src/main/db/store.ts is the one allowlisted composition root and carries an explicit eslint-disable.',
          },
        ],
      }],
    },
  },
  {
    files: ['src/room/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'electron', message: 'src/room must stay portable — no Electron imports (architecture-mac.md §B.1).' },
          { name: 'better-sqlite3', message: 'src/room must stay portable — it takes a Store interface, not a driver.' },
          { name: 'firebase', message: 'src/room must stay portable — no Firebase imports.' },
        ],
        patterns: [
          {
            group: ['**/repos/whispers', '**/repos/whispers.js'],
            message: 'Only src/room/context.whisper.ts may import the whispers repository.',
          },
        ],
      }],
    },
  },
  {
    // ── The shared core, as a lint rule (SCOPE.md zone 2, #54). ──
    // src/core is the code the group project takes and a teammate may read, so it imports
    // nothing outside itself: no room, main, renderer or shared module, and no package. The
    // app depends on the core, never the other way round. Tests may import vitest.
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            regex: '^(?!\\./[^/]+$|vitest$)',
            message:
              'src/core imports only its own modules (./x.js) — SCOPE.md zone 2. Move the dependency into core, or keep this code out of it.',
          },
        ],
      }],
    },
  },
);
