import { z } from 'zod'

const sessionSchema = z.array(z.object({ day: z.string(), week: z.number(), title: z.string(), exercises: z.array(z.object({
  exerciseRef: z.string(), name: z.string(), sets: z.number(), reps: z.number().nullable(), durationSec: z.number().nullable(), rpe: z.number(), restSec: z.number(),
})) }))
const historySchema = z.array(z.object({ source: z.string(), ref: z.string(), recentExecutions: z.array(z.object({ date: z.string(), sets: z.array(z.object({
  reps: z.number().nullable(), weightKg: z.number().nullable(), durationSec: z.number().nullable(),
}).passthrough()) })) }).passthrough())

export function AssistantProgramOverview({ payload }: { payload: Record<string, unknown> }) {
  const parsed = sessionSchema.safeParse(payload.sessions)
  const history = historySchema.safeParse(payload.historyFacts)
  if (!parsed.success) return null
  const weekday = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
  const days = [...new Set(parsed.data.map((session) => weekday(session.day)))].sort((a, b) => a - b)
  return <section className="assistant-message-copy" aria-label="Обзор четырёх недель"><h3>Обзор программы</h3>{days.map((day, dayIndex) => {
    const sessions = parsed.data.filter((session) => weekday(session.day) === day).sort((a, b) => a.week - b.week)
    const positions = Math.max(...sessions.map((session) => session.exercises.length))
    return <div key={day}><h4>День {['А', 'Б', 'В'][dayIndex]} · {['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'][day]}</h4><ol>{Array.from({ length: positions }, (_, position) => {
      const first = sessions[0]?.exercises[position]
      const refs = [...new Set(sessions.flatMap((session) => session.exercises[position]?.exerciseRef ?? []))]
      return <li key={position}><strong>{first?.name}</strong>{sessions.map((session) => {
        const exercise = session.exercises[position]
        return exercise && <p key={session.day}>Неделя {session.week}: {exercise.name !== first?.name ? `${exercise.name} · ` : ''}{exercise.sets} × {exercise.reps ?? `${exercise.durationSec} сек`} · RPE {exercise.rpe} · отдых {exercise.restSec} сек</p>
      })}{refs.map((ref) => {
        const execution = history.success ? history.data.find((row) => row.source === 'system' && row.ref === ref)?.recentExecutions[0] : undefined
        const name = sessions.flatMap((session) => session.exercises).find((exercise) => exercise.exerciseRef === ref)?.name
        return <p key={ref} className="assistant-card-hint">{name}: {execution ? `последний факт в Fit ${execution.date} — ${execution.sets.map((set) => [set.reps !== null ? `${set.reps} повт.` : set.durationSec !== null ? `${set.durationSec} сек` : 'повторы не записаны', set.weightKg !== null ? `${set.weightKg} кг` : ''].filter(Boolean).join(' · ')).join('; ')}` : 'сопоставимого факта в Fit нет'}</p>
      })}</li>
    })}</ol></div>
  })}</section>
}
