import { useState } from 'react'
import { CloseIcon } from '../shared/icons'

// Stable campaign identity: ordinary rebuilds/copy edits must not show a closed notice again.
export const SERVICE_NOTICE_ID = 'ai-recovery-2026-10-14'

function dismissalKey(userId: string, noticeId: string): string {
  return `fit.serviceNotice.dismissed.${noticeId}.${userId}`
}

export function ServiceNotice({ userId, noticeId = SERVICE_NOTICE_ID }: { userId: string; noticeId?: string }) {
  const key = dismissalKey(userId, noticeId)
  const [closedKey, setClosedKey] = useState<string | null>(null)
  let persisted = false
  try { persisted = window.localStorage.getItem(key) === '1' } catch { /* Closing still works for this mounted screen. */ }
  if (closedKey === key || persisted) return null
  const dismiss = () => {
    try { window.localStorage.setItem(key, '1') } catch { /* Storage may be unavailable. */ }
    setClosedKey(key)
  }
  return <section className="service-notice" role="status" aria-label="Состояние сервиса">
    <div className="service-notice-text">
      <strong>Fit снова работает</strong>
      <p>ИИ-функции — ассистент, разбор тренировки из текста и голоса, ИИ-анализ результатов — пока недоступны. Уже возвращаем их.</p>
    </div>
    <button type="button" className="service-notice-close" aria-label="Скрыть сообщение" onClick={dismiss}><CloseIcon /></button>
  </section>
}
