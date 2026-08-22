import { useState, type FormEvent } from 'react'

import {
  yandexPilotRepository,
  type YandexPilotClient,
  type YandexPilotConnections as PilotConnections,
  type YandexPilotCreatedInvitation,
  type YandexPilotSession,
} from '../../data/repositories/yandex-pilot.repository'
import { normalizeTimeZone } from '../../shared/local-date'
import { AsyncView, Field, useConfirm } from '../../shared/ui'

interface YandexPilotConnectionsProps {
  apiBaseUrl: string
  clients: YandexPilotClient[] | null
  connections: PilotConnections | null
  error: Error | null
  loading: boolean
  onRefresh: () => Promise<void>
  session: YandexPilotSession
}

export function YandexPilotConnections({
  apiBaseUrl,
  clients,
  connections,
  error,
  loading,
  onRefresh,
  session,
}: YandexPilotConnectionsProps) {
  const [claimCode, setClaimCode] = useState('')
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  const [createdInvitation, setCreatedInvitation] =
    useState<YandexPilotCreatedInvitation | null>(null)
  const [confirm, confirmDialog] = useConfirm()
  const sessionToken = session.session.token
  const clientIds = [...new Set([
    ...(clients ?? []).map((client) => client.id),
    ...(connections?.memberships ?? []).map((membership) => membership.clientId),
    ...(connections?.invitations ?? []).map((invitation) => invitation.clientId),
  ])]

  async function runAction(
    key: string,
    action: () => Promise<void>,
    success: string,
  ): Promise<void> {
    setBusyAction(key)
    setActionError(null)
    setActionSuccess(null)
    try {
      await action()
      await onRefresh()
      setActionSuccess(success)
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Не удалось выполнить действие.')
    } finally {
      setBusyAction(null)
    }
  }

  async function createInvitation(clientId: string): Promise<void> {
    const targetRole = session.profile.accountRole === 'trainer' ? 'client' : 'trainer'
    await runAction(`create:${clientId}`, async () => {
      const invitation = await yandexPilotRepository.createInvitation(
        apiBaseUrl,
        sessionToken,
        clientId,
        targetRole,
      )
      setCreatedInvitation(invitation)
    }, 'Приглашение создано. Передайте одноразовый код лично.')
  }

  async function claimInvitation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    await runAction('claim', async () => {
      await yandexPilotRepository.claimInvitation(apiBaseUrl, sessionToken, claimCode)
      setClaimCode('')
      setCreatedInvitation(null)
    }, 'Приглашение принято, связь добавлена.')
  }

  return <section className="yandex-pilot-connections" aria-labelledby="yandex-pilot-connections-title">
    <div className="yandex-pilot-section-head">
      <div>
        <h2 id="yandex-pilot-connections-title">Связи и приглашения</h2>
        <p className="muted">Тренировки и профиль остаются только для чтения.</p>
      </div>
    </div>
    <form className="card stack yandex-pilot-claim" onSubmit={(event) => void claimInvitation(event)}>
      <div>
        <strong>Есть код приглашения?</strong>
        <p className="muted">Введите 12 символов, полученных от клиента или тренера.</p>
      </div>
      <Field label="Код приглашения">
        <input
          aria-label="Код приглашения"
          autoCapitalize="characters"
          autoComplete="one-time-code"
          maxLength={12}
          minLength={12}
          pattern="[A-Za-z0-9]{12}"
          required
          value={claimCode}
          onChange={(event) => setClaimCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
        />
      </Field>
      <button disabled={busyAction !== null || claimCode.length !== 12}>
        {busyAction === 'claim' ? 'Подключаем…' : 'Принять приглашение'}
      </button>
    </form>
    {createdInvitation && <div className="card yandex-pilot-created-invitation" role="status">
      <div>
        <strong>Одноразовый код: <span>{createdInvitation.code}</span></strong>
        <p>Он действует 7 дней. После ухода со страницы код повторно не показывается.</p>
      </div>
    </div>}
    {actionError && <p className="error" role="alert">{actionError}</p>}
    {actionSuccess && <p className="success" role="status">{actionSuccess}</p>}
    <AsyncView
      loading={loading}
      error={error}
      empty={connections !== null && clientIds.length === 0}
      onRetry={() => void onRefresh()}
      emptyTitle="В stage пока нет связей"
      emptyDescription="Введите код приглашения или дождитесь переноса клиентской карточки."
    >
      <div className="cards yandex-pilot-connections-list">
        {clientIds.map((clientId) => {
          const client = clients?.find((candidate) => candidate.id === clientId)
          const memberships = connections?.memberships.filter((item) => item.clientId === clientId) ?? []
          const invitations = connections?.invitations.filter((item) => item.clientId === clientId) ?? []
          const ownMembership = memberships.find((item) => item.trainerId === session.profile.id)
          const canCreate = session.profile.accountRole === 'client' || client?.hasAccount === false
          return <article className="card yandex-pilot-connection" key={clientId}>
            <div>
              <strong>{client?.fullName ?? 'Клиент'}</strong>
              <p>{memberships.length === 0 ? 'Подключённых тренеров нет' : memberships.map((membership) => {
                const trainerName = [membership.firstName, membership.lastName].filter(Boolean).join(' ') || 'Тренер'
                return `${trainerName} · ${membership.isRoot ? 'основной' : 'подключённый'}`
              }).join('; ')}</p>
            </div>
            {canCreate && <button
              className="secondary"
              disabled={busyAction !== null}
              onClick={() => void createInvitation(clientId)}
              type="button"
            >{busyAction === `create:${clientId}`
                ? 'Создаём…'
                : session.profile.accountRole === 'trainer'
                  ? 'Пригласить клиента'
                  : 'Пригласить тренера'}</button>}
            {invitations.map((invitation) => <div className="yandex-pilot-invitation" key={invitation.id}>
              <p>
                Активное приглашение для {invitation.targetRole === 'trainer' ? 'тренера' : 'клиента'} до{' '}
                {new Date(invitation.expiresAt).toLocaleDateString('ru-RU', {
                  timeZone: normalizeTimeZone(session.profile.timezone),
                })}
              </p>
              <button
                className="link danger"
                disabled={busyAction !== null}
                type="button"
                onClick={async () => {
                  if (!await confirm({
                    message: 'Отозвать приглашение? Код больше нельзя будет использовать.',
                    confirmLabel: 'Отозвать',
                    danger: true,
                  })) return
                  await runAction(`revoke:${invitation.id}`, () =>
                    yandexPilotRepository.revokeInvitation(apiBaseUrl, sessionToken, invitation.id),
                  'Приглашение отозвано.')
                }}
              >{busyAction === `revoke:${invitation.id}` ? 'Отзываем…' : 'Отозвать'}</button>
            </div>)}
            {session.profile.accountRole === 'client' && memberships
              .filter((membership) => !membership.isRoot)
              .map((membership) => <button
                className="link danger"
                disabled={busyAction !== null}
                key={membership.trainerId}
                type="button"
                onClick={async () => {
                  if (!await confirm({
                    message: 'Отключить тренера? Он потеряет доступ к данным этого клиента.',
                    confirmLabel: 'Отключить',
                    danger: true,
                  })) return
                  await runAction(`remove:${membership.trainerId}`, () =>
                    yandexPilotRepository.removeTrainer(
                      apiBaseUrl,
                      sessionToken,
                      clientId,
                      membership.trainerId,
                    ), 'Тренер отключён.')
                }}
              >{busyAction === `remove:${membership.trainerId}` ? 'Отключаем…' : 'Отключить тренера'}</button>)}
            {session.profile.accountRole === 'trainer' && ownMembership && !ownMembership.isRoot && <button
              className="link danger"
              disabled={busyAction !== null}
              type="button"
              onClick={async () => {
                if (!await confirm({
                  message: 'Покинуть пространство клиента? Доступ к его данным будет закрыт.',
                  confirmLabel: 'Покинуть',
                  danger: true,
                })) return
                await runAction(`leave:${clientId}`, () =>
                  yandexPilotRepository.leaveClient(apiBaseUrl, sessionToken, clientId),
                'Вы покинули пространство клиента.')
              }}
            >{busyAction === `leave:${clientId}` ? 'Выходим…' : 'Покинуть пространство'}</button>}
          </article>
        })}
      </div>
    </AsyncView>
    {confirmDialog}
  </section>
}
