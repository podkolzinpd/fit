import { expect, test } from '@playwright/test'

test('Fit Lime component variants stay inert outside the scoped trainer fixture', async ({ page }) => {
  await page.goto('/auth')
  await page.evaluate(() => {
    const frame = document.createElement('div')
    frame.className = 'phone-frame theme-light ui-identity fit-lime-component-test-frame'
    document.body.append(frame)
  })
  const frame = page.locator('.fit-lime-component-test-frame')
  await expect(frame).toBeVisible()
  const original = await frame.evaluate((element) => getComputedStyle(element).getPropertyValue('--bg').trim())
  expect(original).not.toBe('#000000')

  await frame.evaluate((element) => {
    element.classList.add('fit-lime')
    const fixture = document.createElement('section')
    fixture.className = 'fit-lime-component-fixture'
    fixture.innerHTML = `
      <button type="button" class="primary">Сохранить</button>
      <button type="button" class="secondary">Отмена</button>
      <label class="field"><span>Имя</span><input placeholder="Имя" /></label>
      <article class="card"><strong>Клиент</strong></article>
      <section class="state-panel state-panel-error"><h2>Ошибка</h2><p>Повторите действие</p></section>
      <div class="overflow-list"><button type="button" class="overflow-item danger">Удалить</button></div>
      <div class="modal-dialog"><p class="modal-message">Подтверждение</p></div>
    `
    element.append(fixture)
  })

  await expect(frame).toHaveCSS('background-color', 'rgb(0, 0, 0)')
  await expect(frame.locator('.fit-lime-component-fixture .primary')).toHaveCSS('background-color', 'rgb(182, 239, 77)')
  await expect(frame.locator('.fit-lime-component-fixture .secondary')).toHaveCSS('background-color', 'rgb(37, 37, 41)')
  await expect(frame.locator('.fit-lime-component-fixture .card')).toHaveCSS('border-radius', '32px')
  await expect(frame.locator('.fit-lime-component-fixture .field input')).toHaveCSS('font-size', '16px')
  await expect(frame.locator('.fit-lime-component-fixture .modal-dialog')).toHaveCSS('background-color', 'rgb(37, 37, 41)')
  const primaryHeight = await frame.locator('.fit-lime-component-fixture .primary').evaluate((button) => button.getBoundingClientRect().height)
  expect(primaryHeight).toBeGreaterThanOrEqual(44)

  await frame.evaluate((element) => element.classList.remove('fit-lime'))
  await expect(frame).not.toHaveCSS('background-color', 'rgb(0, 0, 0)')
  expect(await frame.evaluate((element) => getComputedStyle(element).getPropertyValue('--bg').trim())).toBe(original)
})

for (const theme of ['light', 'dark']) {
  test(`Client Lime foundation ${theme} keeps readable text and the approved lime fill`, async ({ page }) => {
    await page.goto('/auth')
    await page.evaluate((theme) => {
      const frame = document.createElement('div')
      frame.className = `phone-frame ui-identity fit-lime fit-client-lime ${theme === 'light' ? 'theme-light' : ''}`
      frame.id = 'client-lime-foundation'
      frame.innerHTML = '<section class="card"><strong>Тренировка</strong><p>План на сегодня</p><button class="primary">Начать</button></section>'
      document.body.append(frame)
    }, theme)
    const frame = page.locator('#client-lime-foundation')
    await expect(frame).toHaveCSS('background-color', theme === 'light' ? 'rgb(246, 247, 242)' : 'rgb(0, 0, 0)')
    await expect(frame.locator('.primary')).toHaveCSS('background-color', 'rgb(182, 239, 77)')
    await expect(frame.locator('.primary')).toHaveCSS('color', 'rgb(0, 0, 0)')
    await expect(frame.locator('p')).toHaveCSS('color', theme === 'light' ? 'rgb(85, 92, 76)' : 'rgb(184, 184, 189)')
  })
}
