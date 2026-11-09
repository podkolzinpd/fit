import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { CloseIcon } from '../../shared/icons'
import './client-add.css'

/** One entry point; the existing card and invitation commands keep ownership. */
export function ClientAddDialog({ onClose, onInvite, onBeforeOpen }: {
  onClose: () => void; onInvite: () => void; onBeforeOpen: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  const host = document.querySelector('.phone-frame') ?? document.body
  return createPortal(<dialog ref={dialog} className="clients-add-sheet" aria-labelledby="clients-add-title"
      onCancel={event => { event.preventDefault(); onClose() }} onClose={onClose}
      onClick={event => { if (event.target === event.currentTarget) {
        const rect = event.currentTarget.getBoundingClientRect()
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
      } }}>
      <header><h2 id="clients-add-title">Добавить клиента</h2><button type="button" className="icon-button" aria-label="Закрыть" onClick={onClose}><CloseIcon /></button></header>
      <Link className="button primary" to="/clients/new" onClick={() => { onBeforeOpen(); onClose() }}>Создать карточку</Link>
      <button type="button" className="secondary" onClick={() => { onBeforeOpen(); onInvite() }}>Пригласить по ссылке</button>
    </dialog>, host)
}
