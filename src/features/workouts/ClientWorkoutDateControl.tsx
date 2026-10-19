import { FitLimeDatePicker } from '../../shared/FitLimeDatePicker'
import { coachWorkoutReferenceAssets } from '../../shared/coach-workout-reference-assets'
import { formatLocalDate, type LocalDate } from '../../shared/local-date'

/** Client readout of the existing workout date fields; the parent retains their state. */
export function ClientWorkoutDateControl({ value, today, onChange, start, end, onTimeChange, startLabel = 'Начало', disabled }: {
  value: LocalDate
  today: LocalDate
  onChange: (value: LocalDate) => void
  start: string
  end?: string
  onTimeChange: (time: { start: string; end: string }) => void
  startLabel?: string
  disabled?: boolean
}) {
  return <FitLimeDatePicker clientLime value={value} today={today} onChange={onChange} time={{ start, end: end ?? '' }} onTimeChange={onTimeChange} showEndTime={end !== undefined} startLabel={startLabel} disabled={disabled} triggerIcon={<></>} triggerLabel={<span className="client-lime-date-rows">
    <span className="client-lime-date-row client-lime-date-main"><span className="client-lime-date-icon" aria-hidden="true" style={{ maskImage: `url("${coachWorkoutReferenceAssets.date}")` }} /><span>{formatLocalDate(value)}</span></span>
    <span className="client-lime-date-row"><span className="client-lime-date-icon" aria-hidden="true" style={{ maskImage: `url("${coachWorkoutReferenceAssets.clock}")` }} /><span>{startLabel}</span><span>{start || 'Без времени'}</span></span>
    {end !== undefined && <span className="client-lime-date-row"><span className="client-lime-date-icon" aria-hidden="true" style={{ maskImage: `url("${coachWorkoutReferenceAssets.clock}")` }} /><span>Окончание</span><span>{end || 'Без времени'}</span></span>}
  </span>} />
}
