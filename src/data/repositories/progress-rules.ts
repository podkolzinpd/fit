import type { ProgressEntry } from '../../shared/domain'
import type { LocalDate } from '../../shared/local-date'

export function roundMetric(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000
}

export function findProgressDateConflict(
  entries: readonly ProgressEntry[],
  recordedOn: LocalDate,
  editingId?: string,
): ProgressEntry | undefined {
  return entries.find((entry) => entry.recordedOn === recordedOn && entry.id !== editingId)
}
