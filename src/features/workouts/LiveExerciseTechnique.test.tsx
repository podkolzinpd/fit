import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ExerciseSnapshot } from '../../shared/domain'
import { LiveExerciseTechnique } from './LiveExerciseTechnique'

const exercise: ExerciseSnapshot = {
  source: 'system',
  ref: 'barbell-squat',
  name: 'Присед со штангой',
  muscleGroup: 'legs',
  inputKind: 'strength',
  imageUrl: '/squat.jpg',
  techniqueVideoUrl: '/squat.mp4',
  instructions: ['Стопы устойчиво.'],
}

describe('LiveExerciseTechnique', () => {
  it('shows compact muted animation and exposes full technique', async () => {
    const user = userEvent.setup()
    const onCollapsedChange = vi.fn()
    const onOpenTechnique = vi.fn()
    const { container } = render(<LiveExerciseTechnique exercise={exercise} collapsed={false} onCollapsedChange={onCollapsedChange} onOpenTechnique={onOpenTechnique} />)

    const video = container.querySelector('video')
    expect(video).toBeInTheDocument()
    expect(video).toHaveProperty('muted', true)
    await user.click(screen.getByRole('button', { name: 'Подробнее' }))
    expect(onOpenTechnique).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Свернуть анимацию: Присед со штангой' }))
    expect(onCollapsedChange).toHaveBeenCalledWith(true)
  })

  it('keeps a manual reopen action without mounting media while collapsed', async () => {
    const user = userEvent.setup()
    const onCollapsedChange = vi.fn()
    const { container } = render(<LiveExerciseTechnique exercise={exercise} collapsed onCollapsedChange={onCollapsedChange} onOpenTechnique={() => undefined} />)

    expect(container.querySelector('video')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Показать анимацию: Присед со штангой' }))
    expect(onCollapsedChange).toHaveBeenCalledWith(false)
  })

  it('falls back to the first instruction when there is no media', () => {
    render(<LiveExerciseTechnique exercise={{ ...exercise, imageUrl: undefined, techniqueVideoUrl: undefined }} collapsed={false} onCollapsedChange={() => undefined} onOpenTechnique={() => undefined} />)
    expect(screen.getByText('Стопы устойчиво.')).toBeInTheDocument()
  })
})
