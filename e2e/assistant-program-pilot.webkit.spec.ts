import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { test, expect, type Locator, type Page } from '@playwright/test'
import { createServer } from 'vite'
import type { ComponentType } from 'react'
import { anchorAssistantViewport } from '../src/features/assistant/assistant-viewport'

let ProgramCard: ComponentType<Record<string, unknown>>
test.beforeAll(async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const module = await server.ssrLoadModule('/src/features/assistant/AssistantProgramPilotCard.tsx')
    ProgramCard = module.AssistantProgramPilotCard as ComponentType<Record<string, unknown>>
  } finally { await server.close() }
})

const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
const programQuestions = ['Продолжаем прежний подход или меняем программу? Что важно сохранить?', 'Какова цель именно этой четырёхнедельной программы: что хотите улучшить?']

function collectingShell(theme: string) {
  const content = renderToString(createElement(ProgramCard, { enabled: true, running: false, showGuidance: false,
    payload: { step: 'brief', briefStatus: 'needs_answers', clientName: 'Сан Саныч', readyToGenerate: false,
      guidance: programQuestions.join('\n'), hasHistory: true,
      sourceSummary: Array.from({ length: 12 }, (_, index) => `Записанный результат ${index + 1}: два подхода по восемь повторений; последнее занятие — 14 сентября.`).join('\n'),
      briefSummary: 'Совершеннолетний: да\nОборудование: полностью оборудованный тренажёрный зал\nПожелания: сохранить привычные упражнения и удобное расписание' },
    onApply: async () => {}, onSaved: () => {}, onSuggestion: () => {}, onCancel: () => {},
  }))
  return `<!doctype html><html class="theme-${theme} ui-identity"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style></head><body><div id="root">
    <div class="phone-frame theme-${theme} assistant-shell ui-identity assistant-identity"><div class="content"><main class="assistant-page assistant-program-collecting">
      <section class="assistant-session-switcher"><div class="assistant-session-bar"><strong>Сегодня</strong></div></section>
      <section class="assistant-thread" aria-label="Диалог с ассистентом"><article class="assistant-message assistant-message-user"><p>Подготовить программу для Сан Саныч</p></article>
        <article class="assistant-message assistant-message-assistant"><div class="assistant-message-copy"><p>Пилот: четыре недели занятий под наблюдением тренера, 1–3 раза в неделю от 30 минут, с днём отдыха между занятиями.</p><p>Клиент: Сан Саныч. За последние восемь недель вижу 24 завершённые тренировки.</p>${programQuestions.map((question, index) => `<p data-testid="program-question-${index}">${question}</p>`).join('')}</div></article></section>
      <section class="assistant-context-panel" aria-label="Текущий контекст ассистента">${content}</section>
      <form class="assistant-composer" data-testid="composer"><textarea aria-label="Сообщение ассистенту" placeholder="Напишите, чем помочь"></textarea><div class="voice-input voice-input-icon"><button class="assistant-icon-button" type="button" aria-label="Голосовой ввод">М</button></div><button class="assistant-icon-button" type="button" aria-label="Отправить сообщение">→</button></form>
    </main></div><nav class="tab-bar trainer-tab-bar" data-testid="tabbar"><a>Сегодня</a><a>Клиенты</a><a>Ассистент</a><a>Расписание</a></nav></div></div></body></html>`
}

async function expectUnclipped(locator: Locator) {
  const visible = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    let left = Math.max(0, rect.left), top = Math.max(0, rect.top)
    let right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom)
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), box = parent.getBoundingClientRect()
      if (style.overflowX !== 'visible') { left = Math.max(left, box.left); right = Math.min(right, box.right) }
      if (style.overflowY !== 'visible') { top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom) }
    }
    return { width: rect.width, height: rect.height, clippedWidth: Math.max(0, right - left), clippedHeight: Math.max(0, bottom - top) }
  })
  expect(visible.width).toBeGreaterThan(0)
  expect(visible.height).toBeGreaterThan(0)
  expect(visible.clippedWidth).toBeGreaterThanOrEqual(visible.width - 1)
  expect(visible.clippedHeight).toBeGreaterThanOrEqual(visible.height - 1)
}

async function expectProgramConversationVisible(page: Page) {
  for (const index of [0, 1]) await expectUnclipped(page.getByTestId(`program-question-${index}`))
  await expectUnclipped(page.getByTestId('composer'))
  if (await page.getByTestId('tabbar').isVisible()) {
    const composer = await page.getByTestId('composer').boundingBox()
    const tabbar = await page.getByTestId('tabbar').boundingBox()
    expect(composer!.y + composer!.height).toBeLessThanOrEqual(tabbar!.y + 1)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}

async function anchorProgramShell(page: Page) {
  // SSR has no layout effects. Run the same viewport helper the real page calls
  // after a new message or a keyboard resize, with program collecting contained.
  await page.addScriptTag({ content: `(${anchorAssistantViewport.toString()})(document.querySelector('.assistant-thread'), document.querySelector('.content'), true)` })
}

for (const viewport of [{ width: 390, height: 844 }, { width: 430, height: 932 }, { width: 1440, height: 900 }]) {
  for (const theme of ['light', 'dark']) {
    test(`program questions in complete shell at ${viewport.width} ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport)
      await page.setContent(collectingShell(theme))
      await anchorProgramShell(page)
      await page.screenshot({ path: testInfo.outputPath(`questions-${viewport.width}-${theme}.png`) })
      await expectProgramConversationVisible(page)
      const details = page.locator('.assistant-context-panel details').filter({ has: page.locator('summary', { hasText: 'Данные и условия' }) })
      await expect(details).not.toHaveAttribute('open')
      await details.locator('summary').click()
      await expect(details).toHaveAttribute('open', '')
      await expectUnclipped(page.getByTestId('composer'))
      await page.screenshot({ path: testInfo.outputPath(`questions-expanded-${viewport.width}-${theme}.png`) })
      await details.locator('summary').click()
      await expectProgramConversationVisible(page)
      if (viewport.width === 390) {
        await page.locator('.phone-frame').evaluate((element) => element.classList.add('keyboard-open'))
        await page.setViewportSize({ width: 390, height: 480 })
        await anchorProgramShell(page)
        await expectProgramConversationVisible(page)
        await page.screenshot({ path: testInfo.outputPath(`questions-keyboard-${theme}.png`) })
        await page.locator('.phone-frame').evaluate((element) => element.classList.remove('keyboard-open'))
        await page.setViewportSize(viewport)
        await anchorProgramShell(page)
        await expectProgramConversationVisible(page)
      }
    })
  }
}

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
        exercises: [{ name: 'Приседания с гантелью у груди', restBetweenSetsSec: 90, sets: Array.from({ length: 2 }, () => ({ reps: index < 6 ? 10 : 11, rpe: 6.5 })) }, { name: 'Ходьба', restBetweenSetsSec: 0, trainerComment: 'Аэробное усилие 4/10. Разговорный темп.', sets: [{ durationSec: 600 }] }],
      }))
      const content = renderToString(createElement(ProgramCard, { enabled: true, running: false,
        payload: { step: 'confirm', limitationReview: 'Ограничения: дискомфорт при жимах над головой. Учесть: исключить жимы над головой. Тренеру: проверьте назначения перед добавлением.', clientName: 'Тестовый клиент с длинным именем', goal: 'Вернуться к регулярным занятиям после перерыва', canonicalWorkouts: workouts, historyFacts: [], sessions: workouts.map((workout, index) => ({ day: workout.workoutDate, week: Math.floor(index / 3) + 1, title: 'День', exercises: [{ exerciseRef: 'squat', name: 'Приседания с гантелью у груди', sets: 2, reps: index < 6 ? 10 : 11, durationSec: null, rpe: 6.5, restSec: 90,
          progressionNote: 'Первые две недели закрепляйте технику. В третью добавьте одно повторение, если все подходы выполнены с целевым усилием; иначе сохраните прежнюю нагрузку.' }, { exerciseRef: 'walking', name: 'Ходьба', sets: 1, reps: null, durationSec: 600, rpe: 4, restSec: 0, progressionNote: 'Разговорный темп.' }] })) },
        onApply: async () => {}, onSaved: () => {}, onSuggestion: () => {}, onCancel: () => {},
      }))
      await page.setContent(`<html class="theme-${theme} ui-identity"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style></head><body><div class="phone-frame theme-${theme} assistant-shell ui-identity assistant-identity"><main class="assistant-page"><section class="assistant-context-panel">${content}</section></main></div></body></html>`)
      await expect(page.getByRole('button', { name: 'Добавить в расписание' })).toBeVisible()
      await expect(page.getByRole('region', { name: 'Обзор четырёх недель' })).toBeVisible()
      await expect(page.getByText(/Ограничения: дискомфорт/)).toBeVisible()
      await expect(page.getByText('Пояснение:').first()).toBeVisible()
      await expect(page.getByText(/1 подход по 10 мин/).first()).toBeVisible()
      await page.screenshot({ path: testInfo.outputPath(`program-${width}-${theme}.png`), fullPage: true })
      await page.locator('summary').first().click()
      await expect(page.getByText('Приседания с гантелью у груди').first()).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    })
  }
}
