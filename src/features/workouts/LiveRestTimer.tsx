import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CloseIcon, TimerIcon } from '../../shared/icons'
import { playGong, prepareGong } from '../../shared/gong'
import { wasNativeRestTimerNotificationScheduled } from './rest-timer-notification'

const WHEEL_ROW_HEIGHT = 44
const MINUTES = Array.from({ length: 61 }, (_, index) => index)
const SECONDS = Array.from({ length: 60 }, (_, index) => index)

export function formatRest(seconds: number): string {
  const sign = seconds < 0 ? '−' : ''
  const absolute = Math.abs(seconds)
  return `${sign}${Math.floor(absolute / 60)}:${String(absolute % 60).padStart(2, '0')}`
}

function gongStorageKey(workoutId: string, deadline: number) {
  return `fit:live-rest-gong:${workoutId}:${deadline}`
}

function gongWasPlayed(workoutId: string, deadline: number) {
  try { return sessionStorage.getItem(gongStorageKey(workoutId, deadline)) === '1' } catch { return false }
}

function markGongPlayed(workoutId: string, deadline: number) {
  try { sessionStorage.setItem(gongStorageKey(workoutId, deadline), '1') } catch { /* The timer remains usable without storage. */ }
}

function TimeWheel({ label, value, values, disabled = false, onChange }: {
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
        // Keep the selected value synchronous with the physical wheel. On iOS
        // a user can tap the primary action immediately after a short flick;
        // deferring this through requestAnimationFrame used to submit the old
        // duration in that narrow window.
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

/** Only this small subtree ticks; workout inputs do not rerender every second. */
export function LiveRestTimer({ workoutId, deadline, defaultDurationSeconds = 90, onChange, onDurationChange }: {
  workoutId: string
  deadline: number | null
  defaultDurationSeconds?: number
  onChange: (deadline: number | null) => void
  onDurationChange?: (seconds: number) => void
}) {
  const [now, setNow] = useState(Date.now)
  const [open, setOpen] = useState(false)
  const [minutes, setMinutes] = useState(1)
  const [seconds, setSeconds] = useState(30)
  const notified = useRef<number | null>(null)
  const backgrounded = useRef(document.visibilityState !== 'visible')
  const trigger = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLElement>(null)
  const selectedDurationRef = useRef(90)

  const signedRemaining = useMemo(() => {
    if (deadline === null) return null
    const difference = deadline - now
    if (difference >= 0) return Math.ceil(difference / 1000)
    const overdue = Math.floor(Math.abs(difference) / 1000)
    return overdue === 0 ? 0 : -overdue
  }, [deadline, now])

  useEffect(() => {
    if (deadline === null) return
    const tick = (returningFromBackground = false) => {
      const time = Date.now()
      setNow(time)
      if (time < deadline || notified.current === deadline || gongWasPlayed(workoutId, deadline)) return
      if (document.visibilityState !== 'visible') return
      notified.current = deadline
      markGongPlayed(workoutId, deadline)
      const nativeSignalAlreadyScheduled = returningFromBackground
        && backgrounded.current
        && wasNativeRestTimerNotificationScheduled(workoutId, deadline)
      if (!nativeSignalAlreadyScheduled) void playGong()
    }
    const wake = () => {
      if (document.visibilityState !== 'visible') {
        backgrounded.current = true
        return
      }
      tick(true)
      backgrounded.current = false
    }
    const interval = window.setInterval(() => tick(), 250)
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('pageshow', wake)
    tick()
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('pageshow', wake)
    }
  }, [deadline, workoutId])

  useEffect(() => {
    if (!open) return
    const section = dialog.current
    section?.querySelector<HTMLButtonElement>('button')?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
      if (event.key !== 'Tab' || !section) return
      const nodes = Array.from(section.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]:not([aria-disabled="true"])'))
      const first = nodes[0], last = nodes.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); trigger.current?.focus({ preventScroll: true }) }
  }, [open])

  const selectedDuration = minutes * 60 + seconds
  const valid = selectedDuration > 0 && selectedDuration <= 3600
  const active = deadline !== null && now < deadline
  const overdue = deadline !== null && now >= deadline

  function setDuration(duration: number) {
    const normalized = Math.min(3600, Math.max(1, Math.round(duration)))
    selectedDurationRef.current = normalized
    setMinutes(Math.floor(normalized / 60))
    setSeconds(normalized % 60)
  }

  function changeMinutes(value: number) {
    const nextSeconds = value === 60 ? 0 : selectedDurationRef.current % 60
    selectedDurationRef.current = value * 60 + nextSeconds
    setMinutes(value)
    if (value === 60) setSeconds(0)
  }

  function changeSeconds(value: number) {
    selectedDurationRef.current = Math.floor(selectedDurationRef.current / 60) * 60 + value
    setSeconds(value)
  }

  function shift(delta: number) {
    if (deadline !== null) onChange(deadline + delta * 1000)
  }

  function start() {
    const duration = selectedDurationRef.current
    if (duration <= 0 || duration > 3600) return
    prepareGong()
    onDurationChange?.(duration)
    onChange(Date.now() + duration * 1000)
    setOpen(false)
  }

  function openPicker() {
    prepareGong()
    setDuration(defaultDurationSeconds)
    setOpen(true)
  }

  const stateClass = active ? ' resting' : overdue ? ' rest-overdue' : ''
  const triggerLabel = active && signedRemaining !== null
    ? `Таймер отдыха: ${formatRest(signedRemaining)}`
    : overdue && signedRemaining !== null
      ? `Отдых превышен на ${formatRest(Math.abs(signedRemaining))}`
      : 'Таймер отдыха'
  const triggerText = signedRemaining !== null ? `Отдых ${formatRest(signedRemaining)}` : 'Таймер'

  return <>
    <button ref={trigger} type="button" className={`secondary live-rest-trigger${stateClass}`} aria-label={triggerLabel} onClick={openPicker}>
      <TimerIcon /><span>{triggerText}</span>
    </button>
    {open && createPortal(<div className="sheet-overlay" onClick={() => setOpen(false)}>
      <section ref={dialog} className="workout-decision-sheet live-rest-sheet" role="dialog" aria-modal="true" aria-label="Таймер отдыха" onClick={(event) => event.stopPropagation()}>
        <header className="picker-header"><h2>Таймер отдыха</h2><button type="button" className="picker-close" aria-label="Закрыть таймер" onClick={() => setOpen(false)}><CloseIcon /></button></header>
        {signedRemaining !== null && <>
          <p className={`live-rest-countdown${overdue ? ' overdue' : ''}`}>{formatRest(signedRemaining)}</p>
          <div className="rest-controls"><button type="button" className="secondary" aria-label="Минус 15 секунд" onClick={() => shift(-15)}>−15 сек</button><button type="button" className="secondary" aria-label="Плюс 15 секунд" onClick={() => shift(15)}>+15 сек</button></div>
          <button type="button" className="secondary" aria-label="Остановить отдых" onClick={() => { onChange(null); setOpen(false) }}>Остановить отдых</button>
          <div className="live-rest-divider" />
          <strong className="live-rest-new-time">Новое время</strong>
        </>}
        <div className="rest-time-picker" aria-label="Время отдыха">
          <TimeWheel label="минуты" value={minutes} values={MINUTES} onChange={changeMinutes} />
          <span className="rest-time-separator" aria-hidden="true">:</span>
          <TimeWheel label="секунды" value={seconds} values={minutes === 60 ? [0] : SECONDS} disabled={minutes === 60} onChange={changeSeconds} />
        </div>
        <div className="rest-controls rest-presets">{[60, 90, 120, 180].map((value) => <button key={value} type="button" className="secondary" onClick={() => setDuration(value)}>{formatRest(value)}</button>)}</div>
        <div className="live-rest-apply"><button type="button" disabled={!valid} onClick={start}>{signedRemaining === null ? `Начать отдых · ${formatRest(selectedDuration)}` : `Применить время · ${formatRest(selectedDuration)}`}</button></div>
      </section>
    </div>, document.querySelector('.phone-frame') ?? document.body)}
  </>
}
