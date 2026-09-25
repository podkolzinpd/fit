import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useDataBackend } from '../../app/data-backend-context'
import { ExerciseIcon } from '../../shared/icons'
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
  const deferredPickerMedia = variant === 'picker' && privateVitalMedia
  const { nearViewport, ref: containerRef } = useNearViewport(deferredPickerMedia)
  const requestPrivateMedia = !deferredPickerMedia || nearViewport || playVideo
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
    setManualPlay(false)
  }, [resolvedVideoSrc])
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
  if (!primaryAvailable && !stillFallbackAvailable && !motionFallbackAvailable && !videoAvailable) {
    return <span ref={containerRef} className={`${className} exercise-image-empty${(privateVitalMedia || customPhotoLoading) ? ' exercise-image-loading' : ''}`} aria-hidden="true"><ExerciseIcon /></span>
  }

  // Compact cards stay static, but use the end frame as their cover. Some
  // licensed animations start on an almost empty white canvas; the end frame
  // shows the exercise without requiring video autoplay or a second request.
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
  const animated = !videoAvailable && (primaryAvailable || stillFallbackAvailable) && motionAvailable
  return <span ref={containerRef} className={`${className}${animated ? ' exercise-image-motion' : ''}`} style={mediaPresentationStyle(presentation)}>
    <span className="exercise-image-media-canvas">
      {displayedStillSrc && <img className="exercise-image-frame exercise-image-frame-start" src={displayedStillSrc} alt={alt} loading="lazy" decoding="async" onError={() => displayedStillIsMotion ? setMotionFailed(true) : primaryAvailable ? setPrimaryFailed(true) : setFallbackFailed(true)} />}
      {animated && <img className="exercise-image-frame exercise-image-frame-end" src={resolvedMotionSrc} alt="" aria-hidden="true" loading="lazy" decoding="async" onError={() => setMotionFailed(true)} />}
      {videoAvailable && <video ref={videoRef} className={`exercise-image-video${videoPlaying ? ' playing' : ''}`} src={resolvedVideoSrc} poster={displayedStillSrc} autoPlay={!reducedMotion} loop muted playsInline preload={variant === 'technique' ? 'auto' : 'metadata'} aria-label={`Техника: ${alt || 'упражнение'}`} disablePictureInPicture disableRemotePlayback onCanPlay={(event) => { if (!reducedMotion && !videoPlaying) void startVideo(event.currentTarget) }} onPlaying={() => { setVideoPlaying(true); setManualPlay(false) }} onError={() => setVideoFailed(true)} />}
    </span>
    {variant === 'technique' && videoAvailable && manualPlay && <button type="button" className="exercise-video-play" aria-label={`Запустить анимацию: ${alt || 'упражнение'}`} onClick={() => { if (videoRef.current) void startVideo(videoRef.current) }}>▶</button>}
  </span>
}
