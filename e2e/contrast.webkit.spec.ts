import { expect, test } from '@playwright/test'

type Color = [number, number, number]

function rgb(value: string): Color {
  const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number)
  if (!channels || channels.length !== 3) throw new Error(`Unsupported color: ${value}`)
  return channels as Color
}

function contrast(foreground: string, background: string): number {
  const luminance = (value: string) => {
    const [red = 0, green = 0, blue = 0] = rgb(value).map((channel) => {
      const scaled = channel / 255
      return scaled <= .04045 ? scaled / 12.92 : ((scaled + .055) / 1.055) ** 2.4
    })
    return red * .2126 + green * .7152 + blue * .0722
  }
  const a = luminance(foreground)
  const b = luminance(background)
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
}

const appearances = [
  { name: 'client light 390', classes: 'fit-lime fit-client-lime theme-light', width: 390 },
  { name: 'client light 430', classes: 'fit-lime fit-client-lime theme-light', width: 430 },
  { name: 'client dark 390', classes: 'fit-lime fit-client-lime', width: 390 },
  { name: 'client dark 430', classes: 'fit-lime fit-client-lime', width: 430 },
  { name: 'trainer Lime', classes: 'fit-lime', width: 1440 },
  { name: 'Mono light', classes: 'theme-light', width: 390 },
  { name: 'Mono dark', classes: '', width: 1440 },
] as const

for (const appearance of appearances) {
  test(`${appearance.name}: confirmation, disabled actions and selection retain AA contrast`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: appearance.width, height: 844 })
    const theme = appearance.classes.includes('theme-light') ? 'light' : 'dark'
    await page.addInitScript((value) => localStorage.setItem('fit.appTheme', value), theme)
    await page.goto('/auth')
    if (theme === 'light') await expect(page.locator('html')).toHaveClass(/theme-light/)
    else await expect(page.locator('html')).not.toHaveClass(/theme-light/)
    await page.evaluate((classes) => {
      const frame = document.createElement('div')
      frame.className = `phone-frame ui-identity ${classes}`
      frame.id = 'contrast-fixture'
      frame.style.cssText = 'position:relative;width:100%;min-height:480px;padding:24px'
      frame.innerHTML = `
        <div class="modal-dialog">
          <p class="modal-message">Архивировать цель?</p>
          <div class="actions"><button class="secondary">Отмена</button><button class="danger secondary">Архивировать</button></div>
        </div>
        <button class="primary">Сохранить</button>
        <button class="secondary">Отмена</button>
        <button class="secondary" disabled>Недоступно</button>
        <button class="primary" disabled>Ожидание</button>
        <div class="overflow-list" style="position:static;margin-top:12px"><button class="overflow-item" disabled>Недоступное действие</button></div>
        <div class="fit-lime-shell trainer-client-detail-identity">
          <div class="client-detail-page"><button disabled>Недоступно в карточке</button></div>
          <button class="chat-send" disabled>Отправить</button>
        </div>
        <p id="selection-target">Выделенный текст</p>
      `
      document.body.append(frame)
    }, appearance.classes)

    const result = await page.locator('#contrast-fixture').evaluate((frame, isTrainerLime) => {
      const pick = (selector: string) => {
        const styles = getComputedStyle(frame.querySelector(selector)!)
        return { foreground: styles.color, background: styles.backgroundColor, opacity: styles.opacity }
      }
      const selection = getComputedStyle(frame.querySelector('#selection-target')!, '::selection')
      return {
        danger: pick('.danger'),
        primary: pick('button.primary:not(:disabled)'),
        secondary: pick('button.secondary:not(:disabled)'),
        secondaryDisabled: pick('button.secondary:disabled'),
        primaryDisabled: pick('button.primary:disabled'),
        overflowDisabled: pick('.overflow-item:disabled'),
        ...(isTrainerLime ? {
          trainerCardDisabled: pick('.client-detail-page button:disabled'),
          chatDisabled: pick('.chat-send:disabled'),
        } : {}),
        selection: { foreground: selection.color, background: selection.backgroundColor, opacity: '1' },
      }
    }, appearance.name === 'trainer Lime')

    for (const [label, colors] of Object.entries(result)) {
      expect(colors.opacity, `${appearance.name} ${label} must not lose contrast through opacity`).toBe('1')
      expect(contrast(colors.foreground, colors.background), `${appearance.name} ${label}: ${JSON.stringify(colors)}`).toBeGreaterThanOrEqual(4.5)
    }
    await page.locator('#contrast-fixture').screenshot({ path: testInfo.outputPath(`contrast-${appearance.name.replaceAll(' ', '-')}.png`) })
  })
}
