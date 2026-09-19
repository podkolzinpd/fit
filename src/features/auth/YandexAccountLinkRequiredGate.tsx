import { useQuery } from '@tanstack/react-query'
import { useState, type PropsWithChildren } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import {
  getYandexSessionLinkingConfig,
  isYandexAccountLinkRequired,
} from '../../app/feature-flags'
import { useOptionalYandexAppSession } from '../../app/yandex-app-session-context'
import { authRepository } from '../../data/repositories/auth.repository'
import { yandexPilotRepository } from '../../data/repositories/yandex-pilot.repository'
import { LEGAL_PATHS } from '../../shared/legal'
import { StatePanel } from '../../shared/ui'
import { LogoutButton } from './LogoutButton'
import { createYandexAuthorizationUrl } from './yandex-pilot-oauth'

interface YandexAccountLinkRequiredGateProps extends PropsWithChildren {
  onNavigate?: (url: string) => void
}

export function YandexAccountLinkRequiredGate({
  children,
  onNavigate = (url) => window.location.assign(url),
}: YandexAccountLinkRequiredGateProps) {
  const { actor } = useAuth()
  const yandexSession = useOptionalYandexAppSession()?.session ?? null
  const required = isYandexAccountLinkRequired()
  const config = getYandexSessionLinkingConfig()
  const [busy, setBusy] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  const status = useQuery({
    queryKey: ['yandex-account-link-status', actor?.userId],
    enabled: required && actor !== null && yandexSession === null && config !== null,
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

  if (!required || actor === null || yandexSession !== null || status.data?.linked) {
    return children
  }

  async function startLinking(): Promise<void> {
    if (config === null) return
    setBusy(true)
    setLinkError(null)
    try {
      const redirectUri = `${window.location.origin}/auth/yandex/callback`
      const url = await createYandexAuthorizationUrl(
        config.clientId,
        redirectUri,
        sessionStorage,
        'link',
      )
      onNavigate(url)
    } catch {
      setLinkError('Не удалось начать привязку Yandex ID. Попробуйте ещё раз.')
      setBusy(false)
    }
  }

  if (config === null) return <main className="legal-gate yandex-link-required-gate ui-identity">
    <StatePanel
      tone="error"
      title="Привязка Yandex ID недоступна"
      description="Обновите приложение или войдите позже. Настройки привязки сейчас недоступны."
      action={<LogoutButton className="link yandex-link-gate-logout" />}
    />
  </main>

  if (status.isPending) return <main className="legal-gate yandex-link-required-gate ui-identity">
    <StatePanel
      tone="info"
      title="Проверяем Yandex ID"
      description="Подтверждаем, что Yandex ID уже связан с вашим FIT-аккаунтом…"
    />
  </main>

  if (status.error) return <main className="legal-gate yandex-link-required-gate ui-identity">
    <StatePanel
      tone="error"
      title="Не удалось проверить Yandex ID"
      description={status.error.message}
      action={<div className="stack">
        <button type="button" onClick={() => void status.refetch()}>Повторить</button>
        <LogoutButton className="link yandex-link-gate-logout" />
      </div>}
    />
  </main>

  return <main className="legal-gate yandex-link-required-gate ui-identity">
    <div className="brand" aria-hidden="true">FIT</div>
    <section className="legal-gate-card yandex-link-required-card">
      <p className="eyebrow">YANDEX ID</p>
      <h1>Привяжите Yandex ID</h1>
      <p>Чтобы продолжить работу в FIT, подтвердите текущий аккаунт через Yandex ID.</p>
      {linkError && <p className="error" role="alert">{linkError}</p>}
      <button
        type="button"
        className="primary"
        aria-busy={busy}
        disabled={busy}
        onClick={() => void startLinking()}
      >
        {busy ? 'Переходим в Yandex ID…' : 'Привязать Yandex ID'}
      </button>
      <p>Привязка не переключает ваши тренировки на другой источник данных.</p>
      <div className="legal-gate-links">
        <Link to={LEGAL_PATHS.terms}>Условия использования</Link>
        <Link to={LEGAL_PATHS.privacy}>Политика конфиденциальности</Link>
      </div>
      <LogoutButton className="link yandex-link-gate-logout" />
    </section>
  </main>
}
