import { useEffect, useState } from 'react'
import { ExerciseIcon } from '../../shared/icons'

export type ExerciseImageVariant = 'thumbnail' | 'detail' | 'technique'

export function ExerciseImage({ src, motionSrc, alt = '', variant = 'thumbnail' }: {
  src?: string
  motionSrc?: string
  alt?: string
  variant?: ExerciseImageVariant
}) {
  const [primaryFailed, setPrimaryFailed] = useState(false)
  const [motionFailed, setMotionFailed] = useState(false)

  useEffect(() => setPrimaryFailed(false), [src])
  useEffect(() => setMotionFailed(false), [motionSrc])

  const className = `exercise-image exercise-image-${variant}`
  const primaryAvailable = Boolean(src) && !primaryFailed
  const motionAvailable = variant === 'technique' && Boolean(motionSrc) && !motionFailed
  if (!primaryAvailable && !motionAvailable) {
    return <span className={`${className} exercise-image-empty`} aria-hidden="true"><ExerciseIcon /></span>
  }

  const fallbackSrc = primaryAvailable ? src : motionSrc
  const animated = primaryAvailable && motionAvailable
  return <span className={`${className}${animated ? ' exercise-image-motion' : ''}`}>
    <img className="exercise-image-frame exercise-image-frame-start" src={fallbackSrc} alt={alt} loading="lazy" decoding="async" onError={() => primaryAvailable ? setPrimaryFailed(true) : setMotionFailed(true)} />
    {animated && <img className="exercise-image-frame exercise-image-frame-end" src={motionSrc} alt="" aria-hidden="true" loading="lazy" decoding="async" onError={() => setMotionFailed(true)} />}
  </span>
}
