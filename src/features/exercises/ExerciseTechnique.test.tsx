import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ExerciseSnapshot } from '../../shared/domain'
import { ExerciseTechniqueSheet, hasExerciseTechnique } from './ExerciseTechnique'

const squat: ExerciseSnapshot = {
  source: 'system',
  ref: 'squat',
  name: 'Присед со штангой',
  muscleGroup: 'legs',
  inputKind: 'strength',
  equipment: 'Штанга',
  primaryMuscleDetail: 'Квадрицепс',
  imageUrl: '/squat.jpg',
  techniqueVideoUrl: '/squat.mp4',
  instructions: ['Поставьте стопы устойчиво.', 'Опуститесь под контролем.'],
}

describe('ExerciseTechniqueSheet', () => {
  it('shows one reusable technique dialog without native video controls', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ExerciseTechniqueSheet exercise={squat} onClose={onClose} />)

    const dialog = screen.getByRole('dialog', { name: 'Техника: Присед со штангой' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText('Штанга · Ноги')).toBeInTheDocument()
    expect(screen.getByText('Опуститесь под контролем.')).toBeInTheDocument()
    expect(dialog.querySelector('video')).not.toHaveAttribute('controls')

    await user.click(screen.getByRole('button', { name: 'Закрыть технику' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not expose a dead entry point for an exercise without technique content', () => {
    expect(hasExerciseTechnique({ ...squat, imageUrl: undefined, techniqueVideoUrl: undefined, instructions: undefined })).toBe(false)
  })
})
