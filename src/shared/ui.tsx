import type { PropsWithChildren, ReactNode } from 'react'
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
