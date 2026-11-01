import { useId, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react'
import { addDays, addMonths, dayOfMonth, formatLocalDate, formatMonth, formatRelativeLocalDate, startOfMonth, weekdayIndex, type LocalDate } from './local-date'
import { BackIcon, CheckIcon, CheckSmallIcon, ChevronRightIcon, CloseIcon, ScheduleIcon } from './icons'
import { FitLimeSheetHeader } from './FitLimeSheetHeader'
import { fitLimeOriginalIcons } from './fit-lime-icons'

/** Presentation-only date choice. Parent owns navigation and persistence. */
export function FitLimeDatePicker({ value, onChange, time, onTimeChange, triggerLabel, triggerIcon, triggerAriaLabel, onTrigger, controlRef, reference = false, disabled = false, clientLime = false, showEndTime = true, startLabel = 'Начало', today }: {
  value: LocalDate
  onChange: (date: LocalDate) => void
  time?: { start: string; end: string }
  onTimeChange?: (time: { start: string; end: string }) => void
  triggerLabel?: ReactNode
  triggerIcon?: ReactNode
  triggerAriaLabel?: string
  onTrigger?: (open: () => void) => void
  controlRef?: Ref<{ open: () => void }>
  reference?: boolean
  disabled?: boolean
  clientLime?: boolean
  showEndTime?: boolean
  startLabel?: string
  today?: LocalDate
}) {
  const titleId = useId()
  const descriptionId = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const monthsBody = useRef<HTMLDivElement>(null)
  const backdropStart = useRef(false)
  const sourceCalendar = reference && !clientLime
  const [draft, setDraft] = useState(value)
  const [month, setMonth] = useState(startOfMonth(value))
  const [draftTime, setDraftTime] = useState(time ?? { start: '', end: '' })
  const [visibleMonths, setVisibleMonths] = useState(3)
  function open() {
    setDraft(value)
    setMonth(startOfMonth(value))
    setVisibleMonths(3)
    setDraftTime(time ?? { start: '', end: '' })
    dialog.current?.showModal()
    if (sourceCalendar) requestAnimationFrame(() => {
      const body = monthsBody.current
      const selected = body?.querySelector<HTMLElement>('[aria-pressed="true"]')
      if (body && selected) body.scrollTop += selected.getBoundingClientRect().top - body.getBoundingClientRect().top - 16
    })
  }
  function apply() {
    dialog.current?.close()
    onChange(draft)
    onTimeChange?.(draftTime)
  }
  useImperativeHandle(controlRef, () => ({ open }))
  return <>
    <button ref={trigger} type="button" disabled={disabled} className={clientLime ? 'schedule-v2-calendar client-lime-date-control' : 'schedule-v2-calendar'} aria-label={triggerAriaLabel ?? (time ? 'Выбрать дату и время' : 'Выбрать дату')} aria-describedby={clientLime && triggerLabel ? descriptionId : undefined} onClick={() => onTrigger ? onTrigger(open) : open()}>{triggerIcon ?? <ScheduleIcon />}{triggerLabel && <span id={clientLime ? descriptionId : undefined}>{triggerLabel}</span>}</button>
    <dialog ref={dialog} className={`fit-lime-date-picker${reference ? ' coach-reference-sheet' : ''}${sourceCalendar ? ' coach-source-date-sheet' : ''}${clientLime ? ' client-lime-date-sheet' : ''}`} aria-labelledby={titleId} onKeyDown={(event) => {
      // The surrounding workout form must not submit before the modal is applied.
      if ((clientLime || sourceCalendar) && event.key === 'Enter' && event.target instanceof HTMLInputElement) { event.preventDefault(); event.stopPropagation(); event.target.blur() }
    }} onClose={() => trigger.current?.focus()}
    onPointerDownCapture={(event) => { backdropStart.current = event.target === event.currentTarget && event.clientY < event.currentTarget.getBoundingClientRect().top }}
    onPointerCancel={() => { backdropStart.current = false }}
    onClick={(event) => {
      const intended = backdropStart.current
      backdropStart.current = false
      if (intended && event.target === event.currentTarget && event.clientY < event.currentTarget.getBoundingClientRect().top) dialog.current?.close()
    }}>
      {clientLime ? <FitLimeSheetHeader titleId={titleId} title={time ? 'Дата и время' : 'Выбрать дату'} backLabel="Закрыть календарь" onBack={() => dialog.current?.close()} onConfirm={apply} confirmLabel="Применить дату" disabled={disabled} /> : <header className={reference ? 'coach-reference-sheet-header' : undefined}><button type="button" aria-label="Закрыть календарь" onClick={() => dialog.current?.close()}><CloseIcon /></button><h2 id={titleId}>{time ? 'Дата и время' : sourceCalendar ? 'Дата' : 'Выбрать дату'}</h2><button type="button" className={reference ? 'coach-sheet-confirm' : undefined} aria-label="Применить дату" onClick={apply}>{reference ? <CheckSmallIcon /> : <CheckIcon />}</button></header>}
      <p className="fit-lime-date-selected" aria-live="polite">{sourceCalendar ? <span className="coach-date-sun" aria-hidden="true" style={{ maskImage: `url("${fitLimeOriginalIcons.sun}")` }} /> : clientLime && <ScheduleIcon />}{sourceCalendar && today ? formatRelativeLocalDate(draft, today) : formatLocalDate(draft)}</p>
      <div className="fit-lime-month-navigation"><button type="button" aria-label="Предыдущий месяц" onClick={() => { setMonth(addMonths(month, -1)); setVisibleMonths(3); if (monthsBody.current) monthsBody.current.scrollTop = 0 }}><BackIcon /></button>{sourceCalendar ? <div className="coach-date-weekdays" aria-hidden="true">{['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map(label => <span key={label}>{label}</span>)}</div> : <span>{formatMonth(month)}</span>}<button type="button" aria-label="Следующий месяц" onClick={() => { setMonth(addMonths(month, 1)); setVisibleMonths(3); if (monthsBody.current) monthsBody.current.scrollTop = 0 }}><ChevronRightIcon /></button></div>
      <div ref={monthsBody} className={sourceCalendar ? 'coach-date-months' : undefined} onScroll={sourceCalendar ? (event) => {
        const body = event.currentTarget
        if (body.scrollTop + body.clientHeight >= body.scrollHeight - 64) setVisibleMonths(count => count + 3)
      } : undefined}>
      {(sourceCalendar ? Array.from({ length: visibleMonths }, (_, index) => addMonths(month, index)) : clientLime ? [month] : [month, addMonths(month, 1)]).map((first) => {
        const offset = (weekdayIndex(first) + 6) % 7
        const last = dayOfMonth(addDays(addMonths(first, 1), -1))
        return <section key={first} aria-label={formatMonth(first)}><h3>{formatMonth(first)}</h3><div className="fit-lime-month-grid">
          {!sourceCalendar && ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map((label) => <span key={label} className="fit-lime-month-weekday">{label}</span>)}
          {Array.from({ length: offset }, (_, index) => <span key={`blank-${index}`} className={clientLime ? 'fit-lime-month-outside' : undefined} aria-hidden="true">{clientLime ? dayOfMonth(addDays(first, index - offset)) : null}</span>)}
          {Array.from({ length: last }, (_, index) => {
            const date = addDays(first, index)
            return <button key={date} type="button" aria-label={formatLocalDate(date)} aria-pressed={draft === date} aria-current={clientLime && date === today ? 'date' : undefined} onClick={() => setDraft(date)}><span className={clientLime ? 'lime-calendar-day-marker' : undefined}>{index + 1}</span></button>
          })}
          {clientLime && Array.from({ length: (7 - (offset + last) % 7) % 7 }, (_, index) => <span key={`next-${index}`} className="fit-lime-month-outside" aria-hidden="true">{index + 1}</span>)}
        </div></section>
      })}
      </div>
      {time && <div className="fit-lime-date-times"><label>{startLabel}<input type="time" value={draftTime.start} onChange={(event) => setDraftTime({ ...draftTime, start: event.target.value })} /></label>{showEndTime && <label>Окончание<input type="time" value={draftTime.end} onChange={(event) => setDraftTime({ ...draftTime, end: event.target.value })} /></label>}</div>}
    </dialog>
  </>
}
