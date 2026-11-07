import { nativeSignIn } from './native-local-fixture'
import { expect, test } from './native-local-fixture'

test('trainer profile controls and feedback fit the iOS shell', async ({ page }, testInfo) => {
  const draft = {
    displayName: 'Анна Иванова', bio: 'Помогаю тренироваться регулярно и безопасно.',
    specialties: ['Силовые'], city: 'Москва', trainingModes: ['online'],
    experienceStartYear: null, education: '', formats: '', price: '',
    acceptingClients: true, avatarDataUrl: null, certificates: [],
  }
  await page.route("**/v1/trainer-profile", (route) => route.fulfill({ json: {
      publicId: '99e68cb4-81d6-4b24-9a71-5ecf86934a57', draft, published: draft,
      listedInCatalog: true, publishedAt: '2026-09-17T12:00:00+00:00',
      updatedAt: '2026-09-17T12:00:00+00:00', version: 2, isBrandTrainer: false,
    } }))
  await page.goto('/auth')
  await nativeSignIn(page, 'trainer@fit.local')
  await expect(page).toHaveURL(/\/(today|clients)$/)

  await page.goto('/profile')
  await expect(page.locator('.phone-frame')).toHaveClass(/trainer-profile-identity/)
  const profile = page.getByRole('region', { name: 'Анкета тренера' })
  await expect(profile).toBeVisible()
  const unpublish = profile.getByRole('button', { name: 'Снять с публикации' })
  await expect(unpublish).toBeVisible()
  await unpublish.click()
  await expect(page.getByRole('alertdialog', { name: /Снять анкету с публикации/ })).toBeVisible()
  await page.getByRole('button', { name: 'Отмена' }).click()
  await expect(unpublish).toBeVisible()
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
  await page.getByRole('link', { name: 'Настройки профиля' }).click()
  await expect(page).toHaveURL(/\/profile\/settings$/)
  await page.getByRole('link', { name: /^Тренировки/ }).click()
  await expect(page.getByRole('switch', { name: 'Показывать RPE' })).toBeVisible()
  const wheel = page.getByRole('switch', { name: 'Ввод времени колёсиком', exact: true })
  await wheel.check()
  await wheel.uncheck()
  const row = wheel.locator('..')
  const control = row.locator('.switch-control')
  await expect(control).toBeVisible()
  const contrast = await row.evaluate(element => {
    const color = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number)
    const luminance = (value: string) => color(value).map(component => {
      const n = component / 255
      return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4
    }).reduce((total, n, i) => total + n * [.2126, .7152, .0722][i]!, 0)
    const ratio = (a: string, b: string) => {
      const x = luminance(a), y = luminance(b)
      return (Math.max(x, y) + .05) / (Math.min(x, y) + .05)
    }
    const track = element.querySelector('.switch-control')!
    const style = getComputedStyle(track)
    const surface = getComputedStyle(element.closest('.profile-settings')!).backgroundColor
    return { border: ratio(style.borderTopColor, surface), thumb: ratio(getComputedStyle(track, '::after').backgroundColor, style.backgroundColor), height: element.getBoundingClientRect().height }
  })
  expect(contrast.border).toBeGreaterThanOrEqual(3)
  expect(contrast.thumb).toBeGreaterThanOrEqual(3)
  expect(contrast.height).toBeGreaterThanOrEqual(44)
  await page.reload()
  await expect(wheel).not.toBeChecked()
  await expect(control).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('trainer-settings-off-switches.png'), fullPage: true })
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await page.getByRole('link', { name: 'Помощь и документы' }).click()
  await page.getByRole('button', { name: 'Fit на экране «Домой»' }).click()
  await expect(page.getByRole('heading', { name: 'Установите Fit на iPhone' })).toBeVisible()
  await expect(page.getByText('Откройте эту страницу в Safari.')).toBeVisible()
  await expect(page.getByText(/На экран „Домой“/)).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть' }).click()
  await page.getByRole('button', { name: 'Предложение или проблема' }).click()
  await expect(page.getByRole('form', { name: 'Напишите команде Fit' })).toBeVisible()
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true)
})
