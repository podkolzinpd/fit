import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { realtimeRepository } from '../data/repositories/realtime.repository'

export function useClientRealtime(clientId: string | undefined) {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!clientId) return
    return realtimeRepository.subscribeToClientChanges(clientId, () => {
      void queryClient.invalidateQueries({ queryKey: ['my-client'] })
      void queryClient.invalidateQueries({ queryKey: ['client', clientId] })
      void queryClient.invalidateQueries({ queryKey: ['workouts'] })
      void queryClient.invalidateQueries({ queryKey: ['progress', clientId] })
      void queryClient.invalidateQueries({ queryKey: ['metrics', clientId] })
    })
  }, [clientId, queryClient])
}
