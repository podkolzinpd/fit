import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../app/auth-context'
import { useDataBackend } from '../../app/data-backend-context'
import type { Workout, WorkoutAttendanceDraft } from '../../shared/domain'
import { formatLocalDate, todayInTimeZone } from '../../shared/local-date'
import { CheckSmallIcon, CloseIcon } from '../../shared/icons'
import { FitLimeSheetHeader } from '../../shared/FitLimeSheetHeader'
import { workoutTrainingFormatLabel } from './workout-training-format'
import './workout-attendance.css'

export function WorkoutAttendanceSheet({ workout, action, onCompleted, onClose, beforeSave, onDelete, onChangeDate }: {
  onChangeDate?: () => void
  workout: Workout; action: 'complete' | 'cancel' | 'choose'
  onCompleted: (action: 'complete' | 'cancel') => Promise<void>; onClose: () => void; beforeSave?: () => Promise<Workout>; onDelete?: () => Promise<unknown>
}) {
  const { workouts, trainerFinance } = useDataBackend()
  const { actor } = useAuth()
  const queryClient = useQueryClient()
  const [target, setTarget] = useState(workout)
  const [selection, setSelection] = useState('auto')
  const [editing, setEditing] = useState(false)
  const [needsReload, setNeedsReload] = useState(false)
  const requestId = useRef(crypto.randomUUID())
  const submitting = useRef(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const live = action === 'choose'
  const [choice, setChoice] = useState<'complete' | 'cancel' | 'delete'>('complete')
  const currentAction = action === 'choose' ? choice : action
  const completed = currentAction === 'complete'
  const deleting = currentAction === 'delete'
  const futureCompletion = completed && target.workoutDate > todayInTimeZone(actor?.timezone)
  const canDelete = live && Boolean(onDelete) && target.status === 'in_progress' && target.exercises.length === 0
  const withTrainer = (target.trainingFormat ?? 'self') === 'with_trainer'
  const finance = useQuery({ queryKey: ['trainer-finance', target.clientId],
    queryFn: () => trainerFinance.listClient(target.clientId), enabled: completed && withTrainer && !futureCompletion })
  const eligible = finance.data?.packages.filter(p => p.kind === 'session_pack' && !p.closedAt
    && p.startsOn <= target.workoutDate && (!p.endsOn || p.endsOn >= target.workoutDate) && p.sessionsRemaining > 0) ?? []
  const selected = selection.startsWith('charged:') ? eligible.find(p => p.id === selection.slice(8)) : undefined
  const automatic = selection === 'auto' && eligible.length === 1 ? eligible[0] : undefined
  const pack = selected ?? automatic
  const accountingTitle = selection === 'trial' ? 'Пробное занятие' : selection === 'free' || !withTrainer ? 'Без списания'
    : selection === 'unassigned' ? 'Абонемент не выбран' : pack ? 'Спишется 1 занятие'
      : eligible.length > 1 ? 'Абонемент не выбран' : 'Нет подходящего абонемента'
  const accountingDetail = pack ? `${pack.title} · останется ${pack.sessionsRemaining - 1}`
    : !withTrainer ? 'Абонемент не списывается' : 'Занятие сохранится без списания'
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.showModal()
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  const save = useMutation({
    mutationFn: async (intent: 'complete' | 'cancel' | 'delete') => {
      if (intent === 'delete') {
        if (!canDelete || !onDelete) throw new Error('Удаление доступно только для пустой тренировки')
        await onDelete(); return
      }
      if (intent === 'cancel') { const prepared = beforeSave ? await beforeSave() : target; await workouts.cancelPlanned(prepared); return }
      if (futureCompletion) throw new Error('Сначала выберите фактическую дату занятия')
      if (!workouts.confirmAttendance) throw new Error('Проведение занятия недоступно')
      if (selection.startsWith('charged:') && !selected) throw new Error('Обновите список абонементов')
      const disposition = selected ? 'charged' : selection === 'trial' ? 'trial' : selection === 'free' ? 'free' : selection === 'unassigned' ? 'unassigned' : 'auto'
      const draft: WorkoutAttendanceDraft = { disposition, packageId: selected?.id ?? null }
      const prepared = beforeSave ? await beforeSave() : target
      await workouts.confirmAttendance(prepared, draft, requestId.current)
    },
    onSuccess: (_data, intent) => intent === 'delete' ? undefined : onCompleted(intent),
    onError: () => setNeedsReload(true),
    onSettled: () => { submitting.current = false },
  })
  const reload = useMutation({ mutationFn: () => workouts.get(workout.id), onSuccess: async fresh => {
    queryClient.setQueryData(['workout', fresh.id], fresh)
    if (currentAction !== 'delete' && fresh.status === (completed ? 'done' : 'cancelled')) { await onCompleted(currentAction); return }
    if (fresh.status !== target.status) { onClose(); return }
    if (currentAction === 'delete' && fresh.exercises.length > 0) setChoice('complete')
    if (fresh.version !== target.version) requestId.current = crypto.randomUUID()
    setTarget(fresh); setNeedsReload(false); save.reset()
    if (completed && withTrainer) await finance.refetch()
  } })
  const busy = save.isPending || reload.isPending
  const financePending = completed && withTrainer && (finance.isPending || finance.isFetching || finance.isError)
  return <dialog ref={dialog} className={`workout-attendance-sheet${live ? ' workout-live-exit-sheet workout-decision-sheet' : ''}`} aria-label={live ? 'Завершение тренировки' : completed ? 'Отметить проведённой' : 'Тренировка не состоялась'}
    onCancel={event => { if (busy) event.preventDefault() }} onClose={event => { if (event.target === event.currentTarget) onClose() }}>
    {live ? <FitLimeSheetHeader title="Завершение тренировки" backLabel="Закрыть" onBack={onClose} disabled={busy} /> : <header><h2>{completed ? 'Отметить проведённой' : 'Не состоялась'}</h2><button type="button" aria-label="Закрыть" disabled={busy} onClick={onClose}><CloseIcon /></button></header>}
    <p className="workout-attendance-client">{target.clientName}</p>
    <p className="workout-attendance-date">{formatLocalDate(target.workoutDate)} · {target.startTime?.slice(0, 5) ?? 'без времени'} · {workoutTrainingFormatLabel(target.trainingFormat ?? 'self')}</p>
    <form onSubmit={event => { event.preventDefault(); if (!busy && !submitting.current && !needsReload && !futureCompletion && !financePending && (!deleting || canDelete)) { submitting.current = true; save.mutate(currentAction) } }}>
      {live && <fieldset className="workout-live-exit-choices" disabled={busy || needsReload}>
        <legend className="sr-only">Действие с тренировкой</legend>
        {([{ value: 'complete', label: 'Завершить тренировку' }, { value: 'cancel', label: 'Отметить как несостоявшуюся' }, ...(canDelete ? [{ value: 'delete', label: 'Удалить пустую тренировку' }] : [])] as const).map(item => <label key={item.value} className={item.value === 'delete' ? 'workout-live-exit-delete' : undefined}>
          <input type="radio" name="live-exit-action" value={item.value} checked={currentAction === item.value} onChange={() => { if (item.value === 'complete' || item.value === 'cancel' || item.value === 'delete') setChoice(item.value) }} /><span>{item.label}</span>
        </label>)}
      </fieldset>}
      {futureCompletion ? <section className="workout-attendance-accounting" role="status"><strong>Дата занятия ещё не наступила</strong><p>Выберите сегодня или прошедший день перед проведением.</p>{onChangeDate && <button type="button" className="secondary" disabled={busy} onClick={onChangeDate}>Изменить дату</button>}</section> : completed ? <section className="workout-attendance-accounting" aria-label="Учёт занятия">
        {financePending ? <p role={finance.isError ? 'alert' : 'status'}>{finance.isError ? 'Не удалось загрузить абонементы.' : 'Проверяем абонементы…'}{finance.isError && <button type="button" className="link" onClick={() => void finance.refetch()}>Повторить</button>}</p>
          : <><strong><CheckSmallIcon />{accountingTitle}</strong><p>{accountingDetail}</p></>}
        {withTrainer && !financePending && <><button type="button" className="link" disabled={busy || needsReload} onClick={() => setEditing(!editing)}>{!pack && eligible.length > 1 ? 'Выбрать' : 'Изменить учёт'}</button>
          {editing && <label>Учёт занятия<select value={selection} disabled={busy || needsReload} onChange={event => setSelection(event.target.value)}>
            <option value="auto">По текущим условиям</option>{eligible.map(p => <option key={p.id} value={`charged:${p.id}`}>Списать: {p.title}</option>)}
            <option value="unassigned">Выбрать позже</option><option value="trial">Пробное</option><option value="free">Без списания</option>
          </select></label>}</>}
      </section> : !live && <p className="workout-attendance-accounting">Запись и план сохранятся. Занятие не спишется.</p>}
      {!live && !completed && target.exercises.some(exercise => exercise.sets.some(set => set.confirmedAt)) && <p className="workout-attendance-note">В тренировке есть записанные результаты. Они сохранятся, занятие не спишется.</p>}
      {!live && completed && <p className="workout-attendance-note">Записанные результаты сохранятся. Остальные можно добавить позже.</p>}
      {(save.error || reload.error) && <p className="error" role="alert">{(reload.error ?? save.error)?.message}</p>}
      {needsReload && <button type="button" className="secondary wide" disabled={busy} onClick={() => reload.mutate()}>Обновить запись</button>}
      <button type="submit" className={`primary wide${live && deleting ? ' danger' : ''}`} disabled={busy || needsReload || futureCompletion || financePending || (deleting && !canDelete)} aria-busy={save.isPending}>{save.isPending ? 'Сохраняем…' : live ? deleting ? 'Удалить пустую тренировку' : completed ? 'Завершить тренировку' : 'Отметить как несостоявшуюся' : completed ? 'Подтвердить проведение' : 'Отметить: не состоялась'}</button>
      <button type="button" className="link workout-attendance-cancel" disabled={busy} onClick={onClose}>{live ? 'Продолжить тренировку' : 'Отмена'}</button>
    </form>
  </dialog>
}
