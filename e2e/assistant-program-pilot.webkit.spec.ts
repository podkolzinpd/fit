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
    test(`history question at ${width} ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 932 })
      const content = renderToString(createElement(ProgramCard, { enabled: true, running: false,
        payload: { step: 'brief', briefStatus: 'needs_clarification', clientName: 'Тестовый клиент с длинным именем', historyQuestion: true, readyToGenerate: false,
          guidance: 'За последние четыре недели в Fit записано в среднем 8 сопоставимых подходов в неделю. Для 3 занятий в неделю это небольшой объём. Это вся история или часть тренировок не записана?',
          briefSummary: 'Цель: вернуться к регулярным занятиям\n3 занятия в неделю · 4 недели\nДни: пн, ср, пт\nДо 60 минут' },
        onApply: async () => {}, onSaved: () => {}, onSuggestion: () => {}, onCancel: () => {},
      }))
      await page.setContent(`<html class="theme-${theme} ui-identity"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style></head><body><div class="phone-frame theme-${theme} assistant-shell ui-identity assistant-identity"><div class="content"><main class="assistant-page"><section class="assistant-context-panel">${content}</section></main></div></div></body></html>`)
      await expect(page.getByRole('status')).toContainText('Это вся история')
      await expect(page.getByRole('button', { name: 'Это все тренировки' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Часть тренировок не записана' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Подтвердить и составить' })).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`history-${width}-${theme}.png`), fullPage: true })
    })
    test(`program card at ${width} ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 932 })
      const workouts = Array.from({ length: 12 }, (_, index) => ({
        requestId: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`, clientId: '20000000-0000-4000-8000-000000000001', workoutDate: new Date(Date.UTC(2026, 8, 21 + Math.floor(index / 3) * 7 + index % 3 * 2)).toISOString().slice(0, 10),
        exercises: [{ name: 'Приседания с гантелью у груди', restBetweenSetsSec: 90, sets: Array.from({ length: 2 }, () => ({ reps: index < 6 ? 10 : 11, rpe: 6.5 })) }],
      }))
      const content = renderToString(createElement(ProgramCard, { enabled: true, running: false,
        payload: { step: 'confirm', clientName: 'Тестовый клиент с длинным именем', goal: 'Вернуться к регулярным занятиям после перерыва', canonicalWorkouts: workouts, historyFacts: [], sessions: workouts.map((workout, index) => ({ day: workout.workoutDate, week: Math.floor(index / 3) + 1, title: 'День', exercises: [{ exerciseRef: 'squat', name: 'Приседания с гантелью у груди', sets: 2, reps: index < 6 ? 10 : 11, durationSec: null, rpe: 6.5, restSec: 90,
          progressionNote: 'Первые две недели закрепляйте технику. В третью добавьте одно повторение, если все подходы выполнены с целевым усилием; иначе сохраните прежнюю нагрузку.' }] })) },
        onApply: async () => {}, onSaved: () => {}, onSuggestion: () => {}, onCancel: () => {},
      }))
      await page.setContent(`<html class="theme-${theme} ui-identity"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style></head><body><div class="phone-frame theme-${theme} assistant-shell ui-identity assistant-identity"><main class="assistant-page"><section class="assistant-context-panel">${content}</section></main></div></body></html>`)
      await expect(page.getByRole('button', { name: 'Добавить в расписание' })).toBeVisible()
      await expect(page.getByRole('region', { name: 'Обзор четырёх недель' })).toBeVisible()
      await expect(page.getByText('Пояснение:').first()).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath(`program-${width}-${theme}.png`), fullPage: true })
      await page.locator('summary').first().click()
      await expect(page.getByText('Приседания с гантелью у груди').first()).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    })
  }
}
