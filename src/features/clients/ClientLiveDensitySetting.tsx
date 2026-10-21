import { useAuth } from '../../app/auth-context'
import { isClientWorkoutRedesignEnabled } from '../../app/client-workout-redesign'
import { setClientLiveDensity, useClientLiveDensity } from '../../app/client-live-density'

export function ClientLiveDensitySetting() {
  const { actor } = useAuth()
  const density = useClientLiveDensity(actor?.userId)
  if (!actor || !isClientWorkoutRedesignEnabled(actor)) return null
  return <div className="schedule-density-setting client-live-density-setting">
    <div><strong>Вид Live-тренировки</strong><span>Выбор сохраняется для вашей учётки на этом устройстве.</span></div>
    <div className="schedule-density-options" role="radiogroup" aria-label="Вид Live-тренировки">
      {(['original', 'compact'] as const).map(value => <button key={value} type="button" role="radio" aria-checked={density === value} tabIndex={density === value ? 0 : -1} onClick={() => setClientLiveDensity(actor.userId, value)} onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const next = event.key === 'Home' ? 'original' : event.key === 'End' ? 'compact' : value === 'original' ? 'compact' : 'original'
        setClientLiveDensity(actor.userId, next)
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[next === 'original' ? 0 : 1]?.focus()
      }}>{value === 'original' ? 'Оригинальный' : 'Компактный'}</button>)}
    </div>
  </div>
}
