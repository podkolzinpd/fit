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
const chartColors = Array.from({ length: 10 }, (_, index) => `var(--lime-chart-${index + 1})`)
const otherColor = 'var(--lime-chart-others)'

export function financeClientColor(clientId: string, colors?: ReadonlyMap<string, string>) {
  const assigned = colors?.get(clientId)
  if (assigned) return assigned
  let hash = 0
  for (const char of clientId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return chartColors[hash % chartColors.length]!
}

function rankedClients(clients: TrainerFinanceOverviewClient[], metric: FinanceMetric) {
  return clients.filter(client => financeMetricValue(client, metric) > 0)
    .sort((a, b) => financeMetricValue(b, metric) - financeMetricValue(a, metric) || a.clientId.localeCompare(b.clientId))
}

/** Allocate from the complete month, never the searched/filtered rows. Reserve
 * distinct slots for the union of both charts' visible athletes (at most ten;
 * each metric shows five athletes, or four plus a grouped tail). Thus switching metric cannot change an athlete's color.
 * Remaining rows share a balanced palette once all category colors are used. */
export function financeClientColors(clients: TrainerFinanceOverviewClient[]): ReadonlyMap<string, string> {
  const visible = new Set<string>()
  for (const metric of ['money', 'sessions'] as const) {
    const ranked = rankedClients(clients, metric)
    for (const client of ranked.slice(0, ranked.length > 5 ? 4 : 5)) visible.add(client.clientId)
  }
  const ids = [...new Set(clients.map(client => client.clientId))].sort((a, b) =>
    Number(visible.has(b)) - Number(visible.has(a)) || a.localeCompare(b))
  const colors = new Map<string, string>()
  const uses = chartColors.map(() => 0)
  for (const id of ids) {
    const preferred = chartColors.indexOf(financeClientColor(id))
    const minimum = Math.min(...uses)
    const offset = chartColors.findIndex((_, step) => uses[(preferred + step) % chartColors.length] === minimum)
    const slot = (preferred + offset) % chartColors.length
    colors.set(id, chartColors[slot]!)
    uses[slot]!++
  }
  return colors
}

export function financeChartSegments(clients: TrainerFinanceOverviewClient[], metric: FinanceMetric) {
  const colors = financeClientColors(clients)
  const ordered = rankedClients(clients, metric).map(client => ({ id: client.clientId, label: client.fullName,
    value: financeMetricValue(client, metric), color: financeClientColor(client.clientId, colors) }))
  if (ordered.length <= 5) return ordered
  return [...ordered.slice(0, 4), { id: 'others', label: 'Остальные',
    value: ordered.slice(4).reduce((sum, item) => sum + item.value, 0), color: otherColor }]
}
