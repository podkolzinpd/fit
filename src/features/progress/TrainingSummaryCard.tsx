import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useAuth } from '../../app/auth-context'
import { goalsRepository } from '../../data/repositories/goals.repository'
import { trainingSummariesRepository } from '../../data/repositories/training-summaries.repository'
import type {
  ClientGoal,
  ClientTrainingSummary,
  PublishedTrainingSummary,
  TrainingSummary,
  TrainingSummaryMetrics,
} from '../../shared/domain'
import { formatLocalDate, normalizeTimeZone, todayInTimeZone, type LocalDate } from '../../shared/local-date'
import { AsyncView, Field } from '../../shared/ui'
import { trackGoal } from '../../shared/yandex-metrika'
import { ClientProgressGoalSection } from './ClientProgressGoalSection'
import { formatSummaryText, formatWorkoutsPerWeek } from './summary-format'
import { SUMMARY_PERIODS, summaryPeriodMatch, summaryPeriodRange, type SummaryPeriod } from './summary-period'

function PeriodTabs({ value, onChange }: {
  value: SummaryPeriod
  onChange: (period: SummaryPeriod) => void
}) {
  return <div className="ai-progress-periods" aria-label="Период анализа">
    {SUMMARY_PERIODS.map((period) => <button
      type="button"
      key={period.key}
      className={period.key === value ? 'active' : ''}
      onClick={() => onChange(period.key)}
    >{period.label}</button>)}
  </div>
}

function Metrics({ metrics, audience }: {
  metrics: TrainingSummaryMetrics
  audience: 'trainer' | 'client'
}) {
  return <div className="ai-progress-stats">
    <div><strong>{metrics.completedWorkouts}</strong><span>тренировки</span></div>
    <div><strong>{formatWorkoutsPerWeek(metrics.workoutsPerWeek)}</strong><span>в неделю</span></div>
    <div>
      <strong>{audience === 'trainer' ? (metrics.longestGapDays ?? '—') : metrics.activeWeeks}</strong>
      <span>{audience === 'trainer' ? 'макс. перерыв, дн.' : 'активных недель'}</span>
    </div>
  </div>
}

function SummaryHeader({ client = false, published }: { client?: boolean; published?: boolean }) {
  return <header className="ai-progress-header">
    <div className="ai-progress-title">
      <span className="ai-progress-mark" aria-hidden="true">✦</span>
      <div>
        <h2>{client ? 'Твой прогресс' : 'AI-анализ тренировок'}</h2>
        <p>{client ? 'Сводка по твоим завершённым тренировкам' : 'Прогресс за выбранный период'}</p>
      </div>
    </div>
    {published !== undefined && <span className={`ai-progress-demo${published ? ' published' : ''}`}>
      {published ? 'Доступно клиенту' : 'Только тренеру'}
    </span>}
  </header>
}

export function TrainerTrainingSummaryCard({ clientId }: { clientId: string }) {
  const { actor } = useAuth()
  const today = todayInTimeZone(actor?.timezone)
  const timeZone = normalizeTimeZone(actor?.timezone)
  const queryClient = useQueryClient()
  const [period, setPeriod] = useState<SummaryPeriod>('6m')
  const query = useQuery({
    queryKey: ['training-summaries', 'trainer', clientId],
    queryFn: () => trainingSummariesRepository.listForTrainer(clientId),
  })
  const summary = summaryPeriodMatch(query.data ?? [], period, today)
  const range = summaryPeriodRange(period, today)
  const generate = useMutation({
    mutationFn: () => trainingSummariesRepository.generate(
      clientId,
      range.start,
      range.end,
      Boolean(summary),
    ),
    onSuccess: async () => queryClient.invalidateQueries({
      queryKey: ['training-summaries', 'trainer', clientId],
    }),
  })

  return <section className="ai-progress-card" aria-label="AI-анализ тренировок">
    <SummaryHeader published={summary?.published} />
    <PeriodTabs value={period} onChange={setPeriod} />
    <AsyncView
      loading={query.isLoading}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      {summary
        ? <TrainerSummaryContent
            key={summary.id}
            summary={summary}
            clientId={clientId}
            onChanged={() => queryClient.invalidateQueries({
              queryKey: ['training-summaries', 'trainer', clientId],
            })}
          />
        : <div className="ai-progress-empty">
            <strong>Анализ за этот период ещё не создан</strong>
            <p>{formatLocalDate(range.start)} — {formatLocalDate(range.end)}</p>
          </div>}
    </AsyncView>
    <footer className="ai-progress-footer">
      <span>{summary ? `Обновлено ${new Date(summary.generatedAt).toLocaleString('ru-RU', { timeZone })}` : 'Данные клиента не отправляются без действия тренера'}</span>
      <button
        type="button"
        className="secondary"
        disabled={generate.isPending}
        onClick={() => {
          trackGoal(summary ? 'refresh_training_summary_click' : 'create_training_summary_click')
          generate.mutate()
        }}
      >
        {generate.isPending ? 'Обновляем…' : summary ? 'Обновить' : 'Создать анализ'}
      </button>
    </footer>
    {generate.error && <p className="ai-progress-error error" role="alert">{generate.error.message}</p>}
  </section>
}

function TrainerSummaryContent({ summary, clientId, onChanged }: {
  summary: TrainingSummary
  clientId: string
  onChanged: () => Promise<unknown>
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  return <>
    <div className="ai-progress-hero"><span>Итог</span><strong>{formatSummaryText(summary.trainer.headline)}</strong></div>
    <div className={`ai-progress-attention${summary.trainer.attention.length === 0 ? ' is-clear' : ''}`}>
      {summary.trainer.attention.length > 0 && <span aria-hidden="true">!</span>}
      <div>
        <strong>{summary.trainer.attention.length > 0 ? 'Обратить внимание' : 'Отдельных предупреждений нет'}</strong>
        {summary.trainer.attention.length > 0
          ? summary.trainer.attention.map((point) => <p key={point}>{formatSummaryText(point)}</p>)
          : <p>По текущему анализу нет сигнала, требующего отдельного действия.</p>}
      </div>
    </div>
    <div className="ai-progress-details-toggle">
      <button type="button" className="link" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((value) => !value)}>
        {detailsOpen ? 'Скрыть подробный анализ' : 'Подробнее об анализе'}
      </button>
    </div>
    {detailsOpen && <div className="ai-progress-details">
      <Metrics metrics={summary.metrics} audience="trainer" />
      <div className="ai-progress-section">
        <h3>Измеримый прогресс</h3>
        <ul>{summary.trainer.progress.map((point) => <li key={point}>{formatSummaryText(point)}</li>)}</ul>
      </div>
      <div className="ai-progress-section ai-progress-regularity">
        <div><span>Регулярность за период</span><strong>{formatWorkoutsPerWeek(summary.metrics.workoutsPerWeek)} / нед.</strong></div>
        <p>{formatSummaryText(summary.trainer.consistency)}</p>
      </div>
      <div className="client-copy-toggle">
        <button type="button" className="link" onClick={() => setPreviewOpen((value) => !value)}>
          {previewOpen ? 'Скрыть версию для клиента' : 'Проверить версию для клиента'}
        </button>
      </div>
      {previewOpen && <ClientCopyEditor
        summary={summary}
        clientId={clientId}
        onChanged={onChanged}
      />}
    </div>}
  </>
}

function ClientCopyEditor({ summary, clientId, onChanged }: {
  summary: TrainingSummary
  clientId: string
  onChanged: () => Promise<unknown>
}) {
  const [saved, setSaved] = useState(false)
  const publish = useMutation({
    mutationFn: (copy: ClientTrainingSummary) =>
      trainingSummariesRepository.publish(summary, copy),
    onSuccess: async () => { setSaved(true); await onChanged() },
  })
  const unpublish = useMutation({
    mutationFn: () => trainingSummariesRepository.unpublish(summary),
    onSuccess: onChanged,
  })
  useEffect(() => setSaved(false), [summary.id])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    publish.mutate({
      headline: String(values.get('headline') ?? '').trim(),
      achievements: String(values.get('achievements') ?? '')
        .split('\n').map((item) => item.trim()).filter(Boolean).slice(0, 4),
      consistency: String(values.get('consistency') ?? '').trim(),
      encouragement: String(values.get('encouragement') ?? '').trim(),
      goalAlignment: String(values.get('goalAlignment') ?? '').trim() || undefined,
      nextSteps: String(values.get('nextSteps') ?? '')
        .split('\n').map((item) => item.trim()).filter(Boolean).slice(0, 3),
    })
  }

  return <form className="client-copy-editor" onSubmit={(event) => void submit(event)}>
    <div className="client-copy-heading">
      <div><strong>Версия для клиента</strong><p>Внутренние замечания сюда не попадут</p></div>
      <span>{summary.published ? 'Клиент уже видит' : 'Клиент может запросить сам'}</span>
    </div>
    <Field label="Главный результат"><textarea name="headline" defaultValue={formatSummaryText(summary.client.headline)} required /></Field>
    <Field label="Достижения — по одному в строке"><textarea name="achievements" defaultValue={summary.client.achievements.map(formatSummaryText).join('\n')} required /></Field>
    <Field label="Регулярность"><textarea name="consistency" defaultValue={formatSummaryText(summary.client.consistency)} required /></Field>
    <Field label="Связь с целью"><textarea name="goalAlignment" defaultValue={summary.client.goalAlignment ? formatSummaryText(summary.client.goalAlignment) : ''} /></Field>
    <Field label="Следующие ориентиры — по одному в строке"><textarea name="nextSteps" defaultValue={summary.client.nextSteps?.map(formatSummaryText).join('\n') ?? ''} /></Field>
    <Field label="Поддерживающий итог"><textarea name="encouragement" defaultValue={formatSummaryText(summary.client.encouragement)} required /></Field>
    {(publish.error ?? unpublish.error) && <p className="error" role="alert">{(publish.error ?? unpublish.error)?.message}</p>}
    {saved && <p className="success">Версия опубликована для клиента</p>}
    <div className="actions">
      {summary.published && <button
        type="button"
        className="secondary danger"
        disabled={unpublish.isPending}
        onClick={() => unpublish.mutate()}
      >Скрыть</button>}
      <button disabled={publish.isPending || unpublish.isPending}>
        {summary.published ? 'Сохранить клиентскую версию' : 'Сохранить версию'}
      </button>
    </div>
    <input type="hidden" name="clientId" value={clientId} />
  </form>
}

export function ClientTrainingSummaryCard({ clientId, profileGoal }: { clientId: string; profileGoal?: string | null }) {
  const { actor } = useAuth()
  const today = todayInTimeZone(actor?.timezone)
  const timeZone = normalizeTimeZone(actor?.timezone)
  const queryClient = useQueryClient()
  const [period, setPeriod] = useState<SummaryPeriod>('1m')
  const query = useQuery({
    queryKey: ['training-summaries', 'client', clientId],
    queryFn: () => trainingSummariesRepository.listForClient(clientId),
  })
  const summary = useMemo(
    () => summaryPeriodMatch(query.data ?? [], period, today),
    [query.data, period, today],
  )
  const goal = useQuery({
    queryKey: ['client-goal', clientId],
    queryFn: () => goalsRepository.get(clientId),
  })
  const generate = useMutation({
    mutationFn: () => {
      const range = summaryPeriodRange(period, today)
      return trainingSummariesRepository.generate(clientId, range.start, range.end, true)
    },
    onSuccess: async () => queryClient.invalidateQueries({
      queryKey: ['training-summaries', 'client', clientId],
    }),
  })

  return <section className="ai-progress-card client-progress-card" aria-label="Прогресс тренировок">
    <SummaryHeader client />
    <PeriodTabs value={period} onChange={setPeriod} />
    <AsyncView loading={query.isLoading} error={query.error} onRetry={() => void query.refetch()}>
      {summary ? <ClientSummaryContent
        summary={summary}
        goal={goal.data}
        profileGoal={profileGoal}
        today={today}
        goalLoading={goal.isLoading}
        goalError={goal.error}
        onGoalRetry={() => void goal.refetch()}
      /> : <div className="ai-progress-empty">
        <strong>За этот период сводка ещё не запрошена</strong>
        <p>Запроси анализ — Yandex Cloud соберёт прогресс по твоим тренировкам.</p>
      </div>}
    </AsyncView>
    <footer className="ai-progress-footer">
      <span>{summary ? `Сводка сформирована ${new Date(summary.publishedAt).toLocaleDateString('ru-RU', { timeZone })}` : 'Можно запросить первый анализ'}</span>
      <button
        type="button"
        className="secondary"
        disabled={generate.isPending}
        onClick={() => generate.mutate()}
      >
        {generate.isPending ? 'Запрашиваем…' : summary ? 'Обновить мой прогресс' : 'Запросить мой прогресс'}
      </button>
    </footer>
    {generate.error && <p className="ai-progress-error error" role="alert">{generate.error.message}</p>}
  </section>
}

function ClientSummaryContent({ summary, goal, profileGoal, today, goalLoading, goalError, onGoalRetry }: {
  summary: PublishedTrainingSummary
  goal: ClientGoal | null | undefined
  profileGoal?: string | null
  today: LocalDate
  goalLoading: boolean
  goalError: Error | null
  onGoalRetry: () => void
}) {
  return <>
    <div className="ai-progress-hero"><span>Главный результат</span><strong>{formatSummaryText(summary.summary.headline)}</strong></div>
    <Metrics metrics={summary.metrics} audience="client" />
    <div className="ai-progress-section">
      <h3>Что получилось</h3>
      <ul>{summary.summary.achievements.map((point) => <li key={point}>{formatSummaryText(point)}</li>)}</ul>
    </div>
    <div className="ai-progress-section ai-progress-regularity">
      <div><span>Твоя регулярность</span><strong>{formatWorkoutsPerWeek(summary.metrics.workoutsPerWeek)} / нед.</strong></div>
      <p>{formatSummaryText(summary.summary.consistency)}</p>
    </div>
    <ClientProgressGoalSection
      goal={goal}
      profileGoal={profileGoal}
      today={today}
      loading={goalLoading}
      error={goalError}
      alignment={summary.summary.goalAlignment}
      onRetry={onGoalRetry}
    />
    {summary.summary.nextSteps && summary.summary.nextSteps.length > 0 && <div className="ai-progress-section ai-progress-next-steps">
      <h3>Что делать дальше</h3>
      <ul>{summary.summary.nextSteps.map((point) => <li key={point}>{formatSummaryText(point)}</li>)}</ul>
    </div>}
    <div className="client-encouragement"><span aria-hidden="true">✦</span><p>{formatSummaryText(summary.summary.encouragement)}</p></div>
  </>
}
