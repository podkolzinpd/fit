import { expect, test } from '@playwright/test'

async function mockWorkoutParser(page: import('@playwright/test').Page, items: unknown[]) {
  await page.route('**/functions/v1/parse-workout', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items, unmatched: [] }) })
  })
}

test('today: быстрый старт ведёт к единому выбору плана или завершённой тренировки', async ({ page }, testInfo) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)
  await page.goto('/today')

  await expect(page.getByRole('heading', { name: 'Новая тренировка' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Разобрать тренировку' })).toBeDisabled()
  await mockWorkoutParser(page, [
    { sourceText: 'Присед со штангой 3×8 — 80 кг', exerciseRef: 'barbell-squat', confidence: 1, sets: [{ weightKg: 80, reps: 8 }, { weightKg: 80, reps: 8 }, { weightKg: 80, reps: 8 }] },
    { sourceText: 'Планка 3×45 сек', exerciseRef: 'plank', confidence: 1, sets: [{ durationMin: 0.75 }, { durationMin: 0.75 }, { durationMin: 0.75 }] },
  ])
  await page.getByLabel('Тренировка').fill('Присед со штангой 3×8 — 80 кг\nПланка 3×45 сек')
  await expect(page.getByRole('button', { name: /Распознать/ })).toHaveCount(0)
  await expect(page.getByText('Черновик', { exact: true })).toHaveCount(0)
  await expect(page.locator('.today-parse-preview')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Разобрать тренировку' })).toBeEnabled()
  await page.getByRole('button', { name: 'Разобрать тренировку' }).click()
  await expect(page.getByRole('heading', { name: 'Проверьте тренировку' })).toBeVisible()
  await expect(page).toHaveURL(/\/today\?view=review$/)
  await expect(page.getByText('Распознано: 2', { exact: true })).toBeVisible()
  await expect(page.locator('.today-exercise')).toHaveCount(2)
  const firstExercise = page.locator('.today-exercise').first()
  await firstExercise.locator('.today-exercise-editor summary').click()
  await expect(firstExercise.getByLabel(/RPE, подход 1/)).toHaveCount(0)
  await firstExercise.getByRole('button', { name: 'Указать RPE' }).click()
  await expect(firstExercise.getByLabel(/RPE, подход 1/)).toBeVisible()
  await page.getByLabel('Удалить Присед со штангой (Штанга)').click()
  await expect(page.locator('.today-exercise')).toHaveCount(1)
  await expect(page.getByText('Упражнение удалено', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Отменить' }).click()
  await expect(page.locator('.today-exercise')).toHaveCount(2)
  await expect(page.getByLabel('Имя нового клиента')).toHaveCount(0)
  await page.getByRole('button', { name: 'Далее' }).click()
  await expect(page.getByRole('heading', { name: 'Сохраните тренировку' })).toBeVisible()
  await expect(page).toHaveURL(/\/today\?view=save$/)
  await page.getByRole('button', { name: '＋ Новый клиент' }).click()
  await expect(page.getByLabel('Имя нового клиента')).toBeVisible()
  const quickClientName = `Тест ${testInfo.workerIndex}-${Date.now()}`
  await page.getByLabel('Имя нового клиента').fill(quickClientName)
  await page.getByRole('button', { name: 'Создать' }).click()
  await expect(page.getByLabel('Для кого тренировка').locator('option:checked')).toHaveText(quickClientName)
  await page.getByLabel('Для кого тренировка').selectOption({ label: 'Анна Смирнова' })
  await expect(page.getByText('Нет клиента?', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Запланировать' })).toBeEnabled()
  await expect(page.getByLabel('Дата тренировки')).toBeVisible()
  await expect(page.getByLabel('Время тренировки')).toBeVisible()
  const planButton = page.getByRole('button', { name: 'Запланировать' })
  await planButton.scrollIntoViewIfNeeded()
  const [planBox, tabBarBox] = await Promise.all([planButton.boundingBox(), page.getByRole('navigation', { name: 'Основная навигация' }).boundingBox()])
  if (!planBox || !tabBarBox) throw new Error('Не удалось измерить кнопку сохранения или таббар')
  expect(planBox.y + planBox.height).toBeLessThanOrEqual(tabBarBox.y)
  await page.getByRole('button', { name: 'Завершённая' }).click()
  await expect(page.getByRole('button', { name: 'Записать как завершённую' })).toBeEnabled()
  await expect(page.getByLabel('Время тренировки')).toHaveCount(0)
  await page.getByRole('button', { name: '← К проверке' }).click()
  await expect(page.getByRole('heading', { name: 'Проверьте тренировку' })).toBeVisible()
  await expect(page.locator('.today-exercise')).toHaveCount(2)
  await page.getByRole('button', { name: '← Назад' }).click()
  await expect(page.getByRole('heading', { name: 'Новая тренировка' })).toBeVisible()
  await expect(page).toHaveURL(/\/today$/)
  await expect(page.getByLabel('Тренировка')).toHaveValue('Присед со штангой 3×8 — 80 кг\nПланка 3×45 сек')
  await page.waitForTimeout(3600)
  await expect(page.getByRole('heading', { name: 'Новая тренировка' })).toBeVisible()
})

test('создание из календаря: завершённая тренировка не остаётся в будущем', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)

  await page.goto('/workouts/new?date=2099-01-01')
  const date = page.locator('input[name="date"]')
  await expect(date).toHaveValue('2099-01-01')
  await page.getByRole('button', { name: 'Завершённая' }).click()
  const maxDate = await date.getAttribute('max')
  expect(maxDate).not.toBeNull()
  await expect(date).toHaveValue(maxDate!)
})

test('today: quick review наследует настройку RPE тренера', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)

  await page.goto('/profile')
  await page.getByRole('switch', { name: 'Показывать RPE в подходах' }).check()
  await page.goto('/today')
  await mockWorkoutParser(page, [{
    sourceText: 'Присед со штангой 3×8 — 80 кг', exerciseRef: 'barbell-squat', confidence: 1,
    sets: [{ weightKg: 80, reps: 8 }, { weightKg: 80, reps: 8 }, { weightKg: 80, reps: 8 }],
  }])
  await page.getByLabel('Тренировка').fill('Присед со штангой 3×8 — 80 кг')
  await page.getByRole('button', { name: 'Разобрать тренировку' }).click()

  const exercise = page.locator('.today-exercise').first()
  await exercise.locator('.today-exercise-editor summary').click()
  await expect(exercise.getByLabel(/RPE, подход 1/)).toBeVisible()
  await exercise.getByRole('button', { name: 'Скрыть RPE' }).click()
  await expect(exercise.getByLabel(/RPE, подход 1/)).toHaveCount(0)
})

test('today: черновик сохраняет финальный шаг и последовательные возвраты', async ({ page }) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)
  await page.goto('/today')
  await expect(page.getByRole('heading', { name: 'Новая тренировка' })).toBeVisible()

  const workoutText = 'Присед со штангой 3×8 — 80 кг\nПланка 3×45 сек'
  await mockWorkoutParser(page, [
    { sourceText: 'Присед со штангой 3×8 — 80 кг', exerciseRef: 'barbell-squat', confidence: 1, sets: [{ weightKg: 80, reps: 8 }, { weightKg: 80, reps: 8 }, { weightKg: 80, reps: 8 }] },
    { sourceText: 'Планка 3×45 сек', exerciseRef: 'plank', confidence: 1, sets: [{ durationMin: 0.75 }, { durationMin: 0.75 }, { durationMin: 0.75 }] },
  ])
  await page.getByLabel('Тренировка').fill(workoutText)
  await page.getByRole('button', { name: 'Разобрать тренировку' }).click()
  await expect(page.getByRole('heading', { name: 'Проверьте тренировку' })).toBeVisible()
  await page.getByRole('button', { name: 'Далее' }).click()
  await expect(page.getByRole('heading', { name: 'Сохраните тренировку' })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Сохраните тренировку' })).toBeVisible()
  await page.getByRole('button', { name: '← К проверке' }).click()
  await expect(page.locator('.today-exercise')).toHaveCount(2)
  await page.getByRole('button', { name: '← Назад' }).click()
  await expect(page.getByLabel('Тренировка')).toHaveValue(workoutText)
})
