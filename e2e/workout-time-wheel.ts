import { expect, type Page } from '@playwright/test'

/** Exercise durations are chosen through the same two-column wheel as in the UI. */
export async function chooseWorkoutTime(page: Page, label: string, totalSeconds: number, occurrence = 0) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const display = `${minutes}:${String(seconds).padStart(2, '0')}`
  const trigger = page.getByLabel(label).nth(occurrence)
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: label })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('option', { name: `${String(minutes).padStart(2, '0')} минуты`, exact: true }).click()
  await dialog.getByRole('option', { name: `${String(seconds).padStart(2, '0')} секунды`, exact: true }).click()
  await dialog.getByRole('button', { name: `Применить · ${display}`, exact: true }).click()
  await expect(trigger).toHaveText(display)
  return trigger
}
