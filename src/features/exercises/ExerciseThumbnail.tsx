import type { ExerciseSnapshot } from '../../shared/domain'
import { PlayIcon } from '../../shared/icons'
import { ExerciseImage } from './ExerciseImage'

export function findCatalogExercise(
  catalog: readonly ExerciseSnapshot[],
  exercise: Pick<ExerciseSnapshot, 'source' | 'ref'>,
): ExerciseSnapshot | undefined {
  return catalog.find((candidate) => candidate.source === exercise.source && candidate.ref === exercise.ref)
    ?? catalog.find((candidate) => candidate.ref === exercise.ref)
}

export function ExerciseThumbnail({ exercise, onOpenTechnique, className = '' }: {
  exercise?: ExerciseSnapshot
  onOpenTechnique?: () => void
  className?: string
}) {
  const image = <ExerciseImage
    src={exercise?.imageUrl}
    fallbackSrc={exercise?.fallbackImageUrl}
    customPhotoPath={exercise?.imagePath}
    alt=""
    variant="thumbnail"
  />

  if (!onOpenTechnique || !exercise) {
    return <span className={`exercise-thumbnail ${className}`.trim()} aria-hidden="true">{image}</span>
  }

  return <button type="button" className={`exercise-thumbnail exercise-thumbnail-action ${className}`.trim()}
    aria-label={`Посмотреть технику: ${exercise.name}`} onClick={onOpenTechnique}>
    {image}
    <span className="exercise-thumbnail-play" aria-hidden="true"><PlayIcon /></span>
  </button>
}
