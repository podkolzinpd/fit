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

export function workoutTemplateEntryCases() {
  for (const quick of [false, true]) for (const create of [false, true]) test(`Template entry ${quick ? 'quick' : 'full'} ${create ? 'empty create save return' : 'repeat append preserves context'}`, { tag: ['@lime-templates'] }, async ({ page }, info) => {
    await setup(page)
    const sourceKey = `fit.workout-form-draft.${actorId}.${quick ? 'new--2026-11-09--quick' : `new-${clientId}-2026-11-09`}`
    const source = { ...oldDraft, clientId, workoutDate: '2026-11-09', title: 'Индивидуальный план', notes: 'Не терять заметку', sourceVersion: undefined }
    await page.addInitScript(({ key, draft }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(draft)) }, { key: sourceKey, draft: source })
    const commands: unknown[] = []
    let currentTemplate = original
    let holdRead = false
    let releaseRead: (() => void) | undefined
    const readGate = new Promise<void>(resolve => { releaseRead = resolve })
    const businessWrites: string[] = []
    page.on('request', request => { if (request.method() !== 'GET' && /\/v1\/workouts(?:\/|$)/.test(new URL(request.url()).pathname)) businessWrites.push(request.url()) })
    await page.route('**/v1/workout-templates', async route => {
      if (route.request().method() === 'GET') {
        if (holdRead) await readGate
        return route.fulfill({ json: { templates: create ? [] : [currentTemplate] } })
      }
      const command = route.request().postDataJSON() as { draft: typeof original }
      commands.push(command)
      if (quick && create && commands.length === 1) return route.abort('connectionreset')
      return route.fulfill({ json: { template: { ...original, ...command.draft } } })
    })
    if (quick) {
      await page.goto('/today?date=2026-11-09')
      await page.getByRole('button', { name: 'Новая тренировка', exact: true }).click()
      await page.getByRole('button', { name: 'Запланировать', exact: true }).click()
      await page.getByRole('button', { name: 'Продолжить черновик', exact: true }).click()
    } else await page.goto(`/workouts/new?client=${clientId}&date=2026-11-09`)
    const methods = page.getByRole('group', { name: 'Добавить упражнения', exact: true })
    await expect(methods.getByRole('button')).toHaveCount(4)
    for (const width of [320, 390, 430, 1440]) {
      await page.setViewportSize({ width, height: 844 })
      const geometry = await methods.evaluate(node => ({ overflow: node.scrollWidth > node.clientWidth, heights: [...node.querySelectorAll('button')].map(button => button.getBoundingClientRect().height) }))
      expect(geometry.overflow).toBe(false)
      expect(geometry.heights.every(height => height >= 44)).toBe(true)
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Добавить шаблон', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Добавить шаблон тренировки' })
    await expect(picker).toBeVisible()
    await page.screenshot({ path: info.outputPath('template-entry-picker.png') })
    if (create) {
      await expect(picker.getByRole('button', { name: 'Открыть библиотеку' })).toBeVisible()
      if (quick) await picker.getByRole('button', { name: 'Создать шаблон', exact: true }).click()
      else {
        await picker.getByRole('button', { name: 'Открыть библиотеку', exact: true }).click()
        await page.getByRole('link', { name: 'Создать с нуля', exact: true }).click()
      }
      await page.getByLabel('Название шаблона').fill('Новый корпус')
      await page.getByRole('button', { name: 'Выбрать упражнения', exact: true }).click()
      const catalog = page.getByRole('dialog', { name: 'Добавить упражнение', exact: true })
      await catalog.getByLabel('Поиск упражнения').fill('Планка')
      await catalog.getByRole('button', { name: 'Выбрать: Планка', exact: true }).click()
      await catalog.getByRole('button', { name: 'Добавить 1', exact: true }).click()
      await page.reload()
      await expect(page.getByLabel('Название шаблона')).toHaveValue('Новый корпус')
      await page.getByRole('button', { name: 'Сохранить и добавить в план', exact: true }).click()
      if (quick) {
        await expect(page.getByRole('alert')).toBeVisible()
        const unchanged = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}') as { exercises: unknown[] }, sourceKey)
        expect(unchanged.exercises).toHaveLength(1)
        await page.getByRole('button', { name: 'Сохранить и добавить в план', exact: true }).click()
      }
      await expect(page.getByRole('textbox', { name: 'Название тренировки', exact: true })).toHaveValue(source.title)
      if (quick) await expect(page.getByRole('dialog', { name: 'Быстрое создание тренировки' })).toBeVisible()
      expect(commands).toHaveLength(quick ? 2 : 1)
      if (quick) expect(commands[1]).toEqual(commands[0])
    } else {
      await page.keyboard.press('Escape')
      await expect(picker).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Добавить шаблон', exact: true })).toBeFocused()
      currentTemplate = { ...original, name: 'Корпус · актуальная версия' }
      holdRead = true
      const nextRead = page.waitForRequest(request => request.method() === 'GET' && new URL(request.url()).pathname.endsWith('/v1/workout-templates'))
      await page.getByRole('button', { name: 'Добавить шаблон', exact: true }).click()
      await nextRead
      await expect(picker.locator('.workout-template-picker-item')).toHaveCount(0)
      releaseRead?.()
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt) await page.getByRole('button', { name: 'Добавить шаблон', exact: true }).click()
        await expect(picker.locator('.workout-template-picker-item')).toContainText('Корпус · актуальная версия')
        await picker.locator('.workout-template-picker-item').click()
      }
    }
    const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}') as { clientId: string; workoutDate: string; title: string; notes: string; startTime: string; trainingFormat: string; exercises: Array<{ blockId: string }> }, sourceKey)
    expect(stored).toMatchObject({ clientId, workoutDate: source.workoutDate, title: source.title, notes: source.notes, startTime: source.startTime, trainingFormat: source.trainingFormat })
    expect(stored.exercises).toHaveLength(create ? 2 : 3)
    expect(new Set(stored.exercises.map(exercise => exercise.blockId)).size).toBe(create ? 2 : 3)
    expect(businessWrites).toEqual([])
    await page.screenshot({ path: info.outputPath('template-entry-return.png') })
  })
}
