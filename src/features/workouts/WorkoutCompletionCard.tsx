import { Link } from 'react-router-dom'
import type { WorkoutPersonalRecord } from '../../shared/domain'
import { CheckIcon, ChevronRightIcon, RecordIcon } from '../../shared/icons'
import { exerciseProgressValueLabel } from './ExerciseProgressSummary'

function confirmedSetsLabel(count: number): string {
  const mod100 = count % 100
  const mod10 = count % 10
  if (mod100 >= 11 && mod100 <= 14) return 'подходов'
  if (mod10 === 1) return 'подход'
  if (mod10 >= 2 && mod10 <= 4) return 'подхода'
  return 'подходов'
}

export function completionResultLabel(completedSets: number, totalSets: number): string {
  if (totalSets === 0) return 'Результаты тренировки сохранены'
  if (completedSets === totalSets) return `Подтверждено ${completedSets} ${confirmedSetsLabel(completedSets)}`
  return `Подтверждено ${completedSets} из ${totalSets} подходов`
}

export function completionRecordLabel(record: WorkoutPersonalRecord): string {
  if (record.inputKind === 'strength' && record.weightKg !== null) {
    return `${exerciseProgressValueLabel(record.weightKg, 'strength')}${record.reps === null ? '' : ` × ${record.reps} повт.`}`
  }
  return exerciseProgressValueLabel(record.primaryValue, record.inputKind)
}

export function WorkoutCompletionCard({
  completedSets,
  totalSets,
  record,
  clientMode,
  clientId,
}: {
  completedSets: number
  totalSets: number
  record?: WorkoutPersonalRecord
  clientMode: boolean
  clientId: string
}) {
  return <section className={`workout-completion${record ? ' has-record' : ''}`} aria-labelledby="workout-completion-title">
    <span className="workout-completion-mark" aria-hidden="true">{record ? <RecordIcon /> : <CheckIcon />}</span>
    <div className="workout-completion-body">
      <span className="workout-completion-kicker">Результат сохранён</span>
      <h2 id="workout-completion-title">Тренировка завершена</h2>
      <p>{completionResultLabel(completedSets, totalSets)}</p>
      {record && <div className="workout-completion-record">
            <strong>Личный рекорд · {record.exerciseName}</strong>
            <span>{completionRecordLabel(record)}</span>
          </div>}
      <Link className="workout-completion-next" to={clientMode ? '/me/progress' : `/clients/${clientId}`}>
        {clientMode ? 'Посмотреть прогресс' : 'Вернуться к клиенту'} <ChevronRightIcon />
      </Link>
    </div>
  </section>
}
