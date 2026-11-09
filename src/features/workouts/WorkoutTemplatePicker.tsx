import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { WorkoutTemplate } from '../../shared/domain'
import { CloseIcon } from '../../shared/icons'
import { AsyncView, EmptyState } from '../../shared/ui'
import { filterWorkoutTemplates, WorkoutTemplateSearch, WorkoutTemplateSearchEmpty } from '../../shared/workout-template-search'

function keepTemplateFocusInside(event: ReactKeyboardEvent<HTMLElement>) {
  if (event.key !== 'Tab') return
  const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])')]
  if (!focusable.length) return
  const index = focusable.indexOf(document.activeElement as HTMLElement)
  const next = (index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length
  event.preventDefault()
  focusable[next]!.focus()
}

export function WorkoutTemplatePicker({ templates, loading, error, onRetry, onSelect, onClose, onCreate, onLibrary }: {
  templates: WorkoutTemplate[]
  loading: boolean
  error: Error | null
  onRetry: () => void
  onSelect: (template: WorkoutTemplate) => void
  onClose: () => void
  onCreate: () => void
  onLibrary: () => void
}) {
  const [search, setSearch] = useState('')
  const visible = filterWorkoutTemplates(templates, search)
  useEffect(() => {
    const onEscape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() } }
    document.addEventListener('keydown', onEscape, true)
    return () => document.removeEventListener('keydown', onEscape, true)
  }, [onClose])
  return <div className="sheet-overlay" onClick={onClose}>
    <section className="workout-decision-sheet workout-template-picker" role="dialog" aria-modal="true" aria-label="Добавить шаблон тренировки" onKeyDown={keepTemplateFocusInside} onClick={(event) => event.stopPropagation()}>
      <header className="picker-header"><div><p className="eyebrow">ВАШИ ШАБЛОНЫ</p><h2>Добавить шаблон</h2></div><button type="button" className="picker-close" aria-label="Закрыть" autoFocus onClick={onClose}><CloseIcon /></button></header>
      <AsyncView loading={loading} error={error} onRetry={onRetry}>
        {Boolean(templates.length || search) && <WorkoutTemplateSearch value={search} onChange={setSearch} />}
        {templates.length > 0 ? visible.length ? <div className="workout-template-picker-list">{visible.map((template) => <button type="button" className="workout-template-picker-item" key={template.id} disabled={template.exercises.length === 0} onClick={() => onSelect(template)}>
          <strong>{template.name}</strong><span>{template.exercises.length} {'упр.'}</span>
          <small>{template.exercises.slice(0, 3).map((exercise) => exercise.name).join(' · ')}{template.exercises.length > 3 ? ` · ещё ${template.exercises.length - 3}` : ''}</small>
        </button>)}</div> : <WorkoutTemplateSearchEmpty /> : <EmptyState title="Шаблонов пока нет" description="Создайте шаблон и добавьте его в этот план." action={<div className="template-empty-actions"><button type="button" className="primary" onClick={onCreate}>Создать шаблон</button><button type="button" className="secondary" onClick={onLibrary}>Открыть библиотеку</button></div>} />}
      </AsyncView>
    </section>
  </div>
}
