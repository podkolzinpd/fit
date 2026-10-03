import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useDataBackend } from '../../app/data-backend-context'
import { CloseIcon } from '../../shared/icons'
import { formatLocalDate, type LocalDate } from '../../shared/local-date'
import { FitLimePlanComposer } from './FitLimePlanComposer'
import { QuickStartWorkout } from './QuickStartWorkout'

/** One calendar entry, two existing lifecycle commands. Never infer "start" from a selected date. */
export function FitLimeWorkoutEntry({ date, returnTo, onClose }: {
  date: LocalDate
  returnTo: string
  onClose: () => void
}) {
  const { clients: clientsRepository, workouts: workoutsRepository } = useDataBackend()
  const [planning, setPlanning] = useState(false)
  const [starting, setStarting] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const clients = useQuery({ queryKey: ['clients', false], queryFn: () => clientsRepository.list(false) })
  const workouts = useQuery({ queryKey: ['workouts', undefined], queryFn: () => workoutsRepository.list(undefined, undefined) })
  useEffect(() => { if (!planning) { dialog.current?.showModal(); dialog.current?.focus({ preventScroll: true }) } }, [planning])
  if (planning) return <FitLimePlanComposer date={date} returnTo={returnTo} onClose={onClose} />
  return <dialog ref={dialog} tabIndex={-1} className="fit-lime-plan-dialog fit-lime-workout-entry" aria-label="Новая тренировка"
    onClose={(event) => { if (event.target === event.currentTarget) onClose() }}
    onCancel={(event) => { if (starting) event.preventDefault() }}>
    <button type="button" className="fit-lime-plan-close" aria-label="Закрыть выбор действия" disabled={starting} onClick={() => dialog.current?.close()}><CloseIcon /></button>
    <h2>Новая тренировка</h2>
    <QuickStartWorkout role="trainer" compact startLabel="Начать сейчас" clients={clients.data} workouts={workouts.data}
      loading={clients.isLoading || workouts.isLoading} error={clients.error ?? workouts.error}
      onRetry={() => { void clients.refetch(); void workouts.refetch() }} returnTo={returnTo} onPendingChange={setStarting} />
    <p>Начало — сейчас. Если занятие уже идёт, откроем его.</p>
    <button type="button" className="secondary wide" disabled={starting} onClick={() => setPlanning(true)}>Запланировать</button>
    <p>На {formatLocalDate(date)}<br />Дату и время можно изменить.</p>
  </dialog>
}
