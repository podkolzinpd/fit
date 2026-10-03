import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useDataBackend } from '../../app/data-backend-context'
import { useAuth } from '../../app/auth-context'
import { Coachmark } from '../../shared/ui'
import { BackIcon, CloseIcon } from '../../shared/icons'
import { type LocalDate } from '../../shared/local-date'
import { FitLimePlanComposer } from './FitLimePlanComposer'
import { QuickStartWorkout } from './QuickStartWorkout'

/** One calendar entry, two existing lifecycle commands. Never infer "start" from a selected date. */
export function FitLimeWorkoutEntry({ date, returnTo, onClose }: {
  date: LocalDate
  returnTo: string
  onClose: () => void
}) {
  const { clients: clientsRepository, workouts: workoutsRepository } = useDataBackend()
  const { actor } = useAuth()
  const [planning, setPlanning] = useState(false)
  const [starting, setStarting] = useState(false)
  const [choosingClient, setChoosingClient] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const clients = useQuery({ queryKey: ['clients', false], queryFn: () => clientsRepository.list(false) })
  const workouts = useQuery({ queryKey: ['workouts', undefined], queryFn: () => workoutsRepository.list(undefined, undefined) })
  useEffect(() => { if (!planning) { dialog.current?.showModal(); dialog.current?.focus({ preventScroll: true }) } }, [planning])
  if (planning) return <FitLimePlanComposer date={date} returnTo={returnTo} onClose={onClose} onBack={() => setPlanning(false)} />
  return <dialog ref={dialog} tabIndex={-1} className="fit-lime-plan-dialog fit-lime-workout-entry" aria-label="Новая тренировка"
    onClose={(event) => { if (event.target === event.currentTarget) onClose() }}
    onCancel={(event) => { if (starting) event.preventDefault() }}>
    <button type="button" className="fit-lime-plan-close" aria-label="Закрыть выбор действия" disabled={starting} onClick={() => dialog.current?.close()}><CloseIcon /></button>
    {choosingClient && <button type="button" className="fit-lime-plan-back" aria-label="Назад к выбору действия" disabled={starting} onClick={() => setChoosingClient(false)}><BackIcon /></button>}
    <h2>{choosingClient ? 'Начать тренировку' : 'Новая тренировка'}</h2>
    {choosingClient ? <QuickStartWorkout role="trainer" compact startLabel="Выбрать клиента" startOnClientSelection initialPickerOpen onPickerCancel={() => setChoosingClient(false)} clients={clients.data} workouts={workouts.data}
      loading={clients.isLoading || workouts.isLoading} error={clients.error ?? workouts.error}
      onRetry={() => { void clients.refetch(); void workouts.refetch() }} returnTo={returnTo} onPendingChange={setStarting} /> : <>
      <Coachmark id="lime-direct-client-start-2026-10" userId={actor?.userId} title="Начало без лишнего шага" description="Выберите клиента — занятие начнётся сразу, а уже начатое откроется без дубля.">
        <button type="button" className="primary wide" onClick={() => setChoosingClient(true)}>Начать сейчас</button>
      </Coachmark>
      <p>Выберите клиента — тренировка начнётся сразу. Если занятие уже идёт, откроем его.</p>
      <button type="button" className="secondary wide" onClick={() => setPlanning(true)}>Запланировать</button>
      <p>Выбрать дату и подготовить тренировку.</p>
    </>}
  </dialog>
}
