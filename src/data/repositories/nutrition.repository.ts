import type { LocalDate } from '../../shared/local-date'
import type { NutritionConnection, NutritionDay, NutritionDraft, NutritionEntry, NutritionFood } from '../../shared/nutrition'
import { RepositoryError } from './error'

export interface NutritionRepository {
  day(day: LocalDate, clientId?: string): Promise<NutritionDay>
  search(query: string, page: number): Promise<{ foods: NutritionFood[]; hasMore: boolean }>
  recent(): Promise<NutritionEntry[]>
  save(draft: NutritionDraft): Promise<NutritionEntry>
  setDeleted(entryId: string, expectedVersion: number, deleted: boolean): Promise<NutritionEntry>
  consents(): Promise<NutritionConnection[]>
  setConsent(connection: NutritionConnection, granted: boolean): Promise<void>
}
// Unsupported test/legacy composition must not create a second production path.
const unavailable = () => Promise.reject(new RepositoryError('nutrition_unavailable', 'Дневник питания сейчас недоступен.'))
export const unsupportedNutritionRepository: NutritionRepository = {
  day: unavailable, search: unavailable, recent: unavailable, save: unavailable,
  setDeleted: unavailable, consents: unavailable, setConsent: unavailable,
}
