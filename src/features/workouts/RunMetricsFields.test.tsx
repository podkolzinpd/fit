import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setWorkoutTimeWheel } from '../../app/workout-time-input'
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
  afterEach(() => setWorkoutTimeWheel(false))

  it('shows runner-friendly values and calculated pace', () => {
    renderFields()
    expect(screen.getByRole('textbox', { name: 'Время: минуты' })).toHaveValue('29')
    expect(screen.getByRole('textbox', { name: 'Время: секунды' })).toHaveValue('40')
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

  it('accepts hundredths of a metre and keeps them when switching units', async () => {
    const user = userEvent.setup()
    const onCommit = vi.fn()
    function Harness() {
      const [distanceKm, setDistanceKm] = useState(5.2)
      return <RunMetricsFields idPrefix="fractional-run" durationSec={1780} distanceKm={distanceKm}
        inputClassName="test-input" durationLabel="Время" distanceLabel="Дистанция"
        distanceUnitLabel="Единица дистанции" onCommit={(patch) => {
          onCommit(patch)
          if (patch.distanceKm !== undefined) setDistanceKm(patch.distanceKm)
        }} />
    }
    render(<Harness />)
    await user.selectOptions(screen.getByLabelText('Единица дистанции'), 'm')
    const distance = screen.getByLabelText('Дистанция')
    expect(distance).toHaveAttribute('step', 'any')
    await user.clear(distance)
    await user.type(distance, '12.25')
    await user.tab()
    expect(onCommit).toHaveBeenLastCalledWith({ distanceKm: 0.01225 })
    expect(distance).toHaveValue(12.25)
    await user.selectOptions(screen.getByLabelText('Единица дистанции'), 'km')
    expect(distance).toHaveValue(0.01225)
  })

  it('accepts hundredths of a kilometre without native step validation', async () => {
    const user = userEvent.setup()
    const onCommit = renderFields()
    const distance = screen.getByLabelText('Дистанция')
    expect(distance).toHaveAttribute('step', 'any')
    await user.clear(distance)
    await user.type(distance, '5.25')
    await user.tab()
    expect(onCommit).toHaveBeenLastCalledWith({ distanceKm: 5.25 })
    expect(distance).toHaveValue(5.25)
  })

  it('commits duration selected as minutes and seconds', async () => {
    setWorkoutTimeWheel(true)
    const user = userEvent.setup()
    const onCommit = renderFields()
    await user.click(screen.getByRole('button', { name: 'Время: 29:40' }))
    await user.click(within(screen.getByRole('listbox', { name: 'минуты' })).getByRole('option', { name: '30 минуты' }))
    await user.click(within(screen.getByRole('listbox', { name: 'секунды' })).getByRole('option', { name: '15 секунды' }))
    await user.click(screen.getByRole('button', { name: 'Применить · 30:15' }))
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

  it('lets the stair machine record time alone or measured distance without a calculated pace', async () => {
    const user = userEvent.setup()
    const onCommit = vi.fn()
    render(<RunMetricsFields idPrefix="stair" optionalDistance durationSec={7559}
      inputClassName="test-input" durationLabel="Время" distanceLabel="Дистанция"
      distanceUnitLabel="Единица дистанции" onCommit={onCommit} />)
    expect(screen.getByRole('textbox', { name: 'Время: минуты' })).toHaveValue('125')
    expect(screen.getByRole('textbox', { name: 'Время: секунды' })).toHaveValue('59')
    expect(screen.queryByLabelText('Дистанция')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '+ Добавить дистанцию' }))
    await user.selectOptions(screen.getByLabelText('Единица дистанции'), 'm')
    await user.type(screen.getByLabelText('Дистанция'), '800')
    await user.tab()
    expect(onCommit).toHaveBeenLastCalledWith({ distanceKm: 0.8 })
    expect(screen.getByText('По дисплею тренажёра')).toBeInTheDocument()
    expect(screen.queryByText(/Темп/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Убрать дистанцию' }))
    expect(onCommit).toHaveBeenLastCalledWith({ distanceKm: undefined })
    expect(screen.queryByLabelText('Дистанция')).not.toBeInTheDocument()
  })

  it('reveals distance received later from a saved plan or another session', () => {
    const fields = (distanceKm?: number) => <RunMetricsFields idPrefix="late-distance" optionalDistance
      durationSec={120} distanceKm={distanceKm} inputClassName="test-input"
      durationLabel="Время" distanceLabel="Дистанция" distanceUnitLabel="Единица дистанции" />
    const { rerender } = render(fields())
    expect(screen.queryByLabelText('Дистанция')).not.toBeInTheDocument()
    rerender(fields(0.5))
    expect(screen.getByLabelText('Дистанция')).toHaveValue(500)
  })
})
