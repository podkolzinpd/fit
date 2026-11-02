import { useEffect, useRef } from 'react'
import { formatLocalDate, type LocalDate } from '../../shared/local-date'
import { CloseIcon } from '../../shared/icons'
import { WorkoutCta } from './WorkoutSurface'
import type { WorkoutFormDraft } from './workout-form-draft'

type Choice = { key: string; draft: WorkoutFormDraft }

export function TrainerTemplateDraftChoice({ choices, date, clientNames, error, onResume, onFresh, onClose }: {
  choices: readonly Choice[]
  date: LocalDate
  clientNames: ReadonlyMap<string, string>
  error: string | null
  onResume: (choice: Choice) => void
  onFresh: () => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    close.current?.focus({ preventScroll: true })
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [onClose])
  return <div className="sheet-overlay" onClick={onClose}>
    <section ref={dialog} className="workout-decision-sheet workout-template-picker template-assignment-choice" role="dialog" aria-modal="true" aria-label="Есть черновик этого шаблона" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
      if (event.key !== 'Tab') return
      const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled)')
      const first = controls?.[0], last = controls?.[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }}>
      <header className="picker-header"><h2>Есть черновик этого шаблона</h2><button ref={close} type="button" className="picker-close" aria-label="Закрыть" onClick={onClose}><CloseIcon /></button></header>
      <div className="workout-template-picker-list">{choices.map((choice) => <button type="button" className="workout-template-picker-item" key={choice.key} onClick={() => onResume(choice)}>
        <strong>{choice.draft.title?.trim() || 'План тренировки'}</strong>
        <span>{clientNames.get(choice.draft.clientId) ?? 'Клиент из черновика'} · {formatLocalDate(choice.draft.workoutDate)}{choice.draft.startTime ? ` · ${choice.draft.startTime.slice(0, 5)}` : ''}</span>
        <small>Продолжить черновик</small>
      </button>)}</div>
      <p className="muted">Прежние черновики останутся сохранёнными.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <WorkoutCta type="button" onClick={onFresh}>Новый план на {formatLocalDate(date)}</WorkoutCta>
    </section>
  </div>
}
