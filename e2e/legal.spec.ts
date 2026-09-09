import { expect, test } from '@playwright/test'

for (const legalPage of [
  { path: '/legal/terms', title: 'Условия использования', lastSection: '8. Изменение Условий' },
  { path: '/legal/privacy', title: 'Политика конфиденциальности', lastSection: '10. Изменения Политики' },
]) {
  test(`${legalPage.title} scrolls to the end in the Android viewport`, async ({ page }) => {
    await page.goto(legalPage.path)
    await expect(page.getByRole('heading', { level: 1, name: legalPage.title })).toBeVisible()

    const legalScreen = page.locator('.legal-screen')
    const dimensions = await legalScreen.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }))
    expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight)

    const scrollTop = await legalScreen.evaluate((element) => {
      element.scrollTop = element.scrollHeight
      return element.scrollTop
    })
    expect(scrollTop).toBeGreaterThan(0)
    await expect(page.getByRole('heading', { level: 2, name: legalPage.lastSection })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Юридические документы' })).toBeVisible()
  })
}

test('legal documents are public and account deletion stays a reversible request', async ({ page }, testInfo) => {
  await page.goto('/legal/privacy')
  await expect(page.getByRole('heading', { level: 1, name: 'Политика конфиденциальности' })).toBeVisible()
  await expect(page.getByText(/Supabase, Vercel и сервисы Yandex Cloud/)).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toHaveCount(0)

  await page.goto('/legal/delete-account')
  await expect(page.getByRole('heading', { name: 'Сначала войдите' })).toBeVisible()

  const email = `legal-flow-${testInfo.workerIndex}-${Date.now()}@fit.local`
  await page.getByRole('link', { name: 'Войти в Fit' }).click()
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByLabel('Имя').fill('Юридический тест')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill('FitLocal123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()

  await expect(page).toHaveURL(/\/legal\/delete-account$/)
  await page.getByRole('button', { name: 'Запросить удаление аккаунта' }).click()
  await page.getByRole('button', { name: 'Отправить запрос' }).click()
  await expect(page.getByRole('heading', { name: 'Запрос принят' })).toBeVisible()
  await expect(page.getByText(/данные ещё не удалены/)).toBeVisible()

  await page.getByRole('button', { name: 'Отменить запрос' }).click()
  await expect(page.getByRole('button', { name: 'Запросить удаление аккаунта' })).toBeVisible()
})
