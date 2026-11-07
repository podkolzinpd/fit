import { useSyncExternalStore } from 'react'

// SET-STORAGE-01: only failed writes to existing preference keys live here.
const transientValues = new Map<string, string>()
const changed = 'fit-preference-storage-status-change'

export function readPreferenceStorage(key: string): string | null {
  if (transientValues.has(key)) return transientValues.get(key)!
  try { return window.localStorage.getItem(key) } catch { return null }
}

export function writePreferenceStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
    transientValues.delete(key)
  } catch {
    transientValues.set(key, value)
  }
  window.dispatchEvent(new Event(changed))
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    const hadTransient = event.key === null ? transientValues.size > 0 : transientValues.has(event.key)
    if (event.key === null) transientValues.clear()
    else transientValues.delete(event.key)
    if (hadTransient) window.dispatchEvent(new Event(changed))
  })
}

function subscribe(listener: () => void) {
  window.addEventListener(changed, listener)
  return () => window.removeEventListener(changed, listener)
}

export function useHasUnsavedPreferences(keys: readonly (string | undefined)[]) {
  return useSyncExternalStore(subscribe, () => keys.some(key => key !== undefined && transientValues.has(key)), () => false)
}
