import type { TrainerProfessionalProfile } from '../../shared/domain'
import { parseTrainerProfile } from '../../shared/trainer-profile'
import { getYandexMainRoutingConfig } from '../../app/feature-flags'
import { localPublicTrainerProfileQuery, publicTrainerProfileQuery } from '../queries/public-trainer-profile.queries'
import { RepositoryError, repositoryError } from './error'

async function readYandexPublicProfile(publicId: string, apiBaseUrl: string): Promise<TrainerProfessionalProfile | null> {
  let response: Response
  try {
    response = await publicTrainerProfileQuery(publicId, apiBaseUrl)
  } catch (error) {
    throw repositoryError(error)
  }
  if (response.status === 404) return null
  if (!response.ok) {
    throw new RepositoryError(
      response.status >= 500 ? 'service_unavailable' : 'request_failed',
      response.status >= 500
        ? 'Yandex Cloud временно недоступен. Попробуйте позднее.'
        : 'Не удалось открыть анкету. Попробуйте ещё раз.',
    )
  }
  try {
    return parseTrainerProfile(await response.json())
  } catch (error) {
    throw new RepositoryError('invalid_response', 'Не удалось открыть анкету. Попробуйте ещё раз.', { cause: error })
  }
}

const PUBLIC_PROFILE_CACHE_TTL_MS = 45 * 60 * 1_000
const publicProfileRequests = new Map<string, {
  expiresAt: number
  request: Promise<TrainerProfessionalProfile | null>
}>()

export function forgetPublicTrainerProfile(publicId: string) {
  publicProfileRequests.delete(publicId)
}

async function loadPublicTrainerProfile(publicId: string): Promise<TrainerProfessionalProfile | null> {
  const yandex = getYandexMainRoutingConfig()
  if (yandex !== null) return readYandexPublicProfile(publicId, yandex.apiBaseUrl)

  const result = await localPublicTrainerProfileQuery(publicId)
  if (result.error) throw repositoryError(result.error)
  return result.data === null ? null : parseTrainerProfile(result.data)
}

export function getPublicTrainerProfile(publicId: string, options: { fresh?: boolean } = {}): Promise<TrainerProfessionalProfile | null> {
  if (options.fresh) publicProfileRequests.delete(publicId)
  const existing = publicProfileRequests.get(publicId)
  if (existing && existing.expiresAt > Date.now()) return existing.request
  if (existing) publicProfileRequests.delete(publicId)
  const request = loadPublicTrainerProfile(publicId).catch((error: unknown) => {
    if (publicProfileRequests.get(publicId)?.request === request) publicProfileRequests.delete(publicId)
    throw error
  })
  publicProfileRequests.set(publicId, { expiresAt: Date.now() + PUBLIC_PROFILE_CACHE_TTL_MS, request })
  return request
}
