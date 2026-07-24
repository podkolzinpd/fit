import { describe, expect, it } from 'vitest'
import type { InputKind, Workout, WorkoutExerciseDraft, WorkoutSet, WorkoutStatus, WorkoutSummary } from '../../shared/domain'
import { bmiLabel, bmiValue, canTransition, chartUnitFor, computeClientStats, copyWorkout, ensureBlockIds, exerciseChartPoints, groupDraftsIntoBlocks, groupIntoBlocks, isLastSetOfBlock, blockRoundsView, currentRoundIndex, mergeBlockWithNext, muscleGroupLabels, syncBlockRounds, nextSetDraft, setBlockType, splitBlock, splitClientWorkouts, tonnageLabel, workoutDurationLabel, workoutTonnage } from './workout-rules'
import { localDate } from '../../shared/local-date'

function summary(date: string, status: WorkoutStatus, id = date): WorkoutSummary {
  return { id, workoutDate: localDate(date), status }
}

function bareWorkout(date: string, status: WorkoutStatus): Workout {
  return {
    id: date + status, clientId: 'c1', clientName: 'Клиент', workoutDate: localDate(date),
    startTime: null, endTime: null, startedAt: null, completedAt: null, status, notes: null, version: 1, exercises: [],
  }
}

const TODAY = localDate('2026-07-22')

describe('workouts repository rules', () => {
  it('разрешает только последовательные переходы', () => {
    expect(canTransition('planned', 'in_progress')).toBe(true)
    expect(canTransition('planned', 'done')).toBe(false)
    expect(canTransition('in_progress', 'done')).toBe(true)
  })

  it('копирует план без факта и идентификаторов', () => {
    const source: Workout = {
      id: 'w1', clientId: 'c1', clientName: 'Анна', workoutDate: localDate('2026-07-21'),
      startTime: null, endTime: null, startedAt: null, completedAt: null, status: 'done', notes: null, version: 3,
      exercises: [{ id: 'e1', source: 'system', ref: 'squat', name: 'Присед', muscleGroup: 'legs', inputKind: 'strength', position: 0, blockId: 'b1', blockType: 'single', blockRounds: 1,
        sets: [{ id: 's1', position: 0, weightKg: 50, reps: 10, fact: { weightKg: 55, reps: 9 }, confirmedAt: 'now', version: 2 }] }],
    }
    const copy = copyWorkout(source, localDate('2026-07-22'))
    expect(copy.id).toBeUndefined()
    expect(copy.exercises[0]?.sets[0]).toEqual({ position: 0, weightKg: 50, reps: 10, durationMin: undefined, distanceKm: undefined })
  })
})

describe('computeClientStats', () => {
  it('считает только выполненные тренировки и последнюю дату', () => {
    const stats = computeClientStats([
      summary('2026-07-05', 'done'),
      summary('2026-07-18', 'done'),
      summary('2026-07-25', 'planned'),
    ], TODAY)
    expect(stats.doneCount).toBe(2)
    expect(stats.lastWorkoutDate).toBe('2026-07-18')
  })

  it('процент выполнения = выполнено / (выполнено + пропущено)', () => {
    const stats = computeClientStats([
      summary('2026-07-05', 'done'),
      summary('2026-07-10', 'done'),
      summary('2026-07-12', 'done'),
      summary('2026-07-08', 'planned'), // пропущено: план в прошлом
      summary('2026-07-30', 'planned'), // будущее не входит в знаменатель
      summary('2026-07-22', 'in_progress'), // идёт — не считается
    ], TODAY)
    expect(stats.completionPercent).toBe(75)
  })

  it('возвращает null процент без выполненных и пропущенных', () => {
    const stats = computeClientStats([summary('2026-07-30', 'planned')], TODAY)
    expect(stats.completionPercent).toBeNull()
  })

  it('считает дни в работе от первой тренировки', () => {
    const stats = computeClientStats([
      summary('2026-07-02', 'done'),
      summary('2026-07-18', 'done'),
    ], TODAY)
    expect(stats.daysInWork).toBe(20)
  })

  it('дни в работе null, если тренировок нет', () => {
    const stats = computeClientStats([], TODAY)
    expect(stats.daysInWork).toBeNull()
  })

  it('помечает вниманием при последней тренировке 14+ дней назад', () => {
    const stats = computeClientStats([summary('2026-07-05', 'done')], TODAY)
    expect(stats.needsAttention).toBe(true)
  })

  it('не помечает вниманием при недавней тренировке', () => {
    const stats = computeClientStats([summary('2026-07-18', 'done')], TODAY)
    expect(stats.needsAttention).toBe(false)
  })
})

function set(fact: WorkoutSet['fact'], position = 0): WorkoutSet {
  return { id: `s${position}`, position, fact, confirmedAt: 'now', version: 1 }
}

function planSet(weightKg: number, position = 0): WorkoutSet {
  return { id: `p${position}`, position, weightKg, fact: {}, confirmedAt: null, version: 1 }
}

function workoutWith(date: string, ref: string, inputKind: InputKind, sets: WorkoutSet[]): Workout {
  return {
    id: `w-${date}`, clientId: 'c1', clientName: 'Клиент', workoutDate: localDate(date),
    startTime: null, endTime: null, startedAt: null, completedAt: null, status: 'done', notes: null, version: 1,
    exercises: [{ id: `e-${date}`, source: 'system', ref, name: ref, muscleGroup: 'legs', inputKind, position: 0, blockId: `b-${date}`, blockType: 'single', blockRounds: 1, sets }],
  }
}

describe('exerciseChartPoints', () => {
  it('берёт максимальный фактический вес за тренировку, сортирует по дате', () => {
    const workouts = [
      workoutWith('2026-07-18', 'squat', 'strength', [set({ weightKg: 60 }), set({ weightKg: 65 }, 1)]),
      workoutWith('2026-07-05', 'squat', 'strength', [set({ weightKg: 50 }), set({ weightKg: 55 }, 1)]),
    ]
    expect(exerciseChartPoints(workouts, 'squat')).toEqual([
      { date: '2026-07-05', value: 55 },
      { date: '2026-07-18', value: 65 },
    ])
  })

  it('использует дистанцию для distance-упражнений', () => {
    const workouts = [workoutWith('2026-07-10', 'run', 'distance', [set({ distanceKm: 5, durationMin: 30 })])]
    expect(exerciseChartPoints(workouts, 'run')).toEqual([{ date: '2026-07-10', value: 5 }])
  })

  it('использует повторы для reps-упражнений', () => {
    const workouts = [workoutWith('2026-07-10', 'burpee', 'reps', [set({ reps: 40, durationMin: 5 })])]
    expect(exerciseChartPoints(workouts, 'burpee')).toEqual([{ date: '2026-07-10', value: 40 }])
  })

  it('пропускает тренировки без фактических данных', () => {
    const workouts = [
      workoutWith('2026-07-05', 'squat', 'strength', [set({ weightKg: 50 })]),
      workoutWith('2026-07-12', 'squat', 'strength', [set({})]),
    ]
    expect(exerciseChartPoints(workouts, 'squat')).toEqual([{ date: '2026-07-05', value: 50 }])
  })

  it('берёт план как fallback, если факт не заполнен', () => {
    const workouts = [workoutWith('2026-07-15', 'squat', 'strength', [planSet(70), planSet(75, 1)])]
    expect(exerciseChartPoints(workouts, 'squat')).toEqual([{ date: '2026-07-15', value: 75 }])
  })

  it('берёт плановую дистанцию как fallback', () => {
    const plan: WorkoutSet = { id: 'pd', position: 0, distanceKm: 8, fact: {}, confirmedAt: null, version: 1 }
    const workouts = [workoutWith('2026-07-15', 'run', 'distance', [plan])]
    expect(exerciseChartPoints(workouts, 'run')).toEqual([{ date: '2026-07-15', value: 8 }])
  })

  it('берёт плановые повторы как fallback', () => {
    const plan: WorkoutSet = { id: 'pr', position: 0, reps: 30, fact: {}, confirmedAt: null, version: 1 }
    const workouts = [workoutWith('2026-07-15', 'burpee', 'reps', [plan])]
    expect(exerciseChartPoints(workouts, 'burpee')).toEqual([{ date: '2026-07-15', value: 30 }])
  })

  it('учитывает только завершённые тренировки', () => {
    const planned = workoutWith('2026-07-20', 'squat', 'strength', [set({ weightKg: 80 })])
    planned.status = 'planned'
    expect(exerciseChartPoints([planned], 'squat')).toEqual([])
  })
})

describe('workoutDurationLabel', () => {
  it('форматирует минуты', () => {
    expect(workoutDurationLabel('2026-07-22T10:00:00Z', '2026-07-22T10:42:00Z')).toBe('42 мин')
  })
  it('форматирует часы и минуты', () => {
    expect(workoutDurationLabel('2026-07-22T10:00:00Z', '2026-07-22T11:05:00Z')).toBe('1 ч 05 мин')
  })
  it('возвращает null без меток или при неположительной длительности', () => {
    expect(workoutDurationLabel(null, '2026-07-22T11:00:00Z')).toBeNull()
    expect(workoutDurationLabel('2026-07-22T11:00:00Z', null)).toBeNull()
    expect(workoutDurationLabel('2026-07-22T11:00:00Z', '2026-07-22T11:00:00Z')).toBeNull()
  })
})

describe('chartUnitFor', () => {
  it('возвращает единицу по типу ввода', () => {
    expect(chartUnitFor('distance')).toBe('км')
    expect(chartUnitFor('reps')).toBe('повт.')
    expect(chartUnitFor('strength')).toBe('кг')
  })
})

describe('splitClientWorkouts', () => {
  it('предстоящие — ближайшая сверху, история — недавняя сверху', () => {
    const workouts = [
      bareWorkout('2026-07-30', 'planned'),
      bareWorkout('2026-07-24', 'planned'),
      bareWorkout('2026-07-10', 'done'),
      bareWorkout('2026-07-18', 'done'),
      bareWorkout('2026-07-20', 'planned'), // прошлое planned → пропущено → история
    ]
    const { upcoming, history } = splitClientWorkouts(workouts, TODAY)
    expect(upcoming.map((w) => w.workoutDate)).toEqual(['2026-07-24', '2026-07-30'])
    expect(history.map((w) => w.workoutDate)).toEqual(['2026-07-20', '2026-07-18', '2026-07-10'])
  })

  it('выполненная сегодня уходит в историю, не в предстоящие', () => {
    const { upcoming, history } = splitClientWorkouts([bareWorkout('2026-07-22', 'done')], TODAY)
    expect(upcoming).toHaveLength(0)
    expect(history).toHaveLength(1)
  })

  it('идущая тренировка (in_progress) сегодня — в предстоящих', () => {
    const { upcoming } = splitClientWorkouts([bareWorkout('2026-07-22', 'in_progress')], TODAY)
    expect(upcoming).toHaveLength(1)
  })
})

describe('bmiValue / bmiLabel', () => {
  it('считает ИМТ по росту и весу', () => {
    expect(bmiValue(180, 80)).toBeCloseTo(24.69, 1)
    expect(bmiLabel(180, 80)).toBe('24.7')
  })
  it('возвращает null/«—» при отсутствии или некорректных данных', () => {
    expect(bmiValue(180, null)).toBeNull()
    expect(bmiValue(0, 80)).toBeNull()
    expect(bmiLabel(180, null)).toBe('—')
  })
})

describe('workoutTonnage / tonnageLabel', () => {
  it('суммирует вес × повторы по силовым подходам (факт или план)', () => {
    const workout = workoutWith('2026-07-20', 'squat', 'strength', [
      set({ weightKg: 60, reps: 10 }),       // факт 60×10 = 600
      { id: 'p', position: 1, weightKg: 50, reps: 8, fact: {}, confirmedAt: null, version: 1 }, // план 50×8 = 400
    ])
    expect(workoutTonnage(workout)).toBe(1000)
  })
  it('игнорирует не-силовые упражнения', () => {
    const workout = workoutWith('2026-07-20', 'run', 'distance', [set({ distanceKm: 5, durationMin: 30 })])
    expect(workoutTonnage(workout)).toBe(0)
  })
  it('форматирует тоннаж в кг и тоннах', () => {
    expect(tonnageLabel(0)).toBe('—')
    expect(tonnageLabel(750)).toBe('750 кг')
    expect(tonnageLabel(1500)).toBe('1.5 т')
  })
})

describe('muscleGroupLabels', () => {
  it('возвращает уникальные группы в порядке упражнений', () => {
    const workout: Workout = {
      ...workoutWith('2026-07-20', 'squat', 'strength', [set({ weightKg: 60 })]),
      exercises: [
        { id: 'e1', source: 'system', ref: 'squat', name: 'Присед', muscleGroup: 'legs', inputKind: 'strength', position: 0, blockId: 'b1', blockType: 'single', blockRounds: 1, sets: [] },
        { id: 'e2', source: 'system', ref: 'bench', name: 'Жим', muscleGroup: 'chest', inputKind: 'strength', position: 1, blockId: 'b2', blockType: 'single', blockRounds: 1, sets: [] },
        { id: 'e3', source: 'system', ref: 'lunge', name: 'Выпад', muscleGroup: 'legs', inputKind: 'strength', position: 2, blockId: 'b3', blockType: 'single', blockRounds: 1, sets: [] },
      ],
    }
    expect(muscleGroupLabels(workout)).toEqual(['Ноги', 'Грудь'])
  })
})

describe('nextSetDraft', () => {
  it('копирует вес и повторы для силового упражнения', () => {
    const sets = [{ position: 0, weightKg: 60, reps: 10 }]
    expect(nextSetDraft(sets, 'strength')).toEqual({ position: 1, weightKg: 60, reps: 10 })
  })
  it('копирует время и дистанцию для distance-упражнения', () => {
    const sets = [{ position: 0, durationMin: 30, distanceKm: 5 }]
    expect(nextSetDraft(sets, 'distance')).toEqual({ position: 1, durationMin: 30, distanceKm: 5 })
  })
  it('копирует время и повторы для reps-упражнения', () => {
    const sets = [{ position: 0, durationMin: 5, reps: 40 }]
    expect(nextSetDraft(sets, 'reps')).toEqual({ position: 1, durationMin: 5, reps: 40 })
  })
  it('копирует именно последний подход, а не первый', () => {
    const sets = [{ position: 0, weightKg: 50, reps: 12 }, { position: 1, weightKg: 55, reps: 8 }]
    expect(nextSetDraft(sets, 'strength')).toEqual({ position: 2, weightKg: 55, reps: 8 })
  })
  it('пустой список → пустой подход на позиции 0', () => {
    expect(nextSetDraft([], 'strength')).toEqual({ position: 0 })
  })
})

function exercise(id: string, position: number, blockId: string, blockType: 'single'|'superset'|'triset'|'circuit', sets: WorkoutSet[] = []): Workout['exercises'][number] {
  return { id, source: 'system', ref: id, name: id, muscleGroup: 'legs', inputKind: 'strength', position, blockId, blockType, blockRounds: Math.max(1, sets.length), sets }
}
function workoutWithExercises(exercises: Workout['exercises']): Workout {
  return { id: 'w', clientId: 'c1', clientName: 'К', workoutDate: localDate('2026-07-20'), startTime: null, endTime: null, startedAt: null, completedAt: null, status: 'in_progress', notes: null, version: 1, exercises }
}

describe('groupIntoBlocks', () => {
  it('группирует упражнения по blockId, сохраняя порядок', () => {
    const blocks = groupIntoBlocks([
      exercise('a', 0, 'b1', 'single'),
      exercise('b', 1, 'b2', 'superset'),
      exercise('c', 2, 'b2', 'superset'),
      exercise('d', 3, 'b3', 'single'),
    ])
    expect(blocks.map((b) => ({ type: b.blockType, ids: b.exercises.map((e) => e.id) }))).toEqual([
      { type: 'single', ids: ['a'] },
      { type: 'superset', ids: ['b', 'c'] },
      { type: 'single', ids: ['d'] },
    ])
  })
})

describe('isLastSetOfBlock', () => {
  const s = (id: string, position: number): WorkoutSet => ({ id, position, fact: {}, confirmedAt: null, version: 1 })
  it('single-блок: последний сет упражнения — последний в блоке', () => {
    const w = workoutWithExercises([exercise('a', 0, 'b1', 'single', [s('s1', 0), s('s2', 1)])])
    expect(isLastSetOfBlock(w, 'a', 's2')).toBe(true)
    expect(isLastSetOfBlock(w, 'a', 's1')).toBe(false)
  })
  it('суперсет: отдых только после последнего упражнения блока', () => {
    const w = workoutWithExercises([
      exercise('a', 0, 'b1', 'superset', [s('a1', 0)]),
      exercise('b', 1, 'b1', 'superset', [s('b1', 0)]),
    ])
    expect(isLastSetOfBlock(w, 'a', 'a1')).toBe(false) // первое упражнение блока
    expect(isLastSetOfBlock(w, 'b', 'b1')).toBe(true)  // последнее упражнение блока
  })
})

describe('copyWorkout blocks', () => {
  it('сохраняет тип блока и объединяет упражнения одного блока новым общим id', () => {
    const source = workoutWithExercises([
      exercise('a', 0, 'b1', 'superset', [{ id: 'x', position: 0, weightKg: 50, fact: {}, confirmedAt: null, version: 1 }]),
      exercise('b', 1, 'b1', 'superset', [{ id: 'y', position: 0, weightKg: 40, fact: {}, confirmedAt: null, version: 1 }]),
    ])
    const draft = copyWorkout(source)
    expect(draft.exercises.map((e) => e.blockType)).toEqual(['superset', 'superset'])
    // оба упражнения блока получили один и тот же новый blockId
    expect(draft.exercises[0]?.blockId).toBe(draft.exercises[1]?.blockId)
    expect(draft.exercises[0]?.blockId).not.toBe('b1')
  })
})

function draft(ref: string, blockId?: string, blockType?: 'single'|'superset'|'triset'|'circuit'): WorkoutExerciseDraft {
  return { source: 'system', ref, name: ref, muscleGroup: 'legs', inputKind: 'strength', position: 0, blockId, blockType, sets: [{ position: 0 }] }
}

describe('draft blocks', () => {
  it('ensureBlockIds проставляет id и single там, где нет', () => {
    const out = ensureBlockIds([draft('a'), draft('b', 'x', 'superset')])
    expect(out[0]?.blockId).toBeTruthy()
    expect(out[0]?.blockType).toBe('single')
    expect(out[1]?.blockId).toBe('x')
    expect(out[1]?.blockType).toBe('superset')
  })

  it('mergeBlockWithNext объединяет два одиночных в суперсет с общим id', () => {
    const out = mergeBlockWithNext([draft('a', 'b1', 'single'), draft('b', 'b2', 'single')], 0)
    expect(out[0]?.blockId).toBe(out[1]?.blockId)
    expect(out[0]?.blockType).toBe('superset')
    expect(out[1]?.blockType).toBe('superset')
  })

  it('mergeBlockWithNext присоединяет к существующему многоэлементному блоку с его типом', () => {
    // a,b — трисет b1; c — одиночный. Объединяем b(index1) со следующим c.
    const start = [draft('a', 'b1', 'triset'), draft('b', 'b1', 'triset'), draft('c', 'b2', 'single')]
    const out = mergeBlockWithNext(start, 1)
    expect(new Set(out.map((e) => e.blockId)).size).toBe(1)
    expect(out.every((e) => e.blockType === 'triset')).toBe(true)
  })

  it('splitBlock разбивает блок на одиночные', () => {
    const out = splitBlock([draft('a', 'b1', 'superset'), draft('b', 'b1', 'superset')], 'b1')
    expect(out[0]?.blockId).not.toBe(out[1]?.blockId)
    expect(out.every((e) => e.blockType === 'single')).toBe(true)
  })

  it('setBlockType меняет тип всего блока', () => {
    const out = setBlockType([draft('a', 'b1', 'superset'), draft('b', 'b1', 'superset')], 'b1', 'circuit')
    expect(out.every((e) => e.blockType === 'circuit')).toBe(true)
  })

  it('groupDraftsIntoBlocks группирует по blockId, сохраняя индексы', () => {
    const blocks = groupDraftsIntoBlocks([draft('a', 'b1', 'superset'), draft('b', 'b1', 'superset'), draft('c', 'b2', 'single')])
    expect(blocks.map((b) => ({ type: b.blockType, refs: b.items.map((i) => i.exercise.ref), idx: b.items.map((i) => i.index) }))).toEqual([
      { type: 'superset', refs: ['a', 'b'], idx: [0, 1] },
      { type: 'single', refs: ['c'], idx: [2] },
    ])
  })
})

describe('block rounds', () => {
  it('syncBlockRounds выставляет N подходов всем упражнениям блока', () => {
    const start = [draft('a', 'b1', 'superset'), draft('b', 'b1', 'superset')]
    const out = syncBlockRounds(start, 'b1', 3)
    expect(out.every((e) => e.blockRounds === 3)).toBe(true)
    expect(out.every((e) => e.sets.length === 3)).toBe(true)
    expect(out.map((e) => e.sets.map((s) => s.position))).toEqual([[0, 1, 2], [0, 1, 2]])
  })

  it('syncBlockRounds срезает лишние подходы и не опускается ниже 1', () => {
    const withThree: WorkoutExerciseDraft = { ...draft('a', 'b1', 'superset'), sets: [{ position: 0 }, { position: 1 }, { position: 2 }] }
    expect(syncBlockRounds([withThree], 'b1', 1)[0]?.sets.length).toBe(1)
    expect(syncBlockRounds([withThree], 'b1', 0)[0]?.sets.length).toBe(1)
  })

  it('syncBlockRounds наследует параметры предыдущего подхода при добавлении', () => {
    const withWeight: WorkoutExerciseDraft = { ...draft('a', 'b1', 'superset'), sets: [{ position: 0, weightKg: 50, reps: 10 }] }
    const out = syncBlockRounds([withWeight], 'b1', 2)
    expect(out[0]?.sets[1]).toMatchObject({ weightKg: 50, reps: 10 })
  })

  it('mergeBlockWithNext синхронизирует раунды по максимуму подходов', () => {
    const a: WorkoutExerciseDraft = { ...draft('a', 'b1', 'single'), sets: [{ position: 0 }, { position: 1 }] }
    const b: WorkoutExerciseDraft = { ...draft('b', 'b2', 'single'), sets: [{ position: 0 }] }
    const out = mergeBlockWithNext([a, b], 0)
    expect(out.every((e) => e.blockRounds === 2)).toBe(true)
    expect(out.every((e) => e.sets.length === 2)).toBe(true)
  })
})

describe('blockRoundsView / currentRoundIndex', () => {
  const s = (id: string, position: number, confirmed = false): WorkoutSet => ({ id, position, fact: {}, confirmedAt: confirmed ? 'now' : null, version: 1 })
  const block = {
    blockId: 'b1', blockType: 'superset' as const, blockRounds: 2,
    exercises: [exercise('a', 0, 'b1', 'superset', [s('a1', 0), s('a2', 1)]), exercise('b', 1, 'b1', 'superset', [s('b1', 0), s('b2', 1)])],
  }
  it('раскладывает блок по кругам: круг R = по одному подходу каждого упражнения', () => {
    const rounds = blockRoundsView(block)
    expect(rounds.map((r) => ({ round: r.round, sets: r.items.map((i) => i.set.id) }))).toEqual([
      { round: 1, sets: ['a1', 'b1'] },
      { round: 2, sets: ['a2', 'b2'] },
    ])
  })
  it('currentRoundIndex — первый круг с неподтверждённым подходом', () => {
    // круг 1 полностью подтверждён, круг 2 нет
    const b = { ...block, exercises: [exercise('a', 0, 'b1', 'superset', [s('a1', 0, true), s('a2', 1)]), exercise('b', 1, 'b1', 'superset', [s('b1', 0, true), s('b2', 1)])] }
    expect(currentRoundIndex(blockRoundsView(b))).toBe(1)
  })
  it('currentRoundIndex = последний, если все круги подтверждены', () => {
    const b = { ...block, exercises: [exercise('a', 0, 'b1', 'superset', [s('a1', 0, true), s('a2', 1, true)]), exercise('b', 1, 'b1', 'superset', [s('b1', 0, true), s('b2', 1, true)])] }
    expect(currentRoundIndex(blockRoundsView(b))).toBe(1)
  })
})
