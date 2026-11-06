import type { TrainerFinanceOverview } from '../../data/contracts/trainer-finance'
import { financeChartSegments, financeClientColor, financeMetricValue, financeMoney, type FinanceMetric } from './finance-monthly'
import './finance-monthly.css'

export function FinanceMonthlySummary({ data, metric, onMetricChange, clientId }: {
  data: TrainerFinanceOverview
  metric: FinanceMetric
  onMetricChange: (value: FinanceMetric) => void
  clientId?: string
}) {
  const client = clientId ? data.clients.find(item => item.clientId === clientId) : undefined
  const total = metric === 'money' ? data.receivedCents : data.completedSessions ?? 0
  const value = client ? financeMetricValue(client, metric) : clientId ? 0 : total
  const received = client ? client.receivedCents : clientId ? 0 : data.receivedCents
  const sessions = client ? client.completedSessions : clientId ? 0 : data.completedSessions
  const formatted = (amount: number) => metric === 'money' ? financeMoney(amount) : String(amount)
  const segments = clientId ? [
    { id: clientId, label: client?.fullName ?? 'Спортсмен', value, color: financeClientColor(clientId) },
    { id: 'others', label: 'Остальные спортсмены', value: Math.max(0, total - value), color: 'var(--lime-surface-high)' },
  ].filter(item => item.value > 0) : financeChartSegments(data.clients, metric)
  const circumference = 2 * Math.PI * 94
  return <section className="finance-monthly" aria-label="Итоги за месяц">
    <div className="finance-tabs finance-monthly-switch" role="group" aria-label="Показатель итогов">
      <button type="button" className={metric === 'money' ? 'is-active' : ''} aria-pressed={metric === 'money'} onClick={() => onMetricChange('money')}>Поступления</button>
      <button type="button" className={metric === 'sessions' ? 'is-active' : ''} aria-pressed={metric === 'sessions'} onClick={() => onMetricChange('sessions')}>Тренировки</button>
    </div>
    <div className="finance-monthly-card">
      <div className="finance-monthly-ring">
        <svg viewBox="0 0 220 220" role="img" aria-label={`${metric === 'money' ? 'Поступления' : 'Проведено'}: ${formatted(value)}`}>
          <circle className="finance-monthly-track" cx="110" cy="110" r="94" />
          {segments.map((item, index) => {
            const length = total > 0 ? item.value / total * circumference : 0
            const start = total > 0 ? segments.slice(0, index).reduce((sum, previous) => sum + previous.value, 0) / total * circumference : 0
            const mark = Math.max(0, length - (segments.length > 1 ? 3 : 0))
            return <circle key={item.id} cx="110" cy="110" r="94" stroke={item.color}
              strokeDasharray={`${mark} ${circumference - mark}`} strokeDashoffset={-start}>
              <title>{item.label}: {formatted(item.value)}</title>
            </circle>
          })}
        </svg>
        <div className="finance-monthly-center">
          <span>{metric === 'money' ? 'Получено за месяц' : 'Проведено за месяц'}</span>
          <strong data-finance-monthly-total>{formatted(value)}</strong>
          <small>{clientId ? `Всего ${formatted(total)}` : metric === 'money' ? 'Все спортсмены' : 'тренировок · все спортсмены'}</small>
        </div>
      </div>
      {total === 0 && <p className="finance-monthly-empty">{metric === 'money' ? 'Поступлений за месяц нет' : 'Проведённых занятий за месяц нет'}</p>}
      {!clientId && segments.some(item => item.id === 'others') && <p className="finance-monthly-empty">Остальные: {formatted(segments.find(item => item.id === 'others')!.value)}</p>}
      <div className="finance-monthly-companion"><span>{metric === 'money' ? 'Проведено' : 'Получено'}</span><strong>{metric === 'money' ? sessions : financeMoney(received)}</strong></div>
    </div>
  </section>
}
