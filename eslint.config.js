import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'build', 'coverage', 'playwright-report', 'test-results', 'eslint.config.js', 'scripts/*.mjs', 'ios', 'public', 'supabase/functions', 'services/api', 'services/speechkit-relay'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/exhaustive-deps': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
    },
  },
  {
    files: ['src/app/**/*.{ts,tsx}', 'src/features/**/*.{ts,tsx}', 'src/shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: '@supabase/supabase-js', message: 'Supabase доступен только query-слою.' },
          { name: '../../data/supabase', message: 'Используйте repository.' },
        ],
        patterns: [{ group: ['**/data/queries/**'], message: 'UI вызывает repositories, а не queries.' }],
      }],
    },
  },
  {
    files: ['src/data/repositories/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{ name: '@supabase/supabase-js', message: 'SDK доступен только query-слою.' }],
        patterns: [{ group: ['**/supabase'], message: 'Repository вызывает query module.' }],
      }],
    },
  },
)
