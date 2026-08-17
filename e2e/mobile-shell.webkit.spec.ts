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

async function login(page: import('@playwright/test').Page, email: string) {
  await page.goto('/auth')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/me$/)
}

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

async function expectOverflowMenuAboveBars(page: Page) {
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  const menuBox = await menu.boundingBox()
  const frameBox = await page.locator('.phone-frame').boundingBox()
  const barBoxes = await page.locator('.tab-bar, .live-bottom-bar').evaluateAll((bars) => bars
    .filter((bar) => {
      const style = window.getComputedStyle(bar)
      return style.display !== 'none' && style.visibility !== 'hidden'
    })
    .map((bar) => {
      const rect = bar.getBoundingClientRect()
      return { top: rect.top, bottom: rect.bottom }
    }))
  expect(menuBox).not.toBeNull()
  expect(frameBox).not.toBeNull()
  expect(menuBox!.y).toBeGreaterThanOrEqual(frameBox!.y)
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(Math.min(frameBox!.y + frameBox!.height, ...barBoxes.map((bar) => bar.top)))
  expect(await menu.evaluate((element) => window.getComputedStyle(element).opacity)).toBe('1')
}

test('iPhone: поля бега не перекрываются в быстрой проверке тренера на 390 px', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await loginAsTrainer(page)
  await page.route('**/functions/v1/parse-workout', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        items: [{
          sourceText: 'Бег',
          exerciseRef: 'running',
          confidence: 1,
          sets: [],
        }],
        unmatched: [],
      }),
    })
  })

  await page.getByRole('button', { name: 'Ввести текстом' }).click()
  await page.getByLabel('Тренировка').fill('Бег')
  await page.getByRole('button', { name: 'Разобрать тренировку' }).click()
  await expect(page.getByRole('heading', { name: 'Проверьте тренировку' })).toBeVisible()
  await page.getByText('Добавить значения', { exact: true }).click()

  const row = page.locator('.today-set-editor').first()
  const durationLabel = row.locator('label').filter({ hasText: 'Бег (Кардио): время, подход 1' })
  const duration = page.getByLabel('Бег (Кардио): время, подход 1')
  const distance = page.getByLabel('Бег (Кардио): расстояние, подход 1')
  const unit = page.getByLabel('Бег (Кардио): единица расстояния, подход 1')
  await expect(durationLabel).toHaveCSS('position', 'absolute')
  await expect(duration).toHaveAttribute('placeholder', 'мм:сс')
  await expect(distance).toHaveAttribute('placeholder', '0')
  await expect(unit).toHaveValue('km')
  await expect(unit.locator('option:checked')).toHaveText('км')

  const rowBox = await row.boundingBox()
  const durationBox = await duration.boundingBox()
  const distanceBox = await distance.boundingBox()
  const unitBox = await unit.boundingBox()
  expect(rowBox).not.toBeNull()
  expect(durationBox).not.toBeNull()
  expect(distanceBox).not.toBeNull()
  expect(unitBox).not.toBeNull()
  for (const box of [durationBox!, distanceBox!, unitBox!]) {
    expect(box.x).toBeGreaterThanOrEqual(rowBox!.x)
    expect(box.x + box.width).toBeLessThanOrEqual(rowBox!.x + rowBox!.width)
  }
  expect(distanceBox!.x).toBeGreaterThanOrEqual(durationBox!.x + durationBox!.width)
  expect(unitBox!.x).toBeGreaterThanOrEqual(distanceBox!.x + distanceBox!.width)
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('running-review.png'), fullPage: true })
})

test('iPhone: новое имя профиля сохраняется после reload на 390 px', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Имя').fill('Профиль')
  await page.getByLabel('Email').fill(`profile-name-${testInfo.workerIndex}-${Date.now()}@fit.local`)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()

  await page.goto('/profile')
  await page.getByLabel('Имя').fill('Новое имя')
  await page.getByLabel('Часовой пояс').fill('Europe/Berlin')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('status')).toContainText('Сохранено')
  await page.reload()
  await expect(page.getByLabel('Имя')).toHaveValue('Новое имя')
  await expect(page.getByLabel('Часовой пояс')).toHaveValue('Europe/Berlin')
  await expectNoHorizontalOverflow(page)
})

test('iPhone: client voice-first home сохраняет тренировку только себе, а Cancel профиля не мутирует данные на 390 px', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Тип аккаунта').selectOption('client')
  await page.getByLabel('Имя').fill('Клиент')
  await page.getByLabel('Email').fill(`client-profile-${testInfo.workerIndex}-${Date.now()}@fit.local`)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()

  await page.getByLabel('Пол').selectOption('female')
  await page.getByLabel('Возраст').fill('30')
  await page.getByLabel('Рост, см').fill('170')
  await page.getByLabel('Начальный вес, кг').fill('65')
  await page.getByLabel('Цель').fill('Тренироваться регулярно')
  await page.getByRole('button', { name: 'Создать карточку' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Надиктовать тренировку' })).toBeInViewport()
  await page.evaluate(() => Object.keys(localStorage)
    .filter((key) => key.startsWith('fit.today-draft.'))
    .forEach((key) => localStorage.removeItem(key)))
  await page.reload()
  await expect(page.getByRole('button', { name: 'Надиктовать тренировку' })).toBeInViewport()
  await page.route('**/functions/v1/parse-workout', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        items: [{
          sourceText: 'Жим лёжа 3×8 — 80 кг',
          exerciseRef: 'bench-press',
          confidence: 1,
          sets: [{ weightKg: 80, reps: 8 }, { weightKg: 80, reps: 8 }, { weightKg: 80, reps: 8 }],
        }],
        unmatched: [],
      }),
    })
  })
  await page.getByRole('button', { name: 'Ввести текстом' }).click()
  await page.getByLabel('Тренировка').fill('Жим лёжа 3×8 — 80 кг')
  await page.getByRole('button', { name: 'Разобрать тренировку' }).click()
  await expect(page.getByRole('heading', { name: 'Проверьте тренировку' })).toBeVisible()
  await page.getByRole('button', { name: 'Далее' }).click()
  await expect(page.getByText('Тренировка будет сохранена в ваш кабинет')).toBeVisible()
  await expect(page.locator('.client-picker-trigger')).toHaveCount(0)
  await page.getByRole('link', { name: 'Профиль', exact: true }).click()
  await expect(page).toHaveURL(/\/me\/profile$/)
  await page.getByRole('link', { name: 'Изменить данные' }).click()
  await page.getByLabel('Имя').fill('Клиент Обновлённый')
  await Promise.all([
    page.waitForURL(/\/me$/),
    page.getByRole('button', { name: 'Сохранить' }).click(),
  ])
  await expect(page.getByText(/Клиент Обновлённый/)).toBeVisible()

  await page.goto('/me/profile')
  await expect(page.getByText('Клиент Обновлённый', { exact: true })).toBeVisible()
  await page.goto('/me/edit')
  await expect(page.getByRole('heading', { name: 'Редактировать клиента' })).toBeVisible()
  await page.getByLabel('Имя').fill('Черновик отмены')
  await Promise.all([
    page.waitForURL(/\/me\/profile$/),
    page.getByRole('button', { name: 'Отмена' }).click(),
  ])
  await expect(page.getByText('Клиент Обновлённый', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Пригласить тренера' })).toBeInViewport()
  await page.reload()
  await expect(page.getByText('Клиент Обновлённый', { exact: true })).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('iPhone: в live клиент видит те же действия с тренировкой, что и тренер, на 390 px', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Тип аккаунта').selectOption('client')
  await page.getByLabel('Имя').fill('Live клиент')
  await page.getByLabel('Email').fill(`client-live-${testInfo.workerIndex}-${Date.now()}@fit.local`)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Пол').selectOption('female')
  await page.getByLabel('Возраст').fill('30')
  await page.getByLabel('Рост, см').fill('170')
  await page.getByLabel('Начальный вес, кг').fill('65')
  await page.getByLabel('Цель').fill('Тренироваться регулярно')
  await page.getByRole('button', { name: 'Создать карточку' }).click()

  await page.goto('/me/workouts')
  await page.getByRole('link', { name: 'Добавить' }).click()
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByLabel('Поиск упражнения').fill('Бег')
  await page.getByRole('button', { name: /^Бег/ }).first().click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Начать тренировку' }).click()

  await expect(page.getByRole('button', { name: '＋ Подход' })).toBeInViewport()
  await expect(page.getByRole('button', { name: '＋ Ещё упражнение' })).toBeInViewport()
  await page.getByRole('button', { name: 'Ещё действия' }).click()
  await expect(page.getByRole('menuitem', { name: 'Заменить' })).toBeVisible()
  await expectOverflowMenuAboveBars(page)

  // Второй план не должен молча заменить первую незавершённую тренировку.
  // Пользователь остаётся на выбранном плане, пока явно не согласится открыть
  // уже идущую запись; после «Назад» возвращается в её собственную карточку.
  const activeWorkoutPath = new URL(page.url()).pathname.replace(/\/live$/, '')
  await page.getByRole('button', { name: 'Назад' }).click()
  expect(new URL(page.url()).pathname).toBe(activeWorkoutPath)
  await page.goto('/me/workouts')
  await page.getByRole('link', { name: 'Добавить' }).click()
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByLabel('Поиск упражнения').fill('Планка')
  await page.getByRole('button', { name: /^Планка/ }).first().click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await Promise.all([
    page.waitForURL(/\/workouts\/[0-9a-f-]+$/),
    page.getByRole('button', { name: 'Сохранить' }).click(),
  ])
  const selectedPlanPath = new URL(page.url()).pathname
  await page.getByRole('button', { name: 'Начать тренировку' }).click()
  const recovery = page.getByRole('alertdialog')
  await expect(recovery).toContainText('уже есть незавершённая тренировка')
  expect(new URL(page.url()).pathname).toBe(selectedPlanPath)
  await page.keyboard.press('Escape')
  await expect(recovery).toHaveCount(0)
  expect(new URL(page.url()).pathname).toBe(selectedPlanPath)
  await page.getByRole('button', { name: 'Начать тренировку' }).click()
  await recovery.getByRole('button', { name: 'Открыть незавершённую' }).click()
  await expect(page).toHaveURL(new RegExp(`${activeWorkoutPath}/live$`))
  await page.getByRole('button', { name: 'Назад' }).click()
  expect(new URL(page.url()).pathname).toBe(activeWorkoutPath)
  await expectNoHorizontalOverflow(page)
})

test('iPhone: client edits shared progress, custom metrics and deletion safely', async ({ page }, testInfo) => {
  testInfo.setTimeout(60_000)
  await page.setViewportSize({ width: 390, height: 844 })
  const clientId = '11111111-1111-4111-8111-111111111111'
  const metricName = `Объём ${testInfo.workerIndex}-${Date.now()}`

  await loginAsTrainer(page)
  await page.goto(`/progress/${clientId}`)
  await page.getByPlaceholder('Название').fill(metricName)
  await page.getByPlaceholder('Единица').fill('балл')
  await page.getByRole('button', { name: 'Добавить', exact: true }).last().click()
  await expect(page.getByText(`${metricName}, балл`, { exact: true }).first()).toBeVisible()

  await page.goto('/profile')
  await page.getByRole('button', { name: 'Выйти' }).click()
  await login(page, 'client@fit.local')
  await page.goto('/me/progress')
  await expect(page.getByRole('heading', { name: 'Мой прогресс' })).toBeVisible()
  await page.getByRole('button', { name: 'Добавить замер' }).click()
  await expect(page.getByLabel(`${metricName}, балл`)).toBeVisible()

  const trainerEntry = page.locator('.client-progress-history article.card').first()
  await expect(trainerEntry).toContainText('27 июля 2026 г.')
  await trainerEntry.getByRole('button', { name: 'Изменить' }).click()
  await trainerEntry.getByLabel('Вес, кг').fill('65.7')
  await trainerEntry.getByRole('button', { name: 'Сохранить замер' }).click()
  await expect(trainerEntry).toContainText('65.7 кг')

  await page.getByLabel(`${metricName}, балл`).fill('3')
  await page.getByLabel('Заметка').fill('Проверила замер после тренировки')
  await page.getByRole('button', { name: 'Сохранить замер' }).first().click()
  const ownEntry = page.locator('.client-progress-history article.card').filter({ hasText: metricName })
  await expect(ownEntry).toContainText('3 балл')
  await expect(ownEntry).toContainText('Проверила замер после тренировки')

  await ownEntry.getByRole('button', { name: 'Изменить' }).click()
  await ownEntry.getByLabel(`${metricName}, балл`).fill('4')
  await ownEntry.getByRole('button', { name: 'Сохранить замер' }).click()
  await expect(ownEntry).toContainText('4 балл')

  await ownEntry.getByRole('button', { name: 'Удалить' }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить' }).click()
  await expect(ownEntry).toHaveCount(0)
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
})

test('iPhone: client progress keeps one goal-aware LLM summary', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page, 'client@fit.local')
  await page.goto('/me/progress')

  await expect(page.getByRole('heading', { name: 'Мой прогресс' })).toBeVisible()
  await expect(page.getByLabel('Регулярность тренировок')).toHaveCount(0)
  await expect(page.getByText('Твой прогресс', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '1 месяц' })).toHaveClass(/active/)
  await expect(page.getByRole('button', { name: '3 месяца' })).toBeVisible()
  await expect(page.getByRole('button', { name: '6 месяцев' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Твоя цель' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Что делать дальше' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Обновить мой прогресс' })).toBeVisible()

  await page.getByText('ЗАМЕРЫ ТЕЛА', { exact: true }).scrollIntoViewIfNeeded()
  await page.getByRole('button', { name: 'Добавить замер' }).click()
  await expect(page.getByRole('heading', { name: 'Новый замер' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Сохранить замер' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

async function selectClient(page: Page, name = 'Анна Смирнова') {
  await page.locator('.client-picker-trigger').click()
  await page.locator('.client-picker-item').filter({ hasText: name }).first().click()
}

async function createIsolatedClient(page: Page, testInfo: import('@playwright/test').TestInfo) {
  const suffix = `${testInfo.workerIndex}-${Date.now()}`
  const name = `WebKit клиент ${suffix}`
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Имя').fill('WebKit тренер')
  await page.getByLabel('Email').fill(`webkit-trainer-${suffix}@fit.local`)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()
  await page.goto('/clients/new')
  await page.getByLabel('Имя').fill(name)
  await page.getByLabel('Пол').selectOption('female')
  await page.getByLabel('Возраст').fill('30')
  await page.getByLabel('Рост, см').fill('170')
  await page.getByLabel('Начальный вес, кг').fill('65')
  await Promise.all([
    page.waitForURL(/\/clients\/[0-9a-f-]+$/),
    page.getByRole('button', { name: 'Сохранить' }).click(),
  ])
  return name
}

async function addExercise(page: Page, name: string, first = false) {
  await page.getByRole('button', { name: first ? 'Выбрать упражнения' : '＋ Упражнение' }).click()
  await page.getByLabel('Поиск упражнения').fill(name)
  await page.getByRole('button', { name: new RegExp(name) }).first().click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
}

async function createGroupedWorkout(page: Page, clientName: string, preset: 'set' | 'circuit') {
  await page.goto('/workouts/new')
  await selectClient(page, clientName)
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
  await page.getByRole('button', { name: 'Ввести текстом' }).click()
  await page.getByLabel('Тренировка').fill('Жим лёжа (Штанга) 3×8 — 80 кг')
  await page.getByRole('button', { name: 'Разобрать тренировку' }).click()
  await expect(page.getByRole('heading', { name: 'Проверьте тренировку' })).toBeVisible()
}

for (const viewport of mobileViewports) {
  test(`iPhone: основной сценарий не выходит за ширину ${viewport.width} px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await loginAsTrainer(page)

    for (const screen of ['/today', '/clients', '/clients/11111111-1111-4111-8111-111111111111', '/schedule']) {
      await page.goto(screen)
      await expect(page.locator('main')).toBeVisible()
      if (screen === '/today') {
        await expect(page.getByRole('button', { name: 'Надиктовать тренировку' })).toBeVisible()
        await expect(page.getByLabel('Тренировка')).toHaveCount(0)
      }
      if (screen.includes('11111111')) {
        await expect(page.getByRole('heading', { name: 'Анна Смирнова' })).toBeVisible()
        await expect(page.getByRole('link', { name: 'Редактировать профиль' })).toBeVisible()
        await expect(page.locator('.client-detail-overview')).toHaveCount(0)
      }
      await expectNoHorizontalOverflow(page)
    }

    await openReviewWithFixture(page)
    await expect(page.locator('.today-exercise')).toHaveCount(1)
    await expectNoHorizontalOverflow(page)
  })
}

test('iPhone: черновик не скрывает главное voice-действие на 390 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await loginAsTrainer(page)
  await page.getByRole('button', { name: 'Ввести текстом' }).click()
  await page.getByLabel('Тренировка').fill('Жим лёжа 3×10 — 80 кг')
  await page.getByRole('link', { name: 'Клиенты' }).click()
  await page.getByRole('link', { name: 'Сегодня', exact: true }).click()

  await expect(page.getByRole('button', { name: 'Надиктовать тренировку' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Надиктовать тренировку' })).toBeInViewport()
  await expect(page.getByText('Есть незавершённая тренировка')).toBeVisible()
  expect(await page.locator('.content').evaluate((element) => element.scrollTop)).toBe(0)
  await expectNoHorizontalOverflow(page)
})

test('iPhone: voice-first и AI-поверхности сохраняют контраст в тёмной теме на 390 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => window.localStorage.setItem('fit.appTheme', 'dark'))
  await loginAsTrainer(page)

  const voiceButton = page.getByRole('button', { name: 'Надиктовать тренировку' })
  await expect(voiceButton).toBeVisible()
  await expect(page.locator('.phone-frame')).not.toHaveClass(/theme-light/)
  expect(await voiceButton.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe('rgb(255, 254, 252)')
  expect(await page.locator('.voice-action-label strong').evaluate((element) => getComputedStyle(element).color)).not.toBe('rgb(23, 25, 29)')
  await expect(page.locator('.phone-frame')).toHaveScreenshot('today-voice-dark-390.png', { animations: 'disabled', maxDiffPixelRatio: 0.03 })

  await page.goto('/progress/11111111-1111-4111-8111-111111111111')
  const aiCard = page.locator('.ai-progress-card')
  await expect(aiCard).toBeVisible()
  expect(await aiCard.evaluate((element) => getComputedStyle(element).borderTopColor)).toBe('rgb(107, 68, 54)')
  await expectNoHorizontalOverflow(page)
})

test('iPhone: LLM regularity stays inside the single Progress summary at 390 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page, 'client@fit.local')
  await page.goto('/me/progress')

  await expect(page.getByLabel('Регулярность тренировок')).toHaveCount(0)
  const summary = page.locator('.client-progress-card')
  await expect(summary).toBeVisible()
  await expect(summary.getByText('Твоя регулярность', { exact: true })).toBeVisible()
  await expect(summary.getByText(/\/ нед\./)).toBeVisible()
  await expect(summary.getByText('Твоя цель', { exact: true })).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('iPhone: ручной выбор начинает с недавних, а не с разминки на 390 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await loginAsTrainer(page)
  await page.evaluate(() => window.localStorage.setItem('fit.recent-exercises', JSON.stringify(['bench-press'])))
  await page.goto('/workouts/new')
  await selectClient(page)
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()

  await expect(page.getByText('Недавние')).toBeVisible()
  await expect(page.getByText('Все упражнения')).toBeVisible()
  await expect(page.getByText('Разминка и мобилити')).toHaveCount(0)
  await expect(page.locator('.picker-item[data-exercise-ref="bench-press"]')).toHaveCount(1)
  await expectNoHorizontalOverflow(page)
})

test('iPhone: меню упражнения плана не перекрывает нижнюю панель на 390 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await loginAsTrainer(page)
  await page.goto('/workouts/new')
  await selectClient(page)
  await addExercise(page, 'Присед со штангой', true)
  await addExercise(page, 'Планка')

  const actions = page.getByRole('button', { name: 'Ещё действия' })
  await actions.last().scrollIntoViewIfNeeded()
  await actions.last().click()
  await expect(page.getByRole('menuitem', { name: 'Удалить' })).toBeVisible()
  await expectOverflowMenuAboveBars(page)
  await page.keyboard.press('Escape')
  const save = page.getByRole('button', { name: 'Сохранить', exact: true })
  await save.scrollIntoViewIfNeeded()
  const mobileLayout = await page.evaluate(() => {
    const content = document.querySelector('.content')!.getBoundingClientRect()
    const tabBar = document.querySelector('.tab-bar')!
    const bar = tabBar.getBoundingClientRect()
    return { contentBottom: content.bottom, barTop: bar.top, barPosition: getComputedStyle(tabBar).position }
  })
  expect(mobileLayout.barPosition).toBe('static')
  expect(Math.abs(mobileLayout.contentBottom - mobileLayout.barTop)).toBeLessThanOrEqual(1)
  const saveBox = await save.boundingBox()
  expect(saveBox).not.toBeNull()
  expect(saveBox!.y + saveBox!.height).toBeLessThan(mobileLayout.barTop)
  await expectNoHorizontalOverflow(page)
})

test('iPhone: одиночный отдых переживает reload, сдвиг и пропуск на 390 px', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const clientName = await createIsolatedClient(page, testInfo)
  await page.goto('/workouts/new')
  await selectClient(page, clientName)
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

test('iPhone: введённый live-факт переживает обрыв сети и reload на 390 px', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const clientName = await createIsolatedClient(page, testInfo)
  await page.goto('/workouts/new')
  await selectClient(page, clientName)
  await addExercise(page, 'Присед со штангой', true)
  await page.getByLabel('Вес, подход 1').fill('40')
  await page.getByLabel('Повторы, подход 1').fill('10')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await page.getByRole('button', { name: 'Начать' }).click()

  await page.route('**/rest/v1/rpc/save_live_set_draft', (route) => route.abort('failed'))
  await page.getByLabel('Фактический вес').fill('55')
  await page.locator('.live-timer').click()
  await expect(page.locator('.error').filter({ hasText: 'Ответ сервера не получен' })).toBeVisible()
  await page.unroute('**/rest/v1/rpc/save_live_set_draft')

  await page.reload()
  await expect(page.getByText(/Восстановили несохранённые данные/)).toBeVisible()
  await expect(page.getByLabel('Фактический вес')).toHaveValue('55')
  await expectNoHorizontalOverflow(page)
})

test('iPhone: отдых начинается после последнего подхода первого упражнения на 390 px', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const clientName = await createIsolatedClient(page, testInfo)
  await page.goto('/workouts/new')
  await selectClient(page, clientName)
  await addExercise(page, 'Присед со штангой', true)
  await addExercise(page, 'Жим лёжа')
  await page.getByLabel('Вес, подход 1').first().fill('40')
  await page.getByLabel('Повторы, подход 1').first().fill('10')
  await page.getByLabel('Вес, подход 1').nth(1).fill('40')
  await page.getByLabel('Повторы, подход 1').nth(1).fill('10')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await page.getByRole('button', { name: 'Начать' }).click()

  await page.getByRole('button', { name: 'Готово, отдых' }).first().click()
  await expect(page.getByText(/Отдых 1:(2[7-9]|30)/)).toBeVisible()
  await expect(page.locator('.live-exercise-upcoming')).toContainText('Жим лёжа')
  await expectNoHorizontalOverflow(page)
})

test('iPhone: live-меню остаётся непрозрачным и не уходит под нижнюю панель на 390 px', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const clientName = await createIsolatedClient(page, testInfo)
  await page.goto('/workouts/new')
  await selectClient(page, clientName)
  await addExercise(page, 'Присед со штангой', true)
  await addExercise(page, 'Жим лёжа')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await page.getByRole('button', { name: 'Начать' }).click()
  await page.getByRole('button', { name: 'Ещё действия' }).nth(1).click()

  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  expect(await menu.evaluate((element) => getComputedStyle(element).opacity)).toBe('1')
  const menuBox = await menu.boundingBox()
  const footerBox = await page.locator('.live-bottom-bar').boundingBox()
  expect(menuBox).not.toBeNull()
  expect(footerBox).not.toBeNull()
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(footerBox!.y)
  await expectNoHorizontalOverflow(page)
})

test('iPhone: частично завершённая тренировка помечена на 390 px', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const clientName = await createIsolatedClient(page, testInfo)
  await page.goto('/workouts/new')
  await selectClient(page, clientName)
  await addExercise(page, 'Присед со штангой', true)
  await page.getByLabel('Вес, подход 1').fill('40')
  await page.getByLabel('Повторы, подход 1').fill('10')
  await page.getByRole('button', { name: '＋ Подход' }).click()
  await page.getByLabel('Вес, подход 2').fill('40')
  await page.getByLabel('Повторы, подход 2').fill('10')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.locator('.planned-set-summary')).toHaveText(/План.*2 × 40 кг × 10 повт\./)
  await expect(page.locator('.planned-set-summary').locator('..').locator('.workout-history-sets')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
  await page.getByRole('button', { name: 'Начать' }).click()
  await page.getByRole('button', { name: 'Готово, отдых' }).first().click()
  await page.getByRole('button', { name: 'Завершить тренировку' }).click()
  await page.getByRole('button', { name: 'Завершить', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка завершена' })).toBeVisible()
  await expect(page.locator('.workout-detail-page .badge.partial')).toHaveText('Частично')
  await expect(page.locator('.completed-set-summary')).toContainText('не выполнено:')
  await expect(page.locator('.workout-history-sets')).toHaveCount(0)
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

test('iPhone: сет не ставит отдых внутри круга и не оставляет его после финала', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const clientName = await createIsolatedClient(page, testInfo)
  await createGroupedWorkout(page, clientName, 'set')
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

test('iPhone: круговая использует отдых между упражнениями и между кругами', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const clientName = await createIsolatedClient(page, testInfo)
  await createGroupedWorkout(page, clientName, 'circuit')
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
