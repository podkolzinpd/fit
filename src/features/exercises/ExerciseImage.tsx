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

export function ExerciseImage({ src, motionSrc, videoSrc, alt = '', variant = 'thumbnail' }: {
  src?: string
  motionSrc?: string
  videoSrc?: string
  alt?: string
  variant?: ExerciseImageVariant
}) {
  const [primaryFailed, setPrimaryFailed] = useState(false)
  const [motionFailed, setMotionFailed] = useState(false)
  const [videoFailed, setVideoFailed] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const reducedMotion = usePrefersReducedMotion()

  useEffect(() => setPrimaryFailed(false), [src])
  useEffect(() => setMotionFailed(false), [motionSrc])
  useEffect(() => setVideoFailed(false), [videoSrc])
  useEffect(() => {
    const video = videoRef.current
    if (video && variant === 'technique' && reducedMotion && !video.paused) video.pause()
  }, [reducedMotion, variant])

  const className = `exercise-image exercise-image-${variant}`
  const primaryAvailable = Boolean(src) && !primaryFailed
  const motionAvailable = variant === 'technique' && Boolean(motionSrc) && !motionFailed
  // Compact cards stay still. Motion starts only after an explicit tap opens
  // the technique view, so scrolling never decides which exercise plays.
  const videoAvailable = variant === 'technique' && Boolean(videoSrc) && !videoFailed
  if (!primaryAvailable && !motionAvailable && !videoAvailable) {
    return <span className={`${className} exercise-image-empty`} aria-hidden="true"><ExerciseIcon /></span>
  }

  const fallbackSrc = primaryAvailable ? src : motionSrc
  const animated = !videoAvailable && primaryAvailable && motionAvailable
  return <span className={`${className}${animated ? ' exercise-image-motion' : ''}`}>
    {fallbackSrc && <img className="exercise-image-frame exercise-image-frame-start" src={fallbackSrc} alt={alt} loading="lazy" decoding="async" onError={() => primaryAvailable ? setPrimaryFailed(true) : setMotionFailed(true)} />}
    {animated && <img className="exercise-image-frame exercise-image-frame-end" src={motionSrc} alt="" aria-hidden="true" loading="lazy" decoding="async" onError={() => setMotionFailed(true)} />}
    {videoAvailable && <video ref={videoRef} className="exercise-image-video" src={videoSrc} poster={fallbackSrc} autoPlay={!reducedMotion} loop muted playsInline preload="metadata" controls aria-label={`Техника: ${alt || 'упражнение'}`} disablePictureInPicture onCanPlay={(event) => { if (!reducedMotion) void event.currentTarget.play().catch(() => undefined) }} onError={() => setVideoFailed(true)} />}
  </span>
}
