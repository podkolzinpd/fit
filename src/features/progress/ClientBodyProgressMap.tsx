import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type TouchEvent } from 'react'
import type { Gender, Workout } from '../../shared/domain'
import { useAuth } from '../../app/auth-context'
import { ChevronRightIcon, CloseIcon } from '../../shared/icons'
import {
  loadBodyMap,
  progressBodyMap,
  workoutProgressBodyMap,
  type BodyMapData,
  type BodyMapMode,
  type BodyMapRegion,
  type BodyProgressSummary,
  type BodyMapZone,
} from './body-progress-map'
import {
  bodyFigureCanvas,
  bodyFigureClipBox,
  bodyFigureViewBox,
  bodyZoneShapes,
  bodyZoneSides,
  type BodyFigureSide,
  type BodyFigureVariant,
  type BodyZoneShape,
} from './body-progress-geometry'
import { resolveBodyFigureVariant, useBodyMapDisplayMode } from './body-map-appearance'
import { bodyMapInsight } from './body-map-insight'

const BODY_FIGURES: Record<Exclude<BodyFigureVariant, 'neutral'>, { image: string; alt: Record<BodyFigureSide, string> }> = {
  male: {
    image: '/illustrations/body-progress-athlete.png',
    alt: { front: 'Атлетичный мужчина, вид спереди', back: 'Атлетичный мужчина, вид сзади' },
  },
  female: {
    image: '/illustrations/body-progress-athlete-female.png',
    alt: { front: 'Атлетичная женщина, вид спереди', back: 'Атлетичная женщина, вид сзади' },
  },
}

function shapeTransform(shape: BodyZoneShape): string | undefined {
  return shape.rotate ? `rotate(${shape.rotate} ${shape.cx} ${shape.cy})` : undefined
}

function regionAriaLabel(region: BodyMapRegion): string {
  return `${region.label}. ${region.metricLabel}: ${region.valueLabel}`
}

function exercisesCountLabel(count: number): string {
  if (count % 10 === 1 && count % 100 !== 11) return 'упражнение'
  if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)) return 'упражнения'
  return 'упражнений'
}

function BodyPrimaryDetail({ detail }: { detail: string }) {
  const separator = detail.indexOf(' · ')
  return <p className="body-progress-primary-detail">{separator < 0 ? detail : <>
    <span>{detail.slice(0, separator)}</span>
    <span className="body-progress-metric-detail">{detail.slice(separator + 3)}</span>
  </>}</p>
}

function RegionShapes({ shapes, className }: { shapes: readonly BodyZoneShape[]; className: string }) {
  return <>{shapes.map((shape, index) => shape.path
    ? <path key={`${shape.cx}-${shape.cy}-${index}`} className={className} d={shape.path} />
    : <ellipse
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

function BodyRegion({ region, variant, side, selected, mode, onSelect, decorative = false }: {
  region: BodyMapRegion
  variant: BodyFigureVariant
  side: BodyFigureSide
  selected: boolean
  mode: BodyMapMode
  decorative?: boolean
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
    role={decorative ? undefined : "button"}
    tabIndex={decorative ? undefined : 0}
    aria-label={regionAriaLabel(region)}
    aria-pressed={selected}
    className={`body-progress-region body-progress-region-${mode}${selected ? ' selected' : ''}`}
    data-body-zone={region.group}
    style={{ '--body-zone-opacity': mode === 'load' ? .05 + region.intensity * .1 : .04 + region.intensity * .06 } as CSSProperties}
    onClick={decorative ? undefined : onSelect}
    onKeyDown={decorative ? undefined : selectFromKeyboard}
  >
    <g className="body-progress-region-fill"><RegionShapes shapes={shapes} className="body-progress-region-shape" /></g>
    <RegionShapes shapes={shapes} className="body-progress-region-hit" />
  </g>
}

export function MapPanel({ data, selected, insightCandidates, variant, side, onSideChange, onSelect, onShowDetails, hideDetail = false, decorative = false, compact = false, detailFooter }: {
  data: BodyMapData
  selected: BodyMapRegion | undefined
  insightCandidates: readonly string[]
  variant: BodyFigureVariant
  side: BodyFigureSide
  onSideChange: (side: BodyFigureSide) => void
  onSelect: (region: BodyMapRegion) => void
  onShowDetails: () => void
  hideDetail?: boolean
  decorative?: boolean
  compact?: boolean
  detailFooter?: ReactNode
}) {
  const figure = variant === 'neutral' ? null : BODY_FIGURES[variant]
  const [failedImage, setFailedImage] = useState<string | null>(null)
  const listOnly = !figure || failedImage === figure.image
  const canvas = bodyFigureCanvas(variant)
  const clipBox = bodyFigureClipBox(variant, side)
  const clipId = `body-progress-clip-${useId().replace(/:/g, '')}`
  const maskId = `body-progress-mask-${useId().replace(/:/g, '')}`
  const swipeStartX = useRef<number | null>(null)
  const insight = selected ? bodyMapInsight(data, selected, insightCandidates) : null
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
  // Broad fallback zones must never cover the specific muscles' hit targets.
  const isBroad = (zone: BodyMapZone) => zone === 'arms' || zone === 'legs' || zone === 'back'
  const paintedRegions = [...regionsBySide[side]].sort((left, right) => Number(isBroad(right.group)) - Number(isBroad(left.group)))
  const zoneList = <div className="body-progress-zone-list" role="group" aria-label="Зоны тела">
    {data.regions.map((region) => <button key={region.group} type="button" aria-label={regionAriaLabel(region)} aria-pressed={selected?.group === region.group} onClick={() => onSelect(region)}>
      <span>{region.label}</span><strong>{region.valueLabel}</strong>
    </button>)}
  </div>

  if (data.regions.length === 0) return <p className="body-progress-empty">{data.emptyMessage}</p>

  return <div className={`body-progress-panel${compact ? ' body-progress-panel-compact' : ''}${listOnly ? ' is-list' : ''}`}>
    <div className="body-progress-main">
    {listOnly ? <div className="body-progress-list-fallback">
      {figure && <p className="muted">Не удалось загрузить фигуру. Выберите зону из списка.</p>}
      {zoneList}
    </div> : <div className="body-progress-figure-shell">
      {canSwitchSide && <div className="body-progress-sides" aria-label="Сторона тела">
        <button type="button" aria-pressed={side === 'front'} disabled={regionsBySide.front.length === 0} onClick={() => onSideChange('front')}>Спереди</button>
        <button type="button" aria-pressed={side === 'back'} disabled={regionsBySide.back.length === 0} onClick={() => onSideChange('back')}>Сзади</button>
      </div>}
      <div
        className={`body-progress-visual mode-${data.mode} figure-${variant}`}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <svg className="body-progress-overlay" viewBox={bodyFigureViewBox(variant, side)} role="group" aria-label={figure.alt[side]} aria-hidden={decorative || undefined}>
          <title>{figure.alt[side]}</title>
          <defs>
            <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
              <rect {...clipBox} />
            </clipPath>
            <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width={canvas.width} height={canvas.height} style={{ maskType: 'alpha' }}>
              <image href={figure.image} width={canvas.width} height={canvas.height} preserveAspectRatio="none" clipPath={`url(#${clipId})`} />
            </mask>
          </defs>
          <image className="body-progress-figure-image" href={figure.image} width={canvas.width} height={canvas.height} preserveAspectRatio="none" clipPath={`url(#${clipId})`} aria-hidden="true" onError={() => setFailedImage(figure.image)} />
          <g mask={`url(#${maskId})`} clipPath={`url(#${clipId})`}>
            {paintedRegions.map((region) => <BodyRegion
              key={region.group}
              region={region}
              variant={variant}
              side={side}
              selected={selected?.group === region.group}
              mode={data.mode}
              decorative={decorative}
              onSelect={() => onSelect(region)}
            />)}
          </g>
        </svg>
      </div>
    </div>}
    {!hideDetail && selected && data.mode === 'load' && <div className="body-progress-detail body-progress-load-value" role="status">
      <div className="body-progress-detail-heading">
        <strong>{selected.label}</strong>
        <span>{selected.valueLabel}</span>
      </div>
      {detailFooter}
    </div>}
    {!hideDetail && selected && data.mode === 'progress' && insight && <div
      className="body-progress-detail"
      role="status"
      data-fact-id={insight.factId}
      data-copy-source={insight.source}
    >
      <div className="body-progress-detail-heading">
        <strong>{selected.label}</strong>
        <span>{selected.valueLabel}</span>
      </div>
      <BodyPrimaryDetail detail={selected.primaryDetail} />
      {insight.source === 'llm' && <p>{insight.text}</p>}
      <button type="button" className="link body-progress-more body-progress-action-row" onClick={onShowDetails}>
        <span>Показать {selected.details.length + (data.mode === 'progress' ? 1 : 0)} {exercisesCountLabel(selected.details.length + (data.mode === 'progress' ? 1 : 0))}</span>
        <ChevronRightIcon />
      </button>
    </div>}
    </div>
    {!listOnly && !decorative && <details className="body-progress-zone-picker"><summary>Выбрать зону</summary>{zoneList}</details>}
  </div>
}

export function TrainingBodyProgressMap({ summary, workouts, clientId, insightCandidates, clientGender = null, loadLoading, loadError, onLoadRetry, initialMode }: {
  summary: BodyProgressSummary
  workouts: readonly Workout[]
  clientId: string
  insightCandidates: readonly string[]
  clientGender?: Gender | null
  loadLoading: boolean
  loadError: Error | null
  onLoadRetry: () => void
  initialMode?: BodyMapMode
}) {
  const { actor } = useAuth()
  const displayMode = useBodyMapDisplayMode(actor?.userId, actor?.role, clientId, clientGender)
  const variant = resolveBodyFigureVariant(displayMode, clientGender)
  const recordedProgress = useMemo(() => workoutProgressBodyMap(workouts, summary.periodStart, summary.periodEnd), [summary.periodEnd, summary.periodStart, workouts])
  const summaryProgress = useMemo(() => progressBodyMap(summary), [summary])
  const progress = recordedProgress.regions.length > 0 ? recordedProgress : summaryProgress
  const load = useMemo(() => loadBodyMap(workouts, summary.periodStart, summary.periodEnd), [summary, workouts])
  const defaultMode: BodyMapMode = initialMode ?? (progress.regions.length > 0 ? 'progress' : 'load')
  const [mode, setMode] = useState<BodyMapMode>(defaultMode)
  const data = mode === 'progress' ? progress : load
  const [selectedGroup, setSelectedGroup] = useState<BodyMapZone | undefined>(data.regions[0]?.group)
  const [side, setSide] = useState<BodyFigureSide>(() => {
    const firstGroup = data.regions[0]?.group
    return firstGroup ? bodyZoneSides(variant, firstGroup)[0] ?? 'front' : 'front'
  })
  const [detailsOpen, setDetailsOpen] = useState(false)
  useEffect(() => {
    setMode(defaultMode)
  }, [defaultMode, summary.id])
  useEffect(() => {
    setSelectedGroup((current) => data.regions.some((region) => region.group === current)
      ? current
      : data.regions[0]?.group)
    setDetailsOpen(false)
  }, [data])

  const selected = data.regions.find((region) => region.group === selectedGroup) ?? data.regions[0]
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
      <div><span>Карта тела</span><h3 id="body-progress-title">{data.title}</h3>{data.description && <p>{data.description}</p>}</div>
      <div className="body-progress-modes" aria-label="Режим карты">
        <button type="button" aria-pressed={mode === 'progress'} onClick={() => setMode('progress')}>Прогресс</button>
        <button type="button" aria-pressed={mode === 'load'} onClick={() => setMode('load')}>Нагрузка</button>
      </div>
    </header>
    {mode === 'load' && loadError
      ? <div className="body-progress-empty" role="alert">
        <span>Не удалось загрузить карту.</span>
        <button type="button" className="link" onClick={onLoadRetry}>Попробовать ещё раз</button>
      </div>
      : mode === 'load' && loadLoading
      ? <p className="body-progress-empty" role="status">Загружаем карту…</p>
      : <MapPanel
          data={data}
          selected={selected}
          insightCandidates={insightCandidates}
          variant={variant}
          side={side}
          onSideChange={changeSide}
          onSelect={(region) => setSelectedGroup(region.group)}
          onShowDetails={() => setDetailsOpen(true)}
        />}
    {detailsOpen && selected && mode === 'progress' && <BodyDetailsSheet region={selected} onClose={() => setDetailsOpen(false)} />}
  </section>
}
