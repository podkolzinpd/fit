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
}
export interface TrainerConnectionConfirmation extends TrainerConnectionOffer {
  expectedRelationshipId: string | null
  offerVersion: string
  operationId: string
}
export interface TrainerConnectionsRepository {
  preview(offer: TrainerConnectionOffer): Promise<TrainerConnectionPreview>
  confirm(draft: TrainerConnectionConfirmation): Promise<string>
}
