import { screen } from '@testing-library/react'
import { render } from '../../test/native-render'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ExerciseSnapshot } from '../../shared/domain'
import { LiveExerciseTechnique } from './LiveExerciseTechnique'
import { coachWorkoutReferenceAssets } from '../../shared/coach-workout-reference-assets'

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
    if (!video) throw new Error('Expected the exercise video to be rendered')
    expect(video).toHaveProperty('muted', true)
    expect(screen.queryByText('Анимация')).not.toBeInTheDocument()
    expect(video.compareDocumentPosition(screen.getByRole('button', { name: 'Подробнее' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Подробнее' }))
    expect(onOpenTechnique).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Свернуть анимацию: Присед со штангой' }))
    expect(onCollapsedChange).toHaveBeenCalledWith(true)
  })

  it('keeps a manual reopen action without mounting media while collapsed', async () => {
    const user = userEvent.setup()
    const onCollapsedChange = vi.fn()
    const { container, rerender } = render(<LiveExerciseTechnique exercise={exercise} collapsed onCollapsedChange={onCollapsedChange} onOpenTechnique={() => undefined} />)

    expect(container.querySelector('video')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Показать анимацию: Присед со штангой' }))
    expect(onCollapsedChange).toHaveBeenCalledWith(false)
    expect(container.querySelector('img')).not.toBeInTheDocument()
    rerender(<LiveExerciseTechnique exercise={exercise} collapsed reference onCollapsedChange={onCollapsedChange} onOpenTechnique={() => undefined} />)
    expect(container.querySelector('img')).toHaveAttribute('src', coachWorkoutReferenceAssets.play)
    expect(container).not.toHaveTextContent('▶')
    await user.click(screen.getByRole('button', { name: 'Показать анимацию: Присед со штангой' }))
    expect(onCollapsedChange).toHaveBeenCalledTimes(2)
  })

  it('keeps instruction-only technique compact and opens the detail sheet', async () => {
    const user = userEvent.setup()
    const onOpenTechnique = vi.fn()
    render(<LiveExerciseTechnique exercise={{ ...exercise, imageUrl: undefined, techniqueVideoUrl: undefined }} collapsed={false} onCollapsedChange={() => undefined} onOpenTechnique={onOpenTechnique} />)

    expect(screen.queryByText('Стопы устойчиво.')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Открыть технику: Присед со штангой' }))
    expect(onOpenTechnique).toHaveBeenCalledOnce()
  })
})
