import type { ExerciseSnapshot } from '../../shared/domain'
import { ExerciseImage } from '../exercises'
import { hasExerciseMedia, hasExerciseTechnique } from '../exercises/ExerciseTechnique'

export function LiveExerciseTechnique({ exercise, collapsed, onCollapsedChange, onOpenTechnique }: {
  exercise: ExerciseSnapshot
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  onOpenTechnique: () => void
}) {
  if (!hasExerciseTechnique(exercise)) return null

  if (collapsed) {
    return <button type="button" className="live-technique-collapsed" aria-label={`Показать анимацию: ${exercise.name}`} onClick={() => onCollapsedChange(false)}>
      <span aria-hidden="true">▶</span> Показать анимацию
    </button>
  }

  const hasMedia = hasExerciseMedia(exercise)
  const instruction = exercise.instructions?.[0]
  return <section className={`live-technique${hasMedia ? ' has-media' : ''}`} aria-label={`Техника текущего упражнения: ${exercise.name}`}>
    <header className="live-technique-head">
      <strong>Анимация</strong>
      <span>
        <button type="button" className="link" onClick={onOpenTechnique}>Подробнее</button>
        <button type="button" className="link" aria-label={`Свернуть анимацию: ${exercise.name}`} onClick={() => onCollapsedChange(true)}>Свернуть</button>
      </span>
    </header>
    {hasMedia
      ? <ExerciseImage src={exercise.imageUrl} fallbackSrc={exercise.fallbackImageUrl} motionSrc={exercise.motionImageUrl} videoSrc={exercise.techniqueVideoUrl} alt={exercise.name} variant="technique" />
      : <p className="live-technique-hint">{instruction}</p>}
  </section>
}
