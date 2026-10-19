import { androidOtaPolicy } from './scripts/android-ota-contract.mjs'
import { fileURLToPath } from 'node:url'
import { isLocalLegacyBuild, assertNativeFrontendModules } from './src/app/composition-build-boundary'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  define: { __FIT_ANDROID_OTA_POLICY__: JSON.stringify(androidOtaPolicy()) },
  resolve: { alias: {
    '#fit/local-auth': fileURLToPath(new URL(isLocalLegacyBuild(mode)
      ? './src/app/local-auth-composition.ts'
      : './src/app/native-only-composition.ts', import.meta.url)),
    '#fit/local-data': fileURLToPath(new URL(isLocalLegacyBuild(mode)
      ? './src/app/local-data-composition.ts'
      : './src/app/native-only-composition.ts', import.meta.url)),
    '#fit/local-assistant': fileURLToPath(new URL(isLocalLegacyBuild(mode)
      ? './src/app/local-assistant-composition.ts'
      : './src/app/native-only-composition.ts', import.meta.url)),
  } },
  plugins: [react(), {
    name: 'fit-native-composition-boundary',
    apply: 'build',
    generateBundle(_options, bundle) {
      const policy = androidOtaPolicy()
      this.emitFile({ type: 'asset', fileName: 'android-ota-build.json', source: JSON.stringify({
        abi: policy.abi, enabled: policy.enabled, sourceCommit: process.env.FIT_SOURCE_COMMIT ?? '',
        apiBaseUrl: process.env.VITE_YANDEX_API_BASE_URL ?? '',
      }) })
      if (isLocalLegacyBuild(mode)) return
      assertNativeFrontendModules(Object.values(bundle).flatMap((item) => item.type === 'chunk' ? Object.keys(item.modules) : []))
    },
  }, {
    name: 'fit-nonblocking-startup-styles',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => html.replace(
        /<link\b[^>]*\brel="stylesheet"[^>]*>/g,
        (link) => [
          // Retain normal critical-CSS priority without blocking the first paint.
          link.replace('rel="stylesheet"', 'rel="preload" as="style"'),
          link.replace(/\s*\/?>$/, ' media="print" data-fit-app-styles>'),
        ].join('\n'),
      ),
    },
  }],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
      exclude: [
        'src/data/database.types.ts',
        'src/main.tsx',
        'src/data/repositories/auth.repository.ts',
        // Тонкие обёртки над supabase.rpc()/.from(...) — по конвенции проекта
        // тесты мокают их на границе модуля (vi.mock('../queries/…')), а не
        // выполняют настоящий код; юнит-покрытие для них структурно
        // недостижимо, реальная проверка — pgTAP/integration-тесты.
        'src/data/queries/*.queries.ts',
        // Страницы верхнего уровня без выделенных vitest-тестов — проверяются
        // через Playwright e2e, который эта метрика не видит. См. PR #1011.
        'src/features/auth/JoinPage.tsx',
        'src/features/clients/ClientPortalPages.tsx',
        'src/features/clients/ClientsPages.tsx',
        'src/features/clients/GoalPages.tsx',
        'src/features/exercises/ExercisesPage.tsx',
        'src/features/workouts/TodayPage.tsx',
        'src/features/workouts/WorkoutsPages.tsx',
      ],
    },
  },
}))
