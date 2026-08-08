import { describe, expect, it } from 'vitest'
import type { ExerciseSnapshot, InputKind, Workout, WorkoutExerciseDraft, WorkoutSet, WorkoutStatus, WorkoutSummary } from '../../shared/domain'
import { bmiLabel, bmiValue, canTransition, chartUnitFor, clientWorkoutStatusLabel, compactPlannedSetSummary, completedWorkoutDraft, computeClientStats, copyWorkout, ensureBlockIds, enteredFactLine, exerciseChartPoints, exerciseSummary, formatFactVsPlan, factLine, groupDraftsIntoBlocks, groupIntoBlocks, isLastSetOfBlock, blockRoundsView, currentRoundIndex, blockLabel, mergeBlockWithNext, moveBlock, muscleGroupLabels, previousResultLine, replaceExercise, syncBlockRounds, draftBlockRoundsView, nextSetDraft, setBlockPreset, splitBlock, splitClientWorkouts, tonnageLabel, workoutStatusPresentation, workoutDurationLabel, workoutTonnage } from './workout-rules'
import { localDate } from '../../shared/local-date'

function summary(date: string, status: WorkoutStatus, id = date): WorkoutSummary {
  return { id, workoutDate: localDate(date), status }
}

function bareWorkout(date: string, status: WorkoutStatus): Workout {
  return {
    id: date + status, clientId: 'c1', clientName: 'Клиент', workoutDate: localDate(date),
    startTime: null, endTime: null, startedAt: null, completedAt: null, status, notes: null, stageId: null, stageTitle: null, version: 1, exercises: [],
  }
}

const TODAY = localDate('2026-07-22')

describe('workouts repository rules', () => {
  it('сворачивает одинаковый план и оставляет разные подходы подробными', () => {
    const base = (position: number, reps = 10): WorkoutSet => ({ id: `compact-${position}`, position, weightKg: 150, reps, fact: {}, confirmedAt: null, version: 1 })
    expect(compactPlannedSetSummary([base(0), base(1), base(2)])).toBe('3 × 150 кг × 10 повт.')
    expect(compactPlannedSetSummary([base(0), base(1, 8)])).toBeNull()
    expect(compactPlannedSetSummary([{ id: 'duration', position: 0, durationSec: 300, fact: {}, confirmedAt: null, version: 1 }])).toBe('5:00')
  })

  it('показывает последний заполненный результат без RPE', () => {
    expect(previousResultLine([
      { position: 0, weightKg: 50, reps: 10, rpe: 7 },
      { position: 1 },
      { position: 2, weightKg: 55, reps: 8, rpe: 8 },
    ])).toBe('55 кг × 8 повт.')
    expect(previousResultLine([{ position: 0 }])).toBeNull()
  })

  it('разрешает только последовательные переходы', () => {
    expect(canTransition('planned', 'in_progress')).toBe(true)
    expect(canTransition('planned', 'done')).toBe(false)
    expect(canTransition('in_progress', 'done')).toBe(true)
  })

  it('копирует факт завершённой тренировки как план без идентификаторов', () => {
    const source: Workout = {
      id: 'w1', clientId: 'c1', clientName: 'Анна', workoutDate: localDate('2026-07-21'),
      startTime: null, endTime: null, startedAt: null, completedAt: null, status: 'done', notes: null, stageId: null, stageTitle: null, version: 3,
      exercises: [{ id: 'e1', source: 'system', ref: 'squat', name: 'Присед', muscleGroup: 'legs', inputKind: 'strength', position: 0, blockId: 'b1', blockType: 'single', blockPreset: 'set', blockRounds: 1, restBetweenExercisesSec: 0, restBetweenRoundsSec: 90, restBetweenSetsSec: 90,
        sets: [{ id: 's1', position: 0, weightKg: 50, reps: 10, fact: { weightKg: 55, reps: 9 }, confirmedAt: 'now', version: 2 }] }],
    }
    const copy = copyWorkout(source, localDate('2026-07-22'))
    expect(copy.id).toBeUndefined()
    expect(copy.exercises[0]?.sets[0]).toEqual({ position: 0, weightKg: 55, reps: 9, durationMin: undefined, distanceKm: undefined })
  })

  it('открывает завершённую тренировку для правки по фактическим значениям', () => {
    const source: Workout = {
      id: 'w1', clientId: 'c1', clientName: 'Анна', workoutDate: localDate('2026-07-21'),
      startTime: null, endTime: null, startedAt: null, completedAt: 'now', status: 'done', notes: null, stageId: null, stageTitle: null, version: 3,
      exercises: [{ id: 'e1', source: 'system', ref: 'squat', name: 'Присед', muscleGroup: 'legs', inputKind: 'strength', position: 0, blockId: 'b1', blockType: 'single', blockPreset: 'set', blockRounds: 1, restBetweenExercisesSec: 0, restBetweenRoundsSec: 90, restBetweenSetsSec: 90,
        sets: [{ id: 's1', position: 0, weightKg: 50, reps: 10, fact: { weightKg: 55, reps: 9, rpe: 8 }, confirmedAt: 'now', version: 2 }] }],
    }
    const draft = completedWorkoutDraft(source)
    expect(draft.exercises[0]).toMatchObject({ sourceExerciseId: 'e1' })
    expect(draft.exercises[0]?.sets[0]).toMatchObject({ sourceSetId: 's1', weightKg: 55, reps: 9, rpe: 8 })
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
    startTime: null, endTime: null, startedAt: null, completedAt: null, status: 'done', notes: null, stageId: null, stageTitle: null, version: 1,
    exercises: [{ id: `e-${date}`, source: 'system', ref, name: ref, muscleGroup: 'legs', inputKind, position: 0, blockId: `b-${date}`, blockType: 'single', blockPreset: 'set', blockRounds: 1, restBetweenExercisesSec: 0, restBetweenRoundsSec: 90, restBetweenSetsSec: 90, sets }],
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

  it('несколько тренировок в один день → одна точка с лучшим результатом (без дублей дат)', () => {
    const workouts = [
      workoutWith('2026-07-27', 'squat', 'strength', [set({ weightKg: 100 })]),
      workoutWith('2026-07-27', 'squat', 'strength', [set({ weightKg: 110 })]),
      workoutWith('2026-07-27', 'squat', 'strength', [set({ weightKg: 95 })]),
    ]
    expect(exerciseChartPoints(workouts, 'squat')).toEqual([{ date: '2026-07-27', value: 110 }])
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

  it('строго по факту: подход только с планом (без факта) пропускается', () => {
    const workouts = [workoutWith('2026-07-15', 'squat', 'strength', [planSet(70), planSet(75, 1)])]
    expect(exerciseChartPoints(workouts, 'squat')).toEqual([])
  })

  it('строго по факту: плановая дистанция без факта не даёт точку', () => {
    const plan: WorkoutSet = { id: 'pd', position: 0, distanceKm: 8, fact: {}, confirmedAt: null, version: 1 }
    const workouts = [workoutWith('2026-07-15', 'run', 'distance', [plan])]
    expect(exerciseChartPoints(workouts, 'run')).toEqual([])
  })

  it('строго по факту: плановые повторы без факта не дают точку', () => {
    const plan: WorkoutSet = { id: 'pr', position: 0, reps: 30, fact: {}, confirmedAt: null, version: 1 }
    const workouts = [workoutWith('2026-07-15', 'burpee', 'reps', [plan])]
    expect(exerciseChartPoints(workouts, 'burpee')).toEqual([])
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

describe('clientWorkoutStatusLabel', () => {
  it('does not call a past plan or stale live workout completed', () => {
    expect(clientWorkoutStatusLabel(bareWorkout('2026-07-30', 'planned'), TODAY)).toBe('План')
    expect(clientWorkoutStatusLabel(bareWorkout('2026-07-20', 'planned'), TODAY)).toBe('Пропущена')
    expect(clientWorkoutStatusLabel(bareWorkout('2026-07-22', 'in_progress'), TODAY)).toBe('Идёт')
    expect(clientWorkoutStatusLabel(bareWorkout('2026-07-20', 'in_progress'), TODAY)).toBe('Не завершена')
    expect(clientWorkoutStatusLabel(bareWorkout('2026-07-20', 'done'), TODAY)).toBe('Готово')
  })

  it('marks a completed workout with unconfirmed sets as partial', () => {
    const partial: Workout = {
      ...bareWorkout('2026-07-20', 'done'),
      exercises: [{
        id: 'exercise-1', source: 'system', ref: 'squat', name: 'Присед', muscleGroup: 'legs', inputKind: 'strength', position: 0,
        blockId: 'block-1', blockType: 'single', blockPreset: 'set', blockRounds: 1, restBetweenExercisesSec: 0, restBetweenRoundsSec: 90, restBetweenSetsSec: 90,
        sets: [
          { id: 'set-1', position: 0, fact: {}, confirmedAt: '2026-07-20T10:00:00.000Z', version: 2 },
          { id: 'set-2', position: 1, fact: {}, confirmedAt: null, version: 1 },
        ],
      }],
    }

    expect(workoutStatusPresentation(partial, TODAY)).toEqual({ label: 'Частично', tone: 'partial' })
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
  it('суммирует вес × повторы только по подтверждённым фактическим подходам', () => {
    const workout = workoutWith('2026-07-20', 'squat', 'strength', [
      set({ weightKg: 60, reps: 10 }),       // факт 60×10 = 600
      { id: 'p', position: 1, weightKg: 50, reps: 8, fact: {}, confirmedAt: null, version: 1 }, // план 50×8 = 400
    ])
    expect(workoutTonnage(workout)).toBe(600)
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
        { id: 'e1', source: 'system', ref: 'squat', name: 'Присед', muscleGroup: 'legs', inputKind: 'strength', position: 0, blockId: 'b1', blockType: 'single', blockPreset: 'set', blockRounds: 1, restBetweenExercisesSec: 0, restBetweenRoundsSec: 90, restBetweenSetsSec: 90, sets: [] },
        { id: 'e2', source: 'system', ref: 'bench', name: 'Жим', muscleGroup: 'chest', inputKind: 'strength', position: 1, blockId: 'b2', blockType: 'single', blockPreset: 'set', blockRounds: 1, restBetweenExercisesSec: 0, restBetweenRoundsSec: 90, restBetweenSetsSec: 90, sets: [] },
        { id: 'e3', source: 'system', ref: 'lunge', name: 'Выпад', muscleGroup: 'legs', inputKind: 'strength', position: 2, blockId: 'b3', blockType: 'single', blockPreset: 'set', blockRounds: 1, restBetweenExercisesSec: 0, restBetweenRoundsSec: 90, restBetweenSetsSec: 90, sets: [] },
      ],
    }
    expect(muscleGroupLabels(workout)).toEqual(['Ноги', 'Грудь'])
  })
})

describe('exerciseSummary', () => {
  const wk = (exercises: Workout['exercises']): Workout => ({ ...workoutWith('2026-07-20', 'squat', 'strength', []), exercises })
  const ex = (id: string, name: string, comment?: string): Workout['exercises'][number] =>
    ({ id, source: 'system', ref: id, name, muscleGroup: 'legs', inputKind: 'strength', position: 0, blockId: id, blockType: 'single', blockPreset: 'set', blockRounds: 1, restBetweenExercisesSec: 0, restBetweenRoundsSec: 90, restBetweenSetsSec: 90, trainerComment: comment, sets: [] })

  it('возвращает упражнения без дублей, каждое со своим комментарием', () => {
    expect(exerciseSummary(wk([ex('a', 'Присед', 'Спина прямо'), ex('b', 'Жим'), ex('c', 'Присед')]))).toEqual([
      { name: 'Присед', comment: 'Спина прямо' },
      { name: 'Жим', comment: null },
    ])
  })
  it('дубль по имени подтягивает комментарий, если у первого его не было', () => {
    expect(exerciseSummary(wk([ex('a', 'Присед'), ex('c', 'Присед', 'Глубже')]))).toEqual([
      { name: 'Присед', comment: 'Глубже' },
    ])
  })
  it('без упражнений → пустой список', () => {
    expect(exerciseSummary(wk([]))).toEqual([])
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

function exercise(id: string, position: number, blockId: string, blockType: 'single'|'group', sets: WorkoutSet[] = []): Workout['exercises'][number] {
  return { id, source: 'system', ref: id, name: id, muscleGroup: 'legs', inputKind: 'strength', position, blockId, blockType, blockPreset: 'set', blockRounds: Math.max(1, sets.length), restBetweenExercisesSec: 0, restBetweenRoundsSec: 90, restBetweenSetsSec: 90, sets }
}
function workoutWithExercises(exercises: Workout['exercises']): Workout {
  return { id: 'w', clientId: 'c1', clientName: 'К', workoutDate: localDate('2026-07-20'), startTime: null, endTime: null, startedAt: null, completedAt: null, status: 'in_progress', notes: null, stageId: null, stageTitle: null, version: 1, exercises }
}

describe('groupIntoBlocks', () => {
  it('группирует упражнения по blockId, сохраняя порядок', () => {
    const blocks = groupIntoBlocks([
      exercise('a', 0, 'b1', 'single'),
      exercise('b', 1, 'b2', 'group'),
      exercise('c', 2, 'b2', 'group'),
      exercise('d', 3, 'b3', 'single'),
    ])
    expect(blocks.map((b) => ({ type: b.blockType, ids: b.exercises.map((e) => e.id) }))).toEqual([
      { type: 'single', ids: ['a'] },
      { type: 'group', ids: ['b', 'c'] },
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
      exercise('a', 0, 'b1', 'group', [s('a1', 0)]),
      exercise('b', 1, 'b1', 'group', [s('b1', 0)]),
    ])
    expect(isLastSetOfBlock(w, 'a', 'a1')).toBe(false) // первое упражнение блока
    expect(isLastSetOfBlock(w, 'b', 'b1')).toBe(true)  // последнее упражнение блока
  })
})

describe('copyWorkout blocks', () => {
  it('сохраняет тип блока и объединяет упражнения одного блока новым общим id', () => {
    const source = workoutWithExercises([
      exercise('a', 0, 'b1', 'group', [{ id: 'x', position: 0, weightKg: 50, fact: {}, confirmedAt: null, version: 1 }]),
      exercise('b', 1, 'b1', 'group', [{ id: 'y', position: 0, weightKg: 40, fact: {}, confirmedAt: null, version: 1 }]),
    ])
    const draft = copyWorkout(source)
    expect(draft.exercises.map((e) => e.blockType)).toEqual(['group', 'group'])
    // оба упражнения блока получили один и тот же новый blockId
    expect(draft.exercises[0]?.blockId).toBe(draft.exercises[1]?.blockId)
    expect(draft.exercises[0]?.blockId).not.toBe('b1')
  })
})

function draft(ref: string, blockId?: string, blockType?: 'single'|'group'): WorkoutExerciseDraft {
  return { source: 'system', ref, name: ref, muscleGroup: 'legs', inputKind: 'strength', position: 0, blockId, blockType, sets: [{ position: 0 }] }
}

describe('draft blocks', () => {
  it('ensureBlockIds проставляет id и single там, где нет', () => {
    const out = ensureBlockIds([draft('a'), draft('b', 'x', 'group')])
    expect(out[0]?.blockId).toBeTruthy()
    expect(out[0]?.blockType).toBe('single')
    expect(out[1]?.blockId).toBe('x')
    expect(out[1]?.blockType).toBe('group')
  })

  it('mergeBlockWithNext объединяет два одиночных в группу «Сет» с общим id и дефолтами отдыха', () => {
    const out = mergeBlockWithNext([draft('a', 'b1', 'single'), draft('b', 'b2', 'single')], 0)
    expect(out[0]?.blockId).toBe(out[1]?.blockId)
    expect(out.every((e) => e.blockType === 'group' && e.blockPreset === 'set')).toBe(true)
    // Сет: отдых между упражнениями 0, между кругами 90.
    expect(out.every((e) => e.restBetweenExercisesSec === 0 && e.restBetweenRoundsSec === 90)).toBe(true)
  })

  it('mergeBlockWithNext присоединяет к существующему многоэлементному блоку с его типом', () => {
    // a,b — трисет b1; c — одиночный. Объединяем b(index1) со следующим c.
    const start = [draft('a', 'b1', 'group'), draft('b', 'b1', 'group'), draft('c', 'b2', 'single')]
    const out = mergeBlockWithNext(start, 1)
    expect(new Set(out.map((e) => e.blockId)).size).toBe(1)
    expect(out.every((e) => e.blockType === 'group')).toBe(true)
  })

  it('splitBlock разбивает блок на одиночные', () => {
    const out = splitBlock([draft('a', 'b1', 'group'), draft('b', 'b1', 'group')], 'b1')
    expect(out[0]?.blockId).not.toBe(out[1]?.blockId)
    expect(out.every((e) => e.blockType === 'single')).toBe(true)
  })

  it('setBlockPreset меняет пресет блока и подставляет дефолты отдыха', () => {
    const out = setBlockPreset([draft('a', 'b1', 'group'), draft('b', 'b1', 'group')], 'b1', 'circuit')
    expect(out.every((e) => e.blockPreset === 'circuit')).toBe(true)
    // Круговая: дефолты отдыха между упражнениями 15с, между кругами 60с.
    expect(out.every((e) => e.restBetweenExercisesSec === 15 && e.restBetweenRoundsSec === 60)).toBe(true)
  })

  it('blockLabel: одиночное → «Обычный», группа → по пресету', () => {
    expect(blockLabel('single', 'set')).toBe('Обычный')
    expect(blockLabel('group', 'set')).toBe('Сет')
    expect(blockLabel('group', 'circuit')).toBe('Круговая')
  })

  it('groupDraftsIntoBlocks группирует по blockId, сохраняя индексы', () => {
    const blocks = groupDraftsIntoBlocks([draft('a', 'b1', 'group'), draft('b', 'b1', 'group'), draft('c', 'b2', 'single')])
    expect(blocks.map((b) => ({ type: b.blockType, refs: b.items.map((i) => i.exercise.ref), idx: b.items.map((i) => i.index) }))).toEqual([
      { type: 'group', refs: ['a', 'b'], idx: [0, 1] },
      { type: 'single', refs: ['c'], idx: [2] },
    ])
  })
})

describe('block rounds', () => {
  it('syncBlockRounds выставляет N подходов всем упражнениям блока', () => {
    const start = [draft('a', 'b1', 'group'), draft('b', 'b1', 'group')]
    const out = syncBlockRounds(start, 'b1', 3)
    expect(out.every((e) => e.blockRounds === 3)).toBe(true)
    expect(out.every((e) => e.sets.length === 3)).toBe(true)
    expect(out.map((e) => e.sets.map((s) => s.position))).toEqual([[0, 1, 2], [0, 1, 2]])
  })

  it('syncBlockRounds срезает лишние подходы и не опускается ниже 1', () => {
    const withThree: WorkoutExerciseDraft = { ...draft('a', 'b1', 'group'), sets: [{ position: 0 }, { position: 1 }, { position: 2 }] }
    expect(syncBlockRounds([withThree], 'b1', 1)[0]?.sets.length).toBe(1)
    expect(syncBlockRounds([withThree], 'b1', 0)[0]?.sets.length).toBe(1)
  })

  it('syncBlockRounds наследует параметры предыдущего подхода при добавлении', () => {
    const withWeight: WorkoutExerciseDraft = { ...draft('a', 'b1', 'group'), sets: [{ position: 0, weightKg: 50, reps: 10 }] }
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
    blockId: 'b1', blockType: 'group' as const, blockPreset: 'set' as const, blockRounds: 2,
    restBetweenExercisesSec: 0, restBetweenRoundsSec: 90,
    exercises: [exercise('a', 0, 'b1', 'group', [s('a1', 0), s('a2', 1)]), exercise('b', 1, 'b1', 'group', [s('b1', 0), s('b2', 1)])],
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
    const b = { ...block, exercises: [exercise('a', 0, 'b1', 'group', [s('a1', 0, true), s('a2', 1)]), exercise('b', 1, 'b1', 'group', [s('b1', 0, true), s('b2', 1)])] }
    expect(currentRoundIndex(blockRoundsView(b))).toBe(1)
  })
  it('currentRoundIndex = последний, если все круги подтверждены', () => {
    const b = { ...block, exercises: [exercise('a', 0, 'b1', 'group', [s('a1', 0, true), s('a2', 1, true)]), exercise('b', 1, 'b1', 'group', [s('b1', 0, true), s('b2', 1, true)])] }
    expect(currentRoundIndex(blockRoundsView(b))).toBe(1)
  })
})

describe('draftBlockRoundsView', () => {
  it('раскладывает черновик-блок по кругам: круг = все упражнения по очереди', () => {
    const a: WorkoutExerciseDraft = { ...draft('a', 'b1', 'group'), sets: [{ position: 0, weightKg: 90 }, { position: 1, weightKg: 90 }] }
    const b: WorkoutExerciseDraft = { ...draft('b', 'b1', 'group'), sets: [{ position: 0, weightKg: 40 }, { position: 1, weightKg: 40 }] }
    const block = groupDraftsIntoBlocks([a, b])[0]!
    const rounds = draftBlockRoundsView(block)
    expect(rounds.map((r) => ({ round: r.round, items: r.items.map((i) => ({ ref: i.exercise.ref, exerciseIndex: i.exerciseIndex, setIndex: i.setIndex })) }))).toEqual([
      { round: 1, items: [{ ref: 'a', exerciseIndex: 0, setIndex: 0 }, { ref: 'b', exerciseIndex: 1, setIndex: 0 }] },
      { round: 2, items: [{ ref: 'a', exerciseIndex: 0, setIndex: 1 }, { ref: 'b', exerciseIndex: 1, setIndex: 1 }] },
    ])
  })
})

describe('formatFactVsPlan', () => {
  const mk = (plan: Partial<WorkoutSet>, fact: WorkoutSet['fact']): WorkoutSet => ({ id: 's', position: 0, ...plan, fact, confirmedAt: 'now', version: 1 })
  it('факт = план → без приписки', () => {
    expect(formatFactVsPlan(mk({ weightKg: 50, reps: 10 }, { weightKg: 50, reps: 10 }))).toEqual({ fact: '50 кг × 10 повт.', planNote: null })
  })
  it('вес отличается → приписка плана', () => {
    expect(formatFactVsPlan(mk({ weightKg: 50, reps: 10 }, { weightKg: 45, reps: 10 }))).toEqual({ fact: '45 кг × 10 повт.', planNote: 'план 50 кг × 10 повт.' })
  })
  it('повторы отличаются → приписка плана', () => {
    expect(formatFactVsPlan(mk({ weightKg: 50, reps: 10 }, { weightKg: 50, reps: 8 }))).toEqual({ fact: '50 кг × 8 повт.', planNote: 'план 50 кг × 10 повт.' })
  })
  it('факт не введён → показываем план как факт, без приписки', () => {
    expect(formatFactVsPlan(mk({ weightKg: 50, reps: 10 }, {}))).toEqual({ fact: '50 кг × 10 повт.', planNote: null })
  })
  it('нет ни плана, ни факта → «Без результата»', () => {
    expect(formatFactVsPlan(mk({}, {}))).toEqual({ fact: 'Без результата', planNote: null })
  })
  it('скрывает RPE без пустой приписки плана', () => {
    expect(formatFactVsPlan(mk({ weightKg: 50, reps: 10, rpe: 8 }, { weightKg: 50, reps: 10, rpe: 9 }), false)).toEqual({ fact: '50 кг × 10 повт.', planNote: null })
  })
})

describe('factLine', () => {
  const mk = (plan: Partial<WorkoutSet>, fact: WorkoutSet['fact'], confirmedAt: string | null): WorkoutSet =>
    ({ id: 's', position: 0, ...plan, fact, confirmedAt, version: 1 })
  it('подтверждённый подход с фактом → строка факта', () => {
    expect(factLine(mk({ weightKg: 50, reps: 10 }, { weightKg: 55, reps: 8 }, 'now'))).toBe('55 кг × 8 повт.')
  })
  it('неподтверждённый подход → null (план за факт не выдаём)', () => {
    expect(factLine(mk({ weightKg: 50, reps: 10 }, {}, null))).toBeNull()
    // Даже если план есть, но подход не закрыт — факта нет.
    expect(factLine(mk({ weightKg: 50, reps: 10 }, { weightKg: 50, reps: 10 }, null))).toBeNull()
  })
  it('введённый неподтверждённый подход можно показать в live, но не как выполненный', () => {
    const set = mk({ weightKg: 50, reps: 10 }, { weightKg: 37.5, reps: 11 }, null)
    expect(enteredFactLine(set)).toBe('37.5 кг × 11 повт.')
    expect(factLine(set)).toBeNull()
  })
  it('подтверждён, но факт пустой → null', () => {
    expect(factLine(mk({ weightKg: 50, reps: 10 }, {}, 'now'))).toBeNull()
  })
  it('может скрыть RPE в истории, не меняя факт', () => {
    expect(factLine(mk({ weightKg: 50, reps: 10, rpe: 8 }, { weightKg: 55, reps: 8, rpe: 9 }, 'now'), false)).toBe('55 кг × 8 повт.')
  })
})

describe('moveBlock', () => {
  it('двигает одиночный блок вниз, пересчитывая position', () => {
    const out = moveBlock([draft('a', 'b1', 'single'), draft('b', 'b2', 'single'), draft('c', 'b3', 'single')], 'b1', 1)
    expect(out.map((e) => ({ ref: e.ref, position: e.position }))).toEqual([
      { ref: 'b', position: 0 }, { ref: 'a', position: 1 }, { ref: 'c', position: 2 },
    ])
  })
  it('двигает блок вверх', () => {
    const out = moveBlock([draft('a', 'b1', 'single'), draft('b', 'b2', 'single'), draft('c', 'b3', 'single')], 'b3', -1)
    expect(out.map((e) => e.ref)).toEqual(['a', 'c', 'b'])
  })
  it('многоэлементный блок двигается целиком, сохраняя внутренний порядок', () => {
    const start = [draft('x', 'solo', 'single'), draft('a', 'sup', 'group'), draft('b', 'sup', 'group')]
    const out = moveBlock(start, 'sup', -1)
    expect(out.map((e) => e.ref)).toEqual(['a', 'b', 'x'])
    expect(out.map((e) => e.position)).toEqual([0, 1, 2])
  })
  it('на границах — без изменений', () => {
    const start = [draft('a', 'b1', 'single'), draft('b', 'b2', 'single')]
    expect(moveBlock(start, 'a', -1).map((e) => e.ref)).toEqual(['a', 'b'])
    expect(moveBlock(start, 'b', 1).map((e) => e.ref)).toEqual(['a', 'b'])
  })
})

describe('replaceExercise', () => {
  const bench: ExerciseSnapshot = { source: 'system', ref: 'bench', name: 'Жим лёжа', muscleGroup: 'chest', inputKind: 'strength' }
  const run: ExerciseSnapshot = { source: 'system', ref: 'run', name: 'Бег', muscleGroup: 'cardio', inputKind: 'distance' }

  it('подменяет идентичность, сохраняя position/блок/подходы при том же типе', () => {
    const start: WorkoutExerciseDraft[] = [
      { source: 'system', ref: 'squat', name: 'Присед', muscleGroup: 'legs', inputKind: 'strength', position: 0, blockId: 'b1', blockType: 'group', blockRounds: 3, sets: [{ position: 0, weightKg: 50, reps: 10 }, { position: 1, weightKg: 55, reps: 8 }] },
      { source: 'system', ref: 'row', name: 'Тяга', muscleGroup: 'back', inputKind: 'strength', position: 1, blockId: 'b1', blockType: 'group', blockRounds: 3, sets: [{ position: 0 }] },
    ]
    const out = replaceExercise(start, 0, bench)
    expect(out[0]).toMatchObject({ ref: 'bench', name: 'Жим лёжа', muscleGroup: 'chest', inputKind: 'strength', position: 0, blockId: 'b1', blockType: 'group', blockRounds: 3 })
    // Тот же тип — значения подходов сохраняются.
    expect(out[0]!.sets).toEqual([{ position: 0, weightKg: 50, reps: 10 }, { position: 1, weightKg: 55, reps: 8 }])
    // Остальные упражнения не тронуты.
    expect(out[1]).toEqual(start[1])
  })

  it('очищает значения подходов при смене типа, сохраняя их число', () => {
    const start: WorkoutExerciseDraft[] = [
      { source: 'system', ref: 'squat', name: 'Присед', muscleGroup: 'legs', inputKind: 'strength', position: 0, blockId: 'b1', blockType: 'single', blockPreset: 'set', blockRounds: 1, restBetweenExercisesSec: 0, restBetweenRoundsSec: 90, restBetweenSetsSec: 90, sets: [{ position: 0, weightKg: 50, reps: 10 }, { position: 1, weightKg: 55, reps: 8 }] },
    ]
    const out = replaceExercise(start, 0, run)
    expect(out[0]).toMatchObject({ ref: 'run', inputKind: 'distance', position: 0, blockId: 'b1' })
    // Число подходов то же, значения очищены.
    expect(out[0]!.sets).toEqual([{ position: 0 }, { position: 1 }])
  })

  it('при замене завершённого упражнения очищает факт даже при том же типе', () => {
    const start: WorkoutExerciseDraft[] = [{
      source: 'system', ref: 'squat', name: 'Присед', muscleGroup: 'legs', inputKind: 'strength',
      sourceExerciseId: 'exercise-1', position: 0,
      sets: [{ sourceSetId: 'set-1', position: 0, weightKg: 80, reps: 8, rpe: 9 }],
    }]
    const out = replaceExercise(start, 0, bench, undefined, { clearFact: true })
    expect(out[0]).toMatchObject({ ref: 'bench', clearFact: true, sourceExerciseId: 'exercise-1' })
    expect(out[0]!.sets).toEqual([{ sourceSetId: 'set-1', position: 0 }])
  })

  it('при замене может подставить все подходы из последнего выполнения', () => {
    const start: WorkoutExerciseDraft[] = [{ source: 'system', ref: 'squat', name: 'Присед', muscleGroup: 'legs', inputKind: 'strength', position: 0, sets: [{ position: 0 }] }]
    const out = replaceExercise(start, 0, bench, {
      prefilledFromDate: localDate('2026-07-28'),
      sets: [{ position: 0, weightKg: 70, reps: 7, rpe: 8 }, { position: 1, weightKg: 65, reps: 8 }],
    })
    expect(out[0]!.prefilledFromDate).toBe('2026-07-28')
    expect(out[0]!.sets).toEqual([{ position: 0, weightKg: 70, reps: 7, rpe: 8 }, { position: 1, weightKg: 65, reps: 8 }])
  })

  it('сохраняет customExerciseId при замене на кастомное и убирает при системном', () => {
    const custom: ExerciseSnapshot = { source: 'custom', ref: 'x', customExerciseId: 'cust-1', name: 'Своё', muscleGroup: 'legs', inputKind: 'strength' }
    const start: WorkoutExerciseDraft[] = [{ source: 'custom', ref: 'y', customExerciseId: 'cust-0', name: 'Старое', muscleGroup: 'legs', inputKind: 'strength', position: 0, sets: [{ position: 0 }] }]
    expect(replaceExercise(start, 0, custom)[0]).toMatchObject({ source: 'custom', customExerciseId: 'cust-1' })
    expect(replaceExercise(start, 0, bench)[0]!.customExerciseId).toBeUndefined()
  })

  it('несуществующий индекс — список без изменений', () => {
    const start = [draft('a')]
    expect(replaceExercise(start, 5, bench)).toEqual(start)
  })
})
