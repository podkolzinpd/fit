import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { useDataBackend } from '../../app/data-backend-context'
import { invalidateWorkoutResults } from '../../app/invalidate-workout-results'
import { isFitLimeEnabled } from '../../app/fit-lime'
import { FitLimeDatePicker } from '../../shared/FitLimeDatePicker'
import { AddIcon, ArrowUpIcon, CloseIcon, KeyboardIcon, MicIcon } from '../../shared/icons'
import { formatLocalDate, todayInTimeZone, type LocalDate } from '../../shared/local-date'
import { Coachmark } from '../../shared/ui'
import { ClientPicker } from '../clients'
import { readWorkoutFormDraft, removeWorkoutFormDraft, workoutFormDraftKey, writeWorkoutFormDraft } from './workout-form-draft'

/** Figma's quick planned-workout entry. Live and completed entry stay separate. */
export function FitLimePlanComposer({ date, returnTo, onClose }: {
  date: LocalDate
  returnTo: string
  onClose: () => void
}) {
  const { actor } = useAuth()
  const { clients: clientsRepository, workouts } = useDataBackend()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const dialog = useRef<HTMLDialogElement>(null)
  const key = workoutFormDraftKey(actor?.userId ?? 'anonymous', `new--${date}--quick`)
  const [saved] = useState(() => readWorkoutFormDraft(key))
  const [title, setTitle] = useState(saved?.title ?? '')
  const [clientId, setClientId] = useState(saved?.clientId ?? '')
  const [selectedDate, setSelectedDate] = useState(saved?.workoutDate ?? date)
  const [time, setTime] = useState({ start: saved?.startTime ?? '', end: saved?.endTime ?? '' })
  const [requestId] = useState(() => saved?.requestId ?? crypto.randomUUID())
  const [error, setError] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const submitting = useRef(false)
  const savedSuccessfully = useRef(false)
  const clients = useQuery({ queryKey: ['clients', false], queryFn: () => clientsRepository.list(false) })
  const selectedClient = clients.data?.find((client) => client.id === clientId)
  const draft = {
    clientId, title, requestId, workoutDate: selectedDate, startTime: time.start,
    endTime: time.end, notes: saved?.notes ?? '', stageId: saved?.stageId ?? '',
    recordCompleted: false, exercises: saved?.exercises ?? [], trainingFormat: saved?.trainingFormat,
  }
  useEffect(() => {
    if (saved?.recordCompleted) {
      navigate(`/workouts/new?date=${date}&entry=quick`, { replace: true, state: { returnTo } })
      return
    }
    dialog.current?.showModal()
  }, [date, navigate, returnTo, saved?.recordCompleted])
  useEffect(() => { if (!savedSuccessfully.current && !saved?.recordCompleted) writeWorkoutFormDraft(key, draft) }, [key, draft, saved?.recordCompleted])
  const mutation = useMutation({
    mutationFn: () => workouts.save({
      ...draft, title: title.trim() || null, stageId: draft.stageId || null,
      startTime: time.start || undefined, endTime: time.end || undefined,
    }),
    onSuccess: async () => {
      savedSuccessfully.current = true
      removeWorkoutFormDraft(key)
      await invalidateWorkoutResults(queryClient)
      await queryClient.invalidateQueries({ queryKey: ['today-workouts'] })
      dialog.current?.close()
    },
    onSettled: () => { submitting.current = false },
  })
  function submit(event: FormEvent) {
    event.preventDefault()
    if (submitting.current || !isFitLimeEnabled(actor)) return
    if (!clientId) { setError('Выберите клиента для тренировки'); setPickerOpen(true); return }
    const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5))
    const duration = (minutes(time.end) - minutes(time.start) + 1440) % 1440
    if (time.start && time.end && (duration === 0 || duration > 720)) {
      setError('Окончание должно быть после начала, длительность — не больше 12 часов.')
      return
    }
    setError(null)
    submitting.current = true
    mutation.mutate()
  }
  function openEditor() {
    writeWorkoutFormDraft(key, draft)
    navigate(`/workouts/new?date=${date}&entry=quick`, { state: { returnTo } })
    onClose()
  }
  function openComposer(entry: 'voice' | 'text') {
    writeWorkoutFormDraft(key, draft)
    const params = new URLSearchParams({ view: 'compose', entry, date: selectedDate })
    navigate(`/today?${params}`, { state: { returnTo, planClientId: clientId, planStartTime: time.start, planTitle: title, planRequestId: requestId, sourceFormDraftKey: key } })
    onClose()
  }
  const today = todayInTimeZone(actor?.timezone)
  const dateLabel = selectedDate === today ? 'Сегодня' : selectedDate.slice(0, 4) === today.slice(0, 4)
    ? formatLocalDate(selectedDate).replace(/\s+\d{4}\s*г\.$/, '') : formatLocalDate(selectedDate)
  if (!isFitLimeEnabled(actor) || saved?.recordCompleted) return null
  return <dialog ref={dialog} role="dialog" className="fit-lime-plan-dialog" aria-label="Быстрое создание тренировки" onClose={(event) => { if (event.target === event.currentTarget) onClose() }} onCancel={(event) => { if (mutation.isPending) event.preventDefault() }}>
    <form className="fit-lime-plan-composer" onSubmit={submit}>
      <button type="button" className="fit-lime-plan-close" aria-label="Закрыть создание" disabled={mutation.isPending} onClick={() => dialog.current?.close()}><CloseIcon /></button>
      <input aria-label="Название тренировки" placeholder="Название тренировки" maxLength={120} value={title} disabled={mutation.isPending} onChange={(event) => setTitle(event.target.value)} autoFocus />
      <fieldset disabled={mutation.isPending}>
        <div className="fit-lime-plan-controls">
          <button type="button" className="fit-lime-plan-chip" onClick={() => setPickerOpen(true)} aria-label={`Клиент: ${selectedClient?.fullName ?? 'Выберите клиента'}`}>{selectedClient ? <span className="fit-lime-plan-avatar">{selectedClient.fullName.slice(0, 1)}</span> : <AddIcon />}<span>{selectedClient?.fullName ?? 'Клиент'}</span></button>
          <FitLimeDatePicker value={selectedDate} onChange={setSelectedDate} time={time} onTimeChange={setTime} triggerLabel={`${dateLabel}${time.start ? ` ${time.start}` : ''}`} />
          {title.trim() || clientId || draft.exercises.length ? <button type="submit" className="fit-lime-plan-send" aria-label="Сохранить план" aria-busy={mutation.isPending}><ArrowUpIcon /></button> : <button type="button" className="fit-lime-plan-mic" aria-label="Надиктовать тренировку" onClick={() => openComposer('voice')}><MicIcon /></button>}
        </div>
        <div className="fit-lime-plan-input-methods">
          {Boolean(title.trim() || clientId || draft.exercises.length) && <button type="button" onClick={() => openComposer('voice')}><MicIcon />Надиктовать тренировку</button>}
          <button type="button" onClick={() => openComposer('text')}><KeyboardIcon />Ввести текстом</button>
        </div>
        <Coachmark id="lime-quick-plan-2026-10" userId={actor?.userId} title="План можно сохранить сразу" description="Выберите клиента и дату, а упражнения добавьте сейчас или позже.">
          <button type="button" className="fit-lime-plan-exercises" onClick={openEditor}><AddIcon />{draft.exercises.length ? 'Продолжить редактирование' : 'Добавить упражнения'}</button>
        </Coachmark>
      </fieldset>
      {(error || mutation.error) && <p className="error" role="alert">{error ?? mutation.error?.message}</p>}
      {mutation.isPending && <p role="status">Сохраняем…</p>}
    </form>
    {pickerOpen && <ClientPicker userId={actor?.userId} clients={clients.data ?? []} selectedId={clientId} onChange={(id) => { setClientId(id); setError(null) }} loading={clients.isLoading} error={clients.error} onRetry={() => void clients.refetch()} initialOpen hideTrigger onDismiss={() => setPickerOpen(false)} />}
  </dialog>
}
