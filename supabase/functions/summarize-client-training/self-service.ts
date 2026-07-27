export type SummaryClientLink = {
  id: string
  trainer_id: string
  auth_user_id: string | null
}

export type SummaryActor = {
  isTrainer: boolean
  isClient: boolean
  trainerId: string
}

export function authorizeSummaryActor(
  actorId: string,
  client: SummaryClientLink | null,
): SummaryActor | null {
  if (!client) return null
  const isTrainer = client.trainer_id === actorId
  const isClient = client.auth_user_id === actorId
  if (!isTrainer && !isClient) return null
  return { isTrainer, isClient, trainerId: client.trainer_id }
}

export function shouldUseClientCache(
  force: boolean,
  cached: unknown,
): boolean {
  return !force && cached !== null && cached !== undefined
}

export function hasCompletedWorkouts(
  workouts: ReadonlyArray<unknown>,
): boolean {
  return workouts.length > 0
}

export function yandexHttpError(status: number, body: string): string {
  const detail = body.trim().replace(/\s+/g, " ").slice(0, 180)
  return detail ? `yandex_cloud_error_${status}:${detail}` : `yandex_cloud_error_${status}`
}

export function parseYandexJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error("yandex_cloud_invalid_json")
  }
}

export function clientVisibleSummary<T extends Record<string, unknown>>(
  row: T,
): Omit<T, "trainer_summary" | "input_fingerprint" | "token_usage"> {
  const {
    trainer_summary: _trainerSummary,
    input_fingerprint: _fingerprint,
    token_usage: _tokenUsage,
    ...visible
  } = row
  return visible
}
