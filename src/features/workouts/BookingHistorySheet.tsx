import { useEffect, useRef, useState } from 'react'
import { useInfiniteQuery, useMutation } from '@tanstack/react-query'
import { useAuth } from '../../app/auth-context'
import { useDataBackend } from '../../app/data-backend-context'
import { isQuickWorkoutEntryEnabled } from '../../app/quick-workout-entry'
import { blockLabel, compactCompletedSetSummary, groupIntoBlocks } from '../../data/repositories/workout-rules'
import type { Workout } from '../../shared/domain'
import { BackIcon, CloseIcon } from '../../shared/icons'
import { formatLocalDate } from '../../shared/local-date'
import { workoutDisplayTitle, workoutExerciseBrief } from './workout-chronicle'
import { historyPlanForAppointment } from './booking-history'

/** Same client history and the same target ID: never the new-workout copy route. */
export function BookingHistorySheet({ target, onClose, onApplied, onReload }: {
  target: Workout; onClose: () => void; onApplied: () => Promise<void>; onReload: () => Promise<unknown>
}) {
  const { actor } = useAuth()
  const { workouts } = useDataBackend()
  const dialog = useRef<HTMLDialogElement>(null)
  const [source, setSource] = useState<Workout | null>(null)
  const [confirmReplacement, setConfirmReplacement] = useState<number | null>(null)
  const replacementConfirmed = confirmReplacement === target.version
  const submitting = useRef(false)
  const history = useInfiniteQuery({
    queryKey: ['workouts', target.clientId, 'booking-history'], initialPageParam: 0,
    queryFn: ({ pageParam }) => workouts.listPage(undefined, undefined, target.clientId, pageParam, 30),
    getNextPageParam: page => page.nextOffset,
  })
  const items = (history.data?.pages.flatMap(page => page.items) ?? []).filter(item => item.status === 'done' && item.clientId === target.clientId && item.id !== target.id)
  useEffect(() => { dialog.current?.showModal(); dialog.current?.focus({ preventScroll: true }) }, [])
  const apply = useMutation({
    mutationFn: async () => {
      if (!source || !isQuickWorkoutEntryEnabled(actor) || actor?.role !== 'trainer') throw new Error('Недоступно')
      // Existing PUT/version contract also rejects a concurrent start or plan edit.
      await workouts.save(historyPlanForAppointment(target, source))
    },
    onSuccess: async () => { await onApplied(); onClose() },
    onSettled: () => { submitting.current = false },
  })
  function repeat() {
    if (!source || submitting.current) return
    if (target.exercises.length && !replacementConfirmed) { setConfirmReplacement(target.version); return }
    submitting.current = true; apply.mutate()
  }
  if (!isQuickWorkoutEntryEnabled(actor) || actor?.role !== 'trainer') return null
  return <dialog ref={dialog} tabIndex={-1} className="booking-history-sheet" aria-label="История тренировок клиента" onClose={event => { if (event.target === event.currentTarget) onClose() }} onCancel={event => { if (apply.isPending) event.preventDefault() }}>
    <header className="coach-reference-sheet-header"><button type="button" aria-label={source ? 'К списку истории' : 'Закрыть историю'} disabled={apply.isPending} onClick={() => { if (source) { setSource(null); setConfirmReplacement(null); apply.reset() } else dialog.current?.close() }}>{source ? <BackIcon /> : <CloseIcon />}</button><h2>{source ? 'Повторить тренировку' : 'Из истории'}</h2><span /></header>
    <div className="booking-history-scroll">
      <p className="booking-history-client">{target.clientName}</p>
      {source ? <>
        <h3>{workoutDisplayTitle(source)}</h3><time className="workout-card-date" dateTime={source.workoutDate}>{formatLocalDate(source.workoutDate)}</time>
        {groupIntoBlocks(source.exercises).map(block => <section key={block.blockId} className="booking-history-preview-block">
          {block.blockType !== 'single' && <p className="muted">{blockLabel(block.blockType, block.blockPreset)} · {block.blockRounds} кр.</p>}
          {block.exercises.map(exercise => <article key={exercise.id}><strong>{exercise.name}</strong><p>{compactCompletedSetSummary(exercise.sets, false, exercise.ref)}</p>{exercise.trainerComment && <p className="muted">{exercise.trainerComment}</p>}</article>)}
        </section>)}
        {replacementConfirmed && <p role="alert">В этой записи уже есть план. Заменить его упражнения выбранной тренировкой?</p>}
      </> : <>
        {history.isPending && <p role="status">Загружаем историю…</p>}
        {!history.isPending && !history.isError && !history.hasNextPage && items.length === 0 && <p>Завершённых тренировок пока нет.</p>}
        {items.map(item => <button type="button" key={item.id} className="booking-history-item" onClick={() => { setSource(item); setConfirmReplacement(null) }}><strong>{workoutDisplayTitle(item)}</strong><time dateTime={item.workoutDate}>{formatLocalDate(item.workoutDate)}</time><span>{workoutExerciseBrief(item.exercises)}</span></button>)}
        {history.hasNextPage && <button type="button" className="secondary wide" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>{history.isFetchingNextPage ? 'Загружаем…' : 'Показать ещё'}</button>}
        {history.isError && <p className="error" role="alert">Не удалось загрузить историю. <button type="button" onClick={() => void history.refetch()}>Повторить</button></p>}
      </>}
      {apply.error && <p className="error" role="alert">{apply.error.message}<button type="button" disabled={apply.isPending} onClick={() => void onReload()}>Обновить запись</button></p>}
    </div>
    {source && <footer>{replacementConfirmed && <button type="button" className="secondary" disabled={apply.isPending} onClick={() => setConfirmReplacement(null)}>Отмена</button>}<button type="button" className="primary" disabled={apply.isPending || target.status !== 'planned'} onClick={repeat}>{apply.isPending ? 'Сохраняем…' : replacementConfirmed ? 'Заменить план' : 'Повторить в этой записи'}</button></footer>}
  </dialog>
}
