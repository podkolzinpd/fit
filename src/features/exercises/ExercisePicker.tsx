import { useMemo, useState, type MouseEvent } from 'react'
import type { ExerciseSnapshot, InputKind, MuscleGroup } from '../../shared/domain'
import { CloseIcon } from '../../shared/icons'
import { MUSCLE_GROUP_LABELS, MUSCLE_GROUPS } from '../../shared/system-exercises'
import type { ExerciseCatalogState } from './exercise-catalog'
import { readRecentKeys, recordRecent, resolveRecent } from './recent-exercises'

export function filterExercises(
  exercises: readonly ExerciseSnapshot[],
  category: 'all' | MuscleGroup,
  search: string,
  muscle: string | null = null,
  equipment: string | null = null,
): readonly ExerciseSnapshot[] {
  const query = search.trim().toLocaleLowerCase('ru')
  return exercises
    .filter((exercise) =>
      (category === 'all' || exercise.muscleGroup === category)
      && (!muscle || exercise.primaryMuscleDetail === muscle)
      && (!equipment || exercise.equipment === equipment)
      && (!query || exercise.name.toLocaleLowerCase('ru').includes(query)),
    )
    .sort((left, right) => left.name.localeCompare(right.name, 'ru'))
}

// Детальные мышцы выбранной группы (2-й уровень иерархии), по частоте.
export function musclesForGroup(
  exercises: readonly ExerciseSnapshot[],
  group: MuscleGroup,
): string[] {
  const counts = new Map<string, number>()
  for (const exercise of exercises) {
    if (exercise.muscleGroup !== group || !exercise.primaryMuscleDetail) continue
    counts.set(exercise.primaryMuscleDetail, (counts.get(exercise.primaryMuscleDetail) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru')).map(([name]) => name)
}

// Оборудование для выбранной группы/мышцы (3-й уровень иерархии), по частоте.
export function equipmentForSelection(
  exercises: readonly ExerciseSnapshot[],
  group: MuscleGroup,
  muscle: string | null,
): string[] {
  const counts = new Map<string, number>()
  for (const exercise of exercises) {
    if (exercise.muscleGroup !== group || (muscle && exercise.primaryMuscleDetail !== muscle) || !exercise.equipment) continue
    counts.set(exercise.equipment, (counts.get(exercise.equipment) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru')).map(([name]) => name)
}

interface ExercisePickerProps {
  catalog: ExerciseCatalogState
  onPick: (exercise: ExerciseSnapshot) => void
  onClose: () => void
}

export function ExercisePicker({ catalog, onPick, onClose }: ExercisePickerProps) {
  const [category, setCategory] = useState<'all' | MuscleGroup>('all')
  const [muscle, setMuscle] = useState<string | null>(null)
  const [equipment, setEquipment] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [group, setGroup] = useState<MuscleGroup | null>(null)
  const [inputKind, setInputKind] = useState<InputKind>('distance')
  const filtered = useMemo(
    () => filterExercises(catalog.exercises, category, search, muscle, equipment),
    [catalog.exercises, category, search, muscle, equipment],
  )
  // Детальные мышцы выбранной группы (2-й уровень). Показываем, если их >1.
  const muscles = useMemo(
    () => (category === 'all' ? [] : musclesForGroup(catalog.exercises, category)),
    [catalog.exercises, category],
  )
  const equipmentOptions = useMemo(
    () => (category === 'all' ? [] : equipmentForSelection(catalog.exercises, category, muscle)),
    [catalog.exercises, category, muscle],
  )
  // Недавние показываем только в исходном виде списка (без поиска/фильтра),
  // чтобы не мешать целенаправленному выбору по группе/мышце/названию.
  const recent = useMemo(
    () => (category === 'all' && !search.trim() ? resolveRecent(readRecentKeys(), catalog.exercises) : []),
    [category, search, catalog.exercises],
  )
  // Запоминаем выбор как недавний и передаём наверх.
  function pick(exercise: ExerciseSnapshot) { recordRecent(exercise); onPick(exercise) }
  // Одна строка списка (используется и для недавних, и для основного списка).
  function item(exercise: ExerciseSnapshot, keyPrefix: string) {
    return <button type="button" className="picker-item" key={`${keyPrefix}-${exercise.source}-${exercise.ref}`} onClick={() => pick(exercise)}>{exercise.imageUrl ? <img className="picker-thumb" src={exercise.imageUrl} alt="" loading="lazy" /> : <span className="picker-thumb picker-thumb-empty" aria-hidden="true" />}<span className="picker-item-name">{exercise.name}</span><small>{MUSCLE_GROUP_LABELS[exercise.muscleGroup]}</small></button>
  }
  // Выбор группы сбрасывает выбранную мышцу (иначе останется от прошлой группы).
  function selectGroup(next: 'all' | MuscleGroup) { setCategory(next); setMuscle(null); setEquipment(null) }
  function selectMuscle(next: string | null) { setMuscle(next); setEquipment(null) }
  function stopPropagation(event: MouseEvent) { event.stopPropagation() }
  async function createExercise() {
    if (!name.trim() || !group) return
    try {
      const exercise = await catalog.create({
        name: name.trim(), muscleGroup: group, inputKind: group === 'cardio' ? inputKind : 'strength',
      })
      pick(exercise)
    } catch {
      // Mutation state exposes the normalized repository error in the picker.
    }
  }

  return <div className="sheet-overlay" onClick={onClose}>
    <section className="exercise-picker" role="dialog" aria-modal="true" aria-label="Добавить упражнение" onClick={stopPropagation}>
      <header className="picker-header"><h1>{creating ? 'Своё упражнение' : 'Добавить упражнение'}</h1><button type="button" className="picker-close" aria-label="Закрыть" onClick={creating ? () => setCreating(false) : onClose}><CloseIcon /></button></header>
      {creating ? <div className="stack">
        <label className="field">Название<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Например: Болгарский присед" /></label>
        <div className="picker-categories" aria-label="Группа мышц">{MUSCLE_GROUPS.map((item) => <button type="button" key={item} className={group === item ? 'picker-category active' : 'picker-category'} onClick={() => setGroup(item)}>{MUSCLE_GROUP_LABELS[item]}</button>)}</div>
        {group === 'cardio' && <div className="picker-categories"><button type="button" className={inputKind === 'distance' ? 'picker-category active' : 'picker-category'} onClick={() => setInputKind('distance')}>Время + дистанция</button><button type="button" className={inputKind === 'reps' ? 'picker-category active' : 'picker-category'} onClick={() => setInputKind('reps')}>Время + повторы</button></div>}
        {catalog.error && <p className="error">{catalog.error.message}</p>}
        <button type="button" disabled={catalog.saving || !name.trim() || !group} onClick={() => void createExercise()}>{catalog.saving ? 'Сохранение…' : 'Сохранить упражнение'}</button>
      </div> : <>
        <input className="picker-search" aria-label="Поиск упражнения" placeholder="Найти упражнение..." value={search} onChange={(event) => setSearch(event.target.value)} />
        <div className="picker-categories" aria-label="Группа мышц"><button type="button" className={category === 'all' ? 'picker-category active' : 'picker-category'} onClick={() => selectGroup('all')}>Все</button>{MUSCLE_GROUPS.map((item) => <button type="button" key={item} className={category === item ? 'picker-category active' : 'picker-category'} onClick={() => selectGroup(item)}>{MUSCLE_GROUP_LABELS[item]}</button>)}</div>
        {muscles.length > 1 && <div className="picker-muscles" aria-label="Мышца"><button type="button" className={muscle === null ? 'picker-muscle active' : 'picker-muscle'} onClick={() => selectMuscle(null)}>Все мышцы</button>{muscles.map((item) => <button type="button" key={item} className={muscle === item ? 'picker-muscle active' : 'picker-muscle'} onClick={() => selectMuscle(item)}>{item}</button>)}</div>}
        {equipmentOptions.length > 1 && <div className="picker-equipment" aria-label="Оборудование"><button type="button" className={equipment === null ? 'picker-equipment-option active' : 'picker-equipment-option'} onClick={() => setEquipment(null)}>Всё оборудование</button>{equipmentOptions.map((item) => <button type="button" key={item} className={equipment === item ? 'picker-equipment-option active' : 'picker-equipment-option'} onClick={() => setEquipment(item)}>{item}</button>)}</div>}
        <button type="button" className="picker-create" onClick={() => setCreating(true)}>＋ Создать своё упражнение</button>
        {catalog.loading && <p className="state">Загрузка…</p>}
        {catalog.error && <div className="state"><p className="error">{catalog.error.message}</p><button type="button" className="secondary" onClick={catalog.retry}>Повторить</button></div>}
        {!catalog.loading && <div className="picker-list">
          {recent.length > 0 && <><p className="picker-section-label">Недавние</p>{recent.map((exercise) => item(exercise, 'recent'))}<p className="picker-section-label">Все упражнения</p></>}
          {filtered.length ? filtered.map((exercise) => item(exercise, 'all')) : <p className="state">Ничего не найдено</p>}
        </div>}
      </>}
    </section>
  </div>
}
