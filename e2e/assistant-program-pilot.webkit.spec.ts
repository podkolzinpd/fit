import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { test, expect } from '@playwright/test'
import { createServer } from 'vite'
import type { ComponentType } from 'react'

let ProgramCard: ComponentType<Record<string, unknown>>
test.beforeAll(async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const module = await server.ssrLoadModule('/src/features/assistant/AssistantProgramPilotCard.tsx')
    ProgramCard = module.AssistantProgramPilotCard as ComponentType<Record<string, unknown>>
  } finally { await server.close() }
})

const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
for (const width of [390, 430, 1440]) {
  for (const theme of ['light', 'dark']) {
    test(`program card at ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 932 })
      const workouts = Array.from({ length: 12 }, (_, index) => ({
        requestId: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`, clientId: '20000000-0000-4000-8000-000000000001', workoutDate: '2026-09-21',
        exercises: [{ name: 'Приседания с гантелью у груди', restBetweenSetsSec: 90, sets: [{ reps: 10, rpe: 6.5 }] }],
      }))
      const content = renderToString(createElement(ProgramCard, { enabled: true, running: false,
        payload: { step: 'confirm', clientName: 'Тестовый клиент с длинным именем', goal: 'Вернуться к регулярным занятиям после перерыва', canonicalWorkouts: workouts },
        onApply: async () => {}, onSaved: () => {}, onSuggestion: () => {}, onCancel: () => {},
      }))
      await page.setContent(`<html class="theme-${theme} ui-identity"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style></head><body><div class="phone-frame theme-${theme} assistant-shell ui-identity assistant-identity"><main class="assistant-page"><section class="assistant-context-panel">${content}</section></main></div></body></html>`)
      await expect(page.getByRole('button', { name: 'Добавить в расписание' })).toBeVisible()
      await page.locator('summary').first().click()
      await expect(page.getByText('Приседания с гантелью у груди').first()).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    })
  }
}
