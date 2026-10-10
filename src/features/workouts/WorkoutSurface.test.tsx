import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkoutChoice, WorkoutCta, WorkoutExercise, WorkoutExerciseCompact, WorkoutHeader, WorkoutRpeScale, WorkoutSetRow, WorkoutStatus } from './WorkoutSurface'

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
    ['decision', 'neutral'],
    ['cancelled', 'neutral'],
    ['skipped', 'neutral'],
    ['history', 'neutral'],
  ] as const)('maps %s to the %s color tone', (state, tone) => {
    render(<WorkoutStatus state={state} />)
    expect(screen.getByText(/Планируется|Выполняется|Далее|Завершена|План|Не состоялась|Не выполнено|Результат/)).toHaveAttribute('data-tone', tone)
  })

  it('keeps pending CTA disabled and exposes a compact completed exercise', () => {
    const onClick = vi.fn()
    render(<>
      <WorkoutCta pending pendingLabel="Завершаем…" onClick={onClick}>Завершить</WorkoutCta>
      <WorkoutExerciseCompact state="completed" title="Планка" meta="3 подхода" onClick={onClick} />
    </>)
    expect(screen.getByRole('button', { name: 'Завершаем…' })).toHaveAttribute('data-control-state', 'loading')
    expect(screen.getByRole('button', { name: 'Завершаем…' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /Планка/ }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('accepts a static exercise visual instead of the generic compact mark', () => {
    const { container } = render(<WorkoutExerciseCompact state="upcoming" title="Планка" meta="3 подхода" leading={<span data-testid="thumbnail" />} />)

    expect(screen.getByTestId('thumbnail')).toBeInTheDocument()
    expect(container.querySelector('.workout-exercise-compact-mark')).not.toBeInTheDocument()
  })

  it.each([
    ['primary', 'primary'],
    ['secondary', 'secondary'],
    ['tertiary', 'link'],
    ['destructive', 'danger'],
  ] as const)('exposes the %s action hierarchy', (variant, expectedClass) => {
    render(<WorkoutCta variant={variant}>Действие</WorkoutCta>)
    const action = screen.getByRole('button', { name: 'Действие' })
    expect(action).toHaveAttribute('data-variant', variant)
    if (expectedClass) expect(action).toHaveClass(expectedClass)
  })

  it('uses one selected, destructive and disabled choice contract', () => {
    const { rerender } = render(<WorkoutChoice selected>Нормально</WorkoutChoice>)
    expect(screen.getByRole('button', { name: 'Нормально' })).toHaveAttribute('data-control-state', 'selected')
    expect(screen.getByRole('button', { name: 'Нормально' })).toHaveAttribute('aria-pressed', 'true')

    rerender(<WorkoutChoice selected tone="destructive">Есть дискомфорт</WorkoutChoice>)
    const destructive = screen.getByRole('button', { name: 'Есть дискомфорт' })
    expect(destructive).toHaveAttribute('data-tone', 'destructive')
    expect(destructive).toHaveAttribute('data-control-state', 'selected')

    rerender(<WorkoutChoice selected={false} disabled>Недоступно</WorkoutChoice>)
    expect(screen.getByRole('button', { name: 'Недоступно' })).toHaveAttribute('data-control-state', 'disabled')
  })

  it('requires explicit selection and exposes an integer effort slider', () => {
    const onChange = vi.fn()
    const { rerender } = render(<WorkoutRpeScale onChange={onChange} />)
    const slider = screen.getByRole('slider', { name: 'Нагрузка по шкале RPE' })
    expect(slider).toHaveAttribute('aria-valuetext', 'Нагрузка не выбрана')
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.keyUp(slider, { key: 'Home' })
    expect(onChange).toHaveBeenCalledWith(1)
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    fireEvent.pointerUp(slider)
    expect(onChange).toHaveBeenCalledWith(1)
    fireEvent.change(slider, { target: { value: '8' } })
    expect(onChange).toHaveBeenCalledWith(8)
    rerender(<WorkoutRpeScale value={8} onChange={onChange} />)
    expect(slider).toHaveAttribute('aria-valuetext', '8 из 10 — Очень тяжело')
    expect(screen.getByText('8 / 10 · Очень тяжело')).toBeVisible()
    rerender(<WorkoutRpeScale value={10} disabled onChange={onChange} />)
    expect(slider).toBeDisabled()
    expect(slider).toHaveAttribute('aria-valuetext', '10 из 10 — Максимум')
  })
})
