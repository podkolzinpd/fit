import { useEffect, useState } from 'react'
import { ExerciseIcon } from '../../shared/icons'

export type ExerciseImageVariant = 'thumbnail' | 'detail'

export function ExerciseImage({ src, alt = '', variant = 'thumbnail' }: {
  src?: string
  alt?: string
  variant?: ExerciseImageVariant
}) {
  const [failed, setFailed] = useState(false)

  useEffect(() => setFailed(false), [src])

  const className = `exercise-image exercise-image-${variant}`
  if (!src || failed) {
    return <span className={`${className} exercise-image-empty`} aria-hidden="true"><ExerciseIcon /></span>
  }

  return <span className={className}>
    <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />
  </span>
}
