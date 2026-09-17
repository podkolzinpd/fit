import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
})
