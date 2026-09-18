import { useState } from 'react'
import { PRESET_WORKOUTS } from '../../shared/preset-workouts'

export function PresetWorkoutPicker({ onSelect, pending = false }: { onSelect: (presetId: string) => void; pending?: boolean }) {
  const [open, setOpen] = useState(false)

  if (!open) return <button type="button" className="link today-preset-toggle" onClick={() => setOpen(true)}>Попробовать готовую тренировку</button>

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
