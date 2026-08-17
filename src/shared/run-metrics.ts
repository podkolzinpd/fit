export type RunDistanceUnit = 'm' | 'km'

const distanceFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 })

export function formatRunDuration(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return ''
  const rounded = Math.round(seconds)
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  const remainder = rounded % 60
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
  return `${minutes}:${String(remainder).padStart(2, '0')}`
}

export function parseRunDurationInput(value: string): number | undefined {
  const normalized = value.trim().replace(',', '.')
  if (!normalized) return undefined
  if (/^\d+(?:\.\d+)?$/.test(normalized)) {
    const minutes = Number(normalized)
    return Number.isFinite(minutes) ? Math.round(minutes * 60) : undefined
  }
  const parts = normalized.split(':')
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) return undefined
  const values = parts.map(Number)
  if (parts.length === 2) {
    const [minutes, seconds] = values
    if (minutes === undefined || seconds === undefined || seconds > 59) return undefined
    return minutes * 60 + seconds
  }
  const [hours, minutes, seconds] = values
  if (hours === undefined || minutes === undefined || seconds === undefined || minutes > 59 || seconds > 59) return undefined
  return hours * 3600 + minutes * 60 + seconds
}

export function preferredRunDistanceUnit(distanceKm?: number): RunDistanceUnit {
  return distanceKm !== undefined && distanceKm > 0 && distanceKm < 1 ? 'm' : 'km'
}

export function formatRunDistanceInput(distanceKm: number | undefined, unit: RunDistanceUnit): string {
  if (distanceKm === undefined || !Number.isFinite(distanceKm) || distanceKm < 0) return ''
  return String(unit === 'm' ? Math.round(distanceKm * 1000) : Math.round(distanceKm * 1000) / 1000)
}

export function runDistanceKmFromInput(value: string, unit: RunDistanceUnit): number | undefined {
  const normalized = value.trim().replace(',', '.')
  if (!normalized) return undefined
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed) || parsed < 0) return undefined
  return Math.round((unit === 'm' ? parsed / 1000 : parsed) * 1000) / 1000
}

export function runDistanceLabel(distanceKm?: number): string | null {
  if (distanceKm === undefined || !Number.isFinite(distanceKm) || distanceKm <= 0) return null
  if (distanceKm < 1) return `${distanceFormatter.format(distanceKm * 1000)} м`
  return `${distanceFormatter.format(distanceKm)} км`
}

export function runPaceLabel(durationSec?: number, distanceKm?: number): string | null {
  if (durationSec === undefined || distanceKm === undefined || durationSec <= 0 || distanceKm <= 0) return null
  const paceSeconds = Math.round(durationSec / distanceKm)
  return `${Math.floor(paceSeconds / 60)}:${String(paceSeconds % 60).padStart(2, '0')}/км`
}
