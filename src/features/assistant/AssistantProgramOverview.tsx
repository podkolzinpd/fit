import { z } from 'zod'

const exerciseSchema = z.object({ exerciseRef: z.string(), name: z.string(), sets: z.number(), reps: z.number().nullable(), durationSec: z.number().nullable(), rpe: z.number(), restSec: z.number(), progressionNote: z.string().optional() })
const sessionSchema = z.array(z.object({ day: z.string(), week: z.number(), title: z.string(), exercises: z.array(exerciseSchema) }))
const historySchema = z.array(z.object({ source: z.string(), ref: z.string(), recentExecutions: z.array(z.object({ date: z.string(), sets: z.array(z.object({
  reps: z.number().nullable(), weightKg: z.number().nullable(), durationSec: z.number().nullable(),
}).passthrough()) })) }).passthrough())
type Exercise = z.infer<typeof exerciseSchema>

export function programDoseText(exercise: Pick<Exercise, 'sets' | 'reps' | 'durationSec'>): string {
  const sets = `${exercise.sets} ${exercise.sets === 1 ? 'подход' : 'подхода'}`
  if (exercise.reps === null) {
    const seconds = exercise.durationSec ?? 0
    const duration = seconds < 60 ? `${seconds} сек` : `${Math.floor(seconds / 60)} мин${seconds % 60 ? ` ${seconds % 60} сек` : ''}`
    return `${sets} по ${duration}`
  }
  const reps = exercise.reps
  const word = reps % 10 >= 2 && reps % 10 <= 4 && (reps < 12 || reps > 14) ? 'повторения' : 'повторений'
  return `${sets} по ${reps} ${word}`
}
export function AssistantProgramOverview({ payload }: { payload: Record<string, unknown> }) {
  const parsed = sessionSchema.safeParse(payload.sessions)
  const history = historySchema.safeParse(payload.historyFacts)
  if (!parsed.success) return null
  const weekday = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
  const days = [...new Set(parsed.data.map((session) => weekday(session.day)))].sort((a, b) => a - b)
  return <section className="assistant-message-copy" aria-label="Обзор четырёх недель"><h3>Обзор программы</h3>{days.map((day, dayIndex) => {
    const sessions = parsed.data.filter((session) => weekday(session.day) === day).sort((a, b) => a.week - b.week)
    const positions = Math.max(...sessions.map((session) => session.exercises.length))
    return <div key={day}><h4>День {['А', 'Б', 'В'][dayIndex]} · {['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'][day]}</h4>{Array.from({ length: positions }, (_, position) => {
      const first = sessions[0]?.exercises[position]
      const refs = [...new Set(sessions.flatMap((session) => session.exercises[position]?.exerciseRef ?? []))]
      const groups: { from: number; to: number; exercise: Exercise }[] = []
      for (const session of sessions) {
        const exercise = session.exercises[position]
        if (!exercise) continue
        const previous = groups.at(-1)
        if (previous && previous.to + 1 === session.week && JSON.stringify(previous.exercise) === JSON.stringify(exercise)) previous.to = session.week
        else groups.push({ from: session.week, to: session.week, exercise })
      }
      return <div key={position}><p><strong>{position + 1}. {first?.name}</strong></p>{groups.map(({ from, to, exercise }) => <div key={from}>
        <p>{from === to ? `Неделя ${from}` : `Недели ${from}–${to}`}: {exercise.name !== first?.name ? `${exercise.name} — ` : ''}{programDoseText(exercise)}.</p>
        <p>Отдых — {exercise.restSec} секунд. Усилие — {exercise.rpe.toLocaleString('ru-RU')} из 10.</p>
      </div>)}{refs.map((ref) => {
        const execution = history.success ? history.data.find((row) => row.source === 'system' && row.ref === ref)?.recentExecutions.find((row) => row.sets.some((set) => set.reps !== null || set.durationSec !== null)) : undefined
        const name = sessions.flatMap((session) => session.exercises).find((exercise) => exercise.exerciseRef === ref)?.name
        return <p key={ref} className="assistant-card-hint">{execution ? `${refs.length > 1 ? `${name}: ` : ''}Результат в Fit от ${execution.date}: ${execution.sets.map((set) => [set.reps !== null ? `${set.reps} повт.` : set.durationSec !== null ? `${set.durationSec} сек` : 'повторы не записаны', set.weightKg !== null ? `${set.weightKg} кг` : ''].filter(Boolean).join(' · ')).join('; ')}` : `В Fit пока нет записанного результата ${refs.length > 1 ? `«${name}»` : 'этого упражнения'} для сравнения.`}</p>
      })}{[...new Set(groups.flatMap(({ exercise }) => exercise.progressionNote ? [exercise.progressionNote] : []))].map((note) => <p key={note}><strong>Пояснение:</strong> {note}</p>)}</div>
    })}</div>
  })}</section>
}
