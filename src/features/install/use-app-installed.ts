import { useEffect, useState } from 'react'
import { isAppInstalled, subscribeInstallState } from './app-install'

/** Observe the existing browser install state; no preference or permission is changed. */
export function useAppInstalled() {
  const [installed, setInstalled] = useState(isAppInstalled)
  useEffect(() => {
    const refresh = () => setInstalled(isAppInstalled())
    const unsubscribe = subscribeInstallState(refresh)
    const media = window.matchMedia?.('(display-mode: standalone)')
    media?.addEventListener('change', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      unsubscribe()
      media?.removeEventListener('change', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])
  return installed
}
