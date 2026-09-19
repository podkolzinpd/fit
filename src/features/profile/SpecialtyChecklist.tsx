import { TRAINER_SPECIALTIES } from '../../shared/trainer-profile'

export function SpecialtyChecklist({ selected, onToggle, max, allowAll, onSelectAll }: {
  selected: string[]
  onToggle: (specialty: string, checked: boolean) => void
  max?: number
  /** Клиентский фильтр не ограничен максимумом — показывает явный пункт «Все направления». */
  allowAll?: boolean
  onSelectAll?: () => void
}) {
  const atMax = max !== undefined && selected.length >= max
  return <>
    {atMax && <p className="trainer-specialties-limit-note" role="status">Выбрано максимум направлений ({max}). Уберите одно, чтобы выбрать другое.</p>}
    <div className="trainer-specialties-options" role="group" aria-label="Направления">
      {allowAll && <label className="trainer-specialty-option trainer-specialty-option-all">
        <input type="checkbox" checked={selected.length === 0} onChange={() => onSelectAll?.()} />
        <span>Все направления</span>
      </label>}
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
