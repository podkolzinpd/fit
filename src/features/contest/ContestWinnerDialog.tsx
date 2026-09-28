import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { useDataBackend } from '../../app/data-backend-context'
import { isContestWinnerPilotEnabled } from '../../app/feature-flags'
import { isCoachmarkSeen, markCoachmarkSeen } from '../../shared/coachmarks'
import { SaveStatus } from '../../shared/ui'

// Окно показывается только до этой даты: даже если флаг забудут выключить,
// объявление не останется в приложении навсегда.
export const CONTEST_WINNER_ANNOUNCEMENT_ENDS_AT = new Date('2026-10-13T00:00:00+03:00')
// Отметка «контакт отправлен» живёт в том же per-user localStorage, что и
// подсказки Coachmark: после отправки окно больше не появляется.
export const CONTEST_WINNER_STORAGE_ID = 'contest-winner-2026-09'
const MIN_CONTACT_LENGTH = 3

export function contestWinnerMessage(contact: string) {
  return `Конкурс Fit (сентябрь 2026): победитель оставил контакт для персональной тренировки с бренд-тренером — ${contact.trim()}`
}

export function ContestWinnerDialog({ userId, suppressed = false }: { userId: string; suppressed?: boolean }) {
  // «Позже» скрывает окно до следующего запуска приложения, а не навсегда.
  const [postponed, setPostponed] = useState(false)
  // Срок проверяется один раз при запуске: окно не должно исчезать посреди ввода.
  const [expired] = useState(() => Date.now() >= CONTEST_WINNER_ANNOUNCEMENT_ENDS_AT.getTime())
  const visible = !postponed
    && !suppressed
    && !expired
    && isContestWinnerPilotEnabled(userId)
    && !isCoachmarkSeen(userId, CONTEST_WINNER_STORAGE_ID)
  if (!visible) return null
  return <ContestWinnerDialogContent userId={userId} onClose={() => setPostponed(true)} />
}

function ContestWinnerDialogContent({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { appFeedback } = useDataBackend()
  const [contact, setContact] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const contactId = useId()

  useEffect(() => {
    dialogRef.current?.focus()
  }, [sent])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !submitting) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, submitting])

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting || contact.trim().length < MIN_CONTACT_LENGTH) return
    setError(null)
    setSubmitting(true)
    try {
      await appFeedback.submit('suggestion', contestWinnerMessage(contact))
      markCoachmarkSeen(userId, CONTEST_WINNER_STORAGE_ID)
      setSent(true)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Не удалось отправить контакт.')
    } finally {
      setSubmitting(false)
    }
  }

  // Портал в .phone-frame, как у useConfirm: диалог наследует активную тему.
  const host = document.querySelector('.phone-frame') ?? document.body
  return createPortal(
    <div className="modal-overlay" role="presentation">
      <div ref={dialogRef} tabIndex={-1} className="modal-dialog contest-winner-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        {sent
          ? <div className="contest-winner-body" role="status">
            <h2 id={titleId}>Спасибо, контакт у нас</h2>
            <p>Команда Fit напишет вам и договорится о времени тренировки.</p>
            <div className="actions"><button type="button" className="primary" onClick={onClose}>Готово</button></div>
          </div>
          : <form className="contest-winner-body" onSubmit={onSubmit}>
            <p className="contest-winner-eyebrow">Конкурс Fit</p>
            <h2 id={titleId}>Вы выиграли персональную тренировку</h2>
            <p>Среди всех, кто прошёл тренировку до 25 сентября, мы разыграли персональную тренировку с Иваном, бренд-тренером Fit. Оставьте контакт — мы договоримся о времени.</p>
            <label className="field" htmlFor={contactId}>
              <span>Как с вами связаться</span>
              <input
                id={contactId}
                value={contact}
                maxLength={200}
                autoComplete="off"
                placeholder="Логин, Telegram или почта"
                onChange={(event) => { setContact(event.target.value); if (error) setError(null) }}
              />
            </label>
            <SaveStatus status={submitting ? 'saving' : error ? 'error' : 'idle'} error={error ?? undefined} />
            <div className="actions">
              <button type="button" className="secondary" disabled={submitting} onClick={onClose}>Позже</button>
              <button type="submit" className="primary" aria-busy={submitting || undefined} disabled={submitting || contact.trim().length < MIN_CONTACT_LENGTH}>
                {submitting ? 'Отправляем…' : error ? 'Повторить' : 'Отправить'}
              </button>
            </div>
          </form>}
      </div>
    </div>,
    host,
  )
}
