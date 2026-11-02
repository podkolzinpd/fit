import type { CreateClientInput } from '../../shared/domain'
import type { AthleteSportProfile } from '../../shared/sport-interests'

export interface SaveOwnAthleteProfileInput {
  clientId: string | null
  expectedVersion: number | null
  client: CreateClientInput
  sport: AthleteSportProfile
}

export interface AthleteSportProfileRepository {
  readonly supportsSportInterests: boolean
  getMine(): Promise<AthleteSportProfile>
  saveOwn(input: SaveOwnAthleteProfileInput): Promise<string>
}
