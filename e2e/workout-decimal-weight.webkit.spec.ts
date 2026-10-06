import { expect, test } from '@playwright/test'

for (const scenario of [
  { name: 'Удержание штанги стоя', metric: 'duration' },
  { name: 'Фермерская прогулка', metric: 'distance' },
]) {
  test(`${scenario.name}: plan and Live retain fractional weight after reopening`, async ({ page }, testInfo) => {
    await page.goto('/auth')
    await page.getByLabel('Email').fill('trainer@fit.local')
    await page.getByLabel('Пароль').fill('FitLocal123!')
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page).toHaveURL(/\/today$/)
    const clientName = `Нагрузка ${Date.now().toString().slice(-6)}`
    await page.goto('/clients/new')
    await page.getByLabel('Имя').fill(clientName)
    await page.getByLabel('Пол').selectOption('female')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByRole('heading', { name: clientName })).toBeVisible()
    await page.getByRole('link', { name: /Запланировать тренировку/ }).click()
    await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
    await page.getByLabel('Поиск упражнения').fill(scenario.name)
    await page.getByRole('button', { name: `Выбрать: ${scenario.name}`, exact: true }).click()
    await page.getByRole('button', { name: 'Добавить 1' }).click()
    await page.getByLabel('Вес, подход 1').fill('22.16')
    if (scenario.metric === 'distance') {
      await page.getByLabel('Расстояние, подход 1').fill('22.16')
      await page.getByLabel('Единица расстояния, подход 1').selectOption('km')
    } else {
      await page.getByLabel('Время, подход 1: секунды').fill('30')
    }
    await page.getByRole('button', { name: /^Сохранить/ }).click()
    await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click()
    const hint = page.locator('.coachmark-bubble').getByRole('button', { name: 'Понятно' })
    if (await hint.isVisible()) await hint.click()
    await expect(page.locator('.live-set-table-head')).toContainText('Кг')
    await expect(page.getByLabel('Фактический вес').first()).toHaveValue('22.16')
    await page.getByLabel('Фактический вес').first().fill('23.16')
    if (await hint.isVisible()) await hint.click()
    for (const width of [390, 430]) {
      await page.setViewportSize({ width, height: 844 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`loaded-${scenario.metric}-live-${width}.png`) })
    }
    await page.getByRole('button', { name: 'Готово, отдых' }).first().click()
    await expect(page.getByRole('button', { name: new RegExp(`${scenario.name} 1 подход · 23\\.16 кг`) })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('button', { name: new RegExp(`${scenario.name} 1 подход · 23\\.16 кг`) })).toBeVisible()
  })
}

test('loaded holds and carries keep fractional values, optional time and aligned controls', async ({ page }, testInfo) => {
  await page.goto('/auth')
  await page.addStyleTag({ content: '#fit-startup-shell, #fit-startup-emergency { display: none !important; }' })
  await page.evaluate(async () => {
    const modulePath = '/e2e/workout-load-fields-harness.tsx'
    const harness = await import(modulePath) as typeof import('./workout-load-fields-harness')
    harness.mountWorkoutLoadFieldsHarness()
  })
  await expect(page.getByLabel('Вес, подход 1')).toHaveValue('22.16')
  const carry = page.locator('.planned-exercise').filter({ hasText: 'Фермерская прогулка' })
  await expect(carry.locator('.planned-set-table-head')).toContainText('Кг')
  await expect(carry.locator('.planned-set-table-head')).toContainText('Дистанц.')
  await expect(carry.getByText('Время (необязательно)')).toBeVisible()
  await expect(carry.getByText(/Темп/)).toHaveCount(0)
  await carry.getByLabel('Расстояние, подход 1').fill('22,16')
  await carry.getByLabel('Единица расстояния, подход 1').selectOption('km')
  await carry.getByLabel('Расстояние, подход 1').press('Tab')
  expect(await page.locator('.workout-form').evaluate((form: HTMLFormElement) => Array.from(form.querySelectorAll<HTMLInputElement>('input')).filter((input) => !input.checkValidity()).map((input) => ({ label: input.getAttribute('aria-label'), message: input.validationMessage, value: input.value })))).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('loaded-fields-before-save.png'), fullPage: true })
  await page.getByRole('button', { name: 'Сохранить план' }).click()
  await expect(page.getByLabel('Сохранённые подходы')).toContainText('"distanceKm":0.02216')
  await carry.getByLabel('Расстояние, подход 1').fill('22.16')
  await carry.getByLabel('Расстояние, подход 1').press('Tab')
  await page.getByRole('button', { name: 'Сохранить план' }).click()
  await expect(page.getByLabel('Сохранённые подходы')).toContainText('"distanceKm":22.16')
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => { document.documentElement.classList.remove('theme-light', 'theme-dark'); document.body.classList.remove('theme-light', 'theme-dark'); document.documentElement.classList.add(`theme-${value}`) }, theme)
    await page.locator('.workout-create-edit-identity').evaluate((element, value) => { element.classList.remove('theme-light', 'theme-dark'); element.classList.add(`theme-${value}`) }, theme)
    for (const width of [390, 430, 1440]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const weight = await carry.getByLabel('Вес, подход 1').boundingBox()
      const distance = await carry.getByLabel('Расстояние, подход 1').boundingBox()
      const unit = await carry.getByLabel('Единица расстояния, подход 1').boundingBox()
      expect(weight).not.toBeNull()
      expect(distance).not.toBeNull()
      expect(unit).not.toBeNull()
      expect(Math.abs(weight!.y - distance!.y)).toBeLessThan(2)
      expect(Math.abs(unit!.y - distance!.y)).toBeLessThan(2)
      expect(unit!.height).toBeGreaterThanOrEqual(44)
      await page.screenshot({ path: testInfo.outputPath(`loaded-fields-${width}-${theme}.png`) })
    }
  }
  await page.getByLabel('Проверяемое упражнение').selectOption('vital-barbell-hold-ex010')
  await expect(page.locator('.planned-set-table-head')).toContainText('Время')
  await expect(page.locator('.planned-set-table-head')).toContainText('Кг')
  await expect(page.getByLabel('Вес, подход 1')).toHaveValue('22.16')
  await page.getByLabel('Проверяемое упражнение').selectOption('vital-gym-pro-r303-1645')
  await page.locator('.planned-exercise').getByRole('button', { name: 'Ещё действия' }).click()
  await page.getByRole('menuitem', { name: 'Настройки упражнения' }).click()
  await page.getByLabel('Измерение подхода').selectOption('duration')
  await page.getByRole('button', { name: 'Готово', exact: true }).click()
  await expect(page.locator('.planned-set-table-head')).toContainText('Время')
  await page.getByRole('button', { name: 'Сохранить план' }).click()
  await expect(page.getByLabel('Сохранённые подходы')).toContainText('"inputKind":"duration"')
})

test('saved and newly entered fractional weights do not block workout editing', async ({ page }, testInfo) => {
  await page.goto('/auth')
  await page.addStyleTag({ content: '#fit-startup-shell, #fit-startup-emergency { display: none !important; }' })
  await page.evaluate(async () => {
    const modulePath = '/e2e/workout-decimal-weight-harness.tsx'
    const harness = await import(modulePath) as typeof import('./workout-decimal-weight-harness')
    harness.mountWorkoutDecimalWeightHarness()
  })

  const weight = page.getByRole('spinbutton', { name: 'Вес, подход 1' })
  await expect(weight).toHaveValue('3.4')
  expect(await weight.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(true)
  await page.getByRole('button', { name: 'Сохранить план' }).click()
  await expect(page.getByRole('status', { name: 'Сохранённый вес' })).toHaveText('3.4')

  await weight.fill('4.3')
  await page.getByRole('button', { name: 'Сохранить план' }).click()
  await expect(page.getByRole('status', { name: 'Сохранённый вес' })).toHaveText('4.3')

  for (const width of [390, 430, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`decimal-weight-${width}.png`) })
  }
})

test('walking lunges accept kilograms in the plan and Live on iPhone', async ({ page }, testInfo) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/today$/)

  const clientName = `Выпады ${Date.now().toString().slice(-6)}`
  await page.goto('/clients/new')
  await page.getByLabel('Имя').fill(clientName)
  await page.getByLabel('Пол').selectOption('female')
  await page.getByLabel('Возраст').fill('30')
  await page.getByLabel('Рост, см').fill('170')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: clientName })).toBeVisible()

  await page.getByRole('link', { name: /Запланировать тренировку/ }).click()
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByLabel('Поиск упражнения').fill('Выпады в ходьбе')
  await page.getByRole('button', { name: 'Выбрать: Выпады в ходьбе', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await expect(page.locator('.planned-set-table-head')).toContainText('Кг')
  await expect(page.locator('.planned-set-table-head')).not.toContainText('Время')
  await page.getByLabel('Вес, подход 1').fill('12.5')
  await page.getByLabel('Повторы, подход 1').fill('10')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await page.getByRole('button', { name: 'Начать' }).click()
  const hint = page.locator('.coachmark-bubble').getByRole('button', { name: 'Понятно' })
  if (await hint.isVisible()) await hint.click()

  await expect(page.locator('.live-set-table-head')).toContainText('Кг')
  await expect(page.locator('.live-set-table-head')).not.toContainText('Время')
  await expect(page.getByLabel('Фактический вес').first()).toHaveValue('12.5')
  await page.getByLabel('Фактический вес').first().fill('13.5')
  if (await hint.isVisible()) await hint.click()
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`walking-lunge-live-${width}.png`) })
  }
  await page.getByRole('button', { name: 'Готово, отдых' }).first().click()
  await expect(page.getByRole('button', { name: /Выпады в ходьбе 1 подход · 13\.5 кг × 10 повт\./ })).toBeVisible()
})
