import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { trainingSummariesRepository } from '../../data/repositories/training-summaries.repository'
import type {
  ClientTrainingSummary,
  PublishedTrainingSummary,
  TrainingSummary,
  TrainingSummaryMetrics,
} from '../../shared/domain'
import { addDays, addMonths, daysBetween, formatLocalDate, todayLocalDate, type LocalDate } from '../../shared/local-date'
import { AsyncView, Field } from '../../shared/ui'
import { trackGoal } from '../../shared/yandex-metrika'

type SummaryPeriod = '1m' | '3m' | '6m'

const PERIODS: Array<{ key: SummaryPeriod; label: string; months: number }> = [
  { key: '1m', label: '1 месяц', months: 1 },
  { key: '3m', label: '3 месяца', months: 3 },
  { key: '6m', label: '6 месяцев', months: 6 },
]

function periodRange(key: SummaryPeriod, end = todayLocalDate()): {
  start: LocalDate
  end: LocalDate
} {
  const months = PERIODS.find((period) => period.key === key)?.months ?? 6
  return { start: addDays(addMonths(end, -months), 1), end }
}

// Сводку сопоставляем с выбранным периодом по ДЛИНЕ окна (в днях), а не по
// точному совпадению дат. Точное равенство было хрупким: сводка генерируется по
// current_date БД, а окно считается по todayLocalDate() приложения — при сдвиге
// на день (таймзона/смена суток/клэмп конца месяца) match терял запись и экран
// показывал «сводка не запрошена». Берём запись, чья длина ближе всего к целевой
// (с допуском), и среди подходящих — самую свежую по periodEnd.
function periodMatch<T extends { periodStart: LocalDate; periodEnd: LocalDate }>(
  values: T[],
  key: SummaryPeriod,
): T | undefined {
  const months = PERIODS.find((period) => period.key === key)?.months ?? 6
  const target = daysBetween(addMonths(todayLocalDate(), -months), todayLocalDate())
  // Допуск: половина месяца — уверенно отделяет 1m от 3m от 6m, но переживает
  // сдвиг границ на несколько дней.
  const tolerance = 15
  return values
    .map((item) => ({ item, span: daysBetween(item.periodStart, item.periodEnd) }))
    .filter(({ span }) => Math.abs(span - target) <= tolerance)
    .sort((a, b) =>
      Math.abs(a.span - target) - Math.abs(b.span - target)
      || (a.item.periodEnd < b.item.periodEnd ? 1 : -1))
    .at(0)?.item
}

function PeriodTabs({ value, onChange }: {
  value: SummaryPeriod
  onChange: (period: SummaryPeriod) => void
}) {
  return <div className="ai-progress-periods" aria-label="Период анализа">
    {PERIODS.map((period) => <button
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
    <div><strong>{metrics.workoutsPerWeek.toLocaleString('ru-RU')}</strong><span>в неделю</span></div>
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
  const queryClient = useQueryClient()
  const [period, setPeriod] = useState<SummaryPeriod>('6m')
  const query = useQuery({
    queryKey: ['training-summaries', 'trainer', clientId],
    queryFn: () => trainingSummariesRepository.listForTrainer(clientId),
  })
  const summary = periodMatch(query.data ?? [], period)
  const range = periodRange(period)
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
      <span>{summary ? `Обновлено ${new Date(summary.generatedAt).toLocaleString('ru-RU')}` : 'Данные клиента не отправляются без действия тренера'}</span>
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
  const [previewOpen, setPreviewOpen] = useState(!summary.published)
  return <>
    <div className="ai-progress-hero"><span>Итог</span><strong>{summary.trainer.headline}</strong></div>
    <Metrics metrics={summary.metrics} audience="trainer" />
    <div className="ai-progress-section">
      <h3>Прогресс</h3>
      <ul>{summary.trainer.progress.map((point) => <li key={point}>{point}</li>)}</ul>
    </div>
    <div className="ai-progress-section ai-progress-regularity">
      <div><span>Регулярность</span><strong>{summary.metrics.workoutsPerWeek.toLocaleString('ru-RU')} / нед.</strong></div>
      <p>{summary.trainer.consistency}</p>
    </div>
    {summary.trainer.attention.length > 0 && <div className="ai-progress-attention">
      <span aria-hidden="true">!</span>
      <div>{summary.trainer.attention.map((point) => <p key={point}>{point}</p>)}</div>
    </div>}
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
    })
  }

  return <form className="client-copy-editor" onSubmit={(event) => void submit(event)}>
    <div className="client-copy-heading">
      <div><strong>Версия для клиента</strong><p>Внутренние замечания сюда не попадут</p></div>
      <span>{summary.published ? 'Клиент уже видит' : 'Клиент может запросить сам'}</span>
    </div>
    <Field label="Главный результат"><textarea name="headline" defaultValue={summary.client.headline} required /></Field>
    <Field label="Достижения — по одному в строке"><textarea name="achievements" defaultValue={summary.client.achievements.join('\n')} required /></Field>
    <Field label="Регулярность"><textarea name="consistency" defaultValue={summary.client.consistency} required /></Field>
    <Field label="Поддерживающий итог"><textarea name="encouragement" defaultValue={summary.client.encouragement} required /></Field>
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

export function ClientTrainingSummaryCard({ clientId }: { clientId: string }) {
  const queryClient = useQueryClient()
  const [period, setPeriod] = useState<SummaryPeriod>('6m')
  const query = useQuery({
    queryKey: ['training-summaries', 'client', clientId],
    queryFn: () => trainingSummariesRepository.listForClient(clientId),
  })
  const summary = useMemo(
    () => periodMatch(query.data ?? [], period),
    [query.data, period],
  )
  const generate = useMutation({
    mutationFn: () => {
      const range = periodRange(period)
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
      {summary ? <ClientSummaryContent summary={summary} /> : <div className="ai-progress-empty">
        <strong>За этот период сводка ещё не запрошена</strong>
        <p>Запроси анализ — Yandex Cloud соберёт прогресс по твоим тренировкам.</p>
      </div>}
    </AsyncView>
    <footer className="ai-progress-footer">
      <span>{summary ? `Обновлено ${new Date(summary.generatedAt).toLocaleString('ru-RU')}` : 'Можно запросить первый анализ'}</span>
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

function ClientSummaryContent({ summary }: { summary: PublishedTrainingSummary }) {
  return <>
    <div className="ai-progress-hero"><span>Главный результат</span><strong>{summary.summary.headline}</strong></div>
    <Metrics metrics={summary.metrics} audience="client" />
    <div className="ai-progress-section">
      <h3>Что получилось</h3>
      <ul>{summary.summary.achievements.map((point) => <li key={point}>{point}</li>)}</ul>
    </div>
    <div className="ai-progress-section ai-progress-regularity">
      <div><span>Твоя регулярность</span><strong>{summary.metrics.workoutsPerWeek.toLocaleString('ru-RU')} / нед.</strong></div>
      <p>{summary.summary.consistency}</p>
    </div>
    <div className="client-encouragement"><span aria-hidden="true">✦</span><p>{summary.summary.encouragement}</p></div>
    <footer className="ai-progress-footer">
      <span>Сводка сформирована {new Date(summary.publishedAt).toLocaleDateString('ru-RU')}</span>
    </footer>
  </>
}
