'use strict';

module.exports = [
  { ignores: ['node_modules/**', 'public/vendor/**', 'coverage/**'] },
  {
    files: ['server.js', 'lib/**/*.js', 'scripts/**/*.js', 'test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { Buffer: 'readonly', __dirname: 'readonly', console: 'readonly', fetch: 'readonly', process: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly' }
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }]
    }
  },
  {
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        CSS: 'readonly', FileReader: 'readonly', FormData: 'readonly', Intl: 'readonly', Map: 'readonly',
        document: 'readonly', fetch: 'readonly', io: 'readonly', localStorage: 'readonly', sessionStorage: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly', window: 'readonly'
      }
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }]
    }
  }
];
