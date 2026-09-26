import { expect, test, type Page } from '@playwright/test'

const trainerId = '10000000-0000-4000-8000-000000000001'
const clientId = '10000000-0000-4000-8000-000000000002'
const workoutId = '10000000-0000-4000-8000-000000000003'
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

async function mockPilot(page: Page) {
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
        workouts: [workout],
        attention: [],
        attentionPreferences: [],
        hasMoreWorkouts: false,
        totalWorkouts: 1,
      }
    } else if (url.pathname === '/v1/trainer-workspace') {
      body = {
        summary: {
          pendingActionCount: 3,
          unresolvedQuestionCount: 2,
          unreadChatMessageCount: 4,
          inboxCount: 6,
          updatedAt: '2026-09-24T12:00:00.000Z',
        },
        questions: [{
          workoutId,
          clientId,
          clientName: 'Алексей Смирнов',
          question: 'Можно заменить приседания?',
          askedAt: '2026-09-24T11:30:00.000Z',
        }],
      }
    } else if (url.pathname === '/v1/chat/threads') {
      body = { threads: [{
        conversationId: '10000000-0000-4000-8000-000000000004',
        clientId,
        trainerId,
        partnerUserId: clientId,
        partnerName: 'Алексей Смирнов',
        activeConnection: true,
        lastMessageBody: 'Спасибо!',
        lastMessageAt: '2026-09-24T11:45:00.000Z',
        lastMessageSenderId: clientId,
        unreadCount: 4,
        canMessage: true,
        blockedByMe: false,
        blockedByPartner: false,
      }] }
    } else {
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

test.skip(!process.env.FIT_SCHEDULE_V2_VISUAL, 'Dedicated server-backed pilot harness')

test('renders the single-trainer schedule and combines questions with messages', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockPilot(page)
  await page.goto('/today?date=2026-09-24')

  await expect(page.locator('.trainer-schedule-v2-shell')).toBeVisible()
  await expect(page.getByRole('link', { name: /3 Незавершённые действия/ })).toHaveAttribute('href', '/today?classic=1#trainer-attention')
  await expect(page.getByRole('button', { name: /6 Вопросы и сообщения/ })).toBeVisible()
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

  await page.getByRole('button', { name: /6 Вопросы и сообщения/ }).click()
  await expect(page.getByRole('dialog', { name: 'Входящие' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Вопросы тренеру' })).toBeVisible()
  await expect(page.getByText('Можно заменить приседания?')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Сообщения', level: 3 })).toBeVisible()
  await expect(page.getByText('Спасибо!')).toBeVisible()
  const inboxScreenshotPath = testInfo.outputPath('trainer-schedule-v2-inbox.png')
  await page.screenshot({ path: inboxScreenshotPath, fullPage: true })
  await testInfo.attach('trainer-schedule-v2-inbox', { path: inboxScreenshotPath, contentType: 'image/png' })

  await page.locator('.schedule-v2-timeline').evaluate((element) => { element.scrollTop = 0 })
  await page.getByRole('button', { name: 'Закрыть входящие' }).click()
  await expect.poll(() => page.locator('.schedule-v2-timeline').evaluate((element) => element.scrollTop)).toBe(0)
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
