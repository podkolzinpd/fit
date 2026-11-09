/** Current API supplies the active-connection capability; old DTOs still require an account. */
export function isWorkoutClient(client: { hasAccount: boolean | null; archivedAt: string | null; canCreateWorkout?: boolean }): boolean {
  return client.hasAccount === true && !client.archivedAt && client.canCreateWorkout !== false
}
