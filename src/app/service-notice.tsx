import { useState } from 'react'
import { CloseIcon } from '../shared/icons'

// Временная плашка после переезда инфраструктуры: приложение работает,
// ИИ-функции ещё восстанавливаются. Текст держим здесь, чтобы снять её одной правкой.
// Крестик скрывает плашку до конца текущего запуска (sessionStorage): переходы
// между экранами её не возвращают, а следующий запуск приложения — возвращает.
const DISMISSED_KEY = 'fit.serviceNotice.dismissed'

function readDismissed(): boolean {
  try { return window.sessionStorage.getItem(DISMISSED_KEY) === '1' } catch { return false }
}

export function ServiceNotice() {
  const [dismissed, setDismissed] = useState(readDismissed)
  if (dismissed) return null
  const dismiss = () => {
    try { window.sessionStorage.setItem(DISMISSED_KEY, '1') } catch { /* Без хранилища плашка скрывается до перезагрузки. */ }
    setDismissed(true)
  }
  return <section className="service-notice" role="status" aria-label="Состояние сервиса">
    <div className="service-notice-text">
      <strong>Fit снова работает</strong>
      <p>ИИ-функции — ассистент, разбор тренировки из текста и голоса, ИИ-анализ результатов — пока недоступны. Уже возвращаем их.</p>
    </div>
    <button type="button" className="service-notice-close" aria-label="Скрыть сообщение" onClick={dismiss}><CloseIcon /></button>
  </section>
}
