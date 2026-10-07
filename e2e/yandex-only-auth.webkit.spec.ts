import { expect, test } from '@playwright/test'

if (process.env.FIT_YANDEX_E2E_REQUIRED === 'true') {
  for (const name of [
    'VITE_YANDEX_ONLY_AUTH_ENABLED',
    'VITE_YANDEX_NATIVE_REGISTRATION_ENABLED',
    'VITE_YANDEX_APP_SESSION_ENABLED',
    'VITE_YANDEX_MAIN_ROUTING_ENABLED',
  ]) {
    expect(process.env[name], `${name} must be enabled in the required Yandex E2E lane`).toBe('true')
  }
  expect(process.env.VITE_YANDEX_OAUTH_CLIENT_ID).toBeTruthy()
  expect(process.env.VITE_YANDEX_API_BASE_URL).toBe('https://stage.example.test')
}

const legacyRequestCounts = new WeakMap<object, number>()

for (const lime of [false, true]) {
  test(`Yandex trainer display name refreshes in profile and chat (${lime ? 'lime' : 'mono'})`, async ({ page }, testInfo) => {
    test.skip(process.env.VITE_YANDEX_ONLY_AUTH_ENABLED !== 'true'
      || process.env.VITE_YANDEX_MAIN_ROUTING_ENABLED !== 'true', 'Requires the Yandex auth lane.')
    const actorId = '22e49d0a-78ac-4b5c-a2d1-b4c087f1d169'
    const clientId = '33e49d0a-78ac-4b5c-a2d1-b4c087f1d169'
    const trainerId = '11e49d0a-78ac-4b5c-a2d1-b4c087f1d169'
    const conversationId = '44e49d0a-78ac-4b5c-a2d1-b4c087f1d169'
    let displayName = 'Татьяна'
    let connectionsReads = 0
    let failConnections = false
    await page.route('https://stage.example.test/health', (route) => route.fulfill({ json: { status: 'ok' }, headers: {
      'x-fit-request-id': 'synthetic-health', 'access-control-expose-headers': 'x-fit-request-id',
    } }))
    await page.route('https://stage.example.test/v1/**', (route) => {
      const path = new URL(route.request().url()).pathname
      if (path === '/v1/auth/yandex/session') return route.fulfill({ json: {
        accessMode: 'read_write', profile: { id: actorId, firstName: 'Тестовый клиент',
          lastName: null, timezone: 'Europe/Moscow', accountRole: 'client',
          client: { id: clientId, trainerId, fullName: 'Тестовый клиент' },
          experiments: { clientLime: lime, fitLime: false, trainerScheduleV2: false } },
      } })
      if (path === '/v1/legal/acceptance') return route.fulfill({ json: { applicable: true, accepted: true, acceptedAt: '2026-01-01T00:00:00Z' } })
      if (path === '/v1/clients') return route.fulfill({ json: { clients: [{
        id: clientId, canArchive: false, hasAccount: true, fullName: 'Тестовый клиент', canonicalFullName: 'Тестовый клиент',
        gender: null, ageYears: null, ageUpdatedAt: null, heightCm: null, goal: null, note: null,
        currentWeightKg: null, archivedAt: null, version: 1, membershipVersion: null,
      }] } })
      if (path === '/v1/me/finance') return route.fulfill({ json: { finance: { trainers: [] } } })
      if (path === '/v1/chat/conversations') return route.fulfill({ json: { conversationId } })
      if (path === '/v1/connections') {
        connectionsReads += 1
        if (failConnections) return route.fulfill({ status: 403, json: { error: 'forbidden' } })
        return route.fulfill({ json: { memberships: [{ clientId, trainerId, firstName: null, lastName: null,
          displayName, joinedAt: '2026-10-07T10:00:00Z', isRoot: true }], invitations: [] } })
      }
      if (path === '/v1/chat/threads') return route.fulfill({ json: { threads: [{
        conversationId, clientId, trainerId, partnerUserId: trainerId, partnerName: displayName,
        activeConnection: true, lastMessageBody: null, lastMessageAt: null, lastMessageSenderId: null,
        unreadCount: 0, canMessage: true, blockedByMe: false, blockedByPartner: false,
      }] } })
      if (path === `/v1/chat/conversations/${conversationId}/messages`) return route.fulfill({ json: { messages: [], nextCursor: null } })
      if (path === `/v1/chat/conversations/${conversationId}/connection`) return route.fulfill({ json: { state: {
        activeConnection: true, invitationPending: false, invitedAt: null, canInvite: false, canAccept: false, trainerSwitchRequired: false,
      } } })
      if (path === `/v1/chat/conversations/${conversationId}/unread`) return route.fulfill({ json: { unread: { firstMessageId: null, firstCreatedAt: null, unreadCount: 0 } } })
      if (path === '/v1/push/status') return route.fulfill({ json: { subscribed: false } })
      return route.fulfill({ status: 503, json: { error: 'service_unavailable' } })
    })
    await page.addInitScript(() => {
      localStorage.setItem('fit.yandexAppSession.v1', JSON.stringify({ token: 'a'.repeat(43), expiresAt: '2099-01-01T00:00:00Z' }))
    })
    await page.goto('/me/profile')
    await expect(page.locator('.client-trainer-connection-card')).toBeVisible()
    await expect(page.locator('html')).toHaveClass(lime ? /fit-client-lime-document/ : /^(?!.*fit-client-lime-document)/)
    await page.screenshot({ path: testInfo.outputPath('trainer-name-initial.png'), fullPage: true })
    await expect(page.locator('.client-trainer-person strong')).toHaveText('Татьяна')
    for (const width of [390, 430]) {
      await page.setViewportSize({ width, height: 932 })
      await page.screenshot({ path: testInfo.outputPath(`trainer-name-profile-${width}.png`), fullPage: true })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await page.getByRole('link', { name: 'Настройки профиля' }).click()
    await expect(page).toHaveURL(/\/me\/settings$/)
    // URL changes before a cold lazy route commits. Wait until the profile really unmounts.
    await expect(page.locator('.client-trainer-connection-card')).toHaveCount(0)
    displayName = 'Татьяна Александровна Длинное Проверочное Имя'
    await page.goBack()
    await expect(page).toHaveURL(/\/me\/profile$/)
    await expect(page.locator('.client-trainer-person strong')).toHaveText(displayName)
    await page.screenshot({ path: testInfo.outputPath('trainer-name-renamed.png'), fullPage: true })
    expect(connectionsReads).toBeGreaterThan(1)
    await page.getByRole('button', { name: 'Написать' }).click()
    await expect(page.getByRole('heading', { name: displayName, exact: true })).toBeVisible()
    await expect(page.getByText('Напишите первое сообщение.', { exact: true })).toBeVisible()
    await expect(page.locator('.chat-conversation-page .error')).toHaveCount(0)
    for (const width of [390, 430]) {
      await page.setViewportSize({ width, height: 932 })
      await page.screenshot({ path: testInfo.outputPath(`trainer-name-chat-${width}.png`), fullPage: true })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    failConnections = true
    await page.goBack()
    await expect(page.locator('.client-home-connections .error')).toBeVisible()
    failConnections = false
    await page.locator('.client-home-connections').getByRole('button', { name: 'Повторить', exact: true }).click()
    await expect(page.locator('.client-home-connections .error')).toHaveCount(0)
    await expect(page.locator('.client-trainer-person strong')).toHaveText(displayName)
  })
}

test.beforeEach(async ({ page }) => {
  legacyRequestCounts.set(page, 0)
  await page.route(/^https?:\/\/(?:127\.0\.0\.1|localhost):54321(?:\/|$)/, (route) => {
    legacyRequestCounts.set(page, (legacyRequestCounts.get(page) ?? 0) + 1)
    return route.abort('connectionrefused')
  })
})

test.afterEach(({ page }) => {
  expect(legacyRequestCounts.get(page), 'Yandex-only auth must not call local Supabase').toBe(0)
})

test('Yandex workout completion reads personal records once without paginated Progress', async ({ page }) => {
  test.skip(process.env.VITE_YANDEX_ONLY_AUTH_ENABLED !== 'true'
    || process.env.VITE_YANDEX_APP_SESSION_ENABLED !== 'true'
    || process.env.VITE_YANDEX_MAIN_ROUTING_ENABLED !== 'true', 'Requires the Yandex auth lane.')
  const actorId = 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b'
  const clientId = '1a0c5295-0a0f-4ccb-a39a-e58090967245'
  const workoutId = '948d78c7-994c-4c21-b2fe-81efb2091854'
  const exerciseId = 'e2fc2c6d-0f33-4826-af68-46b0a5c79ff4'
  const token = 'a'.repeat(43)
  let recordReads = 0
  let progressReads = 0
  await page.route('https://stage.example.test/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/v1/auth/yandex/session') return route.fulfill({ json: {
      accessMode: 'read_write', profile: { id: actorId, firstName: 'Synthetic trainer',
        lastName: null, timezone: 'Europe/Moscow', accountRole: 'trainer' },
    } })
    if (path === '/v1/legal/acceptance') return route.fulfill({ json: { applicable: true, accepted: true, acceptedAt: '2026-01-01T00:00:00Z' } })
    if (path === '/v1/training-data') return route.fulfill({ json: {
      accessMode: 'read_only', customExercises: [], attention: [], attentionPreferences: [],
      hasMoreWorkouts: false, totalWorkouts: 1, workouts: [{
        id: workoutId, trainerId: actorId, clientId, clientName: 'Synthetic client',
        createdBy: actorId, startedBy: null, completedBy: actorId,
        workoutDate: '2020-01-02', startTime: null, endTime: null, status: 'done',
        notes: null, clientComment: null, sessionRpe: null, wellbeing: null, discomfort: null,
        feedbackSubmittedAt: null, trainerReaction: null, trainerReview: null,
        trainerReviewAuthorId: null, trainerReviewedAt: null, clientQuestion: null,
        clientQuestionAskedAt: null, clientQuestionResolvedAt: null,
        startedAt: null, completedAt: '2020-01-02T12:00:00Z', hasPr: true, version: 1,
        exercises: [{ id: exerciseId, position: 0, source: 'system', ref: 'squat',
          customExerciseId: null, name: 'Приседание', muscleGroup: 'legs', inputKind: 'strength',
          blockId: exerciseId, blockType: 'single', blockPreset: 'set', blockRounds: 1,
          restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 60,
          trainerComment: null, sets: [],
        }],
      }],
    } })
    if (path === `/v1/workouts/${workoutId}/personal-records`) {
      recordReads += 1
      expect(route.request().headers()['x-fit-session']).toBe(token)
      return route.fulfill({ json: { records: [{ exerciseRef: 'squat', exerciseName: 'Приседание',
        inputKind: 'strength', metric: 'weight_reps', primaryValue: 600, weightKg: 60, reps: 10 }] } })
    }
    if (path.includes('/progress/exercises/')) progressReads += 1
    return route.fulfill({ status: 503, json: { error: 'service_unavailable' } })
  })
  await page.addInitScript(({ sessionToken }) => {
    localStorage.setItem('fit.yandexAppSession.v1', JSON.stringify({ token: sessionToken, expiresAt: '2099-01-01T00:00:00Z' }))
    history.replaceState({ usr: { justCompleted: true }, key: 'records-test', idx: 0 }, '')
  }, { sessionToken: token })
  await page.goto(`/workouts/${workoutId}`)
  const completion = page.getByRole('region', { name: 'Тренировка завершена' })
  await expect(completion.getByText('Личный рекорд · Приседание')).toBeVisible()
  await expect(completion.getByText('60 кг × 10 повт.')).toBeVisible()
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 932 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  expect(recordReads).toBe(1)
  expect(progressReads).toBe(0)
})

test('Yandex-only entry has one primary action at 390 and 430 px', async ({ page }, testInfo) => {
  test.skip(
    process.env.VITE_YANDEX_ONLY_AUTH_ENABLED !== 'true'
      || process.env.VITE_YANDEX_NATIVE_REGISTRATION_ENABLED !== 'true'
      || process.env.VITE_YANDEX_APP_SESSION_ENABLED !== 'true'
      || process.env.VITE_YANDEX_MAIN_ROUTING_ENABLED !== 'true',
    'Run with the complete default-off Yandex-only auth switches.',
  )

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 430, height: 932 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto('/auth')

    await expect(page.getByRole('heading', { name: 'Добро пожаловать' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Авторизация через Yandex ID' })).toBeVisible()
    await expect(page.getByText('Вход и регистрация выполняются через Yandex ID.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Продолжить с Yandex ID' })).toHaveClass(/primary/)
    await expect(page.getByLabel('Email')).toHaveCount(0)
    await expect(page.getByLabel('Пароль')).toHaveCount(0)
    await expect(page.getByText('Забыли пароль?')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Создать аккаунт' })).toHaveCount(0)
    await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(`yandex-only-entry-${viewport.width}.png`),
      fullPage: true,
    })

    if (viewport.width === 390) {
      await page.evaluate(() => {
        localStorage.setItem('fit.appTheme', 'dark')
        window.dispatchEvent(new Event('fit-theme-change'))
      })
      await expect(page.locator('html')).not.toHaveClass(/theme-light/)
      await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
      await page.screenshot({
        path: testInfo.outputPath('yandex-only-entry-dark-390.png'),
        fullPage: true,
      })
      await page.evaluate(() => {
        localStorage.setItem('fit.appTheme', 'light')
        window.dispatchEvent(new Event('fit-theme-change'))
      })
    }

    await page.goto('/auth/forgot')
    await expect(page).toHaveURL(/\/auth$/)
  }
})

test('restored Yandex session completes the legal check after reload', async ({ page }) => {
  test.skip(
    process.env.VITE_YANDEX_ONLY_AUTH_ENABLED !== 'true'
      || process.env.VITE_YANDEX_APP_SESSION_ENABLED !== 'true'
      || process.env.VITE_YANDEX_MAIN_ROUTING_ENABLED !== 'true',
    'Run with the complete Yandex-only session switches.',
  )
  const token = 'a'.repeat(43)
  let legalRequests = 0
  await page.route('https://stage.example.test/v1/auth/yandex/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        accessMode: 'read_write',
        profile: {
          id: 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b',
          firstName: 'Ирина',
          lastName: null,
          timezone: 'Europe/Moscow',
          accountRole: 'trainer',
        },
      }),
    })
  })
  await page.route('https://stage.example.test/v1/legal/acceptance', async (route) => {
    legalRequests += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ applicable: true, accepted: false, acceptedAt: null }),
    })
  })
  await page.addInitScript(([sessionToken]) => {
    window.localStorage.setItem('fit.yandexAppSession.v1', JSON.stringify({
      token: sessionToken,
      expiresAt: '2099-09-01T12:00:00.000Z',
    }))
  }, [token])

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Условия обновились' })).toBeVisible()

  await page.reload()

  await expect(page.getByRole('heading', { name: 'Условия обновились' })).toBeVisible()
  await expect(page.getByText('Проверяем документы…')).toHaveCount(0)
  expect(legalRequests).toBe(2)
})

test('Yandex restore exits loading after a network error and offers retry', async ({ page }) => {
  test.skip(
    process.env.VITE_YANDEX_ONLY_AUTH_ENABLED !== 'true'
      || process.env.VITE_YANDEX_APP_SESSION_ENABLED !== 'true'
      || process.env.VITE_YANDEX_MAIN_ROUTING_ENABLED !== 'true',
    'Run with the complete Yandex-only session switches.',
  )
  await page.route('https://stage.example.test/v1/auth/yandex/session', (route) => route.abort('connectionrefused'))
  await page.route('https://stage.example.test/health', (route) => route.abort('connectionrefused'))
  await page.addInitScript(() => {
    window.localStorage.setItem('fit.yandexAppSession.v1', JSON.stringify({
      token: 'a'.repeat(43),
      expiresAt: '2099-09-01T12:00:00.000Z',
    }))
  })
  await page.goto('/')
  await expect(page.locator('.fit-startup-photo')).toHaveCount(0, { timeout: 15_000 })
  await expect(page).toHaveURL(/\/auth$/)
  await expect(page.getByRole('button', { name: /Повторить/ })).toBeVisible()
})

for (const path of ['/', '/auth', '/auth/yandex/session']) {
  test(`photograph bridges bootstrap and session restoration on ${path}`, async ({ page }, testInfo) => {
    test.skip(process.env.VITE_YANDEX_ONLY_AUTH_ENABLED !== 'true', 'Requires Yandex session switches.')
    let releaseSession!: () => void
    const sessionReady = new Promise<void>((resolve) => { releaseSession = resolve })
    let releaseLegal!: () => void
    let legalRequested = false
    const legalReady = new Promise<void>((resolve) => { releaseLegal = resolve })
    await page.route('https://stage.example.test/v1/auth/yandex/session', async (route) => {
      await sessionReady
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          accessMode: 'read_write',
          profile: {
            id: 'd2b80c5e-f60b-42b0-ae3f-308e91bbcb9b',
            firstName: 'Ирина', lastName: null, timezone: 'Europe/Moscow', accountRole: 'trainer',
          },
        }),
      })
    })
    await page.route('https://stage.example.test/v1/legal/acceptance', async (route) => {
      legalRequested = true
      await legalReady
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ applicable: true, accepted: false, acceptedAt: null }),
      })
    })
    await page.addInitScript(() => localStorage.setItem('fit.yandexAppSession.v1', JSON.stringify({
      token: 'a'.repeat(43), expiresAt: '2099-09-01T12:00:00.000Z',
    })))
    try {
      await page.goto(path, { waitUntil: 'domcontentloaded' })
      await expect(page.locator('#fit-startup-shell')).toHaveCount(0)
      const splash = page.getByRole('status', { name: 'Загружаем Fit' })
      await expect(splash).toBeVisible()
      const photo = splash.locator('img')
      await expect(photo).toBeVisible()
      await expect.poll(() => photo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(940)
      await expect(page.getByText(/Восстанавливаем сессию/)).toHaveCount(0)
      await page.screenshot({ path: testInfo.outputPath('session-photo.png') })
      releaseSession()
      await expect.poll(() => legalRequested).toBe(true)
      await expect(splash).toBeVisible()
      await expect(page.getByText('Проверяем документы…')).toHaveCount(0)
      releaseLegal()
      await expect(page.getByRole('heading', { name: 'Условия обновились' })).toBeVisible()
      await expect(page.locator('.fit-startup-photo')).toHaveCount(0)
    } finally {
      releaseSession()
      releaseLegal()
    }
  })
}
