import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../app/auth-context'
import { progressRepository } from '../../data/repositories/progress.repository'
import { trainingSummariesRepository } from '../../data/repositories/training-summaries.repository'
import type { TrainingSummary, WorkoutRegularity } from '../../shared/domain'
import { todayInTimeZone } from '../../shared/local-date'
import { AsyncView, Coachmark } from '../../shared/ui'
import { formatSummaryText } from './summary-format'
import { summaryPeriodMatch } from './summary-period'

function workoutCountLabel(count: number): string {
  const mod100 = count % 100
  const mod10 = count % 10
  if (mod100 >= 11 && mod100 <= 14) return 'тренировок'
  if (mod10 === 1) return 'тренировка'
  if (mod10 >= 2 && mod10 <= 4) return 'тренировки'
  return 'тренировок'
}

function regularityDetail(week: WorkoutRegularity): string {
  const parts = week.plannedCount > 0
    ? [`По плану ${week.completedPlannedCount} из ${week.plannedCount}`]
    : ['Без назначенного плана']
  if (week.partialCount > 0) parts.push(`${week.partialCount} частично`)
  if (week.skippedCount > 0) parts.push(`${week.skippedCount} пропущено`)
  return parts.join(' · ')
}

export function TrainerProgressOverviewContent({ week, summary }: {
  week?: WorkoutRegularity
  summary?: TrainingSummary
}) {
  const attention = summary?.trainer.attention ?? []
  return <div className="trainer-progress-decisions">
    <article className={week && week.completedCount > 0 ? 'is-positive' : undefined}>
      <span>Регулярность</span>
      <strong>{week
        ? `${week.completedCount} ${workoutCountLabel(week.completedCount)} за неделю`
        : 'Данные недели пока недоступны'}</strong>
      <p>{week ? regularityDetail(week) : 'Проверьте подробный анализ позднее'}</p>
    </article>
    <article>
      <span>Измеримый прогресс</span>
      <strong>{summary
        ? formatSummaryText(summary.trainer.headline)
        : 'ИИ-анализ за последний месяц ещё не создан'}</strong>
      <p>{summary ? 'По подтверждённым завершённым тренировкам' : 'Создать его можно в подробном анализе'}</p>
    </article>
    <article className={attention.length > 0 ? 'needs-attention' : 'is-clear'}>
      <span>Обратить внимание</span>
      <strong>{summary
        ? attention[0] ? formatSummaryText(attention[0]) : 'Отдельных предупреждений нет'
        : 'Появится после создания ИИ-анализа'}</strong>
      {attention.length > 1 && <p>Ещё сигналов: {attention.length - 1}</p>}
      {summary && attention.length === 0 && <p>По текущему анализу отдельное действие не требуется</p>}
    </article>
  </div>
}

export function TrainerProgressOverviewCard({ clientId }: { clientId: string }) {
  const { actor } = useAuth()
  const today = todayInTimeZone(actor?.timezone)
  const regularity = useQuery({
    queryKey: ['workout-regularity', clientId],
    queryFn: () => progressRepository.regularity(clientId),
  })
  const summaries = useQuery({
    queryKey: ['training-summaries', 'trainer', clientId],
    queryFn: () => trainingSummariesRepository.listForTrainer(clientId),
  })
  const week = regularity.data?.find((item) => item.period === 'week')
  const summary = summaryPeriodMatch(summaries.data ?? [], '1m', today)
  const loading = regularity.isLoading || summaries.isLoading
  const error = regularity.error ?? summaries.error

  return <section className="trainer-progress-overview-card" aria-labelledby="trainer-progress-overview-title">
    <header>
      <p className="eyebrow">ОБЗОР</p>
      <Coachmark id="trainer-progress-overview-2026-08" userId={actor?.userId}
        title="Progress обновился" description="Теперь сразу видно регулярность, измеримый прогресс и на что обратить внимание — без лишних переходов.">
        <h2 id="trainer-progress-overview-title">Главное по клиенту</h2>
      </Coachmark>
      <p>Сначала выводы для решения, затем подробности и служебные действия.</p>
    </header>
    <AsyncView loading={loading} error={error} onRetry={() => void Promise.all([regularity.refetch(), summaries.refetch()])}>
      <TrainerProgressOverviewContent week={week} summary={summary} />
    </AsyncView>
  </section>
}
