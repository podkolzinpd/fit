import { addDays, addMonths, daysBetween, type LocalDate } from '../../shared/local-date'

export type SummaryPeriod = '1m' | '3m' | '6m'

export const SUMMARY_PERIODS: Array<{ key: SummaryPeriod; label: string; months: number }> = [
  { key: '1m', label: '1 месяц', months: 1 },
  { key: '3m', label: '3 месяца', months: 3 },
  { key: '6m', label: '6 месяцев', months: 6 },
]

export function summaryPeriodRange(key: SummaryPeriod, end: LocalDate): {
  start: LocalDate
  end: LocalDate
} {
  const months = SUMMARY_PERIODS.find((period) => period.key === key)?.months ?? 6
  return { start: addDays(addMonths(end, -months), 1), end }
}

export function availableSummaryPeriods(
  firstCompletedWorkoutDate: LocalDate | null | undefined,
  today: LocalDate,
  existingSummaries: ReadonlyArray<{ periodStart: LocalDate; periodEnd: LocalDate }> = [],
): SummaryPeriod[] {
  const available = new Set<SummaryPeriod>(['1m'])
  if (firstCompletedWorkoutDate) {
    if (firstCompletedWorkoutDate < summaryPeriodRange('1m', today).start) available.add('3m')
    if (firstCompletedWorkoutDate < summaryPeriodRange('3m', today).start) available.add('6m')
  }
  for (const period of SUMMARY_PERIODS) {
    if (summaryPeriodMatch(existingSummaries, period.key, today)) available.add(period.key)
  }
  return SUMMARY_PERIODS.map((period) => period.key).filter((key) => available.has(key))
}

// Сводку сопоставляем с выбранным периодом по длине окна, а не по точному
// совпадению дат: границы БД и приложения могут сдвинуться на несколько дней
// из-за таймзоны или смены месяца.
export function summaryPeriodMatch<T extends { periodStart: LocalDate; periodEnd: LocalDate }>(
  values: readonly T[],
  key: SummaryPeriod,
  today: LocalDate,
): T | undefined {
  const months = SUMMARY_PERIODS.find((period) => period.key === key)?.months ?? 6
  const target = daysBetween(addMonths(today, -months), today)
  const tolerance = 15
  return values
    .map((item) => ({ item, span: daysBetween(item.periodStart, item.periodEnd) }))
    .filter(({ span }) => Math.abs(span - target) <= tolerance)
    .sort((a, b) =>
      Math.abs(a.span - target) - Math.abs(b.span - target)
      || (a.item.periodEnd < b.item.periodEnd ? 1 : -1))
    .at(0)?.item
}
