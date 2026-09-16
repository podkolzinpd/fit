import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { getYandexSessionLinkingConfig } from '../../app/feature-flags'
import { useOptionalYandexAppSession } from '../../app/yandex-app-session-context'
import { authRepository } from '../../data/repositories/auth.repository'
import { yandexPilotRepository } from '../../data/repositories/yandex-pilot.repository'
import type { SessionActor } from '../../shared/domain'
import { createYandexAuthorizationUrl } from './yandex-pilot-oauth'

interface YandexAccountLinkingCardProps {
  actor: SessionActor
  onNavigate?: (url: string) => void
}

export function YandexAccountLinkingCard({
  actor,
  onNavigate = (url) => window.location.assign(url),
}: YandexAccountLinkingCardProps) {
  const config = getYandexSessionLinkingConfig()
  const yandexSession = useOptionalYandexAppSession()?.session ?? null
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const status = useQuery({
    queryKey: ['yandex-account-link-status', actor.userId],
    enabled: config !== null && yandexSession === null,
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      if (config === null) throw new Error('Проверка Yandex ID не настроена.')
      const session = await authRepository.getSession()
      if (session.error) throw session.error
      const accessToken = session.data.session?.access_token
      if (!accessToken) throw new Error('Сессия FIT истекла. Войдите заново.')
      return yandexPilotRepository.getYandexAccountLinkStatus(config.apiBaseUrl, accessToken)
    },
  })
  if (config === null) return null
  const { clientId } = config

  async function startLinking(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const redirectUri = `${window.location.origin}/auth/yandex/callback`
      const url = await createYandexAuthorizationUrl(
        clientId,
        redirectUri,
        sessionStorage,
        'link',
      )
      onNavigate(url)
    } catch {
      setError('Не удалось начать привязку Yandex ID. Попробуйте ещё раз.')
      setBusy(false)
    }
  }

  if (yandexSession !== null || status.data?.linked) return <section
    className="yandex-account-linking-card yandex-account-linking-card-linked"
    aria-labelledby="yandex-account-linking-title"
  >
    <div>
      <p className="eyebrow">YANDEX ID</p>
      <h2 id="yandex-account-linking-title">Yandex ID привязан</h2>
      <p>Профиль готов к последующему переходу на вход через Yandex ID.</p>
    </div>
  </section>

  if (status.isLoading) return <section
    className="yandex-account-linking-card"
    aria-labelledby="yandex-account-linking-title"
    aria-busy="true"
  >
    <div>
      <p className="eyebrow">YANDEX ID</p>
      <h2 id="yandex-account-linking-title">Проверяем привязку</h2>
      <p>Уточняем, связан ли текущий профиль с Yandex ID…</p>
    </div>
  </section>

  if (status.error) return <section
    className="yandex-account-linking-card"
    aria-labelledby="yandex-account-linking-title"
  >
    <div>
      <p className="eyebrow">YANDEX ID</p>
      <h2 id="yandex-account-linking-title">Не удалось проверить привязку</h2>
      <p className="error" role="alert">{status.error.message}</p>
    </div>
    <button type="button" className="secondary" onClick={() => void status.refetch()}>
      Повторить
    </button>
  </section>

  return <section className="yandex-account-linking-card" aria-labelledby="yandex-account-linking-title">
    <div>
      <p className="eyebrow">YANDEX ID</p>
      <h2 id="yandex-account-linking-title">Привязать Yandex ID</h2>
      <p>Свяжем текущий FIT-аккаунт с Yandex ID, чтобы подготовить вход через российский контур.</p>
    </div>
    <button
      type="button"
      className="secondary"
      aria-busy={busy}
      disabled={busy}
      onClick={() => void startLinking()}
    >
      {busy ? 'Переходим в Yandex ID…' : 'Привязать Yandex ID'}
    </button>
    {error && <p className="error" role="alert">{error}</p>}
    <p className="yandex-account-linking-note">
      Пока вход по email и паролю остаётся доступен. Привязка не переключает источник данных автоматически.
    </p>
  </section>
}
