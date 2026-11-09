import { expect, test, nativeRequest, nativeRegister, nativeSignIn, nativeEnableLime, type Page } from './native-local-fixture'

type SavedWorkout = { id: string; clientId: string; trainerId: string; createdBy: string | null; status: string; actualDurationSec: number | null; exercises: unknown[] }
async function readHistory(page: Page): Promise<SavedWorkout[]> {
  const response = await nativeRequest(page, '/v1/training-data?scope=workouts&limit=100')
  expect(response.ok).toBe(true)
  return (await response.json() as { workouts: SavedWorkout[] }).workouts
}

test('personal QR link survives registration and mutual consent; history survives reconnection', async ({ page, browser }, info) => {
  test.setTimeout(90_000)
  const athleteContext = await browser.newContext({ baseURL: String(info.project.use.baseURL), viewport: { width: 390, height: 844 } })
  try {
    await nativeSignIn(page, 'registration-trainer@example.test', 'trainer', 'Тренер История')
    await page.goto('/connect')
    await expect(page.getByRole('button', { name: 'Пригласить', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Мой QR', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Отправить ссылку', exact: true })).toBeVisible()
    const sharedLink = await page.getByLabel('Ссылка для подключения').inputValue()
    const share = { code: new URL(sharedLink).searchParams.get('code')! }
    expect(share.code).toMatch(/^[A-F0-9]{16}$/)
    const before = await nativeRequest(page, '/v1/clients')
    expect(before.ok).toBe(true)
    expect((await before.json() as { clients: unknown[] }).clients).toHaveLength(0)

    const athlete = await athleteContext.newPage()
    await athlete.goto(`/connect?code=${share.code}`)
    await expect(athlete).toHaveURL(/\/auth$/)
    await expect(athlete.getByText('Войдите, чтобы продолжить по приглашению.')).toBeVisible()
    // The fixture supplies a new verified identity; the real auth continuation must retain the invitation.
    await nativeRegister(athlete, { key: 'registration-athlete@example.test', firstName: 'Анна Спортсмен', role: 'client' })
    await expect(athlete).toHaveURL(new RegExp(`/connect\\?code=${share.code}$`))
    await expect(athlete.getByText('Тренер История', { exact: true })).toBeVisible()
    await athlete.getByRole('button', { name: 'Добавить', exact: true }).click()
    await expect(athlete.getByText('Запрос отправлен. Ждём подтверждения.')).toBeVisible()
    const pending = await nativeRequest(page, '/v1/connection-directory', { method: 'POST', body: { action: 'list' } })
    const requestId = (await pending.json() as { result: { id: string; status: string }[] }).result.find(item => item.status === 'pending')!.id
    const acceptedStatus = athlete.waitForResponse(async response => {
      if (new URL(response.url()).pathname !== '/v1/connection-directory' || response.request().method() !== 'POST') return false
      const command = response.request().postDataJSON() as { action?: string }
      return command.action === 'status' && (await response.json() as { result: { status: string } }).result.status === 'accepted'
    })
    expect((await nativeRequest(page, '/v1/connection-directory', { method: 'POST', body: { action: 'accept', requestId, expectedRelationshipId: null, expectedRevision: null } })).ok).toBe(true)
    await athlete.bringToFront()
    await acceptedStatus
    await expect(athlete.getByText('Вы подключены', { exact: true })).toBeVisible()
    await page.goto('/clients')
    await expect(page.locator('.client-card-copy strong', { hasText: 'Анна Спортсмен' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Принять', exact: true })).toHaveCount(0)
    const clients = await nativeRequest(page, '/v1/clients')
    const records = (await clients.json() as { clients: { id: string; hasAccount: boolean; canCreateWorkout: boolean }[] }).clients
    expect(records).toHaveLength(1)
    expect(records[0]!.hasAccount).toBe(true)
    expect(records[0]!.canCreateWorkout).toBe(true)
    const clientId = records[0]!.id
    const draft = {
      clientId, workoutDate: '2026-11-07', trainingFormat: 'with_trainer', actualDurationSec: 120,
      exercises: [{ position: 0, source: 'system', ref: 'bulgarian-split-squat', customExerciseId: null,
        name: 'Болгарский сплит-присед со штангой', muscleGroup: 'legs', inputKind: 'strength',
        blockId: '60000000-0000-4000-8000-000000000001', blockType: 'single', blockPreset: 'set', blockRounds: 1,
        restBetweenExercisesSec: 0, restBetweenRoundsSec: 0, restBetweenSetsSec: 90, trainerComment: null,
        sets: [{ position: 0, weightKg: 45, reps: 9 }],
      }],
    }
    const workout = await nativeRequest(page, '/v1/workouts/completed', { method: 'POST', body: draft })
    expect(workout.ok).toBe(true)
    const workoutId = (await workout.json() as { workout: { id: string } }).workout.id
    const saved = (await readHistory(page)).find(item => item.id === workoutId)!
    expect(saved.status).toBe('done')
    expect((await readHistory(athlete)).find(item => item.id === workoutId)).toEqual(saved)

    await athlete.goto('/me/profile')
    await athlete.getByRole('button', { name: 'Действия с тренером Тренер История' }).click()
    await athlete.getByRole('menuitem', { name: 'Отключить', exact: true }).click()
    await athlete.getByRole('alertdialog').getByRole('button', { name: 'Отключить', exact: true }).click()
    await expect(athlete.getByText('Тренер отключён. Ваш аккаунт, тренировки, замеры и цели сохранены.')).toBeVisible()
    expect((await readHistory(athlete)).find(item => item.id === workoutId)).toEqual(saved)
    const denied = await nativeRequest(page, '/v1/workouts/completed', { method: 'POST', body: draft })
    expect(denied.ok).toBe(false)
    expect([403, 409]).toContain(denied.status)

    await page.goto('/connect')
    await page.getByLabel('Почта или Fit-код').fill('registration-athlete@example.test')
    await page.getByRole('button', { name: 'Найти', exact: true }).click()
    await page.getByRole('button', { name: 'Добавить', exact: true }).click()
    await athlete.goto('/connect')
    await athlete.getByRole('button', { name: 'Принять', exact: true }).click()
    await athlete.getByRole('button', { name: 'Подключить тренера', exact: true }).click()
    await expect(athlete.getByRole('region', { name: 'Запросы на подключение' }).getByText('Вы подключены', { exact: true })).toBeVisible()
    for (const viewer of [page, athlete]) {
      const history = (await readHistory(viewer)).filter(item => item.id === workoutId)
      expect(history).toEqual([saved])
      const response = await nativeRequest(viewer, '/v1/connections')
      expect(response.ok).toBe(true)
      expect((await response.json() as { memberships: { clientId: string }[] }).memberships.filter(item => item.clientId === clientId)).toHaveLength(1)
    }
    await page.screenshot({ path: info.outputPath('simple-add.png'), fullPage: true })
  } finally { await athleteContext.close() }
})

test('athlete shares previous trainer history at connection and revokes it in My trainer', async ({ page, browser }, info) => {
  test.setTimeout(90_000)
  const context = await browser.newContext({ baseURL: String(info.project.use.baseURL), viewport: { width: 390, height: 844 } })
  const nextContext = await browser.newContext({ baseURL: String(info.project.use.baseURL) })
  const command = async (who: Page, action: string, data = {}) => {
    const response = await nativeRequest(who, '/v1/connection-directory', { method: 'POST', body: { action, ...data } })
    expect(response.ok).toBe(true)
    return (await response.json() as { result: Record<string, unknown> }).result
  }
  try {
    await nativeSignIn(page, 'history-first@example.test', 'trainer', 'Первый тренер')
    const athlete = await context.newPage(), next = await nextContext.newPage()
    await nativeEnableLime(athlete, 'client')
    await nativeEnableLime(next, 'trainer')
    await nativeSignIn(athlete, 'history-athlete@example.test', 'client', 'История спортсмена')
    await nativeSignIn(next, 'history-next@example.test', 'trainer', 'Новый тренер')
    const first = await command(page, 'self'), second = await command(next, 'self'), athleteSelf = await command(athlete, 'self')
    const firstPreview = await command(athlete, 'preview', { peerId: first.fitId })
    const request = await command(athlete, 'send', { peerId: first.fitId, ...firstPreview })
    await command(page, 'accept', { requestId: request.id, expectedRelationshipId: null, expectedRevision: null })
    const clients = await nativeRequest(page, '/v1/clients')
    const clientId = (await clients.json() as { clients: { id: string }[] }).clients[0]!.id
    const completed = await nativeRequest(page, '/v1/workouts/completed', { method: 'POST', body: {
      clientId, workoutDate: '2026-01-05', actualDurationSec: 600, exercises: [],
    } })
    expect(completed.ok).toBe(true)
    const workoutId = (await completed.json() as { workout: { id: string } }).workout.id
    await athlete.goto(`/connect?code=${String(second.code)}`)
    if (process.env.FIT_CLIENT_LIME_ACCEPTANCE === '1') await expect(athlete.locator('.phone-frame')).toHaveClass(/fit-client-lime/)
    const choice = athlete.getByRole('switch', { name: 'Вся история тренировок' })
    await expect(choice).not.toBeChecked()
    for (const width of [390, 430]) {
      await athlete.setViewportSize({ width, height: 932 })
      await expect(athlete.locator('body')).toHaveJSProperty('scrollWidth', width)
      for (const theme of ['light', 'dark']) {
        await athlete.evaluate(({ value, userId }) => { localStorage.setItem('fit.appTheme', value); localStorage.setItem(`fit.clientLime.theme.${userId}`, value); window.dispatchEvent(new Event('fit-theme-change')); window.dispatchEvent(new Event('fit-client-lime-theme-change')) }, { value: theme, userId: String(athleteSelf.fitId) })
        await athlete.screenshot({ path: info.outputPath(`history-consent-${width}-${theme}.png`), fullPage: true })
      }
      await athlete.evaluate(userId => { localStorage.setItem('fit.appTheme', 'light'); localStorage.setItem(`fit.clientLime.theme.${userId}`, 'light'); window.dispatchEvent(new Event('fit-theme-change')); window.dispatchEvent(new Event('fit-client-lime-theme-change')) }, String(athleteSelf.fitId))
    }
    await choice.check()
    await athlete.getByRole('button', { name: 'Сменить тренера', exact: true }).click()
    await expect(athlete.getByText('Запрос отправлен. Ждём подтверждения.')).toBeVisible()
    const requests = await nativeRequest(next, '/v1/connection-directory', { method: 'POST', body: { action: 'list' } })
    const incoming = (await requests.json() as { result: { id: string; status: string }[] }).result.find(item => item.status === 'pending')!
    await command(next, 'accept', { requestId: incoming.id, expectedRelationshipId: null, expectedRevision: null })
    const shared = (await readHistory(next)).find(item => item.id === workoutId)
    expect(shared?.createdBy).toBe(first.fitId)
    await next.goto(`/workouts/${workoutId}`)
    await next.getByText('Сводка тренировки', { exact: true }).click()
    await expect(next.getByText('10 мин', { exact: true })).toBeVisible()
    await expect(next.getByRole('button', { name: 'Изменить длительность' })).toHaveCount(0)
    await athlete.goto('/me/profile')
    const access = athlete.getByRole('switch', { name: 'Вся история тренировок' })
    await expect(access).toBeChecked()
    await athlete.screenshot({ path: info.outputPath('history-access-profile.png'), fullPage: true })
    await athlete.locator('[aria-label="Доступ тренера к истории"]').screenshot({ path: info.outputPath('history-access-controls.png') })
    await access.click()
    await expect(athlete.getByText('Доступ к истории закрыт', { exact: true })).toBeVisible()
    expect((await readHistory(next)).find(item => item.id === workoutId)).toBeUndefined()
    expect((await readHistory(page)).find(item => item.id === workoutId)?.createdBy).toBe(first.fitId)
    expect((await readHistory(athlete)).find(item => item.id === workoutId)?.createdBy).toBe(first.fitId)
  } finally { await context.close(); await nextContext.close() }
})
