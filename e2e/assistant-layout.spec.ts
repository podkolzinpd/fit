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
                <article class="assistant-workout-user-receipt" data-message-kind="action-result" data-testid="dictation-summary">
                  <details><summary>Диктовка · 3 фрагмента</summary><ol><li>Жим лёжа 3 по 10</li><li>Тяга верхнего блока 3 по 12</li><li>Планка 45 секунд</li></ol></details>
                </article>
                <article class="assistant-message assistant-message-result" data-message-kind="action-result" data-testid="action-result"><div class="assistant-workout-saved"><span>✓</span><div><strong>Тренировка сохранена</strong><small>Антоха</small></div></div></article>
                <div class="assistant-message-error" data-message-kind="error" role="alert" data-testid="message-error"><span>Не удалось получить ответ ассистента.</span><button type="button">Повторить</button></div>
                <article class="assistant-message assistant-message-user" data-message-kind="user" data-testid="short-user-message"><p>Отменить</p></article>
                <article class="assistant-message assistant-message-assistant" data-message-kind="assistant" data-testid="last-message"><p>Хорошо, запись тренировки отменена.</p></article>
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

test('assistant keeps one turn close and separates the next turn', async ({ page }) => {
  for (const width of [390, 430]) {
    for (const theme of ['theme-light', 'theme-dark']) {
      await page.setViewportSize({ width, height: 844 })
      await page.setContent(assistantMarkup())
      await page.locator('html').evaluate((element, nextTheme) => {
        element.setAttribute('class', nextTheme)
        document.querySelector('.phone-frame')?.classList.remove('theme-light', 'theme-dark')
        document.querySelector('.phone-frame')?.classList.add(nextTheme)
      }, theme)

      await page.locator('.assistant-thread').evaluate((element) => {
        const nextUser = document.createElement('article')
        nextUser.className = 'assistant-message assistant-message-user'
        nextUser.dataset.testid = 'next-user-message'
        nextUser.innerHTML = '<p>А теперь перенеси тренировку</p>'
        element.append(nextUser)

        const nextAssistant = document.createElement('article')
        nextAssistant.className = 'assistant-message assistant-message-assistant'
        nextAssistant.dataset.testid = 'next-assistant-message'
        nextAssistant.innerHTML = '<p>На какой день перенести?</p>'
        element.append(nextAssistant)
      })

      const user = await page.getByTestId('short-user-message').boundingBox()
      const assistant = await page.getByTestId('last-message').boundingBox()
      const nextUser = await page.getByTestId('next-user-message').boundingBox()
      const nextAssistant = await page.getByTestId('next-assistant-message').boundingBox()
      expect(user).not.toBeNull()
      expect(assistant).not.toBeNull()
      expect(nextUser).not.toBeNull()
      expect(nextAssistant).not.toBeNull()

      const firstPairGap = assistant!.y - (user!.y + user!.height)
      const betweenTurnsGap = nextUser!.y - (assistant!.y + assistant!.height)
      const secondPairGap = nextAssistant!.y - (nextUser!.y + nextUser!.height)

      expect(firstPairGap).toBeGreaterThanOrEqual(7)
      expect(firstPairGap).toBeLessThanOrEqual(9)
      expect(secondPairGap).toBeGreaterThanOrEqual(7)
      expect(secondPairGap).toBeLessThanOrEqual(9)
      expect(betweenTurnsGap).toBeGreaterThanOrEqual(15)
      expect(betweenTurnsGap).toBeLessThanOrEqual(17)
      expect(betweenTurnsGap).toBeGreaterThan(firstPairGap)
    }
  }
})

test('assistant message types have distinct hierarchy on mobile', async ({ page }) => {
  for (const width of [390, 430]) {
    for (const theme of ['theme-light', 'theme-dark']) {
      await page.setViewportSize({ width, height: 844 })
      await page.setContent(assistantMarkup())
      await page.locator('html').evaluate((element, nextTheme) => {
        element.setAttribute('class', nextTheme)
        document.querySelector('.phone-frame')?.classList.remove('theme-light', 'theme-dark')
        document.querySelector('.phone-frame')?.classList.add(nextTheme)
      }, theme)

      const threadBox = await page.locator('.assistant-thread').boundingBox()
      const user = page.locator('[data-message-kind="user"]')
      const assistant = page.locator('[data-message-kind="assistant"]')
      const result = page.getByTestId('action-result')
      const error = page.getByTestId('message-error')
      const userBox = await user.boundingBox()
      const assistantBox = await assistant.boundingBox()
      const resultBox = await result.boundingBox()
      const errorBox = await error.boundingBox()
      const resultStyle = await result.locator('.assistant-workout-saved').evaluate((element) => {
        const style = getComputedStyle(element)
        return { background: style.backgroundColor, border: style.borderColor }
      })
      const errorStyle = await error.evaluate((element) => {
        const style = getComputedStyle(element)
        return { background: style.backgroundColor, border: style.borderColor, color: style.color }
      })

      expect(threadBox).not.toBeNull()
      expect(userBox).not.toBeNull()
      expect(assistantBox).not.toBeNull()
      expect(resultBox).not.toBeNull()
      expect(errorBox).not.toBeNull()
      expect(Math.abs((userBox!.x + userBox!.width) - (threadBox!.x + threadBox!.width))).toBeLessThanOrEqual(3)
      expect(Math.abs(assistantBox!.x - threadBox!.x)).toBeLessThanOrEqual(3)
      expect(Math.abs(resultBox!.x - threadBox!.x)).toBeLessThanOrEqual(3)
      expect(Math.abs(resultBox!.width - threadBox!.width)).toBeLessThanOrEqual(3)
      expect(Math.abs(errorBox!.x - threadBox!.x)).toBeLessThanOrEqual(3)
      expect(errorBox!.width).toBeLessThanOrEqual(threadBox!.width)
      expect(resultStyle.background).not.toBe('rgba(0, 0, 0, 0)')
      expect(resultStyle.border).not.toBe(errorStyle.border)
      expect(errorStyle.background).not.toBe(resultStyle.background)
      expect(errorStyle.color).not.toBe(await assistant.evaluate((element) => getComputedStyle(element).color))
    }
  }
})

test('assistant keeps retry next to a compact error on mobile', async ({ page }) => {
  for (const width of [390, 430]) {
    for (const theme of ['theme-light', 'theme-dark']) {
      await page.setViewportSize({ width, height: 844 })
      await page.setContent(assistantMarkup())
      await page.locator('html').evaluate((element, nextTheme) => {
        element.setAttribute('class', nextTheme)
        document.querySelector('.phone-frame')?.classList.remove('theme-light', 'theme-dark')
        document.querySelector('.phone-frame')?.classList.add(nextTheme)
      }, theme)

      const thread = await page.locator('.assistant-thread').boundingBox()
      const error = await page.getByTestId('message-error').boundingBox()
      const message = await page.getByTestId('message-error').locator('span').boundingBox()
      const retry = await page.getByTestId('message-error').getByRole('button', { name: 'Повторить' }).boundingBox()

      expect(thread).not.toBeNull()
      expect(error).not.toBeNull()
      expect(message).not.toBeNull()
      expect(retry).not.toBeNull()
      expect(error!.width).toBeLessThan(thread!.width)
      expect(retry!.x).toBeGreaterThanOrEqual(message!.x + message!.width)
      expect(retry!.y).toBeGreaterThanOrEqual(error!.y)
      expect(retry!.y + retry!.height).toBeLessThanOrEqual(error!.y + error!.height)
      expect(retry!.height).toBeGreaterThanOrEqual(40)
    }
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

test('assistant page has no decorative accent glow in light and dark themes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })

  for (const theme of ['theme-light', 'theme-dark']) {
    await page.setContent(assistantMarkup())
    await page.locator('html').evaluate((element, nextTheme) => {
      element.setAttribute('class', nextTheme)
      document.querySelector('.phone-frame')?.classList.remove('theme-light', 'theme-dark')
      document.querySelector('.phone-frame')?.classList.add(nextTheme)
    }, theme)

    const decoration = await page.locator('.assistant-page').evaluate((element) => {
      const style = getComputedStyle(element, '::after')
      return { content: style.content, backgroundImage: style.backgroundImage }
    })

    expect(decoration.content).toBe('none')
    expect(decoration.backgroundImage).toBe('none')
  }
})

test('user messages stay compact, calm and readable on mobile', async ({ page }) => {
  for (const width of [390, 430]) {
    for (const theme of ['theme-light', 'theme-dark']) {
      await page.setViewportSize({ width, height: 844 })
      await page.setContent(assistantMarkup())
      await page.locator('html').evaluate((element, nextTheme) => {
        element.setAttribute('class', nextTheme)
        document.querySelector('.phone-frame')?.classList.remove('theme-light', 'theme-dark')
        document.querySelector('.phone-frame')?.classList.add(nextTheme)
      }, theme)

      const thread = page.locator('.assistant-thread')
      const shortMessage = page.getByTestId('short-user-message')
      await thread.evaluate((element) => {
        const message = document.createElement('article')
        message.className = 'assistant-message assistant-message-user'
        message.dataset.testid = 'long-user-message'
        message.innerHTML = '<p>Запланируй клиенту силовую тренировку на следующую среду вечером</p>'
        element.append(message)
      })

      const threadBox = await thread.boundingBox()
      const shortBox = await shortMessage.boundingBox()
      const longBox = await page.getByTestId('long-user-message').boundingBox()
      const shortStyle = await shortMessage.evaluate((element) => {
        const style = getComputedStyle(element)
        return { backgroundImage: style.backgroundImage, boxShadow: style.boxShadow }
      })

      expect(threadBox).not.toBeNull()
      expect(shortBox).not.toBeNull()
      expect(longBox).not.toBeNull()
      expect(shortBox!.width).toBeLessThan(longBox!.width)
      expect(longBox!.width).toBeLessThanOrEqual(threadBox!.width * 0.75 + 1)
      expect(Math.abs((shortBox!.x + shortBox!.width) - (threadBox!.x + threadBox!.width))).toBeLessThanOrEqual(3)
      expect(Math.abs((longBox!.x + longBox!.width) - (threadBox!.x + threadBox!.width))).toBeLessThanOrEqual(3)
      expect(shortStyle.backgroundImage).toBe('none')
      expect(shortStyle.boxShadow).toBe('none')
    }
  }
})

test('dictation fragments use one compact full-width expandable receipt', async ({ page }) => {
  for (const width of [390, 430]) {
    for (const theme of ['theme-light', 'theme-dark']) {
      await page.setViewportSize({ width, height: 844 })
      await page.setContent(assistantMarkup())
      await page.locator('html').evaluate((element, nextTheme) => {
        element.setAttribute('class', nextTheme)
        document.querySelector('.phone-frame')?.classList.remove('theme-light', 'theme-dark')
        document.querySelector('.phone-frame')?.classList.add(nextTheme)
      }, theme)

      const thread = await page.locator('.assistant-thread').boundingBox()
      const receipt = page.getByTestId('dictation-summary')
      const receiptBox = await receipt.boundingBox()

      expect(thread).not.toBeNull()
      expect(receiptBox).not.toBeNull()
      expect(Math.abs(receiptBox!.x - thread!.x)).toBeLessThanOrEqual(3)
      expect(Math.abs(receiptBox!.width - thread!.width)).toBeLessThanOrEqual(3)
      await expect(receipt.locator('summary')).toHaveText('Диктовка · 3 фрагмента')
      await expect(receipt.locator('li')).toHaveCount(3)
      await expect(receipt.locator('ol')).toBeHidden()
      await receipt.locator('summary').click()
      await expect(receipt.locator('ol')).toBeVisible()
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
