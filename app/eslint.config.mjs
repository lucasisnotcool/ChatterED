import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';

export default tseslint.config(
  { ignores: ['dist/**', 'out/**', 'node_modules/**', '*.config.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs['flat/recommended'],
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
    ignores: ['src/room/context.ts', 'src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['**/repos/whispers', '**/repos/whispers.js', '**/room/whispers'],
            message:
              'Only src/room/context.ts may import the whispers repository (architecture-mac.md §D.4 whisper invariant).',
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
            message: 'Only src/room/context.ts may import the whispers repository.',
          },
        ],
      }],
    },
  },
);
