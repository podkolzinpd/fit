import { useEffect, useId, useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react'
import type { Gender, PublishedTrainingSummary, Workout } from '../../shared/domain'
import { CloseIcon } from '../../shared/icons'
import {
  loadBodyMap,
  progressBodyMap,
  type BodyMapData,
  type BodyMapMode,
  type BodyMapRegion,
  type BodyMapZone,
} from './body-progress-map'
import { bodyFigureVariant, bodyZoneShapes, type BodyFigureVariant, type BodyZoneShape } from './body-progress-geometry'

const BODY_FIGURES: Record<BodyFigureVariant, { image: string; alt: string }> = {
  male: {
    image: '/illustrations/body-progress-athlete.png',
    alt: 'Атлетичный мужчина, вид спереди и сзади',
  },
  female: {
    image: '/illustrations/body-progress-athlete-female.png',
    alt: 'Атлетичная женщина, вид спереди и сзади',
  },
  neutral: {
    image: '/illustrations/body-progress-athlete-neutral.svg',
    alt: 'Нейтральная фигура спортсмена, вид спереди и сзади',
  },
}

function shapeTransform(shape: BodyZoneShape): string | undefined {
  return shape.rotate ? `rotate(${shape.rotate} ${shape.cx} ${shape.cy})` : undefined
}

function regionStyle(region: BodyMapRegion, index: number): CSSProperties {
  return {
    '--body-zone-intensity': region.intensity,
    '--body-zone-load-opacity': 0.12 + region.intensity * 0.28,
    '--body-zone-delay': `${index * 55}ms`,
  } as CSSProperties
}

function regionAriaLabel(region: BodyMapRegion): string {
  return `${region.label}. ${region.metricLabel}: ${region.valueLabel}`
}

function exercisesCountLabel(count: number): string {
  if (count % 10 === 1 && count % 100 !== 11) return 'упражнение'
  if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)) return 'упражнения'
  return 'упражнений'
}

function RegionShapes({ shapes, className }: { shapes: readonly BodyZoneShape[]; className: string }) {
  return <>{shapes.map((shape, index) => <ellipse
    key={`${shape.cx}-${shape.cy}-${index}`}
    className={className}
    cx={shape.cx}
    cy={shape.cy}
    rx={shape.rx}
    ry={shape.ry}
    transform={shapeTransform(shape)}
  />)}</>
}

function BodyDetailsSheet({ region, onClose }: { region: BodyMapRegion; onClose: () => void }) {
  return <div className="sheet-overlay" onClick={onClose}>
    <section className="ai-progress-sheet body-progress-sheet" role="dialog" aria-modal="true" aria-label={region.label} onClick={(event) => event.stopPropagation()}>
      <header><div><small>{region.metricLabel}</small><h2>{region.label}</h2></div><button type="button" className="picker-close" aria-label="Закрыть" onClick={onClose}><CloseIcon /></button></header>
      <div className="ai-progress-sheet-content">
        <strong className="body-progress-sheet-value">{region.valueLabel}</strong>
        <div className="ai-progress-sheet-list">
          <p>{region.primaryDetail}</p>
          {region.details.map((detail) => <p key={detail}>{detail}</p>)}
        </div>
      </div>
    </section>
  </div>
}

function BodyRegion({ region, variant, selected, mode, index, filterId, onSelect }: {
  region: BodyMapRegion
  variant: BodyFigureVariant
  selected: boolean
  mode: BodyMapMode
  index: number
  filterId: string
  onSelect: () => void
}) {
  const shapes = bodyZoneShapes(variant, region.group)
  const selectFromKeyboard = (event: KeyboardEvent<SVGGElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onSelect()
  }
  return <g
    role="button"
    tabIndex={0}
    aria-label={regionAriaLabel(region)}
    aria-pressed={selected}
    className={`body-progress-region body-progress-region-${mode}${selected ? ' selected' : ''}`}
    style={regionStyle(region, index)}
    onClick={onSelect}
    onKeyDown={selectFromKeyboard}
  >
    <g className="body-progress-region-fill" filter={`url(#${filterId})`}><RegionShapes shapes={shapes} className="body-progress-region-shape" /></g>
    <RegionShapes shapes={shapes} className="body-progress-region-hit" />
  </g>
}

function MapPanel({ data, selected, gender, discovering, onSelect, onShowDetails }: {
  data: BodyMapData
  selected: BodyMapRegion | undefined
  gender: Gender | null
  discovering: boolean
  onSelect: (region: BodyMapRegion) => void
  onShowDetails: () => void
}) {
  const variant = bodyFigureVariant(gender)
  const figure = BODY_FIGURES[variant]
  const maskId = `body-progress-mask-${useId().replace(/:/g, '')}`
  const filterId = `body-progress-soft-${useId().replace(/:/g, '')}`
  const visibleSecondary = selected?.details[0]
  const hiddenCount = selected ? Math.max(0, selected.details.length - 1) : 0

  return <>
    <div className={`body-progress-visual mode-${data.mode}${discovering ? ' discovering' : ''}`}>
      <img src={figure.image} alt={figure.alt} />
      <svg className="body-progress-overlay" viewBox="0 0 952 1000" aria-label="Интерактивная карта тела">
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse" style={{ maskType: 'alpha' }}>
            <image href={figure.image} width="952" height="1000" preserveAspectRatio="xMidYMid meet" />
          </mask>
          <filter id={filterId} x="-25%" y="-25%" width="150%" height="150%" colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation="9" />
          </filter>
        </defs>
        <g mask={`url(#${maskId})`}>
          {data.regions.map((region, index) => <BodyRegion
            key={region.group}
            region={region}
            variant={variant}
            selected={selected?.group === region.group}
            mode={data.mode}
            index={index}
            filterId={filterId}
            onSelect={() => onSelect(region)}
          />)}
        </g>
      </svg>
    </div>
    {data.regions.length === 0 && <p className="body-progress-empty">{data.emptyMessage}</p>}
    {selected && <div className="body-progress-detail" role="status">
      <div className="body-progress-detail-heading">
        <div><small>{selected.metricLabel}</small><strong>{selected.label}</strong></div>
        <span>{selected.valueLabel}</span>
      </div>
      <p className="body-progress-primary-detail">{selected.primaryDetail}</p>
      {visibleSecondary && <p>{visibleSecondary}</p>}
      {hiddenCount > 0 && <button type="button" className="link body-progress-more" onClick={onShowDetails}>Ещё {hiddenCount} {exercisesCountLabel(hiddenCount)}</button>}
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
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [discovering, setDiscovering] = useState(true)

  useEffect(() => {
    setMode(initialMode)
    setDiscovering(true)
    const timer = window.setTimeout(() => setDiscovering(false), 900)
    return () => window.clearTimeout(timer)
  }, [initialMode, summary.id])
  useEffect(() => {
    setSelectedGroup((current) => data.regions.some((region) => region.group === current)
      ? current
      : data.regions[0]?.group)
    setDetailsOpen(false)
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
      : <MapPanel
          data={data}
          selected={selected}
          gender={gender}
          discovering={discovering}
          onSelect={(region) => setSelectedGroup(region.group)}
          onShowDetails={() => setDetailsOpen(true)}
        />}
    {detailsOpen && selected && <BodyDetailsSheet region={selected} onClose={() => setDetailsOpen(false)} />}
  </section>
}
