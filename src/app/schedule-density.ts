import { useCallback, useEffect, useState } from 'react'
import type { ScheduleDensity } from '../shared/domain'
import { useAuth } from './auth-context'

const STORAGE_PREFIX = 'fit.scheduleDensity.'

export const SCHEDULE_HOUR_HEIGHT: Record<ScheduleDensity, number> = {
  comfortable: 56,
  compact: 44,
}

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`
}

export function readStoredScheduleDensity(userId: string | undefined): ScheduleDensity | undefined {
  if (!userId) return undefined
  try {
    const stored = window.localStorage.getItem(storageKey(userId))
    return stored === 'comfortable' || stored === 'compact' ? stored : undefined
  } catch {
    return undefined
  }
}

function writeStoredScheduleDensity(userId: string, density: ScheduleDensity): void {
  try { window.localStorage.setItem(storageKey(userId), density) } catch { /* Server preference remains authoritative. */ }
}

export function useScheduleDensityPreference() {
  const { actor, updateScheduleDensity } = useAuth()
  const remoteDensity = actor?.preferences?.scheduleDensity
  const [density, setDensity] = useState<ScheduleDensity>(() =>
    remoteDensity ?? readStoredScheduleDensity(actor?.userId) ?? 'comfortable')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [failedDensity, setFailedDensity] = useState<ScheduleDensity | null>(null)

  useEffect(() => {
    if (!actor || !remoteDensity) return
    setDensity(remoteDensity)
    writeStoredScheduleDensity(actor.userId, remoteDensity)
  }, [actor, remoteDensity])

  const save = useCallback(async (next: ScheduleDensity) => {
    if (!actor || actor.role !== 'trainer' || status === 'saving' || next === density) return
    const previous = density
    setDensity(next)
    writeStoredScheduleDensity(actor.userId, next)
    setStatus('saving')
    setFailedDensity(null)
    try {
      await updateScheduleDensity(next)
      setStatus('saved')
    } catch {
      setDensity(previous)
      writeStoredScheduleDensity(actor.userId, previous)
      setFailedDensity(next)
      setStatus('error')
    }
  }, [actor, density, status, updateScheduleDensity])

  const retry = useCallback(() => {
    if (failedDensity) void save(failedDensity)
  }, [failedDensity, save])

  return { density, status, save, retry }
}
