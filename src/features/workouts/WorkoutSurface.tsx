import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from 'react'

export type WorkoutUiState = 'planned' | 'current' | 'upcoming' | 'completed' | 'partial' | 'skipped' | 'history'
export type WorkoutUiTone = 'accent' | 'success' | 'warning' | 'neutral'
export type WorkoutActionVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive'

const STATUS_LABELS: Record<WorkoutUiState, string> = {
  planned: 'Планируется',
  current: 'Выполняется',
  upcoming: 'Далее',
  completed: 'Завершена',
  partial: 'Завершена частично',
  skipped: 'Пропущена',
  history: 'Результат',
}

const STATUS_TONES: Record<WorkoutUiState, WorkoutUiTone> = {
  planned: 'neutral',
  current: 'accent',
  upcoming: 'neutral',
  completed: 'success',
  partial: 'warning',
  skipped: 'neutral',
  history: 'neutral',
}

export function WorkoutStatus({ state, label }: { state: WorkoutUiState; label?: string }) {
  const legacyTone = state === 'completed' ? 'done' : state === 'current' ? 'in_progress' : state
  return <span className={`workout-status workout-status-${state} badge ${legacyTone}`} data-state={state} data-tone={STATUS_TONES[state]}>{label ?? STATUS_LABELS[state]}</span>
}

export function WorkoutHeader({ eyebrow, title, meta, state, statusLabel, action, className = '' }: {
  eyebrow?: string
  title: string
  meta?: ReactNode
  state: WorkoutUiState
  statusLabel?: string
  action?: ReactNode
  className?: string
}) {
  return <section className={`workout-header-contract workout-state-${state} ${className}`.trim()} data-state={state}>
    <div className="workout-header-copy">
      {eyebrow && <p className="workout-header-eyebrow">{eyebrow}</p>}
      <h2>{title}</h2>
      {meta && <div className="workout-header-meta">{meta}</div>}
    </div>
    <div className="workout-header-side"><WorkoutStatus state={state} label={statusLabel} />{action}</div>
  </section>
}

export function WorkoutExercise({ state, className = '', children }: PropsWithChildren<{
  state: WorkoutUiState
  className?: string
}>) {
  return <article className={`workout-exercise-contract workout-exercise-${state} ${className}`.trim()} data-state={state}>{children}</article>
}

export function WorkoutExerciseCompact({ title, meta, state, onClick, action, className = '' }: {
  title: string
  meta: ReactNode
  state: Extract<WorkoutUiState, 'completed' | 'upcoming'>
  onClick?: () => void
  action?: ReactNode
  className?: string
}) {
  const content = <>
    <span className="workout-exercise-compact-mark" aria-hidden="true">{state === 'completed' ? '✓' : '•'}</span>
    <span className="workout-exercise-compact-copy"><strong>{title}</strong><span>{meta}</span></span>
    {action ?? <WorkoutStatus state={state} />}
  </>
  return onClick
    ? <button type="button" className={`workout-exercise-compact workout-exercise-${state} ${className}`.trim()} data-state={state} onClick={onClick}>{content}</button>
    : <div className={`workout-exercise-compact workout-exercise-${state} ${className}`.trim()} data-state={state}>{content}</div>
}

export function WorkoutSetRow({ state, className = '', children }: PropsWithChildren<{
  state: WorkoutUiState
  className?: string
}>) {
  return <div className={`workout-set-row workout-set-contract workout-set-${state} ${className}`.trim()} data-state={state}>{children}</div>
}

const ACTION_VARIANT_CLASSES: Record<WorkoutActionVariant, string> = {
  primary: '',
  secondary: 'secondary',
  tertiary: 'link',
  destructive: 'secondary danger',
}

export function WorkoutCta({ pending, pendingLabel, variant = 'primary', className = '', children, ...props }: PropsWithChildren<{
  pending?: boolean
  pendingLabel?: string
  variant?: WorkoutActionVariant
  className?: string
} & ButtonHTMLAttributes<HTMLButtonElement>>) {
  return <button {...props} className={`workout-cta ${ACTION_VARIANT_CLASSES[variant]} ${className}`.trim()} data-variant={variant} disabled={props.disabled || pending} aria-busy={pending || undefined}>
    {pending ? pendingLabel ?? 'Сохраняем…' : children}
  </button>
}
