import { useId, useMemo, useState } from 'react'
import {
  moscowMetroStationById,
  searchMoscowMetroStations,
  type MoscowMetroStation,
} from '../../shared/moscow-metro'
import { CloseIcon } from '../../shared/icons'

function LineDots({ station }: { station: MoscowMetroStation }) {
  return <span className="metro-line-dots" aria-label={station.lines.map((line) => line.name).join(', ')}>
    {station.lines.map((line) => <span key={line.code} title={line.name} style={{ backgroundColor: line.color }} />)}
  </span>
}

export function MetroStationPicker({ selectedIds, onChange }: {
  selectedIds: string[]
  onChange: (stationIds: string[]) => void
}) {
  const listId = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const selected = useMemo(
    () => selectedIds.map(moscowMetroStationById).filter((station): station is MoscowMetroStation => station !== undefined),
    [selectedIds],
  )
  const results = useMemo(
    () => searchMoscowMetroStations(query).filter((station) => !selectedIds.includes(station.id)).slice(0, 8),
    [query, selectedIds],
  )

  function add(stationId: string) {
    if (selectedIds.length >= 20 || selectedIds.includes(stationId)) return
    onChange([...selectedIds, stationId])
    setQuery('')
    setOpen(false)
  }

  return <div className="metro-picker">
    <label className="field">
      <span>Метро Москвы</span>
      <input
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        value={query}
        maxLength={100}
        placeholder="Начните вводить станцию"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(event) => { setQuery(event.target.value); setOpen(true) }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false)
          if (event.key === 'Enter' && open && results[0]) {
            event.preventDefault()
            add(results[0].id)
          }
        }}
      />
    </label>
    {open && results.length > 0 && <ul id={listId} className="metro-picker-results" role="listbox">
      {results.map((station) => <li key={station.id} role="none">
        <button type="button" role="option" aria-selected="false" onPointerDown={(event) => event.preventDefault()} onClick={() => add(station.id)}>
          <LineDots station={station} /><span>{station.name}</span>
        </button>
      </li>)}
    </ul>}
    {open && query.trim() && results.length === 0 && <p className="metro-picker-empty">Станция не найдена</p>}
    {selected.length > 0 && <ul className="metro-picker-selected" aria-label="Выбранные станции метро">
      {selected.map((station) => <li key={station.id}>
        <LineDots station={station} /><span>{station.name}</span>
        <button type="button" aria-label={`Убрать станцию ${station.name}`} onClick={() => onChange(selectedIds.filter((id) => id !== station.id))}><CloseIcon /></button>
      </li>)}
    </ul>}
  </div>
}

export function MetroStationList({ stationIds }: { stationIds: string[] }) {
  const stations = stationIds.map(moscowMetroStationById).filter((station): station is MoscowMetroStation => station !== undefined)
  if (stations.length === 0) return null
  return <ul className="trainer-location-list" aria-label="Станции метро">
    {stations.map((station) => <li key={station.id}><LineDots station={station} /><span>{station.name}</span></li>)}
  </ul>
}
