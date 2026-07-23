import type { PropsWithChildren, ReactNode } from 'react'

export function Page({ title, action, className, children }: PropsWithChildren<{ title: string; action?: ReactNode; className?: string }>) {
  return <main className={className ? `page ${className}` : 'page'}><header className="page-header"><h1>{title}</h1>{action}</header>{children}</main>
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
