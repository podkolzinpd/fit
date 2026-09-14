import { formatRest } from './LiveRestTimer'

/** A Live-only override: the trainer's original plan is never rewritten. */
export function LiveExerciseRest({ seconds, onChange }: { seconds: number; onChange: (seconds: number) => void }) {
  return <label className="live-exercise-rest">
    <span>Отдых</span>
    <select aria-label="Отдых" value={seconds} onChange={(event) => onChange(Number(event.target.value))}>
      {[...new Set([0, 30, 60, 90, 120, 180, 240, 300, seconds])].sort((a, b) => a - b).map((value) => <option key={value} value={value}>{value === 0 ? 'Выключен' : formatRest(value)}</option>)}
    </select>
  </label>
}

export function readLiveRestOverrides(key: string): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(key) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 3600))
  } catch { return {} }
}
