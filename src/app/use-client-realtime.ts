import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import {
  realtimeRepository,
  type ClientRealtimeChange,
  type ClientRealtimeTable,
} from '../data/repositories/realtime.repository'

const REALTIME_DEBOUNCE_MS = 120

const clientSpaceRoots = new Set([
  'my-client',
  'client',
  'clients',
  'workouts',
  'workout',
  'client-stats',
  'exercise-history',
  'progress',
  'metrics',
  'client-goal',
  'client-trainers',
  'client-invitations',
  'training-summaries',
  'workout-regularity',
  'trainer-attention',
])

function recordId(change: ClientRealtimeChange, key: string): string | undefined {
  const value = change.new[key] ?? change.old[key]
  return typeof value === 'string' ? value : undefined
}

export async function applyClientRealtimeChanges(
  queryClient: QueryClient,
  clientId: string,
  changes: readonly ClientRealtimeChange[],
) {
  const tables = new Set(changes.map((change) => change.table))
  const tasks: Array<Promise<unknown>> = []

  if (tables.has('clients')) {
    tasks.push(
      queryClient.invalidateQueries({ queryKey: ['my-client'] }),
      queryClient.invalidateQueries({ queryKey: ['client', clientId] }),
      queryClient.invalidateQueries({ queryKey: ['clients'] }),
    )
  }

  const workoutTables: ClientRealtimeTable[] = ['workouts', 'workout_exercises', 'workout_sets']
  if (workoutTables.some((table) => tables.has(table))) {
    tasks.push(
      queryClient.invalidateQueries({ queryKey: ['workouts'] }),
      queryClient.invalidateQueries({ queryKey: ['client-stats', clientId] }),
      queryClient.invalidateQueries({ queryKey: ['exercise-history', clientId] }),
      queryClient.invalidateQueries({ queryKey: ['workout-regularity', clientId] }),
      queryClient.invalidateQueries({ queryKey: ['trainer-attention'] }),
    )
    const workoutIds = new Set(
      changes.flatMap((change) => {
        if (change.table === 'workouts') return [recordId(change, 'id')]
        if (change.table === 'workout_exercises') return [recordId(change, 'workout_id')]
        return []
      }).filter((id): id is string => Boolean(id)),
    )
    for (const workoutId of workoutIds) {
      tasks.push(queryClient.invalidateQueries({ queryKey: ['workout', workoutId] }))
    }
    if (tables.has('workout_sets')) {
      tasks.push(queryClient.invalidateQueries({ queryKey: ['workout'] }))
    }
  }

  if (tables.has('client_progress') || tables.has('client_progress_custom')) {
    tasks.push(
      queryClient.invalidateQueries({ queryKey: ['progress', clientId] }),
      queryClient.invalidateQueries({ queryKey: ['my-client'] }),
      queryClient.invalidateQueries({ queryKey: ['client', clientId] }),
      queryClient.invalidateQueries({ queryKey: ['clients'] }),
    )
  }

  if (tables.has('client_custom_metrics')) {
    tasks.push(queryClient.invalidateQueries({ queryKey: ['metrics', clientId] }))
  }

  if (tables.has('client_goals') || tables.has('goal_stages')) {
    tasks.push(
      queryClient.invalidateQueries({ queryKey: ['client-goal', clientId] }),
      queryClient.invalidateQueries({ queryKey: ['client', clientId] }),
      queryClient.invalidateQueries({ queryKey: ['workouts'] }),
      queryClient.invalidateQueries({ queryKey: ['workout'] }),
    )
  }

  if (tables.has('client_trainers') || tables.has('client_invitations')) {
    tasks.push(
      queryClient.invalidateQueries({ queryKey: ['client-trainers', clientId] }),
      queryClient.invalidateQueries({ queryKey: ['client-invitations', clientId] }),
      queryClient.invalidateQueries({ queryKey: ['my-client'] }),
      queryClient.invalidateQueries({ queryKey: ['clients'] }),
    )
  }

  if (tables.has('client_training_summaries') || tables.has('client_published_training_summaries')) {
    tasks.push(
      queryClient.invalidateQueries({ queryKey: ['training-summaries', 'trainer', clientId] }),
      queryClient.invalidateQueries({ queryKey: ['training-summaries', 'client', clientId] }),
    )
  }

  await Promise.all(tasks)
}

export async function refetchClientSpace(queryClient: QueryClient, clientId: string) {
  await queryClient.invalidateQueries({
    predicate: (query) => {
      const [root] = query.queryKey
      if (typeof root !== 'string' || !clientSpaceRoots.has(root)) return false
      if (root === 'clients' || root === 'workouts' || root === 'workout') return true
      return query.queryKey.includes(clientId)
    },
    refetchType: 'active',
  })
}

export function useClientRealtime(clientId: string | undefined) {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!clientId) return

    let unsubscribe: (() => void) | undefined
    let debounceTimer: ReturnType<typeof setTimeout> | undefined
    let changes: ClientRealtimeChange[] = []
    let stopped = false

    const flush = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = undefined
      const pending = changes
      changes = []
      if (pending.length) void applyClientRealtimeChanges(queryClient, clientId, pending)
    }
    const subscribe = () => {
      if (unsubscribe || stopped || document.visibilityState === 'hidden') return
      unsubscribe = realtimeRepository.subscribeToClientChanges(clientId, (change) => {
        changes.push(change)
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(flush, REALTIME_DEBOUNCE_MS)
      }, () => {
        // Изменение могло произойти между первым render и фактическим
        // SUBSCRIBED. Одно серверное сравнение при готовности закрывает это
        // окно, а последующие изменения уже приходят обычными событиями.
        void refetchClientSpace(queryClient, clientId)
      })
    }
    const disconnect = () => {
      unsubscribe?.()
      unsubscribe = undefined
      flush()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        disconnect()
        return
      }
      void refetchClientSpace(queryClient, clientId)
      subscribe()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    subscribe()
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      disconnect()
    }
  }, [clientId, queryClient])
}
