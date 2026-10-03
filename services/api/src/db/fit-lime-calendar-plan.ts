import { createHash } from 'node:crypto'

export const FIT_LIME_CALENDAR_BATCH = 'fit-lime-calendar-20261003'
export const FIT_LIME_CALENDAR_LOGINS = [
  '9efabf271d2433836f53f4efad98e31ae12e2283cae536eb9b1d800a2e734b71',
  '1a13619899d89af007676a24b698ad3685b9e6a48cc27c84bad16927b7a2d581',
] as const

const NAMES = ['Алексей Смирнов', 'Мария Волкова', 'Дмитрий Соколов', 'Анна Морозова',
  'Илья Кузнецов', 'Софья Лебедева', 'Максим Орлов', 'Екатерина Белова',
  'Артём Новиков', 'Полина Соколова', 'Михаил Васильев', 'Виктория Павлова',
  'Александра Константинопольская-Рождественская', 'Даниил Александров', 'Елизавета Михайлова']
// Six training days and one empty day per week. Wednesday is deliberately dense.
const DAYS = [0, 0, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 4, 4, 4, 5, 5, 5]
const TITLES = ['Силовая тренировка', 'Спина и плечи', 'Ноги и ягодицы',
  'Восстановительная тренировка и работа над подвижностью тазобедренных суставов', 'Кардио', 'Общая физическая подготовка']

export function fitLimeFixtureId(trainerId: string, resource: string): string {
  const hex = createHash('sha256').update(`${FIT_LIME_CALENDAR_BATCH}:${trainerId}:${resource}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}
function clock(minutes: number) { return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}` }

export function buildFitLimeCalendarPlan(trainerId: string, monday: string, today: string) {
  const clients = NAMES.map((fullName, index) => ({ id: fitLimeFixtureId(trainerId, `client:${index}`), fullName }))
  const workouts = Array.from({ length: 60 }, (_, index) => {
    const slot = index % 20
    const day = DAYS[slot]!
    const ordinal = DAYS.slice(0, slot).filter((value) => value === day).length
    const untimed = index % 7 === 0
    const active = index === 29
    const workoutDate = active ? today : addDays(monday, (Math.floor(index / 20) - 1) * 7 + day)
    const start = 8 * 60 + ordinal * 45
    const status = active ? 'in_progress' as const : workoutDate < today
      ? index % 11 === 0 ? 'cancelled' as const : 'done' as const : 'planned' as const
    const exercise = index % 6 === 4 ? { ref: 'running', name: 'Бег', group: 'cardio', kind: 'distance' }
      : index % 6 === 3 ? { ref: 'plank', name: 'Планка', group: 'core', kind: 'duration' }
        : index % 6 === 1 ? { ref: 'dumbbell-row', name: 'Тяга гантели в наклоне', group: 'back', kind: 'strength' }
          : { ref: 'barbell-squat', name: 'Присед со штангой', group: 'legs', kind: 'strength' }
    return { id: fitLimeFixtureId(trainerId, `workout:${index}`), clientId: clients[index % 15]!.id,
      workoutDate, startTime: untimed ? null : clock(start), endTime: untimed ? null : clock(start + 60),
      status, title: TITLES[index % TITLES.length]!, withExercises: index % 4 !== 0, exercise,
      exerciseId: fitLimeFixtureId(trainerId, `exercise:${index}`),
      blockId: fitLimeFixtureId(trainerId, `block:${index}`),
      setIds: [0, 1, 2].map((set) => fitLimeFixtureId(trainerId, `set:${index}:${set}`)) }
  })
  return { clients, workouts }
}
