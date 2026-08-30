import { useState } from 'react'
import type { TrainerProgressSignal } from './trainer-progress-signals'

function signalCountLabel(count: number): string {
  if (count === 0) return 'Проверяемых сигналов нет'
  if (count === 1) return '1 проверяемый сигнал'
  return `${count} проверяемых сигнала`
}

export function TrainerProgressSignalsSection({ signals, loading, error, onRetry }: {
  signals: readonly TrainerProgressSignal[]
  loading: boolean
  error: Error | null
  onRetry: () => void
}) {
  const [open, setOpen] = useState(false)
  const status = loading
    ? 'Собираем проверяемые факты'
    : error
      ? signals.length > 0 ? `${signalCountLabel(signals.length)} · часть данных недоступна` : 'Не все данные доступны'
      : signalCountLabel(signals.length)

  return <section className="trainer-progress-signals" aria-labelledby="trainer-progress-signals-title">
    <header>
      <div><span>Для тренера</span><h3 id="trainer-progress-signals-title">{status}</h3></div>
      <button type="button" className="link" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {open ? 'Свернуть' : 'Показать'}
      </button>
    </header>
    {open && <div className="trainer-progress-signals-content">
      {loading && signals.length === 0 && <p role="status">Проверяем цель, историю и тренировочный ритм…</p>}
      {error && <p role="alert">Часть фактов не удалось проверить. <button type="button" className="link" onClick={onRetry}>Повторить</button></p>}
      {!loading && !error && signals.length === 0 && <p>В доступных данных нет противоречий, пробелов или вопросов, которые требуют отдельного обсуждения.</p>}
      {signals.length > 0 && <ol>{signals.map((signal) => <li key={signal.id} data-signal-kind={signal.kind} data-fact-ids={signal.factIds.join(',')}>
        <strong>{signal.label}</strong>
        <p><span>Факт</span>{signal.fact}</p>
        <p><span>Вопрос</span>{signal.question}</p>
      </li>)}</ol>}
    </div>}
  </section>
}
