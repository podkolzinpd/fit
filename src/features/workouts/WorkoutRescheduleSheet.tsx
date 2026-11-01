import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useDataBackend } from '../../app/data-backend-context'
import type { Workout, WorkoutSlotDraft } from '../../shared/domain'
import { addDays, formatLocalDate } from '../../shared/local-date'
import { CloseIcon } from '../../shared/icons'
import { FitLimeDatePicker } from '../../shared/FitLimeDatePicker'
import { isRepositoryConflict } from '../../data/repositories/error'
import { overlappingWorkoutSlots, shiftWorkoutSlot, slotClock, slotDurationMinutes, slotMinutes, slotTimeLabel, workoutSlot } from './workout-slot'
import { workoutDisplayTitle } from './workout-chronicle'
import { CoachPlanTimeField } from './CoachPlanTimeField'
import './workout-reschedule.css'

/** One slot editor is shared by detail and calendar; it never saves the plan. */
export function WorkoutRescheduleSheet({ workout: sourceWorkout, initialSlot, onSaved, onClose, onReloaded }: {
  workout: Workout; initialSlot?: WorkoutSlotDraft; onReloaded?: (workout: Workout) => void
  onSaved: (slot: WorkoutSlotDraft) => Promise<void>; onClose: () => void
}) {
  const [workout] = useState(sourceWorkout)
  const { workouts } = useDataBackend()
  const queryClient = useQueryClient()
  const [slot, setSlot] = useState(initialSlot ?? workoutSlot(workout))
  const durationRef = useRef(slotDurationMinutes(slot.startTime, slot.endTime))
  const [reloading, setReloading] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const submitting = useRef(false)
  const attempt = useRef<{ fingerprint: string; operationId: string } | null>(null)
  const collisions = useQuery({ queryKey: ['workout-slot-overlaps', slot.workoutDate],
    queryFn: () => workouts.list(addDays(slot.workoutDate, -1), addDays(slot.workoutDate, 1)) })
  const overlaps = overlappingWorkoutSlots(workout, slot, collisions.data ?? [])
  const start = slotMinutes(slot.startTime), end = slotMinutes(slot.endTime)
  const duration = slotDurationMinutes(slot.startTime, slot.endTime)
  const invalid = end !== null && (start === null || end === start) ? 'Укажите начало и отличающееся от него окончание.' : null
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.showModal()
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  const save = useMutation({
    mutationFn: async (draft: WorkoutSlotDraft) => {
      if (!workouts.rescheduleSlot) throw new Error('Перенос записи сейчас недоступен')
      const fingerprint = JSON.stringify(draft)
      if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, operationId: crypto.randomUUID() }
      await workouts.rescheduleSlot(workout, draft, attempt.current.operationId)
    },
    onSuccess: async (_version, draft) => { await onSaved(draft) },
    onSettled: () => { submitting.current = false },
  })
  const conflict = isRepositoryConflict(save.error)
  const reload = useMutation({ mutationFn: () => workouts.get(workout.id), onSuccess: fresh => {
    queryClient.setQueryData(['workout', fresh.id], fresh)
    if (onReloaded) onReloaded(fresh)
    else onClose()
  }, onSettled: () => setReloading(false) })
  const busy = save.isPending || reloading
  return <dialog ref={dialog} className="workout-reschedule-sheet" aria-label="Дата и время"
    onCancel={event => { if (busy) event.preventDefault() }} onClose={event => { if (event.target === event.currentTarget) onClose() }}>
    <header><h2>Дата и время</h2><button type="button" aria-label="Закрыть" disabled={busy} onClick={onClose}><CloseIcon /></button></header>
    <p className="workout-reschedule-subtitle">{workout.clientName} · {workoutDisplayTitle(workout)}</p>
    <form onSubmit={event => {
      event.preventDefault()
      if (!busy && !submitting.current && !invalid && !conflict && !collisions.isPending && !collisions.isError) {
        submitting.current = true; save.mutate({ ...slot })
      }
    }}>
      <div className="workout-reschedule-date"><span>Дата</span><FitLimeDatePicker value={slot.workoutDate}
        onChange={workoutDate => setSlot({ ...slot, workoutDate })} triggerLabel={formatLocalDate(slot.workoutDate)}
        reference disabled={busy || conflict} /></div>
      <fieldset className="workout-reschedule-times" aria-label="Время занятия" disabled={busy || conflict}>
        <div><span>Начало</span><CoachPlanTimeField name="slotStart" label="Начало" referencePolish value={slot.startTime ?? ''} onChange={value => {
          let next = shiftWorkoutSlot(slot, value || null)
          if (value && !slot.startTime && slot.endTime && durationRef.current !== null && durationRef.current > 0) {
            next = { ...next, endTime: slotClock((slotMinutes(value)! + durationRef.current) % 1440) }
          }
          durationRef.current = slotDurationMinutes(next.startTime, next.endTime) ?? durationRef.current
          setSlot(next)
        }} /></div>
        <div><span>Окончание</span><CoachPlanTimeField name="slotEnd" label="Окончание" referencePolish value={slot.endTime ?? ''} onChange={value => {
          durationRef.current = slotDurationMinutes(slot.startTime, value || null)
          setSlot({ ...slot, endTime: value || null })
        }} /></div>
      </fieldset>
      <p className="workout-reschedule-note">{start !== null && end !== null && !invalid ? `Длительность — ${duration} минут` : 'Окончание можно не указывать'}</p>
      <p className="workout-reschedule-before">Было: {formatLocalDate(workout.workoutDate)} · {slotTimeLabel(workout)}</p>
      {collisions.isPending && <p role="status">Проверяем расписание…</p>}
      {collisions.isError && <p className="error" role="alert">Не удалось проверить расписание. <button type="button" className="link" onClick={() => void collisions.refetch()}>Повторить проверку</button></p>}
      {overlaps.length > 0 && <div className="workout-reschedule-overlap"><strong>На это время уже есть тренировка</strong>
        {overlaps.map(item => <p key={item.id}>{item.clientName} · {item.workoutDate !== slot.workoutDate && `${formatLocalDate(item.workoutDate)} · `}{slotTimeLabel(item)}</p>)}
      </div>}
      {invalid && <p className="error" role="alert">{invalid}</p>}
      {save.error && <p className="error" role="alert">{conflict ? 'Запись уже изменена. Откройте актуальную тренировку и выберите время заново.' : `Не удалось перенести. ${save.error.message} Выбранные дата и время сохранены в этом окне.`}</p>}
      {reload.error && <p className="error" role="alert">{reload.error.message}</p>}
      {conflict ? <button type="button" className="primary wide" disabled={busy} onClick={() => { setReloading(true); reload.mutate() }}>Открыть актуальную запись</button>
        : <button type="submit" className="primary wide" disabled={busy || Boolean(invalid) || collisions.isPending || collisions.isError} aria-busy={save.isPending}>
          {save.isPending ? 'Переносим…' : save.isError ? 'Повторить' : overlaps.length ? 'Перенести всё равно' : 'Перенести'}
        </button>}
      <button type="button" className="link workout-reschedule-cancel" disabled={busy} onClick={onClose}>Отмена</button>
    </form>
  </dialog>
}
