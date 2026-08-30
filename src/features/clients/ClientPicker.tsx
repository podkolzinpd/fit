import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from 'react'
import type { Client } from '../../shared/domain'
import { AddIcon, BackIcon, ChevronDownIcon, ChevronRightIcon, CloseIcon } from '../../shared/icons'
import { recentClientIds, recordRecentClient, resolveRecentClients } from './recent-clients'

export type ClientPickerSelection = Pick<Client, 'id' | 'fullName'>

interface ClientPickerProps {
  userId: string | undefined
  clients: readonly Client[]
  selectedId: string
  onChange: (clientId: string) => void
  label?: string
  selectionError?: string | null
  loading?: boolean
  error?: Error | null
  onRetry?: () => void
  onCreate?: (fullName: string) => Promise<ClientPickerSelection>
}

function useVisualViewportStyle() {
  const [style, setStyle] = useState<CSSProperties>()
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const update = () => {
      setStyle({ top: viewport.offsetTop, height: viewport.height })
      setKeyboardOpen(viewport.height < window.innerHeight - 120)
    }
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [])
  return { style, keyboardOpen }
}

export function ClientPicker({ userId, clients, selectedId, onChange, label = 'Клиент', selectionError, loading = false, error, onRetry, onCreate }: ClientPickerProps) {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState('')
  const [name, setName] = useState('')
  const [created, setCreated] = useState<ClientPickerSelection | null>(null)
  const [recentVersion, setRecentVersion] = useState(0)
  const [createError, setCreateError] = useState<string | null>(null)
  const [creatingClient, setCreatingClient] = useState(false)
  const { style: viewportStyle, keyboardOpen } = useVisualViewportStyle()
  const selected = clients.find((client) => client.id === selectedId) ?? (created?.id === selectedId ? created : null)
  const normalizedSearch = search.trim().toLocaleLowerCase('ru')
  const filtered = useMemo(() => clients
    .filter((client) => client.fullName.toLocaleLowerCase('ru').includes(normalizedSearch))
    .sort((left, right) => left.fullName.localeCompare(right.fullName, 'ru')), [clients, normalizedSearch])
  const recent = useMemo(() => normalizedSearch ? [] : resolveRecentClients(recentClientIds(userId), clients), [clients, normalizedSearch, recentVersion, userId])
  const list = normalizedSearch ? filtered : filtered.filter((client) => !recent.some((recentClient) => recentClient.id === client.id))

  function close() {
    setOpen(false)
    setCreating(false)
    setSearch('')
    setName('')
    setCreateError(null)
  }

  function choose(client: ClientPickerSelection) {
    recordRecentClient(userId, client.id)
    setRecentVersion((version) => version + 1)
    onChange(client.id)
    close()
  }

  async function createClient() {
    const fullName = name.trim()
    if (!fullName || !onCreate) return
    setCreatingClient(true)
    setCreateError(null)
    try {
      const client = await onCreate(fullName)
      setCreated(client)
      choose(client)
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : 'Не удалось создать клиента')
    } finally {
      setCreatingClient(false)
    }
  }

  function stopPropagation(event: MouseEvent) { event.stopPropagation() }
  const item = (client: ClientPickerSelection, section: string) => <button type="button" className="client-picker-item" data-client-id={client.id} key={`${section}-${client.id}`} onClick={() => choose(client)}><span className="client-picker-avatar" aria-hidden="true">{client.fullName.trim().slice(0, 1).toUpperCase()}</span><span>{client.fullName}</span><ChevronRightIcon /></button>

  return <div className="client-picker-control">
    <input type="hidden" name="clientId" value={selectedId} />
    <span className="client-picker-label">{label}</span>
    <button type="button" className="client-picker-trigger" aria-label={`${label}: ${selected?.fullName ?? 'Выберите клиента'}`} aria-describedby={selectionError ? 'client-picker-selection-error' : undefined} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(true)}><span>{selected?.fullName ?? 'Выберите клиента'}</span><ChevronDownIcon /></button>
    {selectionError && <p id="client-picker-selection-error" className="error" role="alert">{selectionError}</p>}
    {open && <div className={`sheet-overlay${keyboardOpen ? ' keyboard-open' : ''}`} style={viewportStyle} onClick={close}>
      <section className="client-picker" role="dialog" aria-modal="true" aria-label="Выбор клиента" onClick={stopPropagation}>
        <header className="picker-header"><h1>{creating ? 'Новый клиент' : 'Выберите клиента'}</h1><button type="button" className="picker-close" aria-label="Закрыть" onClick={creating ? () => { setCreating(false); setCreateError(null) } : close}><CloseIcon /></button></header>
        {creating ? <div className="client-picker-create">
          <button type="button" className="link" onClick={() => { setCreating(false); setCreateError(null) }}><BackIcon />К выбору</button>
          <p>Укажите имя — остальные данные можно заполнить позже.</p>
          <label className="field">Имя клиента<input aria-label="Имя нового клиента" value={name} onChange={(event) => setName(event.target.value)} placeholder="Например, Анна Смирнова" autoFocus /></label>
          {createError && <p className="error">{createError}</p>}
          <button type="button" className="primary" disabled={name.trim().length < 2 || creatingClient} onClick={() => void createClient()}>{creatingClient ? 'Создаю…' : 'Создать и выбрать'}</button>
        </div> : <>
          <input className="picker-search" aria-label="Поиск клиента" placeholder="Имя клиента" value={search} onChange={(event) => setSearch(event.target.value)} autoFocus />
          {loading && <p className="state">Загружаем клиентов…</p>}
          {error && <div className="state"><p className="error">{error.message}</p>{onRetry && <button type="button" className="secondary" onClick={onRetry}>Повторить</button>}</div>}
          {!loading && !error && <div className="client-picker-list">
            {recent.length > 0 && <><p className="picker-section-label">Недавние</p>{recent.map((client) => item(client, 'recent'))}</>}
            {recent.length > 0 && list.length > 0 && <p className="picker-section-label">Все клиенты</p>}
            {list.map((client) => item(client, 'all'))}
            {!filtered.length && <div className="state"><strong>{clients.length ? 'Никого не нашли' : 'Клиентов пока нет'}</strong><p>{clients.length ? 'Измените запрос или создайте нового клиента.' : 'Создайте первую карточку, чтобы назначить тренировку.'}</p></div>}
          </div>}
          {onCreate && <button type="button" className="secondary wide client-picker-create-action" onClick={() => { setName(search.trim()); setCreating(true) }}><AddIcon />Новый клиент</button>}
        </>}
      </section>
    </div>}
  </div>
}
