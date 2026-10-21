import type { ReactNode } from 'react'
import { BackIcon, CheckSmallIcon, CloseIcon } from './icons'

/** Client sheet composition from the approved Lime SVG. Business actions stay with the caller. */
export function FitLimeSheetHeader({ title, backLabel, onBack, disabled = false, confirmDisabled = disabled, onConfirm, confirmLabel, titleId }: {
  title: ReactNode
  titleId?: string
  backLabel: string
  onBack: () => void
  disabled?: boolean
  confirmDisabled?: boolean
  onConfirm?: () => void
  confirmLabel?: string
}) {
  return <header className="client-lime-sheet-header">
    <button type="button" aria-label={backLabel} disabled={disabled} onClick={onBack}>{backLabel === 'Закрыть' ? <CloseIcon /> : <BackIcon />}</button>
    <h1 id={titleId}>{title}</h1>
    {onConfirm && <button type="button" className="client-lime-sheet-confirm" aria-label={confirmLabel} disabled={confirmDisabled} onClick={onConfirm}><CheckSmallIcon /></button>}
  </header>
}
