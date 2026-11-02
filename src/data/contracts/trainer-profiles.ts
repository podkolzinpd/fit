import type { TrainerCatalogFilters, TrainerCatalogPage, TrainerCatalogPageOptions, TrainerProfileDraft, TrainerProfilePhotoUpload, TrainerProfessionalProfile } from '../../shared/domain'

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
