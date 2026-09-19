import { useState } from 'react'
import { PRESET_WORKOUTS } from '../../shared/preset-workouts'
import { ChevronRightIcon, ExerciseIcon } from '../../shared/icons'

function presetCountLabel(count: number): string {
  const mod100 = count % 100
  const mod10 = count % 10
  const noun = mod100 >= 11 && mod100 <= 14
    ? 'планов'
    : mod10 === 1
      ? 'план'
      : mod10 >= 2 && mod10 <= 4
        ? 'плана'
        : 'планов'
  return `${count} ${noun}`
}

export function PresetWorkoutList({ onSelect, pending = false }: { onSelect: (presetId: string) => void; pending?: boolean }) {
  return <section className="preset-workout-picker" aria-label="Готовые тренировки">
    <p className="preset-workout-picker-hint">Выберите тренировку — упражнения можно будет изменить перед сохранением</p>
    <div className="preset-workout-picker-list">
      {PRESET_WORKOUTS.map((preset) => <article className="preset-workout-card card" key={preset.id}>
        <div>
          <strong>{preset.title}</strong>
          <p>{preset.description}</p>
          <small>{preset.exercises.length} упражнений · ~{preset.estimatedDurationMin} мин</small>
        </div>
        <button type="button" className="secondary" disabled={pending} onClick={() => onSelect(preset.id)}>Выбрать</button>
      </article>)}
    </div>
  </section>
}

export function PresetWorkoutPicker({ onSelect, pending = false }: { onSelect: (presetId: string) => void; pending?: boolean }) {
  const [open, setOpen] = useState(false)

  if (!open) return <button type="button" className="preset-workout-cta" aria-label="Попробовать готовую тренировку" onClick={() => setOpen(true)}>
    <span className="preset-workout-cta-icon"><ExerciseIcon /></span>
    <span className="preset-workout-cta-copy">
      <strong>Готовая тренировка</strong>
      <small>{presetCountLabel(PRESET_WORKOUTS.length)} — выберите и начните</small>
    </span>
    <ChevronRightIcon className="preset-workout-cta-chev" />
  </button>

  return <PresetWorkoutList onSelect={onSelect} pending={pending} />
}
