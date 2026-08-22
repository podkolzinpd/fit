import type { YandexPilotTrainingData as PilotTrainingData } from '../../data/repositories/yandex-pilot.repository'
import { formatLocalDate, localDate } from '../../shared/local-date'
import { AsyncView } from '../../shared/ui'

interface YandexPilotTrainingDataProps {
  data: PilotTrainingData | null
  error: Error | null
  loading: boolean
  onRetry: () => void
}

const statusLabels = {
  planned: 'Запланирована',
  in_progress: 'Идёт сейчас',
  done: 'Завершена',
  cancelled: 'Отменена',
} as const

export function YandexPilotTrainingData({
  data,
  error,
  loading,
  onRetry,
}: YandexPilotTrainingDataProps) {
  const empty = data !== null
    && data.customExercises.length === 0
    && data.workouts.length === 0

  return <section className="yandex-pilot-training" aria-labelledby="yandex-pilot-training-title">
    <div className="yandex-pilot-section-head">
      <div>
        <h2 id="yandex-pilot-training-title">Тренировки в stage</h2>
        <p className="muted">Проверяем перенесённые упражнения, планы и фактические подходы.</p>
      </div>
    </div>
    <AsyncView
      loading={loading}
      error={error}
      empty={empty}
      onRetry={onRetry}
      emptyTitle="В stage пока нет тренировок"
      emptyDescription="Данные появятся после тестового переноса этого пространства."
    >
      {data && <div className="stack yandex-pilot-training-content">
        {data.customExercises.length > 0 && <div className="card yandex-pilot-custom-exercises">
          <strong>Собственные упражнения</strong>
          <p>{data.customExercises
            .map((exercise) => exercise.archivedAt === null ? exercise.name : `${exercise.name} · архив`)
            .join(', ')}</p>
        </div>}
        <div className="cards yandex-pilot-workouts">
          {data.workouts.map((workout) => <article className="card yandex-pilot-workout" key={workout.id}>
            <div className="yandex-pilot-workout-head">
              <div>
                <strong>{workout.clientName}</strong>
                <p>{formatLocalDate(localDate(workout.workoutDate))} · {statusLabels[workout.status]}</p>
              </div>
              {workout.startTime && <span>{workout.startTime.slice(0, 5)}</span>}
            </div>
            {workout.exercises.length === 0
              ? <p className="muted">Упражнения не добавлены</p>
              : <ul className="yandex-pilot-workout-exercises">
                  {workout.exercises.map((exercise) => <li key={exercise.id}>
                    <strong>{exercise.name}</strong>
                    <span>{exercise.sets.length === 0
                      ? 'Без подходов'
                      : exercise.sets.map((set) => setSummary(set)).join('; ')}</span>
                  </li>)}
                </ul>}
          </article>)}
        </div>
        {data.hasMoreWorkouts && <p className="muted">Показаны последние 100 тренировок.</p>}
      </div>}
    </AsyncView>
  </section>
}

function setSummary(set: PilotTrainingData['workouts'][number]['exercises'][number]['sets'][number]): string {
  const values = set.confirmedAt === null ? set.plan : set.fact
  const parts = [
    values.weightKg === null ? null : `${values.weightKg} кг`,
    values.reps === null ? null : `${values.reps} повт.`,
    values.durationSec === null ? null : `${values.durationSec} сек.`,
    values.durationMin === null ? null : `${values.durationMin} мин.`,
    values.distanceKm === null ? null : `${values.distanceKm} км`,
    values.rpe === null ? null : `RPE ${values.rpe}`,
  ].filter((value): value is string => value !== null)
  return parts.length > 0 ? parts.join(' · ') : 'Подход без значений'
}
