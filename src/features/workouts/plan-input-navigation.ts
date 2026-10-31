/** Enter advances a numeric/text plan field, never the surrounding save form.
 * Textareas retain newlines; dialogs and their explicit buttons own their keys. */
import { keepWorkoutFieldVisible } from './workout-field-visibility'

export function advancePlanField(input: HTMLInputElement, form: HTMLFormElement): void {
  const fields = [...form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled)')]
    .filter((field) => field.getClientRects().length > 0)
  const index = fields.indexOf(input)
  if (index < 0) return
  const next = fields[index + 1]
  if (!next) { input.blur(); return }
  next.focus({ preventScroll: true })
  keepWorkoutFieldVisible(next)
}
