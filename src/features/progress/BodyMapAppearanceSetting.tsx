import type { AccountRole, Gender } from '../../shared/domain'
import {
  allowedBodyMapAppearances,
  setBodyMapAppearance,
  useBodyMapAppearance,
  type BodyMapAppearance,
} from './body-map-appearance'

const LABELS: Record<BodyMapAppearance, string> = {
  male: 'Мужская фигура',
  female: 'Женская фигура',
  neutral: 'Схема',
}

export function BodyMapAppearanceSetting({ userId, role, gender }: {
  userId: string
  role: AccountRole
  gender: Gender | null
}) {
  const appearance = useBodyMapAppearance(userId, role, gender)
  const options = allowedBodyMapAppearances(role, gender)
  return <section className="body-map-appearance-setting" aria-labelledby="body-map-appearance-title">
    <div>
      <strong id="body-map-appearance-title">Фигура на карте тела</strong>
      <span>Личный выбор — другим пользователям он не виден</span>
    </div>
    <div className={`body-map-appearance-options count-${options.length}`} role="radiogroup" aria-label="Вид фигуры">
      {options.map((option) => <button
        key={option}
        type="button"
        role="radio"
        aria-checked={appearance === option}
        onClick={() => setBodyMapAppearance(userId, role, option)}
      >
        <span className={`body-map-appearance-icon ${option}`} aria-hidden="true" />
        {LABELS[option]}
      </button>)}
    </div>
  </section>
}
