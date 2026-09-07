import { useMemo, useState } from 'react'
import { useAuth } from '../../app/auth-context'
import {
  getYandexAppSessionEntryConfig,
  isYandexAssistantRoutingPilotEnabled,
  isYandexMainRoutingPilotEnabled,
} from '../../app/feature-flags'
import { useYandexAppSession } from '../../app/yandex-app-session-context'
import { createYandexAssistantBackend } from '../../data/repositories/yandex-assistant.repository'
import { StatePanel } from '../../shared/ui'
import { createYandexAuthorizationUrl } from '../auth'
import { AssistantHistoryPage } from './AssistantHistoryPage'

export function YandexAssistantRoute() {
  const { actor } = useAuth()
  const { session, loading, error, signOut } = useYandexAppSession()
  const [authorizing, setAuthorizing] = useState(false)
  const config = getYandexAppSessionEntryConfig()
  const routedToYandex = actor !== null
    && (isYandexAssistantRoutingPilotEnabled(actor.userId)
      || isYandexMainRoutingPilotEnabled(actor.userId))
  const backend = useMemo(() => !routedToYandex || config === null
    || session === null || actor === null
    || session.profile.id !== actor.userId
    ? null
    : createYandexAssistantBackend(config.apiBaseUrl, session.session.token), [
    actor?.userId,
    config?.apiBaseUrl,
    routedToYandex,
    session?.profile.id,
    session?.session.token,
  ])

  if (!routedToYandex) return <AssistantHistoryPage />
  if (loading) return <main className="assistant-page">
    <StatePanel
      tone="info"
      title="Проверяем Yandex ID"
      description="Восстанавливаем закреплённую сессию Assistant…"
    />
  </main>
  if (config === null) return <main className="assistant-page">
    <StatePanel
      tone="error"
      title="Маршрут Yandex Cloud не настроен"
      description="Assistant закреплён за Yandex Cloud, но публичные параметры входа отсутствуют. Supabase не будет включён автоматически."
    />
  </main>
  if (session !== null && actor !== null && session.profile.id !== actor.userId) {
    return <main className="assistant-page">
      <StatePanel
        tone="error"
        title="Открыт другой Yandex ID"
        description="Сессия Yandex ID не соответствует текущему FIT-профилю. Данные Assistant не загружались."
        action={<button type="button" className="secondary" onClick={() => void signOut()}>
          Завершить Yandex-сессию
        </button>}
      />
    </main>
  }
  if (backend === null) return <main className="assistant-page">
    <StatePanel
      tone={error ? 'error' : 'info'}
      title={error ? 'Не удалось восстановить Yandex ID' : 'Подтвердите Yandex ID'}
      description={error ?? 'Для этого FIT-профиля Assistant закреплён за Yandex Cloud. Подтвердите связанный Yandex ID — автоматического перехода на Supabase не будет.'}
      action={<button type="button" className="primary" disabled={authorizing} onClick={() => {
        setAuthorizing(true)
        void createYandexAuthorizationUrl(
          config.clientId,
          `${window.location.origin}/auth/yandex/callback`,
          window.sessionStorage,
          'app',
        ).then((url) => window.location.assign(url)).catch(() => setAuthorizing(false))
      }}>{authorizing ? 'Переходим в Yandex ID…' : 'Подтвердить Yandex ID'}</button>}
    />
  </main>
  return <AssistantHistoryPage backend={backend} />
}
