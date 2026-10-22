import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useBeforeUnload, useBlocker, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { isClientLimeEnabled } from '../../app/client-lime'
import { useDataBackend } from '../../app/data-backend-context'
import { replaceExercise } from '../../data/repositories/workout-rules'
import type { ExerciseSnapshot, FavoriteWorkoutTemplate, WorkoutExerciseDraft } from '../../shared/domain'
import { AsyncView, Field, InlineRequestError, Page, StatePanel, useConfirm } from '../../shared/ui'
import { ExercisePicker, useExerciseCatalog } from '../exercises'
import { WorkoutCta, WorkoutExerciseEditor, WorkoutHeader } from '../workouts'
import { AddActionLabel } from '../../shared/AddActionLabel'
import { getRequestDiagnostics } from '../../shared/request-diagnostics'
import { readWorkoutTemplateDraft, removeWorkoutTemplateDraft, writeWorkoutTemplateDraft } from './workout-template-draft'

const returnTo = '/me/workouts?tab=presets'

export function FavoriteWorkoutEditorPage() {
  const { favoriteId = '' } = useParams()
  const { actor } = useAuth()
  const lime = isClientLimeEnabled(actor)
  const { favoriteWorkouts } = useDataBackend()
  const query = useQuery({ queryKey: ['favorite-workouts'], queryFn: () => favoriteWorkouts.list() })
  const favorite = query.data?.find((item) => item.id === favoriteId)
  return <Page title="Редактировать тренировку" hideTitle back={returnTo} className={`workout-form-page workout-focused-page favorite-workout-editor-page${lime ? ' workout-editor-reference client-reference-form client-editor-refined client-editor-polish' : ''}`}>
    <AsyncView loading={query.isLoading} error={query.data ? null : query.error} onRetry={() => void query.refetch()}>
      {query.data && query.error && <InlineRequestError error={query.error} />}
      {favorite && actor ? <FavoriteWorkoutEditor key={`${actor.userId}:${favorite.id}`} lime={lime} favorite={favorite} userId={actor.userId} />
        : <StatePanel tone="info" title="Тренировка больше недоступна" description="Возможно, она была удалена из избранного." action={<Link className="button secondary" to={returnTo}>К готовым тренировкам</Link>} />}
    </AsyncView>
  </Page>
}

function FavoriteWorkoutEditor({ lime, favorite, userId }: { lime: boolean; favorite: FavoriteWorkoutTemplate; userId: string }) {
  const { favoriteWorkouts } = useDataBackend()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const catalog = useExerciseCatalog()
  const draftKey = `fit.favorite-workout-edit.${userId}.${favorite.id}`
  const [stored] = useState(() => readWorkoutTemplateDraft(draftKey))
  const [title, setTitle] = useState(stored?.name ?? favorite.title)
  const [exercises, setExercises] = useState(stored?.exercises ?? favorite.exercises)
  // Keep the version captured when editing began, even if a background read changes.
  const [version] = useState(stored?.version ?? favorite.version)
  const [dirty, setDirty] = useState(Boolean(stored))
  const [storageError, setStorageError] = useState(false)
  const [picker, setPicker] = useState<number | 'add' | null>(null)
  const finished = useRef(false)
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  useEffect(() => {
    if (!dirty || finished.current) return
    setStorageError(!writeWorkoutTemplateDraft(draftKey, { id: favorite.id, name: title, notes: '', version, exercises }))
  }, [dirty, draftKey, favorite.id, title, version, exercises])
  const save = useMutation({
    mutationFn: () => favoriteWorkouts.update(favorite.id, version, title.trim(), exercises),
    onSuccess: async () => {
      finished.current = true
      removeWorkoutTemplateDraft(draftKey)
      setDirty(false)
      await queryClient.invalidateQueries({ queryKey: ['favorite-workouts'] })
      if (active.current) navigate(returnTo, { replace: true })
    },
  })
  const [confirm, confirmDialog] = useConfirm()
  const blocker = useBlocker(() => !finished.current && (dirty || save.isPending))
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    if (save.isPending) { blocker.reset(); return }
    let current = true
    void confirm({ message: 'Выйти без сохранения изменений?', confirmLabel: 'Выйти', danger: true }).then((leave) => {
      if (!current) return
      if (leave) { finished.current = true; removeWorkoutTemplateDraft(draftKey); blocker.proceed() }
      else blocker.reset()
    })
    return () => { current = false }
  }, [blocker, confirm, draftKey, save.isPending])
  useBeforeUnload((event) => {
    if (!finished.current && (dirty || save.isPending)) { event.preventDefault(); event.returnValue = '' }
  })
  function update(next: WorkoutExerciseDraft[]) { setExercises(next); setDirty(true) }
  function add(selected: ExerciseSnapshot[]) {
    update([...exercises, ...selected.map((exercise, index) => ({
      ...exercise, position: exercises.length + index, blockId: crypto.randomUUID(), blockType: 'single' as const,
      blockRounds: 1, sets: [{ position: 0 }],
    }))])
    setPicker(null)
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!save.isPending && title.trim() && exercises.length && exercises.length <= 60) save.mutate()
  }
  return <>
    <WorkoutHeader eyebrow="ИЗБРАННОЕ" title="Редактировать тренировку" state="planned" showStatus={false} />
    <form className="stack workout-form workout-template-form" onSubmit={submit}>
      <section className="workout-form-section template-basics"><Field label="Название"><input value={title} maxLength={120} required disabled={save.isPending} onChange={(event) => { setTitle(event.target.value); setDirty(true) }} /></Field></section>
      <section className="workout-form-section workout-form-exercises">
        <div className="workout-form-section-head"><h2>Упражнения</h2></div>
        <WorkoutExerciseEditor exercises={exercises} onChange={update} onOpenPicker={() => setPicker('add')} onReplaceExercise={setPicker}
          exerciseCatalog={catalog.exercises} collapseInitialExercises reference={lime} safePlanInput={lime} commentLabel="Заметка" disabled={save.isPending} />
        {lime && <WorkoutCta type="button" variant="secondary" disabled={save.isPending || exercises.length >= 60} onClick={() => setPicker('add')}><AddActionLabel>Упражнение</AddActionLabel></WorkoutCta>}
      </section>
      {exercises.length > 60 && <p className="error" role="alert">В избранном можно сохранить до 60 упражнений.</p>}
      {save.error && <InlineRequestError error={save.error} />}
      {getRequestDiagnostics(save.error)?.status === 409 && <button type="button" className="secondary" onClick={() => {
        void confirm({ message: 'Загрузить текущую версию? Несохранённые изменения на этом устройстве будут удалены.', confirmLabel: 'Загрузить' }).then((accepted) => {
          if (!accepted) return
          finished.current = true
          removeWorkoutTemplateDraft(draftKey)
          window.location.reload()
        })
      }}>Загрузить текущую версию</button>}
      {storageError && <p className="error" role="alert">Не удалось сохранить черновик на устройстве. Не закрывайте экран до сохранения изменений.</p>}
      <div className="actions workout-action-row"><WorkoutCta type="submit" pending={save.isPending} pendingLabel="Сохраняем…" disabled={!dirty || !title.trim() || !exercises.length || exercises.length > 60}>Сохранить изменения</WorkoutCta></div>
    </form>
    {picker !== null && <ExercisePicker clientLime={lime} referenceAppearance={lime} catalog={catalog} multiple={picker === 'add'} onPick={(selected) => {
      if (picker === 'add') add([selected])
      else { update(replaceExercise(exercises, picker, selected)); setPicker(null) }
    }} onPickMany={add} onClose={() => setPicker(null)} techniqueActionLabel={picker === 'add' ? 'Добавить упражнение' : 'Заменить упражнение'} />}
    {confirmDialog}
  </>
}
