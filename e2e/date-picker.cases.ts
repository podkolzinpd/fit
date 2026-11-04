import { expect, test, type Page } from '@playwright/test'

// Desktop WebKit has zero OS insets. Substitute env() inputs in existing CSS
// declarations, without adding/replacing the production geometry rules.
async function safeArea(page: Page) {
  await page.evaluate(() => {
    function visit(rules: CSSRuleList) {
      for (const rule of rules) {
        if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules)
        if (!('style' in rule)) continue
        const style = (rule as CSSStyleRule).style
        for (const name of Array.from(style)) {
          const value = style.getPropertyValue(name)
          if (!value.includes('safe-area-inset-')) continue
          style.setProperty(name, value.replace(/env\(safe-area-inset-(top|bottom|left|right)(?:,[^)]*)?\)/g,
            (_, side: string) => side === 'top' ? '47px' : side === 'bottom' ? '34px' : '0px'), style.getPropertyPriority(name))
        }
      }
    }
    for (const sheet of Array.from(document.styleSheets)) visit(sheet.cssRules)
  })
}

export function datePickerCases() {
  // Status dots need theme contrast and must fit outside the selected marker.
  for (const theme of ['light', 'dark']) {
    test(`date picker workout dots: ${theme}`, async ({ page }, info) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(`/e2e/fixtures/date-picker.html?variant=client&theme=${theme}&marks`)
      await page.getByRole('button', { name: 'Выбрать дату', exact: true }).click()
      const planned = page.getByRole('button', { name: '2 ноября 2026 г.' })
      const done = page.getByRole('button', { name: '3 ноября 2026 г.' })
      await expect(planned).toHaveAttribute('aria-pressed', 'true')
      const geometry = await planned.evaluate(button => {
        const dot = getComputedStyle(button, '::after')
        const marker = button.firstElementChild!.getBoundingClientRect()
        const day = button.getBoundingClientRect()
        return { width: dot.width, color: dot.backgroundColor, bottom: day.bottom, markerBottom: marker.bottom }
      })
      expect(geometry.width).toBe('4px')
      expect(geometry.bottom - geometry.markerBottom).toBeGreaterThanOrEqual(4)
      expect(await done.evaluate(button => getComputedStyle(button, '::after').backgroundColor)).not.toBe(geometry.color)
      await done.click()
      await expect(done).toHaveAttribute('aria-pressed', 'true')
      await expect(done).toHaveAttribute('data-workout-mark', 'done')
      await page.screenshot({ path: info.outputPath(`dots-${theme}.png`) })
      await page.getByRole('button', { name: 'Применить дату' }).click()
      await expect(page.locator('output')).toContainText('2026-11-03')
    })
  }
  // Different compositions own different header/padding/height rules. Both
  // client themes matter; trainer keeps its approved dark identity.
  for (const variant of ['trainer', 'reference', 'client-dark', 'client-light']) {
    test(`date picker safe area and stationary header: ${variant}`, async ({ page }, info) => {
      await page.setViewportSize({ width: 393, height: 853 })
      const forbidden: string[] = []
      await page.route('**/*', route => {
        const url = new URL(route.request().url())
        if (!['localhost', '127.0.0.1'].includes(url.hostname) || /\/api\/|\/v1\//.test(url.pathname) || route.request().method() !== 'GET') {
          forbidden.push(url.pathname)
          return route.abort()
        }
        return route.continue()
      })
      const client = variant.startsWith('client')
      await page.goto(`/e2e/fixtures/date-picker.html?variant=${client ? 'client' : variant}&theme=${variant.endsWith('light') ? 'light' : 'dark'}${client ? '&time' : ''}`)
      const trigger = page.getByRole('button', { name: client ? 'Выбрать дату и время' : 'Выбрать дату', exact: true })
      await trigger.click()
      await page.evaluate(() => document.fonts.ready)
      await safeArea(page)
      const dialog = page.getByRole('dialog')
      const close = dialog.getByRole('button', { name: 'Закрыть календарь', exact: true })
      const confirm = dialog.getByRole('button', { name: 'Применить дату', exact: true })
      const months = dialog.locator('.fit-lime-date-months')
      async function geometry(height: number, keyboard = false) {
        const box = (await dialog.boundingBox())!
        expect(box.y).toBeGreaterThanOrEqual(47)
        expect(box.y + box.height).toBeLessThanOrEqual(height - (client || keyboard ? 0 : 34) + 1)
        for (const control of [close, confirm]) {
          const b = (await control.boundingBox())!
          expect(b.y).toBeGreaterThanOrEqual(47)
          expect(b.y + b.height).toBeLessThanOrEqual(height - (keyboard ? 0 : 34) + 1)
        }
      }
      await geometry(853)
      // A short viewport exposes the original outer-scroll/header regression.
      await page.setViewportSize({ width: 393, height: 640 })
      // A viewport-size change is not an on-screen keyboard. Send the OS
      // orientation signal so the existing provider updates its stable height.
      await page.evaluate(() => window.dispatchEvent(new Event('orientationchange')))
      await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--app-viewport-height') === '640px'
        && !document.documentElement.classList.contains('app-keyboard-open'))).toBe(true)
      await expect.poll(async () => (await dialog.boundingBox())!.y).toBeGreaterThanOrEqual(47)
      await geometry(640)
      const before = (await close.boundingBox())!.y
      const movement = await months.evaluate(element => {
        element.scrollTop = 0
        const start = element.scrollTop
        element.scrollTop = element.scrollHeight
        return element.scrollTop - start
      })
      expect(movement).toBeGreaterThan(0)
      expect((await close.boundingBox())!.y).toBeCloseTo(before, 1)
      expect((await confirm.boundingBox())!.y).toBeCloseTo(before, 1)
      await geometry(640)
      await page.screenshot({ path: info.outputPath(`${variant}-safe-scrolled.png`), scale: 'css' })
      // CSS consumes the existing keyboard/visual-viewport contract; the OS
      // keyboard itself is covered separately by app-viewport tests.
      await page.evaluate(() => {
        document.documentElement.classList.add('app-keyboard-open')
        document.documentElement.style.setProperty('--app-visible-height', '440px')
      })
      await geometry(440, true)
      await page.evaluate(() => {
        document.documentElement.classList.remove('app-keyboard-open')
        document.documentElement.style.setProperty('--app-visible-height', '640px')
      })
      await months.evaluate(element => { element.scrollTop = 0 })
      await dialog.getByRole('button', { name: '3 ноября 2026 г.', exact: true }).click()
      if (client) await dialog.getByLabel('Начало', { exact: true }).fill('12:30')
      await close.click()
      await expect(trigger).toBeFocused()
      await expect(page.getByTestId('saved-date')).toHaveText('2026-11-02 10:00 11:00')
      await trigger.click()
      await expect(dialog.getByRole('button', { name: '2 ноября 2026 г.', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await dialog.getByRole('button', { name: '3 ноября 2026 г.', exact: true }).click()
      await confirm.click()
      await expect(page.getByTestId('saved-date')).toHaveText('2026-11-03 10:00 11:00')
      await expect(trigger).toBeFocused()
      expect(forbidden).toEqual([])
    })
  }
}
