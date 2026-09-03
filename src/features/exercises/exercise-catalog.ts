import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../app/auth-context'
import { exercisesRepository } from '../../data/repositories/exercises.repository'
import type { ExerciseSnapshot, InputKind, MuscleGroup, SessionActor } from '../../shared/domain'

export interface ExerciseCatalogState {
  exercises: readonly ExerciseSnapshot[]
  loading: boolean
  error: Error | null
  saving: boolean
  retry: () => void
  create: (value: { name: string; muscleGroup: MuscleGroup; inputKind: InputKind }) => Promise<ExerciseSnapshot>
}

export function customExercisePartitionOwner(actor: SessionActor): string {
  return actor.kind === 'client' ? actor.trainerId : actor.userId
}

export function useExerciseCatalog(): ExerciseCatalogState {
  const { actor } = useAuth()
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['exercises'], queryFn: () => exercisesRepository.list() })
  const create = useMutation({
    mutationFn: (value: { name: string; muscleGroup: MuscleGroup; inputKind: InputKind }) =>
      exercisesRepository.create(customExercisePartitionOwner(actor!), value),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['exercises'] }),
  })
  return {
    exercises: [...exercisesRepository.system, ...(query.data?.filter((item) => !item.archivedAt) ?? [])],
    loading: query.isLoading,
    error: query.error ?? create.error,
    saving: create.isPending,
    retry: () => void query.refetch(),
    create: (value) => create.mutateAsync(value),
  }
}
