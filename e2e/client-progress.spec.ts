import { expect, test } from '@playwright/test'
import { addDays, todayInTimeZone } from '../src/shared/local-date'

test('global rollout gives a new client the monochrome Progress identity', async ({ page }, testInfo) => {
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Тип аккаунта').selectOption('client')
  await page.getByLabel('Имя').fill('Progress без preview')
  await page.getByLabel('Email').fill(`progress-no-preview-${testInfo.workerIndex}-${Date.now()}@fit.local`)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page).toHaveURL(/\/me$/)

  await page.goto('/me/progress')
  await expect(page.getByRole('heading', { name: 'Мой прогресс' })).toBeVisible()
  await expect(page.locator('.phone-frame')).toHaveClass(/progress-identity/)
  await expect(page.locator('html')).toHaveClass(/ui-identity/)
})

test('standalone client creates and formulates an own goal', async ({ page }, testInfo) => {
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Тип аккаунта').selectOption('client')
  await page.getByLabel('Имя').fill('Самостоятельная цель')
  await page.getByLabel('Email').fill(`self-goal-${testInfo.workerIndex}-${Date.now()}@fit.local`)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page).toHaveURL(/\/me$/)

  await page.getByRole('button', { name: 'Ввести текстом' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()
  await page.goto('/me/goal')
  await expect(page.getByRole('heading', { name: 'Моя цель' })).toBeVisible()
  await page.getByLabel('Цель').fill('Держать вес 59 кг')
  await page.getByRole('switch', { name: 'Автоматическая оценка' }).check()
  await page.getByLabel('Показатель').selectOption('weight')
  await page.getByLabel('Способ оценки').selectOption('maintain_range')
  await page.getByLabel('Минимум, кг').fill('58,5')
  await page.getByLabel('Максимум, кг').fill('59,5')
  await page.getByRole('button', { name: 'Создать цель' }).click()

  await expect(page.getByRole('heading', { name: 'Держать вес 59 кг' })).toBeVisible()
  await expect(page.getByText('58,5–59,5 кг')).toBeVisible()
  await expect(page.getByText('Критерий подтверждён')).toBeVisible()
})

test('client explicitly confirms an LLM criterion before it can be saved', async ({ page }, testInfo) => {
  await page.route('**/functions/v1/parse-workout', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ criteria: [{
      metric: 'weight', operation: 'maintain_range', targetValue: null, rangeMin: 58.5, rangeMax: 59.5,
      unit: 'кг', secondaryTargetValue: null, secondaryUnit: null, exerciseRef: null, customMetricId: null,
      regularityPeriod: null, regularityMode: null,
    }], needsInput: [], unsupportedReason: null }),
  }))
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Тип аккаунта').selectOption('client')
  await page.getByLabel('Имя').fill('Подтверждение ИИ')
  await page.getByLabel('Email').fill(`llm-goal-${testInfo.workerIndex}-${Date.now()}@fit.local`)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page).toHaveURL(/\/me$/)

  await page.getByRole('button', { name: 'Ввести текстом' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()
  await page.goto('/me/goal')
  await page.getByLabel('Цель').fill('Держать вес 59 кг')
  await page.getByRole('switch', { name: 'Автоматическая оценка' }).check()
  await page.getByRole('button', { name: 'Предложить критерии с ИИ' }).click()
  const confirmation = page.getByLabel(/Я проверил\(а\), что все критерии/)
  await expect(confirmation).toBeVisible()
  await page.getByRole('button', { name: 'Создать цель' }).click()
  await expect(page.getByRole('alert')).toContainText('Подтвердите предложенные критерии')
  await confirmation.check()
  await page.getByRole('button', { name: 'Создать цель' }).click()
  await expect(page.getByRole('heading', { name: 'Держать вес 59 кг' })).toBeVisible()
})

test('linked client sees only the published client progress view', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('client@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()

  await expect(page).toHaveURL(/\/me$/)
  await page.goto('/me/profile')
  await expect(page.getByRole('radiogroup', { name: 'Вид фигуры' })).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Реальная фигура' })).toBeChecked()
  await page.getByRole('radio', { name: 'Схема' }).click()
  await page.goto('/me/progress')
  await expect(page).toHaveURL(/\/me\/progress$/)
  await expect(page.getByRole('heading', { name: 'Мой прогресс' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Тренировки' })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'Неделя' })).toHaveCount(0)
  await expect(page.getByLabel('Прогресс тренировок').getByRole('heading', { name: 'Период', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '1 месяц' })).toHaveClass(/active/)
  await expect(page.getByText('По завершённым тренировкам', { exact: true })).toHaveCount(0)
  const mainNow = page.locator('.client-progress-main-now')
  const overview = page.locator('.client-progress-overview')
  await expect(mainNow.getByText('Главное сейчас', { exact: true })).toBeVisible()
  await expect(mainNow.getByRole('heading', { name: 'Настрой оценку цели' })).toBeVisible()
  await expect(overview).toHaveAttribute('data-fact-id', 'goal:unconfigured')
  await expect(overview).toHaveAttribute('data-copy-source', 'deterministic')
  await expect(mainNow.getByRole('link')).toHaveCount(0)
  await expect(overview.getByRole('link', { name: 'Настроить оценку' })).toHaveAttribute('href', '/me/goal')
  const regularity = page.locator('.client-progress-regularity-story')
  await expect(regularity.getByRole('heading', { name: 'Тренировочный ритм' })).toBeVisible()
  await expect(regularity.getByRole('list', { name: 'Завершённые тренировки по неделям' })).toBeVisible()
  await expect(mainNow.evaluate((element) => {
    const goal = document.querySelector('.client-progress-goal-story')
    const summary = document.querySelector('.progress-story-summary')
    const map = document.querySelector('.body-progress-map')
    const comparison = document.querySelector('.client-progress-comparison')
    const measurements = document.querySelector('.client-progress-measurements-story')
    const regularity = document.querySelector('.client-progress-regularity-story')
    return Boolean(goal && summary && map && comparison && measurements && regularity
      && (element.compareDocumentPosition(goal) & Node.DOCUMENT_POSITION_FOLLOWING)
      && (goal.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING)
      && (map.compareDocumentPosition(comparison) & Node.DOCUMENT_POSITION_FOLLOWING)
      && (comparison.compareDocumentPosition(measurements) & Node.DOCUMENT_POSITION_FOLLOWING)
      && (measurements.compareDocumentPosition(regularity) & Node.DOCUMENT_POSITION_FOLLOWING)
      && (regularity.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING))
  })).resolves.toBe(true)
  const nextStep = page.locator('.client-progress-next-step')
  await expect(nextStep.getByRole('heading', { name: 'Настроить критерий цели' })).toBeVisible()
  await expect(nextStep.getByText('Подобрано по данным', { exact: true })).toBeVisible()
  await expect(nextStep.getByRole('link', { name: 'Открыть цель' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Подробный анализ' }).evaluate((element) => {
    const main = document.querySelector('.client-progress-main-now')
    return Boolean(main?.contains(element) && !document.querySelector('.client-progress-details-toggle'))
  })).resolves.toBe(true)
  await nextStep.getByRole('button', { name: 'Выбрать этот шаг' }).click()
  await expect(nextStep.getByText('Данные не изменены.', { exact: false })).toBeVisible()
  await expect(nextStep.getByRole('link', { name: 'Открыть цель' })).toHaveAttribute('href', '/me/goal')
  await nextStep.getByRole('button', { name: 'Не сейчас' }).click()
  await expect(nextStep.getByRole('heading', { name: 'Предложение скрыто' })).toBeVisible()
  await nextStep.getByRole('button', { name: 'Показать снова' }).click()
  await expect(nextStep.getByRole('button', { name: 'Выбрать этот шаг' })).toBeVisible()
  await page.getByRole('button', { name: 'Прогресс', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Где выросли результаты' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Анатомическая схема мышц, вид спереди' })).toBeVisible()
  await page.goto('/me/profile')
  await page.getByRole('radio', { name: 'Реальная фигура' }).click()
  await page.goto('/me/progress')
  await expect(page.getByRole('group', { name: 'Атлетичная женщина, вид спереди' })).toBeVisible()
  await page.getByRole('button', { name: 'Подробный анализ' }).click()
  const clientDetails = page.getByRole('dialog', { name: 'Подробный анализ' })
  await expect(clientDetails).toBeVisible()
  await expect(clientDetails.getByRole('heading', { name: 'Результат периода' })).toBeVisible()
  await expect(clientDetails.getByRole('heading', { name: 'Связь с целью' })).toBeVisible()
  await expect(clientDetails.getByRole('heading', { name: 'На что обратить внимание' })).toBeVisible()
  await expect(clientDetails.getByText(/Жим лёжа: рабочий вес вырос с 72 до 75 кг/i)).toHaveCount(0)
  await page.getByRole('button', { name: 'Закрыть' }).click()
  await expect(page.getByText('Для твоей цели', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Повысить силовые показатели и улучшить выносливость' })).toBeVisible()
  await expect(page.getByText('Не настроено', { exact: true })).toBeVisible()
  await expect(page.getByText('Рабочий вес: 72 → 75 кг · +4%')).toHaveCount(1)
  await expect(page.getByRole('link', { name: 'Настроить оценку' })).toHaveAttribute('href', '/me/goal')
  await expect(page.getByText(/Рост рабочего веса поддерживает цель/)).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'На следующей тренировке' })).toHaveCount(0)
  await expect(page.getByText(/причина максимального перерыва/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Обновить' })).toHaveCount(0)
  await expect(page.locator('.ai-progress-footer')).toHaveCount(0)
  const measurementSection = page.locator('.client-progress-measurements-story')
  await measurementSection.scrollIntoViewIfNeeded()
  await expect(measurementSection.getByRole('button', { name: 'Добавить замер' })).toBeVisible()
  await expect(measurementSection.getByRole('button', { name: /История/ })).toBeVisible()
  await expect(measurementSection.getByRole('button', { name: 'Настроить показатели' })).toBeVisible()
  await expect(page.getByText('УПРАВЛЕНИЕ', { exact: true })).toHaveCount(0)
  await expect(page.locator('.client-progress-measurement')).toHaveCount(0)

  await page.goto('/me/goal')
  await expect(page.locator('.phone-frame')).toHaveClass(/client-goal-identity/)
  await expect(page.getByRole('heading', { name: 'Моя цель' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Как оценивать цель' })).toBeVisible()
  await expect(page.getByLabel('Цель')).toHaveValue('Повысить силовые показатели и улучшить выносливость')
  await expect(page.getByText(/Цель сохранится как текст без автоматической оценки/)).toBeVisible()

  await page.goto('/clients')
  await expect(page).toHaveURL(/\/me$/)
})

test('client sees deterministic standard-measurement goal facts', async ({ page }) => {
  const fiveDaysAgo = addDays(todayInTimeZone('Europe/Moscow'), -5)
  await page.goto('/auth')
  await page.getByLabel('Email').fill('client@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/me$/)

  await page.route('**/rest/v1/rpc/get_client_goal', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      id: 'a1000000-0000-4000-8000-000000000001', clientId: '11111111-1111-4111-8111-111111111111',
      title: 'Держать вес 59 кг', targetDate: null, status: 'active', version: 1, stages: [],
      criteria: [{
        id: 'a2000000-0000-4000-8000-000000000002', goalId: 'a1000000-0000-4000-8000-000000000001',
        metric: 'weight', operation: 'maintain_range', targetValue: null,
        rangeMin: 58.5, rangeMax: 59.5, unit: 'кг', baselineValue: null,
        baselineRecordedOn: null, confirmationStatus: 'confirmed', position: 0, version: 1,
      }],
    }),
  }))
  await page.route('**/rest/v1/client_progress?*', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify([
      { id: 'a4000000-0000-4000-8000-000000000004', client_id: '11111111-1111-4111-8111-111111111111', created_by: null, recorded_on: fiveDaysAgo, weight_kg: 59, chest_cm: null, waist_cm: null, hip_cm: null, notes: null, version: 1 },
      { id: 'a3000000-0000-4000-8000-000000000003', client_id: '11111111-1111-4111-8111-111111111111', created_by: null, recorded_on: '2026-08-05', weight_kg: 60, chest_cm: null, waist_cm: null, hip_cm: null, notes: null, version: 1 },
    ]),
  }))
  await page.route('**/rest/v1/client_progress_custom?*', (route) => route.fulfill({
    contentType: 'application/json', body: '[]',
  }))
  await page.route('**/rest/v1/client_custom_metrics?*', (route) => route.fulfill({
    contentType: 'application/json', body: '[]',
  }))

  await page.goto('/me/progress')
  const goal = page.locator('.client-progress-goal-story')
  await expect(goal.getByRole('heading', { name: 'Держать вес 59 кг' })).toBeVisible()
  await expect(goal.getByText('В диапазоне сейчас', { exact: true })).toBeVisible()
  await expect(goal.getByText('59 кг', { exact: true })).toBeVisible()
  await expect(goal.getByText('58,5–59,5 кг')).toBeVisible()
  await expect(goal.getByRole('link', { name: 'Смотреть значения и график' })).toHaveCount(0)
  await expect(goal.getByText(/в окне удержания был замер за его пределами/)).toHaveCount(0)

  const measurements = page.locator('.client-progress-measurements-story')
  await expect(measurements.getByRole('heading', { name: 'Тренд по значениям' })).toBeVisible()
  await expect(measurements.getByText('59 кг', { exact: true })).toBeVisible()
  await expect(measurements.getByText('60 кг → 59 кг', { exact: true })).toBeVisible()
  await expect(measurements.getByText('−1 кг', { exact: true })).toBeVisible()
  await expect(measurements.getByText('Связан с целью', { exact: true })).toBeVisible()
  await expect(measurements.getByText(/Свежие данные · 5 дн. · 2 точки · достаточно для динамики/)).toBeVisible()
  await expect(measurements.getByText('Цель · 58,5–59,5 кг').first()).toBeVisible()
  await expect(measurements.getByLabel('График показателя «Вес»')).toBeVisible()
  await expect(measurements.evaluate((element) => {
    const comparison = document.querySelector('.client-progress-comparison')
    const summary = document.querySelector('.progress-story-summary')
    return Boolean(comparison && summary
      && (comparison.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)
      && (element.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING))
  })).resolves.toBe(true)
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
})

test('trainer reviews verified signals separately from the client copy', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/today$/)
  await page.goto('/profile')
  await expect(page.getByRole('radiogroup', { name: 'Вид фигуры' })).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Реальная фигура' })).toBeChecked()
  await page.getByRole('radio', { name: 'Схема' }).click()
  await page.goto('/clients/11111111-1111-4111-8111-111111111111')
  await expect(page.getByRole('radiogroup', { name: 'Вид фигуры' })).toHaveCount(0)
  await page.goto('/progress/11111111-1111-4111-8111-111111111111')

  await expect(page.getByRole('heading', { name: 'Прогресс', exact: true })).toBeVisible()
  await expect(page.getByLabel('Тренировки за неделю')).toBeVisible()
  await expect(page.getByLabel('Тренировки за неделю').locator('strong')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Открыть замеры и показатели' })).toBeVisible()
  await expect(page.locator('details')).toHaveCount(0)

  const trainerAnalysis = page.getByLabel('ИИ-анализ тренировок')
  await expect(trainerAnalysis.getByRole('radiogroup', { name: 'Вид фигуры' })).toHaveCount(0)
  await expect(trainerAnalysis.getByRole('group', { name: 'Атлетичный мужчина, вид спереди' })).toHaveCount(0)
  await expect(trainerAnalysis.getByRole('group', { name: 'Атлетичная женщина, вид спереди' })).toHaveCount(0)
  await expect(trainerAnalysis.getByRole('group', { name: 'Анатомическая схема мышц, вид спереди' })).toBeVisible()
  await expect(trainerAnalysis.getByRole('heading', { name: 'Период', exact: true })).toBeVisible()
  await expect(trainerAnalysis.locator('.client-progress-main-now').evaluate((element) => {
    const goal = document.querySelector('.client-progress-goal-story')
    const map = document.querySelector('.body-progress-map')
    const summary = document.querySelector('.progress-story-summary')
    const comparison = document.querySelector('.client-progress-comparison')
    const measurements = document.querySelector('.client-progress-measurements-story')
    const regularity = document.querySelector('.client-progress-regularity-story')
    return Boolean(goal && map && summary && comparison && measurements && regularity
      && (element.compareDocumentPosition(goal) & Node.DOCUMENT_POSITION_FOLLOWING)
      && (goal.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING)
      && (map.compareDocumentPosition(comparison) & Node.DOCUMENT_POSITION_FOLLOWING)
      && (comparison.compareDocumentPosition(measurements) & Node.DOCUMENT_POSITION_FOLLOWING)
      && (measurements.compareDocumentPosition(regularity) & Node.DOCUMENT_POSITION_FOLLOWING)
      && (regularity.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING))
  })).resolves.toBe(true)
  await expect(trainerAnalysis.getByRole('heading', { name: 'Тренировочный ритм' })).toBeVisible()
  await expect(trainerAnalysis.getByText('Доступно клиенту')).toBeVisible()
  const trainerSignals = trainerAnalysis.getByRole('region', { name: /проверяем/ })
  await expect(trainerSignals.getByText('Для тренера')).toBeVisible()
  await expect(trainerSignals.getByRole('button', { name: 'Показать' })).toHaveAttribute('aria-expanded', 'false')
  await trainerSignals.getByRole('button', { name: 'Показать' }).click()
  await expect(trainerSignals.getByText('Факт', { exact: true }).first()).toBeVisible()
  await expect(trainerSignals.getByText('Вопрос', { exact: true }).first()).toBeVisible()
  await expect(trainerAnalysis.getByText('Динамика упражнений')).toHaveCount(0)
  await trainerAnalysis.getByRole('button', { name: 'Подробный анализ' }).click()
  const detailedAnalysis = page.getByRole('dialog', { name: 'Подробный анализ' })
  await expect(detailedAnalysis.getByRole('heading', { name: 'Результат периода' })).toBeVisible()
  await expect(detailedAnalysis.getByRole('heading', { name: 'Связь с целью' })).toBeVisible()
  await expect(detailedAnalysis.getByRole('heading', { name: 'На что обратить внимание' })).toBeVisible()
  await expect(detailedAnalysis.getByText(/Факты из карточек выше здесь не повторяются/)).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть' }).click()
  await page.getByRole('button', { name: 'Версия для спортсмена' }).click()
  const clientCopy = page.getByRole('dialog', { name: 'Версия для спортсмена' })
  await expect(clientCopy).toBeVisible()
  await expect(clientCopy.getByRole('textbox', { name: 'Главный результат', exact: true }))
    .toHaveValue(/рабочий вес в жиме вырос на 4%/)
  await expect(clientCopy.getByRole('button', { name: 'Сохранить клиентскую версию' })).toBeVisible()
})
