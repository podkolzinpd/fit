import { Link } from 'react-router-dom'
import type { WorkoutPersonalRecord } from '../../shared/domain'
import { CheckIcon, ChevronRightIcon, RecordIcon } from '../../shared/icons'
import { completionRecordLabel } from './WorkoutCompletionCard'

function russianCountLabel(count: number, one: string, few: string, many: string): string {
  const mod100 = count % 100
  const mod10 = count % 10
  if (mod100 >= 11 && mod100 <= 14) return many
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}

export function workoutCompletionPercent(completedSets: number, totalSets: number): number | null {
  if (totalSets <= 0) return null
  return Math.round((Math.min(Math.max(completedSets, 0), totalSets) / totalSets) * 100)
}

export function workoutCompletionTitle(completedSets: number, totalSets: number): string {
  return totalSets > 0 && completedSets < totalSets
    ? 'Тренировка сохранена частично'
    : 'Тренировка завершена'
}

export function WorkoutCompletionReport({
  completedSets,
  totalSets,
  completedExercises,
  totalExercises,
  incompleteExercises,
  duration,
  tonnage,
  muscleGroups,
  record,
  recordLoading = false,
  hasTrainer,
}: {
  completedSets: number
  totalSets: number
  completedExercises: number
  totalExercises: number
  incompleteExercises: string[]
  duration: string | null
  tonnage: string | null
  muscleGroups: string[]
  record?: WorkoutPersonalRecord
  recordLoading?: boolean
  hasTrainer: boolean
}) {
  const percent = workoutCompletionPercent(completedSets, totalSets)
  const partial = percent !== null && percent < 100
  const title = workoutCompletionTitle(completedSets, totalSets)
  const exerciseLabel = russianCountLabel(totalExercises, 'упражнение', 'упражнения', 'упражнений')
  const setLabel = russianCountLabel(totalSets, 'подход', 'подхода', 'подходов')
  const setGenitiveLabel = totalSets === 1 ? 'подхода' : 'подходов'
  const exerciseGenitiveLabel = totalExercises === 1 ? 'упражнения' : 'упражнений'

  return <section className={`workout-completion-report${partial ? ' is-partial' : ''}`} aria-labelledby="workout-completion-title">
    <header className="workout-completion-report-hero">
      <span className="workout-completion-report-mark" aria-hidden="true">{record ? <RecordIcon /> : <CheckIcon />}</span>
      <div>
        <p className="workout-completion-report-kicker">Результат сохранён</p>
        <h1 id="workout-completion-title">{title}</h1>
      </div>
    </header>

    <dl className="workout-completion-report-facts" aria-label="Краткий итог тренировки">
      {duration && <div><dt>Время</dt><dd>{duration}</dd></div>}
      <div><dt>{exerciseLabel}</dt><dd>{totalExercises}</dd></div>
      {totalSets > 0 && <div><dt>{setLabel}</dt><dd>{completedSets === totalSets ? completedSets : `${completedSets}/${totalSets}`}</dd></div>}
      {tonnage && <div><dt>Тоннаж</dt><dd>{tonnage}</dd></div>}
    </dl>

    {percent !== null && <section className="workout-completion-plan" aria-labelledby="workout-completion-plan-title">
      <div className="workout-completion-plan-head">
        <div><p className="eyebrow">ПЛАН И ФАКТ</p><h2 id="workout-completion-plan-title">Выполнение плана</h2></div>
        <strong>{percent}%</strong>
      </div>
      <div className="workout-completion-progress" role="progressbar" aria-label="Выполнение плана" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <p>Подтверждено {completedSets} из {totalSets} {setGenitiveLabel}</p>
      <p>Полностью выполнено {completedExercises} из {totalExercises} {exerciseGenitiveLabel}</p>
      {partial && incompleteExercises.length > 0 && <div className="workout-completion-missing">
        <strong>Осталось выполнить</strong>
        <ul>{incompleteExercises.map((name) => <li key={name}>{name}</li>)}</ul>
      </div>}
    </section>}

    <section className="workout-completion-highlight" aria-labelledby="workout-completion-highlight-title" aria-busy={recordLoading}>
      <p className="eyebrow">ГЛАВНЫЙ РЕЗУЛЬТАТ</p>
      {recordLoading ? <p className="workout-completion-highlight-loading" role="status">Проверяем достижения…</p> : record ? <div className="workout-completion-highlight-record">
        <RecordIcon />
        <div><h2 id="workout-completion-highlight-title">Личный рекорд</h2><strong>{record.exerciseName}</strong><span>{completionRecordLabel(record)}</span></div>
      </div> : <div>
        <h2 id="workout-completion-highlight-title">{partial ? `${percent}% плана подтверждено` : 'План выполнен полностью'}</h2>
        <p>{partial ? 'В прогресс попадут только выполненные подходы.' : 'Все запланированные подходы сохранены в прогрессе.'}</p>
      </div>}
    </section>

    {muscleGroups.length > 0 && <section className="workout-completion-muscles" aria-labelledby="workout-completion-muscles-title">
      <div><p className="eyebrow">НАГРУЗКА</p><h2 id="workout-completion-muscles-title">Основные группы мышц</h2></div>
      <p>{muscleGroups.join(' · ')}</p>
      <Link to="/me/progress">Подробнее в прогрессе <ChevronRightIcon /></Link>
    </section>}

    {hasTrainer && <p className="workout-completion-trainer-status"><CheckIcon /> Результат доступен тренеру</p>}
  </section>
}
