const js = require('@eslint/js');
const globals = require('globals');
const tseslint = require('@typescript-eslint/eslint-plugin');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'WAProto/index.js',
      'WAProto/index.d.ts',
      'lib/**/*.d.ts'
    ]
  },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.cjs'],
    linterOptions: {
      reportUnusedDisableDirectives: 'off'
    },
    plugins: { '@typescript-eslint': tseslint },
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        console: 'readonly',
        process: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        fetch: 'readonly',
        AbortController: 'readonly'
      }
    },
    rules: {
      // This repository ships generated/transpiled CommonJS. These rules are
      // useful during a TS-source migration, but blocking them here prevents the
      // current distributable build from being verified.
      'no-case-declarations': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-extra-boolean-cast': 'off',
      'no-prototype-builtins': 'off',
      'no-redeclare': 'off',
      'no-unassigned-vars': 'off',
      'no-useless-assignment': 'off',
      'no-useless-escape': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'preserve-caught-error': 'off',
      '@typescript-eslint/no-unused-vars': 'off'
    }
  }
];
