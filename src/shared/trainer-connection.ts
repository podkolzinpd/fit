export interface TrainerConnectionOffer {
  source: 'link' | 'code' | 'chat'
  locator: string
}
export interface TrainerConnectionPreview {
  clientId: string
  currentRelationshipId: string | null
  currentTrainer: { id: string; name: string } | null
  trainer: { id: string; name: string }
  offerVersion: string
  mergeVersion?: string
  mergeConflicts?: ClientMergeConflict[]
}
export interface ClientMergeConflict {
  key: string
  label: string
  account: unknown
  card: unknown
}
export interface TrainerConnectionConfirmation extends TrainerConnectionOffer {
  shareHistory?: boolean
  shareSoloHistory?: boolean
  expectedRelationshipId: string | null
  offerVersion: string
  operationId: string
  mergeVersion?: string
  mergeChoices?: Record<string, 'account' | 'card'>
}
export interface TrainerConnectionsRepository {
  preview(offer: TrainerConnectionOffer): Promise<TrainerConnectionPreview>
  confirm(draft: TrainerConnectionConfirmation): Promise<string>
}
