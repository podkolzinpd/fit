import { useState } from 'react'
import { PRESET_WORKOUTS } from '../../shared/preset-workouts'
import { ChevronRightIcon, ExerciseIcon } from '../../shared/icons'
import { exerciseCountText } from '../../shared/exercise-count'

export function PresetWorkoutList({ onSelect, pending = false, actionLabel = 'Выбрать' }: { onSelect: (presetId: string) => void; pending?: boolean; actionLabel?: string }) {
  return <section className="preset-workout-picker" aria-label="Готовые тренировки">
    <div className="preset-workout-picker-list">
      {PRESET_WORKOUTS.map((preset) => <article className="preset-workout-card card" key={preset.id}>
        <div>
          <strong>{preset.title}</strong>
          <p>{preset.description}</p>
          <small>{exerciseCountText(preset.exercises.length)} · ~{preset.estimatedDurationMin} мин</small>
        </div>
        <button type="button" className="secondary" disabled={pending} onClick={() => onSelect(preset.id)}>{actionLabel}</button>
      </article>)}
    </div>
  </section>
}

export function PresetWorkoutPicker({ onSelect, pending = false }: { onSelect: (presetId: string) => void; pending?: boolean }) {
  const [open, setOpen] = useState(false)

  if (!open) return <button type="button" className="preset-workout-cta" aria-label="Выбрать готовый план" onClick={() => setOpen(true)}>
    <span className="preset-workout-cta-icon"><ExerciseIcon /></span>
    <span className="preset-workout-cta-copy">
      <strong>Готовые планы</strong>
      <small>Выберите план и запланируйте тренировку</small>
    </span>
    <ChevronRightIcon className="preset-workout-cta-chev" />
  </button>

  return <PresetWorkoutList onSelect={onSelect} pending={pending} />
}
