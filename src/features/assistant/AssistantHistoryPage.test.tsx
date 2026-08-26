import { describe, expect, it } from 'vitest'
import type { ExerciseSnapshot } from '../../shared/domain'
import { optionalProgramNumber, programSessions, programWorkoutDrafts, updateProgramExercise } from './program-draft'
import { appendAssistantTranscript, appendWorkoutParse, appendedWorkoutTranscript, assistantWorkoutDraftKey, assistantWorkoutSaveInput, clearAssistantWorkoutDraft, enqueueWorkoutParse, readAssistantWorkoutDraft, removeWorkoutParseSource, replaceWorkoutParseSource, resolveWorkoutParseSource, updateWorkoutParseMetrics, writeAssistantWorkoutDraft } from './workout-draft'
import { assistantActionView } from './assistant-action-view'

const benchPress = {
  source: 'system', ref: 'barbell-bench-press', name: 'Жим штанги лёжа', muscleGroup: 'chest', inputKind: 'strength',
} as ExerciseSnapshot

describe('assistant program draft saving', () => {
  it('keeps existing typed text while live voice snapshots replace their own interim tail', () => {
    expect(appendAssistantTranscript('Запиши тренировку Сан Санычу', 'жим')).toBe('Запиши тренировку Сан Санычу\nжим')
    expect(appendAssistantTranscript('Запиши тренировку Сан Санычу', 'жим лёжа 3 по 10')).toBe('Запиши тренировку Сан Санычу\nжим лёжа 3 по 10')
  })
  it('routes every designed assistant flow to a structured card instead of the generic preview', () => {
    expect(assistantActionView({ tool: 'record_workout', payload: { step: 'workout' } })).toBe('workout-collection')
    expect(assistantActionView({ tool: 'record_workout', payload: { step: 'confirm' } })).toBe('workout-confirm')
    expect(assistantActionView({ tool: 'create_client_draft', payload: { step: 'profile' } })).toBe('client-collection')
    expect(assistantActionView({ tool: 'create_client_draft', payload: { step: 'confirm' } })).toBe('client-confirm')
    expect(assistantActionView({ tool: 'create_program_draft', payload: { step: 'brief' } })).toBe('program-brief')
    expect(assistantActionView({ tool: 'create_program_draft', payload: { step: 'confirm' } })).toBe('program-confirm')
    expect(assistantActionView({ tool: 'schedule_program', payload: { step: 'confirm' } })).toBe('program-confirm')
    expect(assistantActionView({ tool: 'summarize_progress', payload: { step: 'period' } })).toBe('summary-period')
  })
  it('keeps the locally prefilled workout time in the completed workout payload', () => {
    expect(assistantWorkoutSaveInput('request-1', 'client-1', '2026-08-25', '17:07', [])).toEqual({
      workout: { requestId: 'request-1', clientId: 'client-1', workoutDate: '2026-08-25', startTime: '17:07', exercises: [] },
    })
  })

  it('restores date, time, parsed rows and request id for the same workout draft', () => {
    const storage = new Map<string, string>()
    const localStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value) },
      removeItem: (key: string) => { storage.delete(key) },
    }
    const key = assistantWorkoutDraftKey('trainer-1', 'conversation-1', 'client-1')
    const snapshot = {
      transcript: 'жим лёжа 3 по 10', rawFragments: ['жим лёжа 3 по 10'], workoutDate: '2026-08-26', startTime: '01:45', requestId: 'request-1',
      result: { items: [{ sourceText: 'жим лёжа 3 по 10', exerciseRef: 'barbell-bench-press', confidence: 1, sets: [{ reps: 10, weightKg: 55 }] }], unmatched: [] },
    }
    writeAssistantWorkoutDraft(key, snapshot, localStorage)
    expect(readAssistantWorkoutDraft(key, localStorage)).toEqual(snapshot)
    clearAssistantWorkoutDraft(key, localStorage)
    expect(readAssistantWorkoutDraft(key, localStorage)).toBeUndefined()
  })

  it('appends a newly recognized fragment without replacing the existing structured draft', () => {
    const first = { items: [{ sourceText: 'Жим', exerciseRef: 'barbell-bench-press', confidence: 1, sets: [] }], unmatched: [] }
    const second = { items: [{ sourceText: 'Тяга', exerciseRef: 'row', confidence: 1, sets: [] }], unmatched: [] }
    expect(appendWorkoutParse(first, second).items.map((item) => item.sourceText)).toEqual(['Жим', 'Тяга'])
  })

  it('replaces only the selected ambiguous fragment after an explicit choice', () => {
    const existing = { items: [{ sourceText: 'Жим', exerciseRef: 'barbell-bench-press', confidence: 1, sets: [] }], unmatched: [{ sourceText: 'Тяга', reason: 'Нужно уточнить', suggestedExerciseRefs: ['row', 'pulldown'] }] }
    const resolved = replaceWorkoutParseSource(existing, 'Тяга', { items: [{ sourceText: 'Тяга', exerciseRef: 'row', confidence: 1, sets: [] }], unmatched: [] })
    expect(resolved.items.map((item) => item.sourceText)).toEqual(['Жим', 'Тяга'])
    expect(resolved.unmatched).toEqual([])
  })

  it('keeps parsed values when the trainer resolves an ambiguous exercise', () => {
    const existing = { items: [], unmatched: [{ sourceText: 'Жим лежа 100 кг 3 по 15', reason: 'Нужно уточнить', suggestedExerciseRefs: ['barbell-bench-press', 'dumbbell-bench-press'], sets: [{ reps: 15, weightKg: 100 }, { reps: 15, weightKg: 100 }, { reps: 15, weightKg: 100 }] }] }
    const resolved = resolveWorkoutParseSource(existing, 'Жим лежа 100 кг 3 по 15', 'barbell-bench-press')
    expect(resolved.unmatched).toEqual([])
    expect(resolved.items[0]).toMatchObject({ exerciseRef: 'barbell-bench-press', sets: [{ reps: 15, weightKg: 100 }, { reps: 15, weightKg: 100 }, { reps: 15, weightKg: 100 }] })
  })

  it('edits structured workout metrics and removes only the requested row', () => {
    const existing = { items: [{ sourceText: 'Жим', exerciseRef: 'barbell-bench-press', confidence: 1, sets: [{ reps: 10, weightKg: 50 }] }, { sourceText: 'Тяга', exerciseRef: 'row', confidence: 1, sets: [{}] }], unmatched: [] }
    const edited = updateWorkoutParseMetrics(existing, 'Жим', { setCount: 3, reps: 12, weightKg: 55 })
    expect(edited.items[0]?.sets).toEqual([{ reps: 12, weightKg: 55 }, { reps: 12, weightKg: 55 }, { reps: 12, weightKg: 55 }])
    expect(removeWorkoutParseSource(edited, 'Жим').items.map((item) => item.sourceText)).toEqual(['Тяга'])
  })

  it('extracts only the newly dictated tail from a cumulative transcript', () => {
    expect(appendedWorkoutTranscript('жим лежа 3 по 10', 'жим лежа 3 по 10\nприсед 3 по 12')).toBe('присед 3 по 12')
    expect(appendedWorkoutTranscript('жим лежа 3 по 10', 'жим лежа 3 по 10')).toBe('')
    expect(appendedWorkoutTranscript('старый фрагмент', 'тяга 4 по 8')).toBe('тяга 4 по 8')
  })

  it('serializes workout parsing fragments instead of dropping a concurrent append', async () => {
    const queue = { current: Promise.resolve() }
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    const order: string[] = []
    const first = enqueueWorkoutParse(queue, async () => { order.push('first:start'); await firstGate; order.push('first:end') })
    const second = enqueueWorkoutParse(queue, () => { order.push('second'); return Promise.resolve() })
    await Promise.resolve()
    expect(order).toEqual(['first:start'])
    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual(['first:start', 'first:end', 'second'])
  })

  it('normalizes stored program sessions and keeps legacy exercise names editable', () => {
    expect(programSessions([{ title: 'A', day: 'Пн', exercises: ['Жим штанги лёжа'] }, { title: 'broken', day: 'Вт', exercises: [null] }, null])).toEqual([
      { title: 'A', day: 'Пн', exercises: [{ name: 'Жим штанги лёжа', sets: 1 }] },
    ])
  })

  it('edits one exercise without mutating the rest and normalizes optional values', () => {
    const sessions = [{ title: 'A', day: 'Пн', exercises: [{ name: 'Жим штанги лёжа', sets: 3, reps: 8 }, { name: 'Бег', sets: 1 }] }]
    expect(updateProgramExercise(sessions, 0, 1, { durationMin: 20 })).toEqual([{ title: 'A', day: 'Пн', exercises: [{ name: 'Жим штанги лёжа', sets: 3, reps: 8 }, { name: 'Бег', sets: 1, durationMin: 20 }] }])
    expect(optionalProgramNumber('')).toBeUndefined()
    expect(optionalProgramNumber('0')).toBeUndefined()
    expect(optionalProgramNumber('2.5')).toBe(2.5)
  })

  it('builds planned workout drafts with stable request ids for a retry', () => {
    const input = [{ title: 'Силовая A', day: 'Понедельник', exercises: [{ name: 'Жим штанги лёжа', sets: 3, reps: 8, weightKg: 40 }] }]
    const first = programWorkoutDrafts('6f0c4fb9-5f61-4d78-97aa-1f8b8d79c447', input, ['2026-08-31'], ['f05074d3-2f64-4fa6-a91f-6fe749afb30d'], [benchPress])
    const retry = programWorkoutDrafts('6f0c4fb9-5f61-4d78-97aa-1f8b8d79c447', input, ['2026-08-31'], ['f05074d3-2f64-4fa6-a91f-6fe749afb30d'], [benchPress])

    expect(first?.[0]).toMatchObject({ requestId: 'f05074d3-2f64-4fa6-a91f-6fe749afb30d', workoutDate: '2026-08-31', notes: 'Силовая A' })
    expect(first?.[0]?.exercises[0]).toMatchObject({ ref: 'barbell-bench-press', sets: [{ position: 0, reps: 8, weightKg: 40 }, { position: 1, reps: 8, weightKg: 40 }, { position: 2, reps: 8, weightKg: 40 }] })
    expect(retry?.[0]?.requestId).toBe(first?.[0]?.requestId)
  })

  it('blocks confirmation until every exercise maps unambiguously to the catalog', () => {
    expect(programWorkoutDrafts(
      '6f0c4fb9-5f61-4d78-97aa-1f8b8d79c447',
      [{ title: 'Силовая A', day: 'Понедельник', exercises: [{ name: 'Несуществующее упражнение', sets: 3, reps: 8 }] }],
      ['2026-08-31'], ['f05074d3-2f64-4fa6-a91f-6fe749afb30d'], [benchPress],
    )).toBeUndefined()
  })
})
