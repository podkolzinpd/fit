import type { TrainerCatalogFilters, TrainerProfileDraft, TrainerProfessionalProfile } from '../../shared/domain'
import { parseTrainerProfile } from '../../shared/trainer-profile'
import { getYandexMainRoutingConfig } from '../../app/feature-flags'
import { supabase } from '../queries/client'
import { toJson } from '../queries/json'
import { repositoryError } from './error'

export interface TrainerProfilesRepository {
  getOwn(): Promise<TrainerProfessionalProfile | null>
  saveDraft(draft: TrainerProfileDraft): Promise<TrainerProfessionalProfile>
  publish(): Promise<TrainerProfessionalProfile>
  unpublish(): Promise<TrainerProfessionalProfile>
  setCatalogListing(listed: boolean): Promise<TrainerProfessionalProfile>
  listCatalog(filters: TrainerCatalogFilters): Promise<TrainerProfessionalProfile[]>
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
  async listCatalog(filters) {
    const result = await supabase.rpc('list_public_trainer_profiles', {
      p_query: filters.query || undefined,
      p_specialty: filters.specialty || undefined,
      p_city: filters.city || undefined,
      p_mode: filters.mode || undefined,
      p_accepting_clients: filters.acceptingClients ?? undefined,
    })
    if (result.error) throw repositoryError(result.error)
    return (result.data ?? []).map(parseTrainerProfile)
  },
}

async function readYandexPublicProfile(publicId: string): Promise<TrainerProfessionalProfile | null | undefined> {
  const config = getYandexMainRoutingConfig()
  if (config === null) return undefined
  let response: Response
  try {
    response = await fetch(`${config.apiBaseUrl}/v1/trainers/${encodeURIComponent(publicId)}/public-profile`)
  } catch {
    return undefined
  }
  if (!response.ok) return undefined
  return parseTrainerProfile(await response.json())
}

const publicProfileRequests = new Map<string, Promise<TrainerProfessionalProfile | null>>()

export function forgetPublicTrainerProfile(publicId: string) {
  publicProfileRequests.delete(publicId)
}

async function loadPublicTrainerProfile(publicId: string): Promise<TrainerProfessionalProfile | null> {
  const result = await supabase.rpc('get_public_trainer_profile', { p_public_id: publicId })
  if (result.error) throw repositoryError(result.error)
  const supabaseProfile = parseNullable(result.data)
  if (supabaseProfile !== null) return supabaseProfile
  return (await readYandexPublicProfile(publicId)) ?? null
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
