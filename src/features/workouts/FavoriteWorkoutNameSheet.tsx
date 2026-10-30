import { useEffect, useRef, useState, type ReactNode } from 'react'
import { FitLimeSheetHeader } from '../../shared/FitLimeSheetHeader'
import { CloseIcon } from '../../shared/icons'
import { Field, InlineRequestError } from '../../shared/ui'
import { WorkoutCta } from './WorkoutSurface'

/** The two favorite-name actions share focus, pending and Lime composition. */
export function FavoriteWorkoutNameSheet({ heading, lime, initialTitle = '', placeholder, pending, error, recovery, notice, onSave, onClose }: {
  heading: string; lime: boolean; initialTitle?: string; placeholder?: string; pending: boolean
  error: Error | null; recovery?: ReactNode; notice?: ReactNode; onSave: (title: string) => void; onClose: () => void
}) {
  const [title, setTitle] = useState(initialTitle)
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    ref.current?.querySelector('input')?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])
  return <div className="sheet-overlay favorite-workout-rename-overlay" onClick={() => !pending && onClose()}>
    <section ref={ref} className="workout-decision-sheet workout-favorite-save-sheet favorite-workout-rename-sheet" role="dialog" aria-modal="true" aria-label={heading} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.stopPropagation(); if (!pending) { event.preventDefault(); onClose() } }
      if (event.key !== 'Tab') return
      const controls = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href]') ?? [])
      const first = controls[0], last = controls.at(-1)
      if (!first) { event.preventDefault(); return }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }}>
      {lime ? <FitLimeSheetHeader title={heading} backLabel="Закрыть" onBack={onClose} disabled={pending} />
        : <header className="picker-header"><h2>{heading}</h2><button type="button" className="picker-close" aria-label="Закрыть" disabled={pending} onClick={onClose}><CloseIcon /></button></header>}
      <form className="stack compact" onSubmit={(event) => { event.preventDefault(); const value = title.trim() || placeholder; if (!pending && !recovery && value) onSave(value) }}>
        <Field label="Название"><input value={title} maxLength={120} placeholder={placeholder} required={!placeholder} disabled={pending} onChange={(event) => setTitle(event.target.value)} /></Field>
        {error && <InlineRequestError error={error} />}
        {notice}
        {recovery}
        <div className="actions workout-action-row"><WorkoutCta type="button" variant="tertiary" disabled={pending} onClick={onClose}>Отмена</WorkoutCta><WorkoutCta type="submit" pending={pending} pendingLabel="Сохраняем…" disabled={!title.trim() && !placeholder || Boolean(recovery)}>Сохранить</WorkoutCta></div>
      </form>
    </section>
  </div>
}
