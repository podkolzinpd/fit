import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useDataBackend } from '../../app/data-backend-context'
import { useAuth } from '../../app/auth-context'
import { isCoachWorkoutRedesignEnabled } from '../../app/coach-workout-redesign'
import { Coachmark } from '../../shared/ui'
import { BackIcon, CloseIcon } from '../../shared/icons'
import { todayInTimeZone, type LocalDate } from '../../shared/local-date'
import { FitLimePlanComposer } from './FitLimePlanComposer'
import { Link } from 'react-router-dom'
import { QuickStartWorkout } from './QuickStartWorkout'

/** Explicit entry for start, planning and recorded results; selecting a date never starts Live. */
export function FitLimeWorkoutEntry({ date, returnTo, onClose, resumeRequestId }: {
  date: LocalDate
  returnTo: string
  onClose: (reason?: 'navigate') => void
  resumeRequestId?: string
}) {
  const { clients: clientsRepository, workouts: workoutsRepository } = useDataBackend()
  const { actor } = useAuth()
  const reference = isCoachWorkoutRedesignEnabled(actor)
  const [planning, setPlanning] = useState(Boolean(resumeRequestId))
  const [starting, setStarting] = useState(false)
  const [choosingClient, setChoosingClient] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const clients = useQuery({ queryKey: ['clients', false], queryFn: () => clientsRepository.list(false) })
  const today = todayInTimeZone(actor?.timezone)
  const workouts = useQuery({ queryKey: ['workout-home', today], queryFn: () => workoutsRepository.home(today) })
  useEffect(() => { if (!planning) { dialog.current?.showModal(); dialog.current?.focus({ preventScroll: true }) } }, [planning])
  if (planning) return <FitLimePlanComposer date={date} returnTo={returnTo} onClose={onClose} onBack={() => setPlanning(false)} resumeRequestId={resumeRequestId} />
  return <dialog ref={dialog} tabIndex={-1} role={reference ? 'dialog' : undefined} className="fit-lime-plan-dialog fit-lime-workout-entry" aria-label="Новая тренировка"
    onClose={(event) => { if (event.target === event.currentTarget) onClose() }}
    onCancel={(event) => { if (starting) event.preventDefault() }}>
    <button type="button" className="fit-lime-plan-close" aria-label="Закрыть выбор действия" disabled={starting} onClick={() => dialog.current?.close()}><CloseIcon /></button>
    {choosingClient && <button type="button" className="fit-lime-plan-back" aria-label="Назад к выбору действия" disabled={starting} onClick={() => setChoosingClient(false)}><BackIcon /></button>}
    <h2>{choosingClient ? 'Начать тренировку' : 'Новая тренировка'}</h2>
    {choosingClient ? <QuickStartWorkout role="trainer" compact startLabel="Выбрать клиента" initialPickerOpen onPickerCancel={() => setChoosingClient(false)} clients={clients.data} workouts={workouts.data}
      loading={clients.isLoading || workouts.isLoading} error={clients.error ?? workouts.error}
      onRetry={() => { void clients.refetch(); void workouts.refetch() }} returnTo={returnTo} onPendingChange={setStarting} /> : <>
      <Coachmark id="lime-direct-client-start-2026-10" userId={actor?.userId} title="Начать тренировку" description="Выберите клиента и формат, затем нажмите «Начать тренировку».">
        <button type="button" className="primary wide" onClick={() => setChoosingClient(true)}>Начать сейчас</button>
      </Coachmark>
      <p>Выберите клиента и формат. Если занятие уже идёт, можно продолжить его.</p>
      <button type="button" className="secondary wide" onClick={() => setPlanning(true)}>Запланировать</button>
      <p>Выбрать дату и подготовить тренировку.</p>
      <Link className="link wide" to={`/workouts/new?date=${date}&mode=completed`} state={{ returnTo }}>Записать результат</Link>
      {reference && <Link className="button secondary wide" to="/schedule/templates" state={{ returnTo }}>Из шаблона</Link>}
    </>}
  </dialog>
}
