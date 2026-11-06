import type { TrainerFinanceOverviewClient } from '../../data/contracts/trainer-finance'

export type FinanceMetric = 'money' | 'sessions'
export const financeMoney = (cents: number) => new Intl.NumberFormat('ru-RU', {
  style: 'currency', currency: 'RUB', maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
}).format(cents / 100)
export const financeMetricValue = (client: TrainerFinanceOverviewClient, metric: FinanceMetric) =>
  metric === 'money' ? client.receivedCents : client.completedSessions ?? 0
export function financeClientColor(clientId: string) {
  const colors = ['var(--lime-accent)', 'var(--lime-pink)', 'var(--lime-yellow)', 'var(--lime-text)', 'var(--lime-text-secondary)']
  let hash = 0
  for (const char of clientId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return colors[hash % colors.length]!
}
export function financeChartSegments(clients: TrainerFinanceOverviewClient[], metric: FinanceMetric) {
  const ordered = clients.map(client => ({ id: client.clientId, label: client.fullName,
    value: financeMetricValue(client, metric), color: financeClientColor(client.clientId) }))
    .filter(item => item.value > 0).sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
  if (ordered.length <= 5) return ordered
  return [...ordered.slice(0, 4), { id: 'others', label: 'Остальные',
    value: ordered.slice(4).reduce((sum, item) => sum + item.value, 0), color: 'var(--lime-surface-high)' }]
}
