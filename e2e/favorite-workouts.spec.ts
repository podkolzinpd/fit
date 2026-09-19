import { expect, test } from '@playwright/test'

test('client saves a workout to favorites, then plans a new one from it', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('client@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/me$/)

  // Собираем реальную тренировку с одним упражнением и сохраняем как план.
  await page.goto('/workouts/new')
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByRole('button', { name: 'Бег', exact: true }).click()
  await page.getByLabel('Поиск упражнения').fill('Бег')
  await page.locator('[data-exercise-ref="running"]').click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await Promise.all([
    page.waitForURL(/\/workouts\/[0-9a-f-]+$/),
    page.getByRole('button', { name: 'Сохранить план' }).click(),
  ])
  const sourceUrl = page.url()

  // Сохраняем в избранное, ничего не вводя в название — должно уйти авто-имя.
  await page.getByRole('button', { name: 'Другие действия с тренировкой' }).click()
  await page.getByRole('menuitem', { name: 'В избранное' }).click()
  const dialog = page.getByRole('dialog', { name: 'Сохранить в избранное' })
  await expect(dialog).toBeVisible()
  const titleField = dialog.getByLabel('Название')
  await expect(titleField).toHaveValue('')
  const placeholder = await titleField.getAttribute('placeholder')
  expect(placeholder).toBe('Кардио')
  await dialog.getByRole('button', { name: 'Сохранить' }).click()
  await expect(dialog).not.toBeVisible()

  // Избранное видно во вкладке «Готовые тренировки» с авто-именем и счётчиком.
  await page.goto('/me/workouts?tab=presets')
  const favoriteCard = page.locator('.favorite-workout-card').filter({ hasText: placeholder! })
  await expect(favoriteCard).toBeVisible()
  await expect(favoriteCard).toContainText('1 упражнение')

  // «Запланировать» переносит структуру в новый черновик без похода в историю.
  await favoriteCard.getByRole('button', { name: 'Запланировать' }).click()
  await expect(page).toHaveURL(/\/workouts\/new\?favorite=/)
  await expect(page.getByText('Бег', { exact: true }).first()).toBeVisible()
  await Promise.all([
    page.waitForURL(/\/workouts\/[0-9a-f-]+$/),
    page.getByRole('button', { name: 'Сохранить план' }).click(),
  ])
  expect(page.url()).not.toBe(sourceUrl)

  // Новый план виден в «Актуальное» → «Предстоит».
  await page.goto('/me/workouts')
  await expect(page.getByText('БЛИЖАЙШЕЕ')).toBeVisible()
  await expect(page.getByText('Предстоит')).toBeVisible()

  // Удаление из избранного освобождает место в лимите на 10 тренировок.
  await page.goto('/me/workouts?tab=presets')
  await favoriteCard.getByRole('button', { name: `Удалить «${placeholder}» из избранного` }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect(favoriteCard).toHaveCount(0)
})

test('client sees a retry action, not a misleading empty state, when favorites fail to load', async ({ page }) => {
  await page.route('**/rest/v1/rpc/list_favorite_workouts', (route) => route.fulfill({
    status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'internal error' }),
  }))
  await page.goto('/auth')
  await page.getByLabel('Email').fill('client@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/me$/)

  await page.goto('/me/workouts?tab=presets')
  await expect(page.getByRole('alert').filter({ hasText: 'Не удалось загрузить избранное.' })).toBeVisible()
  await expect(page.getByText('Сохраняйте тренировки, которые вам нравятся')).not.toBeVisible()
})
