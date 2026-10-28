import { expect, test } from '@playwright/test'
import { coachGestureWorkout, mockPilot, workoutId } from './fit-lime-fixtures'

test.skip(process.env.FIT_COACH_ALL_ACCEPTANCE !== '1', 'Explicit all-trainer production-build acceptance')
const trainer = 'c0ac0000-6010-4000-8000-000000000003'

for (const density of ['original', 'compact'] as const) test(`all-trainer rollout keeps ${density} and preference`, async ({ page }, info) => {
  await page.clock.setFixedTime(new Date('2026-10-08T09:01:00Z'))
  const source = coachGestureWorkout(true)
  source.trainerId = trainer
  source.createdBy = trainer
  await mockPilot(page, { profileId: trainer, fitLime: true, workouts: [source] })
  // A new trainer must get Original without a pre-existing preference.
  if (density === 'compact') await page.addInitScript(id => localStorage.setItem(`fit.coachLiveDensity.${id}`, 'compact'), trainer)
  await page.goto(`/workouts/${workoutId}/live`)
  const live = page.locator('.coach-live-v79')
  await expect(live).toBeVisible()
  await expect(live.getByLabel('Фактический вес', { exact: true }).first()).toHaveCSS('height', density === 'original' ? '54px' : '48px')
  await expect(live.locator('.coach-reference-timer-actions .coach-reference-pause')).toBeVisible()
  await expect(live.locator('.coach-v79-circuit > .circuit-head')).toBeVisible()
  await expect(live.locator('.circuit-round .coach-v79-card-tools')).toHaveCount(0)
  await page.screenshot({ path: info.outputPath(`all-trainer-${density}.png`) })
  await page.reload()
  await expect(live.getByLabel('Фактический вес', { exact: true }).first()).toHaveCSS('height', density === 'original' ? '54px' : '48px')
})

for (const role of ['client', 'trainer'] as const) test(`all-trainer rollout excludes ${role === 'client' ? 'client' : 'unapproved trainer'}`, async ({ page }) => {
  await mockPilot(page, { role, profileId: trainer, fitLime: role === 'client', clientLime: role === 'client', workouts: [coachGestureWorkout()] })
  await page.goto(`/workouts/${workoutId}/live`)
  await expect(page.locator('.live-set-check').first()).toBeVisible()
  await expect(page.locator('.coach-live-v79')).toHaveCount(0)
  await expect(page.locator('.coach-reference-pause')).toHaveCount(0)
})
