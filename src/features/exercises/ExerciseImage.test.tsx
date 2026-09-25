import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { exercisesRepository } from '../../data/repositories/exercises.repository'
import { ExerciseImage, exerciseMediaPresentationKey } from './ExerciseImage'

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

  it('uses one reviewed canvas presentation for poster, end frame, and video paths', () => {
    expect(exerciseMediaPresentationKey('/exercises/vital/romanian-deadlift.jpg')).toBe('/exercises/vital/romanian-deadlift.jpg')
    expect(exerciseMediaPresentationKey('/exercises/vital/romanian-deadlift-end.jpg')).toBe('/exercises/vital/romanian-deadlift.jpg')
    expect(exerciseMediaPresentationKey('/exercises/vital/romanian-deadlift.mp4')).toBe('/exercises/vital/romanian-deadlift.jpg')
    expect(exerciseMediaPresentationKey('/custom/photo.jpg')).toBeUndefined()
  })

  it('applies the reviewed backdrop only to normalized exercise media', () => {
    const { container, rerender } = render(<ExerciseImage src="/exercises/vital/romanian-deadlift.jpg" alt="Тяга" variant="technique" />)
    expect(container.firstElementChild).toHaveClass('exercise-image-studio')
    expect(container.querySelector('.exercise-image-media-canvas')).toBeInTheDocument()
    expect(container.firstElementChild).toHaveStyle({ '--exercise-media-backdrop': 'rgb(255 255 255)' })

    rerender(<ExerciseImage src="/custom/photo.jpg" alt="Фото" variant="technique" />)
    expect(container.firstElementChild).not.toHaveClass('exercise-image-studio')
    expect(container.firstElementChild).not.toHaveStyle({ '--exercise-media-backdrop': 'rgb(255 255 255)' })
  })

  it('does not crop a custom photo when a normalized fallback also exists', () => {
    const { container } = render(<ExerciseImage
      src="/custom/photo.jpg"
      fallbackSrc="/exercises/vital/romanian-deadlift.jpg"
      alt="Фото"
      variant="technique"
    />)
    expect(container.firstElementChild).not.toHaveClass('exercise-image-studio')
    expect(screen.getByRole('img', { name: 'Фото' })).toHaveAttribute('src', '/custom/photo.jpg')
  })

  it('never renders removed legacy exercise photos even if stale metadata passes one', () => {
    const { container } = render(<ExerciseImage
      src="/exercises/fedb-front-dumbbell-raise.jpg"
      fallbackSrc="/exercises/base-running.jpg"
      motionSrc="/exercises/fedb-front-dumbbell-raise-end.jpg"
      alt="Подъём гантелей"
      variant="technique"
    />)
    expect(container.querySelector('img, video')).not.toBeInTheDocument()
    expect(container.firstElementChild).toHaveClass('exercise-image-empty')
    expect(container.innerHTML).not.toContain('fedb-')
    expect(container.innerHTML).not.toContain('base-')
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

  it('signs private picker media only when its card approaches the viewport', async () => {
    vi.stubEnv('MODE', 'production')
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co')
    let intersectionCallback: IntersectionObserverCallback | undefined
    const observe = vi.fn()
    const disconnect = vi.fn()
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { intersectionCallback = callback }
      observe = observe
      disconnect = disconnect
      unobserve = vi.fn()
      takeRecords = vi.fn(() => [])
      root = null
      rootMargin = '320px 0px'
      thresholds = [0]
    })
    const createVitalMediaUrl = vi.spyOn(exercisesRepository, 'createVitalMediaUrl')
      .mockResolvedValue('https://signed.example/cycling.jpg')

    render(<ExerciseImage
      src="/exercises/vital-pro/vital-cycling-ex061.jpg"
      alt="Велотренажёр"
      variant="picker"
    />)

    expect(observe).toHaveBeenCalledOnce()
    expect(createVitalMediaUrl).not.toHaveBeenCalled()
    intersectionCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    await waitFor(() => expect(screen.getByRole('img', { name: 'Велотренажёр' })).toHaveAttribute('src', 'https://signed.example/cycling.jpg'))
    expect(createVitalMediaUrl).toHaveBeenCalledOnce()
    expect(disconnect).toHaveBeenCalled()
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

  it('signs and shows a custom exercise cover photo from its stored path', async () => {
    const createCustomExercisePhotoUrl = vi.spyOn(exercisesRepository, 'createCustomExercisePhotoUrl')
      .mockResolvedValue('https://signed.example/jump.jpg')

    render(<ExerciseImage customPhotoPath="trainer-1/jump.jpg" alt="Прыжки радости" variant="picker" />)
    await waitFor(() => expect(screen.getByRole('img', { name: 'Прыжки радости' })).toHaveAttribute('src', 'https://signed.example/jump.jpg'))
    expect(createCustomExercisePhotoUrl).toHaveBeenCalledWith('trainer-1/jump.jpg', 3600)
  })

  it('shows a loading placeholder, not the empty icon, while a custom photo is being signed', () => {
    vi.spyOn(exercisesRepository, 'createCustomExercisePhotoUrl').mockReturnValue(new Promise(() => {}))
    const { container } = render(<ExerciseImage customPhotoPath="trainer-1/pending-jump.jpg" alt="Прыжки радости" variant="picker" />)
    expect(container.firstElementChild).toHaveClass('exercise-image-empty', 'exercise-image-loading')
    expect(container.querySelector('img')).not.toBeInTheDocument()
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

  it('signs and shows the private end frame when a picker poster cannot be loaded', async () => {
    vi.stubEnv('MODE', 'production')
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co')
    const createVitalMediaUrl = vi.spyOn(exercisesRepository, 'createVitalMediaUrl').mockImplementation((path) => Promise.resolve(
      path.endsWith('-end.jpg')
        ? 'https://signed.example/cycling-end.jpg'
        : 'https://signed.example/cycling.jpg',
    ))

    const { container } = render(<ExerciseImage
      src="/exercises/vital-pro/vital-cycling-ex061.jpg"
      motionSrc="/exercises/vital-pro/vital-cycling-ex061-end.jpg"
      alt="Велотренажёр"
      variant="picker"
    />)

    await waitFor(() => expect(screen.getByRole('img', { name: 'Велотренажёр' })).toHaveAttribute('src', 'https://signed.example/cycling.jpg'))
    fireEvent.error(screen.getByRole('img', { name: 'Велотренажёр' }))
    await waitFor(() => expect(screen.getByRole('img', { name: 'Велотренажёр' })).toHaveAttribute('src', 'https://signed.example/cycling-end.jpg'))
    expect(container.firstElementChild).not.toHaveClass('exercise-image-empty')
    expect(createVitalMediaUrl).toHaveBeenCalledWith('vital-pro/vital-cycling-ex061-end.jpg', 3600)
  })

  it('falls back to private start and end frames when a technique video cannot be loaded', async () => {
    vi.stubEnv('MODE', 'production')
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co')
    vi.spyOn(exercisesRepository, 'createVitalMediaUrl').mockImplementation((path) => Promise.resolve(
      `https://signed.example/${path.split('/').at(-1)}`,
    ))

    const { container } = render(<ExerciseImage
      src="/exercises/vital-pro/vital-leg-press-machine-ex073.jpg"
      motionSrc="/exercises/vital-pro/vital-leg-press-machine-ex073-end.jpg"
      videoSrc="/exercises/vital-pro/vital-leg-press-machine-ex073.mp4"
      alt="Жим ногами"
      variant="technique"
    />)

    await waitFor(() => expect(screen.getByLabelText('Техника: Жим ногами')).toBeInTheDocument())
    fireEvent.error(screen.getByLabelText('Техника: Жим ногами'))
    await waitFor(() => expect(container.firstElementChild).toHaveClass('exercise-image-motion'))
    expect(container.querySelectorAll('img')).toHaveLength(2)
    expect(container.querySelector('.exercise-image-frame-end')).toHaveAttribute('src', 'https://signed.example/vital-leg-press-machine-ex073-end.jpg')
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
