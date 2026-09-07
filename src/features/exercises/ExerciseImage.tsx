import { useEffect, useRef, useState } from 'react'
import { ExerciseIcon } from '../../shared/icons'

export type ExerciseImageVariant = 'thumbnail' | 'preview' | 'picker' | 'detail' | 'technique'

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
  const [primaryFailed, setPrimaryFailed] = useState(false)
  const [fallbackFailed, setFallbackFailed] = useState(false)
  const [motionFailed, setMotionFailed] = useState(false)
  const [videoFailed, setVideoFailed] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const reducedMotion = usePrefersReducedMotion()

  useEffect(() => setPrimaryFailed(false), [src])
  useEffect(() => setFallbackFailed(false), [fallbackSrc])
  useEffect(() => setMotionFailed(false), [motionSrc])
  useEffect(() => setVideoFailed(false), [videoSrc])
  useEffect(() => {
    const video = videoRef.current
    if (video && reducedMotion && !video.paused) video.pause()
  }, [reducedMotion, variant, playVideo])

  const className = `exercise-image exercise-image-${variant}`
  const primaryAvailable = Boolean(src) && !primaryFailed
  const stillFallbackAvailable = Boolean(fallbackSrc) && !fallbackFailed
  const motionFallbackAvailable = Boolean(motionSrc) && !motionFailed
  const motionAvailable = variant === 'technique' && motionFallbackAvailable
  // A compact picker video is opt-in: the picker activates exactly one card
  // after an explicit tap. Scrolling or visibility never starts playback.
  const videoAvailable = (variant === 'technique' || (variant === 'picker' && playVideo)) && Boolean(videoSrc) && !videoFailed
  if (!primaryAvailable && !stillFallbackAvailable && !motionFallbackAvailable && !videoAvailable) {
    return <span className={`${className} exercise-image-empty`} aria-hidden="true"><ExerciseIcon /></span>
  }

  // Compact cards never animate, but the end frame still protects them from a
  // broken start frame so the picker does not collapse to an empty placeholder.
  const displayedStillSrc = primaryAvailable ? src : stillFallbackAvailable ? fallbackSrc : motionFallbackAvailable ? motionSrc : undefined
  const animated = !videoAvailable && (primaryAvailable || stillFallbackAvailable) && motionAvailable
  return <span className={`${className}${animated ? ' exercise-image-motion' : ''}`}>
    {displayedStillSrc && <img className="exercise-image-frame exercise-image-frame-start" src={displayedStillSrc} alt={alt} loading="lazy" decoding="async" onError={() => primaryAvailable ? setPrimaryFailed(true) : stillFallbackAvailable ? setFallbackFailed(true) : setMotionFailed(true)} />}
    {animated && <img className="exercise-image-frame exercise-image-frame-end" src={motionSrc} alt="" aria-hidden="true" loading="lazy" decoding="async" onError={() => setMotionFailed(true)} />}
    {videoAvailable && <video ref={videoRef} className="exercise-image-video" src={videoSrc} poster={displayedStillSrc} autoPlay={!reducedMotion} loop muted playsInline preload="metadata" controls={variant === 'technique'} aria-label={`Техника: ${alt || 'упражнение'}`} disablePictureInPicture onCanPlay={(event) => { if (!reducedMotion) void event.currentTarget.play().catch(() => undefined) }} onError={() => setVideoFailed(true)} />}
  </span>
}
