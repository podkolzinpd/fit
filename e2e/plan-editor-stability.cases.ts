import { expect, test } from '@playwright/test'
import { coachGestureWorkout, mockPilot, workoutId } from './fit-lime-fixtures'

export function planEditorStabilityCases() {
  test('plan keyboard closing follows intermediate geometry without counter-scrolling', async ({ page }, info) => {
    const actor = 'c0ac0000-6010-4000-8000-000000000001'
    await page.clock.setFixedTime(new Date('2026-11-08T09:00:00Z'))
    await page.addInitScript(id => localStorage.setItem(`fit.rpeDisplay.${id}`, 'true'), actor)
    const source = coachGestureWorkout(false, 5)
    source.status = 'planned'; source.startedAt = null; source.createdBy = actor; source.workoutDate = '2026-11-08'
    await mockPilot(page, { role: 'trainer', profileId: actor, fitLime: true, workouts: [source] })
    await page.goto(`/workouts/${workoutId}/edit`)
    const card = page.locator('.planned-exercise').nth(1)
    const weight = card.getByLabel('Вес, подход 1', { exact: true })
    await weight.tap()
    await weight.fill('27.5')
    await weight.press('Enter')
    await expect(card.getByLabel('Повторы, подход 1', { exact: true })).toBeFocused()
    const content = page.locator('.content')
    // Explicit visualViewport phases model geometry, not a physical keyboard.
    const phase = async (height: number, offsetTop: number) => {
      await page.evaluate(async ({ height, offsetTop }) => {
        Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: height })
        Object.defineProperty(window.visualViewport, 'offsetTop', { configurable: true, value: offsetTop })
        window.visualViewport!.dispatchEvent(new Event('resize'))
        await new Promise(requestAnimationFrame)
        await new Promise(requestAnimationFrame)
      }, { height, offsetTop })
    }
    const fullHeight = await page.evaluate(() => innerHeight)
    await phase(400, 70)
    await expect(card.getByLabel('Повторы, подход 1', { exact: true })).toBeInViewport()
    await card.getByLabel('Целевой RPE, подход 1', { exact: true }).selectOption('7.5')
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur())
    const before = await content.evaluate(node => node.scrollTop)
    for (const [height, offset] of [[fullHeight - 145, 65], [fullHeight - 65, 20], [fullHeight - 4, 0], [fullHeight, 8]]) {
      await phase(height!, offset!)
      expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--app-visible-height'))).toBe(`${height}px`)
      expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--app-viewport-offset-top'))).toBe(`${offset}px`)
      expect(Math.abs(await content.evaluate(node => node.scrollTop) - before)).toBeLessThanOrEqual(1)
    }
    await phase(fullHeight, 0)
    await expect(weight).toHaveValue('27.5')
    await expect(card.getByLabel('Целевой RPE, подход 1', { exact: true })).toHaveValue('7.5')
    expect(Math.abs(await content.evaluate(node => node.scrollTop) - before)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: info.outputPath('plan-after-keyboard-close.png') })
  })
}
