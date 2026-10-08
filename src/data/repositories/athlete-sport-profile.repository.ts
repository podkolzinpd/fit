import type { CreateClientInput } from '../../shared/domain'
import type { AthleteSportProfile } from '../../shared/sport-interests'
import { clientsRepository } from './clients.repository'
import { progressRepository } from './progress.repository'

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

export const athleteSportProfileRepository: AthleteSportProfileRepository = {
  supportsSportInterests: false,
  // Legacy local harness: preserve the existing self-profile flow without
  // pretending that optional Yandex-only interests have been persisted.
  getMine: () => Promise.resolve({ sports: [], bio: null }),
  saveOwn: async (input) => {
    if (input.sport.sports.length > 0 || input.sport.bio) {
      throw new Error('Спортивные интересы доступны после входа через Yandex ID.')
    }
    if (input.clientId === null) return clientsRepository.createOwn(input.client)
    if (input.expectedVersion === null) throw new Error('Версия профиля не указана')
    const { initialWeightKg, initialWeightRecordedOn, ...client } = input.client
    await clientsRepository.updateOwn({ ...client, id: input.clientId, version: input.expectedVersion })
    if (initialWeightKg !== undefined && initialWeightRecordedOn !== undefined) {
      await progressRepository.save({ clientId: input.clientId, recordedOn: initialWeightRecordedOn,
        weightKg: initialWeightKg, customMetrics: [] })
    }
    return input.clientId
  },
}
