import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getLegacySummaryDiagnostic, getSummaryDiagnostic, type SummaryDiagnostic } from '../../data/repositories/summary-diagnostic.repository'

export function SummaryDiagnosticPanel({ backendSource, apiBaseUrl, sessionToken, clientId, periodStart, periodEnd }: { backendSource: 'supabase' | 'yandex'; apiBaseUrl: string | null; sessionToken: string | null; clientId: string; periodStart: string; periodEnd: string }) {
  const [data, setData] = useState<SummaryDiagnostic | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)
  async function run() {
    if (busy.current) return
    busy.current = true
    setPending(true)
    setError('')
    try {
      if (backendSource === 'supabase') {
        setData(await getLegacySummaryDiagnostic(clientId, periodStart, periodEnd))
      } else {
        if (!apiBaseUrl || !sessionToken) throw new Error('Этап SESSION · активная Yandex-сессия не найдена')
        setData(await getSummaryDiagnostic(apiBaseUrl, sessionToken, clientId, periodStart, periodEnd))
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Ошибка диагностики. Повторный платный запрос не запускайте.')
    } finally { busy.current = false; setPending(false) }
  }
  return <section className="ai-progress-card client-progress-card" style={{ padding: 'var(--space-4)' }} aria-label="Закрытая диагностика анализа" aria-busy={pending}>
    <h2>Диагностика анализа</h2>
    <p>{periodStart} — {periodEnd}. Проверка повторяет production-маршрут, но не вызывает ИИ и ничего не сохраняет.</p>
    {data && <div role="status">
      <p><strong>{data.ready ? 'Preflight пройден' : 'Preflight нашёл блокировку'}. Расход токенов: 0.</strong></p>
      <p>Код: {data.code}</p>
      {data.stats.workouts > 0 && <p>Тренировок: {data.stats.workouts}; записей упражнений: {data.stats.exercises}; подходов: {data.stats.sets}; символов для модели: {data.stats.model_input_chars}.</p>}
      {data.checks && <p>Кэш: {data.checks.cache ?? '—'}; генерация: {data.checks.generation_enabled === false ? 'выключена' : 'включена'}; лимитер: {data.checks.guard_decision ?? '—'}; запросов сегодня: {data.checks.calls_today ?? '—'}; последняя ошибка: {data.checks.last_failure_code ?? '—'}.</p>}
      <p>ID: {data.requestId}<br />Release: {data.releaseId}</p>
    </div>}
    <button type="button" className="primary" disabled={pending} onClick={() => void run()}>
      {pending ? 'Проверяем…' : data ? 'Повторить preflight' : 'Запустить preflight без ИИ'}
    </button>
    {error && <p role="alert">{error}</p>}
    <Link to="/me/progress">Вернуться к прогрессу</Link>
  </section>
}
