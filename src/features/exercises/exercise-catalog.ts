import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../app/auth-context'
import { useDataBackend } from '../../app/data-backend-context'
import type { CustomExerciseDraft } from '../../data/repositories/exercises.repository'
import type { PreparedImage } from '../../shared/image-prep'
import type { ExerciseSnapshot, SessionActor } from '../../shared/domain'

export interface ExerciseCatalogState {
  userId?: string
  exercises: readonly ExerciseSnapshot[]
  loading: boolean
  error: Error | null
  saving: boolean
  retry: () => void
  create: (value: CustomExerciseDraft, photo?: PreparedImage | null) => Promise<ExerciseSnapshot>
}

export function customExercisePartitionOwner(actor: SessionActor): string {
  return actor.kind === 'client' ? actor.trainerId : actor.userId
}

export function useExerciseCatalog(): ExerciseCatalogState {
  const { exercises: exercisesRepository } = useDataBackend()
  const { actor } = useAuth()
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['exercises'], queryFn: () => exercisesRepository.list() })
  const create = useMutation({
    mutationFn: ({ value, photo }: { value: CustomExerciseDraft; photo?: PreparedImage | null }) =>
      exercisesRepository.create(customExercisePartitionOwner(actor!), actor!.userId, value, photo),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['exercises'] }),
  })
  return {
    userId: actor?.userId,
    exercises: [...exercisesRepository.system, ...(query.data?.filter((item) => !item.archivedAt) ?? [])],
    loading: query.isLoading,
    error: query.error ?? create.error,
    saving: create.isPending,
    retry: () => void query.refetch(),
    create: (value, photo) => create.mutateAsync({ value, photo }),
  }
}
