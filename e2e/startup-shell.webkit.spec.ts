import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const recoveryScript = readFileSync(
  new URL('../public/asset-recovery.js', import.meta.url),
  'utf8',
)

for (const viewport of [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 1440, height: 900 },
]) {
  test(`shows the photograph before React at ${viewport.width}px`, async ({ page }, testInfo) => {
    // Keep the application unstarted without leaving a navigation pending:
    // iOS WebKit screenshots may wait for that navigation to finish.
    await page.route('**/src/main.tsx*', (route) => route.fulfill({
      contentType: 'application/javascript', body: '/* application has not started */',
    }))
    await page.setViewportSize(viewport)
    await page.goto('/', { waitUntil: 'load' })
    const photo = page.locator('#fit-startup-shell .fit-startup-photo-image')
    await expect(photo).toBeVisible()
    await expect.poll(() => photo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(940)
    await expect(photo).toHaveCSS('object-fit', viewport.width > viewport.height ? 'contain' : 'cover')
    await expect(page.getByRole('button', { name: 'Обновить приложение' })).toBeHidden()
    await expect(page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).resolves.toBe(true)
    await photo.evaluate((image: HTMLImageElement) => image.decode())
    await page.screenshot({ path: testInfo.outputPath(`startup-photo-${viewport.width}.png`) })
  })
}

test('production stylesheet does not block the photograph or reveal an unstyled app', async ({ page }) => {
  await page.route('**/', async (route) => {
    const response = await route.fetch()
    const html = await response.text()
    await route.fulfill({ response, body: html.replace('</head>',
      '<link rel="stylesheet" href="/assets/startup-test.css" media="print" data-fit-app-styles></head>') })
  })
  let releaseStyles!: () => void
  const stylesReady = new Promise<void>((resolve) => { releaseStyles = resolve })
  await page.route('**/assets/startup-test.css', async (route) => {
    await stylesReady
    await route.fulfill({ contentType: 'text/css', body: '#ready-app { color: rgb(1, 2, 3); }' })
  })
  await page.route('**/src/main.tsx*', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `document.getElementById('root').innerHTML = '<main id="ready-app" style="min-height:100vh">Готово</main>'; window.__fitMarkAppStarted()`,
  }))
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    const photo = page.locator('#fit-startup-shell .fit-startup-photo-image')
    await expect(photo).toBeVisible()
    await photo.evaluate((image: HTMLImageElement) => image.decode())
    // rAF cannot fire while a render-blocking stylesheet is pending.
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
    await expect(page.locator('#fit-startup-shell')).toBeVisible()
    await expect(page.locator('#root')).toHaveAttribute('inert', '')
    releaseStyles()
    await expect(page.locator('#fit-startup-shell')).toHaveCount(0)
    await expect(page.locator('#root')).not.toHaveAttribute('inert')
    await expect(page.locator('#ready-app')).toHaveCSS('color', 'rgb(1, 2, 3)')
  } finally {
    releaseStyles()
  }
})

test('ready styles do not temporarily make mounted form fields inert before the first frame', async ({ page }) => {
  await page.addInitScript(() => { window.requestAnimationFrame = () => 0 })
  await page.route('**/src/main.tsx*', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `document.getElementById('root').innerHTML = '<main style="min-height:100vh"><input aria-label="Email"></main>'; window.__fitMarkAppStarted()`,
  }))
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('#root')).not.toHaveAttribute('inert')
  await page.getByLabel('Email').fill('fixture@example.test')
  await expect(page.getByLabel('Email')).toHaveValue('fixture@example.test')
})

test('missing photograph leaves a readable loading fallback, not an application error', async ({ page }) => {
  await page.route('**/src/main.tsx*', () => undefined)
  await page.route('**/assets/startup-photo-*.jpg', (route) => route.abort())
  await page.goto('/', { waitUntil: 'commit' })
  await expect(page.locator('#fit-startup-shell .fit-startup-photo-image')).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Открываем Fit…' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Обновить приложение' })).toBeHidden()
})

for (const failure of ['error', 'timeout']) {
  test(`nonblocking production CSS ${failure} preserves recovery`, async ({ page }) => {
    await page.addInitScript(() => {
      ;(window as Window & { __fitStartupTimeoutMs?: number }).__fitStartupTimeoutMs = 500
    })
    await page.route('**/', async (route) => {
      const response = await route.fetch()
      await route.fulfill({ response, body: (await response.text()).replace('</head>',
        '<link rel="stylesheet" href="/assets/startup-test.css" media="print" data-fit-app-styles></head>') })
    })
    await page.route('**/assets/startup-test.css', (route) => failure === 'error' ? route.abort() : undefined)
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'Не удалось открыть Fit' })).toBeVisible()
    await expect(page.locator('#fit-startup-shell .fit-startup-photo-image')).toBeHidden()
    await expect(page.getByRole('button', { name: 'Обновить приложение' })).toBeVisible()
  })
}

test('не оставляет белый экран, если основной модуль приложения не загрузился', async ({ page }) => {
  // Повторяем production-контракт: запрос удалённого hashed bundle получает
  // стабильный recovery-модуль, который один раз обновляет документ без кеша.
  await page.route('**/src/main.tsx*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: recoveryScript,
  }))
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  await expect(page.getByRole('heading', { name: 'Не удалось открыть Fit' })).toBeVisible()
  await expect(page.getByText('Ваши данные и тренировки сохранены.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Обновить приложение' })).toBeVisible()
  await expect(page.locator('#fit-startup-shell .fit-startup-photo-image')).toBeHidden()
  await expect(page).toHaveURL(/fit-recover=\d+/)
})

test('убирает стартовый экран после успешного запуска приложения', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  await expect(page.locator('#fit-startup-title')).toHaveCount(0)
  await expect(page.locator('.fit-startup-photo')).toHaveCount(0)
})

test('не оставляет белый экран, если модуль запустился, а интерфейс не отрисовался', async ({ page }) => {
  await page.route('**/src/main.tsx*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: [
      "document.getElementById('root').replaceChildren()",
      'window.__fitMarkAppStarted?.()',
    ].join(';'),
  }))
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  await expect(page.locator('#root')).toBeEmpty()
  await expect(page.locator('#fit-startup-shell .fit-startup-photo-image')).toBeVisible()
})

test('показывает восстановление, если таблица стилей зависла до запуска приложения', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as Window & { __fitStartupTimeoutMs?: number }).__fitStartupTimeoutMs = 100
  })
  await page.route('**/src/styles.css*', () => undefined)

  await page.goto('/', { waitUntil: 'commit' })

  await expect(page.getByRole('heading', { name: 'Не удалось открыть Fit' })).toBeVisible()
  await expect(page.getByText('Ваши данные и тренировки сохранены.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Обновить приложение' })).toBeVisible()
})
