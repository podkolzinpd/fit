import { expect, test, type Page } from '@playwright/test'

const trainerId = '10000000-0000-4000-8000-000000000001'
const clientId = '10000000-0000-4000-8000-000000000002'
const workoutId = '10000000-0000-4000-8000-000000000003'
const conversationId = '10000000-0000-4000-8000-000000000004'
const messageId = '10000000-0000-4000-8000-000000000005'
const sessionToken = 's'.repeat(43)

const workout = {
  id: workoutId,
  trainerId,
  clientId,
  clientName: 'Алексей Смирнов',
  createdBy: trainerId,
  startedBy: null,
  completedBy: null,
  workoutDate: '2026-09-24',
  startTime: '10:00',
  endTime: '11:00',
  status: 'planned',
  notes: null,
  clientComment: null,
  sessionRpe: null,
  wellbeing: null,
  discomfort: null,
  feedbackSubmittedAt: null,
  trainerReaction: null,
  trainerReview: null,
  trainerReviewAuthorId: null,
  trainerReviewedAt: null,
  clientQuestion: null,
  clientQuestionAskedAt: null,
  clientQuestionResolvedAt: null,
  startedAt: null,
  completedAt: null,
  version: 1,
  exercises: [],
}

async function mockPilot(page: Page, options: { hasClients?: boolean; workouts?: Array<typeof workout>; failClients?: boolean; failWorkspace?: boolean; failThreads?: boolean; questionWorkout?: boolean } = {}) {
  let snoozedUntil: string | null = null
  let failClients = options.failClients ?? false
  let failWorkspace = options.failWorkspace ?? false
  let failThreads = options.failThreads ?? false
  let questionAnswered = false
  let unreadCount = 4
  await page.route('http://127.0.0.1:4100/health', async (route) => {
    await route.fulfill({ status: 200, headers: { 'x-fit-request-id': 'pilot-health-check', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-fit-request-id' }, contentType: 'application/json', body: '{"ok":true}' })
  })
  await page.addInitScript(({ token, profileId }) => {
    localStorage.setItem('fit.yandexAppSession.v1', JSON.stringify({
      token,
      expiresAt: '2099-01-01T00:00:00.000Z',
    }))
    localStorage.setItem(`fit.coachmarks-seen.${profileId}`, JSON.stringify([
      'assistant-all-trainers-2026-09',
    ]))
  }, { token: sessionToken, profileId: trainerId })
  await page.route('http://127.0.0.1:4100/v1/**', async (route) => {
    const url = new URL(route.request().url())
    let body: unknown
    if (url.pathname === '/v1/auth/yandex/session') {
      body = {
        accessMode: 'read_write',
        profile: {
          id: trainerId,
          firstName: 'Антон',
          lastName: null,
          timezone: 'Europe/Moscow',
          accountRole: 'trainer',
          experiments: { trainerScheduleV2: true },
        },
      }
    } else if (url.pathname === '/v1/legal/acceptance') {
      body = { applicable: true, accepted: true, acceptedAt: '2026-09-01T00:00:00.000Z' }
    } else if (url.pathname === '/v1/training-data') {
      body = {
        accessMode: 'read_only',
        customExercises: [],
        workouts: options.questionWorkout ? [{
          ...workout,
          status: 'done',
          clientQuestion: 'Можно заменить приседания?',
          clientQuestionAskedAt: '2026-09-24T11:30:00.000Z',
          clientQuestionResolvedAt: questionAnswered ? '2026-09-24T12:30:00.000Z' : null,
          trainerReview: questionAnswered ? 'Да, можно заменить.' : null,
          trainerReviewedAt: questionAnswered ? '2026-09-24T12:30:00.000Z' : null,
          completedAt: '2026-09-24T11:00:00.000Z',
          version: questionAnswered ? 2 : 1,
        }] : options.workouts ?? [workout],
        attention: options.questionWorkout && !questionAnswered ? [{
          workoutId,
          clientId,
          clientName: 'Алексей Смирнов',
          workoutDate: '2026-09-24',
          clientQuestion: 'Можно заменить приседания?',
          clientQuestionAskedAt: '2026-09-24T11:30:00.000Z',
          discomfort: false,
          clientComment: null,
          feedbackSubmittedAt: '2026-09-24T11:30:00.000Z',
          version: 1,
        }] : [],
        attentionPreferences: snoozedUntil ? [{ clientId, snoozedUntil }] : [],
        hasMoreWorkouts: false,
        totalWorkouts: options.workouts?.length ?? 1,
      }
    } else if (url.pathname === '/v1/clients') {
      if (failClients) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
        return
      }
      body = { clients: options.hasClients === false ? [] : [{
        id: clientId,
        canArchive: true,
        hasAccount: true,
        fullName: 'Алексей Смирнов',
        canonicalFullName: 'Алексей Смирнов',
        gender: null,
        ageYears: null,
        ageUpdatedAt: null,
        heightCm: null,
        goal: null,
        note: null,
        currentWeightKg: null,
        archivedAt: null,
        version: 1,
        membershipVersion: 1,
      }] }
    } else if (url.pathname === `/v1/clients/${clientId}/attention/snooze` && route.request().method() === 'POST') {
      snoozedUntil = '2099-01-01T00:00:00.000Z'
      body = { client: { snoozedUntil } }
    } else if (url.pathname === `/v1/workouts/${workoutId}/question/answer` && route.request().method() === 'PUT') {
      questionAnswered = true
      body = { workout: { version: 2 } }
    } else if (url.pathname === '/v1/trainer-workspace') {
      if (failWorkspace) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
        return
      }
      body = {
        summary: {
          pendingActionCount: 3,
          unresolvedQuestionCount: questionAnswered ? 0 : 1,
          unreadChatMessageCount: unreadCount,
          inboxCount: (questionAnswered ? 0 : 1) + unreadCount,
          updatedAt: '2026-09-24T12:00:00.000Z',
        },
        questions: questionAnswered ? [] : [{
          workoutId,
          clientId,
          clientName: 'Алексей Смирнов',
          question: 'Можно заменить приседания?',
          askedAt: '2026-09-24T11:30:00.000Z',
        }],
      }
    } else if (url.pathname === '/v1/chat/threads') {
      if (failThreads) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
        return
      }
      body = { threads: [{
        conversationId,
        clientId,
        trainerId,
        partnerUserId: clientId,
        partnerName: 'Алексей Смирнов',
        activeConnection: true,
        lastMessageBody: 'Спасибо!',
        lastMessageAt: '2026-09-24T11:45:00.000Z',
        lastMessageSenderId: clientId,
        unreadCount,
        canMessage: true,
        blockedByMe: false,
        blockedByPartner: false,
      }] }
    } else if (url.pathname === `/v1/chat/conversations/${conversationId}/messages`) {
      body = { messages: [{ id: messageId, conversationId, senderId: clientId, body: 'Спасибо!', createdAt: '2026-09-24T11:45:00.000Z', editedAt: null, replyTo: null, image: null }], nextCursor: null }
    } else if (url.pathname === `/v1/chat/conversations/${conversationId}/unread`) {
      body = { unread: { firstMessageId: unreadCount > 0 ? messageId : null, firstCreatedAt: unreadCount > 0 ? '2026-09-24T11:45:00.000Z' : null, unreadCount } }
    } else if (url.pathname === `/v1/chat/conversations/${conversationId}/connection`) {
      body = { state: { activeConnection: true, invitationPending: false, invitedAt: null, canInvite: false, canAccept: false, trainerSwitchRequired: false } }
    } else if (url.pathname === `/v1/chat/conversations/${conversationId}/read` && route.request().method() === 'PUT') {
      unreadCount = 0
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' }, body: '' })
      return
    } else {
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  return {
    setClientsFailure(value: boolean) { failClients = value },
    setWorkspaceFailure(value: boolean) { failWorkspace = value },
    setThreadsFailure(value: boolean) { failThreads = value },
  }
}

test.skip(!process.env.FIT_SCHEDULE_V2_VISUAL, 'Dedicated server-backed pilot harness')

test('renders the single-trainer schedule and combines questions with messages', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockPilot(page)
  await page.goto('/today?date=2026-09-24')

  await expect(page.locator('.trainer-schedule-v2-shell')).toBeVisible()
  await expect(page.getByRole('button', { name: /1 Незавершённые действия/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /5 Вопросы и сообщения/ })).toBeVisible()
  await expect(page.getByText('Алексей Смирнов')).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toContainText('СегодняРасписаниеКлиенты')
  await expect(page.getByRole('link', { name: 'Запланировать тренировку на 2026-09-24' })).toHaveAttribute('href', '/workouts/new?date=2026-09-24')
  const timelineScroll = await page.locator('.schedule-v2-timeline').evaluate((element) => element.scrollTop)
  expect(timelineScroll).toBeGreaterThan(300)
  expect(timelineScroll).toBeLessThan(500)
  const fabBox = await page.getByRole('link', { name: 'Запланировать тренировку на 2026-09-24' }).boundingBox()
  const navigationBox = await page.getByRole('navigation', { name: 'Основная навигация' }).boundingBox()
  expect(fabBox && navigationBox && fabBox.y + fabBox.height < navigationBox.y).toBe(true)

  const screenshotPath = testInfo.outputPath('trainer-schedule-v2.png')
  await page.screenshot({ path: screenshotPath, fullPage: true })
  await testInfo.attach('trainer-schedule-v2', { path: screenshotPath, contentType: 'image/png' })

  await page.getByRole('button', { name: /1 Незавершённые действия/ }).click()
  await expect(page.getByRole('dialog', { name: 'Рабочая очередь' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Требует действия' })).toBeVisible()
  await expect(page.getByText('Прошлый план ждёт решения')).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Рабочая очередь' }).getByText('Алексей Смирнов')).toHaveCSS('color', 'rgb(248, 248, 246)')
  const actionScreenshotPath = testInfo.outputPath('trainer-schedule-v2-actions.png')
  await page.screenshot({ path: actionScreenshotPath, fullPage: true })
  await testInfo.attach('trainer-schedule-v2-actions', { path: actionScreenshotPath, contentType: 'image/png' })
  await page.getByRole('button', { name: 'Закрыть рабочую очередь' }).click()

  await page.getByRole('button', { name: /5 Вопросы и сообщения/ }).click()
  await expect(page.getByRole('dialog', { name: 'Входящие' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Вопросы тренеру' })).toBeVisible()
  await expect(page.getByText('Можно заменить приседания?')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Сообщения', level: 3 })).toBeVisible()
  await expect(page.getByText('Спасибо!')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Закрыть входящие' })).toBeFocused()
  const inboxScreenshotPath = testInfo.outputPath('trainer-schedule-v2-inbox.png')
  await page.screenshot({ path: inboxScreenshotPath, fullPage: true })
  await testInfo.attach('trainer-schedule-v2-inbox', { path: inboxScreenshotPath, contentType: 'image/png' })

  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('link', { name: 'Открыть все сообщения' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Закрыть входящие' })).toBeFocused()

  await page.locator('.schedule-v2-timeline').evaluate((element) => { element.scrollTop = 0 })
  await page.getByRole('button', { name: 'Закрыть входящие' }).click()
  await expect(page.getByRole('button', { name: /5 Вопросы и сообщения/ })).toBeFocused()
  await expect.poll(() => page.locator('.schedule-v2-timeline').evaluate((element) => element.scrollTop)).toBe(0)
})

test('inbox messages fail independently and all-messages back returns to the selected day', async ({ page }) => {
  const backend = await mockPilot(page, { failThreads: true })
  await page.goto('/today?date=2026-09-24')
  await page.getByRole('button', { name: /5 Вопросы и сообщения/ }).click()
  const inbox = page.getByRole('dialog', { name: 'Входящие' })
  await expect(inbox.getByText('Можно заменить приседания?')).toBeVisible()
  await expect(inbox.getByText('Не удалось загрузить сообщения')).toBeVisible({ timeout: 15_000 })
  backend.setThreadsFailure(false)
  await inbox.getByRole('button', { name: 'Повторить загрузку сообщений' }).click()
  await expect(inbox.getByText('Спасибо!')).toBeVisible()
  await inbox.getByRole('link', { name: 'Открыть все сообщения' }).click()
  await expect(page).toHaveURL(/\/chat$/)
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page).toHaveURL(/\/today\?date=2026-09-24$/)
})

test('inbox questions fail independently and recover without hiding messages', async ({ page }) => {
  const backend = await mockPilot(page, { failWorkspace: true })
  await page.goto('/today?date=2026-09-24')
  await page.getByRole('button', { name: /Вопросы и сообщения/ }).click()
  const inbox = page.getByRole('dialog', { name: 'Входящие' })
  await expect(inbox.getByText('Спасибо!')).toBeVisible()
  await expect(inbox.getByText('Не удалось загрузить вопросы')).toBeVisible({ timeout: 15_000 })
  backend.setWorkspaceFailure(false)
  await inbox.getByRole('button', { name: 'Повторить загрузку вопросов' }).click()
  await expect(inbox.getByText('Можно заменить приседания?')).toBeVisible()
  await inbox.getByText('Можно заменить приседания?').click()
  await expect(page).toHaveURL(/\/workouts\/10000000-0000-4000-8000-000000000003\?reply=1$/)
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page).toHaveURL(/\/today\?date=2026-09-24$/)
})

test('replying to a trainer question updates the inbox count on return', async ({ page }) => {
  await mockPilot(page, { questionWorkout: true })
  await page.goto('/today?date=2026-09-24')
  await expect(page.getByRole('button', { name: '5 Вопросы и сообщения' })).toBeVisible()
  await page.getByRole('button', { name: /Незавершённые действия/ }).click()
  await expect(page.getByRole('dialog', { name: 'Рабочая очередь' }).getByText('Можно заменить приседания?')).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть рабочую очередь' }).click()
  await page.getByRole('button', { name: '5 Вопросы и сообщения' }).click()
  await page.getByRole('dialog', { name: 'Входящие' }).getByText('Можно заменить приседания?').click()
  await expect(page.getByRole('textbox', { name: 'Ответ клиенту' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Ответ клиенту' }).fill('Да, можно заменить.')
  await page.getByRole('button', { name: 'Отправить ответ' }).click()
  await expect(page.getByText('Вопрос закрыт')).toBeVisible()
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page).toHaveURL(/\/today\?date=2026-09-24$/)
  await expect(page.getByRole('button', { name: '4 Вопросы и сообщения' })).toBeVisible()
})

test('reading a chat message updates the inbox count on return', async ({ page }) => {
  const readRequests: string[] = []
  page.on('request', (request) => { if (request.method() === 'PUT' && request.url().includes('/read')) readRequests.push(request.url()) })
  await mockPilot(page)
  await page.goto('/today?date=2026-09-24')
  await expect(page.getByRole('button', { name: '5 Вопросы и сообщения' })).toBeVisible()
  await page.getByRole('button', { name: '5 Вопросы и сообщения' }).click()
  await page.getByRole('dialog', { name: 'Входящие' }).getByText('Спасибо!').click()
  await expect(page).toHaveURL(new RegExp(`/chat/${conversationId}$`))
  await expect(page.getByText('Спасибо!')).toBeVisible()
  await expect.poll(() => readRequests).toHaveLength(1)
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page).toHaveURL(/\/today\?date=2026-09-24$/)
  await expect(page.getByRole('button', { name: '1 Вопросы и сообщения' })).toBeVisible()
})

test('today keeps voice, text, draft, workout context and onboarding beside the calendar', async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
  await page.addInitScript((profileId) => {
    localStorage.setItem(`fit.today-draft.${profileId}`, JSON.stringify({
      screen: 'compose', text: 'Приседания 3 по 10', choices: {}, items: [], clientId: '',
    }))
  }, trainerId)
  await mockPilot(page, { workouts: [{ ...workout, workoutDate: '2026-09-27', startTime: '15:00' }] })
  await page.goto('/today')

  await expect(page.getByRole('link', { name: 'Надиктовать тренировку' })).toHaveAttribute('href', '/today?view=compose')
  await expect(page.getByRole('link', { name: 'Ввести текстом' })).toHaveAttribute('href', '/today?view=compose&entry=text')
  await expect(page.getByRole('link', { name: /Есть незавершённая тренировка.*Продолжить/ })).toBeVisible()
  await expect(page.locator('.schedule-v2-next-workout')).toContainText('Ближайшая тренировка')
  await expect(page.locator('.schedule-v2-next-workout')).toContainText('Алексей Смирнов')
  const timelineHeight = await page.locator('.schedule-v2-timeline').evaluate((element) => element.clientHeight)
  await page.getByRole('button', { name: 'Установка и уведомления' }).click()
  await expect(page.getByRole('dialog', { name: 'Установка и уведомления' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Открыть настройки' })).toBeVisible()
  expect(await page.locator('.schedule-v2-timeline').evaluate((element) => element.clientHeight)).toBe(timelineHeight)
  const screenshotPath = testInfo.outputPath('trainer-schedule-v2-today-actions.png')
  await page.screenshot({ path: screenshotPath, fullPage: true })
  await testInfo.attach('trainer-schedule-v2-today-actions', { path: screenshotPath, contentType: 'image/png' })

  await page.getByRole('button', { name: 'Закрыть подсказки' }).click()
  await page.getByRole('link', { name: 'Ввести текстом' }).click()
  await expect(page).toHaveURL(/\/today\?view=compose&entry=text$/)
  await expect(page.locator('.today-text-fallback')).toBeVisible()
  await expect(page.locator('.today-text-fallback')).toContainText('Приседания 3 по 10')
  await page.goBack()
  await expect(page.locator('.schedule-v2-home-actions')).toBeVisible()
  await page.getByRole('link', { name: 'Надиктовать тренировку' }).click()
  await expect(page).toHaveURL(/\/today\?view=compose$/)
  await expect(page.getByRole('button', { name: 'Надиктовать тренировку' })).toBeVisible()
})

test('today keeps creation available when the trainer has no clients or workouts', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
  await mockPilot(page, { hasClients: false, workouts: [] })
  await page.goto('/today')
  await expect(page.getByRole('link', { name: 'Добавить первого клиента' })).toHaveAttribute('href', '/clients/new')
  await expect(page.getByRole('link', { name: 'Надиктовать тренировку' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ввести текстом' })).toBeVisible()
  await expect(page.locator('.schedule-v2-next-workout')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '0 Незавершённые действия' })).toBeVisible()
  await page.getByRole('button', { name: '0 Незавершённые действия' }).click()
  await expect(page.getByRole('dialog', { name: 'Рабочая очередь' }).getByText('Незавершённых действий нет')).toBeVisible()
})

test('action queue shows source failure and recovers on retry', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
  const backend = await mockPilot(page, { workouts: [], failClients: true })
  await page.goto('/today')
  await expect(page.getByRole('button', { name: '— Незавершённые действия' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '— Незавершённые действия' }).click()
  const queue = page.getByRole('dialog', { name: 'Рабочая очередь' })
  await expect(queue.getByRole('alert')).toContainText('Не удалось загрузить действия')
  backend.setClientsFailure(false)
  await queue.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByRole('button', { name: '1 Незавершённые действия' })).toBeVisible()
  await expect(queue.getByRole('heading', { name: 'Проверить планы' })).toBeVisible()
})

test('the bell count equals the visible queue and updates after snoozing', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
  let snoozeStatus = 0
  const snoozeRequests: string[] = []
  page.on('request', (request) => { if (request.method() === 'POST' && request.url().includes('/attention/snooze')) snoozeRequests.push(request.url()) })
  page.on('response', (response) => { if (response.url().includes('/attention/snooze')) snoozeStatus = response.status() })
  await mockPilot(page, { workouts: [] })
  await page.goto('/today')
  await expect(page.getByRole('button', { name: '1 Незавершённые действия' })).toBeVisible()
  await page.getByRole('button', { name: '1 Незавершённые действия' }).click()
  const queue = page.getByRole('dialog', { name: 'Рабочая очередь' })
  await expect(queue.getByRole('heading', { name: 'Проверить планы' })).toBeVisible()
  await expect(queue.getByText('Тренировки ещё не добавлены')).toBeVisible()
  await queue.getByRole('button', { name: 'Напомнить через 2 недели' }).click()
  await expect.poll(() => snoozeRequests).toHaveLength(1)
  await expect.poll(() => snoozeStatus).toBe(200)
  await expect(page.getByRole('button', { name: '0 Незавершённые действия' })).toBeVisible()
  await expect(queue.getByText('Незавершённых действий нет')).toBeVisible()
})

test('today keeps workout entry usable while clients fail and recover', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
  await mockPilot(page)
  let recovered = false
  await page.route('http://127.0.0.1:4100/v1/clients', async (route) => {
    await route.fulfill(recovered
      ? { status: 200, contentType: 'application/json', body: JSON.stringify({ clients: [] }) }
      : { status: 503, contentType: 'application/json', body: '{}' })
  })
  await page.goto('/today')
  await expect(page.getByRole('link', { name: 'Надиктовать тренировку' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить клиентов')
  recovered = true
  await page.getByRole('alert').getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByRole('link', { name: 'Добавить первого клиента' })).toBeVisible()
})

test('renders the weekly overview from the approved composition', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 430, height: 932 })
  await mockPilot(page)
  await page.goto('/schedule?week=2026-09-21')

  await expect(page.locator('.trainer-schedule-v2-shell')).toBeVisible()
  await expect(page.locator('.schedule-v2-topbar h1')).toHaveText('Расписание')
  await expect(page.getByText('21 — 27 Сентября 2026 г.')).toBeVisible()
  await expect(page.getByText('1 тренировка · 1 клиент')).toBeVisible()
  await expect(page.getByText('Алексей Смирнов')).toBeVisible()
  await expect(page.getByText('Свободный день')).toHaveCount(6)
  await expect(page.locator('.schedule-event-decision')).toBeVisible()

  const screenshotPath = testInfo.outputPath('trainer-schedule-v2-week.png')
  await page.screenshot({ path: screenshotPath, fullPage: true })
  await testInfo.attach('trainer-schedule-v2-week', { path: screenshotPath, contentType: 'image/png' })
})

test('keeps the selected day and both weeks through navigation and reload', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockPilot(page)
  await page.goto('/schedule?week=2026-09-21')
  await page.getByRole('button', { name: '2 недели', exact: true }).click()
  await expect(page).toHaveURL(/\/schedule\?week=2026-09-21&range=2w$/)
  await expect(page.locator('.schedule-v2-day-card')).toHaveCount(14)
  const twoWeekScreenshot = testInfo.outputPath('two-weeks.png')
  await page.screenshot({ path: twoWeekScreenshot, fullPage: true })
  await testInfo.attach('trainer-schedule-v2-two-weeks', { path: twoWeekScreenshot, contentType: 'image/png' })
  await page.locator('.schedule-v2-day-card').nth(8).click()
  await expect(page).toHaveURL(/\/today\?date=2026-09-29&week=2026-09-21&range=2w$/)
  await expect(page.locator('.schedule-v2-timeline')).toBeVisible()
  await page.reload()
  await expect(page).toHaveURL(/\/today\?date=2026-09-29&week=2026-09-21&range=2w$/)
  await page.getByRole('button', { name: 'Настройки расписания' }).click()
  await page.getByRole('menuitem', { name: 'К 2 неделям' }).click()
  await expect(page).toHaveURL(/\/schedule\?week=2026-09-21&range=2w$/)
  await expect(page.locator('.schedule-v2-day-card')).toHaveCount(14)

  await page.locator('.schedule-v2-day-card').nth(3).click()
  await expect(page).toHaveURL(/\/today\?date=2026-09-24&week=2026-09-21&range=2w$/)
  await page.locator('.schedule-v2-event').click()
  await expect(page).toHaveURL(new RegExp(`/workouts/${workoutId}$`))
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await expect(page).toHaveURL(/\/today\?date=2026-09-24&week=2026-09-21&range=2w$/)
})

test('invalid calendar URL dates do not crash the pilot', async ({ page }) => {
  await mockPilot(page)
  await page.goto('/schedule?week=2026-02-31&range=2w')
  await expect(page.locator('.schedule-v2-day-card')).toHaveCount(14)
  await page.goto('/today?date=oops&week=2026-02-31')
  await expect(page.locator('.schedule-v2-timeline')).toBeVisible()
})

test('pilot tabs, profile and browser back keep a stable calendar route', async ({ page }, testInfo) => {
  await mockPilot(page)
  await page.goto('/today?date=2026-09-24&week=2026-09-21')
  const navigation = page.getByRole('navigation', { name: 'Основная навигация' })
  await expect(navigation.getByRole('link', { name: 'Расписание' })).toBeVisible()
  const tabLabels = async () => (await navigation.locator('a').allTextContents()).map((label) => label.trim())
  const initialLabels = await tabLabels()
  expect(initialLabels.slice(0, 3)).toEqual(['Сегодня', 'Расписание', 'Клиенты'])
  await navigation.getByRole('link', { name: 'Расписание' }).click()
  await expect(page).toHaveURL(/\/schedule$/)
  expect(await tabLabels()).toEqual(initialLabels)
  await expect(navigation.getByRole('link', { name: 'Расписание' })).toHaveAttribute('aria-current', 'page')
  await navigation.getByRole('link', { name: 'Клиенты' }).click()
  await expect(page).toHaveURL(/\/clients$/)
  expect(await tabLabels()).toEqual(initialLabels)
  await expect(navigation.getByRole('link', { name: 'Клиенты' })).toHaveAttribute('aria-current', 'page')
  await page.goBack()
  await expect(page).toHaveURL(/\/schedule$/)
  await page.getByRole('button', { name: 'Настройки расписания' }).click()
  await expect(page.getByRole('menu')).toHaveCSS('background-color', 'rgb(34, 34, 38)')
  await expect(page.getByRole('menuitem', { name: 'Профиль', exact: true })).toHaveCSS('color', 'rgb(248, 248, 246)')
  const menuScreenshot = testInfo.outputPath('pilot-nav-profile-menu.png')
  await page.screenshot({ path: menuScreenshot })
  await testInfo.attach('pilot-nav-profile-menu', { path: menuScreenshot, contentType: 'image/png' })
  await page.getByRole('menuitem', { name: 'Профиль', exact: true }).click()
  await expect(page).toHaveURL(/\/profile$/)
  expect(await tabLabels()).toEqual(initialLabels)
  await page.goBack()
  await expect(page).toHaveURL(/\/schedule$/)
  await page.goto('/today?date=2026-09-24&week=2026-09-21')
  await page.getByRole('button', { name: 'Настройки расписания' }).click()
  await expect(page.getByRole('menuitem', { name: 'Настройки', exact: true })).toBeVisible()
})

test('pilot calendar keeps workout review and save in the existing entry flow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockPilot(page)
  await page.goto('/today?date=2026-09-24')
  expect(await page.evaluate(() => localStorage.getItem('fit.yandexAppSession.v1') !== null)).toBe(true)
  await expect(page.locator('.schedule-v2-timeline')).toBeVisible()
  await page.evaluate(({ profileId, workoutClientId }) => {
    localStorage.setItem(`fit.today-draft.${profileId}`, JSON.stringify({
      screen: 'review',
      text: 'Приседания 3 по 8',
      choices: {},
      items: [{
        line: 'Приседания 3 по 8',
        exercise: { ref: 'squat', name: 'Приседания', inputKind: 'reps' },
        sets: [{ position: 0, reps: 8 }],
        hasValues: true,
      }],
      clientId: workoutClientId,
      recordMode: 'planned',
      workoutDate: '2026-09-24',
      startTime: '10:00',
    }))
  }, { profileId: trainerId, workoutClientId: clientId })
  await page.goto('/today?view=review')
  await expect(page.getByRole('heading', { name: 'Проверьте тренировку' })).toBeVisible()
  await expect(page.locator('.schedule-v2-timeline')).toHaveCount(0)
  await testInfo.attach('pilot-workout-review', { body: await page.screenshot(), contentType: 'image/png' })
  await page.getByRole('button', { name: 'Далее' }).click()
  await expect(page).toHaveURL(/\/today\?view=save$/)
  await expect(page.getByRole('heading', { name: 'Сохраните тренировку' })).toBeVisible()
  await testInfo.attach('pilot-workout-save', { body: await page.screenshot(), contentType: 'image/png' })
  await page.getByRole('button', { name: '← К проверке' }).click()
  await expect(page.getByRole('heading', { name: 'Проверьте тренировку' })).toBeVisible()
  await page.getByRole('button', { name: '← Назад' }).click()
  await expect(page).toHaveURL(/\/today\?view=compose$/)
  await expect(page.getByText('Новая тренировка', { exact: true })).toBeVisible()
  await page.goto('/today?classic=1#trainer-attention')
  await expect(page.getByRole('heading', { name: 'Что будем делать?' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Продолжить' })).toBeVisible()
})
