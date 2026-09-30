import { expect, test } from '@playwright/test'

test('saved and newly entered fractional weights do not block workout editing', async ({ page }, testInfo) => {
  await page.goto('/auth')
  await page.addStyleTag({ content: '#fit-startup-shell, #fit-startup-emergency { display: none !important; }' })
  await page.evaluate(async () => {
    const modulePath = '/e2e/workout-decimal-weight-harness.tsx'
    const harness = await import(modulePath) as typeof import('./workout-decimal-weight-harness')
    harness.mountWorkoutDecimalWeightHarness()
  })

  const weight = page.getByRole('spinbutton', { name: 'Вес, подход 1' })
  await expect(weight).toHaveValue('3.4')
  expect(await weight.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(true)
  await page.getByRole('button', { name: 'Сохранить план' }).click()
  await expect(page.getByRole('status', { name: 'Сохранённый вес' })).toHaveText('3.4')

  await weight.fill('4.3')
  await page.getByRole('button', { name: 'Сохранить план' }).click()
  await expect(page.getByRole('status', { name: 'Сохранённый вес' })).toHaveText('4.3')

  for (const width of [390, 430, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`decimal-weight-${width}.png`) })
  }
})
