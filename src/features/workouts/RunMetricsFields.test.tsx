import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RunMetricsFields } from './RunMetricsFields'

function renderFields(onCommit = vi.fn()) {
  render(<RunMetricsFields
    idPrefix="run"
    durationSec={1780}
    distanceKm={5.2}
    inputClassName="test-input"
    durationLabel="Время"
    distanceLabel="Дистанция"
    distanceUnitLabel="Единица дистанции"
    onCommit={onCommit}
  />)
  return onCommit
}

describe('RunMetricsFields', () => {
  it('shows runner-friendly values and calculated pace', () => {
    renderFields()
    expect(screen.getByLabelText('Время')).toHaveValue('29:40')
    expect(screen.getByLabelText('Дистанция')).toHaveValue(5.2)
    expect(screen.getByLabelText('Дистанция')).toHaveAttribute('placeholder', '0')
    expect(screen.getByLabelText('Единица дистанции')).toHaveValue('km')
    expect(screen.getByRole('option', { name: 'км' })).toHaveProperty('selected', true)
    expect(screen.getByText('Темп 5:42/км')).toBeInTheDocument()
  })

  it('accepts a short segment in metres without changing domain storage', async () => {
    const user = userEvent.setup()
    const onCommit = renderFields()
    await user.selectOptions(screen.getByLabelText('Единица дистанции'), 'm')
    const distance = screen.getByLabelText('Дистанция')
    expect(distance).toHaveAttribute('placeholder', '0')
    expect(screen.getByRole('option', { name: 'м' })).toHaveProperty('selected', true)
    await user.clear(distance)
    await user.type(distance, '400')
    await user.tab()
    expect(onCommit).toHaveBeenLastCalledWith({ distanceKm: 0.4 })
  })

  it('commits duration written as minutes and seconds', async () => {
    const user = userEvent.setup()
    const onCommit = renderFields()
    const duration = screen.getByLabelText('Время')
    await user.clear(duration)
    await user.type(duration, '30:15')
    await user.tab()
    expect(onCommit).toHaveBeenLastCalledWith({ durationSec: 1815, durationMin: undefined })
  })

  it('shows rowing pace and commits stroke rate', async () => {
    const user = userEvent.setup()
    const onCommit = vi.fn()
    render(<RunMetricsFields
      idPrefix="rowing"
      rowing
      durationSec={308}
      distanceKm={0.5}
      strokeRate={30}
      inputClassName="test-input"
      durationLabel="Время"
      distanceLabel="Дистанция"
      distanceUnitLabel="Единица дистанции"
      onCommit={onCommit}
    />)
    expect(screen.getByText('Темп 5:08/500 м')).toBeInTheDocument()
    expect(screen.getByLabelText('Единица дистанции')).toHaveValue('m')
    const strokeRate = screen.getByLabelText('Гребков в минуту')
    expect(strokeRate).toHaveValue(30)
    await user.clear(strokeRate)
    await user.type(strokeRate, '32')
    await user.tab()
    expect(onCommit).toHaveBeenLastCalledWith({ reps: 32 })
  })
})
