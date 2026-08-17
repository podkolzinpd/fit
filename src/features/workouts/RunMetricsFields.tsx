import { useEffect, useState } from 'react'
import {
  formatRunDistanceInput,
  formatRunDuration,
  parseRunDurationInput,
  preferredRunDistanceUnit,
  runDistanceKmFromInput,
  runPaceLabel,
  type RunDistanceUnit,
} from '../../shared/run-metrics'

interface RunMetricsFieldsProps {
  idPrefix: string
  durationSec?: number
  distanceKm?: number
  inputClassName: string
  disabled?: boolean
  planDurationHint?: boolean
  planDistanceHint?: boolean
  durationName?: string
  distanceName?: string
  distanceUnitName?: string
  durationLabel: string
  distanceLabel: string
  distanceUnitLabel: string
  onCommit?: (patch: { durationSec?: number; durationMin?: undefined; distanceKm?: number }) => void
}

export function RunMetricsFields({
  idPrefix,
  durationSec,
  distanceKm,
  inputClassName,
  disabled = false,
  planDurationHint = false,
  planDistanceHint = false,
  durationName,
  distanceName,
  distanceUnitName,
  durationLabel,
  distanceLabel,
  distanceUnitLabel,
  onCommit,
}: RunMetricsFieldsProps) {
  const [unit, setUnit] = useState<RunDistanceUnit>(() => preferredRunDistanceUnit(distanceKm))
  const [durationText, setDurationText] = useState(() => formatRunDuration(durationSec))
  const [distanceText, setDistanceText] = useState(() => formatRunDistanceInput(distanceKm, unit))
  const parsedDuration = parseRunDurationInput(durationText)
  const parsedDistance = runDistanceKmFromInput(distanceText, unit)
  const pace = runPaceLabel(parsedDuration, parsedDistance)

  useEffect(() => setDurationText(formatRunDuration(durationSec)), [durationSec])
  useEffect(() => setDistanceText(formatRunDistanceInput(distanceKm, unit)), [distanceKm, unit])

  function commitDuration() {
    const next = parseRunDurationInput(durationText)
    setDurationText(formatRunDuration(next))
    onCommit?.({ durationSec: next, durationMin: undefined })
  }

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

  return <>
    <div className="run-duration-field">
      <label className="sr-only" htmlFor={`${idPrefix}-duration`}>{durationLabel}</label>
      <input
        id={`${idPrefix}-duration`}
        className={`${inputClassName}${planDurationHint ? ' plan-hint' : ''}`}
        name={durationName}
        aria-label={durationLabel}
        type="text"
        inputMode="numeric"
        placeholder="мм:сс"
        value={durationText}
        disabled={disabled}
        onChange={(event) => setDurationText(event.target.value)}
        onBlur={commitDuration}
      />
      <small>мин:сек</small>
    </div>
    <div className="run-distance-field">
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
          placeholder={unit}
          value={distanceText}
          disabled={disabled}
          onChange={(event) => setDistanceText(event.target.value)}
          onBlur={commitDistance}
        />
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
      </div>
      <small>{pace ? `Темп ${pace}` : 'Темп —'}</small>
    </div>
  </>
}
