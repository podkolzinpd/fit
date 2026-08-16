import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e', fullyParallel: true, retries: process.env.CI ? 2 : 0,
  snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}-{projectName}{ext}',
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'on-first-retry' },
  // Проверяем тот же Today-старт, который получают пользователи по умолчанию.
  // Устаревший rollout-флаг здесь маскировал регрессии нового основного сценария.
  webServer: { command: 'npm run dev:frontend -- --host 127.0.0.1', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI },
  projects: [
    { name: 'mobile-chromium', testIgnore: [/.*\.webkit\.spec\.ts/, /ui-visual\.spec\.ts/], use: { ...devices['Pixel 7'] } },
    // Отдельный iPhone smoke покрывает реальный движок iOS и ширину 390 px,
    // не дублируя полный Chromium-набор. Он обязателен и локально, и в CI.
    { name: 'iphone-13-webkit', testMatch: /.*\.webkit\.spec\.ts/, use: { ...devices['iPhone 13'] } },
    // Три узких профиля визуальной приёмки: два клиентских мобильных размера
    // и фактический desktop viewport тренера. Они запускают только один smoke,
    // поэтому не размножают весь поведенческий e2e-набор.
    { name: 'visual-client-390', testMatch: /ui-visual\.spec\.ts/, use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } },
    { name: 'visual-client-430', testMatch: /ui-visual\.spec\.ts/, use: { ...devices['Pixel 7'], viewport: { width: 430, height: 932 } } },
    { name: 'visual-trainer-1440', testMatch: /ui-visual\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
  ],
})
