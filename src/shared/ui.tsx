import { useCallback, useEffect, useRef, useState, type PropsWithChildren, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'

export function Page({ title, action, back, center, hideTitle, className, children }: PropsWithChildren<{
  title: string; action?: ReactNode; back?: string | number; center?: boolean; hideTitle?: boolean; className?: string
}>) {
  const navigate = useNavigate()
  const classes = ['page', center ? 'page-center' : '', className].filter(Boolean).join(' ')
  return <main className={classes}>
    <header className="page-header">
      {back !== undefined && <button type="button" className="page-back" aria-label="Назад" onClick={() => navigate(back as never)}>←</button>}
      {/* hideTitle — заголовок дублируется таб-баром (напр. «Расписание»);
          прячем визуально, но оставляем для скринридеров. */}
      <h1 className={hideTitle ? 'sr-only' : undefined}>{title}</h1>
      {action}
    </header>
    {children}
  </main>
}

export function AsyncView({ loading, error, empty, onRetry, children }: PropsWithChildren<{
  loading: boolean; error?: Error | null; empty?: boolean; onRetry?: () => void
}>) {
  if (loading) return <div className="state" role="status">Загрузка…</div>
  if (error) return <div className="state error" role="alert"><p>{error.message}</p>{onRetry && <button onClick={onRetry}>Повторить</button>}</div>
  if (empty) return <div className="state">Пока ничего нет</div>
  return children
}

export function Field({ label, error, children }: PropsWithChildren<{ label: string; error?: string }>) {
  return <label className="field"><span>{label}</span>{children}{error && <small className="error">{error}</small>}</label>
}

// Единый статус-бейдж (текущий/предстоит/выполнено) для быстрого понимания
// положения в тренировке. Цвет и подпись — по семантике статуса.
const STATUS_BADGE: Record<string, string> = { current: 'Сейчас', upcoming: 'Далее', done: 'Готово' }
export function StatusBadge({ status }: { status: 'current' | 'upcoming' | 'done' }) {
  return <span className={`status-badge status-${status}`}>{STATUS_BADGE[status]}</span>
}

export interface ConfirmOptions {
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

interface ConfirmState extends ConfirmOptions { resolve: (ok: boolean) => void }

// In-app подтверждение вместо window.confirm. Нативный confirm в WKWebView
// (Capacitor) не показывается и блокировал действия (урок #127), а также
// выпадает из премиального light-облика — свой диалог на дизайн-токенах.
// Использование:
//   const [confirm, confirmDialog] = useConfirm()
//   onClick={async () => { if (await confirm({ message: '…', danger: true })) mutate() }}
//   ...и один раз отрисовать {confirmDialog} в разметке.
export function useConfirm(): [(options: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [state, setState] = useState<ConfirmState | null>(null)
  const confirm = useCallback((options: ConfirmOptions) =>
    new Promise<boolean>((resolve) => setState({ ...options, resolve })), [])
  const close = useCallback((ok: boolean) => {
    setState((current) => { current?.resolve(ok); return null })
  }, [])
  const dialog = state
    ? <ConfirmDialog {...state} onCancel={() => close(false)} onConfirm={() => close(true)} />
    : null
  return [confirm, dialog]
}

function ConfirmDialog({ message, confirmLabel = 'Подтвердить', cancelLabel = 'Отмена', danger, onCancel, onConfirm }:
  ConfirmOptions & { onCancel: () => void; onConfirm: () => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    confirmRef.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])
  // Портал в .phone-frame (а не в body): overlay всё равно fixed/во весь экран,
  // но так диалог наследует активную тему (класс .theme-light вешается на
  // .phone-frame в светлом пилоте). Портал в body отрисовал бы диалог с
  // токенами :root (тёмными) поверх светлого экрана. Fallback — body.
  const host = document.querySelector('.phone-frame') ?? document.body
  return createPortal(
    <div className="modal-overlay" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <div className="modal-dialog" role="alertdialog" aria-modal="true" aria-label={message}>
        <p className="modal-message">{message}</p>
        <div className="actions">
          <button type="button" className="secondary" onClick={onCancel}>{cancelLabel}</button>
          <button type="button" ref={confirmRef} className={danger ? 'danger' : undefined} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>,
    host,
  )
}

export interface OverflowMenuItem { label: string; onClick: () => void; danger?: boolean; disabled?: boolean }
// Меню «три точки» для редких действий, чтобы они не конкурировали с основными.
// Пункты сохраняют свои названия (доступны по имени после раскрытия меню).
export function OverflowMenu({ items, label = 'Ещё действия' }: { items: OverflowMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false) }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  if (items.length === 0) return null
  return <div className="overflow-menu" ref={ref}>
    <button type="button" className="overflow-trigger" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>⋯</button>
    {open && <div className="overflow-list" role="menu">
      {items.map((item) => <button key={item.label} type="button" role="menuitem" disabled={item.disabled}
        className={item.danger ? 'overflow-item danger' : 'overflow-item'}
        onClick={() => { setOpen(false); item.onClick() }}>{item.label}</button>)}
    </div>}
  </div>
}
