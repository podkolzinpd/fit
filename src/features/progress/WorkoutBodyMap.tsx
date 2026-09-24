import { ProgressDetailsSummary } from './ProgressDetailsSummary'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import type { Gender, Workout } from '../../shared/domain'
import { formatLocalDate, localDate, type LocalDate } from '../../shared/local-date'
import { loadBodyMap, type BodyMapMode, type BodyMapZone, type BodyProgressSummary } from './body-progress-map'
import { MapPanel, TrainingBodyProgressMap } from './ClientBodyProgressMap'
import { bodyZoneSides, type BodyFigureSide } from './body-progress-geometry'
import { resolveBodyFigureVariant, useBodyMapDisplayMode } from './body-map-appearance'

export function periodLoadMapLink(): string {
  return '/me/progress?view=pro&mapMode=load#body-map'
}

/** Home previews the same period load map that opens in Progress. */
export function PeriodLoadMap({ workouts, clientId, periodStart, periodEnd, gender = null }: {
  workouts: readonly Workout[]
  clientId: string
  periodStart: LocalDate
  periodEnd: LocalDate
  gender?: Gender | null
}) {
  const { actor } = useAuth()
  const displayMode = useBodyMapDisplayMode(actor?.userId, actor?.role, clientId, gender)
  const variant = resolveBodyFigureVariant(displayMode, gender)
  const data = useMemo(() => loadBodyMap(workouts, periodStart, periodEnd), [periodEnd, periodStart, workouts])
  const [selectedGroup, setSelectedGroup] = useState<BodyMapZone | undefined>(data.regions[0]?.group)
  const selected = data.regions.find((region) => region.group === selectedGroup) ?? data.regions[0]
  const [side, setSide] = useState<BodyFigureSide>(() => selected ? bodyZoneSides(variant, selected.group)[0] ?? 'front' : 'front')

  useEffect(() => {
    setSelectedGroup((current) => data.regions.some((region) => region.group === current)
      ? current
      : data.regions[0]?.group)
  }, [data])
  useEffect(() => {
    if (!selected) return
    const sides = bodyZoneSides(variant, selected.group)
    if (!sides.includes(side)) setSide(sides[0] ?? 'front')
  }, [selected, side, variant])

  const changeSide = (next: BodyFigureSide) => {
    setSide(next)
    if (selected && bodyZoneSides(variant, selected.group).includes(next)) return
    setSelectedGroup(data.regions.find((region) => bodyZoneSides(variant, region.group).includes(next))?.group)
  }

  return <section className="workout-load-map workout-load-map-compact" aria-label="Нагрузка по телу">
    <h3>Нагрузка по телу</h3>
    <div className="workout-load-map-layout">
      {data.regions.length > 0 ? <MapPanel
          data={data}
          selected={selected}
          insightCandidates={[]}
          variant={variant}
          side={side}
          discovering={false}
          onSideChange={changeSide}
          onSelect={(region) => setSelectedGroup(region.group)}
          onShowDetails={() => undefined}
        /> : <p className="body-progress-empty">{data.emptyMessage}</p>}
    </div>
    <Link className="link" to={periodLoadMapLink()}>Открыть в прогрессе</Link>
  </section>
}

export function ClientBodyMapDisclosure({ workouts, clientId, gender, summary, periodStart, periodEnd, loading, error, onRetry }: {
  workouts?: readonly Workout[]
  clientId: string
  gender?: Gender | null
  summary?: BodyProgressSummary
  periodStart: LocalDate
  periodEnd: LocalDate
  loading: boolean
  error: Error | null
  onRetry: () => void
}) {
  const [params] = useSearchParams()
  const requestedMode: BodyMapMode | undefined = params.get('mapMode') === 'load' ? 'load' : undefined
  const [open, setOpen] = useState(requestedMode === 'load')
  useEffect(() => { if (requestedMode === 'load') setOpen(true) }, [requestedMode])
  const periodSummary: BodyProgressSummary = summary?.periodStart === periodStart && summary.periodEnd === periodEnd
    ? summary
    : { id: `${periodStart}:${periodEnd}`, periodStart, periodEnd, metrics: { progressFacts: [] } }

  return <details id="body-map" className="client-body-map-disclosure card" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <ProgressDetailsSummary description="Прогресс и нагрузка за выбранный период">Карта тела</ProgressDetailsSummary>
    {open && <>
      {error ? <p role="alert">Не удалось загрузить тренировки. <button type="button" className="link" onClick={onRetry}>Повторить</button></p>
        : loading && !workouts ? <p role="status">Загружаем карту…</p>
        : <>
            {summary && summary !== periodSummary && <p className="muted">Для изменений по мышцам обнови анализ за этот период.</p>}
            <p>{formatLocalDate(localDate(periodSummary.periodStart))} — {formatLocalDate(localDate(periodSummary.periodEnd))}</p>
            <TrainingBodyProgressMap
              summary={periodSummary}
              workouts={workouts ?? []}
              clientId={clientId}
              clientGender={gender}
              insightCandidates={[]}
              initialMode={requestedMode}
              loadLoading={loading}
              loadError={error}
              onLoadRetry={onRetry}
            />
          </>}
    </>}
  </details>
}
