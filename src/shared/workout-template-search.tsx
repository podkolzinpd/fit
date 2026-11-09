import { useRef } from 'react'
import { CloseIcon, SearchIcon } from './icons'

function normalize(value: string) {
  return value.trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')
}

export function filterWorkoutTemplates<T extends { name: string }>(templates: readonly T[], search: string): readonly T[] {
  const query = normalize(search)
  return query ? templates.filter((template) => normalize(template.name).includes(query)) : templates
}

export function WorkoutTemplateSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  return <div className="clients-search workout-template-search">
    <SearchIcon aria-hidden="true" />
    <input ref={input} type="search" aria-label="Поиск по названию шаблона" placeholder="Поиск по названию" autoComplete="off" value={value} onChange={(event) => onChange(event.target.value)} />
    {value !== '' && <button type="button" className="clients-search-clear" aria-label="Очистить поиск" onClick={() => { onChange(''); input.current?.focus() }}><CloseIcon /></button>}
  </div>
}

export function WorkoutTemplateSearchEmpty() {
  return <div className="workout-template-search-empty" role="status"><p>Ничего не найдено</p><p className="muted">Попробуйте другое название.</p></div>
}
