import { expect, test } from '@playwright/test'

const demoClientId = '11111111-1111-4111-8111-111111111111'

async function login(page: import('@playwright/test').Page, email: string) {
  await page.goto('/auth')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await Promise.all([
    page.waitForURL(/\/(?:today|me)$/),
    page.getByRole('button', { name: 'Войти' }).click(),
  ])
}

test('iPhone: trainer review and client comment stay visible to the other side only', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page, 'trainer@fit.local')
  await expect(page.getByRole('heading', { name: 'Сегодня' })).toBeVisible()

  const today = new Date().toISOString().slice(0, 10)
  const targetDate = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10)
  await page.goto(`/clients/${demoClientId}/goal`)
  await page.getByLabel('Цель').fill('Вернуться к бегу')
  await page.getByLabel('Дата достижения').fill(targetDate)
  await page.getByRole('button', { name: 'Создать цель' }).click()
  await page.getByRole('button', { name: '＋ Добавить' }).click()
  await page.getByLabel('Название этапа').fill('Мягкий старт')
  await page.getByLabel('Начало').fill(today)
  await page.getByLabel('Конец').fill(targetDate)
  await page.getByRole('button', { name: 'Добавить этап' }).click()
  await expect(page.getByText('Мягкий старт', { exact: true })).toBeVisible()

  await page.goto(`/workouts/new?client=${demoClientId}`)
  await page.getByRole('button', { name: 'Завершённая' }).click()
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByRole('button', { name: /Планка \(Своё тело\)/ }).first().click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await page.getByRole('button', { name: 'Записать тренировку' }).click()
  await expect(page.getByRole('heading', { name: 'Тренировка', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Добавить', exact: true }).click()
  const review = 'Отличная работа над техникой. На следующей тренировке сохрани спокойный темп между подходами.'
  await page.getByRole('textbox', { name: 'Отзыв тренера', exact: true }).fill(review)
  await page.getByRole('button', { name: 'Сохранить отзыв', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Изменить', exact: true })).toBeVisible()
  await expect(page.getByText(review, { exact: true })).toBeVisible()
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)

  const workoutUrl = page.url()
  await page.goto('/profile')
  await page.getByRole('button', { name: 'Выйти' }).click()
  await login(page, 'client@fit.local')
  await page.goto('/me')
  await expect(page.getByText('ВАШ ФОКУС', { exact: true })).toBeVisible()
  await expect(page.getByText('Вернуться к бегу', { exact: true })).toBeVisible()
  await expect(page.getByText('Текущий этап: Мягкий старт', { exact: true })).toBeVisible()
  await page.goto(workoutUrl)
  await expect(page.getByText(review, { exact: true })).toBeVisible()
  const trainerReviewCard = page.locator('.workout-review').filter({ has: page.getByRole('heading', { name: 'Отзыв тренера' }) })
  await expect(trainerReviewCard.getByRole('button')).toHaveCount(0)
  const clientComment = 'После второго подхода стало тяжело, обсудим вес на следующей тренировке.'
  const clientCommentCard = page.locator('.workout-review').filter({ has: page.getByRole('heading', { name: 'Комментарий клиента' }) })
  await clientCommentCard.getByRole('button', { name: 'Добавить', exact: true }).click()
  await page.getByRole('textbox', { name: 'Комментарий для тренера', exact: true }).fill(clientComment)
  await page.getByRole('button', { name: 'Сохранить комментарий', exact: true }).click()
  await expect(page.getByText(clientComment, { exact: true })).toBeVisible()
  await page.getByRole('link', { name: /Планка.*история/ }).click()
  await expect(page.getByRole('heading', { name: 'Упражнение' })).toBeVisible()
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)

  await page.goto('/me/profile')
  await page.getByRole('button', { name: 'Выйти' }).click()
  await login(page, 'trainer@fit.local')
  await page.goto(workoutUrl)
  await expect(page.getByText(clientComment, { exact: true })).toBeVisible()
  await expect(page.locator('.workout-review').filter({ has: page.getByRole('heading', { name: 'Комментарий клиента' }) }).getByRole('button')).toHaveCount(0)
})
