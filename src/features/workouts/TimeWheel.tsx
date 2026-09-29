import { useLayoutEffect, useRef } from 'react'

const WHEEL_ROW_HEIGHT = 44

// Shared by rest and exercise duration pickers. Keep the selected value in sync
// with the physical scroll position so an immediate confirmation cannot save
// the previous value after a short iOS flick.
export function TimeWheel({ label, value, values, disabled = false, onChange }: {
  label: string
  value: number
  values: number[]
  disabled?: boolean
  onChange: (value: number) => void
}) {
  const wheel = useRef<HTMLDivElement>(null)
  const selectedIndex = Math.max(0, values.indexOf(value))

  useLayoutEffect(() => {
    if (!wheel.current) return
    wheel.current.scrollTop = selectedIndex * WHEEL_ROW_HEIGHT
  }, [selectedIndex])

  function select(index: number) {
    const nextIndex = Math.min(values.length - 1, Math.max(0, index))
    const next = values[nextIndex] ?? values[0] ?? 0
    if (next !== value) onChange(next)
    wheel.current?.scrollTo?.({ top: nextIndex * WHEEL_ROW_HEIGHT, behavior: 'smooth' })
  }

  return <div className={`rest-time-wheel-field${disabled ? ' disabled' : ''}`}>
    <span>{label}</span>
    <div
      ref={wheel}
      className="rest-time-wheel"
      role="listbox"
      aria-label={label}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onScroll={() => {
        if (disabled) return
        const index = Math.min(values.length - 1, Math.max(0, Math.round((wheel.current?.scrollTop ?? 0) / WHEEL_ROW_HEIGHT)))
        const next = values[index] ?? values[0] ?? 0
        if (next !== value) onChange(next)
      }}
      onKeyDown={(event) => {
        if (disabled) return
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') event.preventDefault()
        if (event.key === 'ArrowDown') select(selectedIndex + 1)
        if (event.key === 'ArrowUp') select(selectedIndex - 1)
        if (event.key === 'Home') select(0)
        if (event.key === 'End') select(values.length - 1)
      }}
    >
      <div className="rest-time-wheel-spacer" aria-hidden="true" />
      {values.map((item, index) => <div
        key={item}
        className={item === value ? 'selected' : ''}
        role="option"
        aria-selected={item === value}
        aria-label={`${String(item).padStart(2, '0')} ${label}`}
        onClick={() => { if (!disabled) select(index) }}
      >{String(item).padStart(2, '0')}</div>)}
      <div className="rest-time-wheel-spacer" aria-hidden="true" />
    </div>
  </div>
}
