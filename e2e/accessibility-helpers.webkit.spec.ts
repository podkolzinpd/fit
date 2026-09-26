import { expect, test, type Page } from '@playwright/test'
import { expectMonochromeAccessibility } from './accessibility-helpers'

type Alternative = 'valid' | 'missing' | 'small' | 'different-map' | 'disabled' | 'wrong-label'

async function showBodyZone(page: Page, alternative: Alternative = 'valid', open = false) {
  const button = `<div class="body-progress-zone-list"><button type="button" aria-label="${alternative === 'wrong-label' ? 'Плечи. Нагрузка зоны: 21%' : 'Грудь. Нагрузка зоны: 21%'}" ${alternative === 'disabled' ? 'disabled' : ''} style="height:${alternative === 'small' ? '43' : '44'}px">Грудь</button></div>`
  await page.setContent(`
    <style>
      body { margin: 0 }
      summary { box-sizing: border-box; width: 140px; height: 44px; }
      button { box-sizing: border-box; width: 140px; padding: 0; }
      svg { width: 100px; height: 80px; }
    </style>
    <main class="ui-identity">
      <div class="body-progress-panel">
        <svg viewBox="0 0 100 80">
          <g class="body-progress-region" data-body-zone="chest" role="button" tabindex="0" aria-label="Грудь. Нагрузка зоны: 21%">
            <path class="body-progress-region-hit" d="M10 10h28v20H10Z" />
          </g>
        </svg>
        <details class="body-progress-zone-picker" ${open ? 'open' : ''}>
          <summary>Выбрать зону</summary>
          ${['missing', 'different-map'].includes(alternative) ? '' : button}
        </details>
      </div>
      ${alternative === 'different-map' ? `<div class="body-progress-panel">${button}</div>` : ''}
    </main>
  `)
}

for (const initiallyOpen of [false, true]) {
  test(`small SVG zone accepts its full-sized equivalent and restores ${initiallyOpen ? 'open' : 'closed'} disclosure`, async ({ page }) => {
    await showBodyZone(page, 'valid', initiallyOpen)
    await expectMonochromeAccessibility(page)
    await expect(page.locator('.body-progress-zone-picker')).toHaveJSProperty('open', initiallyOpen)
  })
}

for (const alternative of ['missing', 'small', 'different-map', 'disabled', 'wrong-label'] as const) {
  test(`small SVG zone fails accessibility with ${alternative} alternative`, async ({ page }) => {
    await showBodyZone(page, alternative)
    await expect(expectMonochromeAccessibility(page)).rejects.toThrow('interactive target below 44px')
    await expect(page.locator('.body-progress-zone-picker')).toHaveJSProperty('open', false)
  })
}

test('equivalent body-zone button does not exempt ordinary small controls', async ({ page }) => {
  await showBodyZone(page)
  await page.locator('main').evaluate((main) => {
    const button = document.createElement('button')
    button.textContent = 'Обычная кнопка'
    button.style.height = '20px'
    main.append(button)
  })
  await expect(expectMonochromeAccessibility(page)).rejects.toThrow('interactive target below 44px')
})
