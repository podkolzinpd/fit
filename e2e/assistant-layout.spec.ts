import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'

const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')

function assistantMarkup() {
  return `<!doctype html>
    <html class="theme-light">
      <head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles}</style></head>
      <body><div id="root">
        <div class="phone-frame theme-light assistant-shell">
          <div class="content">
            <main class="assistant-page">
              <section class="assistant-session-switcher"><div class="assistant-session-bar"><strong>Сегодня</strong></div></section>
              <section class="assistant-thread">
                <article class="assistant-message assistant-message-user"><p>Отменить</p></article>
                <article class="assistant-message assistant-message-assistant" data-testid="last-message"><p>Хорошо, запись тренировки отменена.</p></article>
              </section>
              <form class="assistant-composer" data-testid="composer">
                <textarea aria-label="Сообщение ассистенту" placeholder="Опишите тренировку"></textarea>
                <button class="assistant-icon-button" type="button">М</button>
                <button class="assistant-icon-button" type="button">→</button>
              </form>
            </main>
          </div>
          <nav class="tab-bar trainer-tab-bar" data-testid="tabbar"><a>Сегодня</a><a>Клиенты</a><a>Ассистент</a><a>Расписание</a></nav>
        </div>
      </div></body>
    </html>`
}

test('mobile assistant pins the conversation tail and composer above the tab bar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.setContent(assistantMarkup())

  const composer = await page.getByTestId('composer').boundingBox()
  const message = await page.getByTestId('last-message').boundingBox()
  const tabbar = await page.getByTestId('tabbar').boundingBox()

  expect(composer).not.toBeNull()
  expect(message).not.toBeNull()
  expect(tabbar).not.toBeNull()
  expect(tabbar!.y - (composer!.y + composer!.height)).toBeLessThanOrEqual(16)
  expect(composer!.y - (message!.y + message!.height)).toBeLessThanOrEqual(24)
})

test('assistant aligns user and assistant messages by role', async ({ page }) => {
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    await page.setContent(assistantMarkup())

    const thread = await page.locator('.assistant-thread').boundingBox()
    const userMessage = await page.locator('.assistant-message-user').boundingBox()
    const assistantMessage = await page.locator('.assistant-message-assistant').boundingBox()

    expect(thread).not.toBeNull()
    expect(userMessage).not.toBeNull()
    expect(assistantMessage).not.toBeNull()
    expect(Math.abs((userMessage!.x + userMessage!.width) - (thread!.x + thread!.width))).toBeLessThanOrEqual(3)
    expect(Math.abs(assistantMessage!.x - thread!.x)).toBeLessThanOrEqual(3)
  }
})

test('assistant composer stays contained and keeps accessible controls on mobile', async ({ page }) => {
  for (const width of [390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    await page.setContent(assistantMarkup())

    const composer = await page.getByTestId('composer').boundingBox()
    const textarea = await page.getByRole('textbox', { name: 'Сообщение ассистенту' }).boundingBox()
    const buttons = await page.locator('.assistant-composer .assistant-icon-button').all()

    expect(composer).not.toBeNull()
    expect(textarea).not.toBeNull()
    expect(composer!.x).toBeGreaterThanOrEqual(16)
    expect(width - (composer!.x + composer!.width)).toBeGreaterThanOrEqual(16)
    expect(textarea!.x).toBeGreaterThanOrEqual(composer!.x)
    expect(textarea!.x + textarea!.width).toBeLessThanOrEqual(composer!.x + composer!.width)

    for (const button of buttons) {
      const box = await button.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.width).toBeGreaterThanOrEqual(44)
      expect(box!.height).toBeGreaterThanOrEqual(44)
      expect(box!.x + box!.width).toBeLessThanOrEqual(composer!.x + composer!.width)
    }
  }
})

test('mobile assistant pins the composer to the shrunken keyboard viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.setContent(assistantMarkup())
  await page.locator('html').evaluate((element) => {
    element.classList.add('app-keyboard-open')
    element.style.setProperty('--app-visible-height', '508px')
    element.style.setProperty('--app-viewport-height', '844px')
    element.style.setProperty('--app-viewport-offset-top', '336px')
  })
  await page.locator('.phone-frame').evaluate((element) => element.classList.add('keyboard-open'))

  const composer = await page.getByTestId('composer').boundingBox()
  const message = await page.getByTestId('last-message').boundingBox()
  const frame = await page.locator('.phone-frame').boundingBox()

  expect(composer).not.toBeNull()
  expect(message).not.toBeNull()
  expect(frame).not.toBeNull()
  expect(frame!.y).toBe(336)
  expect(frame!.y + frame!.height - (composer!.y + composer!.height)).toBeLessThanOrEqual(8)
  expect(composer!.x).toBeGreaterThanOrEqual(16)
  expect(390 - (composer!.x + composer!.width)).toBeGreaterThanOrEqual(16)
  expect(composer!.y - (message!.y + message!.height)).toBeLessThanOrEqual(24)
  await expect(page.getByTestId('tabbar')).toBeHidden()
})
