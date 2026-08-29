import { expect, test, type Locator, type Page } from '@playwright/test'

const demoClientId = '11111111-1111-4111-8111-111111111111'

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

async function expectMobileShellFillsViewport(page: Page) {
  const geometry = await page.evaluate(() => {
    const frame = document.querySelector('.phone-frame')?.getBoundingClientRect()
    const root = document.querySelector('#root')?.getBoundingClientRect()
    return {
      viewportHeight: window.innerHeight,
      scrollY: window.scrollY,
      frame: frame ? { top: frame.top, bottom: frame.bottom, height: frame.height } : null,
      root: root ? { top: root.top, bottom: root.bottom, height: root.height } : null,
      rootPosition: window.getComputedStyle(document.querySelector('#root')!).position,
    }
  })
  expect(geometry.frame).not.toBeNull()
  expect(geometry.root).not.toBeNull()
  expect(geometry.rootPosition).toBe('fixed')
  expect(Math.abs(geometry.root!.top)).toBeLessThanOrEqual(1)
  expect(Math.abs(geometry.frame!.top)).toBeLessThanOrEqual(1)
  expect(Math.abs(geometry.root!.bottom - geometry.viewportHeight)).toBeLessThanOrEqual(1)
  expect(Math.abs(geometry.frame!.bottom - geometry.viewportHeight)).toBeLessThanOrEqual(1)
  expect(Math.abs(geometry.frame!.height - geometry.viewportHeight)).toBeLessThanOrEqual(1)
  expect(geometry.scrollY).toBe(0)
}

async function recoverMobileShellFromStaleKeyboard(page: Page, input: Locator) {
  await input.focus()
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--app-viewport-height', '508px')
    document.documentElement.style.setProperty('--app-visible-height', '508px')
    document.documentElement.classList.add('app-keyboard-open')
  })
  await input.blur()
  await expect.poll(() => page.evaluate(() => ({
    keyboardClass: document.documentElement.classList.contains('app-keyboard-open'),
    height: document.documentElement.style.getPropertyValue('--app-viewport-height'),
  }))).toEqual({ keyboardClass: false, height: `${await page.evaluate(() => window.innerHeight)}px` })
  await expectMobileShellFillsViewport(page)
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

test('iPhone: поиск и фильтры каталога не перекрывают друг друга', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await loginAsTrainer(page)

  await page.getByRole('button', { name: 'Ввести текстом' }).click()
  await page.getByRole('button', { name: 'Выбрать упражнения вручную' }).click()
  await page.getByRole('button', { name: /^Силовая/ }).click()

  const search = page.getByLabel('Поиск упражнения')
  await search.focus()
  await expect(search).toBeFocused()
  await page.getByRole('button', { name: 'Фильтры' }).click()
  await expect(search).not.toBeFocused()
  await page.getByLabel('Группа мышц').selectOption('legs')
  await expect(page.getByRole('button', { name: 'Фильтры 1' })).toBeVisible()

  await search.focus()
  await expect(page.getByLabel('Группа мышц')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Фильтры 1' })).toBeVisible()
  await search.fill('присед')
  await expect(page.locator('.picker-list-meta').getByText(/\d+ упражнени(?:е|я|й)/)).toBeVisible()
  await expect(page.getByRole('button', { name: /Присед/ }).first()).toBeInViewport()
  await expectNoHorizontalOverflow(page)
})

test('iPhone: поля бега не перекрываются в быстрой проверке тренера на 390 px', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await loginAsTrainer(page)
  await page.route('**/functions/v1/parse-workout', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          {
            sourceText: 'Бег',
            exerciseRef: 'running',
            confidence: 1,
            sets: [],
          },
          {
            sourceText: 'Жим лёжа 3×8 — 80 кг',
            exerciseRef: 'bench-press',
            confidence: 1,
            sets: [{ weightKg: 80, reps: 8 }],
          },
        ],
        unmatched: [],
      }),
    })
  })

  await page.getByRole('button', { name: 'Ввести текстом' }).click()
  await page.getByLabel('Тренировка').fill('Бег\nЖим лёжа 3×8 — 80 кг')
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
  await expect(unit).toHaveCSS('appearance', 'none')

  const rowBox = await row.boundingBox()
  const durationBox = await duration.boundingBox()
  const distanceBox = await distance.boundingBox()
  const unitBox = await unit.boundingBox()
  expect(rowBox).not.toBeNull()
  expect(durationBox).not.toBeNull()
  expect(distanceBox).not.toBeNull()
  expect(unitBox).not.toBeNull()
  expect(unitBox!.width).toBeGreaterThanOrEqual(60)
  for (const box of [durationBox!, distanceBox!, unitBox!]) {
    expect(box.x).toBeGreaterThanOrEqual(rowBox!.x)
    expect(box.x + box.width).toBeLessThanOrEqual(rowBox!.x + rowBox!.width)
  }
  expect(distanceBox!.x).toBeGreaterThanOrEqual(durationBox!.x + durationBox!.width)
  expect(unitBox!.x).toBeGreaterThanOrEqual(distanceBox!.x + distanceBox!.width)
  await unit.selectOption('m')
  await expect(unit.locator('option:checked')).toHaveText('м')
  await unit.selectOption('km')
  await expect(unit.locator('option:checked')).toHaveText('км')
  await expectNoHorizontalOverflow(page)
  await page.getByRole('button', { name: 'Изменить порядок' }).click()
  await page.getByRole('button', { name: /Переместить блок «Жим лёжа.*вверх/ }).click()
  await expect(page.locator('.today-exercise-title strong').first()).toContainText('Жим лёжа')
  await expect(page.getByRole('button', { name: 'Далее' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Готово' }).click()
  await expect(page.getByRole('button', { name: 'Далее' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('running-review.png'), fullPage: true })
})

test('iPhone: тренер назначает интервалы, спортсмен подтверждает работу и восстановление', async ({ browser }, testInfo) => {
  testInfo.setTimeout(180_000)
  const suffix = `${testInfo.workerIndex}-${Date.now()}`
  const trainerContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const clientContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const trainer = await trainerContext.newPage()
  const client = await clientContext.newPage()

  async function register(page: Page, name: string, email: string, role?: 'client') {
    await page.goto('/auth')
    await page.getByRole('button', { name: 'Создать аккаунт' }).click()
    if (role) await page.getByLabel('Тип аккаунта').selectOption(role)
    await page.getByLabel('Имя').fill(name)
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Пароль').fill('FitLocal123!')
    await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  }

  try {
    await register(trainer, 'Интервальный тренер', `interval-trainer-${suffix}@fit.local`)
    await expect(trainer.getByRole('heading', { name: 'Сегодня' })).toBeVisible()
    await trainer.goto('/clients')
    await trainer.getByRole('link', { name: 'Добавить' }).click()
    await trainer.getByLabel('Имя').fill('Интервальный спортсмен')
    await trainer.getByLabel('Пол').selectOption('female')
    await trainer.getByLabel('Возраст').fill('30')
    await trainer.getByLabel('Рост, см').fill('170')
    await trainer.getByLabel('Начальный вес, кг').fill('60')
    await Promise.all([
      trainer.waitForURL(/\/clients\/[0-9a-f-]+$/),
      trainer.getByRole('button', { name: 'Сохранить' }).click(),
    ])
    const clientId = trainer.url().match(/\/clients\/([0-9a-f-]+)$/)?.[1]
    expect(clientId).toBeTruthy()
    await trainer.getByRole('button', { name: 'Пригласить клиента' }).click()
    const codeText = await trainer.getByText(/Код клиента:/).textContent()
    const code = codeText?.match(/[A-F0-9]{12}/)?.[0]
    expect(code).toBeTruthy()

    await register(client, 'Интервальный спортсмен', `interval-client-${suffix}@fit.local`, 'client')
    await expect(client.getByRole('heading', { name: 'Тренируйтесь и следите за прогрессом' })).toBeVisible()
    await client.goto('/join')
    await client.getByLabel('Код приглашения').fill(code!)
    await client.getByRole('button', { name: 'Присоединиться' }).click()
    await expect(client.getByRole('heading', { name: 'Тренер подключён' })).toBeVisible()
    await client.getByRole('button', { name: 'Открыть кабинет' }).click()
    await expect(client).toHaveURL(/\/me$/)

    await trainer.goto(`/workouts/new?client=${clientId}`)
    await trainer.getByRole('button', { name: 'Выбрать упражнения' }).click()
    await expect(trainer.getByRole('heading', { name: 'Тип тренировки' })).toBeVisible()
    await expect(trainer.getByRole('button', { name: /^Силовая/ })).toBeVisible()
    await expectNoHorizontalOverflow(trainer)
    await trainer.screenshot({ path: testInfo.outputPath('workout-kind-trainer-390.png'), fullPage: true })
    await trainer.setViewportSize({ width: 430, height: 932 })
    await expectNoHorizontalOverflow(trainer)
    await trainer.screenshot({ path: testInfo.outputPath('workout-kind-trainer-430.png'), fullPage: true })
    await trainer.setViewportSize({ width: 390, height: 844 })
    await trainer.getByRole('button', { name: /^Бег/ }).click()
    await expect(trainer.getByRole('button', { name: /Свободный бег/ })).toBeVisible()
    await expect(trainer.getByRole('button', { name: /Лёгкий бег/ })).toBeVisible()
    await expect(trainer.getByRole('button', { name: /Длительный бег/ })).toBeVisible()
    await expect(trainer.getByRole('button', { name: /Темповый бег/ })).toBeVisible()
    await expect(trainer.getByRole('button', { name: /Восстановительный бег/ })).toBeVisible()
    await expect(trainer.getByRole('button', { name: /^Интервалы/ })).toBeVisible()
    await expect(trainer.getByRole('button', { name: /Семенящий бег/ })).toBeVisible()
    await expectNoHorizontalOverflow(trainer)
    await trainer.screenshot({ path: testInfo.outputPath('running-formats-390.png'), fullPage: true })
    await trainer.getByRole('button', { name: /^Интервалы/ }).click()
    await expect(trainer.locator('[data-running-format="interval-passive"]')).toBeVisible()
    await expect(trainer.getByRole('button', { name: /Своя схема/ })).toBeVisible()
    await trainer.locator('[data-running-format="interval-active"]').click()
    await expect(trainer.getByLabel('Тип блока')).toHaveValue('interval')
    await expect(trainer.locator('.planned-round')).toHaveCount(6)
    await expect(trainer.getByLabel('Расстояние, подход 1').first()).toHaveValue('400')
    await expect(trainer.getByLabel('Единица расстояния, подход 1').first()).toHaveValue('m')
    await expectNoHorizontalOverflow(trainer)
    await trainer.screenshot({ path: testInfo.outputPath('running-interval-plan.png'), fullPage: true })

    await Promise.all([
      trainer.waitForURL(/\/workouts\/[0-9a-f-]+$/),
      trainer.getByRole('button', { name: 'Сохранить' }).click(),
    ])
    const workoutUrl = trainer.url()
    await expect(trainer.locator('.block-badge')).toContainText('Интервалы · 6 кр.')

    await client.goto(workoutUrl)
    await expect(client.locator('.block-badge')).toContainText('Интервалы · 6 кр.')
    await client.getByRole('button', { name: 'Начать тренировку' }).click()
    await expect(client.locator('.live-pinned .circuit-counter')).toHaveText('Круг 1 из 6')
    await expectNoHorizontalOverflow(client)
    await client.screenshot({ path: testInfo.outputPath('running-interval-live.png'), fullPage: true })

    for (let round = 1; round <= 6; round += 1) {
      await expect(client.locator('.live-pinned .circuit-counter')).toHaveText(`Круг ${round} из 6`)
      for (let segment = 0; segment < 2; segment += 1) {
        const nextConfirm = client.locator('.circuit-round.current button.live-set-check:not(:disabled)').first()
        await expect(nextConfirm).toBeVisible()
        await nextConfirm.click()
        await expect(client.getByText(/^Отдых/)).toHaveCount(0)
        if (segment === 0) {
          await expect(client.locator('.circuit-round.current button.live-set-check:not(:disabled)')).toHaveCount(1)
        } else if (round < 6) {
          await expect(client.locator('.live-pinned .circuit-counter')).toHaveText(`Круг ${round + 1} из 6`, { timeout: 10_000 })
        } else {
          await expect(client.getByText('Готово 12 из 12', { exact: true })).toBeVisible({ timeout: 10_000 })
        }
      }
    }
    await expect(client.getByRole('button', { name: 'Готово', exact: true })).toHaveCount(0)
    await client.getByRole('button', { name: 'Завершить тренировку' }).click()
    await expect(client).toHaveURL(workoutUrl)
    await expect(client.getByText('Готово', { exact: true }).first()).toBeVisible()

    await trainer.goto(workoutUrl)
    await expect(trainer.getByText('Готово', { exact: true }).first()).toBeVisible()
    await expect(trainer.locator('.block-badge')).toContainText('Интервалы · 6 кр.')
  } finally {
    await trainerContext.close()
    await clientContext.close()
  }
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

test('iPhone: меню собственного плана клиента находится в шапке на 390 и 430 px', async ({ page }, testInfo) => {
  testInfo.setTimeout(60_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Тип аккаунта').selectOption('client')
  await page.getByLabel('Имя').fill('Клиент с планом')
  await page.getByLabel('Email').fill(`client-plan-menu-${testInfo.workerIndex}-${Date.now()}@fit.local`)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page).toHaveURL(/\/me$/)

  await page.getByRole('button', { name: 'Ввести текстом' }).click()
  await expect(page.getByText('Новая тренировка', { exact: true })).toBeVisible()

  await page.goto('/workouts/new')
  await addExercise(page, 'Присед со штангой', true)
  await page.getByLabel('Вес, подход 1').fill('40')
  await page.getByLabel('Повторы, подход 1').fill('10')
  await page.getByRole('button', { name: 'Сохранить план', exact: true }).click()

  const headerMenu = page.locator('.workout-header-side').getByRole('button', { name: 'Другие действия с тренировкой' })
  await expect(headerMenu).toBeVisible()
  await expect(page.locator('.workout-detail-actions').getByRole('button', { name: 'Другие действия с тренировкой' })).toHaveCount(0)
  await expect(page.locator('.workout-detail-actions').getByRole('link', { name: 'Изменить', exact: true })).toBeVisible()
  await headerMenu.click()
  await expect(page.getByRole('menuitem', { name: 'Копировать тренировку' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Удалить тренировку' })).toHaveClass(/danger/)
  await expectOverflowMenuAboveBars(page)
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('client-plan-header-menu-390.png'), fullPage: true })

  await headerMenu.click()
  await page.setViewportSize({ width: 430, height: 932 })
  await expect(headerMenu).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('client-plan-header-menu-430.png'), fullPage: true })
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

  await page.getByRole('button', { name: 'Ввести текстом' }).click()
  await expect(page.getByText('Новая тренировка', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Скрыть' }).click()
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
  await page.goto('/me/profile')
  await expect(page).toHaveURL(/\/me\/profile$/)
  await page.getByRole('link', { name: 'Изменить данные' }).click()
  await page.getByLabel('Имя').fill('Клиент Обновлённый')
  await page.getByLabel('Пол').selectOption('female')
  await page.getByLabel('Возраст').fill('30')
  await page.getByLabel('Рост, см').fill('170')
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
  await page.getByRole('button', { name: 'Ввести текстом' }).click()
  await expect(page.getByText('Новая тренировка', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Скрыть' }).click()

  await page.goto('/me/workouts')
  await page.getByRole('link', { name: 'Добавить' }).click()
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await expect(page.getByRole('heading', { name: 'Тип тренировки' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Силовая/ })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('workout-kind-client-390.png'), fullPage: true })
  await page.getByRole('button', { name: /^Бег/ }).click()
  await page.getByLabel('Поиск упражнения').fill('Бег')
  await page.locator('[data-exercise-ref="running"]').click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Начать тренировку' }).click()

  await expect(page.locator('.phone-frame')).not.toHaveClass(/live-identity/)

  await expect(page.getByRole('button', { name: '＋ Подход' })).toBeInViewport()
  await expect(page.getByRole('button', { name: '＋ Ещё упражнение' })).toBeInViewport()
  await expect(page.locator('.live-session-progress')).toContainText('Упражнение 1 из 1 · подход 1 из 1')
  await expect(page.locator('.live-session-progress')).toContainText('Готово 0 из 1')
  await expect(page.getByRole('progressbar', { name: 'Выполненные подходы' })).toHaveAttribute('aria-valuenow', '0')
  const liveControls = page.locator('.live-set-input, .live-set-check')
  for (let index = 0; index < await liveControls.count(); index += 1) {
    const box = await liveControls.nth(index).boundingBox()
    expect(box).not.toBeNull()
    expect(box!.height).toBeGreaterThanOrEqual(44)
  }
  const liveInput = page.getByLabel('Фактическое время')
  await liveInput.evaluate((element) => { element.setAttribute('data-mount-check', 'stable') })
  await liveInput.fill('12:30')
  const scrollBeforeBlur = await page.locator('.content').evaluate((element) => element.scrollTop)
  await page.locator('.live-timer').click()
  await expect(liveInput).toHaveValue('12:30')
  await expect(liveInput).toHaveAttribute('data-mount-check', 'stable')
  const scrollAfterInput = await page.locator('.content').evaluate((element) => element.scrollTop)
  expect(Math.abs(scrollAfterInput - scrollBeforeBlur)).toBeLessThan(24)
  await page.locator('.phone-frame').evaluate((element) => element.classList.add('keyboard-open'))
  await expect(page.locator('.live-bottom-bar')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Готово, отдых' }).first()).toBeInViewport()
  await page.locator('.phone-frame').evaluate((element) => element.classList.remove('keyboard-open'))
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
  await page.getByRole('button', { name: /^Силовая/ }).click()
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
  await page.goto(`/progress/${clientId}?view=measurements`)
  await page.getByRole('button', { name: 'Настроить показатели' }).click()
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
  await page.getByRole('button', { name: /История ·/ }).click()

  const trainerEntry = page.locator('.client-progress-history article.card').first()
  await expect(trainerEntry).toContainText('27 июля 2026 г.')
  await trainerEntry.getByRole('button', { name: 'Изменить' }).click()
  await trainerEntry.getByLabel('Вес, кг').fill('65.7')
  await trainerEntry.getByRole('button', { name: 'Сохранить замер' }).click()
  await expect(trainerEntry).toContainText('65,7 кг')

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

test('iPhone: client progress keeps one goal-aware LLM summary and compact running facts', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page, 'client@fit.local')
  await page.route('**/rest/v1/rpc/list_running_progress', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        {
          workout_id: '71111111-1111-4111-8111-111111111111',
          workout_date: '2026-08-03',
          running_format: 'easy',
          distance_km: 5,
          duration_sec: 1800,
          pace_sec_per_km: 360,
          rpe: 6,
        },
        {
          workout_id: '72222222-2222-4222-8222-222222222222',
          workout_date: '2026-08-10',
          running_format: 'easy',
          distance_km: 5,
          duration_sec: 1650,
          pace_sec_per_km: 330,
          rpe: 7,
        },
      ]),
    })
  })
  await page.goto('/me/progress')

  await expect(page.getByRole('heading', { name: 'Мой прогресс' })).toBeVisible()
  await expect(page.getByLabel('Регулярность тренировок')).toHaveCount(0)
  await expect(page.getByText('Твой прогресс', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '1 месяц' })).toHaveClass(/active/)
  await expect(page.getByRole('button', { name: '3 месяца' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '6 месяцев' })).toHaveCount(0)
  await expect(page.locator('.client-progress-card .body-progress-map')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Прогресс', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Нагрузка', exact: true })).toBeVisible()
  await expect(page.getByText('Для твоей цели', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'На следующей тренировке' })).toHaveCount(0)
  await expect(page.getByText('Прогресс уже заметен, ты на верном пути.')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Обновить' })).toBeVisible()
  const runningProgress = page.getByLabel('Беговой прогресс')
  await expect(runningProgress).toContainText('2 пробежки')
  await expect(runningProgress).toContainText('10 км · 58 мин')
  await expect(runningProgress).toContainText('5:45')
  await expect(runningProgress).toContainText('6,5')
  await expect(runningProgress).toContainText('быстрее на 8%')
  await expect(runningProgress).toContainText('Последняя нагрузка: RPE 7')

  await page.getByText('ЗАМЕРЫ И ПОКАЗАТЕЛИ', { exact: true }).scrollIntoViewIfNeeded()
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
  if (first) await page.getByRole('button', { name: /^Силовая/ }).click()
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

async function openReviewWithFixture(page: import('@playwright/test').Page, pathname = '/today') {
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
  await page.goto(pathname)
  await page.getByRole('button', { name: 'Ввести текстом' }).click()
  await page.getByLabel('Тренировка').fill('Жим лёжа (Штанга) 3×8 — 80 кг')
  await page.getByRole('button', { name: 'Разобрать тренировку' }).click()
  await expect(page.getByRole('heading', { name: 'Проверьте тренировку' })).toBeVisible()
}

for (const viewport of [{ width: 390, height: 844 }, { width: 430, height: 932 }]) {
  test(`iPhone: проверка тренировки клиента восстанавливает полную высоту после клавиатуры на ${viewport.width} px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await login(page, 'client@fit.local')
    await openReviewWithFixture(page, '/me')

    const frame = page.locator('.phone-frame')
    const content = page.locator('.content')
    const firstWeight = page.getByLabel('Жим лёжа (Штанга): вес, подход 1')
    await recoverMobileShellFromStaleKeyboard(page, firstWeight)

    const frameBox = await frame.boundingBox()
    expect(frameBox).not.toBeNull()
    expect(frameBox!.y).toBe(0)
    expect(frameBox!.height).toBe(viewport.height)
    await page.getByRole('button', { name: 'Далее' }).scrollIntoViewIfNeeded()
    await expect(page.getByRole('button', { name: 'Далее' })).toBeInViewport()
    expect(await content.evaluate((element) => element.clientHeight > 0 && element.scrollHeight >= element.clientHeight)).toBe(true)
    await expectNoHorizontalOverflow(page)
  })
}

test('iPhone: форма тренера также восстанавливает оболочку после клавиатуры', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await loginAsTrainer(page)
  await page.goto('/clients/new')
  await recoverMobileShellFromStaleKeyboard(page, page.getByLabel('Имя'))
  await page.getByRole('button', { name: 'Сохранить' }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: 'Сохранить' })).toBeInViewport()
  await expectNoHorizontalOverflow(page)
})

for (const viewport of mobileViewports) {
  test(`iPhone: основной сценарий не выходит за ширину ${viewport.width} px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await loginAsTrainer(page)

    for (const screen of ['/today', '/clients', '/clients/11111111-1111-4111-8111-111111111111', '/schedule']) {
      await page.goto(screen)
      await expect(page.locator('main')).toBeVisible()
      if (screen === '/today') {
        await expect(page.getByRole('button', { name: 'Надиктовать тренировку' })).toBeVisible()
        await expect(page.getByRole('textbox', { name: 'Тренировка' })).toHaveCount(0)
      }
      if (screen.includes('11111111')) {
        await expect(page.getByRole('heading', { name: 'Анна Смирнова' })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Действия с профилем спортсмена' })).toBeVisible()
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
  await expect(page.locator('.voice-action')).toHaveScreenshot('today-voice-dark-390.png', { animations: 'disabled', maxDiffPixelRatio: 0.03 })

  await page.goto('/progress/11111111-1111-4111-8111-111111111111')
  const aiCard = page.locator('.ai-progress-card')
  await expect(aiCard).toBeVisible()
  expect(await aiCard.evaluate((element) => getComputedStyle(element).borderTopColor)).toBe('rgb(66, 107, 88)')
  await expectNoHorizontalOverflow(page)
})

for (const viewport of [{ width: 390, height: 844 }, { width: 430, height: 932 }]) {
  test(`iPhone: Progress тренера остаётся компактным на ${viewport.width} px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await loginAsTrainer(page)
    await page.clock.install({ time: new Date('2026-08-16T18:00:00+03:00') })
    await page.goto(`/progress/${demoClientId}`)

    await expect(page.getByRole('heading', { level: 1, name: 'Прогресс', exact: true })).toBeVisible()
    await expect(page.getByText('Анна Смирнова', { exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Тренировки за неделю' })).toBeVisible()
    const analysis = page.getByLabel('ИИ-анализ тренировок')
    await expect(analysis).toBeVisible()
    await expect(analysis.locator('.body-progress-map')).toBeVisible()
    await expect(analysis.getByRole('button', { name: 'Прогресс', exact: true })).toBeVisible()
    await analysis.getByRole('button', { name: 'Нагрузка', exact: true }).click()
    await expect(analysis.getByRole('heading', { name: 'Куда пришлась нагрузка' })).toBeVisible()
    await expect(page.locator('details')).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Открыть замеры и показатели' })).toBeVisible()
    const coachmark = page.getByRole('button', { name: 'Понятно' })
    if (await coachmark.isVisible()) await coachmark.click()
    await expectNoHorizontalOverflow(page)
  })
}

test('iPhone: client Progress keeps one compact result summary at 390 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page, 'client@fit.local')
  await page.goto('/me/progress')

  await expect(page.getByLabel('Регулярность тренировок')).toHaveCount(0)
  const summary = page.locator('.client-progress-card')
  await expect(summary).toBeVisible()
  await expect(summary.locator('.body-progress-map')).toBeVisible()
  await summary.getByRole('button', { name: 'Прогресс', exact: true }).click()
  await expect(summary.getByRole('heading', { name: 'Где выросли результаты' })).toBeVisible()
  await summary.getByRole('button', { name: 'Нагрузка', exact: true }).click()
  await expect(summary.getByRole('heading', { name: 'Куда пришлась нагрузка' })).toBeVisible()
  await expect(summary.locator('.ai-progress-stats span').filter({ hasText: /недел/ })).toBeVisible()
  await expect(summary.getByText('Для твоей цели', { exact: true })).toBeVisible()
  await expect(summary.getByText('Подробный анализ', { exact: true })).toBeVisible()
  await page.goto('/me/profile')
  await page.getByRole('radio', { name: 'Схема' }).click()
  await page.goto('/me/progress')
  const schemeSummary = page.locator('.client-progress-card')
  await expect(schemeSummary.getByRole('group', { name: 'Анатомическая схема мышц, вид спереди' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

for (const viewport of [{ width: 390, height: 844 }, { width: 430, height: 932 }]) {
  test(`iPhone: короткая история и длинное упражнение не ломают Progress на ${viewport.width} px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await login(page, 'client@fit.local')
    await page.clock.install({ time: new Date('2026-08-20T18:00:00+03:00') })
    await page.route('**/rest/v1/workouts?*', async (route) => {
      const url = new URL(route.request().url())
      if (url.searchParams.get('select') === 'workout_date') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ workout_date: '2026-08-10' }),
        })
        return
      }
      await route.fallback()
    })
    await page.route('**/rest/v1/client_published_training_summaries?*', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify([{
          id: '96000000-0000-4000-8000-000000000001',
          source_summary_id: '96000000-0000-4000-8000-000000000002',
          client_id: demoClientId,
          period_start: '2026-07-21',
          period_end: '2026-08-20',
          summary: {
            headline: 'Рабочий вес вырос на 16,67%.',
            achievements: ['Рост подтверждён завершёнными тренировками.'],
            consistency: 'За период выполнено 6 тренировок, в среднем 1,13 в неделю.',
            encouragement: 'Продолжай в том же ритме.',
          },
          display_metrics: {
            completed_workouts: 6,
            workouts_per_week: 1.13,
            active_weeks: 3,
            longest_gap_days: 5,
            progress_facts: [{
              exercise_name: 'Тяга верхнего блока обратным узким хватом в кроссовере с дополнительной рукоятью',
              kind: 'strength',
              session_count: 3,
              changes: [{ metric: 'max_weight', from: 50, to: 68, change_percent: 36, favorable: true }],
            }, {
              exercise_name: 'Жим гантелей лёжа',
              kind: 'strength',
              session_count: 3,
              changes: [{ metric: 'volume', from: 2100, to: 2520, change_percent: 20, favorable: true }],
            }],
          },
          generated_at: '2026-08-20T08:00:00Z',
          published_at: '2026-08-20T08:05:00Z',
        }]),
      })
    })

    await page.goto('/me/profile')
    await page.getByRole('radio', { name: 'Схема' }).click()
    await page.goto('/me/progress')
    const summary = page.locator('.client-progress-card')
    await summary.getByRole('button', { name: 'Спереди' }).click()
    await expect(summary.getByRole('group', { name: 'Анатомическая схема мышц, вид спереди' })).toBeVisible()
    await summary.getByLabel('Грудь. Лучший результат зоны: +20%').click()
    await summary.getByRole('button', { name: 'Сзади' }).click()
    await expect(summary.getByRole('group', { name: 'Анатомическая схема мышц, вид сзади' })).toBeVisible()
    await summary.getByLabel('Верх спины. Лучший результат зоны: +36%').press('Enter')
    await expect(summary.locator('.body-progress-detail').getByText('Тяга верхнего блока обратным узким хватом в кроссовере с дополнительной рукоятью', { exact: false })).toBeVisible()
    await summary.getByRole('button', { name: 'Подробный анализ' }).click()
    await expect(page.getByRole('dialog', { name: 'Подробный анализ' }).getByText('Рабочий вес: 50 → 68 кг', { exact: false })).toBeVisible()
    await expect(summary.getByRole('button', { name: '1 месяц' })).toBeVisible()
    await expect(summary.getByRole('button', { name: '3 месяца' })).toHaveCount(0)
    await expectNoHorizontalOverflow(page)
  })
}

test('iPhone: ручной выбор начинает с недавних, а не с разминки на 390 px', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('**/exercises/base-bench-press.jpg', (route) => route.abort())
  await loginAsTrainer(page)
  await page.evaluate(() => window.localStorage.setItem('fit.recent-exercises', JSON.stringify(['bench-press'])))
  await page.goto('/workouts/new')
  await selectClient(page)
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByRole('button', { name: /^Силовая/ }).click()

  await expect(page.getByText('Недавние')).toBeVisible()
  await expect(page.getByText('Все упражнения')).toBeVisible()
  await expect(page.getByText('Разминка и мобилити')).toHaveCount(0)
  const recentExercise = page.locator('.picker-item[data-exercise-ref="bench-press"]')
  await expect(recentExercise).toHaveCount(1)
  await expect(recentExercise.locator('.exercise-image-empty')).toBeVisible()
  await expect(recentExercise.locator('img')).toHaveCount(0)
  const catalogImage = page.locator('.picker-item[data-exercise-ref="barbell-squat"] .exercise-image')
  await expect(catalogImage.locator('img')).toHaveCSS('object-fit', 'contain')
  const catalogImageBox = await catalogImage.boundingBox()
  expect(catalogImageBox?.width).toBe(catalogImageBox?.height)
  expect(catalogImageBox?.width).toBeGreaterThanOrEqual(48)
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('exercise-images-picker.png'), fullPage: true })
})

test('iPhone: создание тренировки сфокусировано и меню не перекрывает действия на 390 px', async ({ page }) => {
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
  const save = page.getByRole('button', { name: 'Сохранить план', exact: true })
  await save.scrollIntoViewIfNeeded()
  await expect(save).toHaveAttribute('data-variant', 'primary')
  await expect(page.getByRole('button', { name: 'Отмена', exact: true })).toHaveCount(0)
  const setTableHeading = page.locator('.workout-set-table-head').first()
  await expect(setTableHeading).toHaveCSS('font-size', '12px')
  expect(await setTableHeading.evaluate((element) => {
    const style = window.getComputedStyle(element)
    const probe = document.createElement('span')
    probe.style.color = style.getPropertyValue('--secondary-label-fg')
    document.body.append(probe)
    const matches = window.getComputedStyle(probe).color === style.color
    probe.remove()
    return matches
  })).toBe(true)
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toHaveCount(0)
  const viewportHeight = await page.evaluate(() => window.visualViewport?.height ?? window.innerHeight)
  const saveBox = await save.boundingBox()
  expect(saveBox).not.toBeNull()
  expect(saveBox!.y + saveBox!.height).toBeLessThanOrEqual(viewportHeight)
  await expectNoHorizontalOverflow(page)
})

test('iPhone: планирование из карточки спортсмена сохраняет контекст и компактную иерархию', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await loginAsTrainer(page)
  await page.goto(`/workouts/new?client=${demoClientId}`)

  await expect(page.locator('.workout-header-meta')).toContainText('Анна Смирнова')
  await expect(page.getByLabel('Клиент')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'План', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const workoutDate = page.locator('input[name="date"]')
  await workoutDate.fill('2026-09-15')
  await page.screenshot({ path: testInfo.outputPath('workout-planning-top-390.png') })
  await page.getByRole('button', { name: 'Завершённая', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Завершённая', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(workoutDate).toHaveValue('2026-09-15')
  await expect(workoutDate).not.toHaveAttribute('max')
  await page.getByRole('button', { name: 'План', exact: true }).click()
  await expect(page.getByLabel('Окончание')).toHaveCount(0)
  await page.getByRole('button', { name: 'Добавить время окончания' }).click()
  await expect(page.getByLabel('Окончание')).toBeVisible()
  await page.getByRole('button', { name: 'Убрать окончание' }).click()

  await addExercise(page, 'Присед со штангой', true)
  await expect(page.getByRole('button', { name: 'Добавить голосом или текстом' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Выбрать упражнения' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '＋ Упражнение' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Упражнения', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Сохранить план', exact: true })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('workout-planning-client-390.png'), fullPage: true })

  await page.setViewportSize({ width: 430, height: 932 })
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('workout-planning-client-430.png'), fullPage: true })
})

test('iPhone: копия тренировки открывается компактно и не спорит с клавиатурой', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const clientName = await createIsolatedClient(page, testInfo)
  await page.goto('/workouts/new')
  await selectClient(page, clientName)
  await addExercise(page, 'Присед со штангой', true)
  await page.getByLabel('Вес, подход 1').fill('60')
  await page.getByLabel('Повторы, подход 1').fill('10')
  await page.getByRole('button', { name: '＋ Подход' }).click()
  await page.getByLabel('Вес, подход 2').fill('60')
  await page.getByLabel('Повторы, подход 2').fill('10')
  await addExercise(page, 'Жим лёжа')
  const benchEditor = page.locator('.planned-exercise').filter({ hasText: 'Жим лёжа' })
  await expect(benchEditor).toHaveCount(1)
  await benchEditor.getByLabel('Вес, подход 1').fill('40')
  await benchEditor.getByLabel('Повторы, подход 1').fill('10')
  await expect(benchEditor.getByLabel('Вес, подход 1')).toHaveValue('40')
  await addExercise(page, 'Планка')
  await expect(benchEditor.getByLabel('Вес, подход 1')).toHaveValue('40')
  await page.getByLabel('Время, сек, подход 1').fill('45')
  await page.getByRole('button', { name: 'Сохранить план', exact: true }).click()
  await expect(page.locator('.planned-set-summary').nth(1)).toContainText('40 кг × 10')
  await expect(page.locator('.planned-set-summary').nth(2)).toContainText('45 сек')
  await page.getByRole('button', { name: 'Другие действия с тренировкой' }).click()
  await page.getByRole('menuitem', { name: 'Копировать тренировку' }).click()

  await expect(page.getByRole('heading', { name: 'Новая тренировка' })).toBeVisible()
  await expect(page.getByText(/Скопировано ·/)).toBeVisible()
  await expect(page.getByLabel('Клиент')).toHaveCount(0)
  const copiedExercises = page.locator('.planned-exercise')
  await expect(copiedExercises).toHaveCount(3)
  const toggles = copiedExercises.locator('.compact-editor-exercise-toggle')
  await expect(toggles).toHaveCount(3)
  for (let index = 0; index < 3; index += 1) await expect(toggles.nth(index)).toHaveAttribute('aria-expanded', 'false')
  await expect(copiedExercises.nth(0)).toContainText('2 × 60 кг × 10')
  await expect(copiedExercises.nth(1)).toContainText('40 кг × 10')
  await expect(copiedExercises.nth(2)).toContainText('45 сек')
  await expect(page.getByText('Дополнительно', { exact: true })).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('copied-workout-compact-390.png'), fullPage: true })

  await toggles.nth(0).click()
  await expect(copiedExercises.nth(0).getByLabel('Вес, подход 1')).toBeVisible()
  await copiedExercises.nth(0).getByRole('button', { name: 'Ещё действия' }).click()
  await page.getByRole('menuitem', { name: 'Настройки упражнения' }).click()
  await expect(page.getByRole('dialog', { name: /Настройки упражнения/ })).toBeVisible()
  await page.getByRole('button', { name: 'Готово' }).click()
  await page.locator('.phone-frame').evaluate((element) => element.classList.add('keyboard-open'))
  await expect(page.locator('.workout-action-row')).toBeHidden()
  await expectNoHorizontalOverflow(page)
})

test('iPhone: бег с RPE не сжимает время и дистанцию в одну тесную строку', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await loginAsTrainer(page)
  await page.goto(`/workouts/new?client=${demoClientId}`)
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByRole('button', { name: /^Бег/ }).click()
  await page.locator('[data-running-format="free"]').click()
  await page.getByRole('button', { name: 'Ещё действия' }).click()
  await page.getByRole('menuitem', { name: 'Указать RPE' }).click()

  const runningSet = page.locator('.planned-set-running.rpe-visible')
  await expect(runningSet).toBeVisible()
  const runningSetBox = await runningSet.boundingBox()
  expect(runningSetBox).not.toBeNull()
  expect(runningSetBox!.height).toBeGreaterThanOrEqual(100)
  await expect(page.getByLabel('Время, подход 1')).toBeVisible()
  await expect(page.getByLabel('Расстояние, подход 1')).toBeVisible()
  await expect(page.getByLabel('Целевой RPE, подход 1')).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('workout-planning-running-rpe-390.png'), fullPage: true })
})

test('iPhone: пустую тренировку нельзя сохранить на 390 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await loginAsTrainer(page)
  await page.goto('/workouts/new')

  await expect(page.getByText('Добавьте хотя бы одно упражнение — голосом, текстом или из каталога.')).toBeVisible()
  const disabledSave = page.getByRole('button', { name: 'Сохранить план', exact: true })
  await expect(disabledSave).toBeDisabled()
  expect(await disabledSave.evaluate((button) => {
    const style = getComputedStyle(button)
    return { background: style.backgroundColor, color: style.color, opacity: style.opacity }
  })).toEqual({ background: 'rgb(229, 226, 220)', color: 'rgb(116, 115, 111)', opacity: '1' })
  await expect(page.getByRole('button', { name: 'Выбрать упражнения' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('iPhone: длинное название и 10 подходов не ломают форму и Live на 390 px', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const clientName = await createIsolatedClient(page, testInfo)
  await page.goto('/workouts/new')
  await selectClient(page, clientName)
  const longName = 'Фронтальный присед тяжелоатлетическим хватом'
  await addExercise(page, longName, true)

  const exercise = page.locator('.planned-exercise').first()
  await expect(exercise).toContainText(longName)
  for (let index = 1; index < 10; index += 1) await exercise.getByRole('button', { name: '＋ Подход' }).click()
  await expect(exercise.locator('.planned-set')).toHaveCount(10)
  await exercise.getByLabel('Вес, подход 10').fill('40')
  await exercise.getByLabel('Повторы, подход 10').fill('10')
  await expectNoHorizontalOverflow(page)

  await page.getByRole('button', { name: 'Сохранить план', exact: true }).click()
  await expect(page.locator('.planned-set-summary')).toContainText('Значения заполнены частично')
  await expect(page.locator('.planned-exercise-details')).not.toHaveAttribute('open')
  await expectNoHorizontalOverflow(page)
  await page.getByRole('button', { name: 'Начать тренировку' }).click()
  await expect(page.locator('.live-session-progress')).toContainText('подход 1 из 10')
  await expect(page.locator('.live-exercise.current')).toContainText(longName)
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
  await page.locator('.planned-exercise').getByRole('button', { name: 'Ещё действия' }).click()
  await page.getByRole('menuitem', { name: 'Настройки упражнения' }).click()
  await page.getByLabel('Отдых между подходами, с').fill('90')
  await page.getByRole('button', { name: 'Готово' }).click()
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await page.getByRole('button', { name: 'Начать' }).click()
  await page.getByRole('button', { name: 'Готово, отдых' }).first().click()
  await expect(page.getByText(/Отдых 1:(2[7-9]|30)/)).toBeVisible()
  const restControls = page.locator('.rest-controls button')
  for (let index = 0; index < await restControls.count(); index += 1) {
    const box = await restControls.nth(index).boundingBox()
    expect(box).not.toBeNull()
    expect(box!.height).toBeGreaterThanOrEqual(44)
  }
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
  await page.getByRole('button', { name: 'Готово, отдых' }).click()
  await expect(page.locator('.live-exercise-collapsed')).toContainText('55 кг × 10 повт.')
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

test('iPhone: частично завершённая тренировка помечена на 390 и 430 px', async ({ page }, testInfo) => {
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
  const plannedDetails = page.locator('.planned-exercise-details').first()
  await expect(plannedDetails.locator('.planned-set-summary')).toHaveText(/2 × 40 кг × 10/)
  await expect(plannedDetails).not.toHaveAttribute('open')
  await expect(plannedDetails.locator('.workout-history-sets')).not.toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.getByRole('button', { name: 'Начать' }).click()
  await page.getByRole('button', { name: 'Готово, отдых' }).first().click()
  const finishWorkout = page.getByRole('button', { name: 'Завершить тренировку' })
  await expect(finishWorkout).toHaveAttribute('data-variant', 'secondary')
  await finishWorkout.click()
  await expect(page.getByRole('button', { name: 'Отмена', exact: true })).toHaveAttribute('data-variant', 'tertiary')
  const confirmFinish = page.getByRole('button', { name: 'Завершить', exact: true })
  await expect(confirmFinish).toHaveAttribute('data-variant', 'primary')
  await confirmFinish.click()
  await expect(page.getByRole('heading', { name: 'Тренировка завершена' })).toBeVisible()
  await expect(page.locator('.workout-detail-page .badge.partial')).toHaveText('Частично')
  await expect(page.locator('.completed-set-summary')).toContainText('—')
  const completedDetails = page.locator('.completed-exercise-details').first()
  await expect(completedDetails).not.toHaveAttribute('open')
  await completedDetails.locator('summary').click()
  await expect(completedDetails.locator('.workout-history-sets')).toBeVisible()
  await page.getByRole('button', { name: 'Другие действия с тренировкой' }).click()
  await expect(page.getByRole('menuitem', { name: 'Копировать тренировку' })).toBeVisible()
  const deleteWorkout = page.getByRole('menuitem', { name: 'Удалить тренировку' })
  await expect(deleteWorkout).toHaveClass(/danger/)
  await page.screenshot({ path: testInfo.outputPath('workout-detail-overflow-390.png'), fullPage: true })
  await page.setViewportSize({ width: 430, height: 932 })
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('workout-detail-overflow-430.png'), fullPage: true })
  await deleteWorkout.click()
  const deleteConfirmation = page.getByRole('alertdialog', { name: 'Удалить тренировку?' })
  await expect(deleteConfirmation).toBeVisible()
  await deleteConfirmation.getByRole('button', { name: 'Отмена' }).click()
  await expect(deleteConfirmation).toHaveCount(0)
  await expect(completedDetails).toContainText('не выполнено')
  await expectNoHorizontalOverflow(page)
})

test('iPhone: прошлый план предлагает нейтральный выбор и сохраняет решение', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const clientName = await createIsolatedClient(page, testInfo)
  await page.goto('/workouts/new')
  await selectClient(page, clientName)
  await page.getByLabel('Дата').fill('2026-08-01')
  await addExercise(page, 'Присед со штангой', true)
  await page.getByLabel('Вес, подход 1').fill('40')
  await page.getByLabel('Повторы, подход 1').fill('10')
  await page.getByRole('button', { name: 'Сохранить' }).click()

  await expect(page.locator('.workout-detail-page .workout-status-decision')).toHaveText('План')
  await expect(page.getByRole('button', { name: 'Начать тренировку' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Выбрать действие' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  const coachmark = page.getByRole('status').filter({ hasText: 'План можно закрыть спокойно' })
  if (await coachmark.isVisible()) await coachmark.getByRole('button', { name: 'Понятно' }).click()
  await page.getByRole('button', { name: 'Выбрать действие' }).click()
  const actions = page.getByRole('dialog', { name: 'Действия с планом' })
  await expect(actions.getByRole('button', { name: 'Записать результат' })).toBeVisible()
  await expect(actions.getByRole('button', { name: 'Перенести тренировку' })).toBeVisible()
  await expect(actions.getByRole('button', { name: 'Тренировка не состоялась' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('past-workout-actions-390.png'), fullPage: true })

  await page.setViewportSize({ width: 430, height: 932 })
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('past-workout-actions-430.png'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('past-workout-actions-trainer-1440.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })

  await actions.getByRole('button', { name: 'Тренировка не состоялась' }).click()
  await page.getByRole('alertdialog', { name: /Сохранить как «Не состоялась»/ }).getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.locator('.workout-detail-page .workout-status-cancelled')).toHaveText('Не состоялась')
  await page.getByRole('button', { name: 'Вернуть в план' }).click()
  const restore = page.getByRole('dialog', { name: 'Вернуть тренировку в план' })
  const futureDate = new Date()
  futureDate.setDate(futureDate.getDate() + 7)
  await restore.getByLabel('Новая дата').fill(futureDate.toISOString().slice(0, 10))
  await restore.getByLabel('Время').fill('09:30')
  await restore.getByRole('button', { name: 'Вернуть в план' }).click()
  await expect(page.locator('.workout-detail-page .workout-status-planned')).toHaveText('План')
})

test('iPhone: результат прошлого плана записывается без запуска Live', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const clientName = await createIsolatedClient(page, testInfo)
  await page.goto('/workouts/new')
  await selectClient(page, clientName)
  await page.getByLabel('Дата').fill('2026-08-01')
  await addExercise(page, 'Присед со штангой', true)
  await page.getByLabel('Вес, подход 1').fill('40')
  await page.getByLabel('Повторы, подход 1').fill('10')
  await page.getByRole('button', { name: 'Сохранить' }).click()

  const coachmark = page.getByRole('status').filter({ hasText: 'План можно закрыть спокойно' })
  if (await coachmark.isVisible()) await coachmark.getByRole('button', { name: 'Понятно' }).click()
  await page.getByRole('button', { name: 'Выбрать действие' }).click()
  await page.getByRole('dialog', { name: 'Действия с планом' }).getByRole('button', { name: 'Записать результат' }).click()

  await expect(page).toHaveURL(/\/workouts\/[0-9a-f-]+\/edit\?result=1$/)
  await expect(page.getByRole('heading', { name: 'Записать результат' })).toBeVisible()
  await expect(page.getByLabel('Вес, подход 1')).toHaveValue('40')
  await expect(page.getByLabel('Повторы, подход 1')).toHaveValue('10')
  await expectNoHorizontalOverflow(page)
  await page.getByRole('button', { name: 'Сохранить результат' }).click()

  await expect(page).toHaveURL(/\/workouts\/[0-9a-f-]+$/)
  await expect(page).not.toHaveURL(/\/live/)
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()
  await expect(page.locator('.workout-detail-page .workout-status-completed')).toHaveText('Готово')
  await expect(page.getByText('40 кг × 10', { exact: true }).first()).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('record-past-plan-result-390.png'), fullPage: true })
})

test('iPhone: разные плановые подходы не выдаются за результат', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const clientName = await createIsolatedClient(page, testInfo)
  await page.goto('/workouts/new')
  await selectClient(page, clientName)
  await addExercise(page, 'Присед со штангой', true)
  await page.getByLabel('Вес, подход 1').fill('40')
  await page.getByLabel('Повторы, подход 1').fill('10')
  await page.getByRole('button', { name: '＋ Подход' }).click()
  await page.getByLabel('Вес, подход 2').fill('45')
  await page.getByLabel('Повторы, подход 2').fill('8')
  await page.getByRole('button', { name: 'Сохранить' }).click()

  const plannedSets = page.locator('.workout-detail-page .workout-history-sets')
  const plannedDetails = page.locator('.planned-exercise-details')
  const plannedExercise = page.locator('.planned-detail-exercise').first()
  const historyAction = plannedExercise.getByRole('link', { name: /История упражнения/ })
  await expect(plannedDetails).not.toHaveAttribute('open')
  await expect(plannedDetails.locator('.planned-set-summary')).toContainText('40 кг × 10 / 45 кг × 8')
  await expect(plannedDetails.locator('summary')).not.toContainText('Подходы')
  await expect(historyAction).toBeVisible()
  expect(await historyAction.evaluate((element) => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })))
    .toEqual({ width: 44, height: 44 })
  expect(await plannedExercise.evaluate((element) => getComputedStyle(element).borderBottomWidth)).toBe('0px')
  await expect(plannedSets).not.toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('planned-variable-sets-390.png'), fullPage: true })
  await plannedDetails.locator('summary').click()
  await expect(plannedSets).toBeVisible()
  await expect(plannedSets.locator('.workout-set-table-head')).toContainText('План')
  await expect(plannedSets.locator('.workout-set-table-head')).not.toContainText('Результат')
  await expect(plannedSets).toContainText('40 кг × 10 повт.')
  await expect(plannedSets).toContainText('45 кг × 8 повт.')
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('planned-variable-sets-expanded-390.png'), fullPage: true })
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
  await page.getByRole('link', { name: 'Прогресс и замеры' }).click()
  await expect(page.getByRole('heading', { name: 'Прогресс' })).toBeVisible()
  await page.locator('.page-back').click()
  await expect(page.getByRole('heading', { name: 'Анна Смирнова' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('iPhone: сет не ставит отдых внутри круга и не оставляет его после финала', async ({ page }, testInfo) => {
  // WebKit in the CI container can need longer to create an isolated Auth user
  // after a retry; this scenario also creates and runs a full grouped workout.
  test.slow()
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
  test.slow()
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
