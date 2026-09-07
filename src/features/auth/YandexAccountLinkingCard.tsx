import { useState } from 'react'
import { getYandexSessionLinkingConfig } from '../../app/feature-flags'
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
  const config = getYandexSessionLinkingConfig(actor.userId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
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

  return <section className="yandex-account-linking-card" aria-labelledby="yandex-account-linking-title">
    <div>
      <p className="eyebrow">YANDEX ID · ПИЛОТ</p>
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
      Текущий вход по email, паролю и Google не меняется. Доступ к данным по-прежнему проверяется сервером.
    </p>
  </section>
}
