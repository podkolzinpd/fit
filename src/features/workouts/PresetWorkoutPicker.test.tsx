import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PRESET_WORKOUTS } from '../../shared/preset-workouts'
import { PresetWorkoutPicker } from './PresetWorkoutPicker'

describe('PresetWorkoutPicker', () => {
  it('reveals every preset as a card once the toggle is opened', async () => {
    render(<PresetWorkoutPicker onSelect={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Выбрать' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Попробовать готовую тренировку' }))
    expect(screen.getAllByRole('button', { name: 'Выбрать' })).toHaveLength(PRESET_WORKOUTS.length)
    for (const preset of PRESET_WORKOUTS) expect(screen.getByText(preset.title)).toBeInTheDocument()
  })

  it('calls onSelect with the chosen preset id', async () => {
    const onSelect = vi.fn()
    render(<PresetWorkoutPicker onSelect={onSelect} />)
    await userEvent.click(screen.getByRole('button', { name: 'Попробовать готовую тренировку' }))
    const [firstButton] = screen.getAllByRole('button', { name: 'Выбрать' })
    await userEvent.click(firstButton!)
    expect(onSelect).toHaveBeenCalledWith(PRESET_WORKOUTS[0]!.id)
  })

  it('disables selection while pending', async () => {
    render(<PresetWorkoutPicker onSelect={vi.fn()} pending />)
    await userEvent.click(screen.getByRole('button', { name: 'Попробовать готовую тренировку' }))
    for (const button of screen.getAllByRole('button', { name: 'Выбрать' })) expect(button).toBeDisabled()
  })
})
