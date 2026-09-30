import { expect, type Page } from '@playwright/test'

async function waitForDurationControl(page: Page, label: string, occurrence: number) {
  const fields = page.getByRole('group', { name: label, exact: true }).nth(occurrence)
  const trigger = page.getByRole('button', { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`) }).nth(occurrence)
  await expect.poll(async () => {
    if (await fields.count()) return 'keyboard'
    if (await trigger.count()) return 'wheel'
    return null
  }, { timeout: 10_000 }).not.toBeNull()
  return { fields, trigger, keyboard: await fields.count() > 0 }
}

/** Exercise durations use keyboard fields by default and the wheel by opt-in. */
export async function chooseWorkoutTime(page: Page, label: string, totalSeconds: number, occurrence = 0) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const display = `${minutes}:${String(seconds).padStart(2, '0')}`
  const { fields, trigger, keyboard } = await waitForDurationControl(page, label, occurrence)
  if (keyboard) {
    const minuteInput = fields.getByRole('textbox', { name: `${label}: минуты` })
    const secondInput = fields.getByRole('textbox', { name: `${label}: секунды` })
    await minuteInput.fill(String(minutes))
    await secondInput.fill(String(seconds).padStart(2, '0'))
    await secondInput.press('Tab')
    await expect(minuteInput).toHaveValue(String(minutes))
    await expect(secondInput).toHaveValue(String(seconds).padStart(2, '0'))
    return fields
  }
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: label })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('option', { name: `${String(minutes).padStart(2, '0')} минуты`, exact: true }).click()
  await dialog.getByRole('option', { name: `${String(seconds).padStart(2, '0')} секунды`, exact: true }).click()
  await dialog.getByRole('button', { name: `Применить · ${display}`, exact: true }).click()
  await expect(trigger).toHaveText(display)
  return trigger
}

export async function expectWorkoutTime(page: Page, label: string, totalSeconds: number | undefined, occurrence = 0) {
  const { fields, trigger, keyboard } = await waitForDurationControl(page, label, occurrence)
  if (keyboard) {
    await expect(fields.getByRole('textbox', { name: `${label}: минуты` })).toHaveValue(totalSeconds === undefined ? '' : String(Math.floor(totalSeconds / 60)))
    await expect(fields.getByRole('textbox', { name: `${label}: секунды` })).toHaveValue(totalSeconds === undefined ? '' : String(totalSeconds % 60).padStart(2, '0'))
    return
  }
  await expect(trigger).toHaveText(totalSeconds === undefined ? 'Добавить время' : `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`)
}
