import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CloseIcon, TimerIcon } from '../../shared/icons'
import { playGong } from '../../shared/gong'

export function formatRest(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** Only this small subtree ticks; workout inputs do not rerender every second. */
export function LiveRestTimer({ deadline, completedSetCount, onChange }: {
  deadline: number | null
  completedSetCount: number
  onChange: (deadline: number | null) => void
}) {
  const [now, setNow] = useState(Date.now)
  const [open, setOpen] = useState(false)
  const [seconds, setSeconds] = useState('90')
  const [finished, setFinished] = useState(false)
  const notified = useRef<number | null>(null)
  const previousCompletedSetCount = useRef(completedSetCount)
  const trigger = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLElement>(null)
  const change = useRef(onChange)
  useEffect(() => { change.current = onChange }, [onChange])
  const remaining = deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000))
  useEffect(() => {
    if (deadline === null) return
    const tick = () => {
      const time = Date.now()
      setNow(time)
      if (time >= deadline && notified.current !== deadline) {
        notified.current = deadline
        setFinished(true)
        change.current(null)
        playGong()
      }
    }
    const wake = () => { if (document.visibilityState === 'visible') tick() }
    const interval = window.setInterval(tick, 250)
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('pageshow', wake)
    tick()
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('pageshow', wake)
    }
  }, [deadline])
  useEffect(() => {
    if (previousCompletedSetCount.current !== completedSetCount) setFinished(false)
    previousCompletedSetCount.current = completedSetCount
  }, [completedSetCount])
  useEffect(() => {
    // A deadline may already be past when the app returns from background.
    // Do not erase the finished state produced by the catch-up tick on mount.
    if (deadline !== null && deadline > Date.now()) setFinished(false)
  }, [deadline])
  useEffect(() => {
    if (!open) return
    const section = dialog.current
    section?.querySelector<HTMLButtonElement>('button')?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
      if (event.key !== 'Tab' || !section) return
      const nodes = Array.from(section.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'))
      const first = nodes[0], last = nodes.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); trigger.current?.focus({ preventScroll: true }) }
  }, [open])
  const valid = Number.isInteger(Number(seconds)) && Number(seconds) > 0 && Number(seconds) <= 3600
  function shift(delta: number) {
    if (deadline !== null) onChange(Math.max(Date.now(), deadline + delta * 1000))
  }
  const activeRemaining = remaining !== null && remaining > 0 ? remaining : null
  const stateClass = activeRemaining !== null ? ' resting' : finished ? ' rest-finished' : ''
  const triggerLabel = activeRemaining !== null ? `Таймер отдыха: ${formatRest(activeRemaining)}` : finished ? 'Отдых завершён' : 'Таймер отдыха'
  const triggerText = activeRemaining !== null ? `Отдых ${formatRest(activeRemaining)}` : finished ? 'Отдых завершён' : 'Таймер'
  return <>
    <button ref={trigger} type="button" className={`secondary live-rest-trigger${stateClass}`} aria-label={triggerLabel} onClick={() => setOpen(true)}>
      <TimerIcon /><span>{triggerText}</span>
    </button>
    {open && createPortal(<div className="sheet-overlay" onClick={() => setOpen(false)}>
      <section ref={dialog} className="workout-decision-sheet live-rest-sheet" role="dialog" aria-modal="true" aria-label="Таймер отдыха" onClick={(event) => event.stopPropagation()}>
        <header className="picker-header"><h2>Таймер отдыха</h2><button type="button" className="picker-close" aria-label="Закрыть таймер" onClick={() => setOpen(false)}><CloseIcon /></button></header>
        {activeRemaining !== null ? <>
          <p className="live-rest-countdown">{formatRest(activeRemaining)}</p>
          <div className="rest-controls"><button type="button" className="secondary" aria-label="Минус 15 секунд" onClick={() => shift(-15)}>−15 сек</button><button type="button" className="secondary" aria-label="Плюс 15 секунд" onClick={() => shift(15)}>+15 сек</button></div>
          <button type="button" className="secondary" aria-label="Пропустить" onClick={() => { setFinished(false); onChange(null); setOpen(false) }}>Пропустить отдых</button>
        </> : <>
          <label className="field">Время отдыха, сек<input type="number" inputMode="numeric" min="1" max="3600" value={seconds} onChange={(event) => setSeconds(event.target.value)} /></label>
          <div className="rest-controls">{[60, 90, 120, 180].map((value) => <button key={value} type="button" className="secondary" onClick={() => setSeconds(String(value))}>{formatRest(value)}</button>)}</div>
          <button type="button" disabled={!valid} onClick={() => { setFinished(false); onChange(Date.now() + Number(seconds) * 1000); setOpen(false) }}>Начать отдых</button>
        </>}
      </section>
    </div>, document.querySelector('.phone-frame') ?? document.body)}
  </>
}
