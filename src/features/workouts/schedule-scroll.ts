// Session-only, actor-scoped positions. No personal data or workout contents.
export function readScheduleScroll(key: string): number | null {
  try {
    const raw = sessionStorage.getItem(`fit.lime-calendar-scroll.${key}`)
    if (raw === null) return null
    const value = Number(raw)
    return Number.isFinite(value) && value >= 0 ? value : null
  } catch { return null }
}

export function writeScheduleScroll(key: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) return
  try { sessionStorage.setItem(`fit.lime-calendar-scroll.${key}`, String(value)) } catch { /* Calendar remains usable without storage. */ }
}
