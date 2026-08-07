import { expect, test, type Page } from '@playwright/test'

const mobileViewports = [
  { width: 390, height: 844 },
  { width: 375, height: 812 },
  { width: 360, height: 800 },
]

async function loginAsTrainer(page: import('@playwright/test').Page) {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()
}

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

async function selectClient(page: Page) {
  await page.locator('.client-picker-trigger').click()
  await page.locator('.client-picker-item').filter({ hasText: 'Анна Смирнова' }).first().click()
}

async function addExercise(page: Page, name: string, first = false) {
  await page.getByRole('button', { name: first ? 'Выбрать упражнения' : '＋ Упражнение' }).click()
  await page.getByLabel('Поиск упражнения').fill(name)
  await page.getByRole('button', { name: new RegExp(name) }).first().click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
}

async function createGroupedWorkout(page: Page, preset: 'set' | 'circuit') {
  await page.goto('/workouts/new')
  await selectClient(page)
  await addExercise(page, 'Присед со штангой', true)
  await addExercise(page, 'Жим лёжа')
  await page.getByRole('button', { name: 'Ещё действия' }).first().click()
  await page.getByRole('menuitem', { name: 'Объединить со следующим в блок' }).click()
  if (preset === 'circuit') await page.getByLabel('Тип блока').selectOption('circuit')
  await page.getByLabel('Кругов').fill('2')
  for (let round = 1; round <= 2; round += 1) {
    for (let index = 0; index < 2; index += 1) {
      await page.getByLabel(`Вес, подход ${round}`).nth(index).fill('40')
      await page.getByLabel(`Повторы, подход ${round}`).nth(index).fill('10')
    }
  }
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Начать' }).click()
  await expect(page.locator('.live-timer')).toBeVisible()
  await expect(page.locator('.live-pinned .circuit-counter')).toHaveText('Круг 1 из 2')
}

function currentRound(page: Page) {
  return page.locator('.circuit-round.current')
}

async function confirmCurrentSet(page: Page) {
  await currentRound(page).getByRole('button', { name: 'Готово, отдых' }).first().click()
}

async function openReviewWithFixture(page: import('@playwright/test').Page) {
  // Изолированная тестовая заглушка: не меняет LLM-клиент, промпт или обработку ошибок
  // в приложении, но стабильно создаёт самый плотный экран «Проверьте тренировку».
  await page.route('**/functions/v1/parse-workout', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        items: [{
          sourceText: 'Жим лёжа (Штанга) 3×8 — 80 кг',
          exerciseRef: 'bench-press',
          confidence: 1,
          sets: [
            { weightKg: 80, reps: 8 },
            { weightKg: 80, reps: 8 },
            { weightKg: 80, reps: 8 },
          ],
        }],
        unmatched: [],
      }),
    })
  })
  await page.goto('/today')
  await page.getByLabel('Тренировка').fill('Жим лёжа (Штанга) 3×8 — 80 кг')
  await page.getByRole('button', { name: 'Разобрать тренировку' }).click()
  await expect(page.getByRole('heading', { name: 'Проверьте тренировку' })).toBeVisible()
}

for (const viewport of mobileViewports) {
  test(`iPhone: основной сценарий не выходит за ширину ${viewport.width} px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await loginAsTrainer(page)

    for (const screen of ['/today', '/clients', '/schedule']) {
      await page.goto(screen)
      await expect(page.locator('main')).toBeVisible()
      await expectNoHorizontalOverflow(page)
    }

    await openReviewWithFixture(page)
    await expect(page.locator('.today-exercise')).toHaveCount(1)
    await expectNoHorizontalOverflow(page)
  })
}

test('iPhone: одиночный отдых переживает reload, сдвиг и пропуск на 390 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await loginAsTrainer(page)
  await page.goto('/workouts/new')
  await selectClient(page)
  await addExercise(page, 'Присед со штангой', true)
  await page.getByLabel('Вес, подход 1').fill('40')
  await page.getByLabel('Повторы, подход 1').fill('10')
  await page.getByRole('button', { name: '＋ Подход' }).click()
  await page.getByLabel('Вес, подход 2').fill('40')
  await page.getByLabel('Повторы, подход 2').fill('10')
  await page.getByText('Дополнительно').click()
  await page.getByLabel('Отдых между подходами, с').fill('90')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await page.getByRole('button', { name: 'Начать' }).click()
  await page.getByRole('button', { name: 'Готово, отдых' }).first().click()
  await expect(page.getByText(/Отдых 1:(2[7-9]|30)/)).toBeVisible()
  await page.getByRole('button', { name: 'Плюс 15 секунд' }).click()
  await expect(page.getByText(/Отдых 1:4\d/)).toBeVisible()
  await page.reload()
  await expect(page.getByText(/Отдых 1:4\d/)).toBeVisible()
  await page.getByRole('button', { name: 'Пропустить' }).click()
  await expect(page.locator('.rest-timer')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('iPhone: частично завершённая тренировка помечена на 390 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await loginAsTrainer(page)
  await page.goto('/workouts/new')
  await selectClient(page)
  await addExercise(page, 'Присед со штангой', true)
  await page.getByLabel('Вес, подход 1').fill('40')
  await page.getByLabel('Повторы, подход 1').fill('10')
  await page.getByRole('button', { name: '＋ Подход' }).click()
  await page.getByLabel('Вес, подход 2').fill('40')
  await page.getByLabel('Повторы, подход 2').fill('10')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await page.getByRole('button', { name: 'Начать' }).click()
  await page.getByRole('button', { name: 'Готово, отдых' }).first().click()
  await page.getByRole('button', { name: 'Завершить тренировку' }).click()
  await page.getByRole('button', { name: 'Завершить', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка завершена' })).toBeVisible()
  await expect(page.locator('.workout-detail-page .badge.partial')).toHaveText('Частично')
  await expectNoHorizontalOverflow(page)
})

test('iPhone: прогресс открывается из карточки клиента на 390 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await loginAsTrainer(page)
  await expect(page.getByRole('link', { name: 'Аналитика', exact: true })).toHaveCount(0)
  const trainerNavigation = page.getByRole('navigation', { name: 'Основная навигация' })
  await expect(trainerNavigation.getByRole('link')).toHaveCount(3)
  const trainerColumns = await trainerNavigation.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)
  expect(trainerColumns).toBe(3)
  await page.goto('/clients')
  await page.getByRole('link', { name: /Анна Смирнова/ }).first().click()
  await expect(page.getByRole('heading', { name: 'Анна Смирнова' })).toBeVisible()
  await page.getByRole('link', { name: 'Замеры и прогресс' }).click()
  await expect(page.getByRole('heading', { name: /Прогресс · Анна Смирнова/ })).toBeVisible()
  await page.locator('.page-back').click()
  await expect(page.getByRole('heading', { name: 'Анна Смирнова' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('iPhone: сет не ставит отдых внутри круга и не оставляет его после финала', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await loginAsTrainer(page)
  await createGroupedWorkout(page, 'set')
  await confirmCurrentSet(page)
  await expect(currentRound(page).locator('.live-set-compact.confirmed')).toHaveCount(1)
  await expect(page.locator('.rest-timer')).toHaveCount(0)
  await confirmCurrentSet(page)
  await expect(page.locator('.circuit-round.done')).toHaveCount(1)
  await expect(page.getByText(/Отдых 1:(2[7-9]|30)/)).toBeVisible()
  await expect(page.locator('.live-pinned .circuit-counter')).toHaveText('Круг 2 из 2')
  await page.getByRole('button', { name: 'Пропустить' }).click()
  await confirmCurrentSet(page)
  await expect(currentRound(page).locator('.live-set-compact.confirmed')).toHaveCount(1)
  await expect(page.locator('.rest-timer')).toHaveCount(0)
  await confirmCurrentSet(page)
  await expect(page.locator('.circuit-round.done')).toHaveCount(2)
  await expect(page.locator('.rest-timer')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('iPhone: круговая использует отдых между упражнениями и между кругами', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await loginAsTrainer(page)
  await createGroupedWorkout(page, 'circuit')
  await confirmCurrentSet(page)
  await expect(currentRound(page).locator('.live-set-compact.confirmed')).toHaveCount(1)
  await expect(page.getByText(/Отдых 0:1[2-5]/)).toBeVisible()
  await page.getByRole('button', { name: 'Пропустить' }).click()
  await confirmCurrentSet(page)
  await expect(page.locator('.circuit-round.done')).toHaveCount(1)
  await expect(page.getByText(/Отдых 0:5[7-9]|Отдых 1:00/)).toBeVisible()
  await expect(page.locator('.live-pinned .circuit-counter')).toHaveText('Круг 2 из 2')
  await page.getByRole('button', { name: 'Пропустить' }).click()
  await confirmCurrentSet(page)
  await expect(currentRound(page).locator('.live-set-compact.confirmed')).toHaveCount(1)
  await expect(page.getByText(/Отдых 0:1[2-5]/)).toBeVisible()
  await page.getByRole('button', { name: 'Пропустить' }).click()
  await confirmCurrentSet(page)
  await expect(page.locator('.circuit-round.done')).toHaveCount(2)
  await expect(page.locator('.rest-timer')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})
