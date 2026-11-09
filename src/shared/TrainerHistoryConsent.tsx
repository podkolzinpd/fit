import { Switch } from './ui'

export const TRAINER_HISTORY_CONSENT_LABEL = 'Вся история тренировок'

export function TrainerHistoryConsent({ checked, soloChecked = false, disabled, onChange, onSoloChange }: {
  checked: boolean; soloChecked?: boolean; disabled?: boolean; onChange: (enabled: boolean) => void
  onSoloChange?: (enabled: boolean) => void
}) {
  return <>
    <Switch label={TRAINER_HISTORY_CONSENT_LABEL} checked={checked} disabled={disabled} onChange={onChange} />
    {onSoloChange && <Switch label="История самостоятельных тренировок" checked={checked || soloChecked}
      disabled={disabled || checked} onChange={onSoloChange} />}
  </>
}
