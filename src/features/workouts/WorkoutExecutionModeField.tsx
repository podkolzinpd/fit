import type { WorkoutExecutionMode } from '../../shared/domain'
import { Switch } from '../../shared/ui'

// Кто ведёт тренировку в Live (YAFIT-627). По умолчанию — человек, поэтому это
// не выбор из двух, а тихая опция: одна строка с переключателем и короткой
// подписью, что изменится на тренировке.
export function WorkoutExecutionModeField({ value, onChange }: { value: WorkoutExecutionMode; onChange: (mode: WorkoutExecutionMode) => void }) {
  return <div className="workout-execution-mode">
    <Switch label="Таймер сам ведёт подходы" checked={value === 'timer'} onChange={(checked) => onChange(checked ? 'timer' : 'manual')} />
    <small>Подходы со временем стартуют и засчитываются автоматически</small>
  </div>
}
