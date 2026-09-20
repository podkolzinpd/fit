import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ExerciseSnapshot } from '../../shared/domain'
import { ExerciseTechniqueContent, ExerciseTechniqueSheet, hasExerciseAnimation, hasExerciseMedia, hasExerciseTechnique } from './ExerciseTechnique'

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
    expect(hasExerciseTechnique({ ...squat, imageUrl: undefined, techniqueVideoUrl: undefined, instructions: undefined, imagePath: 'custom/photo.jpg' })).toBe(true)
  })

  it('shows no media block when an exercise has no new animation', () => {
    const withoutAnimation = { ...squat, imageUrl: '/exercises/fedb-squat.jpg', techniqueVideoUrl: undefined }
    const { container } = render(<ExerciseTechniqueContent exercise={withoutAnimation} />)
    expect(hasExerciseAnimation(withoutAnimation)).toBe(false)
    expect(container.querySelector('.exercise-image')).not.toBeInTheDocument()
    expect(screen.getByText('Поставьте стопы устойчиво.')).toBeInTheDocument()
  })

  it('shows a custom exercise description and suppresses the "no info" note even without step instructions', () => {
    const custom = { ...squat, imageUrl: undefined, techniqueVideoUrl: undefined, instructions: undefined, description: 'Держите спину ровно и прыгайте мягко.' }
    render(<ExerciseTechniqueContent exercise={custom} />)
    expect(screen.getByRole('heading', { name: 'Описание' })).toBeInTheDocument()
    expect(screen.getByText('Держите спину ровно и прыгайте мягко.')).toBeInTheDocument()
    expect(screen.queryByText('Для этого упражнения пока нет изображения и пошагового описания.')).not.toBeInTheDocument()
  })

  it('shows both the description and the step-by-step instructions when both are present', () => {
    const withBoth = { ...squat, description: 'Общая идея движения.' }
    render(<ExerciseTechniqueContent exercise={withBoth} />)
    expect(screen.getByText('Общая идея движения.')).toBeInTheDocument()
    expect(screen.getByText('Опуститесь под контролем.')).toBeInTheDocument()
  })

  it('treats a stored custom exercise photo path as media, distinct from the legacy image fields', () => {
    const customPhoto = { ...squat, imageUrl: undefined, fallbackImageUrl: undefined, motionImageUrl: undefined, techniqueVideoUrl: undefined, imagePath: 'trainer-1/exercise-1.jpg' }
    expect(hasExerciseMedia(customPhoto)).toBe(true)
  })

  it('shows reviewed start and end frames without pretending they are a video', () => {
    const stillTechnique = {
      ...squat,
      imageUrl: '/exercises/reference/close-grip-lat-pulldown.jpg',
      motionImageUrl: '/exercises/reference/close-grip-lat-pulldown-end.jpg',
      techniqueVideoUrl: undefined,
    }
    const { container } = render(<ExerciseTechniqueContent exercise={stillTechnique} />)
    expect(hasExerciseMedia(stillTechnique)).toBe(true)
    expect(hasExerciseAnimation(stillTechnique)).toBe(false)
    expect(container.querySelectorAll('.exercise-image img')).toHaveLength(2)
    expect(container.querySelector('video')).not.toBeInTheDocument()
  })
})
