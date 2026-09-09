import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import type { Gender, Workout } from '../../shared/domain'
import { formatLocalDate, localDate, type LocalDate } from '../../shared/local-date'
import { Coachmark } from '../../shared/ui'
import { loadBodyMap, setCountLabel, type BodyMapZone, type BodyProgressSummary } from './body-progress-map'
import { MapPanel, TrainingBodyProgressMap } from './ClientBodyProgressMap'
import { bodyZoneSides, type BodyFigureSide } from './body-progress-geometry'
import { resolveBodyFigureVariant, useBodyMapDisplayMode } from './body-map-appearance'

const mapParams = ['mapWorkout', 'mapZone', 'mapMode', 'mapFrom', 'mapTo']

export function workoutMapLink(workout: Workout, zone?: BodyMapZone): string {
  const params = new URLSearchParams({ mapWorkout: workout.id, mapMode: 'load', mapFrom: workout.workoutDate, mapTo: workout.workoutDate })
  if (zone) params.set('mapZone', zone)
  return `/me/progress?${params}#body-map`
}

/** Both Home and the selected-workout disclosure use the same load calculation and figure. */
export function WorkoutLoadMap({ workout, gender = null, compact = false, zone, onZoneChange }: {
  workout: Workout; gender?: Gender | null; compact?: boolean; zone?: string | null; onZoneChange?: (zone: BodyMapZone) => void
}) {
  const { actor } = useAuth()
  const location = useLocation()
  const displayMode = useBodyMapDisplayMode(actor?.userId, actor?.role, workout.clientId, gender)
  const variant = resolveBodyFigureVariant(displayMode, gender)
  const data = useMemo(() => loadBodyMap([workout], workout.workoutDate, workout.workoutDate), [workout])
  const [selectedZone, setSelectedZone] = useState(zone)
  useEffect(() => setSelectedZone(zone), [zone, workout.id])
  const selected = data.regions.find((region) => region.group === selectedZone) ?? data.regions[0]
  const [side, setSide] = useState<BodyFigureSide>('front')
  useEffect(() => {
    if (!selected) return
    const sides = bodyZoneSides(variant, selected.group)
    if (!sides.includes(side)) setSide(sides[0] ?? 'front')
  }, [side, selected, variant])
  const select = (group: BodyMapZone) => { setSelectedZone(group); onZoneChange?.(group) }
  const zoneButton = (region: typeof data.regions[number]) => <button type="button" key={region.group} aria-label={`${region.label}: ${setCountLabel(region.setCount)}`} aria-pressed={region.group === selected?.group} onClick={() => select(region.group)}>
    <span>{region.label}</span><strong>{region.setCount}</strong>
  </button>
  const changeSide = (next: BodyFigureSide) => {
    setSide(next)
    if (selected && bodyZoneSides(variant, selected.group).includes(next)) return
    const nextRegion = data.regions.find((region) => bodyZoneSides(variant, region.group).includes(next))
    if (nextRegion) select(nextRegion.group)
  }
  const selectedDetails = selected && <div className="workout-load-map-selected" role="status">
    <strong>{compact ? setCountLabel(selected.setCount) : selected.label}</strong>
    <p>{selected.percent}% подходов с определённой зоной.</p>
    {!compact && <><p>{selected.primaryDetail}</p><ul>{selected.details.map((detail) => <li key={detail}>{detail}</li>)}</ul></>}
  </div>
  return <section className={`workout-load-map${compact ? ' workout-load-map-compact' : ''}`} aria-label="Распределение подходов">
    {compact ? <Coachmark id="home-body-map-2026-09" userId={actor?.userId} title="Карта теперь на главном" description="Выберите зону и посмотрите, какие подходы пришлись на неё."><h3>Куда пришлась нагрузка</h3></Coachmark> : <h3>Куда пришлась нагрузка</h3>}
    <p className="muted">Подтверждённые подходы по основным зонам.</p>
    {zone && !data.regions.some((region) => region.group === zone) && <p role="status">В выбранной зоне больше нет подтверждённых подходов. Ниже показана актуальная карта этой тренировки.</p>}
    {data.regions.length > 0 && <div className="workout-load-map-layout">
      <MapPanel data={data} selected={selected} insightCandidates={[]} variant={variant} side={side} discovering={false}
        onSideChange={changeSide} onSelect={(region) => select(region.group)} onShowDetails={() => undefined} hideDetail decorative={compact} />
      <div className="workout-load-map-zones" aria-label="Выбрать зону">
        {(compact ? data.regions.slice(0, 3) : data.regions).map(zoneButton)}
        {compact && data.regions.length > 3 && <details><summary>Ещё зоны · {data.regions.length - 3}</summary>{data.regions.slice(3).map(zoneButton)}</details>}
        {compact && selectedDetails}
      </div>
    </div>}
    {!compact && selectedDetails}
    <p className="muted">На карте: {setCountLabel(data.coverage.mappedSets)}. {data.coverage.cardioSets ? `Записи кардио: ${data.coverage.cardioSets}. ` : ''}{data.coverage.unknownSets ? `Без определённой зоны: ${setCountLabel(data.coverage.unknownSets)}. ` : ''}{!data.coverage.totalSets ? 'В этой тренировке пока нет подтверждённых подходов. ' : ''}Карта показывает распределение работы, а не рост или восстановление мышц.</p>
    {compact ? <Link className="link" to={workoutMapLink(workout, selected?.group)}>Разобрать нагрузку</Link>
      : <Link className="link" to={`/workouts/${workout.id}`} state={{ returnTo: location.pathname + location.search + '#body-map' }}>Открыть исходную тренировку</Link>}
  </section>
}

export function ClientBodyMapDisclosure({ workouts, clientId, gender, summary, periodStart, periodEnd, loading, error, onRetry }: {
  workouts?: readonly Workout[]; clientId: string; gender?: Gender | null; summary?: BodyProgressSummary
  periodStart: LocalDate; periodEnd: LocalDate; loading: boolean; error: Error | null; onRetry: () => void
}) {
  const [params, setParams] = useSearchParams()
  const workoutId = params.get('mapWorkout')
  const zone = params.get('mapZone')
  const [open, setOpen] = useState(Boolean(workoutId))
  useEffect(() => { if (workoutId) setOpen(true) }, [workoutId])
  const workout = workouts?.find((item) => item.id === workoutId && item.clientId === clientId && item.status === 'done')
  const invalidScope = workout && (params.get('mapMode') !== 'load' || params.get('mapFrom') !== workout.workoutDate || params.get('mapTo') !== workout.workoutDate)
  const clearScope = () => setParams((current) => { const next = new URLSearchParams(current); mapParams.forEach((key) => next.delete(key)); return next })
  const periodSummary: BodyProgressSummary = summary?.periodStart === periodStart && summary.periodEnd === periodEnd ? summary : { id: `${periodStart}:${periodEnd}`, periodStart, periodEnd, metrics: { progressFacts: [] } }
  return <details id="body-map" className="client-body-map-disclosure card" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Карта тела{workoutId ? ' · выбранная тренировка' : ' · выбранный период'}</summary>
    {open && <>
      {workoutId && <button type="button" className="link" onClick={clearScope}>Перейти к карте за период</button>}
      {error ? <p role="alert">Не удалось загрузить тренировки. <button type="button" className="link" onClick={onRetry}>Повторить</button></p>
        : loading && !workouts ? <p role="status">Загружаем карту…</p>
        : workoutId ? !workout || invalidScope ? <p role="alert">Эта тренировка недоступна или её дата изменилась. Откройте актуальную карту с главного экрана.</p>
          : <><p>{formatLocalDate(workout.workoutDate)} · одна завершённая тренировка</p><WorkoutLoadMap workout={workout} gender={gender} zone={zone} onZoneChange={(nextZone) => setParams((current) => { const next = new URLSearchParams(current); next.set('mapZone', nextZone); return next }, { replace: true })} /></>
        : <>{summary && summary !== periodSummary && <p className="muted">ИИ-анализ сохранён за другие даты. Здесь показаны подходы выбранного периода; изменения по ИИ появятся после обновления анализа.</p>}<p>{formatLocalDate(localDate(periodSummary.periodStart))} — {formatLocalDate(localDate(periodSummary.periodEnd))}</p><TrainingBodyProgressMap summary={periodSummary} workouts={workouts ?? []} clientId={clientId} clientGender={gender} insightCandidates={[]} loadLoading={loading} loadError={error} onLoadRetry={onRetry} /></>}
    </>}
  </details>
}
