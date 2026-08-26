import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { exercisesRepository, type CustomExercise } from '../../data/repositories/exercises.repository'
import { useAuth } from '../../app/auth-context'
import type { InputKind, MuscleGroup } from '../../shared/domain'
import { AsyncView, Field, Page } from '../../shared/ui'

export function ExercisesPage() {
  const { actor } = useAuth(); const queryClient = useQueryClient(); const [editing, setEditing] = useState<CustomExercise | null>(null)
  const query = useQuery({ queryKey: ['exercises'], queryFn: () => exercisesRepository.list() })
  const save = useMutation({ mutationFn: (value: { name: string; muscleGroup: MuscleGroup; inputKind: InputKind }) => editing ? exercisesRepository.update(editing, value) : exercisesRepository.create(actor!.userId, value), onSuccess: async () => { setEditing(null); await queryClient.invalidateQueries({ queryKey: ['exercises'] }) } })
  const archive = useMutation({ mutationFn: (exercise: CustomExercise) => exercisesRepository.setArchived(exercise, !exercise.archivedAt), onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['exercises'] }) })
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); save.mutate({ name: String(data.get('name')).trim(), muscleGroup: String(data.get('muscleGroup')) as MuscleGroup, inputKind: String(data.get('inputKind')) as InputKind }); event.currentTarget.reset() }
  return <Page className="exercise-catalog-page" title="Упражнения" back="/profile">
    <section className="catalog-custom-section">
      <div className="catalog-section-head"><div><p className="eyebrow">СВОЙ КАТАЛОГ</p><h2>{editing ? 'Изменить упражнение' : 'Мои упражнения'}</h2></div><span>{query.data?.filter((exercise) => !exercise.archivedAt).length ?? 0}</span></div>
      <form className="stack compact catalog-custom-form" key={editing?.id ?? 'new'} onSubmit={(event) => void submit(event)}><Field label="Название"><input name="name" defaultValue={editing?.name} required /></Field><div className="split"><Field label="Группа"><select name="muscleGroup" defaultValue={editing?.muscleGroup ?? 'other'}><option value="legs">Ноги</option><option value="glutes">Ягодицы</option><option value="chest">Грудь</option><option value="back">Спина</option><option value="shoulders">Плечи</option><option value="arms">Руки</option><option value="core">Кор</option><option value="cardio">Кардио</option><option value="other">Другое</option></select></Field><Field label="Тип ввода"><select name="inputKind" defaultValue={editing?.inputKind ?? 'strength'}><option value="strength">Вес + повторы</option><option value="reps">Повторы</option><option value="duration">Время</option><option value="distance">Расстояние</option></select></Field></div>{save.error && <p className="error">{save.error.message}</p>}<div className="actions">{editing && <button type="button" className="secondary" onClick={() => setEditing(null)}>Отмена</button>}<button className="primary">{editing ? 'Сохранить' : 'Добавить'}</button></div></form>
      <AsyncView loading={query.isLoading} error={query.error} empty={!query.data?.length}><div className="catalog-custom-list">{query.data?.map((exercise) => <article className="catalog-custom-item" key={exercise.id}><div><strong>{exercise.name}</strong><p>{exercise.muscleGroup} · {exercise.inputKind}</p></div><div className="row-actions"><button className="link" onClick={() => setEditing(exercise)}>Изменить</button><button className="link danger" onClick={() => archive.mutate(exercise)}>{exercise.archivedAt ? 'Вернуть' : 'В архив'}</button></div></article>)}</div></AsyncView>
    </section>
    <details className="catalog-system-section"><summary><span><strong>Системный каталог</strong><small>{exercisesRepository.system.length} упражнений уже доступны при выборе</small></span><b>⌄</b></summary><div className="chips">{exercisesRepository.system.map((exercise) => <span className="chip" key={exercise.ref}>{exercise.name}</span>)}</div></details>
  </Page>
}
