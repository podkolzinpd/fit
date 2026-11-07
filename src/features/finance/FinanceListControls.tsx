import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { coachWorkoutReferenceAssets } from '../../shared/coach-workout-reference-assets'
import { CloseIcon, SearchIcon } from '../../shared/icons'

export function FinanceListToolbar({ navigation, onSearch, searchOpen, onFilter, filterOpen, filtered, disabled = false }: {
  navigation?: ReactNode
  onSearch?: () => void
  searchOpen?: boolean
  onFilter: () => void
  filterOpen?: boolean
  filtered: boolean
  disabled?: boolean
}) {
  return <div className="finance-list-toolbar">
    {navigation}
    {onSearch && <button type="button" className="finance-list-tool" aria-label="Открыть поиск клиента" aria-expanded={searchOpen} onClick={onSearch}><SearchIcon /></button>}
    <button type="button" className={`finance-list-tool${filtered ? ' is-active' : ''}`} disabled={disabled}
      aria-label={filtered ? 'Фильтровать, выбран фильтр' : 'Фильтровать'} aria-haspopup="dialog" aria-expanded={filterOpen ?? false} onClick={onFilter}>
      <img src={coachWorkoutReferenceAssets.filter} alt="" width="20" height="20" />
      {filtered && <span className="finance-filter-mark" aria-hidden="true" />}
    </button>
  </div>
}

/** The existing native-dialog sheet pattern keeps keyboard focus and viewport
 * bounds inside the phone shell. No finance command is performed here. */
export function FinanceFilterSheet<Value extends string>({ label, value, options, onChange, onClose }: {
  label: string
  value: Value
  options: ReadonlyArray<{ id: Value; label: string }>
  onChange: (value: Value) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const trigger = document.querySelector<HTMLElement>('.finance-overview-page .finance-list-toolbar [aria-haspopup="dialog"]')
    const pathname = window.location.pathname
    const dialog = ref.current
    dialog?.showModal()
    return () => {
      dialog?.close()
      // WebKit pointer taps need not focus the trigger. The payment-client
      // query also remounts it, so resolve the surviving trigger after commit.
      requestAnimationFrame(() => {
        if (window.location.pathname !== pathname) return
        const target = trigger?.isConnected ? trigger : document.querySelector<HTMLElement>('.finance-overview-page .finance-list-toolbar [aria-haspopup="dialog"]')
        target?.focus({ preventScroll: true })
      })
    }
  }, [])
  return createPortal(<dialog ref={ref} className="finance-filter-sheet" aria-label={label}
    onCancel={event => { event.preventDefault(); onClose() }} onPointerDown={event => {
      const r = event.currentTarget.getBoundingClientRect()
      if (event.target === event.currentTarget && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)) onClose()
    }}>
    <header className="picker-header"><h2>Фильтры</h2><button type="button" className="picker-close" aria-label="Закрыть фильтры" onClick={onClose}><CloseIcon /></button></header>
    <fieldset><legend className="sr-only">{label}</legend>{options.map(option => <label key={option.id}>
      <input type="radio" name="finance-list-filter" value={option.id} checked={value === option.id} onChange={() => { onChange(option.id); onClose() }} />
      <span>{option.label}</span>
    </label>)}</fieldset>
  </dialog>, document.querySelector('.phone-frame') ?? document.body)
}
