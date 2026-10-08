import type { Workout, WorkoutHomeSummary } from '../../shared/domain'
import type { LocalDate } from '../../shared/local-date'

type HomeInput = Pick<Workout, 'id' | 'clientId' | 'clientName' | 'workoutDate' | 'startTime' | 'status' | 'exercises'>

/** Frozen legacy compatibility: same home representatives, not a truncated history. */
export function workoutHomeSummaries(workouts: readonly HomeInput[], today: LocalDate): WorkoutHomeSummary[] {
  const picked = new Set<string>()
  const byClient = new Map<string, HomeInput[]>()
  for (const workout of workouts) {
    const group = byClient.get(workout.clientId) ?? []
    group.push(workout)
    byClient.set(workout.clientId, group)
    if (workout.status === 'in_progress' || (workout.status === 'planned' && workout.workoutDate === today)) picked.add(workout.id)
  }
  const order = (a: HomeInput, b: HomeInput) => `${a.workoutDate}${a.startTime ?? ''}${a.id}`.localeCompare(`${b.workoutDate}${b.startTime ?? ''}${b.id}`)
  for (const group of byClient.values()) {
    const sorted = [...group].sort(order)
    const candidates = [sorted.at(-1),
      sorted.filter((item) => item.status === 'done' && item.startTime !== null).at(-1),
      sorted.filter((item) => item.status === 'done' && item.startTime === null).at(-1),
      [...group].filter((item) => item.status === 'done').sort((a, b) => b.workoutDate.localeCompare(a.workoutDate) || (b.startTime ?? '').localeCompare(a.startTime ?? ''))[0],
      [...group].filter((item) => item.status === 'planned' && item.workoutDate < today).sort((a, b) => b.workoutDate.localeCompare(a.workoutDate))[0],
      sorted.find((item) => item.status === 'planned' && item.workoutDate >= today && item.startTime !== null),
      sorted.find((item) => item.status === 'planned' && item.workoutDate >= today && item.startTime === null)]
    for (const item of candidates) if (item) picked.add(item.id)
  }
  return workouts.filter((item) => picked.has(item.id)).map((item) => ({
    id: item.id, clientId: item.clientId, clientName: item.clientName,
    workoutDate: item.workoutDate, startTime: item.startTime, status: item.status,
    exerciseCount: item.exercises.length, exerciseNames: item.exercises.slice(0, 2).map((exercise) => exercise.name),
  }))
}
