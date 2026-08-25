import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type TouchEvent } from 'react'
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
import {
  bodyFigureVariant,
  bodyFigureViewBox,
  bodyZoneShapes,
  bodyZoneSides,
  type BodyFigureSide,
  type BodyFigureVariant,
  type BodyZoneShape,
} from './body-progress-geometry'

const BODY_FIGURES: Record<BodyFigureVariant, { image: string; alt: Record<BodyFigureSide, string> }> = {
  male: {
    image: '/illustrations/body-progress-athlete.png',
    alt: { front: 'Атлетичный мужчина, вид спереди', back: 'Атлетичный мужчина, вид сзади' },
  },
  female: {
    image: '/illustrations/body-progress-athlete-female.png',
    alt: { front: 'Атлетичная женщина, вид спереди', back: 'Атлетичная женщина, вид сзади' },
  },
  neutral: {
    image: '/illustrations/body-progress-athlete-neutral.svg',
    alt: { front: 'Нейтральная фигура спортсмена, вид спереди', back: 'Нейтральная фигура спортсмена, вид сзади' },
  },
}

function shapeTransform(shape: BodyZoneShape): string | undefined {
  return shape.rotate ? `rotate(${shape.rotate} ${shape.cx} ${shape.cy})` : undefined
}

function regionStyle(region: BodyMapRegion, index: number, mode: BodyMapMode): CSSProperties {
  return {
    '--body-zone-intensity': region.intensity,
    '--body-zone-base-opacity': mode === 'load'
      ? 0.07 + region.intensity * 0.08
      : 0.045 + region.intensity * 0.045,
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

function BodyRegion({ region, variant, side, selected, mode, index, filterId, onSelect }: {
  region: BodyMapRegion
  variant: BodyFigureVariant
  side: BodyFigureSide
  selected: boolean
  mode: BodyMapMode
  index: number
  filterId: string
  onSelect: () => void
}) {
  const shapes = bodyZoneShapes(variant, region.group, side)
  if (shapes.length === 0) return null
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
    data-body-zone={region.group}
    style={regionStyle(region, index, mode)}
    onClick={onSelect}
    onKeyDown={selectFromKeyboard}
  >
    <g className="body-progress-region-fill" filter={`url(#${filterId})`}><RegionShapes shapes={shapes} className="body-progress-region-shape" /></g>
    <RegionShapes shapes={shapes} className="body-progress-region-hit" />
  </g>
}

function MapPanel({ data, selected, gender, side, discovering, onSideChange, onSelect, onShowDetails }: {
  data: BodyMapData
  selected: BodyMapRegion | undefined
  gender: Gender | null
  side: BodyFigureSide
  discovering: boolean
  onSideChange: (side: BodyFigureSide) => void
  onSelect: (region: BodyMapRegion) => void
  onShowDetails: () => void
}) {
  const variant = bodyFigureVariant(gender)
  const figure = BODY_FIGURES[variant]
  const maskId = `body-progress-mask-${useId().replace(/:/g, '')}`
  const filterId = `body-progress-soft-${useId().replace(/:/g, '')}`
  const swipeStartX = useRef<number | null>(null)
  const visibleSecondary = selected?.details[0]
  const hiddenCount = selected ? Math.max(0, selected.details.length - 1) : 0
  const regionsBySide = useMemo(() => ({
    front: data.regions.filter((region) => bodyZoneShapes(variant, region.group, 'front').length > 0),
    back: data.regions.filter((region) => bodyZoneShapes(variant, region.group, 'back').length > 0),
  }), [data.regions, variant])
  const onTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    swipeStartX.current = event.changedTouches[0]?.clientX ?? null
  }
  const onTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    if (swipeStartX.current === null) return
    const delta = (event.changedTouches[0]?.clientX ?? swipeStartX.current) - swipeStartX.current
    swipeStartX.current = null
    if (Math.abs(delta) < 44) return
    const nextSide: BodyFigureSide = delta < 0 ? 'back' : 'front'
    if (regionsBySide[nextSide].length > 0) onSideChange(nextSide)
  }
  const canSwitchSide = regionsBySide.front.length > 0 && regionsBySide.back.length > 0

  return <>
    <div className="body-progress-figure-shell">
      {canSwitchSide && <div className="body-progress-sides" aria-label="Сторона тела">
        <button type="button" aria-pressed={side === 'front'} disabled={regionsBySide.front.length === 0} onClick={() => onSideChange('front')}>Спереди</button>
        <button type="button" aria-pressed={side === 'back'} disabled={regionsBySide.back.length === 0} onClick={() => onSideChange('back')}>Сзади</button>
      </div>}
      <div
        className={`body-progress-visual mode-${data.mode}${discovering ? ' discovering' : ''}`}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <img className={`body-progress-figure side-${side}`} src={figure.image} alt={figure.alt[side]} />
        <svg className="body-progress-overlay" viewBox={bodyFigureViewBox(side)} aria-label="Интерактивная карта тела">
          <defs>
            <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="952" height="1000" style={{ maskType: 'alpha' }}>
              <image href={figure.image} width="952" height="1000" preserveAspectRatio="none" />
            </mask>
            <filter id={filterId} x="-18%" y="-18%" width="136%" height="136%" colorInterpolationFilters="sRGB">
              <feGaussianBlur stdDeviation="2.5" />
            </filter>
          </defs>
          <g mask={`url(#${maskId})`}>
            {regionsBySide[side].map((region, index) => <BodyRegion
              key={region.group}
              region={region}
              variant={variant}
              side={side}
              selected={selected?.group === region.group}
              mode={data.mode}
              index={index}
              filterId={filterId}
              onSelect={() => onSelect(region)}
            />)}
          </g>
        </svg>
      </div>
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
  const [side, setSide] = useState<BodyFigureSide>('front')
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
  const variant = bodyFigureVariant(gender)
  useEffect(() => {
    if (!selected) return
    const sides = bodyZoneSides(variant, selected.group)
    if (sides.includes(side)) return
    setSide(sides[0] ?? 'front')
  }, [selected, side, variant])
  const changeSide = (nextSide: BodyFigureSide) => {
    setSide(nextSide)
    if (selected && bodyZoneShapes(variant, selected.group, nextSide).length > 0) return
    setSelectedGroup(data.regions.find((region) => bodyZoneShapes(variant, region.group, nextSide).length > 0)?.group)
  }
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
          side={side}
          discovering={discovering}
          onSideChange={changeSide}
          onSelect={(region) => setSelectedGroup(region.group)}
          onShowDetails={() => setDetailsOpen(true)}
        />}
    {detailsOpen && selected && <BodyDetailsSheet region={selected} onClose={() => setDetailsOpen(false)} />}
  </section>
}
