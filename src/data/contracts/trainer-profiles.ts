import type { TrainerProfileManagement, TrainerProfileWriteContext, TrainerCatalogFilters, TrainerCatalogPage, TrainerCatalogPageOptions, TrainerProfileDraft, TrainerProfilePhotoUpload, TrainerProfessionalProfile } from '../../shared/domain'

export interface TrainerProfilesRepository {
  getManagement?(): Promise<TrainerProfileManagement>
  getOwn(): Promise<TrainerProfessionalProfile | null>
  saveDraft(draft: TrainerProfileDraft, context?: TrainerProfileWriteContext): Promise<TrainerProfessionalProfile>
  uploadPhoto(draft: TrainerProfileDraft, photo: TrainerProfilePhotoUpload, replaceLegacy?: boolean, context?: TrainerProfileWriteContext): Promise<TrainerProfessionalProfile>
  reorderPhotos(photoIds: string[], context?: TrainerProfileWriteContext): Promise<TrainerProfessionalProfile>
  deletePhoto(photoId: string, context?: TrainerProfileWriteContext): Promise<TrainerProfessionalProfile>
  publish(context?: TrainerProfileWriteContext): Promise<TrainerProfessionalProfile>
  unpublish(context?: TrainerProfileWriteContext): Promise<TrainerProfessionalProfile>
  setCatalogListing(listed: boolean, context?: TrainerProfileWriteContext): Promise<TrainerProfessionalProfile>
  listCatalog(filters: TrainerCatalogFilters, page: TrainerCatalogPageOptions): Promise<TrainerCatalogPage>
}

export type TrainerProfileEditorRepository = Omit<TrainerProfilesRepository, 'listCatalog'>
