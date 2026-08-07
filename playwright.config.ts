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
    { name: 'mobile-chromium', testIgnore: /.*\.webkit\.spec\.ts/, use: { ...devices['Pixel 7'] } },
    // Отдельный iPhone smoke покрывает реальный движок iOS и ширину 390 px,
    // не дублируя весь мутирующий набор одновременно с Chromium. GitHub Actions
    // пока ставит только Chromium: включение WebKit в CI вынесено в отдельную
    // инфраструктурную правку с токеном, имеющим workflow scope.
    ...(process.env.CI ? [] : [{ name: 'iphone-13-webkit', testMatch: /.*\.webkit\.spec\.ts/, use: { ...devices['iPhone 13'] } }]),
  ],
})
