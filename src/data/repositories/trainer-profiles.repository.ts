import type { TrainerCatalogFilters, TrainerCatalogPage, TrainerCatalogPageOptions, TrainerProfileDraft, TrainerProfessionalProfile } from '../../shared/domain'
import { parseLegacyTrainerCatalogPage, parseTrainerProfile } from '../../shared/trainer-profile'
import { getYandexMainRoutingConfig } from '../../app/feature-flags'
import { supabase } from '../queries/client'
import { toJson } from '../queries/json'
import { RepositoryError, repositoryError } from './error'

export interface TrainerProfilesRepository {
  getOwn(): Promise<TrainerProfessionalProfile | null>
  saveDraft(draft: TrainerProfileDraft): Promise<TrainerProfessionalProfile>
  publish(): Promise<TrainerProfessionalProfile>
  unpublish(): Promise<TrainerProfessionalProfile>
  setCatalogListing(listed: boolean): Promise<TrainerProfessionalProfile>
  listCatalog(filters: TrainerCatalogFilters, page: TrainerCatalogPageOptions): Promise<TrainerCatalogPage>
}

function parseNullable(value: unknown): TrainerProfessionalProfile | null {
  return value === null ? null : parseTrainerProfile(value)
}

export const trainerProfilesRepository: TrainerProfilesRepository = {
  async getOwn() {
    const result = await supabase.rpc('get_own_trainer_profile')
    if (result.error) throw repositoryError(result.error)
    return parseNullable(result.data)
  },
  async saveDraft(draft) {
    const result = await supabase.rpc('save_trainer_profile_draft', { p_draft: toJson(draft) })
    if (result.error) throw repositoryError(result.error)
    return parseTrainerProfile(result.data)
  },
  async publish() {
    const result = await supabase.rpc('publish_trainer_profile')
    if (result.error) throw repositoryError(result.error)
    return parseTrainerProfile(result.data)
  },
  async unpublish() {
    const result = await supabase.rpc('unpublish_trainer_profile')
    if (result.error) throw repositoryError(result.error)
    return parseTrainerProfile(result.data)
  },
  async setCatalogListing(listed) {
    const result = await supabase.rpc('set_trainer_profile_catalog_listing', { p_listed: listed })
    if (result.error) throw repositoryError(result.error)
    return parseTrainerProfile(result.data)
  },
  async listCatalog(filters, page) {
    const result = await supabase.rpc('list_public_trainer_profiles_page', {
      p_query: filters.query || undefined,
      p_specialties: filters.specialties.length ? filters.specialties : undefined,
      p_city: filters.city || undefined,
      p_metro_station_ids: filters.metroStationIds.length ? filters.metroStationIds : undefined,
      p_mode: filters.mode || undefined,
      p_accepting_clients: filters.acceptingClients ?? undefined,
      p_offset: page.offset,
      p_limit: page.limit,
      p_brand_trainer_only: filters.brandTrainerOnly || undefined,
    })
    if (result.error) throw repositoryError(result.error)
    return parseLegacyTrainerCatalogPage(result.data)
  },
}

async function readYandexPublicProfile(publicId: string, apiBaseUrl: string): Promise<TrainerProfessionalProfile | null> {
  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}/v1/trainers/${encodeURIComponent(publicId)}/public-profile`)
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

const publicProfileRequests = new Map<string, Promise<TrainerProfessionalProfile | null>>()

export function forgetPublicTrainerProfile(publicId: string) {
  publicProfileRequests.delete(publicId)
}

async function loadPublicTrainerProfile(publicId: string): Promise<TrainerProfessionalProfile | null> {
  const yandex = getYandexMainRoutingConfig()
  if (yandex !== null) return readYandexPublicProfile(publicId, yandex.apiBaseUrl)

  const result = await supabase.rpc('get_public_trainer_profile', { p_public_id: publicId })
  if (result.error) throw repositoryError(result.error)
  return parseNullable(result.data)
}

export function getPublicTrainerProfile(publicId: string): Promise<TrainerProfessionalProfile | null> {
  const existing = publicProfileRequests.get(publicId)
  if (existing) return existing
  const request = loadPublicTrainerProfile(publicId).catch((error: unknown) => {
    publicProfileRequests.delete(publicId)
    throw error
  })
  publicProfileRequests.set(publicId, request)
  return request
}
