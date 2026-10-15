import type { TrainerCatalogFilters, TrainerCatalogPage, TrainerCatalogPageOptions, TrainerProfileDraft, TrainerProfilePhotoUpload, TrainerProfessionalProfile } from '../../shared/domain'
import { expandSpecialtiesForCatalogSearch, parseLegacyTrainerCatalogPage, parseTrainerProfile } from '../../shared/trainer-profile'
import { supabase } from '../queries/client'
import { toJson } from '../queries/json'
import { RepositoryError, repositoryError } from './error'

export interface TrainerProfilesRepository {
  getOwn(): Promise<TrainerProfessionalProfile | null>
  saveDraft(draft: TrainerProfileDraft): Promise<TrainerProfessionalProfile>
  uploadPhoto(draft: TrainerProfileDraft, photo: TrainerProfilePhotoUpload, replaceLegacy?: boolean): Promise<TrainerProfessionalProfile>
  reorderPhotos(photoIds: string[]): Promise<TrainerProfessionalProfile>
  deletePhoto(photoId: string): Promise<TrainerProfessionalProfile>
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
  async uploadPhoto(draft, photo) {
    // Local/Supabase development keeps its existing single-photo contract.
    // Production uses the Yandex repository and the three-photo gallery.
    const result = await supabase.rpc('save_trainer_profile_draft', {
      p_draft: toJson({ ...draft, avatarDataUrl: photo.image.dataUrl, photos: [] }),
    })
    if (result.error) throw repositoryError(result.error)
    return parseTrainerProfile(result.data)
  },
  reorderPhotos() {
    return Promise.reject(new RepositoryError('service_unavailable', 'Галерея временно недоступна. Попробуйте позднее.'))
  },
  deletePhoto() {
    return Promise.reject(new RepositoryError('service_unavailable', 'Галерея временно недоступна. Попробуйте позднее.'))
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
      p_specialties: filters.specialties.length ? expandSpecialtiesForCatalogSearch(filters.specialties) : undefined,
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

export { forgetPublicTrainerProfile, getPublicTrainerProfile } from './public-trainer-profile.repository'
