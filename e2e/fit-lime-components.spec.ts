import { expect, test } from '@playwright/test'

// Theme surfaces and narrow wrapping are independent visual risks. Behavior
// uses the real catalogue route separately; this matrix exercises CSS states.
for (const theme of ['light', 'dark'] as const) for (const width of [390, 430]) {
  test(`Client Lime catalogue states keep geometry ${theme} ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/auth')
    await page.evaluate(({ theme, width }) => {
      const frame = document.createElement('div')
      frame.id = 'client-picker-geometry'
      frame.className = `phone-frame fit-lime fit-client-lime ${theme === 'light' ? 'theme-light' : ''}`
      frame.style.width = `${width}px`
      frame.innerHTML = `<section class="exercise-picker"><article class="picker-item">
        <button type="button" class="picker-item-technique"><span class="picker-item-media"><span class="exercise-image exercise-image-picker"></span></span><span class="picker-item-copy"><span class="picker-item-name">Румынская тяга со штангой с длинным названием</span><small>Штанга · Ноги</small></span></button>
        <button type="button" class="picker-select-mark" aria-label="Выбрать упражнение">+</button>
      </article></section>`
      document.body.append(frame)
    }, { theme, width })
    const frame = page.locator('#client-picker-geometry')
    const row = frame.locator('.picker-item')
    const original = await row.boundingBox()
    expect(original).not.toBeNull()
    const neutral = await row.evaluate(element => getComputedStyle(element).backgroundColor)
    await row.evaluate(element => {
      element.classList.add('playing')
      const note = document.createElement('small')
      note.className = 'picker-item-playing-note'
      note.textContent = 'Нажмите ещё раз, чтобы открыть технику'
      element.querySelector('.picker-item-copy')!.append(note)
    })
    await expect(row).toHaveCSS('background-color', neutral)
    expect((await row.boundingBox())!.height).toBe(original!.height)
    await expect(row.locator('.exercise-image-picker')).toHaveCSS('width', '62px')
    await row.locator('.picker-item-technique').hover()
    await expect(row.locator('.picker-item-technique')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await row.evaluate(element => element.classList.add('selected'))
    await expect(row).not.toHaveCSS('background-color', neutral)
    expect((await row.boundingBox())!.height).toBe(original!.height)
    // The trainer shares the component, but must retain its existing styling.
    await frame.evaluate(element => element.classList.remove('fit-client-lime'))
    await expect(row).toHaveCSS('min-height', '132px')
    await expect(row.locator('.exercise-image-picker')).toHaveCSS('width', '116px')
  })
}

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
