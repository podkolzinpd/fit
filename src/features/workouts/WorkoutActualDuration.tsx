import { useId, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import type { Workout } from '../../shared/domain'
import { Field } from '../../shared/ui'
import { workoutDurationLabel } from '../../data/repositories/workout-rules'
import { actualWorkoutDurationSeconds, workoutDurationMinutes } from './actual-workout-duration'
import { WorkoutCta } from './WorkoutSurface'

/** Shared by quick entry and the complete workout form. */
export function WorkoutActualDurationField({ value, onChange, disabled = false }: {
  value: string; onChange: (value: string) => void; disabled?: boolean
}) {
  const hintId = useId()
  return <Field label="Длительность тренировки, мин">
    <input aria-label="Длительность тренировки, мин" aria-describedby={hintId}
      inputMode="decimal" value={value} placeholder="Например, 50" disabled={disabled}
      onChange={(event) => onChange(event.target.value)} />
    <small id={hintId}>Необязательно. Укажите время самой тренировки.</small>
  </Field>
}

/** Duration-only fact correction; never sends the exercise aggregate. */
export function WorkoutActualDuration({ workout, onSave, onReload }: {
  workout: Workout
  onSave: (seconds: number | null, expectedVersion: number) => Promise<void>
  onReload: () => Promise<number>
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const submissionActive = useRef(false)
  const titleId = useId()
  const [version, setVersion] = useState(workout.version)
  const [saved, setSaved] = useState(false)
  const { register, reset, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<{ minutes: string }>()
  const label = workoutDurationLabel(workout.startedAt, workout.completedAt, workout.actualDurationSec)
  const hasDuration = Boolean(label && label !== '0 мин')
  function open() {
    reset({ minutes: workoutDurationMinutes(workout) })
    setVersion(workout.version)
    setSaved(false)
    dialog.current?.showModal()
  }
  const submit = async ({ minutes }: { minutes: string }) => {
    if (submissionActive.current) return
    submissionActive.current = true
    try {
      await onSave(actualWorkoutDurationSeconds(minutes), version)
      dialog.current?.close()
      setSaved(true)
    } catch (error) {
      let reloaded = false
      try { setVersion(await onReload()); reloaded = true } catch { /* Keep the old version; retry cannot overwrite an unseen change. */ }
      setError('root', { message: `${error instanceof Error ? error.message : 'Не удалось сохранить время.'}${reloaded ? ' Тренировка перечитана. Проверьте текущее время на экране и повторите сохранение.' : ' Повторите сохранение, когда появится связь.'}` })
    } finally {
      submissionActive.current = false
    }
  }
  return <>
    <div className="workout-actual-duration">
      <div><span>Длительность</span><strong>{hasDuration ? label : 'Не указана'}</strong></div>
      <button ref={trigger} type="button" className="secondary" aria-label={hasDuration ? 'Изменить длительность' : 'Указать длительность'} onClick={open}>{hasDuration ? 'Изменить' : 'Указать длительность'}</button>
    </div>
    {saved && <p className="workout-duration-saved" role="status">Длительность сохранена</p>}
    <dialog ref={dialog} className="modal-dialog workout-duration-dialog" aria-labelledby={titleId} onClose={() => trigger.current?.focus()}
      onCancel={(event) => { if (isSubmitting) event.preventDefault() }}>
      <h2 id={titleId}>Длительность тренировки</h2>
      <form className="stack" onSubmit={(event) => void handleSubmit(submit)(event)}>
        <Field label="Длительность тренировки, мин">
          <input {...register('minutes', { validate: (value) => {
            try { actualWorkoutDurationSeconds(value); return true }
            catch (error) { return error instanceof Error ? error.message : 'Укажите корректную длительность' }
          } })} inputMode="decimal" placeholder="Например, 50" disabled={isSubmitting}
            aria-invalid={Boolean(errors.minutes)} aria-describedby={`${titleId}-hint`} />
          <small id={`${titleId}-hint`}>Время всей тренировки, включая отдых. Пустое поле убирает ручное значение.</small>
        </Field>
        {errors.minutes && <p className="error" role="alert">{errors.minutes.message}</p>}
        {errors.root && <div className="error" role="alert"><p>{errors.root.message}</p><p>Сейчас сохранено: {hasDuration ? label : 'время не указано'}.</p></div>}
        <div className="actions">
          <WorkoutCta type="button" variant="secondary" disabled={isSubmitting} onClick={() => dialog.current?.close()}>Отмена</WorkoutCta>
          <WorkoutCta type="submit" pending={isSubmitting} pendingLabel="Сохраняем…">{errors.root ? 'Повторить' : 'Сохранить'}</WorkoutCta>
        </div>
      </form>
    </dialog>
  </>
}
