import { useEffect, useRef, useState } from 'react'
import { copyText } from './clipboard'
import { CheckIcon, CopyIcon } from './icons'

type CopyState = 'idle' | 'copied' | 'error'

export function InvitationCodeCard({ code, label, description, className }: {
  code: string
  label: string
  description: string
  className?: string
}) {
  const [copyState, setCopyState] = useState<CopyState>('idle')
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current)
  }, [])

  async function copyCode() {
    if (resetTimer.current) clearTimeout(resetTimer.current)
    try {
      await copyText(code)
      setCopyState('copied')
    } catch {
      setCopyState('error')
    }
    resetTimer.current = setTimeout(() => setCopyState('idle'), 3_000)
  }

  const buttonLabel = copyState === 'copied' ? 'Скопировано' : copyState === 'error' ? 'Повторить' : 'Копировать'
  const accessibleLabel = copyState === 'copied'
    ? `${label} скопирован`
    : copyState === 'error' ? `Повторить копирование: ${label.toLocaleLowerCase('ru-RU')}` : `Скопировать ${label.toLocaleLowerCase('ru-RU')}`
  const classes = ['card', 'invitation-code-card', className].filter(Boolean).join(' ')

  return <div className={classes} role="status">
    <div className="invitation-code-row">
      <div className="invitation-code-content">
        <strong>{label}: <span className="invitation-code-value">{code}</span></strong>
      </div>
      <button type="button" className="secondary invitation-code-copy" aria-label={accessibleLabel} data-state={copyState} onClick={() => void copyCode()}>
        {copyState === 'copied' ? <CheckIcon /> : <CopyIcon />}
        <span>{buttonLabel}</span>
      </button>
    </div>
    <p>{description}</p>
    {copyState === 'error' && <p className="error invitation-code-error" role="alert">Не удалось скопировать. Нажмите и удерживайте код.</p>}
  </div>
}
