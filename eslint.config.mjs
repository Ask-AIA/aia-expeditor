// ESLint 9 flat config for the AIA Expeditor monorepo.
// Enforces the hexagonal layer rules from docs/MUSE_CODE_SPEC.md §5.2.
// NOTE: `boundaries/element-types` is the rule name required by spec §6. In
// eslint-plugin-boundaries v7 it is a deprecated alias of `boundaries/dependencies`
// (same options, same enforcement); the alias is kept for spec compliance.
import eslint from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    name: 'global-ignores',
    ignores: [
      '.git/',
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      'pnpm-lock.yaml',
      'storage/**',
      'eval/results/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    name: 'typescript-project-service',
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    name: 'javascript-no-type-checking',
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      // Every JS file in this repo is a Node script (configs, tooling).
      globals: { ...globals.node },
    },
  },
  {
    name: 'expeditor-typescript',
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
      // NestJS modules are empty classes whose behavior comes from decorators.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
    },
  },
  {
    name: 'expeditor-boundaries',
    plugins: { boundaries },
    settings: {
      'boundaries/root-path': import.meta.dirname,
      // The boundaries plugin resolves relative imports through eslint-module-utils.
      // The node resolver needs TS extensions to classify extensionless TS imports.
      'import/resolver': {
        node: {
          extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx', '.json'],
        },
      },
      'boundaries/elements': [
        { type: 'domain', pattern: ['**/domain/**', '**/shared/kernel/**'] },
        { type: 'application', pattern: ['**/application/**'] },
        { type: 'infrastructure', pattern: ['**/infrastructure/**'] },
        { type: 'presentation', pattern: ['**/presentation/**'] },
      ],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'allow',
          // External targets must be evaluated so `domain` can ban them.
          checkAllOrigins: true,
          policies: [
            {
              from: { element: { type: 'domain' } },
              disallow: { to: { module: { origin: 'external' } } },
              message:
                'domain must be framework-free: external packages are not allowed here (spec §5.2)',
            },
            {
              from: { element: { type: 'domain' } },
              disallow: { to: { element: { type: '!domain' }, module: { origin: 'local' } } },
              message: 'domain must not depend on other layers (spec §5.2)',
            },
            {
              from: { element: { type: 'application' } },
              disallow: {
                to: {
                  element: { types: { noneOf: ['domain', 'application'] } },
                  module: { origin: 'local' },
                },
              },
              message: 'application may only depend on domain (spec §5.2)',
            },
            {
              from: { element: { type: 'infrastructure' } },
              disallow: {
                to: {
                  element: { types: { noneOf: ['domain', 'application', 'infrastructure'] } },
                  module: { origin: 'local' },
                },
              },
              message: 'infrastructure may only depend on application and domain (spec §5.2)',
            },
            {
              from: { element: { type: 'presentation' } },
              disallow: {
                to: {
                  element: { types: { noneOf: ['application', 'presentation'] } },
                  module: { origin: 'local' },
                },
              },
              message: 'presentation may only depend on application (spec §5.2)',
            },
          ],
        },
      ],
    },
  },
  eslintConfigPrettier,
);
