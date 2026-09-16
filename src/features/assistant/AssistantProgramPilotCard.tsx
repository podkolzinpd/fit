import { AssistantProgramOverview, programDoseText } from './AssistantProgramOverview'
import { useState } from 'react'
import { z } from 'zod'
import { ChevronRightIcon } from '../../shared/icons'

const workoutSchema = z.object({ requestId: z.string().uuid(), clientId: z.string().uuid(), workoutDate: z.string(),
  exercises: z.array(z.object({ name: z.string(), restBetweenSetsSec: z.number(), trainerComment: z.string().optional(), sets: z.array(z.object({ reps: z.number().optional(), durationSec: z.number().optional(), rpe: z.number().optional() }).passthrough()) }).passthrough()),
}).passthrough()
const programSchema = z.object({ canonicalWorkouts: z.array(workoutSchema).refine((value) => [4, 8, 12].includes(value.length)) })

type Props = { payload: Record<string, unknown>; enabled: boolean; running: boolean; onApply: (input: object) => Promise<void>;
  onSaved: () => void; onSuggestion: (message: string) => void; onCancel: () => void; showGuidance?: boolean }

export function AssistantProgramPilotCard({ payload, enabled, running, onApply, onSaved, onSuggestion, onCancel, showGuidance = true }: Props) {
  const [edit, setEdit] = useState<{ date: string; position: number; scope: string; name: string; sets: string; reps: string; seconds: string; rpe: string; rest: string }>()
  const sessionDoses = z.array(z.object({ day: z.string(), exercises: z.array(z.object({ rpe: z.number() }).passthrough()) }).passthrough()).safeParse(payload.sessions)
  const effort = (date: string, position: number, saved?: number) => saved ?? (sessionDoses.success ? sessionDoses.data.find((session) => session.day === date)?.exercises[position]?.rpe : undefined)
  const catalog = z.array(z.object({ ref: z.string(), name: z.string(), inputKind: z.string() })).safeParse(payload.editableCatalog)
  function submitEdit() {
    if (!edit) return
    onSuggestion(`Измени упражнение ${edit.position + 1} в занятии ${edit.date}; область: ${edit.scope}; упражнение: ${edit.name}; подходы: ${edit.sets}; повторы: ${edit.reps || 'нет'}; секунды: ${edit.seconds || 'нет'}; усилие: ${edit.rpe}; отдых: ${edit.rest}.`)
  }
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string>()
  const parsed = programSchema.safeParse(payload)
  const confirm = payload.step === 'confirm' && parsed.success
  const busy = running || saving || saved || !enabled
  async function save() {
    if (busy || !parsed.success) return
    setSaving(true); setError(undefined)
    try {
      // Submit the original server payload without reconstructing prescriptions.
      await onApply({ workouts: payload.canonicalWorkouts })
      setSaved(true); onSaved()
    } catch { setError('Не удалось сохранить программу. Если данные клиента изменились, составьте новый черновик; иначе повторите сохранение.') }
    finally { setSaving(false) }
  }
  return <div className="assistant-flow-card assistant-program-card" aria-label="Программа на четыре недели">
    <header><span><small>{confirm ? 'Программа на четыре недели' : 'Составление программы'}</small><strong>{String(payload.clientName ?? '')}</strong></span><span className="assistant-flow-status">{confirm ? `${parsed.data.canonicalWorkouts.length} трен.` : payload.briefStatus === 'needs_clarification' ? 'Уточнение' : payload.readyToGenerate === true ? 'Проверка условий' : 'Уточняем условия'}</span></header>
    {!enabled && <p className="assistant-card-hint">Составление программ сейчас недоступно для этого аккаунта.</p>}
    {!confirm && showGuidance && typeof payload.guidance === 'string' && <div className="assistant-message-copy" role="status">{payload.guidance.split('\n').filter(Boolean).map((line, index) => <p key={index}>{line}</p>)}</div>}
    {!confirm && payload.historyQuestion === true && <div className="assistant-flow-actions">
      <button type="button" disabled={busy} aria-busy={running} onClick={() => onSuggestion('Это все тренировки')}>Это все тренировки</button>
      <button type="button" disabled={busy} aria-busy={running} onClick={() => onSuggestion('Часть тренировок не записана')}>Часть тренировок не записана</button>
    </div>}
    {!confirm && (typeof payload.sourceSummary === 'string' || typeof payload.briefSummary === 'string') && <details className="assistant-program-context-details" key={`${String(payload.clientId ?? payload.clientName ?? '')}-${payload.readyToGenerate === true}`} open={payload.readyToGenerate === true}>
      <summary><ChevronRightIcon />Данные и условия</summary>
      {typeof payload.sourceSummary === 'string' && <p className="assistant-card-hint">{payload.sourceSummary}</p>}
      {typeof payload.briefSummary === 'string' && <div className="assistant-message-copy">{payload.briefSummary.split('\n').filter(Boolean).map((line) => <p key={line}>{line}</p>)}</div>}
    </details>}
    {confirm && typeof payload.sourceSummary === 'string' && <p className="assistant-card-hint">{payload.sourceSummary}</p>}
    {confirm && <>
      {typeof payload.editGuidance === 'string' && <p role="status">{payload.editGuidance}</p>}
      {typeof payload.goal === 'string' && <div className="assistant-flow-fact"><small>Цель</small><strong>{payload.goal}</strong></div>}
      {typeof payload.rationale === 'string' && <p>{payload.rationale}</p>}
      {typeof payload.limitationReview === 'string' && <p className="assistant-message-copy">{payload.limitationReview}</p>}
      {typeof payload.progression === 'string' && <p>{payload.progression}</p>}
      <p className="assistant-flow-guidance">Занятия — под наблюдением тренера. Усилие — насколько тяжело выполнять подход, по шкале от 1 до 10. Рабочий вес и технику подбирайте с тренером. На разминку предусмотрено 10 минут.</p>
      <AssistantProgramOverview payload={payload} />
      <div className="assistant-program-sessions">{parsed.data.canonicalWorkouts.map((workout, index) => <details key={workout.requestId}>
        <summary><span><strong>Неделя {Math.floor(index / (parsed.data.canonicalWorkouts.length / 4)) + 1} · {workout.workoutDate}</strong><small>{workout.exercises.length} упражнений</small></span><b>Посмотреть</b></summary>
        <ol>{workout.exercises.map((exercise, position) => <li key={position}><strong>{exercise.name}</strong><p>{programDoseText({ sets: exercise.sets.length, reps: exercise.sets[0]?.reps ?? null, durationSec: exercise.sets[0]?.durationSec ?? null })}. Отдых — {exercise.restBetweenSetsSec} секунд. Усилие — {effort(workout.workoutDate, position, exercise.sets[0]?.rpe)?.toLocaleString('ru-RU') ?? 'не указано'} из 10.</p>
          {catalog.success && <button type="button" disabled={busy} onClick={() => setEdit({ date: workout.workoutDate, position, scope: 'только это занятие', name: exercise.name,
            sets: String(exercise.sets.length), reps: exercise.sets[0]?.reps === undefined ? '' : String(exercise.sets[0].reps), seconds: exercise.sets[0]?.durationSec === undefined ? '' : String(exercise.sets[0].durationSec),
            rpe: String(effort(workout.workoutDate, position, exercise.sets[0]?.rpe) ?? ''), rest: String(exercise.restBetweenSetsSec) })}>Изменить</button>}</li>)}</ol>
      </details>)}</div>
    </>}
    {edit && catalog.success && <section aria-label="Изменение упражнения" className="assistant-message-copy">
      <strong>{edit.date} · упражнение {edit.position + 1}</strong>
      <label>Область изменения<select value={edit.scope} onChange={(event) => setEdit({ ...edit, scope: event.target.value })}><option>только это занятие</option><option>этот день во всех неделях</option></select></label>
      <label>Упражнение<select value={edit.name} onChange={(event) => {
        const name = event.target.value
        const duration = ['duration', 'distance'].includes(catalog.data.find((row) => row.name === name)?.inputKind ?? '')
        setEdit({ ...edit, name, reps: duration ? '' : edit.reps || '8', seconds: duration ? edit.seconds || '30' : '' })
      }}>{catalog.data.map((row) => <option key={row.ref}>{row.name}</option>)}</select></label>
      {(['sets', 'reps', 'seconds', 'rpe', 'rest'] as const).map((field) => <label key={field}>{({ sets: 'Подходы', reps: 'Повторы', seconds: 'Секунды', rpe: 'Усилие (1–10)', rest: 'Отдых, секунды' })[field]}<input type="number" step={field === 'rpe' ? '0.5' : '1'} value={edit[field]} disabled={(field === 'reps' && !!edit.seconds) || (field === 'seconds' && !!edit.reps)} onChange={(event) => setEdit({ ...edit, [field]: event.target.value })} /></label>)}
      <div className="assistant-flow-actions"><button type="button" className="primary" disabled={busy} onClick={submitEdit}>Проверить изменение</button><button type="button" disabled={busy} onClick={() => setEdit(undefined)}>Закрыть правку</button></div>
    </section>}
    {error && <p role="alert" className="assistant-card-hint">{error}</p>}
    <div className="assistant-flow-actions">
      {confirm ? <button type="button" className="primary" onClick={() => void save()} disabled={busy || !!edit}>{saved ? 'Добавлено в расписание' : saving ? 'Добавляю…' : 'Добавить в расписание'}</button>
        : payload.readyToGenerate === true && <button type="button" className="primary" disabled={busy} onClick={() => onSuggestion('Условия верны, составь программу')}>{running ? 'Составляю…' : 'Подтвердить и составить'}</button>}
      {confirm && !saved && <button type="button" disabled={busy} onClick={() => onSuggestion('Изменить условия программы')}>Изменить условия</button>}
      {!saved && <button type="button" disabled={running || saving} onClick={onCancel}>Отменить</button>}
    </div>
  </div>
}
