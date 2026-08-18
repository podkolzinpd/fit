import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PropsWithChildren, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { AddIcon, AlertIcon, BackIcon, CheckIcon, MoreIcon, PendingIcon } from './icons'

export function Page({ title, action, back, center, hideTitle, className, children }: PropsWithChildren<{
  title: string; action?: ReactNode; back?: string | number; center?: boolean; hideTitle?: boolean; className?: string
}>) {
  const navigate = useNavigate()
  const classes = ['page', center ? 'page-center' : '', className].filter(Boolean).join(' ')
  return <main className={classes}>
    <header className="page-header">
      {back !== undefined && <button type="button" className="page-back" aria-label="Назад" onClick={() => navigate(back as never)}><BackIcon /></button>}
      {/* hideTitle — заголовок дублируется таб-баром (напр. «Расписание»);
          прячем визуально, но оставляем для скринридеров. */}
      <h1 className={hideTitle ? 'sr-only' : undefined}>{title}</h1>
      {action}
    </header>
    {children}
  </main>
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return <div className="skeleton-stack" role="status" aria-label="Загрузка">
    <span className="sr-only">Загрузка…</span>
    {Array.from({ length: rows }, (_, index) => <div className="skeleton-card" aria-hidden="true" key={index}>
      <span className="skeleton-block skeleton-title" />
      <span className="skeleton-block skeleton-line" />
    </div>)}
  </div>
}

export function EmptyState({ title = 'Пока ничего нет', description = 'Здесь появятся новые данные.', action }: {
  title?: string; description?: string; action?: ReactNode
}) {
  return <div className="empty-state">
    <span className="empty-state-mark" aria-hidden="true"><AddIcon /></span>
    <h2>{title}</h2>
    <p>{description}</p>
    {action}
  </div>
}

export function SaveStatus({ status, error }: {
  status: 'idle' | 'saving' | 'saved' | 'error'; error?: string
}) {
  if (status === 'idle') return null
  const text = status === 'saving' ? 'Сохраняем…' : status === 'saved' ? 'Сохранено' : error ?? 'Не удалось сохранить'
  return <p className={`save-status save-status-${status}`} role={status === 'error' ? 'alert' : 'status'}>
    <span className="save-status-mark" aria-hidden="true">{status === 'saving' ? <PendingIcon /> : status === 'saved' ? <CheckIcon /> : <AlertIcon />}</span>
    {text}
  </p>
}

export function AsyncView({ loading, error, empty, onRetry, emptyTitle, emptyDescription, emptyAction, children }: PropsWithChildren<{
  loading: boolean; error?: Error | null; empty?: boolean; onRetry?: () => void
  emptyTitle?: string; emptyDescription?: string; emptyAction?: ReactNode
}>) {
  if (loading) return <Skeleton />
  if (error) return <div className="state async-error error" role="alert">
    <span className="async-state-mark" aria-hidden="true"><AlertIcon /></span>
    <div><h2>Не удалось загрузить</h2><p>{error.message}</p></div>
    {onRetry && <button onClick={onRetry}>Повторить</button>}
  </div>
  if (empty) return <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
  return children
}

export function Field({ label, error, children }: PropsWithChildren<{ label: string; error?: string }>) {
  return <label className="field"><span>{label}</span>{children}{error && <small className="error">{error}</small>}</label>
}

export function Switch({ label, checked, onChange }: {
  label: string; checked: boolean; onChange: (checked: boolean) => void
}) {
  return <label className="switch-row">
    <span className="switch-label">{label}</span>
    <input className="switch-input" role="switch" type="checkbox" checked={checked}
      onChange={(event) => onChange(event.target.checked)} />
    <span className="switch-control" aria-hidden="true" />
  </label>
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
  // .phone-frame в основной светлой теме). Портал в body при аварийном
  // переключении темы мог бы получить другой набор токенов. Fallback — body.
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
  const [position, setPosition] = useState<CSSProperties | null>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    const menu = menuRef.current
    const frame = document.querySelector<HTMLElement>('.phone-frame')
    if (!trigger || !menu) return

    const triggerRect = trigger.getBoundingClientRect()
    const menuRect = menu.getBoundingClientRect()
    // В приложении ограничиваемся рамкой телефона. В изолированных частях UI
    // (и их unit-тестах) оболочки может не быть — тогда граница это viewport.
    const frameRect = frame?.getBoundingClientRect() ?? {
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
      left: 0,
    }
    const lowerBars = Array.from(document.querySelectorAll<HTMLElement>('.tab-bar, .live-bottom-bar'))
      .map((bar) => bar.getBoundingClientRect())
      .filter((bar) => bar.width > 0 && bar.height > 0 && bar.left < frameRect.right && bar.right > frameRect.left)
    const bottomLimit = Math.min(frameRect.bottom, ...lowerBars.map((bar) => bar.top))
    const gap = 6
    const minTop = frameRect.top + 8
    const maxTop = Math.max(minTop, bottomLimit - menuRect.height - 8)
    const opensAbove = triggerRect.bottom + gap + menuRect.height > bottomLimit
    const proposedTop = opensAbove ? triggerRect.top - gap - menuRect.height : triggerRect.bottom + gap
    const top = Math.min(Math.max(proposedTop, minTop), maxTop)
    const minLeft = frameRect.left + 8
    const maxLeft = Math.max(minLeft, frameRect.right - menuRect.width - 8)
    const left = Math.min(Math.max(triggerRect.right - menuRect.width, minLeft), maxLeft)
    setPosition({ top, left })
  }, [])

  useLayoutEffect(() => {
    if (!open) { setPosition(null); return }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, updatePosition])
  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  if (items.length === 0) return null
  const host = document.querySelector('.phone-frame') ?? document.body
  return <div className="overflow-menu" ref={triggerRef}>
    <button type="button" className="overflow-trigger" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}><MoreIcon /></button>
    {open && createPortal(<div ref={menuRef} className="overflow-list" role="menu" style={position ?? { visibility: 'hidden' }}>
      {items.map((item) => <button key={item.label} type="button" role="menuitem" disabled={item.disabled}
        className={item.danger ? 'overflow-item danger' : 'overflow-item'}
        onClick={() => { setOpen(false); item.onClick() }}>{item.label}</button>)}
    </div>, host)}
  </div>
}
