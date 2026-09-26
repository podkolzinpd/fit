import type { AccountRole, Gender } from '../../shared/domain'
import {
  setBodyMapDisplayMode,
  useBodyMapDisplayMode,
  type BodyMapDisplayMode,
} from './body-map-appearance'

const LABELS: Record<BodyMapDisplayMode, string> = {
  real: 'Фигура',
  list: 'Список',
}

export function BodyMapAppearanceSetting({ viewerUserId, role, clientId, gender }: {
  viewerUserId: string
  role: AccountRole
  clientId?: string
  gender: Gender | null
}) {
  const mode = useBodyMapDisplayMode(viewerUserId, role, clientId, gender)
  const options: readonly BodyMapDisplayMode[] = role === 'trainer' || gender ? ['real', 'list'] : ['list']
  const hint = role === 'trainer'
    ? 'Ваш выбор для карт прогресса спортсменов'
    : 'Личный выбор — тренер его не увидит'
  return <section className="body-map-appearance-setting" aria-label="Вид карты тела">
    <div>
      <strong>Вид карты тела</strong>
      <span>{hint}</span>
    </div>
    <div className={`body-map-appearance-options count-${options.length}`} role="radiogroup" aria-label="Вид фигуры">
      {options.map((option) => <button
        key={option}
        type="button"
        role="radio"
        aria-checked={mode === option}
        onClick={() => setBodyMapDisplayMode(viewerUserId, role, clientId, option)}
      >
        {LABELS[option]}
      </button>)}
    </div>
    {!gender && role === 'client' && <small>Для фигуры укажите пол спортсмена</small>}
  </section>
}
