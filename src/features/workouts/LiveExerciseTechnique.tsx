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

  const hasMedia: boolean = hasExerciseMedia(exercise)
  if (!hasMedia) {
    return <button type="button" className="live-technique-collapsed live-technique-text-only" aria-label={`Открыть технику: ${exercise.name}`} onClick={onOpenTechnique}>
      <span aria-hidden="true">›</span> Техника
    </button>
  }

  return <section className={`live-technique${hasMedia ? ' has-media' : ''}`} aria-label={`Техника текущего упражнения: ${exercise.name}`}>
    <ExerciseImage src={exercise.imageUrl} fallbackSrc={exercise.fallbackImageUrl} motionSrc={exercise.motionImageUrl} videoSrc={exercise.techniqueVideoUrl} alt={exercise.name} variant="technique" />
    <div className="live-technique-actions">
      <button type="button" className="link" onClick={onOpenTechnique}>Подробнее</button>
      <button type="button" className="link" aria-label={`Свернуть анимацию: ${exercise.name}`} onClick={() => onCollapsedChange(true)}>Свернуть</button>
    </div>
  </section>
}
