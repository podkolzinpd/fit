import { FitLimeSheetHeader } from '../../shared/FitLimeSheetHeader'
import type { CoachLiveDensity } from '../../app/coach-live-density'
import { CoachLiveV79Timer } from './CoachLiveV79Timer'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CloseIcon, PlayIcon, TimerIcon } from '../../shared/icons'
import { playGong, prepareGong } from '../../shared/gong'
import type { LivePhaseTimer } from './live-phase'
import { wasNativeRestTimerNotificationScheduled } from './rest-timer-notification'
import { TimeWheel } from './TimeWheel'
import clientPauseIcon from '../../shared/client-live-pause.svg'
import coachRestIcon from '../../../docs/design/figma-20261008/assets/coach-rest.svg'

const LONG_PRESS_MS = 500
const MINUTES = Array.from({ length: 61 }, (_, index) => index)
const SECONDS = Array.from({ length: 60 }, (_, index) => index)

export function formatRest(seconds: number): string {
  const sign = seconds < 0 ? '−' : ''
  const absolute = Math.abs(seconds)
  return `${sign}${Math.floor(absolute / 60)}:${String(absolute % 60).padStart(2, '0')}`
}

export function formatReferenceClock(seconds: number): string {
  const sign = seconds < 0 ? '−' : ''
  const absolute = Math.abs(seconds)
  const hours = Math.floor(absolute / 3600)
  const minutes = Math.floor((absolute % 3600) / 60)
  const clock = `${String(minutes).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`
  return `${sign}${hours ? `${hours}:` : ''}${clock}`
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

const PHASE_COPY = {
  prep: { label: 'Подготовка', sheet: 'Таймер подготовки', stop: 'Остановить подготовку', tap: 'нажмите, чтобы начать подход сразу' },
  work: { label: 'Подход', sheet: 'Таймер подхода', stop: 'Остановить подход', tap: 'нажмите, чтобы подтвердить подход' },
} as const

/**
 * Only this small subtree ticks; workout inputs do not rerender every second.
 * One button shows the current phase — prep, timed set or rest — because the
 * phases never overlap. A short tap runs `onPrimary` (the next logical step);
 * a long press or the context menu always opens the timer sheet.
 */
export function LiveRestTimer({ workoutId, deadline, defaultDurationSeconds = 90, onChange, onDurationChange, phase = null, onPrimary, onPhaseChange, onPhaseExpire, onRestExpire, referenceStartedAt, onReferenceRestActiveChange, referenceWorkOvertime = false, referencePausedSeconds = 0, onReferencePauseToggle, referenceActions = false, coachV79, settings, pausedAt = null }: {
  workoutId: string
  deadline: number | null
  defaultDurationSeconds?: number
  onChange: (deadline: number | null) => void
  onDurationChange?: (seconds: number) => void
  phase?: LivePhaseTimer | null
  /** Returns true when the tap was handled; otherwise the sheet opens as before. */
  onPrimary?: () => boolean
  onPhaseChange?: (phase: LivePhaseTimer | null) => void
  onPhaseExpire?: (phase: LivePhaseTimer) => void
  onRestExpire?: (deadline: number) => void
  /** Presentation-only pilot: the existing phase/gong/expiry owner remains this subtree. */
  referenceStartedAt?: string | null
  /** Client presentation follows the existing signed manual-work indicator. */
  referenceWorkOvertime?: boolean
  /** Existing workout pause accounting; client presentation only. */
  referencePausedSeconds?: number
  onReferencePauseToggle?: () => void
  /** Client pilot uses the two separate actions measured in live-header SVG. */
  referenceActions?: boolean
  /** Read-only presentation of this timer; never a second lifecycle owner. */
  coachV79?: { density: CoachLiveDensity; headerSlot: HTMLElement | null }
  /** Updates the pilot header only at the rest boundary, not on every tick. */
  onReferenceRestActiveChange?: (active: boolean) => void
  /** Редкие настройки тренировки над временем таймера, чтобы не занимать экран Live. */
  settings?: ReactNode
  /** Пауза всей тренировки (YAFIT-627): время замирает на этом моменте, ничего не истекает. */
  pausedAt?: number | null
}) {
  const [liveNow, setNow] = useState(Date.now)
  const now = pausedAt ?? liveNow
  const [open, setOpen] = useState(false)
  const [minutes, setMinutes] = useState(1)
  const [seconds, setSeconds] = useState(30)
  const notified = useRef<number | null>(null)
  const backgrounded = useRef(document.visibilityState !== 'visible')
  const trigger = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLElement>(null)
  const selectedDurationRef = useRef(90)
  const longPressTimer = useRef<number | null>(null)
  const longPressFired = useRef(false)
  const expiredPhase = useRef<string | null>(null)
  const expiredRest = useRef<number | null>(null)
  const callbacks = useRef({ onPhaseExpire, onRestExpire })
  useEffect(() => { callbacks.current = { onPhaseExpire, onRestExpire } }, [onPhaseExpire, onRestExpire])

  const signedRemaining = useMemo(() => {
    if (deadline === null) return null
    const difference = deadline - now
    if (difference >= 0) return Math.ceil(difference / 1000)
    const overdue = Math.floor(Math.abs(difference) / 1000)
    return overdue === 0 ? 0 : -overdue
  }, [deadline, now])
  const phaseRemaining = phase ? Math.max(0, Math.ceil((phase.endsAt - now) / 1000)) : null
  // Подход «Веду сам» после нуля считает в плюс, пока человек его не засчитает.
  const phaseOvertime = phase?.kind === 'work' && phase.manual && now >= phase.endsAt ? Math.floor((now - phase.endsAt) / 1000) : null
  const phaseClock = phaseOvertime !== null ? `+${formatRest(phaseOvertime)}` : phaseRemaining !== null ? formatRest(phaseRemaining) : ''
  const tickDeadline = phase?.endsAt ?? deadline

  useEffect(() => {
    if (referenceStartedAt === undefined || tickDeadline !== null) return
    const tick = () => setNow(Date.now())
    const interval = window.setInterval(tick, 1000)
    document.addEventListener('visibilitychange', tick)
    tick()
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', tick) }
  }, [referenceStartedAt, tickDeadline])

  useEffect(() => {
    if (tickDeadline === null || pausedAt !== null) return
    const signal = (end: number, returningFromBackground: boolean) => {
      if (notified.current === end || gongWasPlayed(workoutId, end)) return
      notified.current = end
      markGongPlayed(workoutId, end)
      const nativeSignalAlreadyScheduled = returningFromBackground
        && backgrounded.current
        && wasNativeRestTimerNotificationScheduled(workoutId, end)
      if (!nativeSignalAlreadyScheduled) void playGong()
    }
    const tick = (returningFromBackground = false) => {
      const time = Date.now()
      setNow(time)
      if (time < tickDeadline || document.visibilityState !== 'visible') return
      signal(tickDeadline, returningFromBackground)
      // Expiry acts once per phase/deadline and only while visible: a set that
      // ran out with the phone locked is confirmed when the user comes back.
      if (phase) {
        const key = `${phase.kind}:${phase.endsAt}`
        if (expiredPhase.current !== key) { expiredPhase.current = key; callbacks.current.onPhaseExpire?.(phase) }
      } else if (deadline !== null && expiredRest.current !== deadline) {
        expiredRest.current = deadline
        callbacks.current.onRestExpire?.(deadline)
      }
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
  }, [deadline, phase, tickDeadline, workoutId, pausedAt])
  useEffect(() => () => { if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current) }, [])

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
  useEffect(() => {
    if (referenceStartedAt !== undefined) onReferenceRestActiveChange?.(active && !phase)
  }, [active, phase, referenceStartedAt, onReferenceRestActiveChange])

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
    if (phase) {
      // A phase can be shortened but never ended through −15: that is «Остановить».
      onPhaseChange?.({ ...phase, endsAt: Math.max(Date.now() + 1000, phase.endsAt + delta * 1000) })
      return
    }
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

  function cancelLongPress() {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current)
    longPressTimer.current = null
  }

  function startLongPress() {
    longPressFired.current = false
    cancelLongPress()
    longPressTimer.current = window.setTimeout(() => {
      longPressTimer.current = null
      longPressFired.current = true
      openPicker()
    }, LONG_PRESS_MS)
  }

  function tap() {
    cancelLongPress()
    // The long press already opened the sheet; the click that follows the
    // release must not also run the short-tap action.
    if (longPressFired.current) { longPressFired.current = false; return }
    prepareGong()
    if (!onPrimary?.()) openPicker()
  }

  const copy = phase ? PHASE_COPY[phase.kind] : null
  const stateClass = phase ? ` phase-${phase.kind}` : active ? ' resting' : overdue ? ' rest-overdue' : ''
  const triggerLabel = copy && phaseRemaining !== null
    ? `${copy.sheet}: ${phaseClock}, ${copy.tap}`
    : active && signedRemaining !== null
      ? `Таймер отдыха: ${formatRest(signedRemaining)}${onPrimary ? ', нажмите, чтобы закончить отдых' : ''}`
      : overdue && signedRemaining !== null
        ? `Отдых превышен на ${formatRest(Math.abs(signedRemaining))}`
        : 'Таймер отдыха'
  const triggerText = copy && phaseRemaining !== null
    ? `${copy.label} ${phaseClock}`
    : signedRemaining !== null ? `Отдых ${formatRest(signedRemaining)}` : 'Таймер'
  const sheetTitle = copy?.sheet ?? 'Таймер отдыха'

  const reference = referenceStartedAt !== undefined
  const elapsed = referenceStartedAt ? Math.max(0, Math.floor((now - Date.parse(referenceStartedAt)) / 1000) - referencePausedSeconds) : 0
  const bigSeconds = phaseRemaining ?? (active ? signedRemaining : null) ?? elapsed
  const bigTime = referenceWorkOvertime && phaseOvertime !== null
    ? `+${formatReferenceClock(phaseOvertime)}` : formatReferenceClock(bigSeconds)
  const referencePaused = !!onReferencePauseToggle && pausedAt !== null
  const referenceClockClass = `coach-live-clock${active && !phase ? ' coach-live-clock-rest' : ''}${referencePaused ? ' paused' : ''}`
  const referenceClockContent = <>
    {referencePaused ? <span className="coach-live-pause">Пауза</span> : <span className={`coach-live-digits${bigTime.length > 5 ? ' coach-live-digits-long' : ''}`} aria-label={`${copy?.label ?? (active ? 'Отдых' : 'Тренировка')}: ${bigTime}`}>{bigTime.split(':').map((part, index) => <span className="coach-live-digit-group" key={index}>{index > 0 && <span className="coach-live-colon" aria-hidden="true">:</span>}{part}</span>)}</span>}
    {!referencePaused && (active || phase) ? <span className="coach-live-elapsed">Тренировка · {formatReferenceClock(elapsed)}</span> : null}
  </>

  const referenceClock = reference && (onReferencePauseToggle && !referenceActions ? <button type="button" className={`${referenceClockClass} live-timer-toggle`} aria-pressed={referencePaused}
      aria-label={`${referencePaused ? 'Продолжить тренировку' : 'Поставить тренировку на паузу'}, прошло ${formatReferenceClock(elapsed)}`}
      onClick={onReferencePauseToggle}>{referenceClockContent}</button> : <div className={referenceClockClass}>{referenceClockContent}</div>)
  const restTrigger = <button ref={trigger} type="button" className={`secondary live-rest-trigger${stateClass}`} aria-label={triggerLabel}
      aria-haspopup="dialog" aria-description={onPrimary ? 'Удерживайте, чтобы открыть настройки таймера' : undefined}
      onPointerDown={onPrimary ? startLongPress : undefined} onPointerUp={cancelLongPress} onPointerLeave={cancelLongPress} onPointerCancel={cancelLongPress}
      onContextMenu={(event) => { event.preventDefault(); cancelLongPress(); if (!open) openPicker() }}
      onClick={onPrimary ? tap : openPicker}>
      {reference ? <img src={coachRestIcon} width="16" height="16" alt="" aria-hidden="true" /> : <TimerIcon />}<span>{reference && signedRemaining === null && !phase ? 'Отдых' : triggerText}</span>
    </button>
  const compactRestTrigger = coachV79 && <button type="button" className={`secondary live-rest-trigger${stateClass}`} aria-label={triggerLabel}
    aria-haspopup="dialog" aria-description={onPrimary ? 'Удерживайте, чтобы открыть настройки таймера' : undefined}
    onPointerDown={onPrimary ? startLongPress : undefined} onPointerUp={cancelLongPress} onPointerLeave={cancelLongPress} onPointerCancel={cancelLongPress}
    onContextMenu={(event) => { event.preventDefault(); cancelLongPress(); if (!open) openPicker() }} onClick={onPrimary ? tap : openPicker}>
    <img src={coachRestIcon} width="16" height="16" alt="" aria-hidden="true" /><span>{triggerText}</span>
  </button>
  return <>
    {coachV79 ? <CoachLiveV79Timer time={bigTime} elapsed={formatReferenceClock(elapsed)} resting={active && !phase} paused={pausedAt !== null}
      density={coachV79.density} headerSlot={coachV79.headerSlot} restAction={restTrigger} compactAction={compactRestTrigger} /> : referenceClock}
    {!coachV79 && (referenceActions ? <div className="client-reference-timer-actions">
      <button type="button" className="secondary client-reference-pause" disabled={!onReferencePauseToggle}
        aria-pressed={referencePaused} aria-label={`${referencePaused ? 'Продолжить тренировку' : 'Поставить тренировку на паузу'}, прошло ${formatReferenceClock(elapsed)}`}
        onClick={onReferencePauseToggle}>
        {referencePaused ? <PlayIcon /> : <img src={clientPauseIcon} width="16" height="16" alt="" aria-hidden="true" />}
        <span>{referencePaused ? 'Продолжить' : 'Пауза'}</span>
      </button>{restTrigger}
    </div> : restTrigger)}
    {open && createPortal(<div className="sheet-overlay" onClick={() => setOpen(false)}>
      <section ref={dialog} className={`workout-decision-sheet live-rest-sheet${referenceActions ? ' client-reference-time-sheet' : ''}`} role="dialog" aria-modal="true" aria-label={sheetTitle} onClick={(event) => event.stopPropagation()}>
        {referenceActions ? <FitLimeSheetHeader title={sheetTitle} backLabel="Закрыть таймер" onBack={() => setOpen(false)} /> : <header className="picker-header"><h2>{sheetTitle}</h2><button type="button" className="picker-close" aria-label="Закрыть таймер" onClick={() => setOpen(false)}><CloseIcon /></button></header>}
        {settings}
        {copy && phase && phaseRemaining !== null ? <>
          <p className="live-rest-countdown">{phaseClock}</p>
          <div className="rest-controls"><button type="button" className="secondary" aria-label="Минус 15 секунд" onClick={() => shift(-15)}>−15 сек</button><button type="button" className="secondary" aria-label="Плюс 15 секунд" onClick={() => shift(15)}>+15 сек</button></div>
          <button type="button" className="secondary" aria-label={copy.stop} onClick={() => { onPhaseChange?.(null); setOpen(false) }}>{copy.stop}</button>
        </> : <>
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
        </>}
      </section>
    </div>, document.querySelector('.phone-frame') ?? document.body)}
  </>
}
