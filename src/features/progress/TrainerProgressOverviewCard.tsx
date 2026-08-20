import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../app/auth-context'
import { progressRepository } from '../../data/repositories/progress.repository'
import type { WorkoutRegularity } from '../../shared/domain'
import { AsyncView, Coachmark } from '../../shared/ui'

function workoutCountLabel(count: number): string {
  const mod100 = count % 100
  const mod10 = count % 10
  if (mod100 >= 11 && mod100 <= 14) return 'тренировок'
  if (mod10 === 1) return 'тренировка'
  if (mod10 >= 2 && mod10 <= 4) return 'тренировки'
  return 'тренировок'
}

function plannedBreakdown(week: WorkoutRegularity): string {
  if (week.plannedCount === 0) {
    return week.completedCount > 0 ? 'Без назначенного плана' : 'План тренера на неделю не назначен'
  }
  const completedFully = Math.max(0, week.completedPlannedCount - week.partialCount)
  const independent = Math.max(0, week.completedCount - week.completedPlannedCount)
  const parts = [
    completedFully > 0 ? `${completedFully} полностью` : null,
    week.partialCount > 0 ? `${week.partialCount} частично` : null,
    week.skippedCount > 0 ? `${week.skippedCount} пропущено` : null,
    independent > 0 ? `${independent} самостоятельно` : null,
  ].filter((part): part is string => part !== null)
  return `Из ${week.plannedCount} по плану${parts.length > 0 ? `: ${parts.join(' · ')}` : ''}`
}

export function TrainerProgressOverviewContent({ week }: { week?: WorkoutRegularity }) {
  const hasWorkouts = Boolean(week && week.completedCount > 0)
  return <article className={`trainer-progress-week${hasWorkouts ? ' is-positive' : ''}`}>
    <div>
      <span>Эта неделя</span>
      <strong>{week
        ? week.completedCount > 0
          ? `${week.completedCount} ${workoutCountLabel(week.completedCount)} состоялось`
          : 'Тренировок пока не было'
        : 'Данные недели пока недоступны'}</strong>
      <p>{week ? plannedBreakdown(week) : 'Повторите загрузку немного позже'}</p>
    </div>
  </article>
}

export function TrainerProgressOverviewCard({ clientId }: { clientId: string }) {
  const { actor } = useAuth()
  const regularity = useQuery({
    queryKey: ['workout-regularity', clientId],
    queryFn: () => progressRepository.regularity(clientId),
  })
  const week = regularity.data?.find((item) => item.period === 'week')

  return <section className="trainer-progress-week-card" aria-label="Тренировки за неделю">
    <Coachmark
      id="trainer-progress-layout-2026-08"
      userId={actor?.userId}
      title="Прогресс стал короче"
      description="Текущая неделя и анализ теперь видны сразу, а бег и замеры открываются отдельно."
    >
      <AsyncView loading={regularity.isLoading} error={regularity.error} onRetry={() => void regularity.refetch()}>
        <TrainerProgressOverviewContent week={week} />
      </AsyncView>
    </Coachmark>
  </section>
}
