import { useEffect, useRef } from 'react'
import { prepareZeroReplacement } from '../../shared/numeric-input'

export function liveNumberValue(value: FormDataEntryValue | null): number | undefined {
  return value === null || value === '' ? undefined : Number(String(value).replace(',', '.'))
}

export function focusNextLiveField(input: HTMLElement): void {
  const root = input.closest('.live-workout-page')
  if (!root) return
  const coach = root.classList.contains('coach-live-v79')
  const fields = [...root.querySelectorAll<HTMLElement>('input.live-set-input:not(:disabled):not([type="hidden"]), select.live-set-rpe:not(:disabled)')]
    // Retained coach rounds have rectangles even while clipped and inert.
    // Leave the existing client/legacy navigation contract unchanged.
    .filter((field) => field.getClientRects().length > 0 && (!coach || !field.closest('[inert]')))
  const index = fields.indexOf(input)
  if (index >= 0) fields[index + 1]?.focus({ preventScroll: true })
}

/** Text + inputMode permits reliable whole-value selection in iOS Safari.
 * Native number controls remain unchanged outside the released Lime UI. */
export function LiveSetInput({ name, label, placeholder, defaultValue, step, disabled, inputKey, decimal = false, planHint = false, selectZero = false, directInput = false, className = 'live-set-input', onValueChange }: {
  name: string; label: string; placeholder: string; defaultValue: number | undefined
  step: number | 'any'; disabled: boolean; inputKey: string; decimal?: boolean
  planHint?: boolean; selectZero?: boolean; directInput?: boolean
  className?: string
  /** Plan forms opt in to numeric drafts; Live continues to use its form coordinator. */
  onValueChange?: (value: number | undefined) => void
}) {
  const selectAfterPointer = useRef(false)
  const field = useRef<HTMLInputElement>(null)
  const dirty = useRef(false)
  useEffect(() => {
    const input = field.current
    if (!directInput || !input) return
    if (liveNumberValue(input.value) === defaultValue) dirty.current = false
    else if (!dirty.current && document.activeElement !== input) input.value = String(defaultValue ?? '')
  }, [defaultValue, directInput])
  return <input ref={field} key={inputKey} className={`${className}${planHint ? ' plan-hint' : ''}`}
    aria-label={label} name={name} type={directInput ? 'text' : 'number'} data-live-direct={directInput || undefined}
    inputMode={decimal ? 'decimal' : 'numeric'} enterKeyHint={directInput ? 'next' : undefined}
    min={directInput ? undefined : '0'} step={directInput ? undefined : step}
    autoComplete="off" disabled={disabled} defaultValue={defaultValue} placeholder={placeholder}
    onFocus={(event) => {
      if (directInput) {
        const input = event.currentTarget
        selectAfterPointer.current = true
        input.select()
      }
      else if (selectZero) prepareZeroReplacement(event.currentTarget)
    }}
    onPointerDown={(event) => {
      if (!directInput || document.activeElement === event.currentTarget || event.button !== 0 || event.isPrimary === false) return
      // Focus inside the trusted gesture, then suppress the native caret
      // placement which otherwise overwrites select() in Linux/iOS WebKit.
      event.preventDefault()
      event.currentTarget.focus({ preventScroll: true })
      event.currentTarget.select()
    }}
    onMouseUp={(event) => { if (directInput && selectAfterPointer.current) event.preventDefault() }}
    onClick={(event) => {
      if (!directInput || !selectAfterPointer.current) return
      event.preventDefault()
      event.currentTarget.select()
      selectAfterPointer.current = false
    }}
    onBeforeInput={(event) => {
      if (directInput && selectAfterPointer.current) event.currentTarget.select()
      selectAfterPointer.current = false
    }}
    onBlur={() => { selectAfterPointer.current = false }}
    onKeyDown={(event) => {
      if (directInput && selectAfterPointer.current && event.key.length === 1) {
        event.currentTarget.select()
        selectAfterPointer.current = false
      }
      if (directInput && event.key === 'Enter') { event.preventDefault(); focusNextLiveField(event.currentTarget) }
    }}
    onInput={(event) => {
      const input = event.currentTarget
      selectAfterPointer.current = false
      dirty.current = true
      input.classList.remove('plan-hint')
      if (directInput) {
        const valid = input.value === '' || (decimal ? /^\d+(?:[.,]\d+)?$/ : /^\d+$/).test(input.value)
          && (!onValueChange || Number.isFinite(liveNumberValue(input.value)))
        input.setCustomValidity(valid ? '' : decimal ? 'Введите неотрицательное число' : 'Введите целое неотрицательное число')
        if (valid) onValueChange?.(liveNumberValue(input.value))
      }
    }} />
}
