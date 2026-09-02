export const GOAL_TITLE_MAX_LENGTH = 200
export const GOAL_STAGE_TITLE_MAX_LENGTH = 120

export function titleLengthValidation(value: string, label: string, maxLength: number): true | string {
  return value.length <= maxLength || `${label} — не более ${maxLength} символов`
}
