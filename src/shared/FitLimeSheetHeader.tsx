import { BackIcon, CheckSmallIcon, CloseIcon } from './icons'

/** Client sheet composition from the approved Lime SVG. Business actions stay with the caller. */
export function FitLimeSheetHeader({ title, backLabel, onBack, disabled = false, onConfirm, confirmLabel }: {
  title: string
  backLabel: string
  onBack: () => void
  disabled?: boolean
  onConfirm?: () => void
  confirmLabel?: string
}) {
  return <header className="client-lime-sheet-header">
    <button type="button" aria-label={backLabel} disabled={disabled} onClick={onBack}>{backLabel === 'Закрыть' ? <CloseIcon /> : <BackIcon />}</button>
    <h1>{title}</h1>
    {onConfirm && <button type="button" aria-label={confirmLabel} disabled={disabled} onClick={onConfirm}><CheckSmallIcon /></button>}
  </header>
}
