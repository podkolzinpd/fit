/** The server capability includes trainer-owned cards without an account. */
export function isWorkoutClient(client: { hasAccount: boolean | null; archivedAt: string | null; canCreateWorkout?: boolean }): boolean {
  return !client.archivedAt && (client.canCreateWorkout ?? client.hasAccount === true)
}
