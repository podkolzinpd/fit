import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { exercisesRepository } from '../../data/repositories/exercises.repository'
import { ExerciseImage, exerciseMediaPresentationKey } from './ExerciseImage'

function markImageLoaded(image: Element | null) {
  if (!image) throw new Error('Expected an exercise image')
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 540 })
  fireEvent.load(image)
}

describe('ExerciseImage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('starts loading an image once its frame is near the viewport', () => {
    const { container } = render(<ExerciseImage src="/exercises/test.jpg" alt="Жим лёжа" variant="detail" />)
    const image = screen.getByRole('img', { name: 'Жим лёжа' })
    expect(image).toHaveAttribute('loading', 'eager')
    expect(image).toHaveAttribute('decoding', 'async')
    expect(container.firstElementChild).toHaveClass('exercise-image-detail')
  })

  it('keeps visible loading feedback until the browser has loaded the image', () => {
    const { container } = render(<ExerciseImage src="/exercises/vital/stationary-bike-end.jpg" alt="Велотренажёр" variant="picker" />)
    expect(screen.getByRole('status', { name: 'Загрузка изображения упражнения' })).toBeVisible()
    const image = screen.getByRole('img', { name: 'Велотренажёр' })
    Object.defineProperty(image, 'naturalWidth', { value: 540 })
    fireEvent.load(image)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(container.firstElementChild).not.toHaveClass('exercise-image-loading')
  })

  it('retries a stalled public cover once and stops loading after a terminal timeout', () => {
    vi.useFakeTimers()
    const { container } = render(<ExerciseImage src="/exercises/vital/leg-press-machine-end.jpg" alt="Жим ногами" variant="picker" />)
    const original = screen.getByRole('img', { name: 'Жим ногами' }).getAttribute('src')
    act(() => vi.advanceTimersByTime(10_000))
    expect(screen.getByRole('img', { name: 'Жим ногами' }).getAttribute('src')).not.toBe(original)
    expect(screen.getByRole('img', { name: 'Жим ногами' })).toHaveAttribute('src', expect.stringContaining('fit-media-retry='))
    act(() => vi.advanceTimersByTime(10_000))
    expect(container.firstElementChild).toHaveClass('exercise-image-empty')
    expect(container.firstElementChild).not.toHaveClass('exercise-image-loading')
    expect(container.querySelector('img')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Изображение недоступно: Жим ногами' })).toBeVisible()
    act(() => vi.advanceTimersByTime(60_000))
    expect(container.querySelector('img')).not.toBeInTheDocument()
  })

  it('requires a new load when returning to an earlier image before the intervening image loads', () => {
    vi.useFakeTimers()
    const { rerender } = render(<ExerciseImage src="/exercises/return-a.jpg" alt="Упражнение" />)
    markImageLoaded(screen.getByRole('img', { name: 'Упражнение' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    rerender(<ExerciseImage src="/exercises/return-b.jpg" alt="Упражнение" />)
    rerender(<ExerciseImage src="/exercises/return-a.jpg" alt="Упражнение" />)
    expect(screen.getByRole('status', { name: 'Загрузка изображения упражнения' })).toBeVisible()
    act(() => vi.advanceTimersByTime(10_000))
    expect(screen.getByRole('img', { name: 'Упражнение' })).toHaveAttribute('src', expect.stringContaining('/exercises/return-a.jpg?fit-media-retry='))
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

  it('cycles through both frames in technique and uses the end frame as a static compact cover', () => {
    const { container, rerender } = render(<ExerciseImage src="/exercises/start.jpg" motionSrc="/exercises/end.jpg" alt="Жим лёжа" variant="technique" />)
    expect(container.firstElementChild).not.toHaveClass('exercise-image-motion')
    expect(container.querySelectorAll('img')).toHaveLength(2)
    expect(container.querySelector('.exercise-image-frame-end')).toHaveAttribute('src', '/exercises/end.jpg')
    markImageLoaded(container.querySelector('.exercise-image-frame-start'))
    expect(container.firstElementChild).not.toHaveClass('exercise-image-motion')
    markImageLoaded(container.querySelector('.exercise-image-frame-end'))
    expect(container.firstElementChild).toHaveClass('exercise-image-motion')

    rerender(<ExerciseImage src="/exercises/start.jpg" motionSrc="/exercises/end.jpg" alt="Жим лёжа" />)
    expect(container.firstElementChild).not.toHaveClass('exercise-image-motion')
    expect(container.querySelectorAll('img')).toHaveLength(1)
    expect(screen.getByRole('img', { name: 'Жим лёжа' })).toHaveAttribute('src', '/exercises/end.jpg')
  })

  it('keeps the start frame when the optional end frame fails', () => {
    const { container } = render(<ExerciseImage src="/exercises/start.jpg" motionSrc="/exercises/end.jpg" alt="Жим лёжа" variant="technique" />)
    markImageLoaded(container.querySelector('.exercise-image-frame-start'))
    fireEvent.error(container.querySelector('.exercise-image-frame-end')!)
    expect(container.querySelector('.exercise-image-frame-end')).toHaveAttribute('src', expect.stringContaining('fit-media-retry='))
    fireEvent.error(container.querySelector('.exercise-image-frame-end')!)
    expect(screen.getByRole('img', { name: 'Жим лёжа' })).toHaveAttribute('src', '/exercises/start.jpg')
    expect(container.firstElementChild).not.toHaveClass('exercise-image-motion')
    expect(container.querySelector('.exercise-image-frame-end')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('keeps a loaded still visible while a stalled second frame retries and then gives up', () => {
    vi.useFakeTimers()
    const { container } = render(<ExerciseImage src="/exercises/stalled-start.jpg" motionSrc="/exercises/stalled-end.jpg" alt="Тяга" variant="technique" />)
    markImageLoaded(screen.getByRole('img', { name: 'Тяга' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(container.firstElementChild).not.toHaveClass('exercise-image-motion')
    act(() => vi.advanceTimersByTime(10_000))
    expect(container.querySelector('.exercise-image-frame-end')).toHaveAttribute('src', expect.stringContaining('fit-media-retry='))
    expect(screen.getByRole('img', { name: 'Тяга' })).toHaveAttribute('src', '/exercises/stalled-start.jpg')
    act(() => vi.advanceTimersByTime(10_000))
    expect(container.querySelector('.exercise-image-frame-end')).not.toBeInTheDocument()
    expect(container.firstElementChild).not.toHaveClass('exercise-image-motion')
    expect(screen.getByRole('img', { name: 'Тяга' })).toBeVisible()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    act(() => vi.advanceTimersByTime(60_000))
    expect(container.querySelectorAll('img')).toHaveLength(1)
  })

  it('starts the two-frame animation only after a retried second frame has loaded', () => {
    vi.useFakeTimers()
    const { container } = render(<ExerciseImage src="/exercises/recovered-start.jpg" motionSrc="/exercises/recovered-end.jpg" alt="Тяга" variant="technique" />)
    markImageLoaded(screen.getByRole('img', { name: 'Тяга' }))
    act(() => vi.advanceTimersByTime(10_000))
    expect(container.firstElementChild).not.toHaveClass('exercise-image-motion')
    const recoveredFrame = container.querySelector('.exercise-image-frame-end')
    expect(recoveredFrame).toHaveAttribute('src', expect.stringContaining('fit-media-retry='))
    markImageLoaded(recoveredFrame)
    expect(container.firstElementChild).toHaveClass('exercise-image-motion')
    act(() => vi.advanceTimersByTime(60_000))
    expect(container.querySelector('.exercise-image-frame-end')).toBe(recoveredFrame)
    expect(container.firstElementChild).toHaveClass('exercise-image-motion')
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
    expect(container.querySelector('video')).toHaveAttribute('src', expect.stringContaining('fit-media-retry='))
    fireEvent.error(container.querySelector('video')!)
    expect(container.querySelector('video')).not.toBeInTheDocument()
    expect(container.querySelectorAll('img')).toHaveLength(2)
    expect(container.firstElementChild).not.toHaveClass('exercise-image-motion')
    markImageLoaded(container.querySelector('.exercise-image-frame-start'))
    markImageLoaded(container.querySelector('.exercise-image-frame-end'))
    expect(container.firstElementChild).toHaveClass('exercise-image-motion')
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
    expect(container.firstElementChild).toHaveClass('exercise-image-empty')
    expect(container.firstElementChild).not.toHaveClass('exercise-image-loading')
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

  it('waits for the new video element when an already played picker card is reactivated', () => {
    vi.useFakeTimers()
    const props = { src: '/exercises/replay.jpg', videoSrc: '/exercises/replay.mp4', alt: 'Присед', variant: 'picker' as const }
    const { container, rerender } = render(<ExerciseImage {...props} playVideo />)
    fireEvent.playing(screen.getByLabelText('Техника: Присед'))
    expect(container.querySelector('video')).toHaveClass('playing')
    rerender(<ExerciseImage {...props} />)
    rerender(<ExerciseImage {...props} playVideo />)
    expect(container.querySelector('video')).not.toHaveClass('playing')
    act(() => vi.advanceTimersByTime(10_000))
    expect(screen.getByLabelText('Техника: Присед')).toHaveAttribute('src', expect.stringContaining('fit-media-retry='))
  })

  it('falls back from the compact end-frame cover to the start frame', () => {
    const { container } = render(<ExerciseImage src="/exercises/broken.jpg" motionSrc="/exercises/end.jpg" videoSrc="/exercises/technique.mp4" alt="Жим лёжа" variant="picker" />)
    expect(screen.getByRole('img', { name: 'Жим лёжа' })).toHaveAttribute('src', '/exercises/end.jpg')
    fireEvent.error(screen.getByRole('img', { name: 'Жим лёжа' }))
    expect(screen.getByRole('img', { name: 'Жим лёжа' })).toHaveAttribute('src', expect.stringContaining('fit-media-retry='))
    fireEvent.error(screen.getByRole('img', { name: 'Жим лёжа' }))
    expect(screen.getByRole('img', { name: 'Жим лёжа' })).toHaveAttribute('src', '/exercises/broken.jpg')
    expect(container.querySelector('video')).not.toBeInTheDocument()
    expect(container.firstElementChild).not.toHaveClass('exercise-image-motion')
  })

  it('signs only the private end-frame cover first and falls back to the start frame', async () => {
    vi.stubEnv('MODE', 'production')
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co')
    const createVitalMediaUrl = vi.spyOn(exercisesRepository, 'createVitalMediaUrl').mockImplementation((path) => Promise.resolve(
      path.endsWith('-end.jpg')
        ? 'https://signed.example/cycling-end.jpg'
        : 'https://signed.example/cycling.jpg',
    ))

    const { container } = render(<ExerciseImage
      src="/exercises/vital-pro/vital-cycling-cover-test.jpg"
      motionSrc="/exercises/vital-pro/vital-cycling-cover-test-end.jpg"
      alt="Велотренажёр"
      variant="picker"
    />)

    await waitFor(() => expect(screen.getByRole('img', { name: 'Велотренажёр' })).toHaveAttribute('src', 'https://signed.example/cycling-end.jpg'))
    expect(createVitalMediaUrl).toHaveBeenCalledTimes(1)
    expect(createVitalMediaUrl).toHaveBeenCalledWith('vital-pro/vital-cycling-cover-test-end.jpg', 3600)
    fireEvent.error(screen.getByRole('img', { name: 'Велотренажёр' }))
    await waitFor(() => expect(createVitalMediaUrl).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByRole('img', { name: 'Велотренажёр' })).toHaveAttribute('src', 'https://signed.example/cycling-end.jpg'))
    fireEvent.error(screen.getByRole('img', { name: 'Велотренажёр' }))
    await waitFor(() => expect(screen.getByRole('img', { name: 'Велотренажёр' })).toHaveAttribute('src', 'https://signed.example/cycling.jpg'))
    expect(container.firstElementChild).not.toHaveClass('exercise-image-empty')
    expect(createVitalMediaUrl).toHaveBeenCalledWith('vital-pro/vital-cycling-cover-test.jpg', 3600)
  })

  it('falls back to private start and end frames when a technique video cannot be loaded', async () => {
    vi.stubEnv('MODE', 'production')
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co')
    const createVitalMediaUrl = vi.spyOn(exercisesRepository, 'createVitalMediaUrl').mockImplementation((path) => Promise.resolve(
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
    await waitFor(() => expect(createVitalMediaUrl.mock.calls.filter(([path]) => path.endsWith('.mp4'))).toHaveLength(2))
    await waitFor(() => expect(screen.getByLabelText('Техника: Жим ногами')).toBeInTheDocument())
    fireEvent.error(screen.getByLabelText('Техника: Жим ногами'))
    await waitFor(() => expect(container.querySelector('.exercise-image-frame-end')).toBeInTheDocument(), { timeout: 3_000 })
    expect(container.querySelectorAll('img')).toHaveLength(2)
    expect(container.querySelector('.exercise-image-frame-end')).toHaveAttribute('src', 'https://signed.example/vital-leg-press-machine-ex073-end.jpg')
    markImageLoaded(container.querySelector('.exercise-image-frame-start'))
    markImageLoaded(container.querySelector('.exercise-image-frame-end'))
    expect(container.firstElementChild).toHaveClass('exercise-image-motion')
  })

  it('uses the explicit public poster before falling back to the end frame', () => {
    const { container } = render(<ExerciseImage src="/licensed/start.jpg" fallbackSrc="/public/start.jpg" motionSrc="/public/end.jpg" alt="Тяга" variant="technique" />)
    fireEvent.error(screen.getByRole('img', { name: 'Тяга' }))
    expect(screen.getByRole('img', { name: 'Тяга' })).toHaveAttribute('src', '/public/start.jpg')
    markImageLoaded(container.querySelector('.exercise-image-frame-start'))
    markImageLoaded(container.querySelector('.exercise-image-frame-end'))
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
