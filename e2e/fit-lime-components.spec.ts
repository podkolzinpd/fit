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
  expect(original).not.toBe('#080908')

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

  await expect(frame).toHaveCSS('background-color', 'rgb(8, 9, 8)')
  await expect(frame.locator('.fit-lime-component-fixture .primary')).toHaveCSS('background-color', 'rgb(186, 255, 54)')
  await expect(frame.locator('.fit-lime-component-fixture .secondary')).toHaveCSS('background-color', 'rgb(35, 35, 40)')
  await expect(frame.locator('.fit-lime-component-fixture .card')).toHaveCSS('border-radius', '28px')
  await expect(frame.locator('.fit-lime-component-fixture .field input')).toHaveCSS('font-size', '16px')
  await expect(frame.locator('.fit-lime-component-fixture .modal-dialog')).toHaveCSS('background-color', 'rgb(35, 35, 40)')
  const primaryHeight = await frame.locator('.fit-lime-component-fixture .primary').evaluate((button) => button.getBoundingClientRect().height)
  expect(primaryHeight).toBeGreaterThanOrEqual(44)

  await frame.evaluate((element) => element.classList.remove('fit-lime'))
  await expect(frame).not.toHaveCSS('background-color', 'rgb(8, 9, 8)')
  expect(await frame.evaluate((element) => getComputedStyle(element).getPropertyValue('--bg').trim())).toBe(original)
})
