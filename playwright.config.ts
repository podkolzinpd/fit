import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e', fullyParallel: true, retries: process.env.CI ? 2 : 0,
  snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}-{projectName}{ext}',
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'on-first-retry' },
  // Основной набор одновременно проверяет обратимый rollout: при флаге false
  // старые сценарии тренера сохраняют старт в «Клиентах».
  webServer: { command: 'VITE_TODAY_START_REDESIGN=false npm run dev:frontend -- --host 127.0.0.1', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI },
  projects: [{ name: 'mobile-chromium', use: { ...devices['Pixel 7'] } }],
})
