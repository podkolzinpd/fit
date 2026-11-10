import { useId } from 'react'
import type { TrainerFinancePackage } from '../../data/contracts/trainer-finance'
import { financePackagePeriod } from './finance-package-label'
import './finance-accounting-choices.css'

export function FinanceAccountingChoices({ packages, value, disabled, unavailableValue, onChange, allowNewSingle = false, historicalTrial = false }: {
  allowNewSingle?: boolean
  historicalTrial?: boolean
  packages: TrainerFinancePackage[]
  value: string
  disabled: boolean
  unavailableValue?: string
  onChange: (value: string) => void
}) {
  const name = useId()
  const choices = [
    ...packages.map(pack => ({ value: `charged:${pack.id}`, title: pack.title,
      detail: `${financePackagePeriod(pack)} · осталось ${pack.sessionsRemaining}`, disabled: false })),
    ...(unavailableValue ? [{ value: unavailableValue, title: 'Абонемент недоступен', detail: '', disabled: true }] : []),
    ...(allowNewSingle ? [{ value: 'single:new', title: 'Разовое занятие', detail: '', disabled: false }] : []),
    { value: 'unassigned', title: 'Выбрать позже', detail: '', disabled: false },
    ...(historicalTrial ? [{ value: 'trial', title: 'Пробное занятие', detail: '', disabled: false }] : []),
    { value: 'free', title: 'Без списания', detail: '', disabled: false },
  ]
  return <fieldset className="finance-accounting-choices" disabled={disabled}>
    <legend>Учёт занятия</legend>
    {choices.map(choice => <label key={choice.value}>
      <input type="radio" name={name} value={choice.value} checked={value === choice.value}
        disabled={choice.disabled} onChange={() => onChange(choice.value)} />
      <span><span className="finance-accounting-choice-title">{choice.title}</span>{' '}
        {choice.detail && <span className="finance-accounting-choice-detail">{choice.detail}</span>}</span>
    </label>)}
  </fieldset>
}
