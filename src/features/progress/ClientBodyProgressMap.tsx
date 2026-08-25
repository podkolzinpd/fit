import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { PublishedTrainingSummary, Workout } from '../../shared/domain'
import { loadBodyMap, progressBodyMap, type BodyMapData, type BodyMapMode, type BodyMapRegion } from './body-progress-map'

const ZONE_POSITIONS: Record<string, { x: number; y: number }> = {
  shoulders: { x: 28, y: 26 },
  chest: { x: 27, y: 33 },
  arms: { x: 15, y: 40 },
  core: { x: 28, y: 46 },
  back: { x: 73, y: 33 },
  glutes: { x: 73, y: 53 },
  legs: { x: 28, y: 68 },
}

function zoneStyle(region: BodyMapRegion): CSSProperties {
  const position = ZONE_POSITIONS[region.group] ?? { x: 50, y: 50 }
  return {
    '--body-zone-x': `${position.x}%`,
    '--body-zone-y': `${position.y}%`,
    '--body-zone-strength': `${Math.round(region.intensity * 58)}%`,
  } as CSSProperties
}

function MapPanel({ data, selected, onSelect }: {
  data: BodyMapData
  selected: BodyMapRegion | undefined
  onSelect: (region: BodyMapRegion) => void
}) {
  const highlighted = data.regions.slice(0, 3)
  return <>
    <div className="body-progress-visual">
      <img src="/illustrations/body-progress-athlete.png" alt="Атлет, вид спереди и сзади" />
      {highlighted.map((region) => <button
        type="button"
        key={region.group}
        className={`body-progress-zone${selected?.group === region.group ? ' selected' : ''}`}
        style={zoneStyle(region)}
        aria-label={`${region.label}: ${region.valueLabel}`}
        aria-pressed={selected?.group === region.group}
        onClick={() => onSelect(region)}
      ><span>{region.valueLabel}</span></button>)}
    </div>
    {data.regions.length > 0 ? <div className={`body-progress-ranking count-${Math.min(3, data.regions.length)}`} aria-label="Главные зоны">
      {data.regions.slice(0, 3).map((region, index) => <button
        type="button"
        key={region.group}
        className={selected?.group === region.group ? 'selected' : ''}
        aria-pressed={selected?.group === region.group}
        onClick={() => onSelect(region)}
      ><span>{index + 1}</span><strong>{region.label}</strong><b>{region.valueLabel}</b></button>)}
    </div> : <p className="body-progress-empty">{data.emptyMessage}</p>}
    {selected && <div className="body-progress-detail" role="status">
      <div><strong>{selected.label}</strong><span>{selected.valueLabel}</span></div>
      {selected.details.map((detail) => <p key={detail}>{detail}</p>)}
    </div>}
  </>
}

export function ClientBodyProgressMap({ summary, workouts, loadLoading, loadError, onLoadRetry }: {
  summary: PublishedTrainingSummary
  workouts: readonly Workout[]
  loadLoading: boolean
  loadError: Error | null
  onLoadRetry: () => void
}) {
  const progress = useMemo(() => progressBodyMap(summary), [summary])
  const load = useMemo(() => loadBodyMap(workouts, summary.periodStart, summary.periodEnd), [summary, workouts])
  const initialMode: BodyMapMode = progress.regions.length > 0 ? 'progress' : 'load'
  const [mode, setMode] = useState<BodyMapMode>(initialMode)
  const data = mode === 'progress' ? progress : load
  const [selectedGroup, setSelectedGroup] = useState<string | undefined>(data.regions[0]?.group)

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
        <button type="button" aria-pressed={mode === 'load'} onClick={() => setMode('load')}>Нагрузка</button>
      </div>
    </header>
    {mode === 'load' && loadError
      ? <div className="body-progress-empty" role="alert">
        <span>Не удалось собрать нагрузку по тренировкам.</span>
        <button type="button" className="link" onClick={onLoadRetry}>Попробовать ещё раз</button>
      </div>
      : mode === 'load' && loadLoading
      ? <p className="body-progress-empty" role="status">Собираем нагрузку по тренировкам…</p>
      : <MapPanel data={data} selected={selected} onSelect={(region) => setSelectedGroup(region.group)} />}
  </section>
}
