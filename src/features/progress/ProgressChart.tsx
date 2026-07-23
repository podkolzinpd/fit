import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ProgressEntry } from '../../shared/domain'
import { formatLocalDate, localDate, type LocalDate } from '../../shared/local-date'

export type MetricKey = 'weightKg' | 'chestCm' | 'waistCm' | 'hipCm'

const WINDOW_DAYS = 28

export function addDays(date: LocalDate, days: number): LocalDate {
  const [year, month, day] = date.split('-').map(Number)
  const next = new Date(year ?? 0, (month ?? 1) - 1, day)
  next.setDate(next.getDate() + days)
  const y = next.getFullYear(); const m = String(next.getMonth() + 1).padStart(2, '0'); const d = String(next.getDate()).padStart(2, '0')
  return localDate(`${y}-${m}-${d}`)
}

export function clampDate(date: LocalDate, min: LocalDate, max: LocalDate): LocalDate {
  if (date < min) return min
  if (date > max) return max
  return date
}

export function computeYDomain(values: number[]): [number, number] {
  const min = Math.min(...values); const max = Math.max(...values)
  if (min === max) { const pad = Math.max(Math.abs(min) * 0.1, 1); return [min - pad, max + pad] }
  const range = max - min; const pad = range * 0.15
  return [Math.floor(min - pad), Math.ceil(max + pad)]
}

export function formatShortDate(date: LocalDate): string {
  const [, month, day] = date.split('-').map(Number)
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(new Date(2000, (month ?? 1) - 1, day))
}

export function formatAxisTick(date: LocalDate): [string, string] {
  const [, month, day] = date.split('-').map(Number)
  const asDate = new Date(2000, (month ?? 1) - 1, day)
  return [
    new Intl.DateTimeFormat('ru-RU', { day: '2-digit' }).format(asDate),
    new Intl.DateTimeFormat('ru-RU', { month: 'short' }).format(asDate).replace('.', ''),
  ]
}

export function formatTooltipValue(value: number, unit: string, label: string): [string, string] {
  return [`${value} ${unit}`, label]
}

export function formatTooltipLabel(date: string): string {
  return formatLocalDate(localDate(date))
}

export function AxisTick({ x, y, payload }: { x?: number | string; y?: number | string; payload?: { value: string } }) {
  const [day, month] = formatAxisTick(localDate(payload?.value ?? '1970-01-01'))
  return <g transform={`translate(${x},${y})`}>
    <text dy={12} textAnchor="middle" fontSize={12} fill="var(--muted)">{day}</text>
    <text dy={26} textAnchor="middle" fontSize={10} fill="var(--muted)">{month}</text>
  </g>
}

export function renderChartDot(props: { cx?: number; cy?: number; index?: number; payload?: { value: number } }, minIndex: number, maxIndex: number, total: number) {
  const { cx, cy, index, payload } = props
  if (cx === undefined || cy === undefined || index === undefined) return <g key={index} />
  const isMax = index === maxIndex; const isMin = index === minIndex && minIndex !== maxIndex
  if (!isMax && !isMin) return <circle key={index} cx={cx} cy={cy} r={5} fill="var(--accent)" />
  const dy = isMax ? -12 : 18
  const isFirst = index === 0; const isLast = index === total - 1
  const textAnchor = isFirst ? 'start' : isLast ? 'end' : 'middle'
  const textX = isFirst ? cx + 6 : isLast ? cx - 6 : cx
  return <g key={index}>
    <circle cx={cx} cy={cy} r={6} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
    <text x={textX} y={cy + dy} textAnchor={textAnchor} fontSize={12} fontWeight={600} fill="var(--accent)">{payload?.value}</text>
  </g>
}

export interface ProgressChartProps {
  entries: ProgressEntry[]
  metric: MetricKey
  label: string
  unit: string
  windowEnd: LocalDate | null
  onWindowChange: (value: LocalDate | null) => void
}

export function ProgressChart({ entries, metric, label, unit, windowEnd, onWindowChange }: ProgressChartProps) {
  const dragAreaRef = useRef<HTMLDivElement>(null)
  const dragStartRef = useRef<{ x: number; windowEnd: LocalDate } | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const chartData = entries
    .filter((entry) => entry[metric] !== undefined)
    .map((entry) => ({ date: entry.recordedOn, value: entry[metric] as number }))
    .sort((a, b) => a.date.localeCompare(b.date))

  if (chartData.length === 0) return <p className="muted">Нет данных для отображения</p>

  const minDate = chartData[0].date; const maxDate = chartData[chartData.length - 1].date
  const earliestWindowEnd = addDays(minDate, WINDOW_DAYS - 1)
  const canDrag = earliestWindowEnd < maxDate

  const effectiveEnd = clampDate(windowEnd ?? maxDate, earliestWindowEnd, maxDate)
  const windowStart = addDays(effectiveEnd, -(WINDOW_DAYS - 1))
  const visibleData = chartData.filter((item) => item.date >= windowStart && item.date <= effectiveEnd)
  const yDomain = visibleData.length > 0 ? computeYDomain(visibleData.map((item) => item.value)) : undefined

  const visibleValues = visibleData.map((item) => item.value)
  const minValue = visibleValues.length ? Math.min(...visibleValues) : undefined
  const maxValue = visibleValues.length ? Math.max(...visibleValues) : undefined
  const minIndex = minValue !== undefined ? visibleData.findIndex((item) => item.value === minValue) : -1
  const maxIndex = maxValue !== undefined ? visibleData.findIndex((item) => item.value === maxValue) : -1

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!canDrag) return
    dragStartRef.current = { x: event.clientX, windowEnd: effectiveEnd }
    setIsDragging(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragStartRef.current || !dragAreaRef.current) return
    const containerWidth = dragAreaRef.current.getBoundingClientRect().width
    const pxPerDay = containerWidth / WINDOW_DAYS
    const deltaDays = Math.round((event.clientX - dragStartRef.current.x) / pxPerDay)
    onWindowChange(clampDate(addDays(dragStartRef.current.windowEnd, deltaDays), earliestWindowEnd, maxDate))
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    dragStartRef.current = null
    setIsDragging(false)
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }

  return <section className="chart">
    <h2>{label} ({unit}){canDrag && <span className="chart-range"> · {formatShortDate(windowStart)} – {formatShortDate(effectiveEnd)}</span>}</h2>
    {visibleData.length === 0
      ? <div className="chart-empty-window">
          <p className="muted">Нет данных за этот период</p>
          <button type="button" className="secondary" onClick={() => onWindowChange(null)}>Показать последние 28 дней</button>
        </div>
      : <div ref={dragAreaRef} className={`chart-drag-area${isDragging ? ' dragging' : ''}`}
          onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={visibleData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" stroke="var(--muted)" height={40} tick={AxisTick} interval={Math.max(0, Math.ceil(visibleData.length / 5) - 1)} />
              <YAxis stroke="var(--muted)" style={{ fontSize: '12px' }} domain={yDomain} allowDecimals />
              {!isDragging && <Tooltip formatter={(value: number) => formatTooltipValue(value, unit, label)} labelFormatter={formatTooltipLabel} />}
              <Line type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={3}
                dot={(dotProps: { cx?: number; cy?: number; index?: number }) => renderChartDot(dotProps, minIndex, maxIndex, visibleData.length)}
                activeDot={{ r: 7 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>}
  </section>
}
