import QRCode from 'qrcode'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { InvitationLinkSource, InvitationShare } from './domain'
import { copyText } from './clipboard'
import { CloseIcon } from './icons'
import { invitationShareUrl } from './invitation-share'
import { useConfirm } from './ui'
import { trackGoal } from './yandex-metrika'

type ActionState = 'idle' | 'busy' | 'done' | 'error'

export function InvitationShareDialog({
  share,
  source,
  message,
  onClose,
  onRevoke,
}: {
  share: InvitationShare
  source: InvitationLinkSource
  message: string
  onClose: () => void
  onRevoke: () => Promise<void>
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const [copyState, setCopyState] = useState<ActionState>('idle')
  const [codeCopyState, setCodeCopyState] = useState<ActionState>('idle')
  const [shareState, setShareState] = useState<ActionState>('idle')
  const [showQr, setShowQr] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [qrError, setQrError] = useState(false)
  const [revokeState, setRevokeState] = useState<ActionState>('idle')
  const [confirm, confirmDialog] = useConfirm()
  const url = invitationShareUrl(share.token, source)
  const canUseSystemShare = 'share' in navigator && typeof navigator.share === 'function'

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (!showQr || qrDataUrl !== null || qrError) return
    let cancelled = false
    void QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 720,
      color: { dark: '#111214', light: '#ffffff' },
    }).then((value) => { if (!cancelled) setQrDataUrl(value) })
      .catch(() => { if (!cancelled) setQrError(true) })
    return () => { cancelled = true }
  }, [qrDataUrl, qrError, showQr, url])

  async function copyLink(): Promise<void> {
    setCopyState('busy')
    try {
      await copyText(url)
      trackGoal('invitation_link_copied')
      setCopyState('done')
    } catch {
      setCopyState('error')
      trackGoal('invitation_share_error')
    }
  }

  async function copyCode(): Promise<void> {
    setCodeCopyState('busy')
    try {
      await copyText(share.code)
      setCodeCopyState('done')
    } catch {
      setCodeCopyState('error')
    }
  }

  async function sendLink(): Promise<void> {
    setShareState('busy')
    try {
      if (canUseSystemShare) {
        await navigator.share({ title: 'Приглашение в Fit', text: message, url })
        trackGoal('invitation_link_shared')
        setShareState('done')
        return
      }
      await copyText(`${message}\n${url}`)
      trackGoal('invitation_link_shared')
      setShareState('done')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setShareState('idle')
        return
      }
      setShareState('error')
      trackGoal('invitation_share_error')
    }
  }

  function saveQr(): void {
    if (qrDataUrl === null) return
    const link = document.createElement('a')
    link.href = qrDataUrl
    link.download = 'fit-invitation-qr.png'
    link.click()
    trackGoal('invitation_qr_saved')
  }

  async function revoke(): Promise<void> {
    if (!await confirm({
      message: 'Отменить приглашение? Ссылка, QR-код и код больше не будут работать.',
      confirmLabel: 'Отозвать',
      danger: true,
    })) return
    setRevokeState('busy')
    try {
      await onRevoke()
      trackGoal('invitation_revoked')
      setRevokeState('done')
      onClose()
    } catch {
      setRevokeState('error')
      trackGoal('invitation_revoke_error')
    }
  }

  const expiresAt = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  }).format(new Date(share.expiresAt))
  const codeLabel = share.targetRole === 'trainer' ? 'Код для тренера' : 'Код клиента'
  const host = document.querySelector('.phone-frame') ?? document.body

  return createPortal(<>
    <div className="modal-overlay invitation-share-overlay" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="invitation-share-dialog" role="dialog" aria-modal="true" aria-labelledby="invitation-share-title">
        <header>
          <div><p className="eyebrow">ПРИГЛАШЕНИЕ</p><h2 id="invitation-share-title">Ссылка готова</h2></div>
          <button ref={closeRef} type="button" className="icon-button" aria-label="Закрыть" onClick={onClose}><CloseIcon /></button>
        </header>
        <p className="invitation-share-message">{message}</p>
        <p className="muted invitation-share-expiry">Действует до {expiresAt}</p>

        <div className="invitation-share-actions">
          <button type="button" className="primary" disabled={shareState === 'busy'} onClick={() => void sendLink()}>{shareState === 'busy' ? 'Открываем…' : shareState === 'done' ? (canUseSystemShare ? 'Отправлено' : 'Текст скопирован') : 'Отправить ссылку'}</button>
          <button type="button" className="secondary" disabled={copyState === 'busy'} onClick={() => void copyLink()}>{copyState === 'done' ? 'Ссылка скопирована' : copyState === 'busy' ? 'Копируем…' : 'Скопировать ссылку'}</button>
          <button type="button" className="secondary" aria-expanded={showQr} onClick={() => setShowQr((value) => { if (!value) trackGoal('invitation_qr_opened'); return !value })}>{showQr ? 'Скрыть QR-код' : 'Показать QR-код'}</button>
        </div>
        {(copyState === 'error' || shareState === 'error') && <p className="error" role="alert">Не удалось выполнить действие. Попробуйте ещё раз.</p>}

        {showQr && <section className="invitation-qr" aria-label="QR-код приглашения">
          {qrDataUrl ? <img src={qrDataUrl} alt="QR-код приглашения в Fit" /> : qrError
            ? <p className="error" role="alert">Не удалось создать QR-код.</p>
            : <p className="muted">Создаём QR-код…</p>}
          <p>Откройте камеру на другом телефоне и наведите её на код.</p>
          <button type="button" className="secondary" disabled={qrDataUrl === null} onClick={saveQr}>Сохранить QR-код</button>
        </section>}

        <section className="invitation-code-fallback" aria-label="Запасной код приглашения">
          <div><strong>{codeLabel}: <span>{share.code}</span></strong><p className="muted">Если ссылка не открывается.</p></div>
          <button type="button" className="secondary" aria-label={codeCopyState === 'done' ? `${codeLabel} скопирован` : `Скопировать ${codeLabel.toLocaleLowerCase('ru-RU')}`} disabled={codeCopyState === 'busy'} onClick={() => void copyCode()}>{codeCopyState === 'done' ? 'Скопировано' : 'Копировать код'}</button>
        </section>
        {codeCopyState === 'error' && <p className="error" role="alert">Не удалось скопировать код.</p>}

        <button type="button" className="link danger invitation-revoke" disabled={revokeState === 'busy'} onClick={() => void revoke()}>{revokeState === 'busy' ? 'Отменяем…' : 'Отменить приглашение'}</button>
        {revokeState === 'error' && <p className="error" role="alert">Не удалось отменить приглашение.</p>}
      </section>
    </div>
    {confirmDialog}
  </>, host)
}
