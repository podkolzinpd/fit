import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ExerciseSnapshot } from '../../shared/domain'
import { ExerciseThumbnail, findCatalogExercise } from './ExerciseThumbnail'

const squat: ExerciseSnapshot = {
  source: 'system',
  ref: 'squat',
  name: 'Присед',
  muscleGroup: 'legs',
  inputKind: 'strength',
  imageUrl: '/exercises/squat.jpg',
  techniqueVideoUrl: '/exercises/squat.mp4',
}

describe('ExerciseThumbnail', () => {
  it('resolves the exact source and ref before the ref-only legacy fallback', () => {
    const custom = { ...squat, source: 'custom' as const, name: 'Мой присед', imageUrl: '/custom.jpg' }
    expect(findCatalogExercise([squat, custom], custom)).toBe(custom)
    expect(findCatalogExercise([squat], custom)).toBe(squat)
  })

  it('renders one decorative static frame without loading the available video', () => {
    const { container } = render(<ExerciseThumbnail exercise={squat} />)

    expect(container.querySelector('img')).toHaveAttribute('src', '/exercises/squat.jpg')
    expect(container.querySelector('img')).toHaveAttribute('alt', '')
    expect(container.querySelector('video')).not.toBeInTheDocument()
    expect(container.querySelector('.exercise-image-thumbnail')).toBeInTheDocument()
  })

  it('uses the thumbnail as the existing technique action when requested', async () => {
    const user = userEvent.setup()
    const onOpenTechnique = vi.fn()
    render(<ExerciseThumbnail exercise={squat} onOpenTechnique={onOpenTechnique} />)

    await user.click(screen.getByRole('button', { name: 'Посмотреть технику: Присед' }))
    expect(onOpenTechnique).toHaveBeenCalledOnce()
  })

  it('keeps the fixed neutral fallback for exercises without media', () => {
    const { container } = render(<ExerciseThumbnail exercise={{ ...squat, imageUrl: undefined, techniqueVideoUrl: undefined }} />)

    expect(container.querySelector('.exercise-image-empty')).toBeInTheDocument()
    expect(container.querySelector('[data-icon="exercise"]')).toBeInTheDocument()
  })
})
