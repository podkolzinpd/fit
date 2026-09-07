import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkoutExerciseHeader } from './WorkoutExerciseHeader'

describe('WorkoutExerciseHeader', () => {
  it('keeps the scenario-specific semantic elements and actions', () => {
    render(<WorkoutExerciseHeader as="header" titleAs="strong" className="planned-exercise-head" name="Присед" actions={<button type="button">Удалить</button>} />)

    expect(screen.getByText('Присед').closest('header')).toHaveClass('planned-exercise-head')
    expect(screen.getByRole('button', { name: 'Удалить' }).parentElement).toHaveClass('exercise-head-actions')
  })

  it('supports the smaller heading in a live circuit', () => {
    render(<WorkoutExerciseHeader className="live-exercise-head" titleAs="h3" name="Планка" />)

    expect(screen.getByRole('heading', { level: 3, name: 'Планка' })).toBeInTheDocument()
  })

  it('opens technique from the exercise title without affecting actions', async () => {
    const user = userEvent.setup()
    const onTitleClick = vi.fn()
    render(<WorkoutExerciseHeader className="live-exercise-head" name="Присед" onTitleClick={onTitleClick} actions={<button type="button">Меню</button>} />)

    await user.click(screen.getByRole('button', { name: 'Посмотреть технику: Присед' }))
    expect(onTitleClick).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Меню' })).toBeInTheDocument()
  })
})
