import type { RunningProgressFormat, RunningProgressSession } from '../../shared/domain'

export interface RunningPaceInsight {
  format: RunningProgressFormat
  changePercent: number
}

export interface RunningProgressView {
  runCount: number
  totalDistanceKm: number
  totalDurationSec: number
  averagePaceSecPerKm?: number
  averageRpe?: number
  latestRpe?: number
  paceInsight?: RunningPaceInsight
}

export const RUNNING_FORMAT_LABELS: Record<RunningProgressFormat, string> = {
  free: 'свободном беге',
  easy: 'лёгком беге',
  long: 'длительном беге',
  tempo: 'темповом беге',
  recovery: 'восстановительном беге',
  interval: 'интервалах',
  interval_active: 'интервалах с активным восстановлением',
  mixed: 'смешанной тренировке',
}

function rounded(value: number, digits = 1): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function comparableDistance(left?: number, right?: number): boolean {
  if (!left || !right) return false
  return Math.abs(left - right) / Math.max(left, right) <= 0.2
}

export function comparablePaceInsight(sessions: RunningProgressSession[]): RunningPaceInsight | undefined {
  const ordered = [...sessions].sort((left, right) => left.workoutDate.localeCompare(right.workoutDate))
  for (let latestIndex = ordered.length - 1; latestIndex > 0; latestIndex -= 1) {
    const latest = ordered[latestIndex]
    if (!latest || latest.format === 'mixed' || !latest.paceSecPerKm) continue
    for (let previousIndex = latestIndex - 1; previousIndex >= 0; previousIndex -= 1) {
      const previous = ordered[previousIndex]
      if (!previous || previous.format !== latest.format || !previous.paceSecPerKm) continue
      if (!comparableDistance(previous.distanceKm, latest.distanceKm)) continue
      return {
        format: latest.format,
        // Положительное значение означает более быстрый темп: секунд на км стало меньше.
        changePercent: Math.round(((previous.paceSecPerKm - latest.paceSecPerKm) / previous.paceSecPerKm) * 100),
      }
    }
  }
  return undefined
}

export function runningProgressView(sessions: RunningProgressSession[]): RunningProgressView {
  const totalDistanceKm = sessions.reduce((sum, session) => sum + (session.distanceKm ?? 0), 0)
  const totalDurationSec = sessions.reduce((sum, session) => sum + (session.durationSec ?? 0), 0)
  const rpeValues = sessions.flatMap((session) => session.rpe === undefined ? [] : [session.rpe])
  const latestRpe = [...sessions]
    .sort((left, right) => right.workoutDate.localeCompare(left.workoutDate))
    .find((session) => session.rpe !== undefined)?.rpe
  return {
    runCount: sessions.length,
    totalDistanceKm: rounded(totalDistanceKm),
    totalDurationSec,
    averagePaceSecPerKm: totalDistanceKm > 0 && totalDurationSec > 0
      ? rounded(totalDurationSec / totalDistanceKm)
      : undefined,
    averageRpe: rpeValues.length ? rounded(rpeValues.reduce((sum, value) => sum + value, 0) / rpeValues.length) : undefined,
    latestRpe,
    paceInsight: comparablePaceInsight(sessions),
  }
}

export function formatRunningDistance(value: number): string {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })
}

export function formatRunningDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!hours) return `${minutes} мин`
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`
}

export function formatRunningPace(seconds?: number): string {
  if (seconds === undefined) return '—'
  const roundedSeconds = Math.round(seconds)
  const minutes = Math.floor(roundedSeconds / 60)
  return `${minutes}:${String(roundedSeconds % 60).padStart(2, '0')}`
}
