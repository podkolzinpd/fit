import { useEffect, useRef, useState } from 'react'
import { ExerciseIcon } from '../../shared/icons'
import { shouldUsePrivateVitalStorage, useVitalMediaUrl } from './vitalMedia'

export type ExerciseImageVariant = 'thumbnail' | 'preview' | 'picker' | 'detail' | 'technique'

export function reviewedExerciseImageSource(source: string | undefined) {
  return source && !/^\/exercises\/(?:fedb-|base-)/.test(source) ? source : undefined
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

export function ExerciseImage({ src, fallbackSrc, motionSrc, videoSrc, alt = '', variant = 'thumbnail', playVideo = false }: {
  src?: string
  fallbackSrc?: string
  motionSrc?: string
  videoSrc?: string
  alt?: string
  variant?: ExerciseImageVariant
  playVideo?: boolean
}) {
  const safeSrc = reviewedExerciseImageSource(src)
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
  const wantsVideo = variant === 'technique' || (variant === 'picker' && playVideo)
  const privateVitalMedia = shouldUsePrivateVitalStorage(safeSrc) || shouldUsePrivateVitalStorage(videoSrc)
  const resolvedSrc = useVitalMediaUrl(safeSrc)
  const resolvedMotionSrc = useVitalMediaUrl(safeMotionSrc, variant === 'technique' && !privateVitalMedia)
  const resolvedVideoSrc = useVitalMediaUrl(videoSrc, wantsVideo)

  useEffect(() => setPrimaryFailed(false), [resolvedSrc])
  useEffect(() => setFallbackFailed(false), [safeFallbackSrc])
  useEffect(() => setMotionFailed(false), [resolvedMotionSrc])
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

  const className = `exercise-image exercise-image-${variant}`
  const primaryAvailable = Boolean(resolvedSrc) && !primaryFailed
  const stillFallbackAvailable = !privateVitalMedia && Boolean(safeFallbackSrc) && !fallbackFailed
  const motionFallbackAvailable = !privateVitalMedia && Boolean(resolvedMotionSrc) && !motionFailed
  const motionAvailable = variant === 'technique' && motionFallbackAvailable
  // A compact picker video is opt-in: the picker activates exactly one card
  // after an explicit tap. Scrolling or visibility never starts playback.
  const videoAvailable = wantsVideo && Boolean(resolvedVideoSrc) && !videoFailed
  if (!primaryAvailable && !stillFallbackAvailable && !motionFallbackAvailable && !videoAvailable) {
    return <span className={`${className} exercise-image-empty${privateVitalMedia ? ' exercise-image-loading' : ''}`} aria-hidden="true"><ExerciseIcon /></span>
  }

  // Compact cards never animate, but the end frame still protects them from a
  // broken start frame so the picker does not collapse to an empty placeholder.
  const displayedStillSrc = primaryAvailable ? resolvedSrc : stillFallbackAvailable ? safeFallbackSrc : motionFallbackAvailable ? resolvedMotionSrc : undefined
  const animated = !videoAvailable && (primaryAvailable || stillFallbackAvailable) && motionAvailable
  return <span className={`${className}${animated ? ' exercise-image-motion' : ''}`}>
    {displayedStillSrc && <img className="exercise-image-frame exercise-image-frame-start" src={displayedStillSrc} alt={alt} loading="lazy" decoding="async" onError={() => primaryAvailable ? setPrimaryFailed(true) : stillFallbackAvailable ? setFallbackFailed(true) : setMotionFailed(true)} />}
    {animated && <img className="exercise-image-frame exercise-image-frame-end" src={resolvedMotionSrc} alt="" aria-hidden="true" loading="lazy" decoding="async" onError={() => setMotionFailed(true)} />}
    {videoAvailable && <video ref={videoRef} className={`exercise-image-video${videoPlaying ? ' playing' : ''}`} src={resolvedVideoSrc} poster={displayedStillSrc} autoPlay={!reducedMotion} loop muted playsInline preload={variant === 'technique' ? 'auto' : 'metadata'} aria-label={`Техника: ${alt || 'упражнение'}`} disablePictureInPicture disableRemotePlayback onCanPlay={(event) => { if (!reducedMotion && !videoPlaying) void startVideo(event.currentTarget) }} onPlaying={() => { setVideoPlaying(true); setManualPlay(false) }} onError={() => setVideoFailed(true)} />}
    {variant === 'technique' && videoAvailable && manualPlay && <button type="button" className="exercise-video-play" aria-label={`Запустить анимацию: ${alt || 'упражнение'}`} onClick={() => { if (videoRef.current) void startVideo(videoRef.current) }}>▶</button>}
  </span>
}
