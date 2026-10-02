import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useWorkoutTimeWheel } from '../../app/workout-time-input'
import { CloseIcon } from '../../shared/icons'
import { TimeWheel } from './TimeWheel'

const SECONDS = Array.from({ length: 60 }, (_, index) => index)
const DEFAULT_MAX_MINUTES = 999

function durationParts(value: number | undefined) {
  if (value === undefined) return { minutes: '', seconds: '' }
  return { minutes: String(Math.floor(value / 60)), seconds: String(value % 60).padStart(2, '0') }
}

export function formatWorkoutDuration(seconds: number | undefined): string {
  if (seconds === undefined) return 'Добавить время'
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** A set duration is always stored as seconds; keyboard and wheel are presentation only. */
export function WorkoutDurationField({ durationSec, onCommit, name, label, className = '', disabled = false, planHint = false, compact = false }: {
  durationSec?: number
  onCommit?: (seconds: number | undefined) => void
  name?: string
  label: string
  className?: string
  disabled?: boolean
  planHint?: boolean
  compact?: boolean
}) {
  const wheelEnabled = useWorkoutTimeWheel()
  const pickerEnabled = wheelEnabled || compact
  const [current, setCurrent] = useState(durationSec)
  const [parts, setParts] = useState(() => durationParts(durationSec))
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(0)
  const draftRef = useRef(0)
  const partsGroup = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const minutes = Math.floor(draft / 60)
  const seconds = draft % 60
  const minuteValues = useMemo(() => Array.from({ length: Math.max(DEFAULT_MAX_MINUTES, Math.floor((current ?? 0) / 60)) + 1 }, (_, index) => index), [current])

  useEffect(() => {
    setCurrent(durationSec)
    if (!partsGroup.current?.contains(document.activeElement)) setParts(durationParts(durationSec))
  }, [durationSec])
  useEffect(() => {
    if (!open) return
    dialog.current?.querySelector<HTMLElement>('[role="listbox"]')?.focus({ preventScroll: true })
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
      if (event.key !== 'Tab' || !dialog.current) return
      const nodes = Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]'))
      const first = nodes[0], last = nodes.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); trigger.current?.focus({ preventScroll: true }) }
  }, [open])

  function commit(value: number | undefined, normalizeParts = true) {
    setCurrent(value)
    if (normalizeParts) setParts(durationParts(value))
    onCommit?.(value)
    // Live forms read FormData and listen for input to schedule the ordinary
    // autosave. The native hidden input keeps that path unchanged.
    if (input.current) {
      input.current.value = value === undefined ? '' : String(value)
      input.current.dispatchEvent(new Event('input', { bubbles: true }))
    }
    setOpen(false)
  }

  function openPicker() {
    const value = current ?? 0
    draftRef.current = value
    setDraft(value)
    setOpen(true)
  }

  function changeMinutes(value: number) {
    draftRef.current = value * 60 + draftRef.current % 60
    setDraft(draftRef.current)
  }

  function changeSeconds(value: number) {
    draftRef.current = Math.floor(draftRef.current / 60) * 60 + value
    setDraft(draftRef.current)
  }

  function changePart(part: 'minutes' | 'seconds', value: string) {
    if (!/^\d*$/.test(value) || value.length > 4) return
    setParts((previous) => ({ ...previous, [part]: value }))
  }

  function commitParts() {
    if (Number(parts.minutes) > DEFAULT_MAX_MINUTES || Number(parts.seconds) > 59) {
      setParts(durationParts(current))
      return
    }
    const value = parts.minutes === '' && parts.seconds === ''
      ? undefined
      : Number(parts.minutes || 0) * 60 + Number(parts.seconds || 0)
    if (value !== current) commit(value, false)
  }

  return <>
    {name && <input ref={input} type="hidden" name={name} value={current ?? ''} readOnly disabled={disabled} />}
    {pickerEnabled ? <button ref={trigger} type="button" className={`workout-duration-trigger ${className}${planHint ? ' plan-hint' : ''}`.trim()} aria-label={`${label}: ${current === undefined ? 'не указано' : formatWorkoutDuration(current)}`} disabled={disabled} onClick={openPicker}>{compact && current === undefined ? '—' : formatWorkoutDuration(current)}</button> : <div ref={partsGroup} className="workout-duration-parts" role="group" aria-label={label}>
      <label className="workout-duration-part">
        <input type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" className={`${className}${planHint ? ' plan-hint' : ''}`.trim()} aria-label={`${label}: минуты`} aria-invalid={Number(parts.minutes) > DEFAULT_MAX_MINUTES || undefined} placeholder="—" value={parts.minutes} disabled={disabled} onFocus={(event) => event.currentTarget.select()} onChange={(event) => changePart('minutes', event.target.value)} onBlur={commitParts} />
        <span>мин</span>
      </label>
      <label className="workout-duration-part">
        <input type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" className={`${className}${planHint ? ' plan-hint' : ''}`.trim()} aria-label={`${label}: секунды`} aria-invalid={Number(parts.seconds) > 59 || undefined} placeholder="—" value={parts.seconds} disabled={disabled} onFocus={(event) => event.currentTarget.select()} onChange={(event) => changePart('seconds', event.target.value)} onBlur={commitParts} />
        <span>сек</span>
      </label>
    </div>}
    {pickerEnabled && open && createPortal(<div className="sheet-overlay" onClick={() => setOpen(false)}>
      <section ref={dialog} className="workout-decision-sheet workout-duration-sheet" role="dialog" aria-modal="true" aria-label={label} onClick={(event) => event.stopPropagation()}>
        <header className="picker-header"><h2>{label}</h2><button type="button" className="picker-close" aria-label="Закрыть выбор времени" onClick={() => setOpen(false)}><CloseIcon /></button></header>
        <div className="rest-time-picker" aria-label="Минуты и секунды">
          <TimeWheel label="минуты" value={minutes} values={minuteValues} onChange={changeMinutes} />
          <span className="rest-time-separator" aria-hidden="true">:</span>
          <TimeWheel label="секунды" value={seconds} values={SECONDS} onChange={changeSeconds} />
        </div>
        <button type="button" className="workout-duration-apply primary" disabled={draft <= 0} onClick={() => commit(draftRef.current)}>Применить · {formatWorkoutDuration(draft)}</button>
        {current !== undefined && <button type="button" className="secondary" onClick={() => commit(undefined)}>Убрать время</button>}
      </section>
    </div>, document.querySelector('.phone-frame') ?? document.body)}
  </>
}
