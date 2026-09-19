import { TRAINER_SPECIALTIES } from '../../shared/trainer-profile'

export function SpecialtyChecklist({ selected, onToggle, max }: {
  selected: string[]
  onToggle: (specialty: string, checked: boolean) => void
  max?: number
}) {
  const atMax = max !== undefined && selected.length >= max
  return <>
    {atMax && <p className="trainer-specialties-limit-note" role="status">Выбрано максимум направлений ({max}). Уберите одно, чтобы выбрать другое.</p>}
    <div className="trainer-specialties-options" role="group" aria-label="Направления">
      {TRAINER_SPECIALTIES.map((specialty) => {
        const checked = selected.includes(specialty)
        const disabled = !checked && atMax
        return <label key={specialty} className={`trainer-specialty-option${disabled ? ' disabled' : ''}`}>
          <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onToggle(specialty, event.target.checked)} />
          <span>{specialty}</span>
        </label>
      })}
    </div>
  </>
}
