import type { ScheduleDensity } from '../../shared/domain'
import { useScheduleDensityPreference } from '../../app/schedule-density'
import { SaveStatus } from '../../shared/ui'

const OPTIONS: Array<{ value: ScheduleDensity; label: string }> = [
  { value: 'comfortable', label: 'Обычная' },
  { value: 'compact', label: 'Компактная' },
]

export function ScheduleDensitySetting() {
  const preference = useScheduleDensityPreference()

  return <div className="schedule-density-setting">
    <div>
      <strong>Плотность временной сетки</strong>
      <span>Компактная сетка показывает больше часов на одном экране.</span>
    </div>
    <div className="schedule-density-options" role="radiogroup" aria-label="Плотность временной сетки">
      {OPTIONS.map((option) => <button
        key={option.value}
        type="button"
        role="radio"
        aria-checked={preference.density === option.value}
        disabled={preference.status === 'saving'}
        onClick={() => void preference.save(option.value)}
      >{option.label}</button>)}
    </div>
    {preference.status === 'saving' && <SaveStatus status="saving" />}
    {preference.status === 'saved' && <SaveStatus status="saved" />}
    {preference.status === 'error' && <div className="schedule-density-error" role="alert">
      <span>Не удалось сохранить плотность сетки.</span>
      <button type="button" className="link" onClick={preference.retry}>Повторить</button>
    </div>}
  </div>
}
