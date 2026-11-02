import { useCreateWorkoutClient } from './use-create-workout-client'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { useDataBackend } from '../../app/data-backend-context'
import { invalidateWorkoutResults } from '../../app/invalidate-workout-results'
import { isFitLimeEnabled } from '../../app/fit-lime'
import { isQuickWorkoutEntryEnabled } from '../../app/quick-workout-entry'
import { FitLimeDatePicker } from '../../shared/FitLimeDatePicker'
import { AddIcon, CloseIcon } from '../../shared/icons'
import { formatRelativeLocalDate, todayInTimeZone, type LocalDate } from '../../shared/local-date'
import { ClientPicker } from '../clients'
import { readWorkoutFormDraft, removeWorkoutFormDraft, workoutFormDraftKey, writeWorkoutFormDraft, type WorkoutFormDraft } from './workout-form-draft'

/** Coordinates are relative to the actual scrolled grid; the hour gutter is inert. */
export function dayBookingTime(target: Element, x: number, y: number, hourHeight: number): string | null {
  const grid = target.closest<HTMLElement>('.day-grid')
  const viewport = target.closest('.schedule-v2-timeline')
  if (!grid || !viewport || !Number.isFinite(hourHeight) || hourHeight <= 0) return null
  const rect = grid.getBoundingClientRect()
  const line = grid.querySelector('.day-grid-hour-line')?.getBoundingClientRect()
  if (x < (line?.left ?? rect.left + 56) || x > rect.right || y < rect.top || y >= rect.top + 24 * hourHeight) return null
  const minutes = Math.min(1425, Math.floor((y - rect.top) / hourHeight * 4) * 15)
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** A planned workout with no exercises, using the existing save and retry identity. */
export function QuickDayBooking({ date, time, returnTo, onClose }: { date: LocalDate; time: string; returnTo: string; onClose: () => void }) {
  const { actor } = useAuth()
  const { clients: clientsRepository, workouts } = useDataBackend()
  const createClient = useCreateWorkoutClient()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const key = workoutFormDraftKey(actor?.userId ?? 'anonymous', `booking--${date}--${time}`)
  const [saved] = useState(() => readWorkoutFormDraft(key))
  const [clientId, setClientId] = useState(saved?.clientId ?? '')
  const [selectedDate, setSelectedDate] = useState(saved?.workoutDate ?? date)
  const [selectedTime, setSelectedTime] = useState({ start: saved?.startTime ?? time, end: saved?.endTime ?? '' })
  const [requestId] = useState(() => saved?.requestId ?? crypto.randomUUID())
  const [pickerOpen, setPickerOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const submitting = useRef(false)
  const committed = useRef(false)
  const clients = useQuery({ queryKey: ['clients', false], queryFn: () => clientsRepository.list(false) })
  const client = clients.data?.find(item => item.id === clientId)
  const draft: WorkoutFormDraft = { clientId, workoutDate: selectedDate, startTime: selectedTime.start, endTime: selectedTime.end,
    requestId, title: '', exercises: [], notes: '', stageId: '', recordCompleted: false, trainingFormat: 'with_trainer', executionMode: 'manual' }
  useEffect(() => { dialog.current?.showModal(); dialog.current?.focus({ preventScroll: true }) }, [])
  useEffect(() => { if (!committed.current && clientId) writeWorkoutFormDraft(key, draft) }, [key, draft, clientId])
  const save = useMutation({
    mutationFn: () => workouts.save({ ...draft, title: null, stageId: null, startTime: selectedTime.start || undefined, endTime: selectedTime.end || undefined }),
    onSuccess: async id => {
      committed.current = true
      removeWorkoutFormDraft(key)
      await invalidateWorkoutResults(queryClient)
      await queryClient.invalidateQueries({ queryKey: ['today-workouts'] })
      onClose()
      navigate(returnTo, { replace: true, state: { savedPlanId: id } })
    },
    onSettled: () => { submitting.current = false },
  })
  function submit(event: FormEvent) {
    event.preventDefault()
    if (submitting.current || !isQuickWorkoutEntryEnabled(actor) || actor?.role !== 'trainer') return
    // Restored drafts can reference a client no longer present in the active list.
    if (!client) { setError('Выберите клиента'); setPickerOpen(true); return }
    if (!selectedTime.start) { setError('Укажите время записи'); return }
    const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5))
    const duration = (minutes(selectedTime.end) - minutes(selectedTime.start) + 1440) % 1440
    if (selectedTime.end && (duration === 0 || duration > 720)) { setError('Окончание должно быть после начала, длительность — не больше 12 часов.'); return }
    setError(null); submitting.current = true; save.mutate()
  }
  if (!isQuickWorkoutEntryEnabled(actor) || actor?.role !== 'trainer') return null
  return <dialog ref={dialog} tabIndex={-1} className="fit-lime-plan-dialog quick-day-booking" aria-label="Записать клиента" onClose={event => { if (event.target === event.currentTarget) onClose() }} onCancel={event => { if (save.isPending) event.preventDefault() }}>
    <form onSubmit={submit} inert={pickerOpen} style={pickerOpen ? { visibility: 'hidden' } : undefined}>
      <header><h2>Записать клиента</h2><button type="button" aria-label="Закрыть запись" disabled={save.isPending} onClick={() => dialog.current?.close()}><CloseIcon /></button></header>
      <fieldset disabled={save.isPending}>
        <button type="button" className="quick-booking-client" onClick={() => setPickerOpen(true)}><span className="fit-lime-plan-avatar">{client?.fullName.slice(0, 1) ?? <AddIcon />}</span><span>{client?.fullName ?? 'Выбрать клиента'}</span></button>
        <FitLimeDatePicker today={todayInTimeZone(actor.timezone)} value={selectedDate} onChange={setSelectedDate} time={selectedTime} onTimeChange={setSelectedTime} reference={isFitLimeEnabled(actor)} triggerLabel={`${formatRelativeLocalDate(selectedDate, todayInTimeZone(actor.timezone))} · ${selectedTime.start || 'Время'}${selectedTime.end ? `–${selectedTime.end}` : ''}`} />
        <p className="quick-booking-format">С тренером</p>
        <button type="submit" className="primary wide" aria-busy={save.isPending}>{save.isPending ? 'Сохраняем…' : 'Записать'}</button>
      </fieldset>
      {(error || save.error) && <p className="error" role="alert">{error ?? save.error?.message}</p>}
    </form>
    {pickerOpen && <ClientPicker userId={actor.userId} clients={clients.data ?? []} selectedId={clientId} onChange={id => { setClientId(id); setError(null) }} loading={clients.isLoading} error={clients.error} onRetry={() => void clients.refetch()} onCreate={createClient} reference autoFocusSearch={false} initialOpen hideTrigger onDismiss={() => setPickerOpen(false)} />}
  </dialog>
}
