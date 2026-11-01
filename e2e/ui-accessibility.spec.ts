import { nativeSignIn } from './native-local-fixture'
import { expect, test, type Page } from './native-local-fixture'

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
      ['primary text / success surface', contrast('--fg', '--success-surface')],
      ['secondary text / success surface', contrast('--secondary-label-fg', '--success-surface')],
      ['success / success surface', contrast('--success-fg', '--success-surface')],
      ['danger / raised surface', contrast('--danger', '--surface-raised')],
      ['primary text / danger surface', contrast('--fg', '--danger-surface')],
      ['danger / danger surface', contrast('--danger', '--danger-surface')],
      ['primary text / current surface', contrast('--fg', '--neutral-current')],
    ] as const
  })

  for (const [pair, ratio] of results) {
    expect(ratio, `${pair} must meet WCAG AA`).toBeGreaterThanOrEqual(4.5)
  }
}

async function signInClient(page: Page) {
  await page.goto('/auth')
  await nativeSignIn(page, 'client@fit.local')
  await expect(page).toHaveURL(/\/me$/)
}

test('identity palettes keep text and semantic colours at WCAG AA', async ({ page }) => {
  // The native welcome has a fixed dark identity; legal pages expose both shared palettes.
  await page.goto('/legal/terms')
  await expect(page.locator('html')).toHaveClass(/theme-light/)
  await expectTokenContrast(page)

  await page.addInitScript(() => localStorage.setItem('fit.appTheme', 'dark'))
  await page.reload()
  await expect(page.locator('html')).not.toHaveClass(/theme-light/)
  await expectTokenContrast(page)
})

test('identity provides keyboard focus and honours reduced motion', async ({ page }) => {
  await page.goto('/auth')
  const email = page.getByRole('button', { name: 'Продолжить с Yandex ID' })
  // Wait for native session restoration before checking keyboard focus.
  await expect(email).toBeVisible()
  await page.keyboard.press('Tab')
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
      // An absent pseudo-element can report an empty computed duration.
      if (!duration) return 0
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
