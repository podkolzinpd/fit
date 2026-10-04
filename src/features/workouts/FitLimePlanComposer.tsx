import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { useDataBackend } from '../../app/data-backend-context'
import { invalidateWorkoutResults } from '../../app/invalidate-workout-results'
import { isFitLimeEnabled } from '../../app/fit-lime'
import { FitLimeDatePicker } from '../../shared/FitLimeDatePicker'
import { AddIcon, BackIcon, CloseIcon, KeyboardIcon, MicIcon } from '../../shared/icons'
import { formatLocalDate, todayInTimeZone, type LocalDate } from '../../shared/local-date'
import { Coachmark } from '../../shared/ui'
import { ClientPicker } from '../clients'
import { hasWorkoutFormContent, quickPlanDraftChoices, retainQuickPlanDraft, removeWorkoutFormDraft, workoutFormDraftKey, writeWorkoutFormDraft, type WorkoutFormDraft } from './workout-form-draft'
import { readTodayDraft, todayDraftKey, writeTodayDraft } from './today-draft'

/** Figma's quick planned-workout entry. Live and completed entry stay separate. */
export function FitLimePlanComposer({ date, returnTo, onClose, onBack }: {
  date: LocalDate
  returnTo: string
  onClose: () => void
  onBack?: () => void
}) {
  const { actor } = useAuth()
  const { clients: clientsRepository } = useDataBackend()
  const key = workoutFormDraftKey(actor?.userId ?? 'anonymous', `new--${date}--quick`)
  const [choices] = useState(() => quickPlanDraftChoices(key, date))
  const [selection, setSelection] = useState<{ draft: WorkoutFormDraft | null } | null>(() => choices.length ? null : { draft: null })
  const [error, setError] = useState<string | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const clients = useQuery({ queryKey: ['clients', false], queryFn: () => clientsRepository.list(false) })
  useEffect(() => {
    if (!selection) { dialog.current?.showModal(); dialog.current?.focus({ preventScroll: true }) }
  }, [selection])
  function choose(choice: { key: string; draft: WorkoutFormDraft } | null) {
    if (choice?.key !== key && !retainQuickPlanDraft(key, date)) {
      setError('Не удалось сохранить прежний черновик. Продолжите его или освободите хранилище браузера.')
      return
    }
    if (choice && choice.key !== key) {
      writeWorkoutFormDraft(key, choice.draft)
      // Do not remove the retained copy until persistence of the active slot is proven.
      try {
        if (localStorage.getItem(key) === JSON.stringify(choice.draft)) removeWorkoutFormDraft(choice.key)
      } catch { /* Preserve the retained copy. */ }
    } else if (!choice) removeWorkoutFormDraft(key)
    setSelection({ draft: choice?.draft ?? null })
  }
  if (selection) return <FitLimePlanForm date={date} returnTo={returnTo} onClose={onClose} onBack={onBack} initialDraft={selection.draft} />
  return <dialog ref={dialog} tabIndex={-1} className="fit-lime-plan-dialog fit-lime-workout-entry" aria-label="Черновик плана" onClose={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <button type="button" className="fit-lime-plan-close" aria-label="Закрыть создание" onClick={onClose}><CloseIcon /></button>
    {onBack && <button type="button" className="fit-lime-plan-back" aria-label="Назад к выбору действия" onClick={onBack}><BackIcon /></button>}
    <h2>Есть сохранённый черновик</h2>
    {choices.map((choice, index) => <section key={choice.key} className="fit-lime-draft-choice">
      <p>{clients.data?.find((client) => client.id === choice.draft.clientId)?.fullName ?? (choice.draft.clientId ? 'Клиент сохранён в черновике' : 'Клиент не выбран')}</p>
      <p>{formatLocalDate(choice.draft.workoutDate)}{choice.draft.startTime ? ` · ${choice.draft.startTime}` : ' · Без времени'}{choice.draft.title ? ` · ${choice.draft.title}` : ''}</p>
      <button type="button" className={index === 0 ? 'primary wide' : 'secondary wide'} onClick={() => choose(choice)}>Продолжить черновик</button>
    </section>)}
    <button type="button" className="secondary wide" onClick={() => choose(null)}>Создать новый план</button>
    <p>На {formatLocalDate(date)}. Прежние черновики сохранятся.</p>
    {error && <p role="alert">{error}</p>}
  </dialog>
}

function FitLimePlanForm({ date, returnTo, onClose, onBack, initialDraft }: {
  date: LocalDate
  returnTo: string
  onClose: () => void
  onBack?: () => void
  initialDraft: WorkoutFormDraft | null
}) {
  const { actor } = useAuth()
  const { clients: clientsRepository, workouts } = useDataBackend()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const dialog = useRef<HTMLDialogElement>(null)
  const key = workoutFormDraftKey(actor?.userId ?? 'anonymous', `new--${date}--quick`)
  const [saved] = useState(initialDraft)
  const [title, setTitle] = useState(saved?.title ?? '')
  const [clientId, setClientId] = useState(saved?.clientId ?? '')
  const [selectedDate, setSelectedDate] = useState(saved?.workoutDate ?? date)
  const [time, setTime] = useState({ start: saved?.startTime ?? '', end: saved?.endTime ?? '' })
  const [requestId] = useState(() => saved?.requestId ?? crypto.randomUUID())
  const [error, setError] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [trainingFormat, setTrainingFormat] = useState(saved?.trainingFormat ?? 'with_trainer')
  const submitting = useRef(false)
  const savedSuccessfully = useRef(false)
  const clients = useQuery({ queryKey: ['clients', false], queryFn: () => clientsRepository.list(false) })
  const selectedClient = clients.data?.find((client) => client.id === clientId)
  const draft = {
    clientId, title, requestId, workoutDate: selectedDate, startTime: time.start,
    endTime: time.end, notes: saved?.notes ?? '', stageId: saved?.stageId ?? '',
    recordCompleted: false, exercises: saved?.exercises ?? [], trainingFormat,
  }
  useEffect(() => {
    if (saved?.recordCompleted) {
      navigate(`/workouts/new?date=${date}&entry=quick`, { replace: true, state: { returnTo } })
      return
    }
    dialog.current?.showModal()
    dialog.current?.focus({ preventScroll: true })
  }, [date, navigate, returnTo, saved?.recordCompleted])
  useEffect(() => { if (!savedSuccessfully.current && !saved?.recordCompleted && hasWorkoutFormContent(draft, date)) writeWorkoutFormDraft(key, draft) }, [key, draft, date, saved?.recordCompleted])
  const mutation = useMutation({
    mutationFn: () => workouts.save({
      ...draft, title: title.trim() || null, stageId: draft.stageId || null,
      startTime: time.start || undefined, endTime: time.end || undefined,
    }),
    onSuccess: async (id) => {
      savedSuccessfully.current = true
      removeWorkoutFormDraft(key)
      await invalidateWorkoutResults(queryClient)
      await queryClient.invalidateQueries({ queryKey: ['today-workouts'] })
      dialog.current?.close()
      navigate(returnTo, { replace: true, state: { savedPlanId: id } })
    },
    onSettled: () => { submitting.current = false },
  })
  function submit(event: FormEvent) {
    event.preventDefault()
    if (submitting.current || !isFitLimeEnabled(actor)) return
    if (!clientId) { setError('Выберите клиента для тренировки'); setPickerOpen(true); return }
    if (time.end && !time.start) { setError('Укажите начало тренировки или уберите время окончания.'); return }
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
    const voiceKey = todayDraftKey(actor!.userId, requestId)
    const previous = readTodayDraft(voiceKey)
    writeTodayDraft(voiceKey, {
      ...previous, screen: 'compose', text: previous?.text ?? saved?.composerText ?? '', choices: previous?.choices ?? {},
      items: draft.exercises.map((exercise) => ({
        line: exercise.name, exercise, sets: exercise.sets, hasValues: true,
        trainerComment: exercise.trainerComment, structure: exercise,
      })),
      clientId, workoutDate: selectedDate, startTime: time.start, endTime: time.end,
      trainingFormat, title, requestId, sourceFormDraftKey: key, recordMode: 'planned',
    })
    const params = new URLSearchParams({ view: 'compose', entry, date: selectedDate, plan: requestId })
    navigate(`/today?${params}`, { state: { returnTo, planClientId: clientId, planStartTime: time.start, planEndTime: time.end, planTrainingFormat: trainingFormat, planTitle: title, planRequestId: requestId, sourceFormDraftKey: key } })
    onClose()
  }
  const today = todayInTimeZone(actor?.timezone)
  const dateLabel = selectedDate === today ? 'Сегодня' : selectedDate.slice(0, 4) === today.slice(0, 4)
    ? formatLocalDate(selectedDate).replace(/\s+\d{4}\s*г\.$/, '') : formatLocalDate(selectedDate)
  if (!isFitLimeEnabled(actor) || saved?.recordCompleted) return null
  return <dialog ref={dialog} tabIndex={-1} role="dialog" className="fit-lime-plan-dialog" aria-label="Быстрое создание тренировки" onClose={(event) => { if (event.target === event.currentTarget) onClose() }} onCancel={(event) => { if (mutation.isPending) event.preventDefault() }}>
    <form className="fit-lime-plan-composer" onSubmit={submit} inert={pickerOpen} style={pickerOpen ? { visibility: 'hidden' } : undefined}>
      <button type="button" className="fit-lime-plan-close" aria-label="Закрыть создание" disabled={mutation.isPending} onPointerDown={(event) => event.preventDefault()} onClick={() => dialog.current?.close()}><CloseIcon /></button>
      {onBack && <button type="button" className="fit-lime-plan-back" aria-label="Назад к выбору действия" disabled={mutation.isPending} onPointerDown={(event) => event.preventDefault()} onClick={onBack}><BackIcon /></button>}
      <h2>Запланировать тренировку</h2>
      <input aria-label="Название тренировки" placeholder="Название тренировки" maxLength={120} value={title} disabled={mutation.isPending} onChange={(event) => setTitle(event.target.value)} />
      <fieldset disabled={mutation.isPending}>
        <div className="fit-lime-plan-controls">
          <button type="button" className="fit-lime-plan-chip" onClick={() => setPickerOpen(true)} aria-label={`Клиент: ${selectedClient?.fullName ?? 'Выберите клиента'}`}>{selectedClient ? <span className="fit-lime-plan-avatar">{selectedClient.fullName.slice(0, 1)}</span> : <AddIcon />}<span>{selectedClient?.fullName ?? 'Клиент'}</span></button>
          <FitLimeDatePicker value={selectedDate} onChange={setSelectedDate} time={time} onTimeChange={setTime} triggerLabel={`${dateLabel}${time.start ? ` ${time.start}` : ''}`} />
        </div>
        {!time.start && <p className="fit-lime-plan-time-hint">{time.end ? 'Начало не указано' : 'Без времени'}</p>}
        <div className="workout-record-mode" role="group" aria-label="Формат тренировки">
          <button type="button" className={trainingFormat === 'with_trainer' ? 'active' : ''} aria-pressed={trainingFormat === 'with_trainer'} onClick={() => setTrainingFormat('with_trainer')}>С тренером</button>
          <button type="button" className={trainingFormat === 'self' ? 'active' : ''} aria-pressed={trainingFormat === 'self'} onClick={() => setTrainingFormat('self')}>Самостоятельно</button>
        </div>
        <div className="fit-lime-plan-input-methods">
          <button type="button" onClick={() => openComposer('voice')}><MicIcon />Надиктовать тренировку</button>
          <button type="button" onClick={() => openComposer('text')}><KeyboardIcon />Ввести текстом</button>
        </div>
        <Coachmark id="lime-quick-plan-2026-10" userId={actor?.userId} title="План можно сохранить сразу" description="Выберите клиента и дату, а упражнения добавьте сейчас или позже.">
          <button type="button" className="fit-lime-plan-exercises" onClick={openEditor}><AddIcon />{draft.exercises.length ? 'Продолжить редактирование' : 'Добавить упражнения'}</button>
        </Coachmark>
        <button type="submit" className="primary wide fit-lime-plan-save" aria-busy={mutation.isPending}>{mutation.isPending ? 'Сохраняем…' : 'Сохранить план'}</button>
      </fieldset>
      {(error || mutation.error) && <p className="error" role="alert">{error ?? mutation.error?.message}</p>}
      {mutation.isPending && <p role="status">Сохраняем…</p>}
    </form>
    {pickerOpen && <ClientPicker userId={actor?.userId} clients={clients.data ?? []} selectedId={clientId} onChange={(id) => { setClientId(id); setError(null) }} loading={clients.isLoading} error={clients.error} onRetry={() => void clients.refetch()} autoFocusSearch={false} initialOpen hideTrigger onDismiss={() => setPickerOpen(false)} />}
  </dialog>
}
