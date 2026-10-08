import { useState } from 'react'

const PREFIX = 'fit.lime-schedule-independent.'

export function readIndependentSchedule(userId: string | undefined): boolean {
  if (!userId) return false
  try { return window.localStorage.getItem(`${PREFIX}${userId}`) === 'true' } catch { return false }
}

export function useIndependentSchedule(userId: string | undefined) {
  const [selection, setSelection] = useState<{ userId: string; enabled: boolean; saved: boolean } | null>(null)
  // Derive from the current account during render: a previous trainer never leaks one frame.
  const current = selection?.userId === userId ? selection : null
  const enabled = current?.enabled ?? readIndependentSchedule(userId)
  function change(next: boolean) {
    if (!userId) return
    let saved = true
    try { window.localStorage.setItem(`${PREFIX}${userId}`, String(next)) } catch { saved = false }
    setSelection({ userId, enabled: next, saved })
  }
  return { enabled, change, storageError: current?.saved === false }
}
