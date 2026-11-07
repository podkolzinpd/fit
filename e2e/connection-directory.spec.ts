import QRCode from 'qrcode'
import { expect, test, nativeRequest, nativeSignIn } from './native-local-fixture'

test('personal QR finds the trainer; both parties confirm using the real local API', async ({ page, browser }, info) => {
  await nativeSignIn(page, 'trainer-directory@example.test', 'trainer', 'Тренер Тест')
  await page.goto('/connect')
  await page.getByRole('button', { name: 'Мой QR', exact: true }).click()
  await expect(page.getByAltText('Мой QR для подключения в Fit')).toBeVisible()
  const own: unknown = await (await nativeRequest(page, '/v1/connection-directory', { method: 'POST', body: { action: 'self' } })).json()
  if (!own || typeof own !== 'object' || !('result' in own) || !own.result || typeof own.result !== 'object' || !('code' in own.result) || typeof own.result.code !== 'string') throw new Error('Invalid test locator')
  const trainerLink = `${new URL(page.url()).origin}/connect?code=${own.result.code}`
  const qr = await QRCode.toDataURL(trainerLink, { width: 400, margin: 4 })
  const athleteContext = await browser.newContext({ baseURL: String(info.project.use.baseURL), viewport: { width: 390, height: 844 } })
  try {
    await athleteContext.addInitScript(data => {
      navigator.mediaDevices.getUserMedia = async () => {
        const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 400
        const image = new Image(); image.src = data
        await image.decode()
        const stream = canvas.captureStream(0)
        const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack
        const timer = setInterval(() => {
          canvas.getContext('2d')!.drawImage(image, 0, 0)
          track.requestFrame()
        }, 100)
        track.addEventListener('ended', () => clearInterval(timer), { once: true })
        return stream
      }
    }, qr)
    const athlete = await athleteContext.newPage()
    await nativeSignIn(athlete, 'athlete-directory@example.test', 'client', 'Спортсмен Тест')
    await athlete.goto('/connect')
    await expect(athlete.getByText('Тренер Тест', { exact: true })).toBeVisible()
    await athlete.getByRole('button', { name: 'Хочу заниматься', exact: true }).click()
    await expect(athlete.getByText('Запрос отправлен. Ждём подтверждения.')).toBeVisible()
    await page.goto('/clients')
    await expect(page.getByRole('region', { name: 'Запросы на подключение' }).getByText('Спортсмен Тест')).toBeVisible()
    await page.getByRole('button', { name: 'Посмотреть', exact: true }).click()
    await page.getByRole('button', { name: 'Принять', exact: true }).click()
    await expect(page.getByText('Вы подключены', { exact: true })).toBeVisible()
    await expect(page.locator('.client-card-copy strong', { hasText: 'Спортсмен Тест' })).toBeVisible()
    await expect(athlete.getByText('Вы подключены', { exact: true })).toBeVisible({ timeout: 10_000 })
    await athlete.goto('/me/profile')
    await expect(athlete.getByRole('region', { name: 'Связь с тренером' }).getByText('Тренер Тест', { exact: true })).toBeVisible()
    await athlete.screenshot({ path: info.outputPath('athlete-connected.png'), fullPage: true })
  } finally { await athleteContext.close() }
})

test('exact email finds an existing athlete; trainer proposal needs athlete confirmation', async ({ page, browser }, info) => {
  const athleteContext = await browser.newContext({ baseURL: String(info.project.use.baseURL), viewport: { width: 390, height: 844 } })
  try {
    const athlete = await athleteContext.newPage()
    await nativeSignIn(athlete, 'search-athlete@example.test', 'client', 'Спортсмен Поиск')
    await nativeSignIn(page, 'search-trainer@example.test', 'trainer', 'Тренер Поиск')
    await page.goto('/connect')
    await page.getByRole('button', { name: 'Найти по почте или ввести код' }).click()
    await page.getByLabel('Почта или Fit-код').fill('search-athlete@example.test')
    await page.getByRole('button', { name: 'Найти', exact: true }).click()
    await expect(page.getByText('Спортсмен Поиск', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Предложить подключение', exact: true }).click()
    await expect(page.getByText('Запрос отправлен. Ждём подтверждения.')).toBeVisible()
    await page.screenshot({ path: info.outputPath('trainer-pending.png'), fullPage: true })
    await athlete.goto('/connect?code=0000000000000000')
    await athlete.getByRole('button', { name: 'Посмотреть', exact: true }).click()
    await athlete.getByRole('button', { name: 'Принять', exact: true }).click()
    await expect(athlete.getByText('Вы подключены', { exact: true })).toBeVisible()
    await expect(page.getByText('Вы подключены', { exact: true })).toBeVisible({ timeout: 10_000 })
    await page.goto('/clients')
    await expect(page.locator('.client-card-copy strong', { hasText: 'Спортсмен Поиск' })).toBeVisible()
    expect(await page.locator('body').evaluate(body => body.scrollWidth > window.innerWidth + 1)).toBe(false)
  } finally { await athleteContext.close() }
})
