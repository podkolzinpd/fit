import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkoutCta, WorkoutExercise, WorkoutExerciseCompact, WorkoutHeader, WorkoutSetRow, WorkoutStatus } from './WorkoutSurface'

describe('workout surface contract', () => {
  it('uses one explicit state contract for header, exercise, set and status', () => {
    const { container } = render(<>
      <WorkoutHeader eyebrow="Тренировка" title="Новая тренировка" state="planned" meta="3 упражнения" />
      <WorkoutExercise state="current"><WorkoutSetRow state="current">Подход</WorkoutSetRow></WorkoutExercise>
      <WorkoutStatus state="partial" />
    </>)
    expect(screen.getByRole('heading', { name: 'Новая тренировка' })).toBeInTheDocument()
    expect(screen.getByText('Завершена частично')).toHaveAttribute('data-state', 'partial')
    expect(container.querySelector('.workout-exercise-contract')).toHaveAttribute('data-state', 'current')
    expect(container.querySelector('.workout-set-contract')).toHaveAttribute('data-state', 'current')
  })

  it.each([
    ['planned', 'neutral'],
    ['current', 'accent'],
    ['upcoming', 'neutral'],
    ['completed', 'success'],
    ['partial', 'warning'],
    ['skipped', 'neutral'],
    ['history', 'neutral'],
  ] as const)('maps %s to the %s color tone', (state, tone) => {
    render(<WorkoutStatus state={state} />)
    expect(screen.getByText(/Планируется|Выполняется|Далее|Завершена|Пропущена|Результат/)).toHaveAttribute('data-tone', tone)
  })

  it('keeps pending CTA disabled and exposes a compact completed exercise', () => {
    const onClick = vi.fn()
    render(<>
      <WorkoutCta pending pendingLabel="Завершаем…" onClick={onClick}>Завершить</WorkoutCta>
      <WorkoutExerciseCompact state="completed" title="Планка" meta="3 подхода" onClick={onClick} />
    </>)
    expect(screen.getByRole('button', { name: 'Завершаем…' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /Планка/ }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
