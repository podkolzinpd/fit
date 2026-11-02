import { expect, test, type Page } from '@playwright/test'
import { clientId, mockPilot } from './fit-lime-fixtures'

const actorId = 'c0ac0000-6010-4000-8000-000000000001'
const templateId = '10000000-0000-4000-8000-000000000080'
const otherClientId = '10000000-0000-4000-8000-000000000081'
const legacyKey = `fit.workout-form-draft.${actorId}.template-${templateId}`
const exercises = [{ source: 'system', ref: 'plank', name: 'Планка', muscleGroup: 'core', inputKind: 'duration', position: 0,
  blockId: '10000000-0000-4000-8000-000000000082', blockType: 'single', blockRounds: 1, sets: [{ position: 0, durationSec: 30 }] }]
const original = { id: templateId, trainerId: actorId, name: 'Корпус', notes: null as string | null, version: 1,
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', exercises }

async function setup(page: Page) {
  await page.clock.setFixedTime(new Date('2026-10-20T09:00:00+03:00'))
  await mockPilot(page, { profileId: actorId, fitLime: true, clientRecords: [
    { id: clientId, fullName: 'Анна Морозова', archivedAt: null, version: 1 },
    { id: otherClientId, fullName: 'Алексей Громов', archivedAt: null, version: 1 },
  ] })
  let current = structuredClone(original)
  const commands: Array<{ draft: typeof original; expectedVersion: number }> = []
  await page.route('**/v1/workout-templates', route => route.fulfill({ json: { templates: [current] } }))
  await page.route(`**/v1/workout-templates/${templateId}`, async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { template: current } })
    const command = route.request().postDataJSON() as (typeof commands)[number]
    commands.push(command)
    if (command.expectedVersion !== current.version) return route.fulfill({ status: 409, json: { error: 'conflict' } })
    current = { ...current, ...command.draft, version: current.version + 1 }
    return route.fulfill({ json: { template: current } })
  })
  return commands
}

const oldDraft = { title: 'Прежний облегчённый план', clientId: otherClientId, workoutDate: '2026-11-03', startTime: '18:00', endTime: '19:00', notes: 'Старая заметка', stageId: '', recordCompleted: false, exercises, trainingFormat: 'self', prepSeconds: 30, executionMode: 'manual', requestId: '10000000-0000-4000-8000-000000000083', sourceVersion: 1 }

export function workoutTemplateReliabilityCases() {
  test('Template reliability edit save reopen uses current fields and version', { tag: ['@lime-templates'] }, async ({ page }, info) => {
    const commands = await setup(page)
    await page.goto('/schedule/templates')
    await page.getByRole('button', { name: 'Действия с шаблоном Корпус' }).click()
    await page.getByRole('menuitem', { name: 'Редактировать', exact: true }).click()
    await expect(page.getByLabel('Название шаблона')).toHaveValue('Корпус')
    await page.getByLabel('Название шаблона').fill('Корпус · обновлённый')
    await page.getByRole('button', { name: 'Сохранить шаблон', exact: true }).click()
    await expect(page).toHaveURL(/\/schedule\/templates$/)
    await page.getByRole('button', { name: 'Действия с шаблоном Корпус · обновлённый' }).click()
    await page.getByRole('menuitem', { name: 'Редактировать', exact: true }).click()
    await expect(page.getByLabel('Название шаблона')).toHaveValue('Корпус · обновлённый')
    await page.getByLabel('Название шаблона').fill('Корпус · вторая правка')
    await page.getByRole('button', { name: 'Сохранить шаблон', exact: true }).click()
    await expect(page).toHaveURL(/\/schedule\/templates$/)
    expect(commands.map(c => c.expectedVersion)).toEqual([1, 2])
    await page.screenshot({ path: info.outputPath('template-current-version.png') })
  })

  test('Template reliability offers legacy draft and keeps its exact context when resumed', { tag: ['@lime-templates'] }, async ({ page }, info) => {
    await setup(page)
    await page.addInitScript(({ key, draft }) => localStorage.setItem(key, JSON.stringify(draft)), { key: legacyKey, draft: oldDraft })
    await page.goto(`/workouts/new?template=${templateId}&client=${clientId}&date=2026-11-09`)
    const dialog = page.getByRole('dialog', { name: 'Есть черновик этого шаблона' })
    await expect(dialog).toContainText('Алексей Громов')
    await expect(dialog).toContainText('18:00')
    // This sheet has a long date CTA and can hold several retained assignments.
    for (const width of [320, 390, 736]) {
      await page.setViewportSize({ width, height: 844 })
      const geometry = await dialog.evaluate(node => {
        const box = node.getBoundingClientRect()
        const buttons = [...node.querySelectorAll('button')]
        return { overflow: node.scrollWidth > node.clientWidth, buttons: buttons.map(button => {
          const rect = button.getBoundingClientRect()
          return { contained: rect.left >= box.left && rect.right <= box.right && button.scrollWidth <= button.clientWidth + 1, height: rect.height }
        }) }
      })
      expect(geometry.overflow).toBe(false)
      expect(geometry.buttons.every(button => button.contained && button.height >= 44)).toBe(true)
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: info.outputPath('template-draft-choice.png') })
    await dialog.getByRole('button', { name: /Прежний облегчённый план/ }).click()
    await expect(page.getByRole('textbox', { name: 'Название тренировки', exact: true })).toHaveValue(oldDraft.title)
    await expect(page.getByRole('button', { name: 'Клиент: Алексей Громов' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Выбрать дату' })).toContainText('3 ноября')
    await expect(page.getByRole('textbox', { name: 'Начало', exact: true })).toHaveValue('18:00')
    await expect(page.getByRole('button', { name: 'Самостоятельно', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), legacyKey)).toContain(`"requestId":"${oldDraft.requestId}"`)
    await page.reload()
    await page.getByRole('dialog', { name: 'Есть черновик этого шаблона' }).getByRole('button', { name: /Прежний облегчённый план/ }).click()
    await expect(page.getByRole('button', { name: 'Выбрать дату' })).toContainText('3 ноября')
  })

  test('Template reliability fresh assignment preserves old draft and starts a distinct command', { tag: ['@lime-templates'] }, async ({ page }) => {
    await setup(page)
    await page.addInitScript(({ key, draft }) => localStorage.setItem(key, JSON.stringify(draft)), { key: legacyKey, draft: oldDraft })
    await page.goto(`/workouts/new?template=${templateId}&client=${clientId}&date=2026-11-09`)
    await page.getByRole('dialog', { name: 'Есть черновик этого шаблона' }).getByRole('button', { name: /Новый план на/ }).click()
    await expect(page.getByRole('textbox', { name: 'Название тренировки', exact: true })).toHaveValue('Корпус')
    await expect(page.getByRole('button', { name: 'Клиент: Анна Морозова' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Выбрать дату' })).toContainText('9 ноября')
    await expect(page.getByRole('textbox', { name: 'Начало', exact: true })).toHaveValue('')
    await expect(page.getByRole('button', { name: 'С тренером', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const result = await page.evaluate(key => ({ old: localStorage.getItem(key), current: Object.keys(localStorage).filter(k => k.startsWith(key + '.assignment.')).map(k => localStorage.getItem(k)!) }), legacyKey)
    const previous: unknown = JSON.parse(result.old!)
    const current: unknown[] = result.current.map((raw): unknown => JSON.parse(raw))
    expect(previous).toEqual(oldDraft)
    expect(current).toHaveLength(1)
    expect(current[0]).toMatchObject({ clientId, workoutDate: '2026-11-09', title: 'Корпус' })
    expect(current[0]).not.toMatchObject({ requestId: oldDraft.requestId })
  })
}
