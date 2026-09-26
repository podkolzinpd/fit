import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useDataBackend } from '../../app/data-backend-context'
import { ExerciseIcon, PendingIcon } from '../../shared/icons'
import exerciseMediaPresentation from '../../shared/exercise-media-presentation.generated.json'
import { useCustomExercisePhotoUrl } from './custom-exercise-photo'
import { shouldUsePrivateVitalStorage, useVitalMediaState } from './vitalMedia'

export type ExerciseImageVariant = 'thumbnail' | 'preview' | 'picker' | 'detail' | 'technique'

export function reviewedExerciseImageSource(source: string | undefined) {
  return source && !/^\/exercises\/(?:fedb-|base-)/.test(source) ? source : undefined
}

type ExerciseMediaPresentation = {
  crop: number[]
  backdrop: string
}

const EXERCISE_MEDIA_PRESENTATION = exerciseMediaPresentation.items as Record<string, ExerciseMediaPresentation>
const NORMALIZED_MEDIA = /^\/exercises\/(vital|vital-pro|reference)\/(.+?)(?:-end)?\.(?:jpg|mp4)$/

export function exerciseMediaPresentationKey(source: string | undefined) {
  const match = source?.match(NORMALIZED_MEDIA)
  return match ? `/exercises/${match[1]}/${match[2]}.jpg` : undefined
}

function mediaPresentationStyle(presentation: ExerciseMediaPresentation | undefined): CSSProperties | undefined {
  if (!presentation) return undefined
  const [top, right, bottom, left] = presentation.crop
  return {
    '--exercise-media-backdrop': presentation.backdrop,
    '--exercise-media-crop-top': `${top}%`,
    '--exercise-media-crop-right': `${right}%`,
    '--exercise-media-crop-bottom': `${bottom}%`,
    '--exercise-media-crop-left': `${left}%`,
  } as CSSProperties
}

function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(() => (
    typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ))

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(media.matches)
    update()
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])

  return reducedMotion
}

function useNearViewport(deferred: boolean) {
  const ref = useRef<HTMLSpanElement>(null)
  const [nearViewport, setNearViewport] = useState(() => (
    !deferred || typeof IntersectionObserver !== 'function'
  ))

  useEffect(() => {
    if (!deferred || nearViewport) return
    if (typeof IntersectionObserver !== 'function') {
      setNearViewport(true)
      return
    }
    const target = ref.current
    if (!target) {
      setNearViewport(true)
      return
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      setNearViewport(true)
      observer.disconnect()
    }, { rootMargin: '320px 0px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [deferred, nearViewport])

  return { nearViewport, ref }
}

// A URL is not a loaded image. Safari may leave an asset request pending
// indefinitely, so visible media needs a deadline as well as an error handler.
function useMediaLoadDeadline(source: string | undefined, enabled: boolean, ready: boolean, onFailure: () => void) {
  const failureRef = useRef(onFailure)
  useEffect(() => { failureRef.current = onFailure }, [onFailure])
  useEffect(() => {
    if (!source || !enabled || ready) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      clearTimeout(timer)
      if (document.visibilityState !== 'hidden') {
        timer = setTimeout(() => failureRef.current(), 10_000)
      }
    }
    schedule()
    document.addEventListener('visibilitychange', schedule)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', schedule)
    }
  }, [source, enabled, ready])
}

export function ExerciseImage({ src, fallbackSrc, motionSrc, videoSrc, customPhotoPath, alt = '', variant = 'thumbnail', playVideo = false }: {
  src?: string
  fallbackSrc?: string
  motionSrc?: string
  videoSrc?: string
  /** Приватный storage-путь фото кастомного упражнения (custom_exercises.image_path) — подписывается отдельно от src. */
  customPhotoPath?: string | null
  alt?: string
  variant?: ExerciseImageVariant
  playVideo?: boolean
}) {
  const safeFallbackSrc = reviewedExerciseImageSource(fallbackSrc)
  const safeMotionSrc = reviewedExerciseImageSource(motionSrc)
  const [primaryFailed, setPrimaryFailed] = useState(false)
  const [fallbackFailed, setFallbackFailed] = useState(false)
  const [motionFailed, setMotionFailed] = useState(false)
  const [videoFailed, setVideoFailed] = useState(false)
  const [videoPlaying, setVideoPlaying] = useState(false)
  const [manualPlay, setManualPlay] = useState(false)
  const [loadedStillSrc, setLoadedStillSrc] = useState<string>()
  const [loadedMotionSrc, setLoadedMotionSrc] = useState<string>()
  const [loadedVideoSrc, setLoadedVideoSrc] = useState<string>()
  const videoRef = useRef<HTMLVideoElement>(null)
  const reducedMotion = usePrefersReducedMotion()
  const { source: backendSource } = useDataBackend()
  const wantsVideo = variant === 'technique' || (variant === 'picker' && playVideo)
  const resolvedCustomPhoto = useCustomExercisePhotoUrl(customPhotoPath)
  const customPhotoLoading = Boolean(customPhotoPath) && !resolvedCustomPhoto
  const safeSrc = resolvedCustomPhoto ?? reviewedExerciseImageSource(src)
  const compactPrefersMotionPoster = variant !== 'technique' && !resolvedCustomPhoto && Boolean(safeMotionSrc)
  const privateVitalMedia = shouldUsePrivateVitalStorage(safeSrc, backendSource)
    || shouldUsePrivateVitalStorage(safeMotionSrc, backendSource)
    || shouldUsePrivateVitalStorage(videoSrc, backendSource)
  const deferredMedia = variant !== 'technique'
  const { nearViewport, ref: containerRef } = useNearViewport(deferredMedia)
  const requestPrivateMedia = !deferredMedia || nearViewport || playVideo
  const primaryMedia = useVitalMediaState(
    safeSrc,
    requestPrivateMedia && (!compactPrefersMotionPoster || motionFailed),
  )
  const resolvedSrc = primaryMedia.url
  const videoMedia = useVitalMediaState(videoSrc, requestPrivateMedia && wantsVideo)
  const resolvedVideoSrc = videoMedia.url
  const requestPrivateMotionFallback = privateVitalMedia && requestPrivateMedia && (
    primaryFailed
    || primaryMedia.status === 'error'
    || videoFailed
    || videoMedia.status === 'error'
  )
  const motionMedia = useVitalMediaState(
    safeMotionSrc,
    requestPrivateMedia && (
      compactPrefersMotionPoster
      || variant === 'technique' && !privateVitalMedia
      || requestPrivateMotionFallback
    ),
  )
  const resolvedMotionSrc = motionMedia.url

  useEffect(() => setPrimaryFailed(false), [resolvedSrc])
  useEffect(() => setFallbackFailed(false), [safeFallbackSrc])
  useEffect(() => setMotionFailed(false), [resolvedMotionSrc])
  useEffect(() => {
    if (compactPrefersMotionPoster && motionMedia.status === 'error') setMotionFailed(true)
  }, [compactPrefersMotionPoster, motionMedia.status])
  useEffect(() => {
    setVideoFailed(false)
    setVideoPlaying(false)
    setLoadedVideoSrc(undefined)
    setManualPlay(false)
  }, [resolvedVideoSrc, wantsVideo])
  useEffect(() => {
    const video = videoRef.current
    if (video && reducedMotion) {
      if (!video.paused) video.pause()
      setVideoPlaying(false)
      setManualPlay(true)
    }
  }, [reducedMotion, variant, playVideo])

  async function startVideo(video: HTMLVideoElement) {
    try {
      await video.play()
      setManualPlay(false)
    } catch {
      setManualPlay(true)
    }
  }

  const primaryAvailable = Boolean(resolvedSrc) && !primaryFailed
  const stillFallbackAvailable = !privateVitalMedia && Boolean(safeFallbackSrc) && !fallbackFailed
  const motionFallbackAvailable = Boolean(resolvedMotionSrc) && !motionFailed
  const motionAvailable = variant === 'technique' && motionFallbackAvailable
  // A compact picker video is opt-in: the picker activates exactly one card
  // after an explicit tap. Scrolling or visibility never starts playback.
  const videoAvailable = wantsVideo && Boolean(resolvedVideoSrc) && !videoFailed
  const displayedStillSource = compactPrefersMotionPoster && motionFallbackAvailable
    ? safeMotionSrc
    : primaryAvailable
      ? safeSrc
      : stillFallbackAvailable
        ? safeFallbackSrc
        : motionFallbackAvailable
          ? safeMotionSrc
          : undefined
  const presentedSource = displayedStillSource
    ?? (videoAvailable
      ? videoSrc
      : [safeSrc, safeFallbackSrc, safeMotionSrc, videoSrc].find(exerciseMediaPresentationKey))
  const normalizedMediaKey = exerciseMediaPresentationKey(presentedSource)
  const presentation = normalizedMediaKey ? EXERCISE_MEDIA_PRESENTATION[normalizedMediaKey] : undefined
  const className = `exercise-image exercise-image-${variant}${normalizedMediaKey ? ' exercise-image-studio' : ''}`
  // Compact cards use the end-frame poster and stay static until explicit play.
  const displayedStillSrc = compactPrefersMotionPoster && motionFallbackAvailable
    ? resolvedMotionSrc
    : primaryAvailable
      ? resolvedSrc
      : stillFallbackAvailable
        ? safeFallbackSrc
        : motionFallbackAvailable
          ? resolvedMotionSrc
          : undefined
  const displayedStillIsMotion = displayedStillSrc === resolvedMotionSrc && motionFallbackAvailable
  function failStill() {
    setLoadedStillSrc(undefined)
    if (displayedStillIsMotion) {
      if (!motionMedia.retry(displayedStillSrc)) setMotionFailed(true)
    } else if (primaryAvailable) {
      if (!primaryMedia.retry(displayedStillSrc)) setPrimaryFailed(true)
    } else {
      setFallbackFailed(true)
    }
  }
  function failVideo() {
    setLoadedVideoSrc(undefined)
    setVideoPlaying(false)
    if (!videoMedia.retry(resolvedVideoSrc)) setVideoFailed(true)
  }
  function failMotion() {
    setLoadedMotionSrc(undefined)
    if (!motionMedia.retry(resolvedMotionSrc)) setMotionFailed(true)
  }
  const secondFrameSrc = !videoAvailable && (primaryAvailable || stillFallbackAvailable) && motionAvailable
    ? resolvedMotionSrc
    : undefined
  // Readiness belongs to this mounted image, not to an earlier element with the
  // same URL (for example when returning to exercise A after viewing B).
  const stillImageRef = useCallback((image: HTMLImageElement | null) => {
    setLoadedStillSrc(image?.complete && image.naturalWidth > 0 ? displayedStillSrc : undefined)
  }, [displayedStillSrc, setLoadedStillSrc])
  const motionImageRef = useCallback((image: HTMLImageElement | null) => {
    setLoadedMotionSrc(image?.complete && image.naturalWidth > 0 ? secondFrameSrc : undefined)
  }, [secondFrameSrc, setLoadedMotionSrc])
  const stillReady = Boolean(displayedStillSrc) && loadedStillSrc === displayedStillSrc
  const motionReady = Boolean(secondFrameSrc) && loadedMotionSrc === secondFrameSrc
  useMediaLoadDeadline(displayedStillSrc, requestPrivateMedia, stillReady, failStill)
  useMediaLoadDeadline(secondFrameSrc, requestPrivateMedia, motionReady, failMotion)
  useMediaLoadDeadline(videoAvailable ? resolvedVideoSrc : undefined, requestPrivateMedia, loadedVideoSrc === resolvedVideoSrc, failVideo)
  const resolving = primaryMedia.status === 'loading' || motionMedia.status === 'loading' || videoMedia.status === 'loading' || customPhotoLoading
  if (!primaryAvailable && !stillFallbackAvailable && !motionFallbackAvailable && !videoAvailable) {
    return <span ref={containerRef} className={`${className} exercise-image-empty${resolving ? ' exercise-image-loading' : ''}`}>
      {resolving ? <span className="exercise-image-load-state" role="status" aria-label="Загрузка изображения упражнения"><PendingIcon /></span> : <span className="exercise-image-load-state" role="img" aria-label={`Изображение недоступно${alt ? `: ${alt}` : ''}`}><ExerciseIcon /></span>}
    </span>
  }
  const stillLoading = !stillReady && !videoPlaying && Boolean(displayedStillSrc || videoAvailable)
  const animated = stillReady && motionReady
  return <span ref={containerRef} className={`${className}${animated ? ' exercise-image-motion' : ''}${stillLoading ? ' exercise-image-loading' : ''}`} style={mediaPresentationStyle(presentation)}>
    <span className="exercise-image-media-canvas">
      {displayedStillSrc && <img ref={stillImageRef} key={displayedStillSrc} className="exercise-image-frame exercise-image-frame-start" src={displayedStillSrc} alt={alt} loading={requestPrivateMedia ? 'eager' : 'lazy'} decoding="async" onLoad={(event) => { if (event.currentTarget.naturalWidth > 0) setLoadedStillSrc(displayedStillSrc) }} onError={failStill} />}
      {secondFrameSrc && <img ref={motionImageRef} key={`motion:${secondFrameSrc}`} className="exercise-image-frame exercise-image-frame-end" src={secondFrameSrc} alt="" aria-hidden="true" loading={requestPrivateMedia ? 'eager' : 'lazy'} decoding="async" onLoad={(event) => { if (event.currentTarget.naturalWidth > 0) setLoadedMotionSrc(secondFrameSrc) }} onError={failMotion} />}
      {videoAvailable && <video ref={videoRef} className={`exercise-image-video${videoPlaying ? ' playing' : ''}`} src={resolvedVideoSrc} poster={displayedStillSrc} autoPlay={!reducedMotion} loop muted playsInline preload={variant === 'technique' ? 'auto' : 'metadata'} aria-label={`Техника: ${alt || 'упражнение'}`} disablePictureInPicture disableRemotePlayback onCanPlay={(event) => { setLoadedVideoSrc(resolvedVideoSrc); if (!reducedMotion && !videoPlaying) void startVideo(event.currentTarget) }} onPlaying={() => { setLoadedVideoSrc(resolvedVideoSrc); setVideoPlaying(true); setManualPlay(false) }} onError={failVideo} />}
    </span>
    {stillLoading && <span className="exercise-image-load-state" role="status" aria-label="Загрузка изображения упражнения"><PendingIcon /></span>}
    {variant === 'technique' && videoAvailable && manualPlay && <button type="button" className="exercise-video-play" aria-label={`Запустить анимацию: ${alt || 'упражнение'}`} onClick={() => { if (videoRef.current) void startVideo(videoRef.current) }}>▶</button>}
  </span>
}
