import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useDataBackend } from '../../app/data-backend-context'
import type { Workout, WorkoutAttendanceDraft } from '../../shared/domain'
import { formatLocalDate } from '../../shared/local-date'
import { CheckSmallIcon, CloseIcon } from '../../shared/icons'
import { workoutTrainingFormatLabel } from './workout-training-format'
import './workout-attendance.css'

export function WorkoutAttendanceSheet({ workout, action, onCompleted, onClose, beforeSave }: {
  workout: Workout; action: 'complete' | 'cancel'
  onCompleted: () => Promise<void>; onClose: () => void; beforeSave?: () => Promise<Workout>
}) {
  const { workouts, trainerFinance } = useDataBackend()
  const queryClient = useQueryClient()
  const [target, setTarget] = useState(workout)
  const [selection, setSelection] = useState('auto')
  const [editing, setEditing] = useState(false)
  const [needsReload, setNeedsReload] = useState(false)
  const requestId = useRef(crypto.randomUUID())
  const submitting = useRef(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const completed = action === 'complete'
  const withTrainer = (target.trainingFormat ?? 'self') === 'with_trainer'
  const finance = useQuery({ queryKey: ['trainer-finance', target.clientId],
    queryFn: () => trainerFinance.listClient(target.clientId), enabled: completed && withTrainer })
  const eligible = finance.data?.packages.filter(p => p.kind === 'session_pack' && !p.closedAt
    && p.startsOn <= target.workoutDate && (!p.endsOn || p.endsOn >= target.workoutDate) && p.sessionsRemaining > 0) ?? []
  const selected = selection.startsWith('charged:') ? eligible.find(p => p.id === selection.slice(8)) : undefined
  const automatic = selection === 'auto' && eligible.length === 1 ? eligible[0] : undefined
  const pack = selected ?? automatic
  const accountingTitle = selection === 'trial' ? 'Пробное занятие' : selection === 'free' || !withTrainer ? 'Без списания'
    : selection === 'unassigned' ? 'Выбрать абонемент позже' : pack ? 'Спишется 1 занятие'
      : eligible.length > 1 ? 'Нужно выбрать абонемент' : 'Нет подходящего абонемента'
  const accountingDetail = pack ? `${pack.title} · останется ${pack.sessionsRemaining - 1}`
    : !withTrainer ? 'Абонемент не списывается' : 'Занятие сохранится без списания'
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.showModal()
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  const save = useMutation({
    mutationFn: async () => {
      if (!completed) { await workouts.cancelPlanned(target); return }
      if (!workouts.confirmAttendance) throw new Error('Проведение занятия недоступно')
      if (selection.startsWith('charged:') && !selected) throw new Error('Обновите список абонементов')
      const disposition = selected ? 'charged' : selection === 'trial' ? 'trial' : selection === 'free' ? 'free' : selection === 'unassigned' ? 'unassigned' : 'auto'
      const draft: WorkoutAttendanceDraft = { disposition, packageId: selected?.id ?? null }
      const prepared = beforeSave ? await beforeSave() : target
      await workouts.confirmAttendance(prepared, draft, requestId.current)
    },
    onSuccess: onCompleted,
    onError: () => setNeedsReload(true),
    onSettled: () => { submitting.current = false },
  })
  const reload = useMutation({ mutationFn: () => workouts.get(workout.id), onSuccess: async fresh => {
    queryClient.setQueryData(['workout', fresh.id], fresh)
    if (fresh.status === (completed ? 'done' : 'cancelled')) { await onCompleted(); return }
    if (fresh.status !== target.status) { onClose(); return }
    setTarget(fresh); requestId.current = crypto.randomUUID(); setNeedsReload(false); save.reset()
    if (completed && withTrainer) await finance.refetch()
  } })
  const busy = save.isPending || reload.isPending
  const financePending = completed && withTrainer && (finance.isPending || finance.isError)
  return <dialog ref={dialog} className="workout-attendance-sheet" aria-label={completed ? 'Отметить проведённой' : 'Тренировка не состоялась'}
    onCancel={event => { if (busy) event.preventDefault() }} onClose={event => { if (event.target === event.currentTarget) onClose() }}>
    <header><h2>{completed ? 'Отметить проведённой' : 'Не состоялась'}</h2><button type="button" aria-label="Закрыть" disabled={busy} onClick={onClose}><CloseIcon /></button></header>
    <p className="workout-attendance-client">{target.clientName}</p>
    <p className="workout-attendance-date">{formatLocalDate(target.workoutDate)} · {target.startTime?.slice(0, 5) ?? 'без времени'} · {workoutTrainingFormatLabel(target.trainingFormat ?? 'self')}</p>
    <form onSubmit={event => { event.preventDefault(); if (!busy && !submitting.current && !needsReload && !financePending) { submitting.current = true; save.mutate() } }}>
      {completed ? <section className="workout-attendance-accounting" aria-label="Учёт занятия">
        {financePending ? <p role={finance.isError ? 'alert' : 'status'}>{finance.isError ? 'Не удалось загрузить абонементы.' : 'Проверяем абонементы…'}{finance.isError && <button type="button" className="link" onClick={() => void finance.refetch()}>Повторить</button>}</p>
          : <><strong><CheckSmallIcon />{accountingTitle}</strong><p>{accountingDetail}</p></>}
        {withTrainer && !financePending && <><button type="button" className="link" disabled={busy} onClick={() => setEditing(!editing)}>Изменить учёт</button>
          {editing && <label>Учёт занятия<select value={selection} disabled={busy} onChange={event => setSelection(event.target.value)}>
            <option value="auto">По текущим условиям</option>{eligible.map(p => <option key={p.id} value={`charged:${p.id}`}>Списать: {p.title}</option>)}
            <option value="unassigned">Выбрать позже</option><option value="trial">Пробное</option><option value="free">Без списания</option>
          </select></label>}</>}
      </section> : <p className="workout-attendance-accounting">Запись и план сохранятся. Занятие не спишется.</p>}
      {completed && <p className="workout-attendance-note">Записанные результаты сохранятся. Остальные можно добавить позже.</p>}
      {(save.error || reload.error) && <p className="error" role="alert">{(reload.error ?? save.error)?.message}</p>}
      {needsReload && <button type="button" className="secondary wide" disabled={busy} onClick={() => reload.mutate()}>Обновить запись</button>}
      <button type="submit" className="primary wide" disabled={busy || needsReload || financePending} aria-busy={save.isPending}>{save.isPending ? 'Сохраняем…' : completed ? 'Подтвердить проведение' : 'Отметить: не состоялась'}</button>
      <button type="button" className="link workout-attendance-cancel" disabled={busy} onClick={onClose}>Отмена</button>
    </form>
  </dialog>
}
