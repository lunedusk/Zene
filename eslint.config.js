import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

/**
 * TypeScript-aware ESLint flat config (check-only via `npm run lint`).
 * Autofix: `npm run lint:fix`.
 *
 * ESLint 10.x + @typescript-eslint/* 8.x (TypeScript 6, Node ^20.19).
 * Non-type-aware rules only.
 */
export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      'apps/web/dist/**',
      'core/**',
      'plugins/**',
      'scripts/**',
      'database/**',
      'types/**',
      'index.js',
      'docs/**',
      'coverage/**',
      'tmp/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx,mts,cts,d.ts}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      'no-undef': 'off',
      'no-redeclare': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description' },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
