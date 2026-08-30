import { expect, test, type Page } from '@playwright/test'

async function expectTokenContrast(page: Page) {
  const results = await page.locator('.ui-identity').first().evaluate((element) => {
    const styles = getComputedStyle(element)
    const color = (token: string) => styles.getPropertyValue(token).trim()
    const rgb = (value: string) => {
      const hex = value.replace('#', '')
      if (/^[\da-f]{6}$/i.test(hex)) {
        return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16))
      }
      const match = value.match(/[\d.]+/g)
      if (!match || match.length < 3) throw new Error(`Unsupported colour: ${value}`)
      return match.slice(0, 3).map(Number)
    }
    const luminance = (value: string) => {
      const channels = rgb(value).map((channel) => {
        const normalized = channel / 255
        return normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4
      })
      const [red = 0, green = 0, blue = 0] = channels
      return red * .2126 + green * .7152 + blue * .0722
    }
    const contrast = (foreground: string, background: string) => {
      const first = luminance(color(foreground))
      const second = luminance(color(background))
      return (Math.max(first, second) + .05) / (Math.min(first, second) + .05)
    }
    return [
      ['primary text / background', contrast('--fg', '--bg')],
      ['secondary text / background', contrast('--muted', '--bg')],
      ['secondary text / raised surface', contrast('--secondary-label-fg', '--surface-raised')],
      ['secondary text / field', contrast('--secondary-label-fg', '--surface-sunken')],
      ['primary action', contrast('--mono-on-primary', '--mono-primary')],
      ['success / raised surface', contrast('--success-fg', '--surface-raised')],
      ['danger / raised surface', contrast('--danger', '--surface-raised')],
    ] as const
  })

  for (const [pair, ratio] of results) {
    expect(ratio, `${pair} must meet WCAG AA`).toBeGreaterThanOrEqual(4.5)
  }
}

async function signInClient(page: Page) {
  await page.goto('/auth')
  await page.getByLabel('Email').fill('client@fit.local')
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(/\/me$/)
}

test('identity palettes keep text and semantic colours at WCAG AA', async ({ page }) => {
  await page.goto('/auth')
  await expectTokenContrast(page)

  await page.evaluate(() => localStorage.setItem('fit.appTheme', 'dark'))
  await page.reload()
  await expect(page.locator('.auth-flow-identity')).not.toHaveClass(/theme-light/)
  await expectTokenContrast(page)
})

test('identity provides keyboard focus and honours reduced motion', async ({ page }) => {
  await page.goto('/auth')
  await page.keyboard.press('Tab')
  const email = page.getByLabel('Email')
  await expect(email).toBeFocused()
  const authFocus = await email.evaluate((element) => {
    const styles = getComputedStyle(element)
    return { style: styles.outlineStyle, width: Number.parseFloat(styles.outlineWidth) }
  })
  expect(authFocus.style).not.toBe('none')
  expect(authFocus.width).toBeGreaterThanOrEqual(2)

  await signInClient(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload()
  const motion = await page.locator('.client-home-identity .voice-action-button').evaluate((element) => {
    const toMilliseconds = (value: string) => value.split(',').map((part) => {
      const duration = part.trim()
      return duration.endsWith('ms') ? Number.parseFloat(duration) : Number.parseFloat(duration) * 1000
    })
    const values = [getComputedStyle(element), getComputedStyle(element, '::before')]
    return values.flatMap((styles) => [
      ...toMilliseconds(styles.animationDuration),
      ...toMilliseconds(styles.transitionDuration),
    ])
  })
  expect(Math.max(...motion)).toBeLessThanOrEqual(.01)

  const voiceAction = page.getByRole('button', { name: 'Надиктовать тренировку' })
  await voiceAction.focus()
  await page.keyboard.press('Tab')
  const focused = await page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null
    if (!element || element === document.body) return null
    const styles = getComputedStyle(element)
    return {
      name: element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '',
      outlineStyle: styles.outlineStyle,
      outlineWidth: Number.parseFloat(styles.outlineWidth),
    }
  })
  expect(focused?.name).not.toBe('')
  expect(focused?.outlineStyle).not.toBe('none')
  expect(focused?.outlineWidth).toBeGreaterThanOrEqual(2)
})
