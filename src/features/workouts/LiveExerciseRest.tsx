import { useState } from 'react'
import { formatRest } from './LiveRestTimer'

/** A Live-only override: the trainer's original plan is never rewritten. */
export function LiveExerciseRest({ seconds, onChange }: { seconds: number; onChange: (seconds: number) => void }) {
  const [open, setOpen] = useState(false)
  return <div className="live-exercise-rest">
    <button type="button" className="link" aria-expanded={open} onClick={() => setOpen(!open)}>{seconds > 0 ? `Отдых ${formatRest(seconds)}` : 'Отдых выкл.'}</button>
    {open && <label>Отдых в этой тренировке<select aria-label="Отдых в этой тренировке" value={seconds} onChange={(event) => { onChange(Number(event.target.value)); setOpen(false) }}>
      {[...new Set([0, 30, 60, 90, 120, 180, 240, 300, seconds])].sort((a, b) => a - b).map((value) => <option key={value} value={value}>{value === 0 ? 'Выключен' : formatRest(value)}</option>)}
    </select></label>}
  </div>
}

export function readLiveRestOverrides(key: string): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(key) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 3600))
  } catch { return {} }
}
