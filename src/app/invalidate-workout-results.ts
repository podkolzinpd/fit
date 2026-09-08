import type { QueryClient } from '@tanstack/react-query'

/** All derived views must forget results after a confirmed save/edit/delete. */
export async function invalidateWorkoutResults(client: QueryClient) {
  await Promise.all(['workouts', 'workout-personal-records', 'exercise-history', 'client-stats',
    'workout-regularity', 'client-progress-story-workouts', 'trainer-progress-story-workouts',
    'training-summary-first-workout', 'training-summaries'].map((root) => client.invalidateQueries({ queryKey: [root] })))
}
