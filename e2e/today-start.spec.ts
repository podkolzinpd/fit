import { expect, test } from '@playwright/test'

async function mockWorkoutParser(page: import('@playwright/test').Page, items: unknown[]) {
  await page.route('**/functions/v1/parse-workout', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items, unmatched: [] }) })
  })
}

async function mockStreamingVoice(page: import('@playwright/test').Page, transcript = 'Жим лёжа три подхода по десять 80 килограммов') {
  await page.addInitScript((recognizedText) => {
    const track = { stop() {} }
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => Promise.resolve({ getTracks: () => [track] }) } })
    class FakeAudioContext {
      sampleRate = 48_000
      destination = {}
      createMediaStreamSource() { return { connect() {}, disconnect() {} } }
      createScriptProcessor() { return { connect() {}, disconnect() {}, onaudioprocess: null } }
      async close() {}
    }
    class FakeWebSocket {
      static OPEN = 1
      readyState = 1
      binaryType = 'arraybuffer'
      onopen: (() => void) | null = null
      onerror: (() => void) | null = null
      onmessage: ((event: { data: string }) => void) | null = null
      constructor(url: string) { void url; window.setTimeout(() => this.onopen?.(), 0) }
      send(data: string | ArrayBuffer) {
        if (typeof data !== 'string') return
        const message = JSON.parse(data) as { type?: string }
        if (message.type === 'config') window.setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'partial', text: recognizedText.slice(0, 22) }) }), 20)
        if (message.type === 'stop') window.setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'final', text: recognizedText }) }), 20)
      }
      close() { this.readyState = 3 }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext })
    Object.defineProperty(window, 'WebSocket', { configurable: true, value: FakeWebSocket })
  }, transcript)
}

test('today: voice-first запускает запись, отменяет её и открывает review после transcript', async ({ page }) => {
  await mockWorkoutParser(page, [{ sourceText: 'Жим лёжа три подхода по десять 80 килограммов', exerciseRef: 'bench-press', confidence: 1, sets: [{ weightKg: 80, reps: 10 }, { weightKg: 80, reps: 10 }, { weightKg: 80, reps: 10 }] }])
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)
  await mockStreamingVoice(page)
  await page.goto('/today')

  await page.getByRole('button', { name: 'Надиктовать тренировку' }).click()
  await expect(page.getByRole('heading', { name: 'Слушаю…' })).toBeVisible()
  await page.getByRole('button', { name: 'Отменить' }).click()
  await expect(page.getByRole('heading', { name: 'Что будем делать?' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Проверьте тренировку' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Надиктовать тренировку' }).click()
  await expect(page.getByText(/Жим лёжа три подхода/)).toBeVisible()
  await page.getByRole('button', { name: 'Готово' }).click()
  await expect(page.getByRole('heading', { name: 'Проверьте тренировку' })).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('.today-exercise')).toHaveCount(1)
})

test('today: ошибка voice-разбора сохраняет transcript и раскрывает текстовый fallback', async ({ page }) => {
  await page.route('**/functions/v1/parse-workout', async (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'temporary' }) }))
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)
  await mockStreamingVoice(page)
  await page.goto('/today')

  await page.getByRole('button', { name: 'Надиктовать тренировку' }).click()
  await page.getByRole('button', { name: 'Готово' }).click()
  await expect(page.getByText('Не удалось обработать диктовку. Исходный текст сохранён.')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByLabel('Тренировка')).toHaveValue('Жим лёжа три подхода по десять 80 килограммов')
  await expect(page.getByRole('button', { name: 'Разобрать тренировку' })).toBeEnabled()
})

test('today: быстрый старт ведёт к единому выбору плана или завершённой тренировки', async ({ page }, testInfo) => {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('trainer@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/(today|clients)$/)
  await page.goto('/today')

  await expect(page.getByRole('heading', { name: 'Что будем делать?' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Надиктовать тренировку' })).toBeVisible()
  await expect(page.getByLabel('Тренировка')).toHaveCount(0)
  await page.getByRole('button', { name: 'Ввести текстом' }).click()
  await expect(page.getByText('Новая тренировка', { exact: true })).toBeVisible()
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
  await page.locator('.client-picker-trigger').click()
  await page.getByRole('button', { name: '＋ Новый клиент' }).click()
  await expect(page.getByLabel('Имя нового клиента')).toBeVisible()
  const quickClientName = `Тест ${testInfo.workerIndex}-${Date.now()}`
  await page.getByLabel('Имя нового клиента').fill(quickClientName)
  await page.getByRole('button', { name: 'Создать и выбрать' }).click()
  await expect(page.locator('.client-picker-trigger')).toContainText(quickClientName)
  await page.locator('.client-picker-trigger').click()
  await page.locator('.client-picker-item').filter({ hasText: 'Анна Смирнова' }).first().click()
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
  await expect(page.getByText('Новая тренировка', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/today$/)
  await expect(page.getByLabel('Тренировка')).toHaveValue('Присед со штангой 3×8 — 80 кг\nПланка 3×45 сек')
  await page.waitForTimeout(3600)
  await expect(page.getByText('Новая тренировка', { exact: true })).toBeVisible()
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
  await page.getByRole('button', { name: 'Ввести текстом' }).click()
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
  await expect(page.getByRole('heading', { name: 'Что будем делать?' })).toBeVisible()
  await page.getByRole('button', { name: 'Ввести текстом' }).click()
  await expect(page.getByText('Новая тренировка', { exact: true })).toBeVisible()

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
  await expect(page.getByText('Черновик восстановлен', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '← К проверке' }).click()
  await expect(page.locator('.today-exercise')).toHaveCount(2)
  await page.getByRole('button', { name: '← Назад' }).click()
  await expect(page.getByLabel('Тренировка')).toHaveValue(workoutText)
  await expect(page.getByText('Черновик восстановлен', { exact: true })).toHaveCount(0)

  await page.getByRole('link', { name: 'Клиенты' }).click()
  await page.getByRole('link', { name: 'Сегодня', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Надиктовать тренировку' })).toBeVisible()
  await expect(page.getByText('Есть незавершённая тренировка')).toBeVisible()
  await page.getByRole('button', { name: 'Продолжить' }).click()
  await expect(page.getByLabel('Тренировка')).toHaveValue(workoutText)

  await page.getByRole('link', { name: 'Клиенты' }).click()
  await page.getByRole('link', { name: 'Сегодня', exact: true }).click()
  await page.getByRole('button', { name: 'Ввести текстом' }).click()
  await expect(page.getByLabel('Тренировка')).toHaveValue('')
  await expect(page.getByText('Есть незавершённая тренировка')).toHaveCount(0)
})
