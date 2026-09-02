import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState, type FormEvent, type MouseEvent } from 'react'
import { exercisesRepository, type CustomExercise } from '../../data/repositories/exercises.repository'
import { useAuth } from '../../app/auth-context'
import type { ExerciseSnapshot, InputKind, MuscleGroup } from '../../shared/domain'
import { ChevronRightIcon, CloseIcon, PlayIcon, SearchIcon } from '../../shared/icons'
import { MUSCLE_GROUP_LABELS } from '../../shared/system-exercises'
import { AsyncView, Field, Page } from '../../shared/ui'
import { ExerciseImage } from './ExerciseImage'
import { matchesExerciseSearch, rankExerciseSearch } from './exercise-search'

const INPUT_KIND_LABELS: Record<InputKind, string> = {
  strength: 'Вес + повторы',
  reps: 'Повторы',
  duration: 'Время',
  distance: 'Расстояние',
}

const LEVEL_LABELS: Record<string, string> = {
  beginner: 'Начальный',
  intermediate: 'Средний',
  expert: 'Продвинутый',
}

function useCustomExercises() {
  const { actor } = useAuth()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<CustomExercise | null>(null)
  const query = useQuery({ queryKey: ['exercises'], queryFn: () => exercisesRepository.list() })
  const save = useMutation({
    mutationFn: (value: { name: string; muscleGroup: MuscleGroup; inputKind: InputKind }) => editing
      ? exercisesRepository.update(editing, value)
      : exercisesRepository.create(actor!.userId, value),
    onSuccess: async () => {
      setEditing(null)
      await queryClient.invalidateQueries({ queryKey: ['exercises'] })
    },
  })
  const archive = useMutation({
    mutationFn: (exercise: CustomExercise) => exercisesRepository.setArchived(exercise, !exercise.archivedAt),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['exercises'] }),
  })
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    save.mutate({
      name: String(data.get('name')).trim(),
      muscleGroup: String(data.get('muscleGroup')) as MuscleGroup,
      inputKind: String(data.get('inputKind')) as InputKind,
    })
    event.currentTarget.reset()
  }
  return { archive, editing, query, save, setEditing, submit }
}

export function ExercisesPage() {
  const { archive, editing, query, save, setEditing, submit } = useCustomExercises()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ExerciseSnapshot | null>(null)
  const [visibleCount, setVisibleCount] = useState(48)
  const systemMatches = useMemo(() => {
    if (!search.trim()) return [...exercisesRepository.system].sort((left, right) => left.name.localeCompare(right.name, 'ru'))
    return rankExerciseSearch(exercisesRepository.system, search)
      .filter(({ exercise }) => matchesExerciseSearch(exercise, search))
      .map(({ exercise }) => exercise)
  }, [search])
  const visibleExercises = systemMatches.slice(0, visibleCount)
  const activeCustomCount = query.data?.filter((exercise) => !exercise.archivedAt).length ?? 0
  function updateSearch(value: string) {
    setSearch(value)
    setVisibleCount(48)
  }
  function stopPropagation(event: MouseEvent) {
    event.stopPropagation()
  }

  return <Page className="exercise-catalog-page exercise-catalog-preview" title="Упражнения" subtitle="Библиотека движений и ваш каталог" back="/profile">
    <section className="catalog-library" aria-labelledby="catalog-library-title">
      <div className="catalog-library-head">
        <div><p className="eyebrow">БИБЛИОТЕКА</p><h2 id="catalog-library-title">Системные упражнения</h2></div>
        <span>{exercisesRepository.system.length}</span>
      </div>
      <label className="catalog-search">
        <span className="sr-only">Поиск упражнения</span>
        <SearchIcon />
        <input type="search" value={search} placeholder="Название, мышца или оборудование" onChange={(event) => updateSearch(event.target.value)} />
        {search && <button type="button" aria-label="Очистить поиск" onClick={() => updateSearch('')}><CloseIcon /></button>}
      </label>
      <div className="catalog-results-meta" aria-live="polite">
        <span>{search.trim() ? `Найдено: ${systemMatches.length}` : 'Все упражнения'}</span>
        <span>Нажмите, чтобы открыть технику</span>
      </div>
      {systemMatches.length > 0 ? <>
        <div className="catalog-media-grid">
          {visibleExercises.map((exercise) => <button type="button" className="catalog-media-card" key={exercise.ref} onClick={() => setSelected(exercise)}>
            <span className="catalog-media-card-visual"><ExerciseImage src={exercise.imageUrl} motionSrc={exercise.motionImageUrl} alt="" variant="preview" />{exercise.techniqueVideoUrl && <span className="catalog-media-card-play" aria-hidden="true"><PlayIcon /></span>}</span>
            <span className="catalog-media-card-copy"><strong>{exercise.name}</strong><small>{[exercise.equipment, MUSCLE_GROUP_LABELS[exercise.muscleGroup]].filter(Boolean).join(' · ')}</small></span>
            <ChevronRightIcon />
          </button>)}
        </div>
        {visibleExercises.length < systemMatches.length && <button type="button" className="secondary compact catalog-load-more" onClick={() => setVisibleCount((count) => count + 48)}>Показать ещё</button>}
      </> : <div className="catalog-search-empty" role="status"><strong>Ничего не найдено</strong><p>Проверьте запрос или попробуйте название мышцы.</p><button type="button" className="ghost compact" onClick={() => updateSearch('')}>Сбросить поиск</button></div>}
    </section>

    <section className="catalog-custom-section catalog-custom-preview" aria-labelledby="catalog-custom-title">
      <div className="catalog-section-head"><div><p className="eyebrow">СВОЙ КАТАЛОГ</p><h2 id="catalog-custom-title">{editing ? 'Изменить упражнение' : 'Мои упражнения'}</h2></div><span>{activeCustomCount}</span></div>
      <p className="catalog-section-description">Добавляйте движения, которых нет в системной библиотеке.</p>
      <form className="stack compact catalog-custom-form" key={editing?.id ?? 'new'} onSubmit={(event) => void submit(event)}>
        <Field label="Название"><input name="name" defaultValue={editing?.name} placeholder="Например, Болгарский присед" required /></Field>
        <div className="split"><Field label="Группа"><select name="muscleGroup" defaultValue={editing?.muscleGroup ?? 'other'}><option value="legs">Ноги</option><option value="glutes">Ягодицы</option><option value="chest">Грудь</option><option value="back">Спина</option><option value="shoulders">Плечи</option><option value="arms">Руки</option><option value="core">Кор</option><option value="cardio">Кардио</option><option value="other">Другое</option></select></Field><Field label="Тип ввода"><select name="inputKind" defaultValue={editing?.inputKind ?? 'strength'}><option value="strength">Вес + повторы</option><option value="reps">Повторы</option><option value="duration">Время</option><option value="distance">Расстояние</option></select></Field></div>
        {save.error && <p className="error" role="alert">{save.error.message}</p>}
        <div className="actions">{editing && <button type="button" className="secondary" onClick={() => setEditing(null)}>Отмена</button>}<button className="primary" disabled={save.isPending}>{save.isPending ? 'Сохранение…' : editing ? 'Сохранить' : 'Добавить'}</button></div>
      </form>
      <div className="catalog-custom-results">
        <AsyncView loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()} empty={!query.data?.length} emptyTitle="Собственных упражнений пока нет" emptyDescription="Создайте первое упражнение с помощью формы выше.">
          <div className="catalog-custom-list">{query.data?.map((exercise) => <article className={`catalog-custom-item${exercise.archivedAt ? ' archived' : ''}`} key={exercise.id}><div><strong>{exercise.name}</strong><p>{MUSCLE_GROUP_LABELS[exercise.muscleGroup]} · {INPUT_KIND_LABELS[exercise.inputKind]}{exercise.archivedAt ? ' · В архиве' : ''}</p></div><div className="row-actions"><button className="link" onClick={() => setEditing(exercise)}>Изменить</button><button className="link danger" disabled={archive.isPending} onClick={() => archive.mutate(exercise)}>{exercise.archivedAt ? 'Вернуть' : 'В архив'}</button></div></article>)}</div>
        </AsyncView>
      </div>
    </section>

    {selected && <div className="catalog-detail-overlay" onClick={() => setSelected(null)}>
      <section className="catalog-detail" role="dialog" aria-modal="true" aria-labelledby="catalog-detail-title" onClick={stopPropagation}>
        <header><div><p className="eyebrow">ТЕХНИКА</p><h2 id="catalog-detail-title">{selected.name}</h2></div><button type="button" className="catalog-detail-close" aria-label="Закрыть" onClick={() => setSelected(null)}><CloseIcon /></button></header>
        <ExerciseImage src={selected.imageUrl} motionSrc={selected.motionImageUrl} videoSrc={selected.techniqueVideoUrl} alt={selected.name} variant="technique" />
        <div className="catalog-detail-facts"><span><small>Группа</small><strong>{MUSCLE_GROUP_LABELS[selected.muscleGroup]}</strong></span><span><small>Оборудование</small><strong>{selected.equipment ?? 'Без оборудования'}</strong></span><span><small>Тип ввода</small><strong>{INPUT_KIND_LABELS[selected.inputKind]}</strong></span><span><small>Уровень</small><strong>{selected.level ? LEVEL_LABELS[selected.level.toLocaleLowerCase()] ?? selected.level : 'Не указан'}</strong></span></div>
        {selected.instructions?.length ? <div className="catalog-detail-instructions"><h3>Как выполнять</h3><ol>{selected.instructions.map((instruction, index) => <li key={`${selected.ref}-${index}`}>{instruction}</li>)}</ol></div> : <p className="catalog-detail-note">Для этого упражнения пока нет пошагового описания.</p>}
        <button type="button" className="secondary" onClick={() => setSelected(null)}>Закрыть</button>
      </section>
    </div>}
  </Page>
}
