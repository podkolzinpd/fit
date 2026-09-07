import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { exercisesRepository } from '../../data/repositories/exercises.repository'
import { ExerciseImage } from './ExerciseImage'

describe('ExerciseImage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

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

  it('uses an accessible inline video without native controls in the explicit technique view', () => {
    const { container, rerender } = render(<ExerciseImage src="/exercises/start.jpg" motionSrc="/exercises/end.jpg" videoSrc="/exercises/technique.mp4" alt="Присед" variant="technique" />)
    const video = screen.getByLabelText('Техника: Присед')
    expect(video).toHaveAttribute('src', '/exercises/technique.mp4')
    expect(video).toHaveAttribute('autoplay')
    expect(video).toHaveAttribute('loop')
    expect(video).not.toHaveAttribute('controls')
    expect(video).toHaveAttribute('preload', 'auto')
    expect(video).toHaveProperty('muted', true)
    expect(video).toHaveAttribute('playsinline')
    expect(container.firstElementChild).not.toHaveClass('exercise-image-motion')

    rerender(<ExerciseImage src="/exercises/start.jpg" motionSrc="/exercises/end.jpg" videoSrc="/exercises/technique.mp4" alt="Присед" />)
    expect(container.querySelector('video')).not.toBeInTheDocument()

    rerender(<ExerciseImage src="/exercises/start.jpg" videoSrc="/exercises/technique.mp4" alt="Присед" variant="preview" />)
    expect(container.querySelector('video')).not.toBeInTheDocument()
  })

  it('falls back to the two technique frames when video loading fails', () => {
    const { container } = render(<ExerciseImage src="/exercises/start.jpg" motionSrc="/exercises/end.jpg" videoSrc="/exercises/broken.mp4" alt="Присед" variant="technique" />)
    fireEvent.error(container.querySelector('video')!)
    expect(container.querySelector('video')).not.toBeInTheDocument()
    expect(container.firstElementChild).toHaveClass('exercise-image-motion')
    expect(container.querySelectorAll('img')).toHaveLength(2)
  })

  it('shows no legacy frame while private Gym Pro media is resolving', async () => {
    vi.stubEnv('MODE', 'production')
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co')
    const createVitalMediaUrl = vi.spyOn(exercisesRepository, 'createVitalMediaUrl').mockReturnValue(new Promise(() => {}))

    const { container } = render(<ExerciseImage
      src="/exercises/vital-pro/dumbbell-lunge-pending.jpg"
      fallbackSrc="/exercises/fedb-dumbbell-lunge.jpg"
      motionSrc="/exercises/fedb-dumbbell-lunge-end.jpg"
      videoSrc="/exercises/vital-pro/dumbbell-lunge-pending.mp4"
      alt="Выпады с гантелями"
      variant="picker"
      playVideo
    />)

    expect(container.firstElementChild).toHaveClass('exercise-image-empty', 'exercise-image-loading')
    expect(container.querySelector('img')).not.toBeInTheDocument()
    expect(container.firstElementChild).not.toHaveClass('exercise-image-motion')
    expect(container.innerHTML).not.toContain('fedb-dumbbell-lunge')
    await waitFor(() => expect(createVitalMediaUrl).toHaveBeenCalledTimes(2))
    expect(createVitalMediaUrl).not.toHaveBeenCalledWith('vital-pro/fedb-dumbbell-lunge-end.jpg', expect.anything())
  })

  it('keeps the matching Gym Pro poster visible until its video is ready', async () => {
    vi.stubEnv('MODE', 'production')
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co')
    vi.spyOn(exercisesRepository, 'createVitalMediaUrl').mockImplementation((path) => (
      path.endsWith('.jpg')
        ? Promise.resolve('https://signed.example/dumbbell-lunge.jpg')
        : new Promise(() => {})
    ))

    const { container } = render(<ExerciseImage
      src="/exercises/vital-pro/dumbbell-lunge-poster.jpg"
      fallbackSrc="/exercises/fedb-dumbbell-lunge.jpg"
      motionSrc="/exercises/fedb-dumbbell-lunge-end.jpg"
      videoSrc="/exercises/vital-pro/dumbbell-lunge-poster.mp4"
      alt="Выпады с гантелями"
      variant="technique"
    />)

    await waitFor(() => expect(screen.getByRole('img', { name: 'Выпады с гантелями' })).toHaveAttribute('src', 'https://signed.example/dumbbell-lunge.jpg'))
    expect(container.firstElementChild).not.toHaveClass('exercise-image-motion')
    expect(container.innerHTML).not.toContain('fedb-dumbbell-lunge')
    expect(container.querySelector('video')).not.toBeInTheDocument()
  })

  it('uses a neutral placeholder when private Gym Pro media cannot be signed', async () => {
    vi.stubEnv('MODE', 'production')
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co')
    const createVitalMediaUrl = vi.spyOn(exercisesRepository, 'createVitalMediaUrl').mockRejectedValue(new Error('denied'))

    const { container } = render(<ExerciseImage
      src="/exercises/vital-pro/dumbbell-lunge-failed.jpg"
      fallbackSrc="/exercises/fedb-dumbbell-lunge.jpg"
      motionSrc="/exercises/fedb-dumbbell-lunge-end.jpg"
      videoSrc="/exercises/vital-pro/dumbbell-lunge-failed.mp4"
      alt="Выпады с гантелями"
      variant="technique"
    />)

    await waitFor(() => expect(createVitalMediaUrl).toHaveBeenCalledTimes(2))
    expect(container.firstElementChild).toHaveClass('exercise-image-empty', 'exercise-image-loading')
    expect(container.querySelector('img, video')).not.toBeInTheDocument()
    expect(container.innerHTML).not.toContain('fedb-dumbbell-lunge')
  })

  it('keeps compact catalog cards static even when video is available', () => {
    const { container } = render(<ExerciseImage src="/exercises/start.jpg" videoSrc="/exercises/technique.mp4" alt="Присед" variant="preview" />)
    expect(container.querySelector('video')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Присед' })).toHaveAttribute('src', '/exercises/start.jpg')
  })

  it('plays video in a picker card only when that card is explicitly active', () => {
    const { container, rerender } = render(<ExerciseImage src="/exercises/start.jpg" videoSrc="/exercises/technique.mp4" alt="Присед" variant="picker" />)
    expect(container.querySelector('video')).not.toBeInTheDocument()
    rerender(<ExerciseImage src="/exercises/start.jpg" videoSrc="/exercises/technique.mp4" alt="Присед" variant="picker" playVideo />)
    expect(screen.getByLabelText('Техника: Присед')).toHaveAttribute('autoplay')
    expect(screen.getByLabelText('Техника: Присед')).not.toHaveAttribute('controls')
    expect(container.querySelectorAll('video')).toHaveLength(1)
  })

  it('uses the still end frame when a compact card start frame fails', () => {
    const { container } = render(<ExerciseImage src="/exercises/broken.jpg" motionSrc="/exercises/end.jpg" videoSrc="/exercises/technique.mp4" alt="Жим лёжа" variant="picker" />)
    fireEvent.error(screen.getByRole('img', { name: 'Жим лёжа' }))
    expect(screen.getByRole('img', { name: 'Жим лёжа' })).toHaveAttribute('src', '/exercises/end.jpg')
    expect(container.querySelector('video')).not.toBeInTheDocument()
    expect(container.firstElementChild).not.toHaveClass('exercise-image-motion')
  })

  it('uses the explicit public poster before falling back to the end frame', () => {
    const { container } = render(<ExerciseImage src="/licensed/start.jpg" fallbackSrc="/public/start.jpg" motionSrc="/public/end.jpg" alt="Тяга" variant="technique" />)
    fireEvent.error(screen.getByRole('img', { name: 'Тяга' }))
    expect(screen.getByRole('img', { name: 'Тяга' })).toHaveAttribute('src', '/public/start.jpg')
    expect(container.firstElementChild).toHaveClass('exercise-image-motion')
    fireEvent.error(screen.getByRole('img', { name: 'Тяга' }))
    expect(screen.getByRole('img', { name: 'Тяга' })).toHaveAttribute('src', '/public/end.jpg')
  })

  it('uses a custom play action and disables autoplay when reduced motion is enabled', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    const { container, rerender } = render(<ExerciseImage src="/exercises/start.jpg" motionSrc="/exercises/end.jpg" videoSrc="/exercises/technique.mp4" alt="Присед" variant="technique" />)
    expect(container.querySelector('video')).not.toHaveAttribute('controls')
    expect(container.querySelector('video')).not.toHaveAttribute('autoplay')
    expect(screen.getByRole('button', { name: 'Запустить анимацию: Присед' })).toBeInTheDocument()
    expect(container.firstElementChild).not.toHaveClass('exercise-image-motion')
    rerender(<ExerciseImage src="/exercises/start.jpg" videoSrc="/exercises/technique.mp4" alt="Присед" variant="preview" />)
    expect(container.querySelector('video')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Присед' })).toBeVisible()
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
