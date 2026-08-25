import { useEffect, useRef } from 'react'

export const YANDEX_PILOT_POLL_INTERVAL_MS = 15_000

export function useYandexPilotPolling(
  enabled: boolean,
  refresh: () => Promise<void>,
) {
  const refreshRef = useRef(refresh)

  useEffect(() => {
    refreshRef.current = refresh
  }, [refresh])

  useEffect(() => {
    if (!enabled) return

    let interval: ReturnType<typeof setInterval> | undefined
    let refreshing = false

    const run = () => {
      if (refreshing || document.visibilityState === 'hidden') return
      refreshing = true
      void refreshRef.current().finally(() => { refreshing = false })
    }
    const start = () => {
      if (interval !== undefined || document.visibilityState === 'hidden') return
      interval = setInterval(run, YANDEX_PILOT_POLL_INTERVAL_MS)
    }
    const stop = () => {
      if (interval !== undefined) clearInterval(interval)
      interval = undefined
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        stop()
        return
      }
      run()
      start()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    start()
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      stop()
    }
  }, [enabled])
}
