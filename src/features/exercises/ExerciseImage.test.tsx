import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExerciseImage } from './ExerciseImage'

describe('ExerciseImage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('renders a lazily decoded image inside the requested frame', () => {
    const { container } = render(<ExerciseImage src="/exercises/test.jpg" alt="Жим лёжа" variant="detail" />)
    const image = screen.getByRole('img', { name: 'Жим лёжа' })
    expect(image).toHaveAttribute('loading', 'lazy')
    expect(image).toHaveAttribute('decoding', 'async')
    expect(container.firstElementChild).toHaveClass('exercise-image-detail')
  })

  it('cycles through start and end frames only in the technique variant', () => {
    const { container, rerender } = render(<ExerciseImage src="/exercises/start.jpg" motionSrc="/exercises/end.jpg" alt="Жим лёжа" variant="technique" />)
    expect(container.firstElementChild).toHaveClass('exercise-image-motion')
    expect(container.querySelectorAll('img')).toHaveLength(2)
    expect(container.querySelector('.exercise-image-frame-end')).toHaveAttribute('src', '/exercises/end.jpg')

    rerender(<ExerciseImage src="/exercises/start.jpg" motionSrc="/exercises/end.jpg" alt="Жим лёжа" />)
    expect(container.firstElementChild).not.toHaveClass('exercise-image-motion')
    expect(container.querySelectorAll('img')).toHaveLength(1)
  })

  it('keeps the start frame when the optional end frame fails', () => {
    const { container } = render(<ExerciseImage src="/exercises/start.jpg" motionSrc="/exercises/end.jpg" alt="Жим лёжа" variant="technique" />)
    fireEvent.error(container.querySelector('.exercise-image-frame-end')!)
    expect(screen.getByRole('img', { name: 'Жим лёжа' })).toHaveAttribute('src', '/exercises/start.jpg')
    expect(container.firstElementChild).not.toHaveClass('exercise-image-motion')
  })

  it('uses a silent looping video only in the technique variant', () => {
    const { container, rerender } = render(<ExerciseImage src="/exercises/start.jpg" motionSrc="/exercises/end.jpg" videoSrc="/exercises/technique.mp4" alt="Присед" variant="technique" />)
    const video = container.querySelector('video')
    expect(video).toHaveAttribute('src', '/exercises/technique.mp4')
    expect(video).toHaveAttribute('autoplay')
    expect(video).toHaveAttribute('loop')
    expect(video).toHaveProperty('muted', true)
    expect(video).toHaveAttribute('playsinline')
    expect(container.firstElementChild).not.toHaveClass('exercise-image-motion')

    rerender(<ExerciseImage src="/exercises/start.jpg" motionSrc="/exercises/end.jpg" videoSrc="/exercises/technique.mp4" alt="Присед" />)
    expect(container.querySelector('video')).not.toBeInTheDocument()
  })

  it('falls back to the two technique frames when video loading fails', () => {
    const { container } = render(<ExerciseImage src="/exercises/start.jpg" motionSrc="/exercises/end.jpg" videoSrc="/exercises/broken.mp4" alt="Присед" variant="technique" />)
    fireEvent.error(container.querySelector('video')!)
    expect(container.querySelector('video')).not.toBeInTheDocument()
    expect(container.firstElementChild).toHaveClass('exercise-image-motion')
    expect(container.querySelectorAll('img')).toHaveLength(2)
  })

  it('does not autoplay video when reduced motion is enabled', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    const { container } = render(<ExerciseImage src="/exercises/start.jpg" motionSrc="/exercises/end.jpg" videoSrc="/exercises/technique.mp4" alt="Присед" variant="technique" />)
    expect(container.querySelector('video')).not.toBeInTheDocument()
    expect(container.firstElementChild).toHaveClass('exercise-image-motion')
  })

  it('shows the same neutral placeholder for missing and failed media', () => {
    const { container, rerender } = render(<ExerciseImage />)
    expect(container.firstElementChild).toHaveClass('exercise-image-empty')
    expect(container.querySelector('[data-icon="exercise"]')).toBeInTheDocument()

    rerender(<ExerciseImage src="/exercises/broken.jpg" />)
    fireEvent.error(container.querySelector('img')!)
    expect(container.firstElementChild).toHaveClass('exercise-image-empty')
    expect(container.querySelector('img')).not.toBeInTheDocument()
  })

  it('tries a new source after a previous image failed', () => {
    const { rerender } = render(<ExerciseImage src="/exercises/broken.jpg" alt="Упражнение" />)
    fireEvent.error(screen.getByRole('img'))
    rerender(<ExerciseImage src="/exercises/working.jpg" alt="Упражнение" />)
    expect(screen.getByRole('img', { name: 'Упражнение' })).toHaveAttribute('src', '/exercises/working.jpg')
  })
})
