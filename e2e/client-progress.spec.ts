import { expect, test } from '@playwright/test'

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
  await page.getByRole('button', { name: 'Прогресс', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Где выросли результаты' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Анатомическая схема мышц, вид спереди' })).toBeVisible()
  await page.goto('/me/profile')
  await page.getByRole('radio', { name: 'Реальная фигура' }).click()
  await page.goto('/me/progress')
  await expect(page.getByRole('group', { name: 'Атлетичная женщина, вид спереди' })).toBeVisible()
  await page.getByRole('button', { name: 'Подробный анализ' }).click()
  await expect(page.getByRole('dialog', { name: 'Подробный анализ' })).toBeVisible()
  await expect(page.getByText(/Жим лёжа: рабочий вес вырос с 72 до 75 кг/i)).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть' }).click()
  await expect(page.getByText('Для твоей цели', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Повысить силовые показатели и улучшить выносливость' })).toBeVisible()
  await expect(page.getByText('Не настроено', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Настроить оценку' })).toHaveAttribute('href', '/me/goal')
  await expect(page.getByText(/Рост рабочего веса поддерживает цель/)).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'На следующей тренировке' })).toHaveCount(0)
  await expect(page.getByText(/причина максимального перерыва/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Обновить' })).toBeVisible()
  await page.getByText('ЗАМЕРЫ И ПОКАЗАТЕЛИ', { exact: true }).scrollIntoViewIfNeeded()
  await expect(page.getByText('ЗАМЕРЫ И ПОКАЗАТЕЛИ', { exact: true })).toBeVisible()

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
      { id: 'a4000000-0000-4000-8000-000000000004', client_id: '11111111-1111-4111-8111-111111111111', created_by: null, recorded_on: '2026-08-25', weight_kg: 59, chest_cm: null, waist_cm: null, hip_cm: null, notes: null, version: 1 },
      { id: 'a3000000-0000-4000-8000-000000000003', client_id: '11111111-1111-4111-8111-111111111111', created_by: null, recorded_on: '2026-08-05', weight_kg: 60, chest_cm: null, waist_cm: null, hip_cm: null, notes: null, version: 1 },
    ]),
  }))
  await page.route('**/rest/v1/client_progress_custom?*', (route) => route.fulfill({
    contentType: 'application/json', body: '[]',
  }))

  await page.goto('/me/progress')
  const goal = page.locator('.client-progress-goal-story')
  await expect(goal.getByRole('heading', { name: 'Держать вес 59 кг' })).toBeVisible()
  await expect(goal.getByText('В диапазоне сейчас', { exact: true })).toBeVisible()
  await expect(goal.getByText('58,5–59,5 кг')).toBeVisible()
  await expect(goal.getByText(/60 → 59 кг \(−1 кг\) · ближе к ориентиру/)).toBeVisible()
  await expect(goal.getByText('Достаточно для проверки удержания')).toBeVisible()
  await expect(goal.getByText(/в окне удержания был замер за его пределами/)).toBeVisible()
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
})

test('trainer reviews the client copy separately from internal attention items', async ({ page }) => {
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
  await expect(trainerAnalysis.getByText('Доступно клиенту')).toBeVisible()
  await expect(trainerAnalysis.getByText('На что обратить внимание')).toBeVisible()
  await expect(trainerAnalysis.getByText('Динамика упражнений')).toHaveCount(0)
  await trainerAnalysis.getByRole('button', { name: 'Подробный анализ' }).click()
  const detailedAnalysis = page.getByRole('dialog', { name: 'Подробный анализ' })
  await expect(detailedAnalysis.getByText('Динамика упражнений')).toBeVisible()
  await expect(detailedAnalysis.getByText('Ритм тренировок')).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть' }).click()
  await page.getByRole('button', { name: 'Версия для спортсмена' }).click()
  const clientCopy = page.getByRole('dialog', { name: 'Версия для спортсмена' })
  await expect(clientCopy).toBeVisible()
  await expect(clientCopy.getByRole('textbox', { name: 'Главный результат', exact: true }))
    .toHaveValue(/рабочий вес в жиме вырос на 4%/)
  await expect(clientCopy.getByRole('button', { name: 'Сохранить клиентскую версию' })).toBeVisible()
})
