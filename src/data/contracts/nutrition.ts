import type { LocalDate } from '../../shared/local-date'
import type { NutritionConnection, NutritionDay, NutritionDraft, NutritionEntry, NutritionFood } from '../../shared/nutrition'

export interface NutritionRepository {
  day(day: LocalDate, clientId?: string): Promise<NutritionDay>
  search(query: string, page: number): Promise<{ foods: NutritionFood[]; hasMore: boolean }>
  barcode(code: string): Promise<NutritionFood | null>
  recent(): Promise<NutritionEntry[]>
  save(draft: NutritionDraft): Promise<NutritionEntry>
  setDeleted(entryId: string, expectedVersion: number, deleted: boolean): Promise<NutritionEntry>
  consents(): Promise<NutritionConnection[]>
  setConsent(connection: NutritionConnection, granted: boolean): Promise<void>
}
