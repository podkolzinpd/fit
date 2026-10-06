import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WorkoutSetTable } from './WorkoutSetTable'
import { SYSTEM_EXERCISE_CATALOG } from '../../shared/system-exercises'

describe('WorkoutSetTable', () => {
  it('shows kilograms instead of time for walking lunges in Live', () => {
    const walkingLunge = SYSTEM_EXERCISE_CATALOG.find((exercise) => exercise.ref === 'vital-walking-lunge-ex270')
    if (!walkingLunge) throw new Error('Walking lunge catalog card is missing')
    render(<WorkoutSetTable variant="live" inputKind={walkingLunge.inputKind} showRpe={false}>
      <div>Подход 1</div>
    </WorkoutSetTable>)

    expect(screen.getByText('Кг')).toBeInTheDocument()
    expect(screen.getByText('Повт.')).toBeInTheDocument()
    expect(screen.queryByText('Время')).not.toBeInTheDocument()
  })

  it('shows labels for the exercise input kind instead of a fixed strength layout', () => {
    render(
      <WorkoutSetTable variant="live" inputKind="duration" showRpe trailingLabel="Статус">
        <div>Подход 1</div>
      </WorkoutSetTable>,
    )

    expect(screen.getByText('Время')).toBeInTheDocument()
    expect(screen.queryByText('Кг')).not.toBeInTheDocument()
    expect(screen.getByText('RPE')).toBeInTheDocument()
    expect(screen.getByText('Статус')).toBeInTheDocument()
  })

  it('keeps two planned value columns for distance exercises', () => {
    render(
      <WorkoutSetTable variant="planned" inputKind="distance" showRpe={false}>
        <div>Подход 1</div>
      </WorkoutSetTable>,
    )

    expect(screen.getByText('Время')).toBeInTheDocument()
    expect(screen.getByText('Дистанц.')).toBeInTheDocument()
    expect(screen.queryByText('RPE')).not.toBeInTheDocument()
  })

  it('preserves the single value layout in quick review', () => {
    render(
      <WorkoutSetTable variant="planned" inputKind="reps" layout="singleValue" showRpe={false}>
        <div>Подход 1</div>
      </WorkoutSetTable>,
    )

    expect(screen.getByText('Повт.')).toBeInTheDocument()
    expect(screen.queryByText('Сек.')).not.toBeInTheDocument()
  })

  it('allows history to keep its result in one readable column', () => {
    render(
      <WorkoutSetTable variant="history" inputKind="strength" showRpe={false} columnLabels={['Результат']} trailingLabel="Статус">
        <div>Подход 1</div>
      </WorkoutSetTable>,
    )

    expect(screen.getByText('Результат')).toBeInTheDocument()
    expect(screen.getByText('Статус')).toBeInTheDocument()
  })
})
