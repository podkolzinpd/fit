import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from 'react'

export type WorkoutUiState = 'planned' | 'current' | 'upcoming' | 'completed' | 'partial' | 'decision' | 'cancelled' | 'skipped' | 'history'
export type WorkoutUiTone = 'accent' | 'success' | 'warning' | 'neutral'
export type WorkoutActionVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive'
export type WorkoutChoiceTone = 'neutral' | 'destructive'

const STATUS_LABELS: Record<WorkoutUiState, string> = {
  planned: 'Планируется',
  current: 'Выполняется',
  upcoming: 'Далее',
  completed: 'Завершена',
  partial: 'Завершена частично',
  decision: 'План',
  cancelled: 'Не состоялась',
  skipped: 'Не выполнено',
  history: 'Результат',
}

const STATUS_TONES: Record<WorkoutUiState, WorkoutUiTone> = {
  planned: 'neutral',
  current: 'accent',
  upcoming: 'neutral',
  completed: 'success',
  partial: 'warning',
  decision: 'neutral',
  cancelled: 'neutral',
  skipped: 'neutral',
  history: 'neutral',
}

export function WorkoutStatus({ state, label }: { state: WorkoutUiState; label?: string }) {
  const legacyTone = state === 'completed' ? 'done' : state === 'current' ? 'in_progress' : state
  return <span className={`workout-status workout-status-${state} badge ${legacyTone}`} data-state={state} data-tone={STATUS_TONES[state]}>{label ?? STATUS_LABELS[state]}</span>
}

export function WorkoutHeader({ eyebrow, title, meta, state, statusLabel, action, showStatus = true, className = '' }: {
  eyebrow?: string
  title: string
  meta?: ReactNode
  state: WorkoutUiState
  statusLabel?: string
  action?: ReactNode
  showStatus?: boolean
  className?: string
}) {
  return <section className={`workout-header-contract workout-state-${state} ${className}`.trim()} data-state={state}>
    <div className="workout-header-copy">
      {eyebrow && <p className="workout-header-eyebrow">{eyebrow}</p>}
      <h2>{title}</h2>
      {meta && <div className="workout-header-meta">{meta}</div>}
    </div>
    {(showStatus || action) && <div className="workout-header-side">{showStatus && <WorkoutStatus state={state} label={statusLabel} />}{action}</div>}
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
  primary: 'primary',
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
  const disabled = props.disabled || pending
  const controlState = pending ? 'loading' : disabled ? 'disabled' : variant === 'destructive' ? 'destructive' : 'idle'
  return <button {...props} className={`workout-cta ${ACTION_VARIANT_CLASSES[variant]} ${className}`.trim()} data-variant={variant} data-control-state={controlState} disabled={disabled} aria-busy={pending || undefined}>
    {pending ? pendingLabel ?? 'Сохраняем…' : children}
  </button>
}

export function WorkoutChoice({ selected, tone = 'neutral', pending = false, className = '', children, ...props }: PropsWithChildren<{
  selected: boolean
  tone?: WorkoutChoiceTone
  pending?: boolean
  className?: string
} & ButtonHTMLAttributes<HTMLButtonElement>>) {
  const disabled = props.disabled || pending
  const controlState = pending ? 'loading' : disabled ? 'disabled' : selected ? 'selected' : tone === 'destructive' ? 'destructive' : 'idle'
  return <button {...props} type={props.type ?? 'button'} className={`secondary workout-choice ${className}`.trim()}
    data-control-state={controlState} data-tone={tone} disabled={disabled} aria-busy={pending || undefined} aria-pressed={selected}>
    {children}
  </button>
}

const RPE_LABELS: Record<number, string> = {
  1: 'Очень легко', 2: 'Легко', 3: 'Легко', 4: 'Умеренно', 5: 'Умеренно',
  6: 'Ощутимо', 7: 'Тяжело', 8: 'Очень тяжело', 9: 'Почти максимум', 10: 'Максимум',
}

export function WorkoutRpeScale({ value, onChange, disabled = false, 'aria-label': ariaLabel = 'Нагрузка по шкале RPE' }: {
  value?: number
  onChange: (value: number) => void
  disabled?: boolean
  'aria-label'?: string
}) {
  return <div className="workout-rpe-scale" data-control-state={disabled ? 'disabled' : value === undefined ? 'idle' : 'selected'}>
    <div className="workout-rpe-scale-value" aria-live="polite">
      {value === undefined ? <><strong>Выберите нагрузку</strong><span>1 — легко, 10 — максимум</span></> : <><strong>RPE {value}</strong><span>{RPE_LABELS[value]}</span></>}
    </div>
    <div className="workout-rpe-options" role="radiogroup" aria-label={ariaLabel}>
      {Object.keys(RPE_LABELS).map(Number).map((option) => <button key={option} type="button" role="radio"
        aria-checked={value === option} aria-label={`${option} — ${RPE_LABELS[option]}`} disabled={disabled}
        className="workout-rpe-option" data-control-state={value === option ? 'selected' : 'idle'}
        onClick={() => onChange(option)}>{option}</button>)}
    </div>
  </div>
}
