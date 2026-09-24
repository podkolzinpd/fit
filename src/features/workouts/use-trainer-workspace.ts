import { useQuery } from '@tanstack/react-query'

import { useAuth } from '../../app/auth-context'
import { useDataBackend } from '../../app/data-backend-context'

export const TRAINER_WORKSPACE_QUERY_KEY = ['trainer-workspace'] as const

export function useTrainerWorkspace(enabled = true) {
  const { actor } = useAuth()
  const { trainerWorkspace } = useDataBackend()
  return useQuery({
    queryKey: [...TRAINER_WORKSPACE_QUERY_KEY, actor?.userId],
    queryFn: () => trainerWorkspace.read(),
    enabled: enabled && actor?.role === 'trainer' && actor.experiments?.trainerScheduleV2 === true,
    refetchInterval: 60_000,
    refetchOnMount: 'always',
  })
}
