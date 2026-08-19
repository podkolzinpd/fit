import { expect, test, type Page } from '@playwright/test'

const demoClientId = '11111111-1111-4111-8111-111111111111'

async function login(page: Page, email: string) {
  await page.goto('/auth')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await Promise.all([
    page.waitForURL(/\/(?:today|me)$/),
    page.getByRole('button', { name: 'Войти' }).click(),
  ])
}

async function setRpe(page: Page, value: number) {
  const scale = page.getByRole('slider', { name: 'Общая тяжесть по шкале RPE' })
  await scale.focus()
  await scale.press('Home')
  for (let current = 1; current < value; current += 1) await scale.press('ArrowRight')
  await expect(scale).toHaveValue(String(value))
}

test('iPhone: trainer review and client post-workout feedback stay visible to the other side only', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page, 'trainer@fit.local')
  await expect(page.getByRole('heading', { name: 'Сегодня' })).toBeVisible()

  const today = new Date().toISOString().slice(0, 10)
  const targetDate = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10)
  // Для SPA достаточно готового DOM. В WebKit ожидание полного load иногда
  // задерживается фоновым соединением, хотя экран уже доступен пользователю.
  await page.goto(`/clients/${demoClientId}/goal`, { waitUntil: 'domcontentloaded' })
  const goalInput = page.getByLabel('Цель')
  const stagesHeading = page.getByRole('heading', { name: 'Этапы' })
  await expect(goalInput.or(stagesHeading)).toBeVisible()
  if (await goalInput.count()) {
    await goalInput.fill('Вернуться к бегу')
    await page.getByLabel('Дата достижения').fill(targetDate)
    await page.getByRole('button', { name: 'Создать цель' }).click()
  }
  await expect(stagesHeading).toBeVisible()
  if (!await page.getByText('Мягкий старт', { exact: true }).count()) {
    await page.getByRole('button', { name: '＋ Добавить' }).click()
    await page.getByLabel('Название этапа').fill('Мягкий старт')
    await page.getByLabel('Начало').fill(today)
    await page.getByLabel('Конец').fill(targetDate)
    await page.getByRole('button', { name: 'Добавить этап' }).click()
  }
  await expect(page.getByText('Мягкий старт', { exact: true }).first()).toBeVisible()

  await page.goto(`/workouts/new?client=${demoClientId}`)
  await page.getByRole('button', { name: 'Завершённая' }).click()
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByRole('button', { name: /^Силовая/ }).click()
  await page.getByRole('button', { name: /Планка \(Своё тело\)/ }).first().click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await Promise.all([
    page.waitForURL(/\/workouts\/[0-9a-f-]+$/),
    page.getByRole('button', { name: 'Записать тренировку' }).click(),
  ])
  await expect(page.getByRole('heading', { level: 1, name: 'Тренировка', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  const review = 'Отличная работа над техникой. На следующей тренировке сохрани спокойный темп между подходами.'
  await page.getByRole('button', { name: '🔥', exact: true }).click()
  await page.getByRole('textbox', { name: 'Отзыв тренера', exact: true }).fill(review)
  await page.getByRole('button', { name: 'Отправить ответ', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Изменить', exact: true })).toBeVisible()
  await expect(page.getByText(review, { exact: true })).toBeVisible()
  await expect(page.getByLabel('Реакция 🔥', { exact: true })).toBeVisible()
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)

  const workoutUrl = page.url()
  await page.goto('/profile')
  await page.getByRole('button', { name: 'Выйти' }).click()
  await login(page, 'client@fit.local')
  await page.goto('/me')
  // Client Home показывает только один дополнительный акцент. Свежий ответ
  // тренера приоритетнее цели, поэтому оба блока не конкурируют на главной.
  await expect(page.getByText('ОТ ТРЕНЕРА', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '🔥 Новый ответ' })).toBeVisible()
  await expect(page.getByText(review, { exact: true })).toBeVisible()
  await expect(page.getByText('ВАШ ФОКУС', { exact: true })).toHaveCount(0)
  await page.goto(workoutUrl)
  await expect(page.getByText(review, { exact: true })).toBeVisible()
  const trainerReviewCard = page.locator('.workout-review').filter({ has: page.getByRole('heading', { name: 'Отзыв тренера' }) })
  await expect(trainerReviewCard).toHaveClass(/workout-review-readonly/)
  await expect(trainerReviewCard.getByLabel('Реакция 🔥', { exact: true })).toBeVisible()
  await expect(trainerReviewCard.getByRole('button')).toHaveCount(0)
  const clientComment = 'После второго подхода стало тяжело, обсудим вес на следующей тренировке.'
  const feedbackCard = page.locator('.workout-feedback')
  await expect(feedbackCard.getByRole('heading', { name: 'Как прошла тренировка?' })).toBeVisible()
  const submitFeedback = feedbackCard.getByRole('button', { name: 'Отправить отзыв', exact: true })
  await expect(submitFeedback).toHaveAttribute('data-control-state', 'disabled')
  const rpeScale = feedbackCard.getByRole('slider', { name: 'Общая тяжесть по шкале RPE' })
  const rpeScaleBox = await rpeScale.boundingBox()
  expect(rpeScaleBox?.height).toBeGreaterThanOrEqual(44)
  await expect(feedbackCard.locator('.workout-feedback-rpe')).toHaveCount(0)
  await setRpe(page, 8)
  await expect(rpeScale).toHaveAttribute('aria-valuetext', 'RPE 8, Очень тяжело')
  const hardWellbeing = feedbackCard.getByRole('button', { name: 'Тяжело', exact: true })
  await hardWellbeing.click()
  await expect(hardWellbeing).toHaveAttribute('data-control-state', 'selected')
  const discomfortChoice = feedbackCard.getByRole('button', { name: 'Да', exact: true })
  await discomfortChoice.click()
  await expect(discomfortChoice).toHaveAttribute('data-tone', 'destructive')
  await expect(discomfortChoice).toHaveAttribute('data-control-state', 'selected')
  await page.getByRole('textbox', { name: 'Пояснение о дискомфорте', exact: true }).fill(clientComment)
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
  await submitFeedback.click()
  await expect(feedbackCard).toHaveClass(/workout-review-readonly/)
  await expect(feedbackCard.getByText('Спасибо, тренер увидит ваш отзыв.', { exact: false })).toBeVisible()
  await expect(feedbackCard.getByText('RPE 8/10', { exact: true })).toBeVisible()
  await expect(feedbackCard.getByText(clientComment, { exact: true })).toBeVisible()
  await page.goto('/me/workouts')
  const clientChronicleCard = page.locator('.workout-chronicle-card').filter({ hasText: review }).first()
  await expect(clientChronicleCard).toBeVisible()
  await expect(clientChronicleCard).toContainText('RPE 8/10')
  await expect(clientChronicleCard).toContainText('Тяжело')
  await expect(clientChronicleCard).toContainText('Дискомфорт')
  await expect(clientChronicleCard).toContainText(clientComment)
  await expect(clientChronicleCard).toContainText('🔥')
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
  await page.goto(workoutUrl)
  await page.getByRole('link', { name: 'История упражнения «Планка (Своё тело)»' }).click()
  await expect(page.getByRole('heading', { name: 'Упражнение' })).toBeVisible()
  const progressProof = page.getByLabel('Доказательство прогресса')
  await expect(progressProof).toBeVisible()
  await expect(progressProof.getByText('ПОДТВЕРЖДЁННЫЙ ФАКТ', { exact: true })).toBeVisible()
  await expect(progressProof.getByText(/Estimated 1RM не используется/)).toHaveCount(0)
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)

  // Та же форма доступна для завершённой тренировки, которую клиент записал
  // сам. До feedback факт уже сохранён и переживает reload.
  await page.goto('/workouts/new')
  await page.getByRole('button', { name: 'Завершённая' }).click()
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByRole('button', { name: /^Силовая/ }).click()
  await page.getByRole('button', { name: /Планка \(Своё тело\)/ }).first().click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await Promise.all([
    page.waitForURL(/\/workouts\/[0-9a-f-]+$/),
    page.getByRole('button', { name: 'Записать тренировку' }).click(),
  ])
  await expect(page.getByRole('heading', { level: 1, name: 'Тренировка', exact: true })).toBeVisible()
  const ownWorkoutUrl = page.url()
  expect(ownWorkoutUrl).toMatch(/\/workouts\/[0-9a-f-]+$/)
  await page.goto(ownWorkoutUrl, { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('Готово', { exact: true })).toBeVisible()
  const ownFeedbackCard = page.locator('.workout-feedback')
  await setRpe(page, 5)
  await ownFeedbackCard.getByRole('button', { name: 'Хорошо', exact: true }).click()
  await ownFeedbackCard.getByRole('button', { name: 'Нет', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Пояснение о дискомфорте' })).toHaveCount(0)
  await ownFeedbackCard.getByRole('button', { name: 'Отправить отзыв', exact: true }).click()
  await expect(ownFeedbackCard.getByText('RPE 5/10', { exact: true })).toBeVisible()
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)

  await page.goto('/me/profile')
  await page.getByRole('button', { name: 'Выйти' }).click()
  await login(page, 'trainer@fit.local')
  await page.goto(`/clients/${demoClientId}/workouts`)
  const trainerChronicleCard = page.locator('.workout-chronicle-card').filter({ hasText: review }).first()
  await expect(trainerChronicleCard).toBeVisible()
  await expect(trainerChronicleCard).toContainText('RPE 8/10')
  await expect(trainerChronicleCard).toContainText('Тяжело')
  await expect(trainerChronicleCard).toContainText(clientComment)
  await expect(trainerChronicleCard).toContainText('🔥')
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
  await page.goto(workoutUrl)
  await expect(page.getByRole('heading', { name: 'Самочувствие клиента' })).toBeVisible()
  await expect(page.getByText('RPE 8/10', { exact: true })).toBeVisible()
  await expect(page.getByText('Тяжело', { exact: true })).toBeVisible()
  await expect(page.getByText(clientComment, { exact: true })).toBeVisible()
  await expect(page.locator('.workout-feedback').getByRole('button')).toHaveCount(0)

  // Для client-authored workout отвечает только основной тренер карточки.
  // Сама тренировка остаётся read-only, но реакция и короткий ответ доступны.
  await page.goto(ownWorkoutUrl)
  await expect(page.getByText('Создано клиентом · только просмотр', { exact: true })).toBeVisible()
  const ownTrainerReviewCard = page.locator('.workout-review').filter({ has: page.getByRole('heading', { name: 'Отзыв тренера' }) })
  await expect(ownTrainerReviewCard).toHaveClass(/workout-review-readonly/)
  await ownTrainerReviewCard.getByRole('button', { name: 'Добавить', exact: true }).click()
  await expect(ownTrainerReviewCard).not.toHaveClass(/workout-review-readonly/)
  await ownTrainerReviewCard.getByRole('button', { name: '💪', exact: true }).click()
  const ownTrainerReview = 'Сильная самостоятельная работа — сохраняй этот темп.'
  await ownTrainerReviewCard.getByRole('textbox', { name: 'Отзыв тренера', exact: true }).fill(ownTrainerReview)
  await ownTrainerReviewCard.getByRole('button', { name: 'Отправить ответ', exact: true }).click()
  await expect(ownTrainerReviewCard).toHaveClass(/workout-review-readonly/)
  await expect(ownTrainerReviewCard.getByLabel('Реакция 💪', { exact: true })).toBeVisible()
  await expect(ownTrainerReviewCard.getByText(ownTrainerReview, { exact: true })).toBeVisible()

  await page.goto('/profile')
  await page.getByRole('button', { name: 'Выйти' }).click()
  await login(page, 'client@fit.local')
  await page.goto(ownWorkoutUrl)
  const ownClientReviewCard = page.locator('.workout-review').filter({ has: page.getByRole('heading', { name: 'Отзыв тренера' }) })
  await expect(ownClientReviewCard.getByLabel('Реакция 💪', { exact: true })).toBeVisible()
  await expect(ownClientReviewCard.getByText(ownTrainerReview, { exact: true })).toBeVisible()
  await expect(ownClientReviewCard.getByRole('button')).toHaveCount(0)
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
})
