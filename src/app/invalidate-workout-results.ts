import type { QueryClient } from '@tanstack/react-query'

/** All derived views must forget results after a confirmed save/edit/delete. */
export async function invalidateWorkoutResults(client: QueryClient) {
  const roots = ['workouts', 'workout-home', 'workout-personal-records', 'exercise-history', 'client-stats',
    'workout-regularity', 'client-progress-story-workouts', 'trainer-progress-story-workouts',
    'training-summary-first-workout', 'training-summaries', 'trainer-workspace']
  // Inactive reads are not refetched by invalidation. Cancel their old snapshots
  // first so a late response cannot make pre-save data fresh again on Back.
  await Promise.all(roots.map((root) => client.cancelQueries({ queryKey: [root], type: 'inactive' })))
  await Promise.all(roots.map((root) => client.invalidateQueries({ queryKey: [root] })))
}
