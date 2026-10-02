import type { AchievementKind } from './athlete-achievements'
import type { Workout, WorkoutExercise } from './domain'
import { EXERCISE_CATALOG_DECISIONS } from './exercise-catalog-decisions'
import { SYSTEM_EXERCISE_CATALOG } from './system-exercises'
import { addDays, daysBetween, weekdayIndex, type LocalDate } from './local-date'

const catalog = new Map(SYSTEM_EXERCISE_CATALOG.map((exercise) => [exercise.ref, exercise]))
const monday = (date: LocalDate) => addDays(date, -((weekdayIndex(date) + 6) % 7))
const monthNumber = (date: LocalDate) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1
const positive = (value: number | undefined) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
type Mode = 'run' | 'bike' | 'row' | 'ellipse' | 'rope'
type Activity = { date: LocalDate; week: LocalDate; month: number; categories: Set<string>; modes: Set<Mode>; equipment: Set<string> }

function movementRef(exercise: WorkoutExercise): string | null {
  if (exercise.source !== 'system' || exercise.customExerciseId) return null
  let ref = exercise.ref
  const visited = new Set<string>()
  while (EXERCISE_CATALOG_DECISIONS[ref]?.target && !visited.has(ref)) {
    visited.add(ref)
    ref = EXERCISE_CATALOG_DECISIONS[ref]!.target!
  }
  return ref === 'vital-treadmill-running' ? 'running' : ref === 'vital-gym-pro-r322-1365' ? 'elliptical' : ref
}

const modes: Readonly<Record<string, Mode>> = { running: 'run', 'stationary-bike': 'bike', 'rowing-machine': 'row', elliptical: 'ellipse', 'jump-rope': 'rope' }

function consecutive<K>(counts: Map<K, Set<LocalDate>>, current: K, previous: (key: K) => K, minimum: number): number {
  // The unfinished current period does not break a run until that period ends.
  let key = (counts.get(current)?.size ?? 0) >= minimum ? current : previous(current)
  let count = 0
  while ((counts.get(key)?.size ?? 0) >= minimum) { count += 1; key = previous(key) }
  return count
}

/** Incremental confirmed facts; calendar windows are evaluated in the caller's athlete timezone. */
export function createAchievementActivity() {
  const weekly = new Map<LocalDate, Set<LocalDate>>()
  const monthly = new Map<number, Set<LocalDate>>()
  const events: Activity[] = []
  const totals: Partial<Record<AchievementKind, number>> = {}
  let returned: LocalDate | null = null
  const returnDays = new Set<LocalDate>()
  function add(workout: Workout, date: LocalDate, afterBreak: boolean) {
    const week = monday(date)
    const month = monthNumber(date)
    const weekDays = weekly.get(week) ?? new Set<LocalDate>()
    weekDays.add(date); weekly.set(week, weekDays)
    const monthDays = monthly.get(month) ?? new Set<LocalDate>()
    monthDays.add(date); monthly.set(month, monthDays)
    if (afterBreak) { returned = date; returnDays.clear() }
    if (returned && daysBetween(returned, date) <= 14) returnDays.add(date)
    const event: Activity = { date, week, month, categories: new Set(), modes: new Set(), equipment: new Set() }
    let runKm = 0
    for (const exercise of workout.exercises) {
      const facts = exercise.sets.filter((set) => set.confirmedAt &&
        (positive(set.fact.reps) || positive(set.fact.durationSec) || positive(set.fact.durationMin) || positive(set.fact.distanceKm)))
      if (!facts.length) continue
      const ref = movementRef(exercise)
      const mode = ref ? modes[ref] : undefined
      if (mode) event.modes.add(mode)
      const metadata = exercise.source === 'system' ? catalog.get(exercise.ref) : undefined
      const stretch = metadata?.name.startsWith('Растяжка') || ref === 'dynamic-hamstring-stretch'
      const cardio = Boolean(mode) || exercise.muscleGroup === 'cardio' || exercise.inputKind === 'distance'
      const strength = !stretch && !cardio && (exercise.inputKind === 'strength' || exercise.inputKind === 'reps' || ref === 'plank')
      if (stretch) event.categories.add('stretch')
      if (cardio) event.categories.add('cardio')
      if (strength) {
        event.categories.add('strength')
        const rawEquipment = metadata?.equipmentRef ?? exercise.equipmentRef
        const equipment = rawEquipment === 'cable' ? 'machine' : rawEquipment === 'e-z curl bar' ? 'barbell' : rawEquipment
        if (equipment === 'barbell' || equipment === 'dumbbell' || equipment === 'machine') event.equipment.add(equipment)
      }
      for (const { fact } of facts) {
        if (mode === 'run') runKm += positive(fact.distanceKm)
        const kind = mode === 'rope' ? 'rope-reps' : ref === 'push-ups' ? 'push-reps' : ref === 'pull-ups' ? 'pull-reps' : null
        if (kind) totals[kind] = (totals[kind] ?? 0) + positive(fact.reps)
      }
    }
    totals['run-single'] = Math.max(totals['run-single'] ?? 0, runKm)
    totals['run-total'] = (totals['run-total'] ?? 0) + runKm
    for (const mode of event.modes) {
      const kind = `${mode}-workouts` as AchievementKind
      totals[kind] = (totals[kind] ?? 0) + 1
    }
    events.push(event)
  }
  function progress(date: LocalDate): Partial<Record<AchievementKind, number>> {
    const week = monday(date)
    const month = monthNumber(date)
    const recent = events.filter((event) => event.date >= addDays(date, -29) && event.date <= date)
    const monthEvents = events.filter((event) => event.month === month)
    const weekEvents = events.filter((event) => event.week === week)
    const categories = new Set(recent.flatMap((event) => [...event.categories]))
    const balanceMonths = new Map<number, Set<LocalDate>>()
    const monthCategories = new Map<number, Set<string>>()
    for (const event of events) {
      const values = monthCategories.get(event.month) ?? new Set<string>()
      for (const category of event.categories) values.add(category)
      monthCategories.set(event.month, values)
      if (values.size === 3) balanceMonths.set(event.month, new Set([event.date]))
    }
    const seasonal = events.filter((event) => event.date >= addDays(date, -364) && event.date <= date)
    return {
      ...totals,
      rhythm: consecutive(weekly, week, (key) => addDays(key, -7), 2),
      'three-weekly': consecutive(weekly, week, (key) => addDays(key, -7), 3),
      flexible: Array.from({ length: 8 }, (_, index) => weekly.get(addDays(week, -7 * index))?.size ?? 0).filter((count) => count >= 2).length,
      'month-days': monthly.get(month)?.size ?? 0,
      'active-months': consecutive(monthly, month, (key) => key - 1, 4),
      'comeback-rhythm': returned && daysBetween(returned, date) <= 14 ? returnDays.size : 0,
      versatile: categories.size,
      'strength-endurance': new Set(weekEvents.flatMap((event) => [...event.categories].filter((category) => category !== 'stretch'))).size,
      'movement-balance': consecutive(balanceMonths, month, (key) => key - 1, 1),
      'cardio-choice': new Set(recent.flatMap((event) => [...event.modes])).size,
      'equipment-variety': new Set(monthEvents.flatMap((event) => [...event.equipment])).size,
      'four-seasons': new Set(seasonal.map((event) => Math.floor(Number(event.date.slice(5, 7)) % 12 / 3))).size,
    }
  }
  return { add, progress }
}
