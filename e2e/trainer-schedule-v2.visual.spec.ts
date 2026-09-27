import { expect, test, type Page } from '@playwright/test'

const trainerId = '10000000-0000-4000-8000-000000000001'
const clientId = '10000000-0000-4000-8000-000000000002'
const workoutId = '10000000-0000-4000-8000-000000000003'
const conversationId = '10000000-0000-4000-8000-000000000004'
const messageId = '10000000-0000-4000-8000-000000000005'
const newWorkoutId = '10000000-0000-4000-8000-000000000006'
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

type MockWorkout = Omit<typeof workout, 'startTime' | 'endTime'> & { startTime: string | null; endTime: string | null }

async function mockPilot(page: Page, options: { profileId?: string; pilot?: boolean; fitLime?: boolean; hasClients?: boolean; workouts?: MockWorkout[]; failClients?: boolean; failTrainingData?: boolean; failWorkspace?: boolean; failThreads?: boolean; questionWorkout?: boolean; failFirstSave?: boolean; failFirstChatSend?: boolean } = {}) {
  const profileId = options.profileId ?? trainerId
  let snoozedUntil: string | null = null
  let failClients = options.failClients ?? false
  let failTrainingData = options.failTrainingData ?? false
  let failWorkspace = options.failWorkspace ?? false
  let failThreads = options.failThreads ?? false
  let questionAnswered = false
  let unreadCount = 4
  let workouts: MockWorkout[] = options.workouts ?? [workout]
  let saveAttempts = 0
  let chatSendAttempts = 0
  const sentMessages: Array<{ id: string; conversationId: string; senderId: string; body: string; createdAt: string; editedAt: null; replyTo: null; image: null }> = []
  let lastSavedStartTime: string | null = null
  let lastEditedStartTime: string | null = null
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
  }, { token: sessionToken, profileId })
  await page.route('http://127.0.0.1:4100/v1/**', async (route) => {
    const url = new URL(route.request().url())
    let body: unknown
    if (url.pathname === '/v1/auth/yandex/session') {
      body = {
        accessMode: 'read_write',
        profile: {
          id: profileId,
          firstName: 'Антон',
          lastName: null,
          timezone: 'Europe/Moscow',
          accountRole: 'trainer',
          experiments: { trainerScheduleV2: options.pilot !== false, fitLime: options.fitLime === true },
        },
      }
    } else if (url.pathname === '/v1/legal/acceptance') {
      body = { applicable: true, accepted: true, acceptedAt: '2026-09-01T00:00:00.000Z' }
    } else if (url.pathname === '/v1/training-data') {
      if (failTrainingData) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
        return
      }
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
        }] : workouts,
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
        totalWorkouts: workouts.length,
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
    } else if (url.pathname === '/v1/workouts' && route.request().method() === 'POST') {
      saveAttempts += 1
      if (options.failFirstSave && saveAttempts === 1) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
        return
      }
      const draft = route.request().postDataJSON() as { workoutDate: string; startTime?: string | null; endTime?: string | null }
      lastSavedStartTime = draft.startTime ?? null
      workouts = [...workouts.filter((item) => item.id !== newWorkoutId), { ...workout, id: newWorkoutId, workoutDate: draft.workoutDate, startTime: draft.startTime || '10:00', endTime: draft.endTime || '11:00' }]
      body = { workout: { id: newWorkoutId } }
    } else if (url.pathname === `/v1/workouts/${workoutId}` && route.request().method() === 'PUT') {
      const draft = route.request().postDataJSON() as { workoutDate: string; startTime?: string | null; endTime?: string | null }
      lastEditedStartTime = draft.startTime ?? null
      workouts = workouts.map((item) => item.id === workoutId
        ? { ...item, workoutDate: draft.workoutDate, startTime: draft.startTime || '10:00', endTime: draft.endTime || '11:00', version: item.version + 1 }
        : item)
      body = { workout: { id: workoutId } }
    } else if (url.pathname === `/v1/workouts/${workoutId}/reschedule` && route.request().method() === 'POST') {
      const draft = route.request().postDataJSON() as { workoutDate: string; startTime?: string | null }
      workouts = workouts.map((item) => item.id === workoutId
        ? { ...item, workoutDate: draft.workoutDate, startTime: draft.startTime || '10:00', version: item.version + 1 }
        : item)
      body = { workout: { version: 2 } }
    } else if (url.pathname === `/v1/workouts/${workoutId}/cancel` && route.request().method() === 'POST') {
      workouts = workouts.map((item) => item.id === workoutId ? { ...item, status: 'cancelled', version: item.version + 1 } : item)
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
    } else if (url.pathname === `/v1/chat/conversations/${conversationId}/messages` && route.request().method() === 'POST') {
      chatSendAttempts += 1
      if (options.failFirstChatSend && chatSendAttempts === 1) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
        return
      }
      const draft = route.request().postDataJSON() as { id: string; body: string }
      const message = { id: draft.id, conversationId, senderId: profileId, body: draft.body, createdAt: '2026-09-24T12:00:00.000Z', editedAt: null, replyTo: null, image: null }
      sentMessages.push(message)
      body = { message }
    } else if (url.pathname === `/v1/chat/conversations/${conversationId}/messages`) {
      body = { messages: [{ id: messageId, conversationId, senderId: clientId, body: 'Спасибо!', createdAt: '2026-09-24T11:45:00.000Z', editedAt: null, replyTo: null, image: null }, ...sentMessages], nextCursor: null }
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
    setTrainingDataFailure(value: boolean) { failTrainingData = value },
    setWorkspaceFailure(value: boolean) { failWorkspace = value },
    setThreadsFailure(value: boolean) { failThreads = value },
    getSaveAttempts() { return saveAttempts },
    getLastSavedStartTime() { return lastSavedStartTime },
    getLastEditedStartTime() { return lastEditedStartTime },
    getChatSendAttempts() { return chatSendAttempts },
  }
}

test.skip(!process.env.FIT_SCHEDULE_V2_VISUAL, 'Dedicated server-backed pilot harness')

for (const [account, profileId] of [
  ['first', trainerId],
  ['second', '10000000-0000-4000-8000-000000000010'],
] as const) {
  test(`${account} server-assigned trainer keeps calendar, actions and inbox after direct navigation`, async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
    await mockPilot(page, { profileId, workouts: [] })
    await page.goto('/today?date=2026-09-24')
    await expect(page.locator('.trainer-schedule-v2-shell')).toBeVisible()
    await expect(page.locator('.schedule-v2-topbar h1')).toHaveText('24 сентября')
    await expect(page.getByRole('button', { name: '1 Незавершённые действия' })).toBeVisible()
    await expect(page.getByRole('button', { name: '5 Вопросы и сообщения' })).toBeVisible()
    await page.getByRole('button', { name: '5 Вопросы и сообщения' }).click()
    await expect(page.getByRole('dialog', { name: 'Входящие' }).getByRole('heading', { name: 'Сообщения' })).toBeVisible()
    await page.getByRole('button', { name: 'Закрыть входящие' }).click()
    await page.goto('/schedule?week=2026-09-21')
    await expect(page.getByRole('button', { name: 'Четверг, 24 сентября' })).toBeVisible()
    await page.reload()
    await expect(page.locator('.schedule-v2-card-grid')).toBeVisible()
  })
}

for (const [account, profileId] of [
  ['first', trainerId],
  ['second', '10000000-0000-4000-8000-000000000010'],
] as const) {
  test(`${account} trainer receives Fit Lime shell only on the redesigned calendar`, async ({ page }, testInfo) => {
    await mockPilot(page, { profileId, fitLime: true, workouts: [] })
    await page.goto('/today?date=2026-09-24')
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    await expect(page.locator('html')).toHaveClass(/fit-lime-document/)
    await expect(page.locator('.schedule-v2-topbar h1')).toHaveText('24 сентября')
    if (account === 'first') {
      const screenshotPath = testInfo.outputPath('fit-lime-shell-today.png')
      await page.screenshot({ path: screenshotPath, fullPage: true })
      await testInfo.attach('fit-lime-shell-today', { path: screenshotPath, contentType: 'image/png' })
    }
    await page.reload()
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    await page.goto('/clients')
    await expect(page.locator('.phone-frame')).not.toHaveClass(/fit-lime-shell/)
    await expect(page.locator('html')).not.toHaveClass(/fit-lime-document/)
    await page.goto('/today?view=compose')
    await expect(page.locator('.phone-frame')).not.toHaveClass(/fit-lime-shell/)
    await page.goto('/schedule?week=2026-09-21')
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
  })
}

for (const [account, profileId] of [
  ['first', trainerId],
  ['second', '10000000-0000-4000-8000-000000000010'],
] as const) {
  test(`${account} Fit Lime today keeps the reference hierarchy and working entry paths`, async ({ page }, testInfo) => {
    await page.clock.setFixedTime(new Date('2026-09-24T12:30:00+03:00'))
    await mockPilot(page, { profileId, fitLime: true })
    await page.goto('/today?date=2026-09-24')
    await expect(page.locator('.fit-lime-today')).toBeVisible()
    await expect(page.locator('.schedule-v2 > section').first()).toHaveClass(/schedule-v2-summary/)
    await expect(page.getByRole('button', { name: '0 Незавершённые действия' })).toBeVisible()
    await expect(page.getByRole('button', { name: '5 Вопросы и сообщения' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Надиктовать тренировку' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Ввести текстом' })).toBeVisible()
    await expect(page.locator('.schedule-v2-now')).toBeVisible()
    if (account === 'first') {
      const screenshotPath = testInfo.outputPath('fit-lime-today.png')
      await page.screenshot({ path: screenshotPath, fullPage: true })
      await testInfo.attach('fit-lime-today', { path: screenshotPath, contentType: 'image/png' })
    }
    await page.getByRole('link', { name: 'Ввести текстом' }).click()
    await expect(page).toHaveURL(/\/today\?view=compose&entry=text/)
    await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
  })
}

test('trainer without Fit Lime keeps the existing day hierarchy', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-24T12:30:00+03:00'))
  await mockPilot(page)
  await page.goto('/today?date=2026-09-24')
  await expect(page.locator('.fit-lime-today')).toHaveCount(0)
  await expect(page.locator('.schedule-v2 > section').first()).toHaveClass(/schedule-v2-home-actions/)
})

for (const [account, profileId] of [
  ['first', trainerId],
  ['second', '10000000-0000-4000-8000-000000000010'],
] as const) {
  test(`${account} Fit Lime schedule keeps week, fortnight and selected date`, async ({ page }, testInfo) => {
    await page.clock.setFixedTime(new Date('2026-09-21T12:30:00+03:00'))
    await mockPilot(page, { profileId, fitLime: true })
    await page.goto('/schedule?week=2026-09-21')
    await expect(page.locator('.fit-lime-schedule')).toBeVisible()
    await expect(page.locator('.schedule-v2-day-card')).toHaveCount(7)
    const weekstripSurface = await page.locator('.schedule-v2-weekdays').first().evaluate((element) => ({
      labelBackground: getComputedStyle(element).backgroundColor,
      numberStripBackground: getComputedStyle(element, '::before').backgroundColor,
    }))
    expect(weekstripSurface).toEqual({ labelBackground: 'rgba(0, 0, 0, 0)', numberStripBackground: 'rgb(37, 54, 12)' })
    await expect(page.locator('.schedule-v2-period-summary')).toHaveText('1 тренировка · 1 клиент')
    await expect(page.locator('.schedule-v2-day-card').first()).toContainText('Свободный день')
    await expect(page.locator('.schedule-v2-day-card').nth(3)).toContainText('Алексей Смирнов')
    if (account === 'first') {
      const screenshotPath = testInfo.outputPath('fit-lime-schedule-week.png')
      await page.screenshot({ path: screenshotPath, fullPage: true })
      await testInfo.attach('fit-lime-schedule-week', { path: screenshotPath, contentType: 'image/png' })
    }
    await page.getByRole('button', { name: '2 недели', exact: true }).click()
    await expect(page.locator('.schedule-v2-day-card')).toHaveCount(14)
    await page.locator('.schedule-v2-day-card').nth(8).click()
    await expect(page).toHaveURL(/\/today\?date=2026-09-29&week=2026-09-21&range=2w$/)
    await page.reload()
    await expect(page.locator('.fit-lime-today')).toBeVisible()
    await page.getByRole('button', { name: 'Настройки расписания' }).click()
    await page.getByRole('menuitem', { name: 'К 2 неделям' }).click()
    await expect(page.locator('.fit-lime-schedule')).toBeVisible()
    await expect(page.locator('.schedule-v2-day-card')).toHaveCount(14)
  })
}

test('Fit Lime weekstrip fits a 320-pixel phone without clipping days', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await page.clock.setFixedTime(new Date('2026-09-21T12:30:00+03:00'))
  await mockPilot(page, { fitLime: true })
  await page.goto('/schedule?week=2026-09-21')
  await expect(page.locator('.fit-lime-schedule')).toBeVisible()
  const lastDay = await page.locator('.schedule-v2-weekdays button').last().boundingBox()
  expect(lastDay).not.toBeNull()
  expect(lastDay && lastDay.x + lastDay.width <= 320).toBe(true)
  await expect(page.locator('.schedule-v2-weekdays button')).toHaveCount(7)
})

test('trainer without Fit Lime keeps the existing week styling', async ({ page }) => {
  await mockPilot(page)
  await page.goto('/schedule?week=2026-09-21')
  await expect(page.locator('.schedule-v2-weekstrip')).toBeVisible()
  await expect(page.locator('.fit-lime-schedule')).toHaveCount(0)
})

test('non-pilot trainer retains the classic Today and schedule routes', async ({ page }) => {
  await mockPilot(page, { pilot: false, workouts: [] })
  await page.goto('/today')
  await expect(page.locator('.today-page')).toBeVisible()
  await expect(page.locator('.trainer-schedule-v2-shell')).toHaveCount(0)
  await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
  await page.goto('/schedule')
  await expect(page.locator('.schedule-page:not(.schedule-v2)')).toBeVisible()
  await expect(page.locator('.trainer-schedule-v2-shell')).toHaveCount(0)
  await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
})

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
  await expect(page.getByText('Свободный день')).toBeVisible()
  await expect(page.getByRole('button', { name: '0 Незавершённые действия' })).toBeVisible()
  await page.getByRole('button', { name: '0 Незавершённые действия' }).click()
  await expect(page.getByRole('dialog', { name: 'Рабочая очередь' }).getByText('Незавершённых действий нет')).toBeVisible()
})

test('calendar error leaves inbox and action tiles reachable, then retries in place', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
  const backend = await mockPilot(page, { failTrainingData: true })
  await page.goto('/today')
  await expect(page.getByRole('button', { name: /Вопросы и сообщения/ })).toBeVisible()
  await expect(page.getByText('Не удалось загрузить данные')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: /Вопросы и сообщения/ }).click()
  await expect(page.getByRole('dialog', { name: 'Входящие' })).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть входящие' }).click()
  await expect(page.getByRole('button', { name: /Незавершённые действия/ })).toBeVisible()
  backend.setTrainingDataFailure(false)
  await page.getByRole('alert').filter({ hasText: 'Не удалось загрузить данные' }).getByRole('button', { name: 'Повторить' }).click()
  await expect(page.locator('.schedule-v2-timeline')).toBeVisible()
})

test('action queue shows source failure and recovers on retry', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
  const backend = await mockPilot(page, { workouts: [], failClients: true })
  await page.goto('/today')
  await expect(page.getByRole('button', { name: '— Незавершённые действия' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '— Незавершённые действия' }).click()
  const queue = page.getByRole('dialog', { name: 'Рабочая очередь' })
  await expect(queue.getByRole('alert').filter({ hasText: 'Не удалось загрузить действия' })).toBeVisible()
  await expect(queue.getByRole('alert').filter({ hasText: 'Не удалось загрузить планы' })).toBeVisible()
  backend.setClientsFailure(false)
  await queue.getByRole('button', { name: 'Повторить загрузку действий' }).click()
  await expect(page.getByRole('button', { name: '1 Незавершённые действия' })).toBeVisible()
  await expect(queue.getByRole('heading', { name: 'Проверить планы' })).toBeVisible()
})

for (const [account, profileId] of [
  ['first', trainerId],
  ['second', '10000000-0000-4000-8000-000000000010'],
] as const) {
  test(`${account} Fit Lime action queue preserves the selected day in workout navigation`, async ({ page }) => {
    await mockPilot(page, { profileId, fitLime: true, questionWorkout: true })
    await page.goto('/today?date=2026-09-24')
    await page.getByRole('button', { name: /Незавершённые действия/ }).click()
    await expect(page.locator('.fit-lime-action-backdrop')).toBeVisible()
    const action = page.getByRole('dialog', { name: 'Рабочая очередь' }).locator('.schedule-v2-action-row[href]')
    await expect(action).toHaveAttribute('href', `/workouts/${workoutId}?reply=1`)
    await action.click()
    await expect(page).toHaveURL(new RegExp(`/workouts/${workoutId}\\?reply=1$`))
    expect(await page.evaluate(() => (window.history.state as { usr?: { returnTo?: string } } | null)?.usr?.returnTo)).toBe('/today?date=2026-09-24')
    await page.getByRole('button', { name: 'Назад' }).click()
    await expect(page).toHaveURL(/\/today\?date=2026-09-24$/)
  })
}

test('Fit Lime planning action returns to its calendar date', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
  await mockPilot(page, { fitLime: true, workouts: [] })
  await page.goto('/today?date=2026-09-27')
  await page.getByRole('button', { name: '1 Незавершённые действия' }).click()
  await page.getByRole('dialog', { name: 'Рабочая очередь' }).getByRole('link', { name: 'Запланировать' }).click()
  expect(await page.evaluate(() => (window.history.state as { usr?: { returnTo?: string } } | null)?.usr?.returnTo)).toBe('/today?date=2026-09-27')
})

test('trainer without Fit Lime keeps the queue outside the pilot portal scope', async ({ page }) => {
  await mockPilot(page, { workouts: [] })
  await page.goto('/today?date=2026-09-27')
  await page.getByRole('button', { name: /Незавершённые действия/ }).click()
  await expect(page.getByRole('dialog', { name: 'Рабочая очередь' })).toBeVisible()
  await expect(page.locator('.fit-lime-action-backdrop')).toHaveCount(0)
})

for (const [account, profileId] of [
  ['first', trainerId],
  ['second', '10000000-0000-4000-8000-000000000010'],
] as const) {
  test(`${account} Fit Lime inbox list keeps questions, dialogs and calendar return`, async ({ page }, testInfo) => {
    await mockPilot(page, { profileId, fitLime: true, questionWorkout: true })
    await page.goto('/today?date=2026-09-24')
    await page.getByRole('button', { name: /Вопросы и сообщения/ }).click()
    await page.getByRole('link', { name: 'Открыть все сообщения' }).click()
    await expect(page).toHaveURL(/\/chat$/)
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    await expect(page.getByRole('heading', { name: 'Вопросы тренеру' })).toBeVisible()
    await expect(page.getByText('Можно заменить приседания?')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Сообщения', level: 2 })).toBeVisible()
    await expect(page.getByRole('button', { name: /Алексей Смирнов.*Спасибо/ })).toBeVisible()
    if (account === 'first') {
      const screenshotPath = testInfo.outputPath('fit-lime-inbox-list.png')
      await page.screenshot({ path: screenshotPath, fullPage: true })
      await testInfo.attach('fit-lime-inbox-list', { path: screenshotPath, contentType: 'image/png' })
    }
    await page.getByRole('button', { name: 'Назад' }).click()
    await expect(page).toHaveURL(/\/today\?date=2026-09-24$/)
  })
}

test('Fit Lime questions remain visible when dialogs fail, and dialogs recover independently', async ({ page }) => {
  const backend = await mockPilot(page, { fitLime: true, questionWorkout: true, failThreads: true })
  await page.goto('/chat')
  await expect(page.getByText('Можно заменить приседания?')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Сообщения', level: 2 })).toBeVisible()
  await expect(page.getByText('Не удалось загрузить данные')).toBeVisible({ timeout: 15_000 })
  backend.setThreadsFailure(false)
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(page.getByRole('button', { name: /Алексей Смирнов.*Спасибо/ })).toBeVisible()
})

test('Fit Lime dialog remains visible when questions fail', async ({ page }) => {
  await mockPilot(page, { fitLime: true, failWorkspace: true })
  await page.goto('/chat')
  await expect(page.getByRole('alert').filter({ hasText: 'Не удалось загрузить вопросы' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Алексей Смирнов.*Спасибо/ })).toBeVisible()
})

test('trainer without Fit Lime keeps the existing messages list', async ({ page }) => {
  await mockPilot(page)
  await page.goto('/chat')
  await expect(page.getByRole('heading', { name: 'Сообщения', level: 1 })).toBeVisible()
  await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
})

for (const [account, profileId] of [
  ['first', trainerId],
  ['second', '10000000-0000-4000-8000-000000000010'],
] as const) {
  test(`${account} Fit Lime conversation keeps the calendar path and readable composer`, async ({ page }, testInfo) => {
    await mockPilot(page, { profileId, fitLime: true })
    await page.goto('/today?date=2026-09-24')
    await page.getByRole('button', { name: /Вопросы и сообщения/ }).click()
    await page.getByRole('link', { name: 'Открыть все сообщения' }).click()
    await page.getByRole('button', { name: /Алексей Смирнов.*Спасибо/ }).click()
    await expect(page).toHaveURL(new RegExp(`/chat/${conversationId}$`))
    await expect(page.locator('.phone-frame')).toHaveClass(/fit-lime-shell/)
    await expect(page.getByRole('region', { name: 'Переписка' }).getByText('Спасибо!')).toBeVisible()
    await expect(page.locator('.chat-message.partner')).toHaveCSS('background-color', 'rgb(25, 25, 28)')
    await expect(page.getByRole('button', { name: 'Отправить' })).toHaveCSS('background-color', 'rgb(186, 255, 54)')
    if (account === 'first') {
      const screenshotPath = testInfo.outputPath('fit-lime-conversation.png')
      await page.screenshot({ path: screenshotPath, fullPage: true })
      await testInfo.attach('fit-lime-conversation', { path: screenshotPath, contentType: 'image/png' })
    }
    await page.getByRole('button', { name: 'Назад' }).click()
    await expect(page).toHaveURL(/\/chat$/)
    await page.getByRole('button', { name: 'Назад' }).click()
    await expect(page).toHaveURL(/\/today\?date=2026-09-24$/)
  })
}

test('Fit Lime conversation retries a failed send without duplicating the message', async ({ page }) => {
  const backend = await mockPilot(page, { fitLime: true, failFirstChatSend: true })
  await page.goto(`/chat/${conversationId}`)
  await page.getByRole('textbox', { name: 'Сообщение' }).fill('Проверю и отвечу')
  await page.getByRole('button', { name: 'Отправить' }).click()
  await expect(page.locator('.chat-message.own').getByText('Ошибка')).toBeVisible()
  await page.locator('.chat-message.own').getByRole('button', { name: 'Повторить' }).click()
  await expect(page.locator('.chat-message.own').getByText('Проверю и отвечу')).toBeVisible()
  await expect(page.locator('.chat-message.own').getByText('Отправлено')).toBeVisible()
  await expect(page.locator('.chat-message.own')).toHaveCount(1)
  expect(backend.getChatSendAttempts()).toBe(2)
})

test('trainer without Fit Lime keeps the existing conversation styling', async ({ page }) => {
  await mockPilot(page)
  await page.goto(`/chat/${conversationId}`)
  await expect(page.getByRole('region', { name: 'Переписка' }).getByText('Спасибо!')).toBeVisible()
  await expect(page.locator('.fit-lime-shell')).toHaveCount(0)
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

test('action and onboarding sheets keep keyboard focus inside and return it on close', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-27T12:00:00+03:00'))
  await mockPilot(page, { workouts: [] })
  await page.goto('/today')
  const bell = page.getByRole('button', { name: '1 Незавершённые действия' })
  await bell.click()
  const closeQueue = page.getByRole('button', { name: 'Закрыть рабочую очередь' })
  await expect(closeQueue).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('button', { name: 'Напомнить через 2 недели' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(closeQueue).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(bell).toBeFocused()

  const onboarding = page.getByRole('button', { name: 'Установка и уведомления' })
  await onboarding.click()
  const closeOnboarding = page.getByRole('button', { name: 'Закрыть подсказки' })
  await expect(closeOnboarding).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('link', { name: 'Открыть настройки' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(closeOnboarding).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(onboarding).toBeFocused()
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

test('new workout keeps the selected calendar day and returns to its two-week context', async ({ page }) => {
  await mockPilot(page)
  await page.goto('/schedule?week=2026-09-21&range=2w')
  await page.locator('.schedule-v2-day-card').nth(8).click()
  const selectedDay = '/today?date=2026-09-29&week=2026-09-21&range=2w'
  await expect(page).toHaveURL(new RegExp(`${selectedDay.replace('?', '\\?')}$`))
  await page.getByRole('link', { name: 'Запланировать тренировку на 2026-09-29' }).click()
  await expect(page).toHaveURL(/\/workouts\/new\?date=2026-09-29$/)
  await expect(page.getByLabel('Дата')).toHaveValue('2026-09-29')
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page).toHaveURL(new RegExp(`${selectedDay.replace('?', '\\?')}$`))
})

test('direct pilot workout link returns to its dated calendar instead of clients', async ({ page }) => {
  await mockPilot(page)
  await page.goto('/workouts/new?date=2026-09-29')
  await expect(page.getByLabel('Дата')).toHaveValue('2026-09-29')
  await page.getByRole('button', { name: 'Назад' }).click()
  await expect(page).toHaveURL(/\/today\?date=2026-09-29$/)
})

test('failed calendar save preserves the form and retry returns to the selected day once', async ({ page }) => {
  const backend = await mockPilot(page, { failFirstSave: true })
  await page.goto('/today?date=2026-09-29&week=2026-09-21&range=2w')
  await page.getByRole('link', { name: 'Запланировать тренировку на 2026-09-29' }).click()
  await page.locator('.client-picker-trigger').click()
  await page.locator(`.client-picker-item[data-client-id="${clientId}"]`).click()
  await page.getByLabel('Начало').fill('14:00')
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByLabel('Поиск упражнения').fill('присед со штангой')
  await page.getByRole('button', { name: 'Выбрать: Присед со штангой', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await page.getByRole('button', { name: 'Сохранить план' }).click()
  await expect(page.locator('.workout-form .error')).toBeVisible()
  await expect(page.getByLabel('Дата')).toHaveValue('2026-09-29')
  await expect(page.getByLabel('Начало')).toHaveValue('14:00')
  await page.getByRole('button', { name: 'Сохранить план' }).click()
  await expect(page).toHaveURL(/\/today\?date=2026-09-29&week=2026-09-21&range=2w$/)
  await expect(page.locator('.schedule-v2-event')).toHaveCount(1)
  expect(backend.getLastSavedStartTime()).toBe('14:00')
  expect(backend.getSaveAttempts()).toBe(2)
  await page.reload()
  await expect(page.locator('.schedule-v2-event')).toHaveCount(1)
})

test('editing a pilot workout returns to its calendar day with the changed time', async ({ page }) => {
  const backend = await mockPilot(page)
  await page.goto('/today?date=2026-09-24&week=2026-09-21&range=2w')
  await page.locator('.schedule-v2-event').click()
  await page.getByRole('button', { name: 'Понятно' }).click()
  await page.getByRole('link', { name: 'Изменить', exact: true }).click()
  await page.getByLabel('Начало').fill('13:00')
  await page.getByLabel('Окончание').fill('14:00')
  await page.getByRole('button', { name: 'Выбрать упражнения' }).click()
  await page.getByLabel('Поиск упражнения').fill('присед со штангой')
  await page.getByRole('button', { name: 'Выбрать: Присед со штангой', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить 1' }).click()
  await page.getByRole('button', { name: 'Сохранить план' }).click()
  await expect(page).toHaveURL(/\/today\?date=2026-09-24&week=2026-09-21&range=2w$/)
  expect(backend.getLastEditedStartTime()).toBe('13:00')
  await expect(page.locator('.schedule-v2-event')).toHaveCount(1)
})

test('rescheduling refreshes both the former day and the two-week overview', async ({ page }) => {
  await mockPilot(page)
  await page.goto('/today?date=2026-09-24&week=2026-09-21&range=2w')
  await page.locator('.schedule-v2-event').click()
  await page.getByRole('button', { name: 'Выбрать действие' }).click()
  await page.getByRole('button', { name: 'Перенести тренировку' }).click()
  await page.getByLabel('Новая дата').fill('2026-09-29')
  await page.getByRole('button', { name: 'Перенести', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Перенести тренировку' })).toBeHidden()
  await page.locator('.page-back').click()
  await expect(page).toHaveURL(/\/today\?date=2026-09-24&week=2026-09-21&range=2w$/)
  await expect(page.locator('.schedule-v2-event')).toHaveCount(0)
  await page.getByRole('button', { name: 'Настройки расписания' }).click()
  await page.getByRole('menuitem', { name: 'К 2 неделям' }).click()
  await expect(page.locator('.schedule-v2-day-card').nth(8)).toContainText('Алексей Смирнов')
})

test('cancelling a pilot plan updates the day and excludes it from weekly totals', async ({ page }) => {
  await mockPilot(page)
  await page.goto('/today?date=2026-09-24&week=2026-09-21&range=2w')
  await page.locator('.schedule-v2-event').click()
  await page.getByRole('button', { name: 'Выбрать действие' }).click()
  await page.getByRole('button', { name: 'Тренировка не состоялась' }).click()
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await page.locator('.page-back').click()
  await expect(page).toHaveURL(/\/today\?date=2026-09-24&week=2026-09-21&range=2w$/)
  await expect(page.locator('.schedule-v2-event')).toHaveClass(/schedule-event-skipped/)
  await page.getByRole('button', { name: 'Настройки расписания' }).click()
  await page.getByRole('menuitem', { name: 'К 2 неделям' }).click()
  await expect(page.getByText('0 тренировок · 0 клиентов')).toBeVisible()
})

test('short overlapping workouts remain separate tappable cards on mobile and desktop', async ({ page }, testInfo) => {
  const firstId = '10000000-0000-4000-8000-000000000007'
  const secondId = '10000000-0000-4000-8000-000000000008'
  await mockPilot(page, { workouts: [
    { ...workout, id: firstId, clientName: 'Александр Длиннофамильный Первый', startTime: '14:00', endTime: '14:10' },
    { ...workout, id: secondId, clientName: 'Богдан Длиннофамильный Второй', startTime: '14:05', endTime: '14:20' },
  ] })
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport)
    await page.goto('/today?date=2026-09-24')
    const events = page.locator('.schedule-v2-event')
    await expect(events).toHaveCount(2)
    const geometry = await events.evaluateAll((elements) => elements.map((element) => {
      const box = element.getBoundingClientRect()
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, height: box.height }
    }))
    expect(geometry[0]!.height).toBeGreaterThanOrEqual(54)
    expect(geometry[1]!.height).toBeGreaterThanOrEqual(54)
    expect(geometry[0]!.right).toBeLessThanOrEqual(geometry[1]!.left)
    await expect(events.nth(0)).toHaveAttribute('aria-label', /Александр Длиннофамильный Первый/)
    await expect(events.nth(1)).toHaveAttribute('aria-label', /Богдан Длиннофамильный Второй/)
    if (viewport.width === 390) {
      await events.first().scrollIntoViewIfNeeded()
      const screenshotPath = testInfo.outputPath('trainer-schedule-v2-overlap-mobile.png')
      await page.screenshot({ path: screenshotPath, fullPage: true })
      await testInfo.attach('trainer-schedule-v2-overlap-mobile', { path: screenshotPath, contentType: 'image/png' })
    }
  }
  await page.locator('.schedule-v2-event').nth(1).click()
  await expect(page).toHaveURL(new RegExp(`/workouts/${secondId}$`))
})

test('untimed and near-midnight workouts remain reachable at the bottom of the day', async ({ page }) => {
  await mockPilot(page, { workouts: [
    { ...workout, id: '10000000-0000-4000-8000-000000000009', startTime: null, endTime: null },
    { ...workout, id: '10000000-0000-4000-8000-000000000010', startTime: '23:50', endTime: '00:20' },
  ] })
  await page.goto('/today?date=2026-09-24')
  await expect(page.locator('.schedule-v2-untimed').getByText('Без времени', { exact: true })).toBeVisible()
  const late = page.locator('.schedule-v2-event')
  await expect(late).toHaveCount(1)
  await expect(late).toContainText('30 мин')
  const bottom = await late.evaluate((element) => (element as HTMLElement).offsetTop + element.clientHeight)
  const gridHeight = await page.locator('.schedule-v2-timeline .day-grid').evaluate((element) => element.clientHeight)
  expect(gridHeight).toBeGreaterThanOrEqual(bottom)
  await late.scrollIntoViewIfNeeded()
  await expect(late).toBeInViewport()
})

test('live clock refreshes after focus without resetting manual scroll and crosses midnight', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-27T20:59:00.000Z'))
  await mockPilot(page, { workouts: [] })
  await page.goto('/today')
  await expect(page.getByRole('heading', { name: '27 сентября' })).toBeVisible()
  await expect(page.locator('.schedule-v2-now time')).toHaveText('23:59')
  await page.locator('.schedule-v2-timeline').evaluate((element) => { element.scrollTop = 700 })
  await page.clock.setFixedTime(new Date('2026-09-27T20:59:40.000Z'))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('.schedule-v2-now time')).toHaveText('23:59')
  await expect.poll(() => page.locator('.schedule-v2-timeline').evaluate((element) => element.scrollTop)).toBe(700)
  await page.clock.setFixedTime(new Date('2026-09-27T21:01:00.000Z'))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('heading', { name: '28 сентября' })).toBeVisible()
  await expect(page.locator('.schedule-v2-now time')).toHaveText('00:01')
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
