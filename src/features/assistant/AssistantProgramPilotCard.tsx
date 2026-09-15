import { useState } from 'react'
import { z } from 'zod'

const workoutSchema = z.object({ requestId: z.string().uuid(), clientId: z.string().uuid(), workoutDate: z.string(),
  exercises: z.array(z.object({ name: z.string(), restBetweenSetsSec: z.number(), sets: z.array(z.object({ reps: z.number().optional(), durationSec: z.number().optional(), rpe: z.number() }).passthrough()) }).passthrough()),
}).passthrough()
const programSchema = z.object({ canonicalWorkouts: z.array(workoutSchema).refine((value) => [4, 8, 12].includes(value.length)) })

type Props = { payload: Record<string, unknown>; enabled: boolean; running: boolean; onApply: (input: object) => Promise<void>;
  onSaved: () => void; onSuggestion: (message: string) => void; onCancel: () => void }

export function AssistantProgramPilotCard({ payload, enabled, running, onApply, onSaved, onSuggestion, onCancel }: Props) {
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
    <header><span><small>{confirm ? 'Программа на четыре недели' : 'Анкета программы'}</small><strong>{String(payload.clientName ?? '')}</strong></span><span className="assistant-flow-status">{confirm ? `${parsed.data.canonicalWorkouts.length} трен.` : payload.briefStatus === 'needs_clarification' ? 'Уточнение' : payload.readyToGenerate === true ? 'Проверка условий' : 'Сбор данных'}</span></header>
    {!enabled && <p className="assistant-card-hint">Составление программ сейчас недоступно для этого аккаунта.</p>}
    {!confirm && typeof payload.guidance === 'string' && <div className="assistant-message-copy" role="status">{payload.guidance.split('\n').filter(Boolean).map((line, index) => <p key={index}>{line}</p>)}</div>}
    {!confirm && payload.historyQuestion === true && <div className="assistant-flow-actions">
      <button type="button" disabled={busy} aria-busy={running} onClick={() => onSuggestion('Это все тренировки')}>Это все тренировки</button>
      <button type="button" disabled={busy} aria-busy={running} onClick={() => onSuggestion('Часть тренировок не записана')}>Часть тренировок не записана</button>
    </div>}
    {!confirm && typeof payload.briefSummary === 'string' && <div className="assistant-message-copy">{payload.briefSummary.split('\n').filter(Boolean).map((line) => <p key={line}>{line}</p>)}</div>}
    {confirm && <>
      {typeof payload.goal === 'string' && <div className="assistant-flow-fact"><small>Цель</small><strong>{payload.goal}</strong></div>}
      {typeof payload.rationale === 'string' && <p>{payload.rationale}</p>}
      {typeof payload.progression === 'string' && <p>{payload.progression}</p>}
      <p className="assistant-flow-guidance">Вес подбирайте под указанное усилие RPE: 6–8 из 10, с запасом повторений. На подготовку и разминку предусмотрено 10 минут.</p>
      <div className="assistant-program-sessions">{parsed.data.canonicalWorkouts.map((workout, index) => <details key={workout.requestId}>
        <summary><span><strong>Неделя {Math.floor(index / (parsed.data.canonicalWorkouts.length / 4)) + 1} · {workout.workoutDate}</strong><small>{workout.exercises.length} упражнений</small></span><b>Посмотреть</b></summary>
        <ol>{workout.exercises.map((exercise, position) => <li key={position}><strong>{exercise.name}</strong><p>{exercise.sets.length} × {exercise.sets[0]?.reps ?? `${exercise.sets[0]?.durationSec} сек`} · RPE {exercise.sets[0]?.rpe} · отдых {exercise.restBetweenSetsSec} сек</p></li>)}</ol>
      </details>)}</div>
    </>}
    {error && <p role="alert" className="assistant-card-hint">{error}</p>}
    <div className="assistant-flow-actions">
      {confirm ? <button type="button" className="primary" onClick={() => void save()} disabled={busy}>{saved ? 'Добавлено в расписание' : saving ? 'Добавляю…' : 'Добавить в расписание'}</button>
        : payload.readyToGenerate === true && <button type="button" className="primary" disabled={busy} onClick={() => onSuggestion('Подтверждаю анкету, составь программу')}>{running ? 'Составляю…' : 'Подтвердить и составить'}</button>}
      {confirm && !saved && <button type="button" disabled={busy} onClick={() => onSuggestion('Изменить условия программы')}>Изменить условия</button>}
      {!saved && <button type="button" disabled={running || saving} onClick={onCancel}>Отменить</button>}
    </div>
  </div>
}
