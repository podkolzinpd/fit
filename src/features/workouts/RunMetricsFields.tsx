import { useEffect, useState, type MouseEvent } from 'react'
import {
  formatRunDistanceInput,
  preferredRunDistanceUnit,
  runDistanceKmFromInput,
  runPaceLabel,
  rowingPaceLabel,
  type RunDistanceUnit,
} from '../../shared/run-metrics'
import { WorkoutDurationField } from './WorkoutDurationField'

interface RunMetricsFieldsProps {
  idPrefix: string
  durationSec?: number
  distanceKm?: number
  inputClassName: string
  disabled?: boolean
  planDurationHint?: boolean
  planDistanceHint?: boolean
  planStrokeRateHint?: boolean
  rowing?: boolean
  optionalDistance?: boolean
  strokeRate?: number
  durationName?: string
  distanceName?: string
  distanceUnitName?: string
  strokeRateName?: string
  durationLabel: string
  distanceLabel: string
  distanceUnitLabel: string
  onCommit?: (patch: { durationSec?: number; durationMin?: undefined; distanceKm?: number; reps?: number }) => void
}

export function RunMetricsFields({
  idPrefix,
  durationSec,
  distanceKm,
  inputClassName,
  disabled = false,
  planDurationHint = false,
  planDistanceHint = false,
  planStrokeRateHint = false,
  rowing = false,
  optionalDistance = false,
  strokeRate,
  durationName,
  distanceName,
  distanceUnitName,
  strokeRateName,
  durationLabel,
  distanceLabel,
  distanceUnitLabel,
  onCommit,
}: RunMetricsFieldsProps) {
  const [unit, setUnit] = useState<RunDistanceUnit>(() => (rowing || optionalDistance) && distanceKm === undefined ? 'm' : preferredRunDistanceUnit(distanceKm))
  const [localDuration, setLocalDuration] = useState(durationSec)
  const [distanceText, setDistanceText] = useState(() => formatRunDistanceInput(distanceKm, unit))
  const [distanceVisible, setDistanceVisible] = useState(() => !optionalDistance || distanceKm !== undefined)
  const [strokeRateText, setStrokeRateText] = useState(() => strokeRate === undefined ? '' : String(strokeRate))
  const parsedDuration = localDuration
  const parsedDistance = runDistanceKmFromInput(distanceText, unit)
  const pace = optionalDistance ? null : rowing ? rowingPaceLabel(parsedDuration, parsedDistance) : runPaceLabel(parsedDuration, parsedDistance)

  useEffect(() => setLocalDuration(durationSec), [durationSec])
  useEffect(() => setDistanceText(formatRunDistanceInput(distanceKm, unit)), [distanceKm, unit])
  useEffect(() => { if (distanceKm !== undefined) setDistanceVisible(true) }, [distanceKm])
  useEffect(() => setStrokeRateText(strokeRate === undefined ? '' : String(strokeRate)), [strokeRate])

  function commitDistance() {
    const next = runDistanceKmFromInput(distanceText, unit)
    setDistanceText(formatRunDistanceInput(next, unit))
    onCommit?.({ distanceKm: next })
  }

  function changeUnit(next: RunDistanceUnit) {
    const currentKm = runDistanceKmFromInput(distanceText, unit)
    setUnit(next)
    setDistanceText(formatRunDistanceInput(currentKm, next))
  }

  function commitStrokeRate() {
    const parsed = strokeRateText.trim() === '' ? undefined : Number(strokeRateText)
    const next = parsed !== undefined && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
    setStrokeRateText(next === undefined ? '' : String(next))
    onCommit?.({ reps: next })
  }

  function hideDistance(event: MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.form
    setDistanceVisible(false)
    setDistanceText('')
    onCommit?.({ distanceKm: undefined })
    window.requestAnimationFrame(() => form?.dispatchEvent(new Event('input', { bubbles: true })))
  }

  return <>
    <div className="run-duration-field">
      <WorkoutDurationField durationSec={localDuration} name={durationName} label={durationLabel} className={inputClassName} planHint={planDurationHint} disabled={disabled} onCommit={(next) => { setLocalDuration(next); onCommit?.({ durationSec: next, durationMin: undefined }) }} />
      <small>мин:сек</small>
    </div>
    <div className="run-distance-field">
      {!distanceVisible ? <button type="button" className="run-distance-add" disabled={disabled} onClick={() => setDistanceVisible(true)}>+ Добавить дистанцию</button> : <>
      <div className="run-distance-control">
        <label className="sr-only" htmlFor={`${idPrefix}-distance`}>{distanceLabel}</label>
        <input
          id={`${idPrefix}-distance`}
          className={`${inputClassName}${planDistanceHint ? ' plan-hint' : ''}`}
          name={distanceName}
          aria-label={distanceLabel}
          type="number"
          inputMode="decimal"
          min="0"
          step={unit === 'm' ? 1 : 0.01}
          placeholder="0"
          value={distanceText}
          disabled={disabled}
          onChange={(event) => setDistanceText(event.target.value)}
          onBlur={commitDistance}
        />
        <span className={`run-distance-unit-control${disabled ? ' disabled' : ''}`}>
          <select
            className="run-distance-unit"
            name={distanceUnitName}
            aria-label={distanceUnitLabel}
            value={unit}
            disabled={disabled}
            onChange={(event) => changeUnit(event.target.value as RunDistanceUnit)}
          >
            <option value="m">м</option>
            <option value="km">км</option>
          </select>
        </span>
      </div>
      <small>{optionalDistance ? 'По дисплею тренажёра' : pace ? `Темп ${pace}` : `Темп —${rowing ? '/500 м' : ''}`}</small>
      {optionalDistance && !disabled && <button type="button" className="run-distance-remove" onClick={hideDistance}>Убрать дистанцию</button>}
      {rowing && <label className="rowing-stroke-rate-field">
        <span>Гребков в минуту</span>
        <input
          className={`${inputClassName}${planStrokeRateHint ? ' plan-hint' : ''}`}
          name={strokeRateName}
          aria-label="Гребков в минуту"
          type="number"
          inputMode="numeric"
          min="0"
          step="1"
          placeholder="—"
          value={strokeRateText}
          disabled={disabled}
          onChange={(event) => setStrokeRateText(event.target.value)}
          onBlur={commitStrokeRate}
        />
      </label>}
      </>}
    </div>
  </>
}
