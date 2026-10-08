import { defineConfig, devices } from '@playwright/test'

const testPort = Number(process.env.FIT_TEST_PORT ?? 5173)

export default defineConfig({
  testDir: './e2e', fullyParallel: true, retries: process.env.CI ? 2 : 0,
  snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}-{projectName}{ext}',
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://127.0.0.1:${testPort}`, trace: 'on-first-retry' },
  // Проверяем тот же Today-старт, который получают пользователи по умолчанию.
  // Устаревший rollout-флаг здесь маскировал регрессии нового основного сценария.
  webServer: { command: `npm run dev:frontend -- --host 127.0.0.1 --port ${testPort}`, url: `http://127.0.0.1:${testPort}`, reuseExistingServer: !process.env.CI,
    // Synthetic fixture identities only; never used in a production build.
    env: { VITE_COACH_WORKOUT_REDESIGN_ENABLED: 'true', VITE_COACH_WORKOUT_REDESIGN_PILOT_USER_IDS: 'c0ac0000-6010-4000-8000-000000000001,c0ac0000-6010-4000-8000-000000000002' },
  },
  projects: [
    { name: 'lime-acceptance-webkit', testMatch: /trainer-schedule-v2\.visual\.spec\.ts/, use: { ...devices['iPhone 13'] } },
    { name: 'lime-figma-webkit', testMatch: /trainer-schedule-v2\.visual\.spec\.ts/, grep: /Figma (foundation|calendar|workout|trainer routes)/, use: { ...devices['iPhone 13'] } },
    { name: 'mobile-chromium', testIgnore: [/.*\.webkit\.spec\.ts/, /ui-visual\.spec\.ts/], use: { ...devices['Pixel 7'] } },
    // Отдельный iPhone smoke покрывает реальный движок iOS и ширину 390 px,
    // не дублируя полный Chromium-набор. Он обязателен и локально, и в CI.
    { name: 'iphone-13-webkit', testMatch: [/.*\.webkit\.spec\.ts/, /assistant-layout\.spec\.ts/], use: { ...devices['iPhone 13'] } },
    {
      name: 'schedule-density-webkit',
      testMatch: /trainer-schedule-v2\.visual\.spec\.ts/,
      grep: /trainer switches day-grid density/,
      use: { ...devices['iPhone 13'] },
    },
    // Три узких профиля визуальной приёмки: два клиентских мобильных размера
    // и фактический desktop viewport тренера. Они запускают только один smoke,
    // поэтому не размножают весь поведенческий e2e-набор.
    { name: 'visual-client-390', testMatch: /ui-visual\.spec\.ts/, use: { ...devices['iPhone 13'], timezoneId: 'Europe/Moscow', viewport: { width: 390, height: 844 } } },
    { name: 'visual-client-430', testMatch: /ui-visual\.spec\.ts/, use: { ...devices['Pixel 7'], timezoneId: 'Europe/Moscow', viewport: { width: 430, height: 932 } } },
    { name: 'visual-trainer-1440', testMatch: /ui-visual\.spec\.ts/, use: { ...devices['Desktop Chrome'], timezoneId: 'Europe/Moscow', viewport: { width: 1440, height: 1000 } } },
  ],
})
