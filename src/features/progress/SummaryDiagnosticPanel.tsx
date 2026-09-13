import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getSummaryDiagnostic, type SummaryDiagnostic } from '../../data/repositories/summary-diagnostic.repository'

export function SummaryDiagnosticPanel({ clientId }: { clientId: string }) {
  const [data, setData] = useState<SummaryDiagnostic | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)
  const [started, setStarted] = useState(false)
  const matches = data?.stats.workouts === 14 && data.stats.exercises === 149 && data.stats.sets === 376 && data.stats.model_input_chars === 44511
  async function run() {
    if (busy.current || started) return
    busy.current = true
    setPending(true)
    setError('')
    try {
      if (!data) {
        setData(await getSummaryDiagnostic(clientId, 'preflight'))
      } else if (matches) {
        const key = `fit-summary-diagnostic-started:${clientId}`
        if (sessionStorage.getItem(key)) throw new Error('Запрос уже запускался в этой вкладке. Повтор отключён.')
        sessionStorage.setItem(key, '1')
        setStarted(true)
        setData(await getSummaryDiagnostic(clientId, 'run_once', data.fingerprint))
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Ошибка диагностики. Повторный платный запрос не запускайте.')
    } finally { busy.current = false; setPending(false) }
  }
  return <section className="ai-progress-card client-progress-card" style={{ padding: 'var(--space-4)' }} aria-label="Закрытая диагностика анализа" aria-busy={pending}>
    <h2>Диагностика ИИ-анализа</h2>
    <p>12 августа — 11 сентября 2026. Результат не сохраняется в историю. Доступ проверяется сервером.</p>
    {data && <p>Тренировок: {data.stats.workouts}; записей упражнений: {data.stats.exercises}; подходов: {data.stats.sets}; символов: {data.stats.model_input_chars}.</p>}
    {data && !matches && <p role="alert">Вход отличается от запроса в журнале. Вызов ИИ заблокирован.</p>}
    {!data?.answer && <button type="button" className="primary" disabled={pending || started || Boolean(data && !matches)} onClick={() => void run()}>
      {pending ? 'Проверяем…' : data ? 'Один запрос к ИИ' : 'Сверить данные без ИИ'}
    </button>}
    {error && <p role="alert">{error}</p>}
    {data?.answer && <>
      <h3>Причины отклонения</h3>
      <ul>{data.issues?.map((issue) => <li key={issue}>{issue}</li>)}</ul>
      <h3>Исходный ответ</h3>
      <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{data.answer}</p>
    </>}
    <Link to="/me/progress">Вернуться к прогрессу</Link>
  </section>
}
