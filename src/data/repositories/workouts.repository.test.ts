import { describe, expect, it } from 'vitest'
import type { InputKind, Workout, WorkoutSet, WorkoutStatus, WorkoutSummary } from '../../shared/domain'
import { bmiLabel, bmiValue, canTransition, chartUnitFor, computeClientStats, copyWorkout, exerciseChartPoints, muscleGroupLabels, nextSetDraft, splitClientWorkouts, tonnageLabel, workoutDurationLabel, workoutTonnage } from './workout-rules'
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
      exercises: [{ id: 'e1', source: 'system', ref: 'squat', name: 'Присед', muscleGroup: 'legs', inputKind: 'strength', position: 0,
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
    exercises: [{ id: `e-${date}`, source: 'system', ref, name: ref, muscleGroup: 'legs', inputKind, position: 0, sets }],
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
        { id: 'e1', source: 'system', ref: 'squat', name: 'Присед', muscleGroup: 'legs', inputKind: 'strength', position: 0, sets: [] },
        { id: 'e2', source: 'system', ref: 'bench', name: 'Жим', muscleGroup: 'chest', inputKind: 'strength', position: 1, sets: [] },
        { id: 'e3', source: 'system', ref: 'lunge', name: 'Выпад', muscleGroup: 'legs', inputKind: 'strength', position: 2, sets: [] },
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
