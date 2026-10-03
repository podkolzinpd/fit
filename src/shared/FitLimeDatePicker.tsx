import { useId, useRef, useState } from 'react'
import { addDays, addMonths, dayOfMonth, formatLocalDate, formatMonth, startOfMonth, weekdayIndex, type LocalDate } from './local-date'
import { BackIcon, CheckIcon, ChevronRightIcon, CloseIcon, ScheduleIcon } from './icons'

/** Presentation-only date choice. Parent owns navigation and persistence. */
export function FitLimeDatePicker({ value, onChange, time, onTimeChange, triggerLabel }: {
  value: LocalDate
  onChange: (date: LocalDate) => void
  time?: { start: string; end: string }
  onTimeChange?: (time: { start: string; end: string }) => void
  triggerLabel?: string
}) {
  const titleId = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [draft, setDraft] = useState(value)
  const [month, setMonth] = useState(startOfMonth(value))
  const [draftTime, setDraftTime] = useState(time ?? { start: '', end: '' })
  function open() {
    setDraft(value)
    setMonth(startOfMonth(value))
    setDraftTime(time ?? { start: '', end: '' })
    dialog.current?.showModal()
  }
  return <>
    <button ref={trigger} type="button" className="schedule-v2-calendar" aria-label={time ? 'Выбрать дату и время' : 'Выбрать дату'} onClick={open}><ScheduleIcon />{triggerLabel && <span>{triggerLabel}</span>}</button>
    <dialog ref={dialog} className="fit-lime-date-picker" aria-labelledby={titleId} onClose={() => trigger.current?.focus()} onClick={(event) => { if (event.target === event.currentTarget && event.clientY < event.currentTarget.getBoundingClientRect().top) dialog.current?.close() }}>
      <header><button type="button" aria-label="Закрыть календарь" onClick={() => dialog.current?.close()}><CloseIcon /></button><h2 id={titleId}>{time ? 'Дата и время' : 'Выбрать дату'}</h2><button type="button" aria-label="Применить дату" onClick={() => { dialog.current?.close(); onChange(draft); onTimeChange?.(draftTime) }}><CheckIcon /></button></header>
      <p className="fit-lime-date-selected" aria-live="polite">{formatLocalDate(draft)}</p>
      <div className="fit-lime-month-navigation"><button type="button" aria-label="Предыдущий месяц" onClick={() => setMonth(addMonths(month, -1))}><BackIcon /></button><span>{formatMonth(month)}</span><button type="button" aria-label="Следующий месяц" onClick={() => setMonth(addMonths(month, 1))}><ChevronRightIcon /></button></div>
      {[month, addMonths(month, 1)].map((first) => {
        const offset = (weekdayIndex(first) + 6) % 7
        const last = dayOfMonth(addDays(addMonths(first, 1), -1))
        return <section key={first} aria-label={formatMonth(first)}><h3>{formatMonth(first)}</h3><div className="fit-lime-month-grid">
          {['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map((label) => <span key={label} className="fit-lime-month-weekday">{label}</span>)}
          {Array.from({ length: offset }, (_, index) => <span key={`blank-${index}`} aria-hidden="true" />)}
          {Array.from({ length: last }, (_, index) => {
            const date = addDays(first, index)
            return <button key={date} type="button" aria-label={formatLocalDate(date)} aria-pressed={draft === date} onClick={() => setDraft(date)}><span>{index + 1}</span></button>
          })}
        </div></section>
      })}
      {time && <div className="fit-lime-date-times"><label>Начало<input type="time" value={draftTime.start} onChange={(event) => setDraftTime({ ...draftTime, start: event.target.value })} /></label><label>Окончание<input type="time" value={draftTime.end} onChange={(event) => setDraftTime({ ...draftTime, end: event.target.value })} /></label></div>}
    </dialog>
  </>
}
