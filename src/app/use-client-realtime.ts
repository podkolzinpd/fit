import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { realtimeRepository, type ClientRealtimeChange } from '../data/repositories/realtime.repository'

const debounceMs = 150

export function clientRealtimeQueryKeys(clientId: string, change?: ClientRealtimeChange): readonly (readonly unknown[])[] {
  if (!change) return [
    ['my-client'],
    ['client', clientId],
    ['workouts'],
    ['progress', clientId],
    ['metrics', clientId],
    ['client-stats', clientId],
  ]
  const row = change.eventType === 'DELETE' ? change.old : change.new
  switch (change.table) {
    case 'clients':
      return [['my-client'], ['client', clientId], ['clients']]
    case 'workouts': {
      const workoutId = typeof row.id === 'string' ? row.id : undefined
      return workoutId
        ? [['workout', workoutId], ['workouts'], ['client-stats', clientId]]
        : [['workouts'], ['client-stats', clientId]]
    }
    case 'workout_exercises':
    case 'workout_sets':
      return [['workouts']]
    case 'client_progress':
    case 'client_progress_custom':
      return [['progress', clientId], ['client', clientId]]
    case 'client_custom_metrics':
      return [['metrics', clientId], ['progress', clientId]]
  }
}

export function useClientRealtime(clientId: string | undefined) {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!clientId) return
    let unsubscribe: (() => void) | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const pending = new Map<string, readonly unknown[]>()

    const flush = () => {
      timer = undefined
      for (const queryKey of pending.values()) {
        void queryClient.invalidateQueries({ queryKey })
      }
      pending.clear()
    }
    const enqueue = (change: ClientRealtimeChange) => {
      for (const queryKey of clientRealtimeQueryKeys(clientId, change)) {
        pending.set(JSON.stringify(queryKey), queryKey)
      }
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, debounceMs)
    }
    const subscribe = () => {
      if (!unsubscribe) unsubscribe = realtimeRepository.subscribeToClientChanges(clientId, enqueue)
    }
    const suspend = () => {
      if (timer) clearTimeout(timer)
      timer = undefined
      pending.clear()
      unsubscribe?.()
      unsubscribe = undefined
    }
    const resume = () => {
      if (document.hidden) return
      subscribe()
      for (const queryKey of clientRealtimeQueryKeys(clientId)) {
        void queryClient.invalidateQueries({ queryKey, refetchType: 'active' })
      }
    }
    const onVisibilityChange = () => document.hidden ? suspend() : resume()

    if (!document.hidden) subscribe()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pageshow', resume)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pageshow', resume)
      suspend()
    }
  }, [clientId, queryClient])
}
