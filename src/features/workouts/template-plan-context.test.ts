import { beforeEach, describe, expect, it, vi } from 'vitest'
import { localDate } from '../../shared/local-date'
import { applyCreatedTemplate, persistTemplateSource, readTemplatePlanContext, type TemplatePlanContext } from './template-plan-context'
import { readWorkoutFormDraft, workoutFormDraftKey, writeWorkoutFormDraft, type WorkoutFormDraft } from './workout-form-draft'
import type { WorkoutTemplateDraft } from '../../shared/domain'

const key = workoutFormDraftKey('trainer', 'new-plan')
const draft: WorkoutFormDraft = { clientId: 'client', title: 'Мой план', notes: 'Моя заметка', workoutDate: localDate('2026-11-09'), startTime: '12:00', endTime: '13:00', stageId: 'stage', recordCompleted: false, requestId: 'request', trainingFormat: 'self', prepSeconds: 30, executionMode: 'manual', exercises: [] }
const template: WorkoutTemplateDraft = { id: 'template', name: 'Шаблон', notes: 'Шаблонная заметка', exercises: [{ source: 'system', ref: 'plank', name: 'Планка', muscleGroup: 'core', inputKind: 'duration', position: 0, blockId: 'source-block', sets: [{ position: 0, durationSec: 40 }] }] }
const context: TemplatePlanContext = { draftKey: key, returnTo: '/workouts/new?date=2026-11-09', requestId: 'request', applyOnSave: true }
beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) })
  writeWorkoutFormDraft(key, draft)
})
describe('trainer template return', () => {
  it('appends an independent plan once and preserves all filled source fields across retry and autosave', () => {
    applyCreatedTemplate(context, template)
    const result = readWorkoutFormDraft(key)!
    const { exercises: originalExercises, ...originalFields } = draft
    const { exercises: resultExercises, ...resultFields } = result
    expect(resultFields).toMatchObject(originalFields)
    expect(originalExercises).toHaveLength(0)
    expect(resultExercises).toHaveLength(1)
    expect(result.exercises).toHaveLength(1)
    expect(result.exercises[0]!.blockId).not.toBe('source-block')
    writeWorkoutFormDraft(key, { ...result, appliedTemplateIds: undefined })
    applyCreatedTemplate(context, template)
    expect(readWorkoutFormDraft(key)!.exercises).toHaveLength(1)
  })
  it('fills only empty title and notes', () => {
    writeWorkoutFormDraft(key, { ...draft, title: ' ', notes: '' })
    applyCreatedTemplate(context, template)
    expect(readWorkoutFormDraft(key)).toMatchObject({ title: template.name, notes: template.notes })
  })
  it('rejects another account, external routes, and a newer source command', () => {
    expect(readTemplatePlanContext(context, 'another-trainer')).toBeUndefined()
    expect(readTemplatePlanContext({ ...context, returnTo: '//foreign.example' }, 'trainer')).toBeUndefined()
    writeWorkoutFormDraft(key, { ...draft, requestId: 'newer' })
    expect(readTemplatePlanContext(context, 'trainer')).toBeUndefined()
    expect(() => applyCreatedTemplate(context, template)).toThrow('Исходный план изменился')
    expect(readWorkoutFormDraft(key)!.exercises).toEqual([])
  })
  it('keeps the original plan and reports quota failure instead of claiming an append', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(persistTemplateSource(key, { ...draft, title: 'Изменено' })).toBe(false)
    expect(() => applyCreatedTemplate(context, template)).toThrow('не удалось добавить')
    expect(readWorkoutFormDraft(key)).toEqual(draft)
  })
  it('saving a copy for the library does not append to its source plan', () => {
    applyCreatedTemplate({ ...context, applyOnSave: false }, template)
    expect(readWorkoutFormDraft(key)).toEqual(draft)
  })
})
