import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import type { ProgressEntry } from '../../shared/domain'
import { localDate } from '../../shared/local-date'
import {
  addDays, AxisTick, clampDate, computeYDomain, formatAxisTick, formatShortDate,
  formatTooltipLabel, formatTooltipValue, ProgressChart, renderChartDot,
} from './ProgressChart'

function entry(recordedOn: string, weightKg: number): ProgressEntry {
  return { id: recordedOn, clientId: 'client-1', createdBy: 'trainer-1', recordedOn: localDate(recordedOn), weightKg, customMetrics: [], version: 1 }
}

describe('date helpers', () => {
  it('adds days across month and year boundaries without UTC drift', () => {
    expect(addDays(localDate('2026-01-31'), 1)).toBe('2026-02-01')
    expect(addDays(localDate('2026-12-31'), 1)).toBe('2027-01-01')
    expect(addDays(localDate('2026-03-05'), -10)).toBe('2026-02-23')
  })

  it('clamps a date into the given range', () => {
    const min = localDate('2026-01-01'); const max = localDate('2026-01-31')
    expect(clampDate(localDate('2025-12-01'), min, max)).toBe(min)
    expect(clampDate(localDate('2026-02-01'), min, max)).toBe(max)
    expect(clampDate(localDate('2026-01-15'), min, max)).toBe('2026-01-15')
  })

  it('computes a padded y-domain, with a fallback pad when all values are equal', () => {
    expect(computeYDomain([70, 80])).toEqual([Math.floor(70 - 1.5), Math.ceil(80 + 1.5)])
    expect(computeYDomain([75, 75])).toEqual([Math.floor(75 - 7.5), Math.ceil(75 + 7.5)])
  })

  it('floors/ceils the domain even for small decimal values, to avoid floating-point noise in axis ticks', () => {
    expect(computeYDomain([2.3])).toEqual([1, 4])
  })

  it('formats short dates and axis ticks as day/month without a year', () => {
    expect(formatShortDate(localDate('2026-03-05'))).toBe('05.03')
    const [day, month] = formatAxisTick(localDate('2026-03-05'))
    expect(day).toBe('05')
    expect(month.toLowerCase()).toContain('март')
  })

  it('formats tooltip value and label', () => {
    expect(formatTooltipValue(78.5, 'кг', 'Вес')).toEqual(['78.5 кг', 'Вес'])
    expect(formatTooltipLabel('2026-03-05')).toContain('2026')
  })
})

describe('renderChartDot', () => {
  it('renders a plain dot for points that are neither min nor max', () => {
    const { container } = render(<svg>{renderChartDot({ cx: 10, cy: 20, index: 1 }, 0, 2, 3)}</svg>)
    expect(container.querySelector('circle')).toHaveAttribute('r', '5')
  })

  it('renders a labelled dot with the value for the max point', () => {
    const { container } = render(<svg>{renderChartDot({ cx: 10, cy: 20, index: 2, payload: { value: 90 } }, 0, 2, 3)}</svg>)
    expect(container.querySelector('text')).toHaveTextContent('90')
  })

  it('renders nothing meaningful when geometry is missing', () => {
    const { container } = render(<svg>{renderChartDot({ index: 0 }, 0, 2, 3)}</svg>)
    expect(container.querySelector('circle')).toBeNull()
  })
})

describe('AxisTick', () => {
  it('renders day and month as two text lines', () => {
    const { container } = render(<svg>{AxisTick({ x: 5, y: 10, payload: { value: '2026-03-05' } })}</svg>)
    const texts = container.querySelectorAll('text')
    expect(texts[0]).toHaveTextContent('05')
    expect(texts[1]?.textContent?.toLowerCase()).toContain('март')
  })
})

function ChartHarness({ entries }: { entries: ProgressEntry[] }) {
  const [windowEnd, setWindowEnd] = useState<ReturnType<typeof localDate> | null>(null)
  return <ProgressChart entries={entries} metric="weightKg" label="Вес" unit="кг" windowEnd={windowEnd} onWindowChange={setWindowEnd} />
}

describe('ProgressChart', () => {
  it('shows the last 28-day window by default and reports the range in the title', () => {
    const entries = [entry('2026-01-01', 80), entry('2026-02-01', 78), entry('2026-03-01', 76)]
    render(<ChartHarness entries={entries} />)
    expect(screen.getByText(/02\.02 – 01\.03/)).toBeInTheDocument()
  })

  it('shows an empty message when there is no data at all', () => {
    render(<ChartHarness entries={[]} />)
    expect(screen.getByText('Нет данных для отображения')).toBeInTheDocument()
  })

  it('drags the window backward in time by the dragged distance in days', () => {
    const entries = [entry('2026-01-01', 80), entry('2026-06-01', 78)]
    const onWindowChange = vi.fn()
    const { container } = render(<ProgressChart entries={entries} metric="weightKg" label="Вес" unit="кг" windowEnd={null} onWindowChange={onWindowChange} />)
    const dragArea = container.querySelector('.chart-drag-area') as HTMLElement
    expect(dragArea).not.toBeNull()
    vi.spyOn(dragArea, 'getBoundingClientRect').mockReturnValue({ width: 280 } as DOMRect)

    fireEvent.pointerDown(dragArea, { clientX: 0, pointerId: 1 })
    fireEvent.pointerMove(dragArea, { clientX: -50, pointerId: 1 })
    expect(onWindowChange).toHaveBeenCalledWith('2026-05-27')
    fireEvent.pointerUp(dragArea, { clientX: -50, pointerId: 1 })
  })

  it('ignores drag attempts when all data fits in a single window', () => {
    const entries = [entry('2026-01-01', 80), entry('2026-01-10', 78)]
    const onWindowChange = vi.fn()
    const { container } = render(<ProgressChart entries={entries} metric="weightKg" label="Вес" unit="кг" windowEnd={null} onWindowChange={onWindowChange} />)
    const dragArea = container.querySelector('.chart-drag-area') as HTMLElement
    vi.spyOn(dragArea, 'getBoundingClientRect').mockReturnValue({ width: 280 } as DOMRect)
    fireEvent.pointerDown(dragArea, { clientX: 0, pointerId: 1 })
    fireEvent.pointerMove(dragArea, { clientX: -50, pointerId: 1 })
    expect(onWindowChange).not.toHaveBeenCalled()
  })

  it('resets the window via the reset button when the visible window is empty', async () => {
    const user = userEvent.setup()
    // two data points far apart: a window centered between them contains neither
    const entries = [entry('2026-01-01', 80), entry('2026-06-01', 78)]
    const onWindowChange = vi.fn()
    render(<ProgressChart entries={entries} metric="weightKg" label="Вес" unit="кг" windowEnd={localDate('2026-03-15')} onWindowChange={onWindowChange} />)
    await user.click(screen.getByRole('button', { name: 'Показать последние 28 дней' }))
    expect(onWindowChange).toHaveBeenCalledWith(null)
  })

  it('uses the selected report period as a fixed compact range', () => {
    render(<ProgressChart
      entries={[entry('2026-07-01', 80), entry('2026-08-10', 78)]}
      metric="weightKg"
      label="Вес"
      unit="кг"
      windowEnd={null}
      onWindowChange={vi.fn()}
      rangeStart={localDate('2026-07-10')}
      rangeEnd={localDate('2026-07-31')}
      compact
    />)
    expect(screen.getByText('Нет данных за этот период')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Показать последние 28 дней' })).toBeNull()
    expect(screen.getByLabelText('График показателя «Вес»')).toHaveClass('compact')
  })
})
