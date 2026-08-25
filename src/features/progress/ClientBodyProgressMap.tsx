import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { Gender, PublishedTrainingSummary, Workout } from '../../shared/domain'
import {
  loadBodyMap,
  progressBodyMap,
  type BodyMapData,
  type BodyMapMode,
  type BodyMapRegion,
  type BodyMapZone,
} from './body-progress-map'

interface ZonePosition {
  x: number
  y: number
  width: number
  height: number
}

const ZONE_POSITIONS: Record<BodyMapZone, ZonePosition> = {
  chest: { x: 27, y: 31, width: 26, height: 15 },
  shoulders: { x: 18, y: 25, width: 17, height: 15 },
  biceps: { x: 13, y: 36, width: 12, height: 19 },
  triceps: { x: 86, y: 36, width: 12, height: 19 },
  forearms: { x: 43, y: 45, width: 11, height: 22 },
  core: { x: 27, y: 44, width: 19, height: 22 },
  upper_back: { x: 73, y: 31, width: 27, height: 18 },
  lower_back: { x: 73, y: 43, width: 20, height: 16 },
  glutes: { x: 73, y: 54, width: 23, height: 17 },
  quadriceps: { x: 18, y: 66, width: 13, height: 24 },
  hamstrings: { x: 78, y: 66, width: 14, height: 24 },
  calves: { x: 78, y: 80, width: 12, height: 25 },
  inner_thigh: { x: 29, y: 65, width: 11, height: 21 },
  outer_thigh: { x: 41, y: 65, width: 11, height: 21 },
  arms: { x: 14, y: 40, width: 15, height: 28 },
  legs: { x: 27, y: 68, width: 22, height: 32 },
  back: { x: 73, y: 37, width: 29, height: 27 },
}

function zoneStyle(region: BodyMapRegion): CSSProperties {
  const position = ZONE_POSITIONS[region.group]
  return {
    '--body-zone-x': `${position.x}%`,
    '--body-zone-y': `${position.y}%`,
    '--body-zone-width': `${Math.round(position.width * 3.2)}px`,
    '--body-zone-height': `${Math.round(position.height * 3.2)}px`,
    '--body-zone-strength': `${Math.round(region.intensity * 42)}%`,
  } as CSSProperties
}

function MapPanel({ data, selected, gender, onSelect }: {
  data: BodyMapData
  selected: BodyMapRegion | undefined
  gender: Gender | null
  onSelect: (region: BodyMapRegion) => void
}) {
  const image = gender === 'female'
    ? '/illustrations/body-progress-athlete-female.png'
    : '/illustrations/body-progress-athlete.png'
  const alt = gender === 'female'
    ? 'Атлетичная женщина, вид спереди и сзади'
    : 'Атлетичный мужчина, вид спереди и сзади'

  return <>
    <div className="body-progress-visual">
      <img src={image} alt={alt} />
      {data.regions.map((region) => <button
        type="button"
        key={region.group}
        className={`body-progress-zone${selected?.group === region.group ? ' selected' : ''}`}
        style={zoneStyle(region)}
        aria-label={`${region.label}: ${region.valueLabel}`}
        aria-pressed={selected?.group === region.group}
        onClick={() => onSelect(region)}
      ><span aria-hidden="true" /></button>)}
    </div>
    {data.regions.length === 0 && <p className="body-progress-empty">{data.emptyMessage}</p>}
    {selected && <div className="body-progress-detail" role="status">
      <div><strong>{selected.label}</strong><span>{selected.valueLabel}</span></div>
      <small>{selected.summaryLabel}</small>
      {selected.details.map((detail) => <p key={detail}>{detail}</p>)}
    </div>}
  </>
}

export function ClientBodyProgressMap({ summary, workouts, gender = null, loadLoading, loadError, onLoadRetry }: {
  summary: PublishedTrainingSummary
  workouts: readonly Workout[]
  gender?: Gender | null
  loadLoading: boolean
  loadError: Error | null
  onLoadRetry: () => void
}) {
  const progress = useMemo(() => progressBodyMap(summary), [summary])
  const load = useMemo(() => loadBodyMap(workouts, summary.periodStart, summary.periodEnd), [summary, workouts])
  const initialMode: BodyMapMode = progress.regions.length > 0 ? 'progress' : 'load'
  const [mode, setMode] = useState<BodyMapMode>(initialMode)
  const data = mode === 'progress' ? progress : load
  const [selectedGroup, setSelectedGroup] = useState<BodyMapZone | undefined>(data.regions[0]?.group)

  useEffect(() => {
    setMode(initialMode)
  }, [initialMode, summary.id])
  useEffect(() => {
    setSelectedGroup(data.regions[0]?.group)
  }, [data])

  const selected = data.regions.find((region) => region.group === selectedGroup) ?? data.regions[0]
  return <section className="body-progress-map" aria-labelledby="body-progress-title">
    <header>
      <div><span>Карта тела</span><h3 id="body-progress-title">{data.title}</h3><p>{data.description}</p></div>
      <div className="body-progress-modes" aria-label="Режим карты">
        <button type="button" aria-pressed={mode === 'progress'} onClick={() => setMode('progress')}>Прогресс</button>
        <button type="button" aria-pressed={mode === 'load'} onClick={() => setMode('load')}>Работа</button>
      </div>
    </header>
    {mode === 'load' && loadError
      ? <div className="body-progress-empty" role="alert">
        <span>Не удалось собрать работу по тренировкам.</span>
        <button type="button" className="link" onClick={onLoadRetry}>Попробовать ещё раз</button>
      </div>
      : mode === 'load' && loadLoading
      ? <p className="body-progress-empty" role="status">Собираем работу по тренировкам…</p>
      : <MapPanel data={data} selected={selected} gender={gender} onSelect={(region) => setSelectedGroup(region.group)} />}
  </section>
}
