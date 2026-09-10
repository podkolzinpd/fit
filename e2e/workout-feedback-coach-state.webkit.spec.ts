import { expect, test, type Page } from '@playwright/test'


const password = 'FitLocal123!'

async function register(page: Page, name: string, email: string, role: 'trainer' | 'client') {
  await page.goto('/auth')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  if (role === 'client') await page.getByLabel('Тип аккаунта').selectOption('client')
  await page.getByLabel('Имя').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await expect(page).toHaveURL(role === 'client' ? /\/me$/ : /\/today$/)
}

async function login(page: Page, email: string) {
  await page.goto('/auth')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти' }).click()
}

async function logout(page: Page, role: 'trainer' | 'client') {
  await page.goto(role === 'client' ? '/me/profile' : '/profile')
  await page.getByRole('button', { name: 'Выйти' }).click()
}

async function setRpe(page: Page, value: number) {
  const scale = page.getByRole('slider', { name: 'Общая тяжесть по шкале RPE' })
  await scale.focus()
  await scale.press('Home')
  for (let current = 1; current < value; current += 1) await scale.press('ArrowRight')
}

async function saveFeedback(page: Page, wellbeing: 'Хорошо' | 'Нормально' | 'Тяжело') {
  const card = page.locator('.workout-feedback')
  await setRpe(page, wellbeing === 'Хорошо' ? 5 : wellbeing === 'Нормально' ? 6 : 7)
  await card.getByRole('button', { name: wellbeing, exact: true }).click()
  await card.getByRole('button', { name: 'Нет', exact: true }).click()
  await card.getByRole('button', { name: /^(Отправить отзыв|Сохранить изменения)$/ }).click()
  await expect(card).toHaveClass(/workout-review-readonly/)
  return card
}

test('client feedback names a trainer only while the trainer connection is active', async ({ page }, testInfo) => {
  testInfo.setTimeout(180_000)
  const suffix = `${testInfo.workerIndex}-${Date.now()}`
  const clientEmail = `feedback-standalone-client-${suffix}@fit.local`
  const trainerEmail = `feedback-connected-trainer-${suffix}@fit.local`

  await page.setViewportSize({ width: 390, height: 844 })
  await register(page, 'Самостоятельный клиент', clientEmail, 'client')
  await page.goto('/me/edit')
  await page.getByLabel('Пол').selectOption('female')
  await page.getByLabel('Возраст').fill('30')
  await page.getByLabel('Рост, см').fill('170')
  await page.getByRole('button', { name: /^Сохранить(?: профиль)?$/ }).click()
  await expect(page).toHaveURL(/\/me$/)
  await page.goto('/workouts/new')
  await page.getByRole('button', { name: 'Завершённая' }).click()
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByRole('button', { name: /^Силовая/ }).click()
  await page.getByLabel('Поиск упражнения').fill('Планка')
  await page.getByRole('button', { name: 'Выбрать: Планка', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await Promise.all([
    page.waitForURL(/\/workouts\/[0-9a-f-]+$/),
    page.getByRole('button', { name: 'Записать тренировку' }).click(),
  ])
  const workoutUrl = page.url()

  let feedback = await saveFeedback(page, 'Нормально')
  await expect(feedback.getByText('Спасибо, данные о самочувствии сохранены.', { exact: false })).toBeVisible()
  await expect(feedback.getByText('тренер увидит', { exact: false })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Задать вопрос тренеру' })).toHaveCount(0)
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
  await page.screenshot({ path: testInfo.outputPath('feedback-without-trainer-390.png'), fullPage: true })

  await page.reload()
  feedback = page.locator('.workout-feedback')
  await expect(feedback.getByText('RPE 6/10', { exact: true })).toBeVisible()
  await expect(page.getByText('тренер увидит', { exact: false })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Задать вопрос тренеру' })).toHaveCount(0)

  await page.goto('/me/profile')
  await page.getByRole('button', { name: 'Пригласить тренера' }).click()
  const codeText = await page.getByText(/Код для тренера:/).textContent()
  const code = codeText?.match(/[A-F0-9]{12}/)?.[0]
  expect(code).toBeTruthy()
  await logout(page, 'client')

  await register(page, 'Тренер обратной связи', trainerEmail, 'trainer')
  await page.goto('/join')
  await page.getByLabel('Код приглашения').fill(code!)
  await page.getByRole('button', { name: 'Присоединиться' }).click()
  await expect(page.getByRole('heading', { name: 'Клиент подключён' })).toBeVisible()
  await logout(page, 'trainer')

  await login(page, clientEmail)
  await expect(page).toHaveURL(/\/me$/)
  await page.setViewportSize({ width: 430, height: 932 })
  await page.goto(workoutUrl)
  feedback = page.locator('.workout-feedback')
  await feedback.getByRole('button', { name: 'Изменить', exact: true }).click()
  feedback = await saveFeedback(page, 'Хорошо')
  await expect(feedback.getByText('Спасибо, тренер увидит ваш отзыв.', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Задать вопрос тренеру' })).toBeVisible()
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
  await page.screenshot({ path: testInfo.outputPath('feedback-with-active-trainer-430.png'), fullPage: true })

  await page.goto('/me/profile')
  await expect(page.getByText('Тренер обратной связи', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Отключить' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Отключить' }).click()
  await expect(page.getByText('Сейчас вы занимаетесь самостоятельно.')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Сейчас вы занимаетесь самостоятельно.')).toBeVisible()

  await page.goto(workoutUrl)
  feedback = page.locator('.workout-feedback')
  await feedback.getByRole('button', { name: 'Изменить', exact: true }).click()
  feedback = await saveFeedback(page, 'Тяжело')
  await expect(feedback.getByText('Спасибо, данные о самочувствии сохранены.', { exact: false })).toBeVisible()
  await expect(page.getByText('тренер увидит', { exact: false })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Задать вопрос тренеру' })).toHaveCount(0)
  await page.reload()
  await expect(feedback.getByText('RPE 7/10', { exact: true })).toBeVisible()
  await expect(page.getByText('тренер увидит', { exact: false })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Задать вопрос тренеру' })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('feedback-after-disconnect-430.png'), fullPage: true })

  await logout(page, 'client')
  const workoutRead = page.waitForRequest((request) => request.url().includes('/rest/v1/rpc/list_workouts'))
  await login(page, trainerEmail)
  await expect(page).toHaveURL(/\/today$/)
  const request = await workoutRead
  const api = new URL('/rest/v1/', request.url()).href
  const response = await page.request.get(`${api}workouts?id=eq.${new URL(workoutUrl).pathname.split('/').at(-1)}&select=id,session_rpe,wellbeing,discomfort`, {
    headers: {
      apikey: (await request.headerValue('apikey'))!,
      authorization: (await request.headerValue('authorization'))!,
    },
  })
  expect(response.ok()).toBe(true)
  expect(await response.json()).toEqual([])
})
