import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CloseIcon } from '../../shared/icons'
import { coachWorkoutReferenceAssets } from '../../shared/coach-workout-reference-assets'
import { TimeWheel } from './TimeWheel'

const HOURS = Array.from({ length: 24 }, (_, index) => index)
const MINUTES = Array.from({ length: 60 }, (_, index) => index)
const format = (hours: number, minutes: number) => `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`

/** A time of day, not a set duration. Keep HH:mm and the existing form contract. */
type CoachPlanTimeFieldProps = {
  name: string; label: string; value: string
  referencePolish?: boolean
  onChange: (next: string, form: HTMLFormElement | null) => void
}

export function CoachPlanTimeField(props: CoachPlanTimeFieldProps) {
  return props.referencePolish ? <NativePlanTimeField {...props} /> : <LegacyPlanTimeField {...props} />
}

/** One native control covers both icon and value. Its popup belongs to the OS. */
function NativePlanTimeField({ name, label, value, onChange }: CoachPlanTimeFieldProps) {
  const input = useRef<HTMLInputElement>(null)
  function commit(next: string) {
    input.current?.setCustomValidity('')
    onChange(next, input.current?.form ?? null)
  }
  return <div className="coach-plan-time coach-plan-time-native">
    <label className="coach-plan-native-control">
      <img src={value ? coachWorkoutReferenceAssets.clock : coachWorkoutReferenceAssets.addMuted} alt="" width={24} height={24} />
      <span aria-hidden="true">{value || label}</span>
      <input ref={input} name={name} type="time" step={60} aria-label={label} value={value}
        onChange={(event) => commit(event.currentTarget.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur() } }} />
    </label>
    {value && <button type="button" className="coach-plan-time-clear" aria-label={`Убрать время: ${label}`} onClick={() => commit('')}><CloseIcon /></button>}
  </div>
}

function LegacyPlanTimeField({ name, label, value, onChange, referencePolish = false }: CoachPlanTimeFieldProps) {
  const [open, setOpen] = useState(false)
  const [hours, setHours] = useState(12)
  const [minutes, setMinutes] = useState(0)
  const draft = useRef({ hours: 12, minutes: 0 })
  const input = useRef<HTMLInputElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!open) return
    dialog.current?.querySelector<HTMLElement>('[role="listbox"]')?.focus({ preventScroll: true })
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
      if (event.key !== 'Tab' || !dialog.current) return
      const nodes = [...dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]')]
      const first = nodes[0], last = nodes.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); trigger.current?.focus({ preventScroll: true }) }
  }, [open])
  function commit(next: string) {
    input.current?.setCustomValidity('')
    onChange(next, input.current?.form ?? null)
  }
  return <div className="coach-plan-time">
    <button ref={trigger} type="button" className="coach-plan-time-label" aria-label={`Выбрать время: ${label}`} aria-haspopup="dialog" onClick={() => {
      draft.current = { hours: value ? Math.min(23, Number(value.slice(0, 2)) || 0) : 12, minutes: Math.min(59, Number(value.slice(3, 5)) || 0) }
      setHours(draft.current.hours); setMinutes(draft.current.minutes); setOpen(true)
    }}><img src={referencePolish ? coachWorkoutReferenceAssets.clock : coachWorkoutReferenceAssets.addMuted} alt="" width={24} height={24} />{!referencePolish && <span>{label}</span>}</button>
    <input ref={input} name={name} type="text" inputMode="numeric" autoComplete="off" aria-label={label}
      pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]" placeholder="ЧЧ:ММ" maxLength={5} value={value}
      onFocus={(event) => event.currentTarget.select()} onChange={(event) => {
        const raw = event.currentTarget.value.replace(/[^0-9:]/g, '')
        commit(raw.includes(':') ? raw : raw.length > 2 ? `${raw.slice(0, 2)}:${raw.slice(2, 4)}` : raw)
      }} />
    {referencePolish && <span className="coach-plan-time-caption" aria-hidden="true">{label}</span>}
    {open && createPortal(<div className="sheet-overlay" onClick={() => setOpen(false)}>
      <section ref={dialog} className="workout-decision-sheet workout-duration-sheet" role="dialog" aria-modal="true" aria-label={`Время: ${label}`} onClick={(event) => event.stopPropagation()}>
        <header className="picker-header"><h2>{label}</h2><button type="button" className="picker-close" aria-label="Закрыть выбор времени" onClick={() => setOpen(false)}><CloseIcon /></button></header>
        <div className="rest-time-picker" aria-label="Часы и минуты">
          <TimeWheel label="часы" value={hours} values={HOURS} onChange={(next) => { draft.current.hours = next; setHours(next) }} />
          <span className="rest-time-separator" aria-hidden="true">:</span>
          <TimeWheel label="минуты" value={minutes} values={MINUTES} onChange={(next) => { draft.current.minutes = next; setMinutes(next) }} />
        </div>
        <button type="button" className="primary wide" onClick={() => { commit(format(draft.current.hours, draft.current.minutes)); setOpen(false) }}>Применить время</button>
        {value && <button type="button" className="secondary wide" onClick={() => { commit(''); setOpen(false) }}>Убрать время</button>}
      </section>
    </div>, document.querySelector('.phone-frame') ?? document.body)}
  </div>
}
