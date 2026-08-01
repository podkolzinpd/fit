/** Допустимые значения совпадают с ограничением workout_sets_rpe_valid в БД. */
export const RPE_OPTIONS = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10] as const

export function isValidRpe(value: number | undefined): value is (typeof RPE_OPTIONS)[number] {
  return value !== undefined && RPE_OPTIONS.some((option) => option === value)
}
