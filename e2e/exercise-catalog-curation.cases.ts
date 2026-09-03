import { expect, test } from '@playwright/test'
import { expectMonochromeAccessibility } from './accessibility-helpers'

export function exerciseCatalogCurationCases() {
for (const role of ['trainer', 'client'] as const) {
  test(`curated catalog keeps ${role} variants, aliases and forms usable in light/dark`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: role === 'client' ? 430 : 390, height: 844 })
    await page.goto('/auth')
    await page.getByLabel('Email').fill(`${role}@fit.local`)
    await page.getByLabel('Пароль').fill('FitLocal123!')
    await page.getByRole('button', { name: 'Войти', exact: true }).click()
    await expect(page).toHaveURL(role === 'client' ? /\/me$/ : /\/(today|clients)$/)
    const profile = role === 'client' ? '/me/profile' : '/profile'
    for (const dark of [false, true]) {
      const draftUrl = `/workouts/new?date=2026-09-${dark ? '17' : '16'}`
      await page.goto(profile)
      await page.getByRole('switch', { name: 'Тёмная тема' }).setChecked(dark)
      await page.goto(draftUrl)
      if (role === 'trainer') {
        await page.locator('.client-picker-trigger').click()
        await page.locator('.client-picker-item').filter({ hasText: 'Анна Смирнова' }).first().click()
      }
      await page.getByRole('button', { name: 'Выбрать упражнения', exact: true }).click()
      await page.getByRole('button', { name: /^Силовая/ }).click()
      const help = page.getByRole('button', { name: 'Понятно', exact: true })
      if (await help.isVisible()) await help.click()
      const dialog = page.getByRole('dialog', { name: 'Добавить упражнение', exact: true })
      await expect(dialog.getByLabel('Раздел каталога')).toHaveValue('core')
      // A previous choice may promote its precise variant in the recent list.
      await dialog.getByRole('button', { name: /^Посмотреть технику: Жим гантелей на наклонной/ }).first().click()
      await dialog.getByLabel('Вариант упражнения').selectOption({ label: 'Жим гантелей на наклонной нейтральным хватом' })
      await expect(dialog.getByRole('heading', { name: 'Жим гантелей на наклонной нейтральным хватом' })).toBeVisible()
      await expectMonochromeAccessibility(page)
      await expect(page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).resolves.toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`${role}-${dark ? 'dark' : 'light'}-variant.png`) })
      await dialog.getByRole('button', { name: 'Добавить к выбранным' }).click()
      await dialog.getByRole('button', { name: 'Добавить 1', exact: true }).click()
      await page.getByLabel('Вес, подход 1').fill('25')
      await page.getByLabel('Повторы, подход 1').fill('12')
      await expect(page.getByLabel('Вес, подход 1')).toHaveValue('25')
      await expect(page.getByText('Жим гантелей на наклонной нейтральным хватом', { exact: true }).last()).toBeVisible()
      // Reload the existing draft: both the variant and its values must survive.
      await page.goto(draftUrl)
      await expect(page.getByLabel('Вес, подход 1')).toHaveValue('25')
      await expect(page.getByLabel('Повторы, подход 1')).toHaveValue('12')
      await page.getByRole('button', { name: '＋ Упражнение', exact: true }).click()
      await page.getByRole('button', { name: /^Силовая/ }).click()
      await dialog.getByLabel('Поиск упражнения').fill('тяга гантели одной рукой')
      await expect(dialog.locator('[data-exercise-ref="dumbbell-row"]')).toBeVisible()
      await expect(dialog.locator('[data-exercise-ref="fedb-one-arm-dumbbell-row"]')).toHaveCount(0)
      await page.screenshot({ path: testInfo.outputPath(`${role}-${dark ? 'dark' : 'light'}-search.png`) })
      await dialog.getByRole('button', { name: 'Очистить поиск' }).click()
      await dialog.getByLabel('Раздел каталога').selectOption('formats')
      await expect(dialog.getByRole('button', { name: /Посмотреть технику: Табата/ })).toBeVisible()
      await dialog.getByLabel('Раздел каталога').selectOption('rare')
      await expect(dialog.locator('.picker-list')).toBeVisible()
      await expect(page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).resolves.toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`${role}-${dark ? 'dark' : 'light'}-rare.png`) })
    }
  })
}
}
