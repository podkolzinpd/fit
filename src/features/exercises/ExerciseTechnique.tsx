import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ExerciseSnapshot, InputKind } from '../../shared/domain'
import { CloseIcon } from '../../shared/icons'
import { MUSCLE_GROUP_LABELS } from '../../shared/system-exercises'
import { ExerciseImage } from './ExerciseImage'

const INPUT_KIND_LABELS: Record<InputKind, string> = {
  strength: 'Вес и повторы',
  reps: 'Повторы',
  duration: 'Время',
  distance: 'Расстояние и время',
}

export function hasExerciseTechnique(exercise?: ExerciseSnapshot): exercise is ExerciseSnapshot {
  return Boolean(exercise && (
    exercise.imageUrl
    || exercise.fallbackImageUrl
    || exercise.motionImageUrl
    || exercise.techniqueVideoUrl
    || exercise.instructions?.length
  ))
}

export function ExerciseTechniqueContent({ exercise, beforeFacts }: {
  exercise: ExerciseSnapshot
  beforeFacts?: ReactNode
}) {
  const hasMedia = Boolean(exercise.imageUrl || exercise.fallbackImageUrl || exercise.motionImageUrl || exercise.techniqueVideoUrl)
  return <div className="picker-technique-scroll">
    {hasMedia && <ExerciseImage src={exercise.imageUrl} fallbackSrc={exercise.fallbackImageUrl} motionSrc={exercise.motionImageUrl} videoSrc={exercise.techniqueVideoUrl} alt={exercise.name} variant="technique" />}
    <div className="picker-technique-title"><h2>{exercise.name}</h2><p>{[exercise.equipment ?? 'Без оборудования', MUSCLE_GROUP_LABELS[exercise.muscleGroup]].join(' · ')}</p></div>
    {beforeFacts}
    <div className="picker-technique-facts"><span><small>Формат</small><strong>{INPUT_KIND_LABELS[exercise.inputKind]}</strong></span>{exercise.primaryMuscleDetail && <span><small>Основная мышца</small><strong>{exercise.primaryMuscleDetail}</strong></span>}</div>
    {exercise.instructions?.length
      ? <div className="picker-technique-instructions"><h3>Как выполнять</h3><ol>{exercise.instructions.map((instruction, index) => <li key={`${exercise.ref}-${index}`}>{instruction}</li>)}</ol></div>
      : <p className="picker-technique-note">{hasMedia ? 'Пошагового описания пока нет — ориентируйтесь на движение в превью.' : 'Для этого упражнения пока нет изображения и пошагового описания.'}</p>}
  </div>
}

export function ExerciseTechniqueSheet({ exercise, onClose }: {
  exercise: ExerciseSnapshot
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeRef.current?.focus()
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const host = document.querySelector('.phone-frame') ?? document.body
  return createPortal(<div className="sheet-overlay technique-sheet-overlay" onClick={onClose}>
    <section className="exercise-picker technique-sheet" role="dialog" aria-modal="true" aria-label={`Техника: ${exercise.name}`} onClick={(event) => event.stopPropagation()}>
      <header className="picker-header technique-sheet-header">
        <h1>Техника</h1>
        <button ref={closeRef} type="button" className="picker-close" aria-label="Закрыть технику" onClick={onClose}><CloseIcon /></button>
      </header>
      <div className="picker-technique-view"><ExerciseTechniqueContent exercise={exercise} /></div>
    </section>
  </div>, host)
}
