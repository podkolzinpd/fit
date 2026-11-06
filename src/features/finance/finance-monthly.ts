import type { TrainerFinanceOverviewClient } from '../../data/contracts/trainer-finance'

export type FinanceMetric = 'money' | 'sessions'
export function financeMoney(cents: number) {
  // Keep integer cents exact even when dividing a large safe integer would
  // lose a kopeck in floating-point rubles. The read model validates integers.
  const value = BigInt(cents), fraction = value % 100n
  const formatter = new Intl.NumberFormat('ru-RU', {
    style: 'currency', currency: 'RUB', maximumFractionDigits: fraction === 0n ? 0 : 2,
  })
  return formatter.formatToParts(value / 100n).map(part =>
    part.type === 'fraction' ? fraction.toString().padStart(2,'0') : part.value).join('')
}
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
