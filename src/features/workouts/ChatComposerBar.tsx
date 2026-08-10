import { useEffect, useRef, useState } from 'react'
import { MicIcon, PlusIcon, SendIcon, StopIcon } from '../../shared/icons'
import { VoiceInputButton } from '../voice-input'

export interface ChatMenuAction {
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}

interface ChatComposerBarProps {
  value: string
  onChange: (value: string) => void
  onSend: (text: string) => void
  onTranscript: (text: string) => void
  disabled?: boolean
  menuActions: ChatMenuAction[]
}

/** Нижняя панель ленты: текстовое поле, микрофон и «+»-меню быстрых действий (по HTML-прототипу дизайнера). */
export function ChatComposerBar({ value, onChange, onSend, onTranscript, disabled, menuActions }: ChatComposerBarProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [recording, setRecording] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (event: PointerEvent) => { if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false) }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey) }
  }, [menuOpen])

  function submit() {
    const text = value.trim()
    if (!text || disabled) return
    onSend(text)
  }

  return <div className="chat-bar" ref={menuRef}>
    {menuOpen && <div className="chat-bar-menu" role="menu">
      {menuActions.map((action) => <button type="button" role="menuitem" key={action.label} disabled={action.disabled}
        className={action.danger ? 'chat-bar-menu-item danger' : 'chat-bar-menu-item'}
        onClick={() => { setMenuOpen(false); action.onClick() }}>{action.label}</button>)}
    </div>}
    <form className="chat-bar-field" onSubmit={(event) => { event.preventDefault(); submit() }}>
      <input
        type="text"
        placeholder={recording ? 'Слушаю…' : 'Введите текст…'}
        value={value}
        disabled={disabled}
        aria-label="Сообщение о тренировке"
        onChange={(event) => onChange(event.target.value)}
      />
      <span className="chat-bar-mic">
        <VoiceInputButton
          variant="inline"
          source="today_chat"
          idleLabel=""
          onPhaseChange={(phase) => setRecording(phase !== 'idle')}
          onTranscript={(text) => { onTranscript(text); return undefined }}
        />
      </span>
    </form>
    <button type="button" className={`chat-bar-plus ${menuOpen ? 'open' : ''}`} aria-label="Действия" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
      <PlusIcon />
    </button>
    {value.trim() && <button type="button" className="chat-bar-send" aria-label="Отправить" disabled={disabled} onClick={submit}><SendIcon /></button>}
  </div>
}

// Реэкспорт для мест, где нужен только значок микрофона/стоп без полноценной кнопки записи.
export { MicIcon, StopIcon }
