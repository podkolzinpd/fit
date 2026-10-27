export interface CorporateOffice {
  id: string
  city: string
  name: string
  address: string
  archived: boolean
  version: number
}
export interface CorporateTrainer {
  id: string
  name: string
  isYandex: boolean
  officeIds: string[]
  version: number
}
export interface CorporateAdminBundle {
  offices: CorporateOffice[]
  trainers: CorporateTrainer[]
}
